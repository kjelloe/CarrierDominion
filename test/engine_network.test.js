// The resource network as a LINK GRAPH (proposal 3b, ruled 2026-08-25): the
// original's geography-as-supply-terrain. Islands link within reach of one
// another; goods flow hop by hop to the depot; an island cut off from the
// chain keeps what it makes and its Command Centre stops building.

import test from 'node:test';
import assert from 'node:assert/strict';

import { loadRules, withoutAi, bareRules } from './helpers/rules.mjs';
import { createInitialState } from '../engine/state.js';
import { apply } from '../engine/reducer.js';
import { canonicalize } from '../shared/statehash.js';
import { computeNetwork, onNetwork } from '../engine/network.js';
import { ROLE_FACTORY, ROLE_RESOURCE } from '../engine/island.js';

const TICK = { type: 'advance_tick' };
const SEED = 20260818;

// A hand-placed archipelago: the depot, a neighbour inside the link, a
// FAR island outside it, and a bridge that can join them.
function chainState() {
  const rules = withoutAi(loadRules());
  rules.rules = { ...rules.rules, startShape: 1, neutralSiloRounds: 0 };
  const state = createInitialState(SEED, rules);
  const link = state.params.networkLink;
  const [depot, near, far, bridge] = state.islands;
  depot.owner = 0;
  depot.x = 20000 * 256;
  depot.y = 20000 * 256;
  near.owner = 0;
  near.x = depot.x + Math.round(link * 0.5);
  near.y = depot.y;
  far.owner = 0;
  far.x = depot.x + Math.round(link * 2.5);
  far.y = depot.y;
  bridge.owner = -1;
  bridge.x = depot.x + Math.round(link * 1.5);
  bridge.y = depot.y;
  state.teams[0].stockpileIsland = depot.id;
  computeNetwork(state);
  return { state, depot, near, far, bridge };
}

test('the chain reaches as far as the links do, and no further', () => {
  const { state, depot, near, far } = chainState();
  assert.equal(depot.networkHops, 0, 'the depot is the root');
  assert.equal(near.networkHops, 1, 'a neighbour inside the link is one hop');
  assert.equal(far.networkHops, -1, 'an island beyond every link is cut off');
  assert.ok(onNetwork(state, near));
  assert.ok(!onNetwork(state, far));
  assert.doesNotThrow(() => canonicalize(state));
});

test('taking the island between them joins the far one to the chain', () => {
  const { state, far, bridge } = chainState();
  bridge.owner = 0;
  computeNetwork(state);
  // The bridge sits 1.5 links out, so the chain reaches it THROUGH the
  // neighbour at 0.5 - two hops - and the far island beyond it at three.
  assert.equal(bridge.networkHops, 2);
  assert.equal(far.networkHops, 3, 'the far island should now be on the chain');
});

test('a cut-off island keeps what it makes, and stops building', () => {
  const { state, far } = chainState();
  let war = state;
  far.role = ROLE_RESOURCE;
  far.stockMaterials = 4000;
  far.building = 1; // a warehouse under way
  far.buildTicks = 50;
  const held = far.stockMaterials;

  // Across an accrual beat: it mines into its own store and ships nothing.
  while (war.tick % war.economy.incomeEvery !== 0 || war.tick === 0) war = apply(war, TICK);
  war = apply(war, TICK);
  const cut = war.islands.find((i) => i.id === far.id);
  const depot = war.islands.find((i) => i.id === war.teams[0].stockpileIsland);
  assert.ok(cut.stockMaterials >= held, 'the cut-off island shipped anyway');
  assert.equal(depot.stockMaterials, 0, 'goods arrived from off the chain');
  assert.equal(cut.buildTicks, 50, 'a cut-off Command Centre kept building');
  assert.notEqual(cut.building, -1, 'the site should WAIT, not be lost');
});

test('the blank ocean has no topology at all - ownership is the whole test', () => {
  const state = createInitialState(SEED, bareRules());
  const island = state.islands[0];
  island.owner = 0;
  assert.ok(onNetwork(state, island), 'with topology off, owning it is enough');
  island.owner = -1;
  assert.ok(!onNetwork(state, island));
});

test('losing the depot cuts the whole chain until another is named', () => {
  const { state, depot, near } = chainState();
  depot.owner = -1; // blasted out from under them
  computeNetwork(state);
  assert.equal(near.networkHops, -1, 'the chain outlived its root');
  state.teams[0].stockpileIsland = near.id;
  computeNetwork(state);
  assert.equal(near.networkHops, 0, 'the new depot is the new root');
});
