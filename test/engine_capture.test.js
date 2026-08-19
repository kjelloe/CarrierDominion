import test from 'node:test';
import assert from 'node:assert/strict';

import { loadRules } from '../server/rules.js';
import { createInitialState } from '../engine/state.js';
import { apply } from '../engine/reducer.js';
import { buildView } from '../shared/view.js';
import { dist2D } from '../shared/fixed.js';
import { islandHeightAt, worldHeightAt } from '../engine/heightmap.js';
import { checkDeploy } from '../engine/capture.js';
import { KIND_MANTA, KIND_WALRUS, findUnit } from '../engine/units.js';
import {
  EVT_ISLAND_CAPTURED,
  EVT_POD_DEPLOYED,
  EVT_POD_LOST,
} from '../engine/events.js';

const rules = loadRules();
const TICK = { type: 'advance_tick' };
const SEED = 20260818;

function fresh() {
  return createInitialState(SEED, rules);
}

function drive(state, ticks) {
  for (let i = 0; i < ticks; i++) state = apply(state, TICK);
  return state;
}

// Put a launched Walrus straight at the node: driving one there for real takes
// tens of thousands of ticks and is covered by the movement tests.
function walrusAtNode(state, team, island) {
  const carrierId = team;
  let next = apply(state, { type: 'launch_unit', carrierId: carrierId, kind: KIND_WALRUS });
  const id = next.events[0].a;
  const unit = findUnit(next, id);
  unit.x = island.nodeX;
  unit.y = island.nodeY;
  unit.z = islandHeightAt(island, island.nodeX, island.nodeY);
  return { state: next, id: id };
}

test('every island gets a command node that is ashore and reachable', () => {
  for (let seed = 1; seed <= 20; seed++) {
    const state = createInitialState(seed, rules);
    for (const island of state.islands) {
      const height = worldHeightAt(state.islands, island.nodeX, island.nodeY);
      assert.ok(height > 0, `seed ${seed} island ${island.id}: node is under water`);
      const offset = dist2D(island.nodeX, island.nodeY, island.x, island.y);
      assert.ok(offset < island.radius, `seed ${seed} island ${island.id}: node is off the island`);
      assert.ok(Number.isInteger(island.nodeX) && Number.isInteger(island.nodeY));
    }
  }
});

test('islands start neutral with no pod building', () => {
  const state = fresh();
  for (const island of state.islands) {
    assert.equal(island.owner, -1);
    assert.equal(island.podTeam, -1);
    assert.equal(island.podTicks, 0);
  }
});

test('a Walrus at the node deploys its pod and the island falls after the build', () => {
  const island = fresh().islands[0];
  const placed = walrusAtNode(fresh(), 0, island);
  let state = apply(placed.state, { type: 'deploy_pod', unitId: placed.id, islandId: island.id });
  assert.equal(state.events[0].code, EVT_POD_DEPLOYED);
  assert.equal(state.islands[0].podTeam, 0);
  assert.equal(findUnit(state, placed.id).pod, 0, 'the pod left the vehicle');

  state = drive(state, rules.rules.podBuildTicks - 1);
  assert.equal(state.islands[0].owner, -1, 'captured a tick early');
  state = apply(state, TICK);
  assert.equal(state.islands[0].owner, 0);
  assert.equal(state.islands[0].podTeam, -1);
  assert.equal(state.islands[0].podTicks, 0);
  assert.equal(state.events.find((e) => e.code === EVT_ISLAND_CAPTURED).a, island.id);
});

test('a Walrus carries exactly one pod and reloads on recovery', () => {
  const island = fresh().islands[0];
  const placed = walrusAtNode(fresh(), 0, island);
  let state = apply(placed.state, { type: 'deploy_pod', unitId: placed.id, islandId: island.id });
  state = apply(state, { type: 'deploy_pod', unitId: placed.id, islandId: island.id });
  assert.equal(state.events[0].code, 1, 'a second pod appeared from nowhere');

  const unit = findUnit(state, placed.id);
  unit.x = state.carriers[0].x;
  unit.y = state.carriers[0].y;
  state = apply(state, { type: 'recall_unit', unitId: placed.id });
  state = drive(state, 40);
  assert.equal(findUnit(state, placed.id).pod, 1, 'came aboard and did not restock');
});

test('deploying is refused from too far away, from the air, and on your own island', () => {
  const base = fresh();
  const island = base.islands[0];
  const podRange = base.params.podRange;

  const placed = walrusAtNode(base, 0, island);
  const far = findUnit(placed.state, placed.id);
  far.x = island.nodeX + podRange + 1000;
  assert.match(checkDeploy(far, island, podRange), /too far/);

  let state = apply(placed.state, { type: 'deploy_pod', unitId: placed.id, islandId: island.id });
  assert.equal(state.events[0].code, 1);

  // A Manta cannot deliver a pod, however precisely it is parked.
  state = apply(base, { type: 'launch_unit', carrierId: 0, kind: KIND_MANTA });
  const mantaId = state.events[0].a;
  const manta = findUnit(state, mantaId);
  manta.x = island.nodeX;
  manta.y = island.nodeY;
  assert.match(checkDeploy(manta, island, podRange), /only a Walrus/);

  const owned = { ...island, owner: 0 };
  const walrus = findUnit(placed.state, placed.id);
  assert.match(checkDeploy(walrus, owned, podRange), /already yours/);
});

test('an enemy pod displaces one that is still building, and restarts the clock', () => {
  const island = fresh().islands[0];
  const first = walrusAtNode(fresh(), 0, island);
  let state = apply(first.state, { type: 'deploy_pod', unitId: first.id, islandId: island.id });
  state = drive(state, 600);
  assert.equal(state.islands[0].podTicks, 600);

  const second = walrusAtNode(state, 1, island);
  state = apply(second.state, { type: 'deploy_pod', unitId: second.id, islandId: island.id });
  const lost = state.events.find((e) => e.code === EVT_POD_LOST);
  assert.notEqual(lost, undefined, 'the displaced team was not told');
  assert.equal(lost.b, 0);
  assert.equal(state.islands[0].podTeam, 1);
  assert.equal(state.islands[0].podTicks, 0, 'the newcomer inherited the enemy progress');

  state = drive(state, rules.rules.podBuildTicks);
  assert.equal(state.islands[0].owner, 1);
});

test('both teams learn who owns an island; only the owner hears its own pod land', () => {
  const island = fresh().islands[0];
  const placed = walrusAtNode(fresh(), 0, island);
  let state = apply(placed.state, { type: 'deploy_pod', unitId: placed.id, islandId: island.id });
  assert.equal(buildView(state, 0).events.some((e) => e.code === EVT_POD_DEPLOYED), true);
  assert.equal(buildView(state, 1).events.some((e) => e.code === EVT_POD_DEPLOYED), false);

  state = drive(state, rules.rules.podBuildTicks);
  for (const team of [0, 1]) {
    const view = buildView(state, team);
    assert.equal(
      view.events.some((e) => e.code === EVT_ISLAND_CAPTURED),
      true,
      `team ${team} was not told the island changed hands`,
    );
    assert.equal(view.islands[island.id].owner, 0);
  }
});

test('a pod that is building shows its progress in the view', () => {
  const island = fresh().islands[0];
  const placed = walrusAtNode(fresh(), 0, island);
  let state = apply(placed.state, { type: 'deploy_pod', unitId: placed.id, islandId: island.id });
  state = drive(state, 100);
  const seen = buildView(state, 0).islands[island.id];
  assert.equal(seen.podTeam, 0);
  assert.equal(seen.podTicks, 100);
});
