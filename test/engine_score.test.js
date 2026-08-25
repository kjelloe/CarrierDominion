// Points, and the two optional ways a war can end on them.

import test from 'node:test';
import assert from 'node:assert/strict';

import { loadRules } from '../server/rules.js';
import { bareRules } from './helpers/rules.mjs';
import { createInitialState } from '../engine/state.js';
import { apply } from '../engine/reducer.js';
import { canonicalize } from '../shared/statehash.js';
import { buildView } from '../shared/view.js';
import {
  SCORE_CARRIER,
  SCORE_KILL,
  addScore,
  capProgressPermil,
  leader,
  scoreOf,
  stepScore,
} from '../engine/score.js';
import {
  PHASE_OVER,
  PHASE_RUNNING,
  WIN_DRAW,
  WIN_POINTS,
  WIN_TIME,
  checkVictory,
} from '../engine/victory.js';
import { hitUnit } from '../engine/shots.js';
import { KIND_MANTA, UNIT_ACTIVE } from '../engine/units.js';
import { EVT_SCORED } from '../engine/events.js';

// Home islands off: these tests do their own island arithmetic.
const base = { ...loadRules(), rules: { ...loadRules().rules, homeIslandStart: 0 } };
const TICK = { type: 'advance_tick' };
const SEED = 20260818;

// A ruleset with one of the caps switched on. They are data, so a war with
// both at 0 - the default - behaves exactly as it did before points existed.
function capped(overrides) {
  return { ...base, rules: { ...base.rules, ...overrides } };
}

function fresh(rules = base) {
  return createInitialState(SEED, rules);
}

test('a fresh war is scoreless and uncapped', () => {
  const state = fresh();
  for (const team of state.teams) assert.equal(team.score, 0);
  assert.equal(state.params.pointCap, 0);
  assert.equal(state.params.timeCapTicks, 0);
  assert.equal(capProgressPermil(state, state.params.pointCap, state.params.timeCapTicks), -1);
});

test('holding islands pays, on the hundred-tick beat', () => {
  const state = fresh();
  state.islands[0].owner = 0;
  state.islands[1].owner = 0;
  state.islands[2].owner = 1;

  state.tick = 99;
  stepScore(state, state.params.pointsPerIsland);
  assert.equal(scoreOf(state, 0), 0, 'paid off the beat');

  state.tick = 100;
  stepScore(state, state.params.pointsPerIsland);
  assert.equal(scoreOf(state, 0), 2 * state.params.pointsPerIsland);
  assert.equal(scoreOf(state, 1), 1 * state.params.pointsPerIsland);
  assert.ok(state.events.some((e) => e.code === EVT_SCORED));
});

test('a kill pays the shooter, and running dry pays nobody', () => {
  const state = fresh();
  const victim = state.units.find((u) => u.team === 1 && u.kind === KIND_MANTA);
  victim.state = UNIT_ACTIVE;
  hitUnit(state, victim, victim.hp, 0);
  assert.equal(scoreOf(state, 0), state.params.pointsPerKill);
  assert.equal(scoreOf(state, 1), 0);

  // A unit lost to an empty tank goes through fleet.js, not through a shooter,
  // so there is nobody to pay.
  const stranded = state.units.find((u) => u.team === 1 && u.id !== victim.id);
  stranded.state = UNIT_ACTIVE;
  stranded.fuel = 0;
  const before = scoreOf(state, 0);
  const after = apply(state, TICK);
  assert.equal(scoreOf(after, 0), before);
});

test('the point cap ends the war, and a tie on it is a draw', () => {
  let state = fresh(capped({ pointCap: 100 }));
  addScore(state, 0, 100, SCORE_KILL);
  checkVictory(state, state.params);
  assert.equal(state.phase, PHASE_OVER);
  assert.equal(state.winner, 0);
  assert.equal(state.winReason, WIN_POINTS);

  const tie = fresh(capped({ pointCap: 100 }));
  addScore(tie, 0, 140, SCORE_CARRIER);
  addScore(tie, 1, 120, SCORE_CARRIER);
  checkVictory(tie, tie.params);
  assert.equal(tie.winner, -1, 'both were past the cap, so neither won it');
  assert.equal(tie.winReason, WIN_DRAW);
});

test('the time cap ends the war on the clock, highest score taking it', () => {
  const state = fresh(capped({ timeCapTicks: 500 }));
  addScore(state, 1, 30, SCORE_KILL);
  state.tick = 499;
  checkVictory(state, state.params);
  assert.equal(state.phase, PHASE_RUNNING, 'the clock ran out early');

  state.tick = 500;
  checkVictory(state, state.params);
  assert.equal(state.phase, PHASE_OVER);
  assert.equal(state.winner, 1);
  assert.equal(state.winReason, WIN_TIME);
});

test('a level score when the clock runs out is a draw, not a coin toss', () => {
  const state = fresh(capped({ timeCapTicks: 200 }));
  addScore(state, 0, 50, SCORE_KILL);
  addScore(state, 1, 50, SCORE_KILL);
  state.tick = 200;
  checkVictory(state, state.params);
  assert.equal(state.winner, -1);
  assert.equal(state.winReason, WIN_DRAW);
  assert.equal(leader(state), -1);
});

test('sinking the last carrier still beats both caps to it', () => {
  const state = fresh(capped({ pointCap: 10, timeCapTicks: 1 }));
  addScore(state, 0, 500, SCORE_CARRIER);
  state.carriers[1].hull = 0;
  state.tick = 10000;
  checkVictory(state, state.params);
  // Annihilation is the more decisive answer, and the order in checkVictory
  // says so.
  assert.equal(state.winner, 0);
  assert.equal(state.winReason, 2); // WIN_CARRIER_SUNK
});

test('a capped war reports its progress, and the score reaches the view', () => {
  let state = fresh(capped({ pointCap: 400 }));
  addScore(state, 0, 100, SCORE_KILL);
  assert.equal(capProgressPermil(state, state.params.pointCap, state.params.timeCapTicks), 250);
  state = apply(state, TICK);
  const view = buildView(state, 0);
  assert.equal(view.resources.score, 100);
  assert.equal(view.params.pointCap, 400);
  assert.doesNotThrow(() => canonicalize(state));
});
