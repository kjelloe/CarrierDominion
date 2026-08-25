import test from 'node:test';
import assert from 'node:assert/strict';

import { loadRules } from '../server/rules.js';
import { bareRules } from './helpers/rules.mjs';
import { createInitialState } from '../engine/state.js';
import { apply } from '../engine/reducer.js';
import { canonicalize, hashState } from '../shared/statehash.js';
import { buildView } from '../shared/view.js';
import {
  armEntry,
  pickTarget,
  rearm,
  reloadCarrier,
  roundsOf,
  selectWeapon,
  stepWeapons,
} from '../engine/weapons.js';
import { segmentDistSq } from '../engine/shots.js';
import { loadFromDepot, unloadToCarrier } from '../engine/supply.js';
import { EVT_SHOT_FIRED, EVT_UNIT_HIT, EVT_UNIT_LOST } from '../engine/events.js';
import { KIND_MANTA, KIND_WALRUS, UNIT_ACTIVE, UNIT_LOST } from '../engine/units.js';
import { PHASE_OVER, WIN_DRAW, checkVictory } from '../engine/victory.js';
import { stepAiTeam } from '../engine/ai_carrier.js';
import { atan2B } from '../shared/trig.js';

const rules = bareRules();
const TICK = { type: 'advance_tick' };
const SEED = 20260818;

function fresh() {
  return createInitialState(SEED, rules);
}

function drive(state, ticks) {
  for (let i = 0; i < ticks; i++) state = apply(state, TICK);
  return state;
}

// Puts one unit of each side on the map, close enough to fight, without
// involving the hangar, the AI, or the sea.
function faceOff(state, kindA, kindB, apartUnits) {
  const a = state.units.find((u) => u.team === 0 && u.kind === kindA);
  const b = state.units.find((u) => u.team === 1 && u.kind === kindB);
  a.state = UNIT_ACTIVE;
  b.state = UNIT_ACTIVE;
  a.x = 1000 * 256;
  a.y = 1000 * 256;
  a.z = kindA === KIND_MANTA ? 400 * 256 : 0;
  b.x = a.x + apartUnits;
  b.y = a.y;
  b.z = kindB === KIND_MANTA ? 400 * 256 : 0;
  return { a: a, b: b };
}

// Weapon ids, in the order data/weapons.json lists them.
const W_LASER = 0;
const W_CLUSTER = 1;
const W_NAPALM = 2;
const W_MISSILE = 3;
const W_CANNON = 4;
const W_MINE = 5;
const W_CARRIER_LASER = 6;

function magazineOf(key) {
  return rules.weapons.list.find((w) => w.key === key).magazine;
}

test('a fresh war has no shots in the air and every magazine full', () => {
  const state = fresh();
  assert.equal(state.shots.length, 0);
  assert.equal(state.nextShot, 0);
  for (const carrier of state.carriers) {
    assert.equal(carrier.weapon, W_CARRIER_LASER);
    assert.equal(roundsOf(carrier, W_CARRIER_LASER), magazineOf('carrierLaser'));
    assert.equal(carrier.cooldown, 0);
  }
  // The 1988 Manta loadout, in cycle order.
  const manta = state.units.find((u) => u.kind === KIND_MANTA);
  assert.deepEqual(manta.arms.map((a) => a.w), [W_LASER, W_CLUSTER, W_NAPALM, W_MISSILE]);
  assert.equal(manta.weapon, W_LASER, 'a Manta should start on its gun, not its missiles');
  assert.equal(roundsOf(manta, W_MISSILE), magazineOf('mantaMissile'));

  const walrus = state.units.find((u) => u.kind === KIND_WALRUS);
  assert.deepEqual(walrus.arms.map((a) => a.w), [W_CANNON, W_MINE]);
  const lighter = state.units.find((u) => u.kind === 2);
  assert.deepEqual(lighter.arms, [], 'the logistics boat is unarmed');
});

test('selecting a weapon is refused when the hull does not carry it', () => {
  const state = fresh();
  const manta = state.units.find((u) => u.kind === KIND_MANTA);
  assert.equal(selectWeapon(manta, W_MISSILE), 1);
  assert.equal(manta.weapon, W_MISSILE);
  assert.equal(selectWeapon(manta, W_CANNON), 0, 'a Manta took a Walrus cannon');
  assert.equal(manta.weapon, W_MISSILE);
});

test('segment distance catches a target the endpoint test would miss', () => {
  // A shot passing clean over a point: neither end is near it, the middle is.
  const near = segmentDistSq(0, 0, 0, 2000, 0, 0, 1000, 10, 0);
  assert.equal(near, 100);
  const atStart = segmentDistSq(0, 0, 0, 2000, 0, 0, -50, 0, 0);
  assert.equal(atStart, 2500);
  const atEnd = segmentDistSq(0, 0, 0, 2000, 0, 0, 2050, 0, 0);
  assert.equal(atEnd, 2500);
});

test('a Walrus cannon cannot reach an aircraft, a missile can reach anything', () => {
  const state = fresh();
  const pair = faceOff(state, KIND_WALRUS, KIND_MANTA, 400 * 256);
  const gun = state.weapons[W_CANNON];
  const missile = state.weapons[W_MISSILE];
  assert.equal(pickTarget(state, 0, pair.a.x, pair.a.y, pair.a.z, gun), -1);
  const airTarget = pickTarget(state, 0, pair.a.x, pair.a.y, pair.a.z, missile);
  assert.notEqual(airTarget, -1);
  assert.equal(airTarget.id, pair.b.id);
});

test('nothing fires at a friend, however close', () => {
  const state = fresh();
  const a = state.units.find((u) => u.team === 0 && u.kind === KIND_MANTA);
  const b = state.units.filter((u) => u.team === 0 && u.kind === KIND_MANTA)[1];
  a.state = UNIT_ACTIVE;
  b.state = UNIT_ACTIVE;
  a.x = 1000 * 256;
  a.y = 1000 * 256;
  b.x = a.x + 50 * 256;
  b.y = a.y;
  stepWeapons(state, state.params);
  assert.equal(state.shots.length, 0);
});

test('a Manta shoots an enemy Manta down, and the kill is in the events', () => {
  let state = fresh();
  const pair = faceOff(state, KIND_MANTA, KIND_MANTA, 1200 * 256);
  const victim = pair.b.id;
  const shooter = pair.a.id;
  selectWeapon(pair.a, W_MISSILE);
  // Empty the target's magazines. With the 1988 loadouts an unattended Manta
  // defends itself with its laser, and a laser duel at 1200 m is a different
  // test from this one - which is about a missile finding its target.
  for (const entry of pair.b.arms) entry.n = 0;
  // Nobody is steering, so both simply hang there and trade. The trigger is
  // pulled every tick: a Manta fires for its pilot and nobody else (#18).
  let fired = 0;
  let killed = false;
  for (let tick = 0; tick < 600 && !killed; tick++) {
    state = apply(state, { type: 'fire_unit', unitId: shooter });
    state = apply(state, TICK);
    for (const event of state.events) {
      if (event.code === EVT_SHOT_FIRED) fired += 1;
      if (event.code === EVT_UNIT_LOST && event.a === victim) killed = true;
    }
  }
  assert.ok(fired > 0, 'nobody ever fired');
  assert.ok(killed, 'the target survived a six-hundred-tick duel');
  const dead = state.units.find((u) => u.id === victim);
  assert.equal(dead.state, UNIT_LOST);
  assert.equal(dead.hp, 0);
});

test('a hit is reported to the side that was hit, not the side that fired', () => {
  let state = fresh();
  faceOff(state, KIND_MANTA, KIND_MANTA, 1200 * 256);
  let hitEvent = -1;
  for (let tick = 0; tick < 600 && hitEvent === -1; tick++) {
    state = apply(state, TICK);
    for (const event of state.events) {
      if (event.code === EVT_UNIT_HIT) hitEvent = event;
    }
  }
  assert.notEqual(hitEvent, -1, 'nothing was ever hit');
  const victimView = buildView(state, hitEvent.b);
  assert.ok(
    victimView.events.some((e) => e.code === EVT_UNIT_HIT),
    'the team that was hit was not told',
  );
});

test('a shot expires at the end of its range instead of flying forever', () => {
  let state = fresh();
  const pair = faceOff(state, KIND_MANTA, KIND_MANTA, 2400 * 256);
  selectWeapon(pair.a, W_MISSILE);
  // Take the target away the tick after the first missile is away: the missile
  // loses its guidance and must run out of life rather than orbit.
  let seen = false;
  for (let tick = 0; tick < 40 && !seen; tick++) {
    state = apply(state, TICK);
    seen = state.shots.length > 0;
  }
  assert.ok(seen, 'no missile was ever launched');
  const target = state.units.find((u) => u.id === pair.b.id);
  target.state = UNIT_LOST;
  target.hp = 0;
  const life = state.weapons[W_MISSILE].life;
  state = drive(state, life + 2);
  assert.equal(state.shots.length, 0, 'a missile outlived its range');
});

function farShot(state, overrides) {
  return {
    id: 0,
    team: 1,
    weapon: 3,
    // Far from every team-0 hull: an enemy missile over the horizon.
    x: state.params.sizeUnits - 1000,
    y: state.params.sizeUnits - 1000,
    z: 0,
    heading: 0,
    climb: 0,
    speed: 3840,
    damage: 40,
    blast: 5632,
    life: 200,
    guided: 0,
    splash: 0,
    trigger: 0,
    turn: 900,
    targetKind: 1,
    targetId: 1,
    ...overrides,
  };
}

test('shots are fog-filtered like everything else', () => {
  const state = fresh();
  // Unguided, and aimed at the enemy's own carrier: nothing of team 0's can
  // see it, so team 0 does not.
  state.shots.push(farShot(state, {}));
  assert.equal(buildView(state, 1).shots.length, 1, 'a team cannot see its own shot');
  assert.equal(buildView(state, 0).shots.length, 0, 'an unseen enemy shot leaked');
});

test('a missile with your name on it is on your scope, wherever it is', () => {
  const state = fresh();
  // Guided, and locked onto team 0's carrier: the ship's warning receiver sees
  // it even though no hull of team 0's is anywhere near it.
  state.shots.push(farShot(state, { guided: 1, targetKind: 1, targetId: 0 }));
  const warned = buildView(state, 0).shots;
  assert.equal(warned.length, 1, 'a lock on your own ship was hidden from you');
  assert.equal(warned[0].warn, 1);

  // The same missile the other way round: fired by team 0 at team 1's ship.
  // Team 1 is warned; team 0 sees its own round and is warned about nothing,
  // because you know what you fired.
  const other = fresh();
  other.shots.push(farShot(other, { team: 0, guided: 1, targetKind: 1, targetId: 1 }));
  assert.equal(buildView(other, 1).shots[0].warn, 1, 'the target was not warned');
  assert.equal(buildView(other, 0).shots[0].warn, 0, 'a shooter was warned about its own shot');
});

test('coming aboard rearms as well as refuels', () => {
  const state = fresh();
  const manta = state.units.find((u) => u.kind === KIND_MANTA);
  for (const entry of manta.arms) entry.n = 0;
  const carrier = state.carriers[0];
  manta.state = 2; // UNIT_RETURNING
  manta.order = 2; // ORDER_RETURN
  manta.x = carrier.x;
  manta.y = carrier.y;
  const after = apply(state, TICK);
  const back = after.units.find((u) => u.id === manta.id);
  assert.equal(roundsOf(back, W_MISSILE), magazineOf('mantaMissile'));
  assert.equal(roundsOf(back, W_CLUSTER), magazineOf('mantaCluster'));
});

test('two sunk carriers end the war as a draw rather than never', () => {
  const state = fresh();
  for (const carrier of state.carriers) carrier.hull = 0;
  checkVictory(state, state.params);
  assert.equal(state.phase, PHASE_OVER);
  assert.equal(state.winner, -1);
  assert.equal(state.winReason, WIN_DRAW);
});

test('combat leaves the state canonical and the hash reproducible', () => {
  let a = fresh();
  let b = fresh();
  faceOff(a, KIND_MANTA, KIND_MANTA, 1200 * 256);
  faceOff(b, KIND_MANTA, KIND_MANTA, 1200 * 256);
  a = drive(a, 300);
  b = drive(b, 300);
  assert.doesNotThrow(() => canonicalize(a));
  assert.equal(hashState(a), hashState(b));
  assert.ok(a.nextShot > 0, 'the duel produced no shots at all');
});

test('a battered AI carrier breaks contact instead of trading to the death', () => {
  const aiBoth = { ...rules, rules: { ...rules.rules, aiTeams: [0, 1] } };
  const state = createInitialState(SEED, aiBoth);
  const hurt = state.carriers[1];
  const enemy = state.carriers[0];
  // Put them in sight of each other, and knock one down to a fifth of its hull.
  enemy.x = hurt.x + 2000 * 256;
  enemy.y = hurt.y;
  hurt.hull = Math.floor(hurt.maxHull / 5);

  const brain = state.ai.find((b) => b.team === 1);
  stepAiTeam(state, brain, state.params.aiStandoff);

  assert.ok(brain.retreatTicks > 0, 'the damaged carrier did not break off');
  assert.equal(hurt.throttle, 100);
  // Away from the enemy: the enemy is due east, so the escape heading must have
  // a westward component.
  const away = atan2B(hurt.y - enemy.y, hurt.x - enemy.x);
  assert.equal(hurt.headingHold, away);
  assert.equal(hurt.supplyRun, 1, 'a retreating carrier should be calling for supply');
});

test('rearming spends the ship ordnance, and a dry ship sends aircraft up empty', () => {
  const state = fresh();
  const carrier = state.carriers[0];
  const manta = state.units.find((u) => u.team === 0 && u.kind === KIND_MANTA);
  const perMissile = rules.weapons.list[W_MISSILE].ordnancePerRound;

  for (const entry of manta.arms) entry.n = 0;
  const before = carrier.ordnance;
  rearm(manta, state.weapons, carrier);
  assert.equal(roundsOf(manta, W_MISSILE), magazineOf('mantaMissile'));
  assert.ok(carrier.ordnance < before, 'a full rearm cost nothing');

  // Enough for one missile and no more. The loadout is worked in order, so
  // everything ahead of the missiles has to be full first.
  for (const entry of manta.arms) entry.n = state.weapons[entry.w].magazine;
  armEntry(manta, W_MISSILE).n = 0;
  carrier.ordnance = perMissile;
  rearm(manta, state.weapons, carrier);
  assert.equal(roundsOf(manta, W_MISSILE), 1);
  assert.equal(carrier.ordnance, 0);

  // And nothing at all when the store is empty: no free missiles.
  armEntry(manta, W_MISSILE).n = 0;
  rearm(manta, state.weapons, carrier);
  assert.equal(roundsOf(manta, W_MISSILE), 0);
});

test('point defence reloads from the store, and stops when the store is dry', () => {
  const state = fresh();
  const carrier = state.carriers[0];
  const weapon = state.weapons[carrier.weapon];
  armEntry(carrier, carrier.weapon).n = weapon.magazine - 50;
  carrier.ordnance = 20;

  let moved = 0;
  for (let tick = 0; tick < 400; tick++) moved += reloadCarrier(carrier, weapon);
  assert.equal(moved, 20, 'the magazine took more rounds than the store held');
  assert.equal(carrier.ordnance, 0);
  assert.equal(roundsOf(carrier, carrier.weapon), weapon.magazine - 30);

  // A dry store adds nothing, however long it is left.
  for (let tick = 0; tick < 400; tick++) reloadCarrier(carrier, weapon);
  assert.equal(roundsOf(carrier, carrier.weapon), weapon.magazine - 30);
});

test('a lighter brings ordnance from the depot into the ship', () => {
  const state = fresh();
  const carrier = state.carriers[0];
  const depot = state.islands[0];
  const boat = state.units.find((u) => u.team === 0 && u.kind === 2);
  depot.stockFuel = 0;
  depot.stockMaterials = 0;
  depot.stockOrdnance = 900;

  loadFromDepot(state, boat, depot);
  assert.ok(boat.cargoOrdnance > 0, 'the boat loaded no ordnance');
  assert.equal(depot.stockOrdnance, 900 - boat.cargoOrdnance);

  const aboardBefore = carrier.ordnance;
  carrier.ordnance = 0;
  unloadToCarrier(state, boat, carrier);
  assert.ok(carrier.ordnance > 0, 'nothing was landed into the magazine');
  assert.ok(carrier.ordnance <= carrier.ordnanceCapacity);
  assert.ok(aboardBefore > 0, 'a carrier should start with a full store');
});

test('an autopilot Manta defends itself; a piloted one waits for its pilot', () => {
  let state = fresh();
  // Its target is a Walrus, whose gun cannot elevate at it - so the aircraft is
  // in easy range of something it could kill, and the only question is whether
  // anything makes it shoot.
  const pair = faceOff(state, KIND_MANTA, KIND_WALRUS, 700 * 256);
  const flown = pair.a.id;
  state = apply(state, TICK);
  const auto = state.units.find((u) => u.id === flown);
  assert.ok(
    roundsOf(auto, auto.weapon) < magazineOf('mantaLaser'),
    'an autopilot Manta did not defend itself',
  );

  // Climb into the cockpit and it stops shooting on its own.
  let piloted = fresh();
  const seat = faceOff(piloted, KIND_MANTA, KIND_WALRUS, 700 * 256);
  piloted = apply(piloted, { type: 'take_control', unitId: seat.a.id });
  const seated = piloted.units.find((u) => u.id === seat.a.id);
  const held = roundsOf(seated, seated.weapon);
  for (let tick = 0; tick < 120; tick++) piloted = apply(piloted, TICK);
  const idle = piloted.units.find((u) => u.id === seat.a.id);
  assert.equal(roundsOf(idle, idle.weapon), held, 'a piloted Manta fired without its pilot');
  // ...until the pilot pulls the trigger.
  piloted = apply(piloted, { type: 'fire_unit', unitId: seat.a.id });
  const fired = piloted.units.find((u) => u.id === seat.a.id);
  assert.equal(roundsOf(fired, fired.weapon), held - 1);
});

test('a cooling weapon becomes ready even when the trigger is never pulled', () => {
  let state = fresh();
  const pair = faceOff(state, KIND_MANTA, KIND_MANTA, 1200 * 256);
  state = apply(state, { type: 'fire_unit', unitId: pair.a.id });
  const hot = state.units.find((u) => u.id === pair.a.id);
  assert.ok(hot.cooldown > 0, 'firing left no cooldown');
  state = apply(state, TICK);
  const cooler = state.units.find((u) => u.id === pair.a.id);
  assert.ok(cooler.cooldown < hot.cooldown, 'the rail never cooled');
});

// --- Launch loadout presets (ruled 2026-08-25) ---

test('the scout preset arms light, and the store keeps the difference', () => {
  let state = createInitialState(SEED, rules);
  // Fly the ordnance out of a Manta, then recover under two presets.
  state = apply(state, { type: 'set_loadout_preset', carrierId: 0, preset: 1 }); // scout
  assert.equal(state.carriers[0].mantaPreset, 1);
  const manta = state.units.find((u) => u.team === 0 && u.kind === 0);
  state = apply(state, { type: 'launch_unit', carrierId: 0, kind: 0 });
  const flyer = state.units.find((u) => u.id === manta.id);
  for (const arm of flyer.arms) arm.n = 0; // came home empty
  const ordnance = state.carriers[0].ordnance;
  state = apply(state, { type: 'recall_unit', unitId: manta.id });
  let ticks = 0;
  while (ticks < 60000 && state.units.find((u) => u.id === manta.id).state !== 0) {
    state = apply(state, { type: 'advance_tick' });
    ticks += 1;
  }
  const scout = state.units.find((u) => u.id === manta.id);
  const clusters = scout.arms[1].n;
  const napalm = scout.arms[2].n;
  const missiles = scout.arms[3].n;
  assert.equal(clusters, 0, 'a scout carries no bombs');
  assert.equal(napalm, 0);
  assert.ok(missiles >= 1 && missiles < state.weapons[3].magazine,
    'a scout keeps a token missile, not a full rack');
  // The dent is mostly the laser (400 rounds at 1 ordnance each) plus one
  // missile - the bombs a scout never carries stay in the store.
  const dent = ordnance - state.carriers[0].ordnance;
  assert.ok(dent > 0 && dent <= 460, 'a scout fit cost ' + dent + ' ordnance');
  assert.doesNotThrow(() => canonicalize(state));
});

test('balanced is the old full fit, exactly', () => {
  let state = createInitialState(SEED, rules);
  const manta = state.units.find((u) => u.team === 0 && u.kind === 0);
  state = apply(state, { type: 'launch_unit', carrierId: 0, kind: 0 });
  const flyer = state.units.find((u) => u.id === manta.id);
  for (const arm of flyer.arms) arm.n = 0;
  state = apply(state, { type: 'recall_unit', unitId: manta.id });
  let ticks = 0;
  while (ticks < 60000 && state.units.find((u) => u.id === manta.id).state !== 0) {
    state = apply(state, { type: 'advance_tick' });
    ticks += 1;
  }
  const full = state.units.find((u) => u.id === manta.id);
  for (let i = 0; i < full.arms.length; i++) {
    assert.equal(full.arms[i].n, state.weapons[full.arms[i].w].magazine,
      `arm ${i} not filled to the brim under BALANCED`);
  }
});
