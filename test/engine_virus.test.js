// The virus bomb: taking a working island instead of a bare one.

import test from 'node:test';
import assert from 'node:assert/strict';

import { loadRules, withoutAi } from './helpers/rules.mjs';
import { createInitialState } from '../engine/state.js';
import { apply } from '../engine/reducer.js';
import { canonicalize } from '../shared/statehash.js';
import { buildView } from '../shared/view.js';
import { checkVirus, convert, deployVirus } from '../engine/virus.js';
import { ROLE_FACTORY, raiseTurret } from '../engine/island.js';
import { KIND_MANTA, KIND_WALRUS, UNIT_ACTIVE } from '../engine/units.js';
import { EVT_ISLAND_CONVERTED, EVT_VIRUS_DEPLOYED } from '../engine/events.js';

const rules = withoutAi(loadRules());
const TICK = { type: 'advance_tick' };
const SEED = 20260818;

function fresh() {
  return createInitialState(SEED, rules);
}

function drive(state, ticks) {
  for (let i = 0; i < ticks; i++) state = apply(state, TICK);
  return state;
}

// An island the enemy holds and has developed, with our Walrus at its command
// centre - which is the only place a virus bomb is any use.
function atTheirNode(state, islandId = 0) {
  const island = state.islands[islandId];
  island.owner = 1;
  island.role = ROLE_FACTORY;
  island.factories = 2;
  island.warehouses = 1;
  island.stockFuel = 4000;
  const walrus = state.units.find((u) => u.team === 0 && u.kind === KIND_WALRUS);
  walrus.state = UNIT_ACTIVE;
  walrus.x = island.nodeX;
  walrus.y = island.nodeY;
  // Issued at the ramp in play (engine/hangar.js provisionWalrus); these tests
  // are about what the bomb DOES, so it is simply aboard.
  walrus.virus = 1;
  return { island: island, walrus: walrus };
}

test('a Walrus sails with a pod; the bomb is bought at the ramp', () => {
  const state = fresh();
  const walrus = state.units.find((u) => u.kind === KIND_WALRUS);
  assert.equal(walrus.pod, 1, 'pods are standard complement');
  assert.equal(walrus.virus, 0, 'a virus bomb is a munition, not shipyard equipment');
  const manta = state.units.find((u) => u.kind === KIND_MANTA);
  assert.equal(manta.virus, 0, 'an aircraft cannot carry a virus bomb');
});

test('a virus bomb needs a command centre that is somebody else', () => {
  const state = fresh();
  const { island, walrus } = atTheirNode(state);
  assert.equal(checkVirus(walrus, island, state.params.virusRange), '');

  island.owner = -1;
  assert.match(checkVirus(walrus, island, state.params.virusRange), /no command centre/);
  island.owner = 0;
  assert.match(checkVirus(walrus, island, state.params.virusRange), /already yours/);
  island.owner = 1;

  walrus.x = island.nodeX + state.params.virusRange * 2;
  assert.match(checkVirus(walrus, island, state.params.virusRange), /too far/);
  walrus.x = island.nodeX;

  walrus.virus = 0;
  assert.match(checkVirus(walrus, island, state.params.virusRange), /no virus bomb/);
});

test('the island changes sides with everything on it', () => {
  let state = fresh();
  const { island, walrus } = atTheirNode(state);
  raiseTurret(state, island);
  island.turrets = 1;
  assert.equal(state.turrets[0].team, 1);

  state = apply(state, { type: 'deploy_virus', unitId: walrus.id, islandId: island.id });
  assert.ok(state.events.some((e) => e.code === EVT_VIRUS_DEPLOYED));
  assert.equal(state.islands[island.id].virusTeam, 0);
  assert.equal(state.units.find((u) => u.id === walrus.id).virus, 0, 'the bomb was not spent');

  state = drive(state, state.params.virusBuildTicks);
  const taken = state.islands[island.id];
  assert.equal(taken.owner, 0);
  assert.ok(state.events.some((e) => e.code === EVT_ISLAND_CONVERTED));
  // The point of the weapon: the works survive, and so do the guns.
  assert.equal(taken.role, ROLE_FACTORY);
  assert.equal(taken.factories, 2);
  assert.equal(taken.warehouses, 1);
  // At least what was there: the plant went on working through the conversion,
  // which is rather the point of taking it intact.
  assert.ok(taken.stockFuel >= 4000, 'the stores were lost with the island');
  assert.equal(state.turrets[0].team, 0, 'the guns did not change sides with the island');
});

test('a pod takes the same island bare - that is the trade', () => {
  let state = fresh();
  const { island, walrus } = atTheirNode(state);
  state = apply(state, { type: 'deploy_pod', unitId: walrus.id, islandId: island.id });
  state = drive(state, state.params.podBuildTicks);
  const taken = state.islands[island.id];
  assert.equal(taken.owner, 0);
  assert.equal(taken.role, -1, 'the pod inherited the previous owner plan');
  assert.equal(taken.factories, 0, 'the pod inherited the previous owner factories');
});

test('a conversion takes longer than a pod, because the prize is bigger', () => {
  const state = fresh();
  assert.ok(
    state.params.virusBuildTicks > state.params.podBuildTicks,
    'subverting a command centre should cost more time than building one',
  );
});

test('a conversion is abandoned if the island changes hands under it', () => {
  let state = fresh();
  const { island, walrus } = atTheirNode(state);
  state = apply(state, { type: 'deploy_virus', unitId: walrus.id, islandId: island.id });
  // Somebody else takes it first.
  state.islands[island.id].owner = -1;
  state = drive(state, 2);
  assert.equal(state.islands[island.id].virusTeam, -1, 'a virus kept working on nothing');

  // And a bomb aimed at an island that has become ours is dropped too.
  let again = fresh();
  const second = atTheirNode(again);
  again = apply(again, {
    type: 'deploy_virus', unitId: second.walrus.id, islandId: second.island.id,
  });
  again.islands[second.island.id].owner = 0;
  again = drive(again, 2);
  assert.equal(again.islands[second.island.id].virusTeam, -1);
});

test('converting cancels a pod somebody was building here', () => {
  const state = fresh();
  const { island } = atTheirNode(state);
  island.podTeam = 1;
  island.podTicks = 40;
  island.virusTeam = 0;
  convert(state, island);
  assert.equal(island.owner, 0);
  assert.equal(island.podTeam, -1, 'a pod kept building on an island that had changed hands');
  assert.equal(island.podTicks, 0);
});

test('a conversion in progress is visible from the sea, like a pod', () => {
  let state = fresh();
  const { island, walrus } = atTheirNode(state);
  state = apply(state, { type: 'deploy_virus', unitId: walrus.id, islandId: island.id });
  state = drive(state, 30);
  for (const team of [0, 1]) {
    const seen = buildView(state, team).islands[island.id];
    assert.equal(seen.virusTeam, 0, `team ${team} could not see the bomb working`);
    assert.ok(seen.virusTicks > 0);
  }
  assert.doesNotThrow(() => canonicalize(state));
});

test('the hangar restocks the bomb along with the pod', () => {
  let state = fresh();
  const carrier = state.carriers[0];
  const walrus = state.units.find((u) => u.team === 0 && u.kind === KIND_WALRUS);
  walrus.pod = 0;
  walrus.virus = 0;
  walrus.state = 2; // UNIT_RETURNING
  walrus.order = 2;
  walrus.x = carrier.x;
  walrus.y = carrier.y;
  state = apply(state, TICK);
  const back = state.units.find((u) => u.id === walrus.id);
  assert.equal(back.pod, 1);
  assert.equal(back.virus, 1);
});

test('a second bomb on your own running conversion is refused, not wasted', () => {
  const state = fresh();
  const { island, walrus } = atTheirNode(state);
  deployVirus(state, walrus, island);
  const again = state.units.find(
    (u) => u.team === 0 && u.kind === KIND_WALRUS && u.id !== walrus.id,
  );
  again.state = UNIT_ACTIVE;
  again.x = island.nodeX;
  again.y = island.nodeY;
  again.virus = 1;
  assert.match(checkVirus(again, island, state.params.virusRange), /already at work/);
  assert.equal(again.virus, 1, 'the refused bomb was spent anyway');
});

test('any change of owner abandons a conversion, not only the obvious two', () => {
  let state = fresh();
  const { island, walrus } = atTheirNode(state);
  state = apply(state, { type: 'deploy_virus', unitId: walrus.id, islandId: island.id });
  state = drive(state, 30);
  assert.equal(state.islands[island.id].virusTeam, 0);

  // A THIRD team takes the island out from under the bomb. Two-team wars
  // cannot produce this; the rule must hold when team counts grow.
  state.islands[island.id].owner = 2;
  state = apply(state, TICK);
  assert.equal(state.islands[island.id].virusTeam, -1, 'the virus kept subverting a stranger');
  assert.equal(state.islands[island.id].virusVictim, -1);
  assert.equal(state.islands[island.id].owner, 2, 'abandoning must not touch ownership');
});
