// Who is being shot at, and who decided that: attack orders, boresight aiming,
// and the ship's laser in pointer mode.

import test from 'node:test';
import assert from 'node:assert/strict';

import { loadRules } from '../server/rules.js';
import { createInitialState } from '../engine/state.js';
import { apply } from '../engine/reducer.js';
import { canonicalize } from '../shared/statehash.js';
import { dist2D } from '../shared/fixed.js';
import { atan2B } from '../shared/trig.js';
import {
  SEEKER_CONE,
  TARGET_CARRIER,
  TARGET_UNIT,
  aimFor,
  boresight,
  designated,
  lockOn,
} from '../engine/targeting.js';
import { fireUnit, selectWeapon } from '../engine/weapons.js';
import { KIND_MANTA, KIND_WALRUS, ORDER_ATTACK, ORDER_HOLD, UNIT_ACTIVE } from '../engine/units.js';

const rules = loadRules();
const TICK = { type: 'advance_tick' };
const SEED = 20260818;
const W_LASER = 0;
const W_MISSILE = 3;

function fresh() {
  return createInitialState(SEED, rules);
}

function place(unit, x, y, z) {
  unit.state = UNIT_ACTIVE;
  unit.x = x;
  unit.y = y;
  unit.z = z === undefined ? 0 : z;
  return unit;
}

test('an attack order chases a target that is moving', () => {
  let state = fresh();
  const manta = state.units.find((u) => u.team === 0 && u.kind === KIND_MANTA);
  const prey = state.units.find((u) => u.team === 1 && u.kind === KIND_WALRUS);
  place(manta, 4000 * 256, 4000 * 256, 400 * 256);
  place(prey, 4000 * 256, 6000 * 256, 0);

  state = apply(state, {
    type: 'order_unit_attack',
    unitId: manta.id,
    targetKind: TARGET_UNIT,
    targetId: prey.id,
  });
  const ordered = state.units.find((u) => u.id === manta.id);
  assert.equal(ordered.order, ORDER_ATTACK);
  assert.equal(ordered.orderTargetId, prey.id);

  // Move the target; the order should follow it rather than the spot it left.
  const moved = state.units.find((u) => u.id === prey.id);
  moved.x = moved.x + 900 * 256;
  state = apply(state, TICK);
  const chasing = state.units.find((u) => u.id === manta.id);
  assert.equal(chasing.targetX, moved.x, 'the order aimed at where the target used to be');
});

test('an attack order on something already gone is refused', () => {
  let state = fresh();
  const manta = place(
    state.units.find((u) => u.team === 0 && u.kind === KIND_MANTA),
    3000 * 256, 3000 * 256, 400 * 256,
  );
  const dead = state.units.find((u) => u.team === 1 && u.kind === KIND_WALRUS);
  dead.hp = 0;
  state = apply(state, {
    type: 'order_unit_attack',
    unitId: manta.id,
    targetKind: TARGET_UNIT,
    targetId: dead.id,
  });
  assert.equal(state.units.find((u) => u.id === manta.id).order !== ORDER_ATTACK, true);
  assert.ok(state.events.some((e) => e.code === 1), 'the command was not rejected');
});

test('an attack order ends when its target does, rather than wandering on', () => {
  let state = fresh();
  const manta = place(
    state.units.find((u) => u.team === 0 && u.kind === KIND_MANTA),
    5000 * 256, 5000 * 256, 400 * 256,
  );
  const prey = place(state.units.find((u) => u.team === 1 && u.kind === KIND_WALRUS),
    5000 * 256, 5600 * 256, 0);
  state = apply(state, {
    type: 'order_unit_attack',
    unitId: manta.id,
    targetKind: TARGET_UNIT,
    targetId: prey.id,
  });
  const doomed = state.units.find((u) => u.id === prey.id);
  doomed.hp = 0;
  doomed.state = 3;
  state = apply(state, TICK);
  const after = state.units.find((u) => u.id === manta.id);
  assert.equal(after.order, ORDER_HOLD);
  assert.equal(after.orderTargetId, -1);
});

test('a seeker locks on what the nose is pointing at, not on what is nearest', () => {
  const state = fresh();
  const manta = place(
    state.units.find((u) => u.team === 0 && u.kind === KIND_MANTA),
    6000 * 256, 6000 * 256, 400 * 256,
  );
  const enemies = state.units.filter((u) => u.team === 1 && u.kind === KIND_WALRUS);
  // One close but off to the side, one further away but dead ahead.
  place(enemies[0], manta.x + 100 * 256, manta.y + 600 * 256, 0);
  place(enemies[1], manta.x + 1200 * 256, manta.y, 0);
  manta.heading = atan2B(0, 1); // due east, at the far one

  const missile = state.weapons[W_MISSILE];
  const locked = lockOn(state, 0, manta.x, manta.y, manta.z, manta.heading, missile);
  assert.notEqual(locked, -1, 'nothing locked at all');
  assert.equal(locked.id, enemies[1].id, 'the seeker took the nearer target off the nose');

  // Point somewhere empty and there is no lock to be had.
  const away = lockOn(state, 0, manta.x, manta.y, manta.z, manta.heading + 32768, missile);
  assert.equal(away, -1, 'a seeker locked on something behind the aircraft');
});

test('a pilot with no lock does not launch a missile', () => {
  const state = fresh();
  const manta = place(
    state.units.find((u) => u.team === 0 && u.kind === KIND_MANTA),
    7000 * 256, 7000 * 256, 400 * 256,
  );
  const enemy = place(state.units.find((u) => u.team === 1 && u.kind === KIND_WALRUS),
    manta.x + 900 * 256, manta.y, 0);
  selectWeapon(manta, W_MISSILE);
  manta.control = manta.team;

  manta.heading = atan2B(0, -1); // pointed the wrong way
  assert.equal(fireUnit(state, manta), 0, 'a missile went off with no lock');

  manta.heading = atan2B(enemy.y - manta.y, enemy.x - manta.x);
  assert.equal(fireUnit(state, manta), 1, 'a lock on the nose still would not fire');
});

test('a gun under direct control fires down the nose, hit or miss', () => {
  const state = fresh();
  const manta = place(
    state.units.find((u) => u.team === 0 && u.kind === KIND_MANTA),
    8000 * 256, 8000 * 256, 400 * 256,
  );
  selectWeapon(manta, W_LASER);
  manta.control = manta.team;
  manta.heading = 0;

  // Nothing in front of it at all: it still fires, because aiming is the
  // player's job and a miss is a legitimate outcome.
  assert.equal(fireUnit(state, manta), 1, 'a pilot could not fire at empty sky');
  const shot = state.shots[state.shots.length - 1];
  const laser = state.weapons[W_LASER];
  assert.equal(shot.heading, 0);
  const aim = boresight(manta.x, manta.y, manta.z, manta.heading, laser);
  assert.equal(aim.x, manta.x + laser.range);
});

test('pointer mode makes the ship laser prefer what was clicked', () => {
  let state = fresh();
  const carrier = state.carriers[0];
  const enemies = state.units.filter((u) => u.team === 1 && u.kind === KIND_MANTA);
  // Two in reach: one close, one further out. The far one is the one clicked.
  place(enemies[0], carrier.x + 300 * 256, carrier.y, 300 * 256);
  place(enemies[1], carrier.x + 900 * 256, carrier.y, 300 * 256);

  state = apply(state, {
    type: 'set_carrier_aim',
    carrierId: carrier.id,
    targetKind: TARGET_UNIT,
    targetId: enemies[1].id,
  });
  assert.equal(state.carriers[0].aimId, enemies[1].id);

  state = apply(state, TICK);
  const fired = state.shots.filter((s) => s.team === 0);
  assert.ok(fired.length > 0, 'the ship never fired');
  assert.equal(fired[0].targetId, enemies[1].id, 'the mount ignored the pointer');

  // Clearing it hands the mount back its own judgement: the nearest.
  state = apply(state, {
    type: 'set_carrier_aim', carrierId: carrier.id, targetKind: -1, targetId: -1,
  });
  assert.equal(state.carriers[0].aimId, -1);
});

test('a pointer target that dies is simply forgotten', () => {
  let state = fresh();
  const carrier = state.carriers[0];
  const enemy = place(state.units.find((u) => u.team === 1 && u.kind === KIND_MANTA),
    carrier.x + 400 * 256, carrier.y, 300 * 256);
  state = apply(state, {
    type: 'set_carrier_aim',
    carrierId: carrier.id,
    targetKind: TARGET_UNIT,
    targetId: enemy.id,
  });
  const gone = state.units.find((u) => u.id === enemy.id);
  gone.hp = 0;
  gone.state = 3;
  assert.equal(designated(state, TARGET_UNIT, enemy.id), -1);
  // The mount carries on without complaint.
  state = apply(state, TICK);
  assert.doesNotThrow(() => canonicalize(state));
});

test('the seeker cone is narrow enough that pointing matters', () => {
  // A quarter turn is 16384 BAM; the cone is about 22 degrees either side.
  assert.ok(SEEKER_CONE < 16384 / 2, 'the seeker sees too much of the sky');
  assert.ok(SEEKER_CONE > 1000, 'the seeker is too narrow to use in a turn');
});

test('an attack order survives the canonical walk', () => {
  let state = fresh();
  const manta = place(
    state.units.find((u) => u.team === 0 && u.kind === KIND_MANTA),
    9000 * 256, 9000 * 256, 400 * 256,
  );
  state = apply(state, {
    type: 'order_unit_attack',
    unitId: manta.id,
    targetKind: TARGET_CARRIER,
    targetId: state.carriers[1].id,
  });
  state = apply(state, TICK);
  assert.doesNotThrow(() => canonicalize(state));
  const after = state.units.find((u) => u.id === manta.id);
  assert.equal(after.orderTargetKind, TARGET_CARRIER);
  assert.ok(dist2D(after.targetX, after.targetY, state.carriers[1].x, state.carriers[1].y) < 256);
});

test('an attack order classifies air by kind: a Manta on the deck is still an air target', () => {
  const state = fresh();
  const walrus = state.units.find((u) => u.team === 0 && u.kind === KIND_WALRUS);
  const parked = state.units.find((u) => u.team === 1 && u.kind === KIND_MANTA);
  place(walrus, 5000 * 256, 5000 * 256, 0);
  place(parked, walrus.x + 300 * 256, walrus.y, 0); // at sea level, well in range
  walrus.order = ORDER_ATTACK;
  walrus.orderTargetKind = TARGET_UNIT;
  walrus.orderTargetId = parked.id;

  const cannon = state.weapons[4];
  assert.equal(cannon.hitsAir, 0);
  const aim = aimFor(state, walrus, cannon, -1);
  assert.equal(aim, -1, 'the cannon elevated onto an aircraft because it was parked');

  // The same order against a surface hull is obeyed.
  const truck = state.units.find((u) => u.team === 1 && u.kind === KIND_WALRUS);
  place(truck, walrus.x + 300 * 256, walrus.y - 100 * 256, 0);
  walrus.orderTargetId = truck.id;
  const surface = aimFor(state, walrus, cannon, -1);
  assert.equal(surface.id, truck.id);
});
