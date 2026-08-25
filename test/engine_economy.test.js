import test from 'node:test';
import assert from 'node:assert/strict';

import { loadRules, withoutAi, bareRules } from './helpers/rules.mjs';
import { createInitialState, copyState } from '../engine/state.js';
import { apply } from '../engine/reducer.js';
import { canonicalize } from '../shared/statehash.js';
import { buildView } from '../shared/view.js';
import { teamHoldings } from '../engine/economy.js';
import { KIND_FACTORY, KIND_RADAR, KIND_RESOURCE } from '../engine/worldgen.js';
import { ROLE_DEFENCE, ROLE_FACTORY, ROLE_NONE, ROLE_RESOURCE } from '../engine/island.js';
import { EVT_STOCKPILE_SET } from '../engine/events.js';

const rules = bareRules();
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

// Give a team one island, put it to work, and leave it holding nothing else -
// so a test can watch a single link of the chain in isolation. `kind` is the
// terrain the generator laid down; `role` is what the owner made of it.
function soleIsland(state, team, role, kind) {
  const island = state.islands[0];
  island.owner = team;
  island.role = role;
  if (kind !== undefined) island.kind = kind;
  return island;
}

// Output for a role, before the terrain bonus.
function income(role) {
  return econ.roleIncome[role];
}

test('nobody starts with stores: what you have is what your islands hold', () => {
  const state = fresh();
  for (const team of state.teams) {
    // A team record holds no goods - only which island it ships to, its
    // score, and the quartermaster's production bias (all MEDIUM at the
    // start, which is exactly the unbias behaviour).
    assert.deepEqual(
      Object.keys(team).sort(),
      ['biasChassis', 'biasFuel', 'biasOrdnance', 'id', 'score', 'stockpileIsland'],
    );
    assert.deepEqual([team.biasFuel, team.biasOrdnance, team.biasChassis], [1, 1, 1]);
    assert.equal(team.stockpileIsland, -1);
    assert.equal(team.score, 0);
    assert.deepEqual(
      teamHoldings(state, team.id),
      { fuel: 0, materials: 0, ordnance: 0, chassis: 0 },
    );
  }
  for (const island of state.islands) {
    assert.equal(island.stockFuel, 0);
    assert.equal(island.stockMaterials, 0);
    assert.equal(island.stockOrdnance, 0);
    assert.equal(island.stockChassis, 0);
    assert.equal(island.role, ROLE_NONE, 'an island starts with no purpose at all');
    assert.equal(island.factories + island.warehouses + island.turrets, 0);
  }
});

test('a neutral archipelago produces nothing', () => {
  let state = drive(fresh(), EVERY * 5);
  for (const island of state.islands) assert.equal(island.stockMaterials, 0);
});

test('an island with no role assigned produces nothing at all', () => {
  let state = fresh();
  const island = state.islands[0];
  island.owner = 0;
  state = drive(state, EVERY * 4);
  assert.equal(state.islands[island.id].stockMaterials, 0, 'a bare command centre earned money');
});

test('a resource island mines into its OWN stock, on the accrual tick', () => {
  let state = fresh();
  // Plain terrain, so this is the role's base rate with no bonus on it.
  const island = soleIsland(state, 0, ROLE_RESOURCE, KIND_RADAR);
  const row = income(ROLE_RESOURCE);

  state = drive(state, EVERY - 1);
  assert.equal(state.islands[island.id].stockMaterials, 0, 'produced early');
  state = drive(state, 1);
  // It is the stockpile as well as the mine, so what it made stays put.
  assert.equal(state.islands[island.id].stockMaterials, row.materials);
  assert.equal(teamHoldings(state, 0).materials, row.materials);
});

test('ground that suits the role pays better than ground that does not', () => {
  let plain = fresh();
  soleIsland(plain, 0, ROLE_RESOURCE, KIND_RADAR);
  plain = drive(plain, EVERY);

  let rich = fresh();
  soleIsland(rich, 0, ROLE_RESOURCE, KIND_RESOURCE);
  rich = drive(rich, EVERY);

  assert.ok(
    rich.islands[0].stockMaterials > plain.islands[0].stockMaterials,
    'resource-rich ground should out-produce a bare rock in the same role',
  );
});

test('a factory island with nothing built on it is a building site', () => {
  let state = fresh();
  const factory = soleIsland(state, 0, ROLE_FACTORY, KIND_RADAR);
  state.islands[factory.id].stockMaterials = econ.factoryMaterialsIn * 3;
  state = drive(state, EVERY);
  assert.equal(state.islands[factory.id].stockFuel, 0, 'a plant that does not exist refined fuel');
});

test('a factory converts materials, and three factories convert three times', () => {
  let state = fresh();
  const factory = soleIsland(state, 0, ROLE_FACTORY, KIND_RADAR);
  const own = income(ROLE_FACTORY).materials;
  state.islands[factory.id].factories = 1;
  state.islands[factory.id].stockMaterials = econ.factoryMaterialsIn * 6;
  state = drive(state, EVERY);
  const one = state.islands[factory.id];
  assert.equal(one.stockFuel, econ.factoryFuelOut);
  assert.equal(one.stockOrdnance, econ.factoryOrdnanceOut);
  assert.equal(one.stockChassis, econ.factoryChassisOut);
  assert.equal(
    one.stockMaterials,
    econ.factoryMaterialsIn * 6 - econ.factoryMaterialsIn + own,
    'the converter should consume exactly its input and keep its own output',
  );

  let three = fresh();
  const plant = soleIsland(three, 0, ROLE_FACTORY, KIND_RADAR);
  three.islands[plant.id].factories = 3;
  three.islands[plant.id].stockMaterials = econ.factoryMaterialsIn * 6;
  three = drive(three, EVERY);
  assert.equal(three.islands[plant.id].stockFuel, econ.factoryFuelOut * 3);
});

test('a defence island pays in nothing, which is the price of the guns', () => {
  let state = fresh();
  state.islands[0].owner = 0;
  state.islands[0].role = ROLE_DEFENCE;
  state = drive(state, EVERY * 3);
  const held = teamHoldings(state, 0);
  assert.equal(held.materials + held.fuel + held.ordnance, 0);
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
    state.islands[id].role = ROLE_RESOURCE;
    state.islands[id].kind = KIND_RADAR; // plain ground: no bonus to reason about
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
  const produced = income(ROLE_RESOURCE).materials * 3;
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
  const island = soleIsland(state, 0, ROLE_RESOURCE, KIND_RADAR);
  state = drive(state, EVERY * 3);
  // It is its own depot by default, so nothing moves and nothing is lost.
  assert.equal(state.teams[0].stockpileIsland, island.id);
  assert.equal(state.islands[island.id].stockMaterials, income(ROLE_RESOURCE).materials * 3);
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
  const island = soleIsland(state, 0, ROLE_RESOURCE, KIND_RADAR);
  state.islands[island.id].stockMaterials = econ.islandStockCap - 1;
  state = drive(state, EVERY);
  assert.equal(state.islands[island.id].stockMaterials, econ.islandStockCap);
});

test('a warehouse raises the cap it is capped at', () => {
  let state = fresh();
  const island = soleIsland(state, 0, ROLE_RESOURCE, KIND_RADAR);
  state.islands[island.id].warehouses = 1;
  state.islands[island.id].stockMaterials = econ.islandStockCap + 10;
  state = drive(state, EVERY);
  assert.ok(
    state.islands[island.id].stockMaterials > econ.islandStockCap,
    'a warehouse should let an island hold more than the bare cap',
  );
});

test('what is piled on an island is visible only to the side holding it', () => {
  let state = fresh();
  const island = soleIsland(state, 0, ROLE_RESOURCE, KIND_RESOURCE);
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
  state.islands[2].role = ROLE_RESOURCE;
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
  for (const island of state.islands) {
    island.owner = island.id % 2;
    island.role = island.id % 3;
  }
  state = drive(state, EVERY * 3);
  assert.doesNotThrow(() => canonicalize(state));
});
