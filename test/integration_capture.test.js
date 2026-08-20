// The vertical slice, end to end, driven ONLY through commands - no reaching
// into state to place anything. Steam the carrier to an island, put a Walrus
// in the water, drive it up the beach to the command node, deploy the pod,
// hold until it finishes. If this passes, the game is playable.

import test from 'node:test';
import assert from 'node:assert/strict';

import { loadRules, withoutAi } from './helpers/rules.mjs';
import { createGame, enqueueCommand, stepGame } from '../engine/game.js';
import { dist2D } from '../shared/fixed.js';
import { worldHeightAt } from '../engine/heightmap.js';
import { KIND_WALRUS, UNIT_ACTIVE, findUnit } from '../engine/units.js';
import { EVT_ISLAND_CAPTURED } from '../engine/events.js';

// The enemy is off: this test is about whether the MECHANICS complete, not
// about who gets there first. engine_ai.test.js covers the race.
const rules = withoutAi(loadRules());
const SEED = 20260818;
const TICK_BUDGET = 120000; // 100 minutes of game time; the run takes seconds

// The nearest island that is far enough away to be a real crossing: seed
// 20260818 happens to drop one almost on top of the carrier, and a test that
// starts already at its destination proves nothing about steaming there.
const MIN_CROSSING_UNITS = 4000 * 256;

function crossingTargetFor(state, x, y) {
  let best;
  let bestDistance = Infinity;
  for (const island of state.islands) {
    const distance = dist2D(x, y, island.x, island.y);
    if (distance < MIN_CROSSING_UNITS || distance >= bestDistance) continue;
    bestDistance = distance;
    best = island;
  }
  assert.notEqual(best, undefined, 'no island far enough away to cross to');
  return best;
}

// Run until `done(state)` or the budget runs out. Returns how long it took.
function runUntil(game, done, budget) {
  for (let i = 0; i < budget; i++) {
    stepGame(game);
    if (done(game.state)) return i + 1;
  }
  return -1;
}

test('a carrier crosses to an island and its Walrus takes it', (t) => {
  const game = createGame(SEED, rules);
  const carrier = game.state.carriers[0];
  const island = crossingTargetFor(game.state, carrier.x, carrier.y);

  // 1. Steam straight at the island and stop two radii out - far enough that
  //    the hull never touches the shelf, close enough to launch from.
  const standoff = island.radius * 2;
  enqueueCommand(game, { type: 'set_throttle', carrierId: 0, throttle: 100 });
  enqueueCommand(game, {
    type: 'set_heading', carrierId: 0, heading: headingTo(carrier, island.x, island.y),
  });
  const spent = runUntil(
    game,
    (s) => dist2D(s.carriers[0].x, s.carriers[0].y, island.x, island.y) < standoff
      || s.carriers[0].grounded === 1,
    TICK_BUDGET,
  );
  assert.notEqual(spent, -1, 'the carrier never reached the island');
  assert.equal(game.state.carriers[0].grounded, 0, 'ran aground on the way in');
  t.diagnostic(`carrier crossing: ${spent} ticks`);

  enqueueCommand(game, { type: 'set_throttle', carrierId: 0, throttle: 0 });
  runUntil(game, (s) => s.carriers[0].speed === 0, 2000);

  // 2. Put a Walrus in the water and send it at the command node.
  enqueueCommand(game, { type: 'launch_unit', carrierId: 0, kind: KIND_WALRUS });
  stepGame(game);
  const launched = game.state.events.find((e) => e.code === 8);
  assert.notEqual(launched, undefined, 'the Walrus never launched');
  const unitId = launched.a;
  enqueueCommand(game, {
    type: 'order_unit_move', unitId: unitId, x: island.nodeX, y: island.nodeY,
  });

  const drive = runUntil(
    game,
    (s) => dist2D(findUnit(s, unitId).x, findUnit(s, unitId).y, island.nodeX, island.nodeY)
      <= s.params.podRange,
    TICK_BUDGET,
  );
  assert.notEqual(drive, -1, 'the Walrus never reached the command node');
  t.diagnostic(`walrus run ashore: ${drive} ticks`);

  const walrus = findUnit(game.state, unitId);
  assert.equal(walrus.state, UNIT_ACTIVE);
  assert.ok(worldHeightAt(game.state.islands, walrus.x, walrus.y) > 0, 'it should be ashore');

  // 3. Deploy, and wait for the pod to finish building.
  enqueueCommand(game, { type: 'deploy_pod', unitId: unitId, islandId: island.id });
  const build = runUntil(
    game,
    (s) => s.events.some((e) => e.code === EVT_ISLAND_CAPTURED),
    rules.rules.podBuildTicks + 100,
  );
  assert.notEqual(build, -1, 'the pod never finished');
  t.diagnostic(`pod build: ${build} ticks`);

  const taken = game.state.islands.find((i) => i.id === island.id);
  assert.equal(taken.owner, 0);
  assert.equal(taken.podTeam, -1);
});

// Bearing from a carrier to a point, in BAM, without importing atan2 twice.
function headingTo(from, x, y) {
  const angle = Math.atan2(y - from.y, x - from.x);
  const turns = angle / (Math.PI * 2);
  return ((Math.round(turns * 65536) % 65536) + 65536) % 65536;
}

test('the command log records commands, never the ticks between them', () => {
  const game = createGame(20260818, loadRules());
  stepGame(game);
  enqueueCommand(game, { type: 'set_throttle', carrierId: 0, throttle: 60 });
  stepGame(game);
  stepGame(game);
  assert.equal(game.commandLog.length, 1, 'ticks leaked into the replay log');
  assert.equal(game.commandLog[0].type, 'set_throttle');
  assert.equal(typeof game.commandLog[0].tick, 'number', 'a replay needs the tick stamp');
});
