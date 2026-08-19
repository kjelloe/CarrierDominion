import test from 'node:test';
import assert from 'node:assert/strict';

import { loadRules, withoutAi } from './helpers/rules.mjs';
import { createInitialState, copyState } from '../engine/state.js';
import { apply } from '../engine/reducer.js';
import { canonicalize } from '../shared/statehash.js';
import { buildView } from '../shared/view.js';
import { teamHoldings } from '../engine/economy.js';
import { KIND_FACTORY, KIND_FORTRESS, KIND_RADAR, KIND_RESOURCE } from '../engine/worldgen.js';
import { EVT_STOCKPILE_SET } from '../engine/events.js';

const rules = withoutAi(loadRules());
const econ = loadRules().economy;
const TICK = { type: 'advance_tick' };
const SEED = 20260818;
const EVERY = econ.incomeEveryTicks;

function fresh() {
  return createInitialState(SEED, rules);
}

function drive(state, ticks) {
  for (let i = 0; i < ticks; i++) state = apply(state, TICK);
  return state;
}

// Give a team one island of a chosen kind and nothing else, so a test can
// watch a single link of the chain in isolation.
function soleIsland(state, team, kind) {
  const island = state.islands[0];
  island.owner = team;
  island.kind = kind;
  return island;
}

test('nobody starts with stores: what you have is what your islands hold', () => {
  const state = fresh();
  for (const team of state.teams) {
    assert.deepEqual(Object.keys(team).sort(), ['id', 'stockpileIsland']);
    assert.equal(team.stockpileIsland, -1);
    assert.deepEqual(teamHoldings(state, team.id), { fuel: 0, materials: 0, ordnance: 0 });
  }
  for (const island of state.islands) {
    assert.equal(island.stockFuel, 0);
    assert.equal(island.stockMaterials, 0);
    assert.equal(island.stockOrdnance, 0);
  }
});

test('a neutral archipelago produces nothing', () => {
  let state = drive(fresh(), EVERY * 5);
  for (const island of state.islands) assert.equal(island.stockMaterials, 0);
});

test('a resource island mines into its OWN stock, on the accrual tick', () => {
  let state = fresh();
  const island = soleIsland(state, 0, KIND_RESOURCE);
  const row = econ.islandIncome[KIND_RESOURCE];

  state = drive(state, EVERY - 1);
  assert.equal(state.islands[island.id].stockMaterials, 0, 'produced early');
  state = drive(state, 1);
  // It is the stockpile as well as the mine, so what it made stays put.
  assert.equal(state.islands[island.id].stockMaterials, row.materials);
  assert.equal(teamHoldings(state, 0).materials, row.materials);
});

test('a factory converts materials, and makes nothing from nothing', () => {
  let state = fresh();
  const factory = soleIsland(state, 0, KIND_FACTORY);
  const own = econ.islandIncome[KIND_FACTORY].materials;
  assert.ok(own < econ.factoryMaterialsIn, 'this test needs a factory that cannot feed itself');

  state = drive(state, EVERY);
  assert.equal(state.islands[factory.id].stockFuel, 0, 'refined fuel out of thin air');

  // Hand it a heap of materials and it starts refining.
  state.islands[factory.id].stockMaterials = econ.factoryMaterialsIn * 3;
  state = drive(state, EVERY);
  const after = state.islands[factory.id];
  assert.equal(after.stockFuel, econ.factoryFuelOut);
  assert.equal(after.stockOrdnance, econ.factoryOrdnanceOut);
  assert.equal(
    after.stockMaterials,
    econ.factoryMaterialsIn * 3 - econ.factoryMaterialsIn + own,
    'the converter should consume exactly its input and keep its own output',
  );
});

test('a fortress pays in ordnance and a radar island pays in nothing', () => {
  let state = fresh();
  state.islands[0].owner = 0;
  state.islands[0].kind = KIND_FORTRESS;
  state.islands[1].owner = 0;
  state.islands[1].kind = KIND_RADAR;
  state = drive(state, EVERY);
  assert.equal(state.islands[1].stockOrdnance, 0, 'a radar island earns its keep in sight, not goods');
  assert.ok(teamHoldings(state, 0).ordnance > 0);
});

test('the first island a team takes becomes its stockpile', () => {
  let state = fresh();
  state.islands[3].owner = 0;
  state = drive(state, EVERY);
  assert.equal(state.teams[0].stockpileIsland, 3);
  assert.ok(state.events.some((e) => e.code === EVT_STOCKPILE_SET && e.b === 0));
});

test('the network ships a share of every island toward the stockpile', () => {
  let state = fresh();
  for (const id of [0, 1, 2]) {
    state.islands[id].owner = 0;
    state.islands[id].kind = KIND_RESOURCE;
  }
  state.teams[0].stockpileIsland = 0;
  // Seed the outlying islands and let one accrual move goods inward.
  state.islands[1].stockMaterials = 1000;
  state.islands[2].stockMaterials = 1000;
  const share = Math.floor((1000 * econ.networkSharePermil) / 1000);

  state = drive(state, EVERY);
  const depot = state.islands[0];
  const outlying = state.islands[1];
  assert.ok(depot.stockMaterials > share, 'the depot should have taken delivery');
  assert.ok(outlying.stockMaterials < 1000, 'the outlying island should have shipped some out');
  // Nothing is created or destroyed by shipping it.
  const produced = econ.islandIncome[KIND_RESOURCE].materials * 3;
  assert.equal(teamHoldings(state, 0).materials, 2000 + produced);
});

test('losing the stockpile island moves the depot to another one', () => {
  let state = fresh();
  state.islands[2].owner = 0;
  state.islands[5].owner = 0;
  state = drive(state, EVERY);
  assert.equal(state.teams[0].stockpileIsland, 2);

  state.islands[2].owner = 1; // taken from us
  state = drive(state, EVERY);
  assert.equal(state.teams[0].stockpileIsland, 5, 'the depot should fall back to what is left');

  state.islands[5].owner = -1; // and now we hold nothing
  state = drive(state, EVERY);
  assert.equal(state.teams[0].stockpileIsland, -1);
});

test('a stranded island keeps what it makes when there is no depot to ship to', () => {
  let state = fresh();
  const island = soleIsland(state, 0, KIND_RESOURCE);
  state = drive(state, EVERY * 3);
  // It is its own depot by default, so nothing moves and nothing is lost.
  assert.equal(state.teams[0].stockpileIsland, island.id);
  assert.equal(state.islands[island.id].stockMaterials, econ.islandIncome[KIND_RESOURCE].materials * 3);
});

test('a commander may nominate the stockpile, but only on an island they hold', () => {
  let state = fresh();
  state.islands[1].owner = 0;
  state.islands[4].owner = 0;
  state.islands[6].owner = 1;

  state = apply(state, { type: 'set_stockpile', carrierId: 0, islandId: 4 });
  assert.equal(state.teams[0].stockpileIsland, 4);
  assert.ok(state.events.some((e) => e.code === EVT_STOCKPILE_SET));

  state = apply(state, { type: 'set_stockpile', carrierId: 0, islandId: 6 });
  assert.equal(state.events[0].code, 1, 'nominated an enemy island as a depot');
  state = apply(state, { type: 'set_stockpile', carrierId: 0, islandId: 999 });
  assert.equal(state.events[0].code, 1);
  assert.equal(state.teams[0].stockpileIsland, 4, 'a refused nomination must not stick');
});

test('an island stock is capped', () => {
  let state = fresh();
  const island = soleIsland(state, 0, KIND_RESOURCE);
  state.islands[island.id].stockMaterials = econ.islandStockCap - 1;
  state = drive(state, EVERY);
  assert.equal(state.islands[island.id].stockMaterials, econ.islandStockCap);
});

test('what is piled on an island is visible only to the side holding it', () => {
  let state = fresh();
  const island = soleIsland(state, 0, KIND_RESOURCE);
  state = drive(state, EVERY);

  const mine = buildView(state, 0).islands[island.id];
  assert.ok(mine.stockMaterials > 0);
  const theirs = buildView(state, 1).islands[island.id];
  assert.equal(theirs.stockMaterials, -1, 'the enemy can see the island, not its warehouse');
  assert.equal(theirs.owner, 0, 'ownership itself is chart knowledge');
});

test('the view reports holdings and which island is the depot', () => {
  let state = fresh();
  state.islands[2].owner = 0;
  state.islands[2].kind = KIND_RESOURCE;
  state = drive(state, EVERY);
  const view = buildView(state, 0);
  assert.equal(view.resources.stockpileIsland, 2);
  assert.equal(view.resources.materials, teamHoldings(state, 0).materials);
  assert.equal(buildView(state, 1).resources.materials, 0);
});

test('the economy record survives copyState without aliasing', () => {
  const state = fresh();
  const copy = copyState(state);
  assert.notEqual(copy.economy, state.economy);
  assert.notEqual(copy.economy.income, state.economy.income);
  assert.notEqual(copy.economy.income[0], state.economy.income[0]);
  copy.economy.income[0].fuel = 9999;
  assert.notEqual(state.economy.income[0].fuel, 9999);
  assert.deepEqual(Object.keys(copy.economy).sort(), Object.keys(state.economy).sort());
});

test('the economy keeps the state hygienic', () => {
  let state = fresh();
  for (const island of state.islands) island.owner = island.id % 2;
  state = drive(state, EVERY * 3);
  assert.doesNotThrow(() => canonicalize(state));
});
