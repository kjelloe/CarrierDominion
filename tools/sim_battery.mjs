// tools/sim_battery.mjs - five wars, five seeds, no browser, no mercy.
//
// The single-seed sim (`npm run sim`) answers "does the war still work"; this
// answers "or did seed 20260818 just get lucky". Each war runs AI-vs-AI to its
// end under the playtest watchdog, and the battery fails loudly if any war
// fails to resolve, ends in a way no war should, or trips a watchdog finding.
//
//   npm run battery            all five seeds
//   node tools/sim_battery.mjs 12345 67890   just those
//
// A report lands in reports/sweeps/ (gitignored) with the numbers that matter:
// endpoint, winner, reason, the worst quiet stretch, and tick timing.

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadRules } from '../server/rules.js';
import { createInitialState } from '../engine/state.js';
import { apply } from '../engine/reducer.js';
import { hashState } from '../shared/statehash.js';
import { createWatch, watchTick, watchReport } from '../server/watch.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPORTS = join(HERE, '..', 'reports', 'sweeps');

// Fixed by convention, so two runs of the battery argue about code, not seeds.
const SEEDS = [20260818, 31337, 424242, 777001, 900913];
const TICK_CAP = 900000;
const TICK = { type: 'advance_tick' };

// The same "war is moving" event codes the watchdog uses for its stuck check.
const PROGRESS = [10, 17, 18, 21, 26, 31, 32, 34, 36];
const REASONS = ['none', 'islands', 'sinking', 'draw', 'points', 'time'];

function runWar(seed) {
  const rules = loadRules();
  rules.rules = { ...rules.rules, aiTeams: [0, 1] };
  let state = createInitialState(seed, rules);
  const watch = createWatch();
  let lastEvent = 0;
  let worstGap = 0;
  let worstGapAt = 0;
  const startedMs = performance.now();

  while (state.phase === 0 && state.tick < TICK_CAP) {
    const before = performance.now();
    state = apply(state, TICK);
    watchTick(watch, state, performance.now() - before);
    for (const event of state.events) {
      if (!PROGRESS.includes(event.code)) continue;
      const gap = state.tick - lastEvent;
      if (gap > worstGap) {
        worstGap = gap;
        worstGapAt = lastEvent;
      }
      lastEvent = state.tick;
    }
  }

  const problems = [];
  if (state.phase === 0) problems.push(`did not resolve inside ${TICK_CAP} ticks`);
  for (const finding of watchReport(watch).findings) {
    problems.push(`watchdog: ${finding.kind} (first tick ${finding.firstTick}, x${finding.count})`);
  }

  return {
    seed: seed,
    tick: state.tick,
    winner: state.winner,
    reason: REASONS[state.winReason] ?? String(state.winReason),
    hash: hashState(state),
    worstGap: worstGap,
    worstGapAt: worstGapAt,
    wallSeconds: Math.round((performance.now() - startedMs) / 100) / 10,
    problems: problems,
  };
}

const seeds = process.argv.length > 2
  ? process.argv.slice(2).map(Number)
  : SEEDS;

const results = [];
let failed = false;
for (const seed of seeds) {
  const result = runWar(seed);
  results.push(result);
  const verdict = result.problems.length === 0 ? 'ok ' : 'FAIL';
  console.log(
    `${verdict} seed ${result.seed}: ended t=${result.tick} winner=${result.winner} `
    + `by ${result.reason}, worst lull ${result.worstGap} ticks @ t=${result.worstGapAt}, `
    + `${result.wallSeconds}s wall`,
  );
  for (const problem of result.problems) {
    console.log(`     ${problem}`);
    failed = true;
  }
}

mkdirSync(REPORTS, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const path = join(REPORTS, `battery-${stamp}.json`);
writeFileSync(path, `${JSON.stringify({ seeds: seeds, results: results }, null, 2)}\n`);
console.log(`report: ${path}`);

if (failed) process.exitCode = 1;
