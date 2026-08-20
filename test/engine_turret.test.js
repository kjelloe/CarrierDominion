// Defence islands: guns on the ground that shoot, and can be shot.

import test from 'node:test';
import assert from 'node:assert/strict';

import { loadRules, withoutAi } from './helpers/rules.mjs';
import { createInitialState } from '../engine/state.js';
import { apply } from '../engine/reducer.js';
import { canonicalize } from '../shared/statehash.js';
import { buildView } from '../shared/view.js';
import { dist2D } from '../shared/fixed.js';
import { atan2B } from '../shared/trig.js';
import { TARGET_TURRET, guide } from '../engine/shots.js';
import { BUILD_TURRET, ROLE_DEFENCE, raiseTurret } from '../engine/island.js';
import { TURRET_LASER, TURRET_MISSILE, turretsOn } from '../engine/turret.js';
import { KIND_MANTA, UNIT_ACTIVE } from '../engine/units.js';
import { EVT_TURRET_BUILT, EVT_TURRET_LOST } from '../engine/events.js';

const rules = withoutAi(loadRules());
const econ = loadRules().economy;
const TICK = { type: 'advance_tick' };
const SEED = 20260818;

function fresh() {
  return createInitialState(SEED, rules);
}

function drive(state, ticks) {
  for (let i = 0; i < ticks; i++) state = apply(state, TICK);
  return state;
}

// A defence island with `count` guns already up.
function fortify(state, islandId, count, team = 0) {
  const island = state.islands[islandId];
  island.owner = team;
  island.role = ROLE_DEFENCE;
  for (let i = 0; i < count; i++) {
    raiseTurret(state, island);
    island.turrets = island.turrets + 1;
  }
  return island;
}

test('a finished turret build puts a gun on the ground', () => {
  let state = fresh();
  const island = state.islands[0];
  island.owner = 0;
  island.role = ROLE_DEFENCE;
  island.stockMaterials = econ.builds[BUILD_TURRET].materials;

  state = apply(state, {
    type: 'build_on_island', carrierId: 0, islandId: island.id, what: BUILD_TURRET,
  });
  assert.equal(state.turrets.length, 0, 'a gun appeared before it was built');

  state = drive(state, econ.builds[BUILD_TURRET].ticks);
  assert.equal(state.turrets.length, 1);
  assert.ok(state.events.some((e) => e.code === EVT_TURRET_BUILT));
  const turret = state.turrets[0];
  assert.equal(turret.team, 0);
  assert.equal(turret.island, island.id);
  assert.equal(turret.hp, turret.maxHp);
  // On the ring around the command node, not on top of it.
  const out = dist2D(turret.x, turret.y, state.islands[0].nodeX, state.islands[0].nodeY);
  assert.ok(out > 0, 'the gun was built inside the command centre');
});

test('the guns alternate, so an island is dangerous at both ranges', () => {
  const state = fresh();
  fortify(state, 0, 4);
  assert.equal(state.turrets.length, 4);
  assert.equal(state.turrets[0].kind, TURRET_LASER);
  assert.equal(state.turrets[1].kind, TURRET_MISSILE);
  assert.equal(state.turrets[2].kind, TURRET_LASER);
  assert.equal(state.turrets[3].kind, TURRET_MISSILE);
  // Four guns, four bearings.
  const spots = state.turrets.map((t) => `${t.x},${t.y}`);
  assert.equal(new Set(spots).size, 4, 'two guns were built in the same place');
});

test('a turret shoots at an enemy that comes into range', () => {
  let state = fresh();
  const island = fortify(state, 0, 1);
  const manta = state.units.find((u) => u.team === 1 && u.kind === KIND_MANTA);
  manta.state = UNIT_ACTIVE;
  manta.x = state.turrets[0].x + 400 * 256;
  manta.y = state.turrets[0].y;
  manta.z = 200 * 256;
  const before = state.turrets[0].arms[0].n;
  const health = manta.hp;

  // Long enough for a round to be fired AND to arrive: a laser bolt covers the
  // 400 m in eight ticks, so counting shots in flight at one instant proves
  // nothing.
  state = drive(state, 60);
  assert.ok(state.turrets[0].arms[0].n < before, 'the gun watched an enemy fly past');
  assert.ok(state.units.find((u) => u.id === manta.id).hp < health, 'and it missed every time');
  assert.equal(island.owner, 0);
});

test('a turret does not shoot at its own side', () => {
  let state = fresh();
  fortify(state, 0, 1);
  const friend = state.units.find((u) => u.team === 0 && u.kind === KIND_MANTA);
  friend.state = UNIT_ACTIVE;
  friend.x = state.turrets[0].x + 300 * 256;
  friend.y = state.turrets[0].y;
  friend.z = 200 * 256;
  const before = state.turrets[0].arms[0].n;
  state = drive(state, 30);
  assert.equal(state.turrets[0].arms[0].n, before, 'a battery opened up on its own aircraft');
});

test('a turret can be shot away, and reports it when it goes', () => {
  let state = fresh();
  fortify(state, 0, 2);
  const target = state.turrets[0];
  const manta = state.units.find((u) => u.team === 1 && u.kind === KIND_MANTA);
  manta.state = UNIT_ACTIVE;
  manta.x = target.x + 600 * 256;
  manta.y = target.y;
  manta.z = 250 * 256;
  // A missile at a time, from outside the laser's reach, until it is rubble.
  let killed = false;
  for (let tick = 0; tick < 4000 && !killed; tick++) {
    state = apply(state, TICK);
    killed = state.events.some((e) => e.code === EVT_TURRET_LOST);
    const flyer = state.units.find((u) => u.id === manta.id);
    // Keep the attacker alive and armed: this is about the turret.
    flyer.hp = flyer.maxHp;
    flyer.state = UNIT_ACTIVE;
    for (const entry of flyer.arms) entry.n = 4;
  }
  assert.ok(killed, 'the battery survived a sustained attack from beyond its own range');
  assert.ok(state.turrets.length < 2, 'the wreck was never cleared away');
});

test('taking the island takes its guns off the board', () => {
  let state = fresh();
  fortify(state, 0, 3);
  assert.equal(turretsOn(state, 0), 3);
  // The pod completes for the other side.
  state.islands[0].podTeam = 1;
  state.islands[0].podTicks = state.params.podBuildTicks - 1;
  state = drive(state, 2);
  assert.equal(state.islands[0].owner, 1);
  assert.equal(turretsOn(state, 0), 0, 'the new owner inherited the old owner guns');
  assert.equal(state.islands[0].turrets, 0);
});

test('a gun emplacement is visible from the sea; its magazine is not', () => {
  const state = fresh();
  fortify(state, 0, 1);
  const mine = buildView(state, 0).turrets[0];
  assert.equal(mine.hp, mine.maxHp);

  const theirs = buildView(state, 1).turrets[0];
  assert.notEqual(theirs, undefined, 'an enemy battery was invisible');
  assert.equal(theirs.hp, -1, 'the enemy read our damage report');
  assert.equal(theirs.team, 0);
});

test('turrets keep the state hygienic', () => {
  let state = fresh();
  fortify(state, 0, 2);
  fortify(state, 3, 2, 1);
  state = drive(state, 200);
  assert.doesNotThrow(() => canonicalize(state));
});

test('a missile chasing a turret chases the turret, not the unit that shares its number', () => {
  const state = fresh();
  // Turret ids and unit ids are separate sequences that both start at zero:
  // hostile turret 0, and a friendly unit 0 somewhere else entirely.
  fortify(state, 1, 1, 1);
  const turret = state.turrets[0];
  const decoy = state.units.find((u) => u.id === turret.id);
  decoy.state = UNIT_ACTIVE;
  decoy.x = turret.x + 5000 * 256;
  decoy.y = turret.y - 5000 * 256;
  decoy.z = 300 * 256;

  // A guided round south of the gun, aimed at it, already flying north.
  const toTurret = atan2B(1, 0);
  const shot = {
    id: 0, team: 0, weapon: 3,
    x: turret.x, y: turret.y - 1500 * 256, z: 200 * 256,
    heading: toTurret, climb: 0, speed: 3840, damage: 40, blast: 0, life: 100,
    guided: 1, splash: 0, trigger: 0, turn: 900,
    targetKind: TARGET_TURRET, targetId: turret.id,
  };
  guide(state, shot);
  assert.equal(shot.heading, toTurret, 'the seeker wandered off toward whatever unit shared the id');

  // And a dead turret is a dead lock: the round flies on, it does not re-home.
  turret.hp = 0;
  shot.heading = toTurret;
  guide(state, shot);
  assert.equal(shot.heading, toTurret);
});
