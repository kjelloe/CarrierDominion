import test from 'node:test';
import assert from 'node:assert/strict';

import { loadRules, withoutAi, bothAi } from './helpers/rules.mjs';
import { createInitialState } from '../engine/state.js';
import { apply } from '../engine/reducer.js';
import { canonicalize } from '../shared/statehash.js';
import { hashState } from '../engine/snapshot.js';
import { buildView } from '../shared/view.js';
import { AI_SEEK, chooseTarget } from '../engine/ai_carrier.js';
import { islandsHeldBy, PHASE_OVER, WIN_ISLANDS } from '../engine/victory.js';
import { EVT_WAR_OVER } from '../engine/events.js';
import { UNIT_STOWED } from '../engine/units.js';

const rules = loadRules();
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

test('the default war gives team 1 to the AI and team 0 to a player', () => {
  const state = createInitialState(SEED, rules);
  assert.equal(state.ai.length, 1);
  assert.equal(state.ai[0].team, 1);
  assert.equal(state.ai[0].mode, AI_SEEK);
  assert.equal(state.ai[0].targetIsland, -1);
});

test('a war with no AI leaves both carriers where they are', () => {
  let state = createInitialState(SEED, withoutAi(rules));
  assert.equal(state.ai.length, 0);
  const before = state.carriers.map((c) => ({ x: c.x, y: c.y }));
  state = drive(state, 300);
  for (const carrier of state.carriers) {
    assert.equal(carrier.x, before[carrier.id].x);
    assert.equal(carrier.y, before[carrier.id].y);
  }
});

test('the AI picks the nearest island it does not already hold', () => {
  const state = createInitialState(SEED, rules);
  const carrier = state.carriers[1];
  const chosen = chooseTarget(state, 1, carrier);
  assert.notEqual(chosen, -1);
  // Nothing may be nearer than what it chose.
  const target = state.islands[chosen];
  const distanceTo = (island) => Math.hypot(island.x - carrier.x, island.y - carrier.y);
  for (const island of state.islands) {
    if (island.owner === 1 || island.podTeam === 1) continue;
    assert.ok(distanceTo(island) >= distanceTo(target) - 1, `island ${island.id} was nearer`);
  }
});

test('the AI gets its carrier under way toward the target', () => {
  let state = createInitialState(SEED, rules);
  state = drive(state, 200);
  const carrier = state.carriers[1];
  assert.ok(carrier.throttle > 0, 'the AI never rang for revolutions');
  assert.ok(carrier.speed > 0, 'the AI carrier is not moving');
  assert.notEqual(state.ai[0].targetIsland, -1);
});

test('the AI is deterministic: the same seed replays exactly', () => {
  const a = drive(createInitialState(SEED, rules), 4000);
  const b = drive(createInitialState(SEED, rules), 4000);
  assert.equal(hashState(a), hashState(b));
});

test('the AI takes an island unaided, and the state stays hygienic', (t) => {
  let state = createInitialState(SEED, rules);
  const run = driveUntil(state, 200000, (s) => islandsHeldBy(s, 1) > 0);
  assert.ok(run.met, 'the AI never took anything');
  t.diagnostic(`AI took its first island in ${run.ticks} ticks`);
  state = run.state;
  assert.doesNotThrow(() => canonicalize(state));

  // And it went back for another one rather than stopping.
  assert.notEqual(state.ai[0].mode, undefined);
  const next = driveUntil(state, 200000, (s) => islandsHeldBy(s, 1) > 1);
  assert.ok(next.met, 'the AI stopped after one island');
  t.diagnostic(`second island by tick ${state.tick + next.ticks}`);
});

test('holding two thirds of the archipelago ends the war', () => {
  let state = createInitialState(SEED, withoutAi(rules));
  const needed = Math.floor((state.islands.length * rules.rules.victoryIslandPermil) / 1000);
  for (let i = 0; i < needed - 1; i++) state.islands[i].owner = 0;
  state = drive(state, 1);
  assert.equal(state.phase, 0, 'one short should not win it');

  state.islands[needed - 1].owner = 0;
  state = drive(state, 1);
  assert.equal(state.phase, PHASE_OVER);
  assert.equal(state.winner, 0);
  assert.equal(state.winReason, WIN_ISLANDS);
  assert.ok(state.events.some((e) => e.code === EVT_WAR_OVER));
});

test('losing the last carrier ends the war outright', () => {
  let state = createInitialState(SEED, withoutAi(rules));
  state.carriers[1].hull = 0;
  state = drive(state, 1);
  assert.equal(state.phase, PHASE_OVER);
  assert.equal(state.winner, 0);
  assert.equal(state.winReason, 2);
});

test('a finished war keeps ticking but decides nothing new', () => {
  let state = createInitialState(SEED, rules);
  state.carriers[1].hull = 0;
  state = drive(state, 1);
  assert.equal(state.phase, PHASE_OVER);
  const frozenTarget = state.ai[0].targetIsland;
  const tickBefore = state.tick;
  state = drive(state, 300);
  assert.equal(state.tick, tickBefore + 300, 'the clock must keep running');
  assert.equal(state.ai[0].targetIsland, frozenTarget, 'the AI kept planning after the end');
  assert.equal(state.winner, 0);
});

test('the war-over event reaches both teams', () => {
  let state = createInitialState(SEED, withoutAi(rules));
  state.carriers[1].hull = 0;
  state = drive(state, 1);
  for (const team of [0, 1]) {
    const view = buildView(state, team);
    assert.ok(
      view.events.some((e) => e.code === EVT_WAR_OVER),
      `team ${team} was not told the war ended`,
    );
    assert.equal(view.phase, PHASE_OVER);
  }
});

test('two AIs race each other without either getting stuck', (t) => {
  let state = createInitialState(SEED, bothAi(rules));
  assert.equal(state.ai.length, 2);
  const run = driveUntil(state, 900000, (s) => s.phase === PHASE_OVER);
  assert.ok(run.met, 'nobody ever won');
  state = run.state;
  t.diagnostic(`war decided at tick ${state.tick}, winner team ${state.winner}`);
  assert.ok(state.winner === 0 || state.winner === 1);
  assert.doesNotThrow(() => canonicalize(state));
  // Neither side should have lost its whole air group to the sea.
  for (const team of [0, 1]) {
    const alive = state.units.filter((u) => u.team === team && u.state !== 3);
    assert.ok(alive.length > 0, `team ${team} lost every unit`);
  }
  // And the vehicles that finished a job came home rather than idling ashore.
  const stowed = state.units.filter((u) => u.state === UNIT_STOWED);
  assert.ok(stowed.length > 0, 'nothing ever came back aboard');
});
