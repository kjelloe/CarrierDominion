// The logistics boat. Ruling #3: fuel reaches a hull by being carried there,
// not by proximity to a friendly flag.

import test from 'node:test';
import assert from 'node:assert/strict';

import { loadRules, withoutAi, bareRules } from './helpers/rules.mjs';
import { createInitialState } from '../engine/state.js';
import { apply } from '../engine/reducer.js';
import { canonicalize } from '../shared/statehash.js';
import { dist2D } from '../shared/fixed.js';
import { worldHeightAt } from '../engine/heightmap.js';
import { lighterFor, loadingStation } from '../engine/supply.js';
import {
  KIND_LIGHTER, ORDER_DELIVER, ORDER_LOAD, ORDER_RETURN, UNIT_STOWED,
} from '../engine/units.js';
import { EVT_SUPPLY_DELIVERED, EVT_SUPPLY_LOADED, EVT_SUPPLY_RUN } from '../engine/events.js';
import { KIND_RESOURCE } from '../engine/worldgen.js';

const rules = bareRules();
const TICK = { type: 'advance_tick' };
const SEED = 20260818;

function drive(state, ticks) {
  for (let i = 0; i < ticks; i++) state = apply(state, TICK);
  return state;
}

function driveUntil(state, ticks, predicate) {
  for (let i = 0; i < ticks; i++) {
    state = apply(state, TICK);
    if (predicate(state)) return { state: state, ticks: i + 1, met: true };
  }
  return { state: state, ticks: ticks, met: false };
}

// A depot island stocked with fuel, and the carrier lying a short way off it.
// Real runs take thousands of ticks; the distance is not what these tests are
// checking, the cargo handling is.
function stockedDepot(fuel = 40000, materials = 0) {
  const state = createInitialState(SEED, rules);
  const depot = state.islands[0];
  depot.owner = 0;
  depot.kind = KIND_RESOURCE;
  depot.stockFuel = fuel;
  depot.stockMaterials = materials;
  state.teams[0].stockpileIsland = depot.id;

  const carrier = state.carriers[0];
  const standOff = depot.radius * 2;
  carrier.x = depot.x;
  carrier.y = depot.y - standOff;
  carrier.fuel = 20000;
  return { state: state, depot: depot, carrier: carrier };
}

test('a carrier starts with no supply run and launches nothing', () => {
  const { state } = stockedDepot();
  const after = drive(state, 400);
  assert.equal(after.carriers[0].supplyRun, 0);
  assert.equal(lighterFor(after, 0), -1, 'a boat went out with no orders');
});

test('ordering a supply run puts a lighter in the water', () => {
  let { state } = stockedDepot();
  state = apply(state, { type: 'set_supply_run', carrierId: 0, active: 1 });
  assert.equal(state.carriers[0].supplyRun, 1);
  assert.ok(state.events.some((e) => e.code === EVT_SUPPLY_RUN));

  state = drive(state, 2);
  const boat = lighterFor(state, 0);
  assert.notEqual(boat, -1, 'no lighter launched');
  assert.equal(boat.kind, KIND_LIGHTER);
  assert.equal(boat.order, ORDER_LOAD);
  assert.ok(worldHeightAt(state.islands, boat.x, boat.y) < 0, 'a boat launched onto dry land');
});

test('the loading station is on the water, between the island and the ship', () => {
  const { state, depot, carrier } = stockedDepot();
  const station = loadingStation(depot, carrier);
  assert.ok(worldHeightAt(state.islands, station.x, station.y) < 0, 'the station is ashore');
  assert.ok(
    dist2D(station.x, station.y, depot.x, depot.y) > depot.radius,
    'the station is inside the island',
  );
  // It is on the carrier's side of the island, so the run is as short as it can be.
  assert.ok(station.y < depot.y, 'the station should face the ship');
});

test('a lighter loads fuel at the depot and carries it away', (t) => {
  let { state } = stockedDepot();
  state = apply(state, { type: 'set_supply_run', carrierId: 0, active: 1 });
  const run = driveUntil(state, 60000, (s) => s.events.some((e) => e.code === EVT_SUPPLY_LOADED));
  assert.ok(run.met, 'the boat never loaded');
  t.diagnostic(`loaded after ${run.ticks} ticks`);
  const boat = lighterFor(run.state, 0);
  assert.ok(boat.cargoFuel > 0, 'sailed with an empty hold');
  assert.equal(boat.order, ORDER_DELIVER);
  assert.ok(run.state.islands[0].stockFuel < 40000, 'the depot did not part with anything');
});

test('a full round trip moves fuel from the island into the hull', (t) => {
  let { state } = stockedDepot();
  const fuelBefore = state.carriers[0].fuel;
  const depotBefore = state.islands[0].stockFuel;
  state = apply(state, { type: 'set_supply_run', carrierId: 0, active: 1 });

  const run = driveUntil(state, 120000, (s) => s.events.some((e) => e.code === EVT_SUPPLY_DELIVERED));
  assert.ok(run.met, 'the boat never delivered');
  t.diagnostic(`round trip in ${run.ticks} ticks`);
  state = run.state;
  assert.ok(state.carriers[0].fuel > fuelBefore, 'the hull took nothing aboard');
  assert.ok(state.islands[0].stockFuel < depotBefore, 'the fuel came from nowhere');
  assert.doesNotThrow(() => canonicalize(state));
});

test('materials in the hold reach the yard, and the yard mends the ship', (t) => {
  let { state } = stockedDepot(0, 40000);
  state.carriers[0].hull = state.carriers[0].maxHull - 300;
  state = apply(state, { type: 'set_supply_run', carrierId: 0, active: 1 });

  const run = driveUntil(state, 120000, (s) => s.events.some((e) => e.code === EVT_SUPPLY_DELIVERED));
  assert.ok(run.met, 'the boat never delivered');
  t.diagnostic(`repairs landed after ${run.ticks} ticks`);
  assert.ok(run.state.carriers[0].hull > run.state.carriers[0].maxHull - 300, 'nothing was repaired');
  assert.ok(run.state.carriers[0].hull <= run.state.carriers[0].maxHull, 'repaired past new');
  // The boat's job ends at the store; the automatic repair system spends it.
  assert.ok(run.state.carriers[0].materials >= 0);
  assert.ok(run.state.carriers[0].materialsCapacity > 0);
});

test('the run keeps cycling until it is called off', (t) => {
  let { state } = stockedDepot();
  state = apply(state, { type: 'set_supply_run', carrierId: 0, active: 1 });
  let deliveries = 0;
  const run = driveUntil(state, 200000, (s) => {
    for (const event of s.events) if (event.code === EVT_SUPPLY_DELIVERED) deliveries += 1;
    return deliveries >= 2;
  });
  assert.ok(run.met, `only ${deliveries} deliveries - the boat stopped after one`);
  t.diagnostic(`two deliveries by tick ${run.state.tick}`);

  state = apply(run.state, { type: 'set_supply_run', carrierId: 0, active: 0 });
  const home = driveUntil(state, 60000, (s) => {
    const boat = lighterFor(s, 0);
    return boat === -1;
  });
  assert.ok(home.met, 'the boat never came home after the run was called off');
  const stowed = home.state.units.filter((u) => u.kind === KIND_LIGHTER && u.state === UNIT_STOWED);
  assert.ok(stowed.length > 0);
});

test('no depot means no run, however loudly it is ordered', () => {
  let { state } = stockedDepot();
  state.teams[0].stockpileIsland = -1;
  state.islands[0].owner = -1; // and nothing to auto-nominate
  state = apply(state, { type: 'set_supply_run', carrierId: 0, active: 1 });
  state = drive(state, 500);
  assert.equal(lighterFor(state, 0), -1, 'a boat sailed for a depot that does not exist');
});

test('a lighter never goes ashore', () => {
  let { state } = stockedDepot();
  state = apply(state, { type: 'set_supply_run', carrierId: 0, active: 1 });
  for (let i = 0; i < 30000; i++) {
    state = apply(state, TICK);
    const boat = lighterFor(state, 0);
    if (boat === -1) continue;
    assert.ok(
      worldHeightAt(state.islands, boat.x, boat.y) <= 0,
      `a boat drove up the beach at tick ${state.tick}`,
    );
    assert.equal(boat.z, 0, 'a boat should float, not climb');
  }
});

test('supply runs are private to the team running them', () => {
  let { state } = stockedDepot();
  state = apply(state, { type: 'set_supply_run', carrierId: 0, active: 1 });
  const mine = state.events.filter((e) => e.code === EVT_SUPPLY_RUN);
  assert.equal(mine.length, 1);
  assert.equal(mine[0].b, 0);
});

test('the other team cannot order our boats about', () => {
  let { state } = stockedDepot();
  state = apply(state, { type: 'set_supply_run', carrierId: 1, active: 1 });
  assert.equal(state.carriers[1].supplyRun, 1, 'the reducer itself does not police teams');
  // Authority does, and that is tested in client_pure.test.js against
  // checkAuthority - the reducer trusts what the server has already vetted.
  assert.equal(state.carriers[0].supplyRun, 0);
});

test('a depot with parts launches a replacement boat when every one is lost', (t) => {
  let { state, depot } = stockedDepot(40000, 0);
  depot.stockChassis = state.economy.chassisPerHull * 2;
  // Every boat gone: without a boat the parts to build a boat can never arrive,
  // which is a deadlock the depot is there to break.
  for (const unit of state.units) {
    if (unit.kind === KIND_LIGHTER && unit.carrierId === 0) {
      unit.state = 3; // UNIT_LOST
      unit.hp = 0;
    }
  }
  state = apply(state, { type: 'set_supply_run', carrierId: 0, active: 1 });

  const run = driveUntil(state, 4000, (s) => lighterFor(s, 0) !== -1);
  assert.ok(run.met, 'the depot never sent a boat out');
  t.diagnostic(`boat afloat again after ${run.ticks} ticks`);
  const boat = lighterFor(run.state, 0);
  assert.ok(boat.hp > 0);
  assert.ok(boat.fuel > 0, 'it was launched with dry tanks');
  assert.equal(
    run.state.islands[depot.id].stockChassis,
    state.economy.chassisPerHull,
    'the parts were not paid for',
  );

  // And it does not keep building boats it does not need.
  const after = drive(run.state, 3000);
  const afloat = after.units.filter((u) => u.kind === KIND_LIGHTER && u.state !== 3 && u.state !== 0);
  assert.ok(afloat.length <= 1, 'the depot built a fleet of spares');
});

// The deck cycle (2026-08-26) put a window between "ordered up" and "afloat"
// that the supply run had never had to think about. Two things live in it.
// The bare ocean turns the deck cycle off and owns no islands; these two
// tests are about the cycle AND need somewhere to run to, so they put the
// ruleset's own timings back and stock a depot the same way stockedDepot
// does.
function withDeck() {
  const real = loadRules();
  const deckRules = {
    ...rules,
    rules: {
      ...rules.rules,
      deckRangeTicks: real.rules.deckRangeTicks,
      launchTicks: real.rules.launchTicks,
      dockTicks: real.rules.dockTicks,
    },
  };
  const state = createInitialState(SEED, deckRules);
  const depot = state.islands[0];
  depot.owner = 0;
  depot.kind = KIND_RESOURCE;
  depot.stockFuel = 40000;
  state.teams[0].stockpileIsland = depot.id;
  const carrier = state.carriers[0];
  carrier.x = depot.x;
  carrier.y = depot.y - depot.radius * 2;
  carrier.fuel = 20000;
  return state;
}

test('a boat ordered up is not ordered up again on every tick of the cycle', () => {
  let state = withDeck();
  state.carriers[0].supplyRun = 1;
  const before = state.units.filter((u) => u.kind === KIND_LIGHTER
    && u.carrierId === 0 && u.state === UNIT_STOWED).length;
  // Right through the cycle: exactly ONE boat should leave, however many
  // ticks the run gets to look at an empty sea.
  for (let i = 0; i < state.params.deckRangeTicks + state.params.launchTicks + 20; i++) {
    state = apply(state, TICK);
  }
  const afloat = state.units.filter((u) => u.kind === KIND_LIGHTER
    && u.carrierId === 0 && u.state !== UNIT_STOWED).length;
  assert.equal(afloat, 1, `${afloat} boats went out for one run`);
  assert.ok(before >= 1, 'no boat was aboard to send');
});

test('a run that stands down while the boat is still on the ramp does not maroon her', () => {
  let state = withDeck();
  state.carriers[0].supplyRun = 1;
  // Far enough for her to be afloat and idle - the order used to be given at
  // the moment of launch, so this state could not exist.
  for (let i = 0; i < state.params.deckRangeTicks + state.params.launchTicks + 4; i++) {
    state = apply(state, TICK);
  }
  const boat = state.units.find((u) => u.kind === KIND_LIGHTER && u.carrierId === 0
    && u.state !== UNIT_STOWED);
  assert.notEqual(boat, undefined, 'no boat went out at all');

  state.carriers[0].supplyRun = 0;
  // She is called home at once and, being alongside, is aboard shortly after.
  state = apply(state, TICK);
  const called = state.units.find((u) => u.id === boat.id);
  assert.equal(called.order, ORDER_RETURN, 'nobody called the idle boat home');

  for (let i = 0; i < 2000; i++) state = apply(state, TICK);
  const now = state.units.find((u) => u.id === boat.id);
  assert.equal(now.state, UNIT_STOWED,
    'the boat was left at sea with no run to belong to');
});
