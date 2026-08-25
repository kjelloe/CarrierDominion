// The Hammerhead and its Viewing Drone (ruled 2026-08-25, player-only):
// launch the drone, and while its picture holds a point, missiles can be
// walked onto it - the carrier's heavy surface arm, decisive against
// emplacements, useless against aircraft, and blind without its eye.

import test from 'node:test';
import assert from 'node:assert/strict';

import { loadRules, bareRules } from './helpers/rules.mjs';
import { createInitialState } from '../engine/state.js';
import { apply } from '../engine/reducer.js';
import { canonicalize } from '../shared/statehash.js';
import { KIND_DRONE, UNIT_ACTIVE, UNIT_LOST } from '../engine/units.js';
import { ROLE_DEFENCE, raiseTurret } from '../engine/island.js';

const rules = bareRules();
const TICK = { type: 'advance_tick' };
const SEED = 20260818;

function launchDrone(state) {
  const drone = state.units.find((u) => u.team === 0 && u.kind === KIND_DRONE);
  const next = apply(state, { type: 'launch_unit', carrierId: 0, kind: KIND_DRONE });
  return { state: next, id: drone.id };
}

test('the drone climbs, drifts down, and is gone at the water', () => {
  let { state, id } = launchDrone(createInitialState(SEED, rules));
  let up = state.units.find((u) => u.id === id);
  assert.equal(up.state, UNIT_ACTIVE);
  const ceiling = up.ceiling;
  let peak = 0;
  let ticks = 0;
  while (ticks < 5000 && state.units.find((u) => u.id === id).state === UNIT_ACTIVE) {
    state = apply(state, TICK);
    const z = state.units.find((u) => u.id === id).z;
    if (z > peak) peak = z;
    ticks += 1;
  }
  assert.ok(peak >= ceiling - 256, 'it never reached its ceiling');
  assert.equal(state.units.find((u) => u.id === id).state, UNIT_LOST,
    'the aerostat should end in the sea');
  assert.doesNotThrow(() => canonicalize(state));
});

test('no drone, no shot; a drone with the mark in view walks a missile onto it', () => {
  let state = createInitialState(SEED, rules);
  const ship = state.carriers[0];
  const mark = { x: ship.x + 3000 * 256, y: ship.y };

  // Blind: refused outright.
  const rounds = ship.hammerRounds;
  state = apply(state, { type: 'fire_hammerhead', carrierId: 0, x: mark.x, y: mark.y });
  assert.equal(state.carriers[0].hammerRounds, rounds, 'a blind battery fired');

  // Eye up, mark in view: away it goes.
  const launched = launchDrone(state);
  state = launched.state;
  const eye = state.units.find((u) => u.id === launched.id);
  eye.x = mark.x - 1000 * 256;
  eye.y = mark.y;
  state = apply(state, { type: 'fire_hammerhead', carrierId: 0, x: mark.x, y: mark.y });
  assert.equal(state.carriers[0].hammerRounds, rounds - 1, 'the shot never left the rail');
  assert.ok(state.carriers[0].hammerCooldown > 0);
  assert.equal(state.shots.length, 1);

  // The launcher is reloading: a second press is refused.
  state = apply(state, { type: 'fire_hammerhead', carrierId: 0, x: mark.x, y: mark.y });
  assert.equal(state.carriers[0].hammerRounds, rounds - 1);
});

test('the round detonates AT the mark and takes an emplacement with it', () => {
  let state = createInitialState(SEED, rules);
  const ship = state.carriers[0];
  // An enemy battery 3 km east, in the open.
  const island = state.islands[0];
  island.owner = 1;
  island.role = ROLE_DEFENCE;
  const turret = raiseTurret(state, island);
  turret.x = ship.x + 3000 * 256;
  turret.y = ship.y;
  turret.z = 0;
  island.turrets = 1;

  const launched = launchDrone(state);
  state = launched.state;
  const eye = state.units.find((u) => u.id === launched.id);
  eye.x = turret.x;
  eye.y = turret.y;
  state = apply(state, { type: 'fire_hammerhead', carrierId: 0, x: turret.x, y: turret.y });
  let ticks = 0;
  while (ticks < 2000 && state.shots.length > 0) {
    state = apply(state, TICK);
    // Hold the eye aloft and in place: the shot needs no further help, but
    // the drone drifting into the sea mid-test would end the run early.
    const held = state.units.find((u) => u.id === launched.id);
    if (held.state === UNIT_ACTIVE) { held.x = turret.x; held.y = turret.y; }
    ticks += 1;
  }
  const target = state.turrets.find((t) => t.id === turret.id);
  assert.ok(target.hp < target.maxHp, 'the blast never reached the battery');
  assert.doesNotThrow(() => canonicalize(state));
});
