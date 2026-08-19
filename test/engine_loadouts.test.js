// The 1988 weapon sets: what each one does that the others do not.

import test from 'node:test';
import assert from 'node:assert/strict';

import { loadRules } from '../server/rules.js';
import { createInitialState } from '../engine/state.js';
import { apply } from '../engine/reducer.js';
import { canonicalize } from '../shared/statehash.js';
import { buildView } from '../shared/view.js';
import {
  armEntry,
  coolDown,
  fireUnit,
  roundsOf,
  selectWeapon,
} from '../engine/weapons.js';
import { KIND_MANTA, KIND_WALRUS, UNIT_ACTIVE, UNIT_LOST } from '../engine/units.js';

const rules = loadRules();
const TICK = { type: 'advance_tick' };
const SEED = 20260818;

const W_LASER = 0;
const W_CLUSTER = 1;
const W_NAPALM = 2;
const W_MISSILE = 3;
const W_CANNON = 4;
const W_MINE = 5;

function fresh() {
  return createInitialState(SEED, rules);
}

function drive(state, ticks) {
  for (let i = 0; i < ticks; i++) state = apply(state, TICK);
  return state;
}

// Put a unit on the map at a spot, out of everyone else's way.
function place(unit, x, y, z) {
  unit.state = UNIT_ACTIVE;
  unit.x = x;
  unit.y = y;
  unit.z = z === undefined ? 0 : z;
  return unit;
}

test('napalm covers more ground than the cluster bomb, and neither reaches an aircraft', () => {
  const state = fresh();
  const cluster = state.weapons[W_CLUSTER];
  const napalm = state.weapons[W_NAPALM];
  assert.ok(napalm.blast > cluster.blast, 'napalm should spread wider');
  assert.ok(cluster.damage > napalm.damage, 'the cluster should hit harder per target');
  for (const weapon of [cluster, napalm]) {
    assert.equal(weapon.hitsAir, 0);
    assert.equal(weapon.splash, 1);
  }
  assert.equal(state.weapons[W_MISSILE].guided, 1, 'the missile should be the guided one');
  assert.equal(state.weapons[W_LASER].guided, 0);
});

test('a splash weapon damages everything under it, not only what it struck', () => {
  let state = fresh();
  const manta = state.units.find((u) => u.team === 0 && u.kind === KIND_MANTA);
  const enemies = state.units.filter((u) => u.team === 1 && u.kind === KIND_WALRUS).slice(0, 3);
  place(manta, 4000 * 256, 4000 * 256, 300 * 256);
  selectWeapon(manta, W_NAPALM);
  // Three Walruses in a huddle, well inside one napalm canister.
  place(enemies[0], manta.x + 300 * 256, manta.y, 0);
  place(enemies[1], manta.x + 300 * 256, manta.y + 40 * 256, 0);
  place(enemies[2], manta.x + 320 * 256, manta.y - 50 * 256, 0);
  const before = enemies.map((u) => u.hp);

  state = drive(state, 60);
  const after = enemies.map((e) => state.units.find((u) => u.id === e.id).hp);
  for (let i = 0; i < after.length; i++) {
    assert.ok(after[i] < before[i], `Walrus ${i} was not caught in the blast`);
  }
});

test('a mine does not fly: it waits where it was laid', () => {
  let state = fresh();
  const walrus = state.units.find((u) => u.team === 0 && u.kind === KIND_WALRUS);
  place(walrus, 5000 * 256, 5000 * 256, 0);
  selectWeapon(walrus, W_MINE);
  assert.equal(fireUnit(state, walrus), 1, 'the mine was never laid');

  const mine = state.shots[0];
  assert.equal(mine.trigger, 1);
  assert.equal(mine.speed, 0);
  assert.equal(mine.x, walrus.x);
  assert.equal(mine.y, walrus.y);
  assert.equal(roundsOf(walrus, W_MINE), rules.weapons.list[W_MINE].magazine - 1);

  // It is still sitting there a long time later, having harmed nobody.
  state = drive(state, 400);
  assert.equal(state.shots.length, 1, 'the mine went off, or vanished');
  assert.equal(state.shots[0].x, mine.x);
});

test('a mine goes off for the other side, and not for the side that laid it', () => {
  let state = fresh();
  const walrus = state.units.find((u) => u.team === 0 && u.kind === KIND_WALRUS);
  place(walrus, 6000 * 256, 6000 * 256, 0);
  selectWeapon(walrus, W_MINE);
  fireUnit(state, walrus);

  // Other rounds are in the air elsewhere in the war, so count mines, not shots.
  const mines = (s) => s.shots.filter((shot) => shot.trigger === 1).length;
  const minePlace = { x: state.shots[0].x, y: state.shots[0].y };

  // A friend parks on top of it: nothing happens.
  const friend = state.units.filter((u) => u.team === 0 && u.kind === KIND_WALRUS)[1];
  place(friend, minePlace.x, minePlace.y, 0);
  const friendHp = friend.hp;
  state = drive(state, 5);
  assert.equal(mines(state), 1, 'a mine went off under its own side');
  assert.equal(state.units.find((u) => u.id === friend.id).hp, friendHp);

  // An enemy does the same, and does not enjoy it.
  const enemy = state.units.find((u) => u.team === 1 && u.kind === KIND_WALRUS);
  const before = enemy.hp;
  place(state.units.find((u) => u.id === enemy.id), minePlace.x, minePlace.y, 0);
  state = drive(state, 3);
  assert.equal(mines(state), 0, 'the mine did not go off');
  const hit = state.units.find((u) => u.id === enemy.id);
  assert.ok(hit.hp < before || hit.state === UNIT_LOST, 'the enemy drove over a mine and shrugged');
});

test('a laser held down overheats, and comes back when it has cooled', () => {
  const state = fresh();
  const manta = state.units.find((u) => u.team === 0 && u.kind === KIND_MANTA);
  const enemy = state.units.find((u) => u.team === 1 && u.kind === KIND_WALRUS);
  place(manta, 7000 * 256, 7000 * 256, 200 * 256);
  place(enemy, manta.x + 400 * 256, manta.y, 0);
  selectWeapon(manta, W_LASER);
  const laser = state.weapons[W_LASER];

  // Hold the trigger down: cooldown, fire, cooldown, fire...
  let shots = 0;
  for (let tick = 0; tick < 200 && manta.overheated === 0; tick++) {
    shots += fireUnit(state, manta);
    coolDown(manta, laser);
  }
  assert.equal(manta.overheated, 1, 'the mount never overheated');
  assert.ok(shots > 3, 'it overheated before it had fired anything worth firing');
  assert.equal(fireUnit(state, manta), 0, 'an overheated mount fired anyway');

  // Let go, and it comes back - but only once it is properly cool, not the
  // instant it dips below the maximum.
  for (let tick = 0; tick < 4; tick++) coolDown(manta, laser);
  assert.equal(manta.overheated, 1, 'it came back the moment it stopped firing');
  for (let tick = 0; tick < 400 && manta.overheated === 1; tick++) coolDown(manta, laser);
  assert.equal(manta.overheated, 0, 'it never cooled down');
  assert.ok(manta.heat <= (laser.heatMax * laser.heatReady) / 1000);
});

test('the carrier laser overheats too, and the state stays canonical', () => {
  let state = fresh();
  const carrier = state.carriers[0];
  const enemy = state.units.find((u) => u.team === 1 && u.kind === KIND_MANTA);
  place(enemy, carrier.x + 500 * 256, carrier.y, 300 * 256);
  // Plenty in the ready magazine, so what stops it can only be the heat.
  armEntry(carrier, carrier.weapon).n = 600;

  let sawHot = false;
  for (let tick = 0; tick < 600 && !sawHot; tick++) {
    state = apply(state, TICK);
    sawHot = state.carriers[0].overheated === 1;
    // Keep the target alive: this is about the mount, not about the Manta.
    const target = state.units.find((u) => u.id === enemy.id);
    target.hp = 60;
    target.state = UNIT_ACTIVE;
  }
  assert.ok(sawHot, 'the ship laser never overheated under sustained fire');
  assert.doesNotThrow(() => canonicalize(state));
});

test('the view carries the loadout, and tells an enemy nothing about it', () => {
  const state = fresh();
  const manta = state.units.find((u) => u.team === 0 && u.kind === KIND_MANTA);
  place(manta, state.carriers[1].x + 400 * 256, state.carriers[1].y, 300 * 256);
  selectWeapon(manta, W_CLUSTER);

  const mine = buildView(state, 0).units.find((u) => u.id === manta.id);
  assert.equal(mine.weapon, W_CLUSTER);
  assert.equal(mine.arms.length, 4);

  const theirs = buildView(state, 1).units.find((u) => u.id === manta.id);
  assert.notEqual(theirs, undefined, 'the contact was not seen at all');
  assert.equal(theirs.weapon, -1);
  assert.deepEqual(theirs.arms, [], 'radar reported what was in an enemy magazine');
});
