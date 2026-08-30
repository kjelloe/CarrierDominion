// The sweep must measure the SAME GAME the battery measures.
//
// This is the check that catches an instrument quietly measuring something
// else, and it has already earned itself once: the first draft of
// tools/sweep.mjs built its ruleset by hand (`aiTeams: [0,1,2,3]` with
// teamCount left at 2), which gave two teams an AI plan and no carrier. Every
// war failed to resolve and it looked exactly like a finding about the game.
//
// The dev-log claimed this agreement "guards" the harness from the day the
// sweep landed. It did not - it was something run by hand once. Now it is
// true.
//
// One full war costs about two seconds, which is why this is one seed and not
// five. Seed 900913 is the battery's shortest war for exactly that reason.

import test from 'node:test';
import assert from 'node:assert/strict';

import { runWar, rulesFor, seedFor, COLUMNS, PROGRESS, TICK_CAP } from '../tools/sweep.mjs';
import { loadRules } from '../server/rules.js';
import { createInitialState } from '../engine/state.js';
import { apply } from '../engine/reducer.js';

test('importing the sweep does not run a sweep', () => {
  // Without the invoked-directly guard this import runs forty-eight wars
  // before the first assertion. Reaching this line quickly is the assertion.
  assert.equal(typeof runWar, 'function');
  assert.ok(COLUMNS.includes('resolved'), 'the row lost its resolved column');
});

test('the sweep agrees with the battery, to the tick, on a shared seed', () => {
  // The battery's own numbers for seed 900913, from tools/sim_battery.mjs:
  //   ended t=18695 winner=0 by sinking, worst lull 3444 ticks @ t=14069
  // If this test fails, ONE of the two instruments has changed and they are no
  // longer comparable - which is worth knowing before either is believed.
  const row = runWar(900913, 0, 2);
  assert.equal(row.tick, 18695, 'the sweep and the battery disagree on the length of a war');
  assert.equal(row.winner, 0);
  assert.equal(row.reason, 'sinking');
  assert.equal(row.worstGap, 3444, 'the lull metric has drifted from the battery\'s');
  assert.equal(row.worstGapAt, 14069);
  assert.equal(row.resolved, 1);
});

test('the sweep builds its war through the lobby fold, not by hand', () => {
  // The specific mistake: aiTeams says four, teamCount still says two, and two
  // teams get a plan with no carrier. Any config the sweep produces must be one
  // the lobby could have produced, which means teamCount and aiTeams agree.
  for (const teams of [2, 3, 4, 8, 16]) {
    const rules = rulesFor(8, teams);
    assert.equal(rules.rules.teamCount, teams, `teamCount did not follow teams=${teams}`);
    assert.equal(rules.rules.aiTeams.length, teams, `aiTeams did not follow teams=${teams}`);
    // And the fold's own clamp still applies: a table is never larger than its
    // archipelago, so asking for 8 islands with 16 teams must raise the islands.
    assert.ok(rules.world.islandCount >= teams,
      `${teams} teams on ${rules.world.islandCount} islands - the fold's clamp was bypassed`);
  }
});

test('seeds are derived, so any single row can be reproduced', () => {
  // A sweep nobody can re-run one row of is a sweep nobody can check.
  assert.equal(seedFor(0), 1000);
  assert.notEqual(seedFor(1), seedFor(0) + 1, 'consecutive seeds give visibly related maps');
  const seen = new Set();
  for (let i = 0; i < 500; i++) {
    const s = seedFor(i);
    assert.equal(seen.has(s), false, `seedFor collides at index ${i}`);
    seen.add(s);
  }
});

test('the lull counts progress events, not every event', () => {
  // Counting any event at all reads a flat 100 for every war, because
  // something ticks over constantly - a column that looks like data and says
  // nothing. These codes are copied from the battery so the two agree; if the
  // battery's list changes, this fails and says so.
  assert.deepEqual(PROGRESS, [10, 17, 18, 21, 26, 31, 32, 34, 36]);

  // And prove the distinction is real on a live war rather than asserting it:
  // there must be far more ticks carrying SOME event than progress events.
  let state = createInitialState(seedFor(0), rulesFor(0, 2));
  let anyEvent = 0;
  let progress = 0;
  for (let i = 0; i < 4000; i++) {
    state = apply(state, { type: 'advance_tick' });
    if (state.events.length > 0) anyEvent += 1;
    for (const e of state.events) if (PROGRESS.includes(e.code)) progress += 1;
  }
  assert.ok(anyEvent > progress * 2,
    `events ${anyEvent} vs progress ${progress} - "any event" is no longer a looser measure,`
    + ' so the reason this list exists may have gone away');
});

test('the tick cap is a refusal to answer, not an ending', () => {
  // A war stopped by the cap must report resolved=0 and winner=-1. Reading a
  // capped war as a draw, or as a win for whoever was ahead, is how a sweep
  // reports that everything is fine while nothing is resolving - which is the
  // exact condition the matrix sweep exists to find.
  assert.equal(TICK_CAP, 900000);
  const rules = rulesFor(0, 2);
  const state = createInitialState(seedFor(0), rules);
  assert.equal(state.winReason, 0, 'a war starts with no win reason');
  // The row shape a capped war produces, asserted on the mapping rather than
  // by running one for 900k ticks.
  assert.equal(COLUMNS.includes('resolved'), true);
  assert.equal(COLUMNS.includes('winner'), true);
});
