import test from 'node:test';
import assert from 'node:assert/strict';

import { loadRules, withoutAi } from './helpers/rules.mjs';
import { createInitialState, copyState } from '../engine/state.js';
import { apply } from '../engine/reducer.js';
import { canonicalize } from '../shared/statehash.js';
import { resupplyPointFor } from '../engine/economy.js';
import { KIND_FACTORY, KIND_RADAR, KIND_RESOURCE } from '../engine/worldgen.js';
import { EVT_RESUPPLIED } from '../engine/events.js';

const rules = withoutAi(loadRules());
const TICK = { type: 'advance_tick' };
const SEED = 20260818;
const EVERY = loadRules().economy.incomeEveryTicks;
// A carrier burns fuel just sitting there, and the accrual window is exactly
// the idle-burn window, so every resupply figure below has to account for it.
const IDLE_BURN = loadRules().units.carrier.fuelBurnIdlePer100Ticks;

function fresh() {
  return createInitialState(SEED, rules);
}

function drive(state, ticks) {
  for (let i = 0; i < ticks; i++) state = apply(state, TICK);
  return state;
}

test('a neutral archipelago pays nobody', () => {
  let state = fresh();
  const before = state.teams.map((t) => ({ ...t }));
  state = drive(state, EVERY * 5);
  for (const team of state.teams) {
    assert.deepEqual({ ...team }, before[team.id], `team ${team.id} was paid for nothing`);
  }
});

test('an owned island pays its kind rate, on the accrual tick and no other', () => {
  let state = fresh();
  const island = state.islands.find((i) => i.kind === KIND_RESOURCE) ?? state.islands[0];
  island.kind = KIND_RESOURCE;
  island.owner = 0;
  const row = rules.economy.islandIncome[KIND_RESOURCE];
  const startFuel = state.teams[0].fuel;

  state = drive(state, EVERY - 1);
  assert.equal(state.teams[0].fuel, startFuel, 'paid early');
  state = drive(state, 1);
  assert.equal(state.teams[0].fuel, startFuel + row.fuel);
  assert.equal(state.teams[0].materials, rules.rules.startMaterials + row.materials);

  state = drive(state, EVERY);
  assert.equal(state.teams[0].fuel, startFuel + row.fuel * 2);
});

test('each island kind pays its own row, and radar pays nothing', () => {
  let state = fresh();
  state.islands[0].kind = KIND_FACTORY;
  state.islands[0].owner = 0;
  state.islands[1].kind = KIND_RADAR;
  state.islands[1].owner = 0;
  const factory = rules.economy.islandIncome[KIND_FACTORY];
  const startMaterials = state.teams[0].materials;
  state = drive(state, EVERY);
  assert.equal(state.teams[0].materials, startMaterials + factory.materials);
  assert.equal(state.teams[0].ordnance, rules.rules.startOrdnance + factory.ordnance);
  // The radar island contributed nothing but is still owned.
  assert.equal(state.islands[1].owner, 0);
});

test('income goes to the owner, not to whoever is nearest', () => {
  let state = fresh();
  state.islands[0].kind = KIND_RESOURCE;
  state.islands[0].owner = 1;
  const startFuel0 = state.teams[0].fuel;
  const startFuel1 = state.teams[1].fuel;
  state = drive(state, EVERY);
  assert.equal(state.teams[0].fuel, startFuel0);
  assert.ok(state.teams[1].fuel > startFuel1);
});

test('a carrier off its own island refuels from the team stores', () => {
  let state = fresh();
  const island = state.islands[0];
  island.owner = 0;
  island.kind = KIND_RESOURCE;
  const carrier = state.carriers[0];
  carrier.x = island.x + island.radius + state.economy.resupplyRange - 1000;
  carrier.y = island.y;
  carrier.fuel = 1000;
  const teamFuelBefore = state.teams[0].fuel;

  state = drive(state, EVERY);
  const after = state.carriers[0];
  assert.ok(after.fuel > 1000, 'the carrier took nothing aboard');
  const taken = after.fuel - 1000 + IDLE_BURN;
  const income = rules.economy.islandIncome[KIND_RESOURCE].fuel;
  assert.equal(state.teams[0].fuel, teamFuelBefore + income - taken, 'fuel came from nowhere');
  assert.ok(state.events.some((e) => e.code === EVT_RESUPPLIED));
});

test('resupply stops at the tank and at the stores', () => {
  let state = fresh();
  const island = state.islands[0];
  island.owner = 0;
  // A radar island so the stores are not topped up by income in the same
  // window - this test is about the two ceilings, not about earning.
  island.kind = KIND_RADAR;
  state.carriers[0].x = island.x;
  state.carriers[0].y = island.y + island.radius + state.economy.resupplyRange - 1000;
  state.carriers[0].fuel = state.carriers[0].fuelCapacity - 5;
  state.teams[0].fuel = 3;
  state = drive(state, EVERY);
  assert.ok(state.carriers[0].fuel <= state.carriers[0].fuelCapacity, 'overfilled the tank');
  assert.equal(state.teams[0].fuel, 0, 'the stores should be drained, not overdrawn');
  // Burnt IDLE_BURN sitting there, then took every one of the 3 units left.
  assert.equal(state.carriers[0].fuel, state.carriers[0].fuelCapacity - 5 - IDLE_BURN + 3);
});

test('resupply repairs the hull but never past new', () => {
  let state = fresh();
  const island = state.islands[0];
  island.owner = 0;
  // Offshore, in deep water: parked on the island itself the hull grinds
  // faster than the yard can patch it, which is correct and not what this
  // test is about.
  state.carriers[0].x = island.x;
  state.carriers[0].y = island.y + island.radius + state.economy.resupplyRange - 1000;
  state.carriers[0].hull = state.carriers[0].maxHull - 2;
  state = drive(state, EVERY);
  assert.equal(state.carriers[0].hull, state.carriers[0].maxHull);
  state = drive(state, EVERY);
  assert.equal(state.carriers[0].hull, state.carriers[0].maxHull, 'repaired past new');
});

test('a carrier far from home, or off an enemy island, gets nothing', () => {
  let state = fresh();
  state.islands[0].owner = 1;
  state.carriers[0].x = state.islands[0].x + state.islands[0].radius + 200;
  state.carriers[0].y = state.islands[0].y;
  state.carriers[0].fuel = 10;
  state = drive(state, EVERY);
  assert.equal(state.carriers[0].fuel, 10 - IDLE_BURN, 'resupplied at an enemy island');
  assert.equal(resupplyPointFor(state, state.carriers[0]), -1);
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
