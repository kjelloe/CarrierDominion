// The pilot's vertical axis (playtest ruling 2026-08-22): a flown Manta
// climbs toward its ceiling, dives toward the wavetops, and holds what it has
// - and the no-crash terrain rule out-votes the stick either way.

import test from 'node:test';
import assert from 'node:assert/strict';

import { loadRules, withoutAi, bareRules } from './helpers/rules.mjs';
import { createInitialState } from '../engine/state.js';
import { apply } from '../engine/reducer.js';
import { canonicalize } from '../shared/statehash.js';
import { validateCommand } from '../engine/commands.js';
import { PILOT_FLOOR_UNITS, TERRAIN_CLEARANCE_UNITS, targetAltitudeFor } from '../engine/flight.js';
import { worldHeightAt } from '../engine/heightmap.js';
import { KIND_MANTA, UNIT_ACTIVE } from '../engine/units.js';

const rules = bareRules();
const TICK = { type: 'advance_tick' };
const SEED = 20260818;

// A piloted Manta over open water, well away from everything.
function flying() {
  const state = createInitialState(SEED, rules);
  const manta = state.units.find((u) => u.team === 0 && u.kind === KIND_MANTA);
  manta.state = UNIT_ACTIVE;
  manta.control = 0;
  manta.x = 2000 * 256;
  manta.y = 2000 * 256;
  manta.z = manta.cruiseAltitude;
  manta.throttle = 100;
  return { state: state, manta: manta };
}

function helm(state, manta, climb) {
  return apply(state, {
    type: 'set_unit_helm', unitId: manta.id, throttle: 100, rudder: 0, climb: climb,
  });
}

test('the stick climbs to the ceiling, dives to the wavetops, and holds in between', () => {
  let { state, manta } = { ...flying() };
  const id = manta.id;
  state = helm(state, manta, 1);
  for (let i = 0; i < 4000; i++) state = apply(state, TICK);
  let unit = state.units.find((u) => u.id === id);
  assert.equal(unit.z, unit.ceiling, 'full back stick never reached the ceiling');

  state = helm(state, unit, -1);
  for (let i = 0; i < 8000; i++) state = apply(state, TICK);
  unit = state.units.find((u) => u.id === id);
  assert.equal(unit.z, PILOT_FLOOR_UNITS, 'full forward stick never reached the wavetops');

  // Level the stick halfway through a climb: the nose holds that altitude.
  state = helm(state, unit, 1);
  for (let i = 0; i < 500; i++) state = apply(state, TICK);
  unit = state.units.find((u) => u.id === id);
  const held = unit.z;
  assert.ok(held > PILOT_FLOOR_UNITS && held < unit.ceiling, 'the test never caught it mid-climb');
  state = helm(state, unit, 0);
  for (let i = 0; i < 300; i++) state = apply(state, TICK);
  unit = state.units.find((u) => u.id === id);
  assert.equal(unit.z, held, 'a level stick did not hold altitude');
  assert.doesNotThrow(() => canonicalize(state));
});

test('a diving pilot is still carried over the rock - the no-crash ruling holds', () => {
  const state = createInitialState(SEED, rules);
  const island = state.islands[0];
  island.peak = 700 * 256;
  const manta = state.units.find((u) => u.team === 0 && u.kind === KIND_MANTA);
  manta.state = UNIT_ACTIVE;
  manta.control = 0;
  manta.climb = -1; // stick hard forward, straight at the summit
  manta.x = island.x;
  manta.y = island.y;
  manta.z = manta.cruiseAltitude;

  const ground = worldHeightAt(state.islands, manta.x, manta.y);
  assert.ok(ground > PILOT_FLOOR_UNITS, 'the test island has no rock to argue with');
  const wanted = targetAltitudeFor(manta, state.islands, state.params.sizeUnits);
  assert.ok(wanted >= ground + TERRAIN_CLEARANCE_UNITS,
    'the stick out-voted the mountain');
});

test('climb is optional on the wire, and out-of-range climbs are refused', () => {
  assert.equal(validateCommand({
    type: 'set_unit_helm', unitId: 0, throttle: 50, rudder: 0,
  }), '', 'a helm command from before pitch existed must still replay');
  assert.match(validateCommand({
    type: 'set_unit_helm', unitId: 0, throttle: 50, rudder: 0, climb: 2,
  }), /climb/);

  // Handing back the controls levels the stick.
  let { state, manta } = { ...flying() };
  state = helm(state, manta, 1);
  state = apply(state, { type: 'release_control', unitId: manta.id });
  assert.equal(state.units.find((u) => u.id === manta.id).climb, 0);
});
