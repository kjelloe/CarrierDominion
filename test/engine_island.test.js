// What an island becomes after you take it: its role, its works, and the
// replacement hulls a factory sends back to the ship.

import test from 'node:test';
import assert from 'node:assert/strict';

import { loadRules, withoutAi } from './helpers/rules.mjs';
import { createInitialState } from '../engine/state.js';
import { apply } from '../engine/reducer.js';
import { canonicalize } from '../shared/statehash.js';
import { buildView } from '../shared/view.js';
import {
  BUILD_FACTORY,
  BUILD_TURRET,
  BUILD_WAREHOUSE,
  ROLE_DEFENCE,
  ROLE_FACTORY,
  ROLE_NONE,
  ROLE_RESOURCE,
  clearWorks,
  roleAllows,
  startBuild,
} from '../engine/island.js';
import { replaceHull } from '../engine/repair.js';
import { KIND_MANTA, UNIT_LOST, UNIT_STOWED } from '../engine/units.js';
import { EVT_ISLAND_BUILT, EVT_ISLAND_ROLE } from '../engine/events.js';

const rules = withoutAi(loadRules());
const econ = loadRules().economy;
const TICK = { type: 'advance_tick' };
const SEED = 20260818;

function fresh() {
  return createInitialState(SEED, rules);
}

function drive(state, ticks) {
  for (let i = 0; i < ticks; i++) state = apply(state, TICK);
  return state;
}

function held(state, id, team = 0) {
  state.islands[id].owner = team;
  return state.islands[id];
}

test('the owner decides what an island is for, and only the owner', () => {
  let state = fresh();
  held(state, 0, 0);
  held(state, 1, 1);

  state = apply(state, {
    type: 'set_island_role', carrierId: 0, islandId: 0, role: ROLE_FACTORY,
  });
  assert.equal(state.islands[0].role, ROLE_FACTORY);
  assert.ok(state.events.some((e) => e.code === EVT_ISLAND_ROLE));

  // Somebody else's island is not yours to plan.
  state = apply(state, {
    type: 'set_island_role', carrierId: 0, islandId: 1, role: ROLE_RESOURCE,
  });
  assert.equal(state.islands[1].role, ROLE_NONE);
  assert.equal(state.events[0].code, 1, 'the command should have been rejected');
});

test('a role can be changed until concrete is poured, and not after', () => {
  let state = fresh();
  held(state, 0, 0);
  state = apply(state, {
    type: 'set_island_role', carrierId: 0, islandId: 0, role: ROLE_RESOURCE,
  });
  state = apply(state, {
    type: 'set_island_role', carrierId: 0, islandId: 0, role: ROLE_FACTORY,
  });
  assert.equal(state.islands[0].role, ROLE_FACTORY, 'a bare island should still be re-plannable');

  state.islands[0].factories = 1;
  state = apply(state, {
    type: 'set_island_role', carrierId: 0, islandId: 0, role: ROLE_DEFENCE,
  });
  assert.equal(state.islands[0].role, ROLE_FACTORY, 'the role changed under a built factory');
});

test('each role allows only its own buildings', () => {
  assert.equal(roleAllows(ROLE_FACTORY, BUILD_FACTORY), true);
  assert.equal(roleAllows(ROLE_FACTORY, BUILD_WAREHOUSE), true);
  assert.equal(roleAllows(ROLE_FACTORY, BUILD_TURRET), false);
  assert.equal(roleAllows(ROLE_DEFENCE, BUILD_TURRET), true);
  assert.equal(roleAllows(ROLE_DEFENCE, BUILD_FACTORY), false);
  assert.equal(roleAllows(ROLE_RESOURCE, BUILD_WAREHOUSE), true);
  assert.equal(roleAllows(ROLE_RESOURCE, BUILD_FACTORY), false);
  assert.equal(roleAllows(ROLE_NONE, BUILD_WAREHOUSE), false);
});

test('building costs the island its own materials, and takes time', () => {
  let state = fresh();
  const island = held(state, 0, 0);
  island.role = ROLE_FACTORY;
  const spec = econ.builds[BUILD_FACTORY];
  island.stockMaterials = spec.materials + 25;

  state = apply(state, {
    type: 'build_on_island', carrierId: 0, islandId: 0, what: BUILD_FACTORY,
  });
  assert.equal(state.islands[0].stockMaterials, 25, 'the site was not paid for');
  assert.equal(state.islands[0].building, BUILD_FACTORY);
  assert.equal(state.islands[0].factories, 0, 'it went up instantly');

  state = drive(state, spec.ticks - 1);
  assert.equal(state.islands[0].factories, 0, 'it finished early');
  state = drive(state, 1);
  assert.equal(state.islands[0].factories, 1);
  assert.equal(state.islands[0].building, -1);
  assert.ok(state.events.some((e) => e.code === EVT_ISLAND_BUILT));
});

test('building is refused without the materials, the role, or a free slot', () => {
  const state = fresh();
  const island = held(state, 0, 0);
  island.role = ROLE_DEFENCE;
  const spec = econ.builds[BUILD_TURRET];

  island.stockMaterials = spec.materials - 1;
  assert.equal(startBuild(state, island, BUILD_TURRET, state.economy), 0, 'built on credit');

  island.stockMaterials = spec.materials * 2;
  assert.equal(startBuild(state, island, BUILD_FACTORY, state.economy), 0, 'wrong role');

  island.turrets = spec.max;
  assert.equal(startBuild(state, island, BUILD_TURRET, state.economy), 0, 'past the slot limit');

  island.turrets = 0;
  assert.equal(startBuild(state, island, BUILD_TURRET, state.economy), 1);
  // And only one thing at a time.
  island.stockMaterials = spec.materials * 2;
  assert.equal(startBuild(state, island, BUILD_TURRET, state.economy), 0, 'two sites at once');
});

test('losing an island loses the works, and the new owner starts from bare ground', () => {
  const state = fresh();
  const island = held(state, 0, 0);
  island.role = ROLE_FACTORY;
  island.factories = 2;
  island.warehouses = 1;
  island.building = BUILD_FACTORY;
  island.buildTicks = 500;

  clearWorks(island);
  assert.equal(island.role, ROLE_NONE);
  assert.equal(island.factories, 0);
  assert.equal(island.warehouses, 0);
  assert.equal(island.building, -1);
  assert.equal(island.buildTicks, 0);
});

test('work stops on an island that goes neutral mid-build', () => {
  let state = fresh();
  const island = held(state, 0, 0);
  island.role = ROLE_FACTORY;
  island.stockMaterials = econ.builds[BUILD_FACTORY].materials;
  state = apply(state, {
    type: 'build_on_island', carrierId: 0, islandId: 0, what: BUILD_FACTORY,
  });
  state.islands[0].owner = -1;
  state = drive(state, 2);
  assert.equal(state.islands[0].building, -1, 'a site nobody owns kept building itself');
  assert.equal(state.islands[0].buildTicks, 0);
});

test('a factory chassis becomes a lost hull again, back aboard', () => {
  const state = fresh();
  const carrier = state.carriers[0];
  const manta = state.units.find((u) => u.team === 0 && u.kind === KIND_MANTA);
  manta.state = UNIT_LOST;
  manta.hp = 0;
  for (const entry of manta.arms) entry.n = 0;

  // Not without the parts.
  carrier.chassis = econ.chassisPerHull - 1;
  assert.equal(replaceHull(state, carrier), 0, 'a hull was assembled out of nothing');

  carrier.chassis = econ.chassisPerHull;
  assert.equal(replaceHull(state, carrier), 1);
  const back = state.units.find((u) => u.id === manta.id);
  assert.equal(back.state, UNIT_STOWED);
  assert.equal(back.hp, back.maxHp);
  assert.equal(carrier.chassis, 0, 'the parts were not spent');
  // It comes back armed, because a hangar that assembles a hull arms it too.
  assert.ok(back.arms[0].n > 0);
});

test('a wrecked hangar cannot assemble anything', () => {
  const state = fresh();
  const carrier = state.carriers[0];
  const manta = state.units.find((u) => u.team === 0 && u.kind === KIND_MANTA);
  manta.state = UNIT_LOST;
  manta.hp = 0;
  carrier.chassis = econ.chassisPerHull * 4;
  // Section 1 is midship, the hangar deck.
  carrier.sections[1].hp = 0;
  assert.equal(replaceHull(state, carrier), 0, 'a closed hangar built an aircraft');
});

test('the whole chain runs: factory to chassis to a hull back in the water', () => {
  let state = fresh();
  const carrier = state.carriers[0];
  const island = held(state, 0, 0);
  island.role = ROLE_FACTORY;
  island.factories = 3;
  island.stockMaterials = econ.islandStockCap;
  state.teams[0].stockpileIsland = island.id;
  // Park the ship off the depot so the boat's run is short.
  carrier.x = island.x;
  carrier.y = island.y - island.radius * 2;
  const manta = state.units.find((u) => u.team === 0 && u.kind === KIND_MANTA);
  manta.state = UNIT_LOST;
  manta.hp = 0;

  state = apply(state, { type: 'set_supply_run', carrierId: 0, active: 1 });
  let rebuilt = false;
  for (let tick = 0; tick < 120000 && !rebuilt; tick++) {
    state = apply(state, TICK);
    rebuilt = state.units.find((u) => u.id === manta.id).state === UNIT_STOWED;
  }
  assert.ok(rebuilt, 'the factory never got a replacement hull back to the ship');
  assert.doesNotThrow(() => canonicalize(state));
});

test('the view reports the works, and hides an enemy island stock', () => {
  const state = fresh();
  const island = held(state, 0, 0);
  island.role = ROLE_FACTORY;
  island.factories = 2;
  island.stockChassis = 30;

  const mine = buildView(state, 0).islands[island.id];
  assert.equal(mine.role, ROLE_FACTORY);
  assert.equal(mine.factories, 2);
  assert.equal(mine.stockChassis, 30);

  const theirs = buildView(state, 1).islands[island.id];
  assert.equal(theirs.role, ROLE_FACTORY, 'what an island is for is visible from the sea');
  assert.equal(theirs.stockChassis, -1, 'the enemy counted our spare parts');
});
