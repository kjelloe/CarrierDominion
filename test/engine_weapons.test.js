import test from 'node:test';
import assert from 'node:assert/strict';

import { loadRules } from '../server/rules.js';
import { createInitialState } from '../engine/state.js';
import { apply } from '../engine/reducer.js';
import { canonicalize, hashState } from '../shared/statehash.js';
import { buildView } from '../shared/view.js';
import {
  pickTarget,
  rearm,
  reloadCarrier,
  segmentDistSq,
  stepWeapons,
} from '../engine/weapons.js';
import { loadFromDepot, unloadToCarrier } from '../engine/supply.js';
import { EVT_SHOT_FIRED, EVT_UNIT_HIT, EVT_UNIT_LOST } from '../engine/events.js';
import { KIND_MANTA, KIND_WALRUS, UNIT_ACTIVE, UNIT_LOST } from '../engine/units.js';
import { PHASE_OVER, WIN_DRAW, checkVictory } from '../engine/victory.js';
import { stepAiTeam } from '../engine/ai_carrier.js';
import { atan2B } from '../shared/trig.js';

const rules = loadRules();
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

test('a fresh war has no shots in the air and full magazines', () => {
  const state = fresh();
  assert.equal(state.shots.length, 0);
  assert.equal(state.nextShot, 0);
  for (const carrier of state.carriers) {
    assert.equal(carrier.ammo, rules.weapons.carrier.magazine);
    assert.equal(carrier.cooldown, 0);
  }
  const manta = state.units.find((u) => u.kind === KIND_MANTA);
  assert.equal(manta.ammo, rules.weapons.manta.magazine);
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

test('a Walrus gun cannot reach an aircraft, a Manta can reach anything', () => {
  const state = fresh();
  const pair = faceOff(state, KIND_WALRUS, KIND_MANTA, 400 * 256);
  const gun = state.weapons[KIND_WALRUS];
  const missile = state.weapons[KIND_MANTA];
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
  stepWeapons(state, state.params.hitRadiusUnit, state.params.hitRadiusCarrier);
  assert.equal(state.shots.length, 0);
});

test('a Manta shoots an enemy Manta down, and the kill is in the events', () => {
  let state = fresh();
  const pair = faceOff(state, KIND_MANTA, KIND_MANTA, 1200 * 256);
  const victim = pair.b.id;
  // Nobody is steering, so both simply hang there and trade.
  let fired = 0;
  let killed = false;
  for (let tick = 0; tick < 600 && !killed; tick++) {
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
  const life = state.weapons[KIND_MANTA].life;
  state = drive(state, life + 2);
  assert.equal(state.shots.length, 0, 'a missile outlived its range');
});

test('shots are fog-filtered like everything else', () => {
  const state = fresh();
  state.shots.push({
    id: 0,
    team: 1,
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
    guided: 1,
    turn: 900,
    targetKind: 1,
    targetId: 0,
  });
  assert.equal(buildView(state, 1).shots.length, 1, 'a team cannot see its own shot');
  assert.equal(buildView(state, 0).shots.length, 0, 'an unseen enemy shot leaked');
});

test('coming aboard rearms as well as refuels', () => {
  const state = fresh();
  const manta = state.units.find((u) => u.kind === KIND_MANTA);
  manta.ammo = 0;
  const carrier = state.carriers[0];
  manta.state = 2; // UNIT_RETURNING
  manta.order = 2; // ORDER_RETURN
  manta.x = carrier.x;
  manta.y = carrier.y;
  const after = apply(state, TICK);
  const back = after.units.find((u) => u.id === manta.id);
  assert.equal(back.ammo, rules.weapons.manta.magazine);
});

test('two sunk carriers end the war as a draw rather than never', () => {
  const state = fresh();
  for (const carrier of state.carriers) carrier.hull = 0;
  checkVictory(state, state.params.victoryIslandPermil);
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
  const perRound = rules.weapons.manta.ordnancePerRound;
  const magazine = rules.weapons.manta.magazine;

  manta.ammo = 0;
  const before = carrier.ordnance;
  rearm(manta, state.weapons, carrier);
  assert.equal(manta.ammo, magazine);
  assert.equal(carrier.ordnance, before - magazine * perRound);

  // Enough for one missile and no more.
  manta.ammo = 0;
  carrier.ordnance = perRound;
  rearm(manta, state.weapons, carrier);
  assert.equal(manta.ammo, 1);
  assert.equal(carrier.ordnance, 0);

  // And nothing at all when the store is empty: no free missiles.
  manta.ammo = 0;
  rearm(manta, state.weapons, carrier);
  assert.equal(manta.ammo, 0);
});

test('point defence reloads from the store, and stops when the store is dry', () => {
  const state = fresh();
  const carrier = state.carriers[0];
  const weapon = state.weapons[3];
  carrier.ammo = weapon.magazine - 50;
  carrier.ordnance = 20;

  let moved = 0;
  for (let tick = 0; tick < 400; tick++) moved += reloadCarrier(carrier, weapon);
  assert.equal(moved, 20, 'the magazine took more rounds than the store held');
  assert.equal(carrier.ordnance, 0);
  assert.equal(carrier.ammo, weapon.magazine - 30);

  // A dry store adds nothing, however long it is left.
  for (let tick = 0; tick < 400; tick++) reloadCarrier(carrier, weapon);
  assert.equal(carrier.ammo, weapon.magazine - 30);
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
