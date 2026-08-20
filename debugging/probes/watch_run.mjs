// debugging/probes/watch_run.mjs
//
// The watchdog over a whole AI-vs-AI war, which is the closest thing to a
// playtest that can be run without a person. Anything it reports here is a
// fault a player would have hit too.
//
//   node debugging/probes/watch_run.mjs [ticks]

import { createInitialState } from '../../engine/state.js';
import { apply } from '../../engine/reducer.js';
import { loadRules } from '../../server/rules.js';
import { createWatch, watchReport, watchTick } from '../../server/watch.js';

const TICKS = Number(process.argv[2] ?? 400000);
const rules = loadRules();
rules.rules = { ...rules.rules, aiTeams: [0, 1] };

let state = createInitialState(20260818, rules);
const watch = createWatch();
const started = process.hrtime.bigint();

for (let i = 0; i < TICKS && state.phase === 0; i++) {
  const before = process.hrtime.bigint();
  state = apply(state, { type: 'advance_tick' });
  watchTick(watch, state, Number(process.hrtime.bigint() - before) / 1e6);
}

const seconds = Number(process.hrtime.bigint() - started) / 1e9;
const report = watchReport(watch);
process.stdout.write(`${report.ticks} ticks in ${seconds.toFixed(1)}s `
  + `(${Math.round(report.ticks / seconds)} ticks/s, slowest ${report.slowestMs} ms)\n`);
process.stdout.write(`war ended: phase ${state.phase} winner ${state.winner} at tick ${state.tick}\n`);
if (report.findings.length === 0) {
  process.stdout.write('watchdog: nothing to report\n');
} else {
  for (const finding of report.findings) {
    process.stdout.write(`  ${finding.kind} - first at tick ${finding.firstTick}, `
      + `${finding.count} times - ${finding.detail}\n`);
  }
  process.exitCode = 1;
}
