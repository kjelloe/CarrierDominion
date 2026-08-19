import test from 'node:test';
import assert from 'node:assert/strict';

import { loadRules, withoutAi } from './helpers/rules.mjs';
import { createInitialState } from '../engine/state.js';
import { apply } from '../engine/reducer.js';
import { dist2D, mulDiv } from '../shared/fixed.js';
import { worldHeightAt } from '../engine/heightmap.js';
import { EVT_CARRIER_GROUNDED } from '../engine/events.js';
import { canonicalize } from '../shared/statehash.js';

// No AI: several of these tests use the second carrier as an idle control.
const rules = withoutAi(loadRules());
const TICK = { type: 'advance_tick' };
const SEED = 20260818;

function drive(state, ticks) {
  for (let i = 0; i < ticks; i++) state = apply(state, TICK);
  return state;
}

test('a carrier at rest stays at rest', () => {
  let state = createInitialState(SEED, rules);
  const startX = state.carriers[0].x;
  const startY = state.carriers[0].y;
  state = drive(state, 100);
  assert.equal(state.carriers[0].x, startX);
  assert.equal(state.carriers[0].y, startY);
  assert.equal(state.carriers[0].speed, 0);
});

test('full throttle reaches exactly the rated speed and no more', () => {
  let state = createInitialState(SEED, rules);
  state = apply(state, { type: 'set_throttle', carrierId: 0, throttle: 100 });
  state = drive(state, 200);
  assert.equal(state.carriers[0].speed, rules.units.carrier.maxSpeedUnitsPerTick);
});

test('half throttle settles at half speed', () => {
  let state = createInitialState(SEED, rules);
  state = apply(state, { type: 'set_throttle', carrierId: 0, throttle: 50 });
  state = drive(state, 200);
  const expected = mulDiv(rules.units.carrier.maxSpeedUnitsPerTick, 50, 100);
  assert.equal(state.carriers[0].speed, expected);
});

test('1000 ticks of steaming covers the distance the speed implies', () => {
  let state = createInitialState(SEED, rules);
  const start = state.carriers[0];
  const startX = start.x;
  const startY = start.y;
  state = apply(state, { type: 'set_heading', carrierId: 0, heading: 0 });
  state = apply(state, { type: 'set_throttle', carrierId: 0, throttle: 100 });
  state = drive(state, 1000);
  const carrier = state.carriers[0];
  assert.equal(carrier.grounded, 0, 'the eastward lane from the start corner should be clear');
  const travelled = dist2D(startX, startY, carrier.x, carrier.y);
  const cruise = rules.units.carrier.maxSpeedUnitsPerTick;
  // 53 ticks are spent accelerating at 1 unit/tick^2, so the run is a little
  // short of 1000 * cruise; it must never be longer.
  assert.ok(travelled <= 1000 * cruise, `travelled ${travelled} > ${1000 * cruise}`);
  assert.ok(travelled > 940 * cruise, `travelled only ${travelled}`);
  assert.ok(Number.isInteger(carrier.x) && Number.isInteger(carrier.y));
});

test('a held heading is reached and then kept', () => {
  let state = createInitialState(SEED, rules);
  state = apply(state, { type: 'set_throttle', carrierId: 0, throttle: 60 });
  state = apply(state, { type: 'set_heading', carrierId: 0, heading: 30000 });
  state = drive(state, 2000);
  assert.equal(state.carriers[0].heading, 30000);
  state = drive(state, 50);
  assert.equal(state.carriers[0].heading, 30000);
});

test('rudder turns at the rated rate and wraps cleanly', () => {
  let state = createInitialState(SEED, rules);
  const turnRate = rules.units.carrier.turnRateBamPerTick;
  const start = state.carriers[0].heading;
  state = apply(state, { type: 'set_rudder', carrierId: 0, rudder: -1 });
  state = drive(state, 10);
  assert.equal(state.carriers[0].heading, ((start - 10 * turnRate) % 65536 + 65536) % 65536);
  state = drive(state, 65536);
  assert.ok(state.carriers[0].heading >= 0 && state.carriers[0].heading < 65536);
});

test('fuel drains under way and never goes negative', () => {
  let state = createInitialState(SEED, rules);
  const capacity = rules.units.carrier.fuelCapacity;
  state = apply(state, { type: 'set_throttle', carrierId: 0, throttle: 100 });
  state = drive(state, 1000);
  const spent = capacity - state.carriers[0].fuel;
  assert.equal(spent, mulDiv(rules.units.carrier.fuelBurnFullPer100Ticks, 1000, 100));
  // Idling burns too, but far less.
  const idler = state.carriers[1];
  assert.ok(capacity - idler.fuel > 0, 'idle burn should be non-zero');
  assert.ok(capacity - idler.fuel < spent / 5, 'idle burn should be far below full burn');
});

test('an empty tank stops the ship', () => {
  let state = createInitialState(SEED, rules);
  state.carriers[0].fuel = 3;
  state = apply(state, { type: 'set_throttle', carrierId: 0, throttle: 100 });
  state = drive(state, 400);
  assert.equal(state.carriers[0].fuel, 0);
  assert.equal(state.carriers[0].speed, 0);
});

test('a carrier driven at an island grounds instead of sailing through it', () => {
  let state = createInitialState(SEED, rules);
  const carrier = state.carriers[0];
  const island = state.islands[0];
  carrier.x = island.x;
  carrier.y = island.y - island.radius * 2;
  carrier.heading = 16384; // straight at the island
  state = apply(state, { type: 'set_throttle', carrierId: 0, throttle: 100 });

  let grounded = false;
  for (let i = 0; i < 40000 && !grounded; i++) {
    state = apply(state, TICK);
    if (state.carriers[0].grounded === 1) grounded = true;
  }
  assert.ok(grounded, 'never grounded');
  assert.equal(state.carriers[0].speed, 0);
  const depth = worldHeightAt(state.islands, state.carriers[0].x, state.carriers[0].y);
  assert.ok(depth <= -state.carriers[0].draught, 'the hull itself must stay in deep water');
});

test('grounding reports exactly once per contact', () => {
  let state = createInitialState(SEED, rules);
  const carrier = state.carriers[0];
  const island = state.islands[0];
  carrier.x = island.x;
  carrier.y = island.y - island.radius * 2;
  carrier.heading = 16384;
  state = apply(state, { type: 'set_throttle', carrierId: 0, throttle: 100 });

  let reports = 0;
  let sinceContact = 0;
  for (let i = 0; i < 40000; i++) {
    state = apply(state, TICK);
    for (const event of state.events) if (event.code === EVT_CARRIER_GROUNDED) reports += 1;
    if (reports > 0) sinceContact += 1;
    // Keep the throttle pinned for another 500 ticks after the first contact:
    // a carrier held against the shore must not re-report every tick.
    if (sinceContact > 500) break;
  }
  assert.equal(reports, 1, `grounded event fired ${reports} times`);
});

test('the state stays hygienic after a long run', () => {
  let state = createInitialState(SEED, rules);
  state = apply(state, { type: 'set_throttle', carrierId: 0, throttle: 100 });
  state = apply(state, { type: 'set_rudder', carrierId: 0, rudder: 1 });
  state = apply(state, { type: 'set_throttle', carrierId: 1, throttle: 35 });
  state = drive(state, 1000);
  assert.doesNotThrow(() => canonicalize(state));
});
