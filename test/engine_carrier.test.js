import test from 'node:test';
import assert from 'node:assert/strict';

import { loadRules, withoutAi } from './helpers/rules.mjs';
import { createInitialState } from '../engine/state.js';
import { apply } from '../engine/reducer.js';
import { dist2D, mulDiv } from '../shared/fixed.js';
import { worldHeightAt } from '../engine/heightmap.js';
import { clearanceAt, shoalLimit } from '../engine/carrier.js';
import { EVT_CARRIER_DAMAGED, EVT_CARRIER_GROUNDED, EVT_CARRIER_SUNK } from '../engine/events.js';
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

test('shoaling water slows the ship before it hits anything', () => {
  let state = createInitialState(SEED, rules);
  const carrier = state.carriers[0];
  const island = state.islands[0];
  // Park it on the shelf, well outside the shoreline but over shallow water.
  carrier.x = island.x;
  carrier.y = island.y - island.radius - 40 * 256;
  carrier.heading = 49152; // pointing away, so nothing blocks the bow
  state = apply(state, { type: 'set_throttle', carrierId: 0, throttle: 100 });
  state = drive(state, 300);

  const shoaled = state.carriers[0];
  assert.equal(shoaled.grounded, 0, 'this test is about slowing, not grounding');
  assert.ok(shoaled.speed > 0, 'it should still be making way');
  assert.ok(
    shoaled.speed < rules.units.carrier.maxSpeedUnitsPerTick,
    `full speed (${shoaled.speed}) over a shelf`,
  );
});

test('deep water imposes no speed limit at all', () => {
  const state = createInitialState(SEED, rules);
  const carrier = state.carriers[0];
  const deep = clearanceAt(state.islands, carrier.x, carrier.y, carrier.draught);
  assert.ok(deep > carrier.shallowBand, 'the spawn should be in deep water');
  assert.equal(shoalLimit(carrier, deep), carrier.maxSpeed);
});

test('the shoal limit falls off with the water under the keel', () => {
  const carrier = createInitialState(SEED, rules).carriers[0];
  const band = carrier.shallowBand;
  assert.equal(shoalLimit(carrier, band), carrier.maxSpeed);
  assert.ok(shoalLimit(carrier, band / 2) < carrier.maxSpeed);
  assert.ok(shoalLimit(carrier, band / 2) > shoalLimit(carrier, band / 8));
  // Never quite zero while there is water: a crawl is still steerage way.
  assert.equal(shoalLimit(carrier, 1), carrier.slowestSpeed);
  assert.equal(shoalLimit(carrier, 0), 0);
});

test('a carrier held aground grinds its hull down, and can be lost', () => {
  let state = createInitialState(SEED, rules);
  const carrier = state.carriers[0];
  const island = state.islands[0];
  carrier.x = island.x;
  carrier.y = island.y - island.radius * 2;
  carrier.heading = 16384;
  // A supplied ship out-repairs a gentle grounding (8 repair points per 100
  // ticks against the reef's 6): the reef costs materials instead of hull.
  // This test is about the grinding itself, so the yard stores are emptied.
  carrier.materials = 0;
  state = apply(state, { type: 'set_throttle', carrierId: 0, throttle: 100 });

  let ticks = 0;
  while (ticks < 40000 && state.carriers[0].grounded === 0) {
    state = apply(state, TICK);
    ticks += 1;
  }
  assert.equal(state.carriers[0].grounded, 1, 'never grounded');
  const hullOnContact = state.carriers[0].hull;

  // Damage lands as whole hull points every seventeenth tick or so, so the
  // report has to be collected across the run rather than read off the last
  // tick's event list.
  let damageReports = 0;
  for (let i = 0; i < 1000; i++) {
    state = apply(state, TICK);
    for (const event of state.events) if (event.code === EVT_CARRIER_DAMAGED) damageReports += 1;
  }
  const after = state.carriers[0];
  assert.ok(after.hull < hullOnContact, 'sitting on a reef cost nothing');
  const expected = mulDiv(rules.units.carrier.groundedHullPer100Ticks, 1000, 100);
  assert.ok(
    Math.abs(hullOnContact - after.hull - expected) <= 1,
    `lost ${hullOnContact - after.hull}, expected about ${expected}`,
  );
  assert.equal(damageReports, expected, 'one report per hull point lost');
});

test('a hull ground down to nothing sinks, once, and stops moving', () => {
  let state = createInitialState(SEED, rules);
  const carrier = state.carriers[0];
  const island = state.islands[0];
  carrier.x = island.x;
  carrier.y = island.y - island.radius * 2;
  carrier.heading = 16384;
  carrier.hull = 8;
  state = apply(state, { type: 'set_throttle', carrierId: 0, throttle: 100 });

  let sinkings = 0;
  for (let i = 0; i < 40000; i++) {
    state = apply(state, TICK);
    for (const event of state.events) if (event.code === EVT_CARRIER_SUNK) sinkings += 1;
    if (state.carriers[0].hull === 0) break;
  }
  assert.equal(state.carriers[0].hull, 0);
  assert.equal(sinkings, 1, `sank ${sinkings} times`);
  const restingPlace = { x: state.carriers[0].x, y: state.carriers[0].y };
  state = drive(state, 200);
  assert.equal(state.carriers[0].x, restingPlace.x, 'a sunk carrier is still under way');
  assert.equal(state.carriers[0].speed, 0);
});

test('clearing the shoal stops the damage', () => {
  let state = createInitialState(SEED, rules);
  const carrier = state.carriers[0];
  const island = state.islands[0];
  carrier.x = island.x;
  carrier.y = island.y - island.radius * 2;
  carrier.heading = 16384;
  state = apply(state, { type: 'set_throttle', carrierId: 0, throttle: 100 });
  let ticks = 0;
  while (ticks < 40000 && state.carriers[0].grounded === 0) {
    state = apply(state, TICK);
    ticks += 1;
  }
  assert.equal(state.carriers[0].grounded, 1);

  // Come about and steam off the shelf.
  state = apply(state, { type: 'set_heading', carrierId: 0, heading: 49152 });
  state = drive(state, 4000);
  assert.equal(state.carriers[0].grounded, 0, 'never got off');
  const hull = state.carriers[0].hull;
  state = drive(state, 1000);
  assert.equal(state.carriers[0].hull, hull, 'still taking damage in open water');
});

// --- The astern gear and the struck colours (manual coverage review) ---

test('the ship backs down at a quarter of her ahead speed, and burns for it', () => {
  let state = createInitialState(SEED, rules);
  const start = { x: state.carriers[0].x, y: state.carriers[0].y };
  state = apply(state, { type: 'set_throttle', carrierId: 0, throttle: -25 });
  assert.equal(state.carriers[0].throttle, -25);
  const fuelBefore = state.carriers[0].fuel;
  state = drive(state, 600);
  const ship = state.carriers[0];
  assert.ok(ship.speed < 0, 'no sternway was made');
  assert.ok(-ship.speed <= mulDiv(ship.maxSpeed, 25, 100) + 1, 'astern outran the gear');
  assert.ok(dist2D(ship.x, ship.y, start.x, start.y) > 0, 'the ship never moved');
  assert.ok(ship.fuel < fuelBefore, 'reversing burned nothing');
  assert.doesNotThrow(() => canonicalize(state));
});

test('a throttle past the gear stops is refused, ahead and astern', () => {
  let state = createInitialState(SEED, rules);
  state = apply(state, { type: 'set_throttle', carrierId: 0, throttle: -26 });
  assert.equal(state.carriers[0].throttle, 0, 'the gear went past full astern');
  state = apply(state, { type: 'set_throttle', carrierId: 0, throttle: 101 });
  assert.equal(state.carriers[0].throttle, 0);
});

test('a ship aground by the bow backs herself off the reef', () => {
  let state = createInitialState(SEED, rules);
  // Sail at the nearest island until grounded.
  const island = state.islands.reduce((a, b) => (
    dist2D(state.carriers[0].x, state.carriers[0].y, a.x, a.y)
      < dist2D(state.carriers[0].x, state.carriers[0].y, b.x, b.y) ? a : b));
  state = apply(state, {
    type: 'set_heading',
    carrierId: 0,
    heading: ((Math.atan2(island.y - state.carriers[0].y, island.x - state.carriers[0].x)
      / (Math.PI * 2)) * 65536 + 65536) % 65536 | 0,
  });
  state = apply(state, { type: 'set_throttle', carrierId: 0, throttle: 100 });
  let ticks = 0;
  while (ticks < 60000 && state.carriers[0].grounded === 0) {
    state = apply(state, TICK);
    ticks += 1;
  }
  assert.equal(state.carriers[0].grounded, 1, 'the ship never found the reef');
  // Full astern: the stern feels the water, not the bow, and she comes off.
  state = apply(state, { type: 'set_throttle', carrierId: 0, throttle: -25 });
  let free = 0;
  for (let i = 0; i < 4000 && free === 0; i++) {
    state = apply(state, TICK);
    if (state.carriers[0].grounded === 0 && state.carriers[0].speed < 0) free = 1;
  }
  assert.equal(free, 1, 'full astern could not back her off');
});

test('striking the colours scuttles the ship and ends a duel', () => {
  let state = createInitialState(SEED, rules);
  state = apply(state, { type: 'surrender', carrierId: 0 });
  assert.equal(state.carriers[0].hull, 0);
  assert.ok(state.events.some((e) => e.code === EVT_CARRIER_SUNK && e.b === 0));
  state = apply(state, TICK);
  assert.notEqual(state.phase, 0, 'the war outlived the only enemy');
  assert.equal(state.winner, 1, 'the OTHER side should take the war');
  // A second surrender is meaningless and refused.
  const again = apply(state, { type: 'surrender', carrierId: 1 });
  assert.equal(again.carriers[1].hull, again.carriers[1].maxHull);
});
