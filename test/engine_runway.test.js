// Island runways (manual coverage review, item 2): Resource and Defence
// islands can build a strip; a Manta lands on it, refuels from the island's
// OWN fuel stock, and relaunches on any new order. Island-hopping is the
// original's range game, and with the telemetry leash it matters twice.

import test from 'node:test';
import assert from 'node:assert/strict';

import { loadRules, withoutAi, bareRules } from './helpers/rules.mjs';
import { createInitialState } from '../engine/state.js';
import { apply } from '../engine/reducer.js';
import { canonicalize } from '../shared/statehash.js';
import { KIND_MANTA, ORDER_MOVE, UNIT_ACTIVE, UNIT_LANDED, UNIT_LOST } from '../engine/units.js';

const rules = bareRules();
const TICK = { type: 'advance_tick' };
const SEED = 20260818;
const BUILD_RUNWAY = 6;

function drive(state, ticks) {
  for (let i = 0; i < ticks; i++) state = apply(state, TICK);
  return state;
}

function nearestIslandId(state) {
  const ship = state.carriers[0];
  let best = 0;
  let bestD = 2147483647;
  for (const island of state.islands) {
    const dx = island.x - ship.x;
    const dy = island.y - ship.y;
    const d = dx * dx + dy * dy;
    if (d < bestD) { bestD = d; best = island.id; }
  }
  return best;
}

// An owned resource island with a finished runway and fuel on the ground.
function withRunway(state, islandId, owner) {
  const island = state.islands[islandId];
  island.owner = owner;
  island.role = 0; // ROLE_RESOURCE
  island.runway = 1;
  island.stockFuel = 50000;
  return island;
}

test('a runway is Resource and Defence work, never the factory floor', () => {
  let state = createInitialState(SEED, rules);
  const mine = state.islands[0];
  mine.owner = 0;
  mine.role = 0;
  mine.stockMaterials = 5000;
  state = apply(state, { type: 'build_on_island', carrierId: 0, islandId: 0, what: BUILD_RUNWAY });
  assert.equal(state.islands[0].building, BUILD_RUNWAY, 'the mine refused its strip');
  state = drive(state, state.economy.builds[BUILD_RUNWAY].ticks + 1);
  assert.equal(state.islands[0].runway, 1, 'the strip never finished');

  const plant = state.islands[1];
  plant.owner = 0;
  plant.role = 1; // ROLE_FACTORY
  plant.factories = 1;
  plant.stockMaterials = 5000;
  state = apply(state, { type: 'build_on_island', carrierId: 0, islandId: 1, what: BUILD_RUNWAY });
  assert.equal(state.islands[1].building, -1, 'the factory poured a strip');
});

test('a Manta lands, drinks the island fuel, and relaunches on a new order', () => {
  let state = createInitialState(SEED, rules);
  const island = withRunway(state, nearestIslandId(state), 0);
  const manta = state.units.find((u) => u.team === 0 && u.kind === KIND_MANTA);
  state = apply(state, { type: 'launch_unit', carrierId: 0, kind: KIND_MANTA });
  // A third of a tank: enough to arrive, low enough that the refuel shows.
  const tank = state.units.find((u) => u.id === manta.id);
  tank.fuel = Math.floor(tank.fuelCapacity / 3);
  const fuelAtLanding = tank.fuel;
  state = apply(state, { type: 'order_unit_land', unitId: manta.id, islandId: island.id });

  let ticks = 0;
  while (ticks < 120000 && state.units.find((u) => u.id === manta.id).state !== UNIT_LANDED) {
    state = apply(state, TICK);
    ticks += 1;
  }
  const down = state.units.find((u) => u.id === manta.id);
  assert.equal(down.state, UNIT_LANDED, 'the approach never ended');
  assert.equal(down.landedIsland, island.id);

  const stockBefore = state.islands[island.id].stockFuel;
  state = drive(state, 400);
  const parked = state.units.find((u) => u.id === manta.id);
  assert.ok(parked.fuel > fuelAtLanding - parked.fuelCapacity, 'sanity');
  assert.ok(parked.fuel > Math.floor(parked.fuelCapacity / 3) - 20000, 'the island never refuelled it');
  assert.ok(state.islands[island.id].stockFuel < stockBefore, 'the fuel was conjured');
  assert.equal(parked.telemetry, undefined, 'state fields do not carry view fields');

  // Any new order is a relaunch.
  state = apply(state, {
    type: 'order_unit_move', unitId: manta.id,
    x: parked.x + 2000 * 256, y: parked.y,
  });
  const up = state.units.find((u) => u.id === manta.id);
  assert.equal(up.state, UNIT_ACTIVE, 'the runway kept the aircraft');
  assert.equal(up.landedIsland, -1);
  assert.equal(up.order, ORDER_MOVE);
  assert.doesNotThrow(() => canonicalize(state));
});

test('an enemy strip refuses the approach, and losing the island costs the parked hull', () => {
  let state = createInitialState(SEED, rules);
  const theirs = withRunway(state, 0, 1);
  const manta = state.units.find((u) => u.team === 0 && u.kind === KIND_MANTA);
  state = apply(state, { type: 'launch_unit', carrierId: 0, kind: KIND_MANTA });
  state = apply(state, { type: 'order_unit_land', unitId: manta.id, islandId: theirs.id });
  assert.notEqual(state.units.find((u) => u.id === manta.id).order, 7,
    'cleared to land on an ENEMY island');

  // Park on our own strip, then lose the island: the aircraft goes with it.
  const near = nearestIslandId(state);
  const ours = withRunway(state, near === 0 ? 1 : near, 0);
  state = apply(state, { type: 'order_unit_land', unitId: manta.id, islandId: ours.id });
  let ticks = 0;
  while (ticks < 120000 && state.units.find((u) => u.id === manta.id).state !== UNIT_LANDED) {
    state = apply(state, TICK);
    ticks += 1;
  }
  assert.equal(state.units.find((u) => u.id === manta.id).state, UNIT_LANDED);
  state.islands[ours.id].owner = 1;
  state = apply(state, TICK);
  assert.equal(state.units.find((u) => u.id === manta.id).state, UNIT_LOST,
    'a captured airfield should capture what sits on it');
});

// --- a refused order must leave the hull exactly as it found it (R-001) ---
//
// `reject(next)` pushes the rejection event and returns the state it was
// handed - it does not roll anything back. So an order that mutated before it
// checked mutated for good, and three of them did: move, attack and escort
// all called `liftOff` first and only then ran the test that could refuse.
// The visible bug was a parked Manta taking off and flying its previous order
// while the interface said the order was refused.

function parkedManta(seed) {
  let state = createInitialState(seed, rules);
  const island = withRunway(state, nearestIslandId(state), 0);
  const manta = state.units.find((u) => u.team === 0 && u.kind === KIND_MANTA);
  state = apply(state, { type: 'launch_unit', carrierId: 0, kind: KIND_MANTA });
  state = apply(state, { type: 'order_unit_land', unitId: manta.id, islandId: island.id });
  let ticks = 0;
  while (ticks < 120000 && state.units.find((u) => u.id === manta.id).state !== UNIT_LANDED) {
    state = apply(state, TICK);
    ticks += 1;
  }
  assert.equal(state.units.find((u) => u.id === manta.id).state, UNIT_LANDED,
    'the Manta never got down, so this test proves nothing');
  return { state: state, id: manta.id, islandId: island.id };
}

test('a refused move leaves a parked Manta parked', () => {
  const { state, id, islandId } = parkedManta(SEED);
  const off = state.params.sizeUnits + 1;
  const after = apply(state, { type: 'order_unit_move', unitId: id, x: off, y: 0 });
  const unit = after.units.find((u) => u.id === id);
  assert.equal(unit.state, UNIT_LANDED, 'a refused move took the aircraft off the runway');
  assert.equal(unit.landedIsland, islandId, 'a refused move forgot which island it was on');
});

test('a refused attack leaves a parked Manta parked', () => {
  const { state, id, islandId } = parkedManta(SEED);
  // A unit id nothing owns: the classic stale click on a contact that has
  // just gone.
  const after = apply(state, {
    type: 'order_unit_attack', unitId: id, targetKind: 0, targetId: 9999,
  });
  const unit = after.units.find((u) => u.id === id);
  assert.equal(unit.state, UNIT_LANDED, 'a refused attack took the aircraft off the runway');
  assert.equal(unit.landedIsland, islandId, 'a refused attack forgot which island it was on');
});

test('a refused escort leaves the lighter alone', () => {
  // The escort refusal is the lighter's, and the boat is never landed - but
  // the same ordering bug applied, so the guard belongs here too.
  let state = createInitialState(SEED, rules);
  state = apply(state, { type: 'launch_supply', carrierId: 0 });
  const boat = state.units.find((u) => u.team === 0 && u.kind === 2);
  assert.notEqual(boat, undefined, 'no lighter afloat to refuse');
  const before = boat.order;
  const after = apply(state, { type: 'order_unit_escort', unitId: boat.id });
  const now = after.units.find((u) => u.id === boat.id);
  assert.equal(now.order, before, 'a refused escort changed the boat\'s orders');
});
