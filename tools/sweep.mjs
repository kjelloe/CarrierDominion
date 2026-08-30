// tools/sweep.mjs - many wars, one CSV, sharded across the cores.
//
// `npm run battery` is five fixed seeds in eight seconds: it answers "does the
// war still work". This answers "or did those five get lucky" - and it exists
// because they did. All five end with team 0 winning by sinking, which read
// like a side bias until forty-eight fresh seeds came back 25/22. Five seeds
// cannot tell a coincidence from a rule.
//
//   node tools/sweep.mjs --count 48                    # 48 seeds, default war
//   node tools/sweep.mjs --count 16 --islands 32 --teams 4
//   node tools/sweep.mjs --count 300 --shard 0 --shards 6
//   node tools/sweep.mjs --seed 900913                 # ONE war, to reproduce a row
//
// One row per war. The header carries the commit and TWO hashes, which answer
// two different questions and must not be confused:
//
//   era        the RAW ruleset's hash - "are these two sweeps running the same
//              rules?" It does not move when the sweep's own arguments do.
//   configHash the FOLDED ruleset's hash - "are these two sweeps running the
//              same war?" It moves with islands and teams, because those go
//              through applyLobbyOptions and are part of the rules the war
//              runs on.
//
// The first draft printed only the folded one and called it the rules hash,
// which would have disagreed with the era in every batch response for no
// visible reason.
//
// Every war goes through applyLobbyOptions rather than poking the ruleset,
// because a hand-built config is not a config the game can produce: setting
// aiTeams to four teams while teamCount stays at two gives teams 2 and 3 an AI
// plan and no carrier, and then every war fails to resolve for a reason that
// belongs to the harness. That mistake was made here first, on 2026-08-30, and
// it looked exactly like a finding.

import { cpus } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { loadRules } from '../server/rules.js';
import { applyLobbyOptions } from '../shared/options.js';
import { createInitialState } from '../engine/state.js';
import { apply } from '../engine/reducer.js';
import { createWatch, watchTick, watchReport } from '../server/watch.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const TICK = { type: 'advance_tick' };

// 900,000 ticks is 12.5 hours of war at x1. Past that the question is not
// "who won" but "why has nobody", and the row says so with resolved=0 rather
// than pretending the cap was an ending.
const TICK_CAP = 900000;
const REASONS = ['none', 'islands', 'sinking', 'draw', 'points', 'time'];

// The event codes that mean the war MOVED - a capture, a sinking, a conversion.
// Copied deliberately from tools/sim_battery.mjs so the two instruments report
// the same lull and can be compared. Measuring "any event at all" instead
// yields a flat 100 for every war, because something ticks over constantly;
// the first draft of this file did exactly that and produced a column that
// looked like data and said nothing.
const PROGRESS = [10, 17, 18, 21, 26, 31, 32, 34, 36];

function flag(name, fallback) {
  const at = process.argv.indexOf(`--${name}`);
  if (at === -1 || at === process.argv.length - 1) return fallback;
  return Number(process.argv[at + 1]);
}

// Seeds are DERIVED, not random: a sweep must be re-runnable, and "seed 1000 +
// 7919n" lets anyone reproduce one row without the whole sweep. 7919 is prime,
// so the low bits of the seed move on every step - consecutive integers gave
// worldgen visibly related maps.
function seedFor(index) {
  return 1000 + index * 7919;
}

function rulesFor(islands, teams) {
  const base = loadRules();
  return applyLobbyOptions(base, {
    islands: islands > 0 ? islands : base.world.islandCount,
    teams: teams,
    // Every seat a machine: this measures the WAR, not a player.
    aiTeams: Array.from({ length: teams }, (unused, i) => i),
    start: 0,
  });
}

function runWar(seed, islands, teams) {
  const rules = rulesFor(islands, teams);
  let state = createInitialState(seed, rules);
  const watch = createWatch();
  const startedMs = Date.now();
  let lastEvent = 0;
  let worstGap = 0;
  let worstGapAt = 0;
  // `phase`, not `winReason`, and for the same reason the battery uses it:
  // the war has an aftermath, and stopping at the first win reason would cut
  // the row short of the state the watchdog is still checking.
  while (state.phase === 0 && state.tick < TICK_CAP) {
    const before = Date.now();
    state = apply(state, TICK);
    watchTick(watch, state, Date.now() - before);
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
  const report = watchReport(watch);
  const held = [];
  for (let team = 0; team < teams; team++) {
    held.push(state.islands.filter((i) => i.owner === team).length);
  }
  return {
    seed: seed,
    islands: state.islands.length,
    teams: teams,
    tick: state.tick,
    resolved: state.winReason === 0 ? 0 : 1,
    winner: state.winReason === 0 ? -1 : state.winner,
    reason: REASONS[state.winReason] ?? String(state.winReason),
    worstGap: worstGap,
    worstGapAt: worstGapAt,
    findings: report.findings === undefined ? 0 : report.findings.length,
    held: held.join('|'),
    wallMs: Date.now() - startedMs,
  };
}

const COLUMNS = ['seed', 'islands', 'teams', 'tick', 'resolved', 'winner', 'reason',
  'worstGap', 'worstGapAt', 'findings', 'held', 'wallMs'];

function git(...args) {
  const r = spawnSync('git', args, { cwd: ROOT, encoding: 'utf8' });
  return (r.stdout ?? '').trim();
}

// Only sweep when INVOKED, never when imported - the sibling file learned
// this the hard way (a module body that runs the CLI kills the test process),
// and this one is worse: importing it without the guard runs forty-eight wars
// before the first assertion. Exporting runWar is what lets the suite check
// this instrument against `npm run battery`.
const invokedDirectly = process.argv[1] !== undefined
  && new URL(`file://${process.argv[1]}`).pathname === new URL(import.meta.url).pathname;

const COUNT = flag('count', 48);
const ISLANDS = flag('islands', 0);
const TEAMS = flag('teams', 2);
const SHARDS = flag('shards', 1);
const SHARD = flag('shard', 0);
// One named seed, so a surprising row can be reproduced on its own. The
// comment above promised this before the flag existed.
const ONE = flag('seed', 0);

// The header is written by shard 0 only, so the runner can concatenate shards
// without teaching it which lines to drop.
if (invokedDirectly && SHARD === 0) {
  const raw = createInitialState(seedFor(0), loadRules());
  const probe = createInitialState(seedFor(0), rulesFor(ISLANDS, TEAMS));
  process.stdout.write(`# carrier-dominion sweep\n`);
  process.stdout.write(`# commit ${git('describe', '--always', '--dirty')}\n`);
  process.stdout.write(`# era ${raw.rulesHash}\n`);
  process.stdout.write(`# configHash ${probe.rulesHash}\n`);
  process.stdout.write(`# count ${COUNT} islands ${ISLANDS || 'default'} teams ${TEAMS} tickCap ${TICK_CAP}\n`);
  process.stdout.write(`# cores ${cpus().length}\n`);
  process.stdout.write(`${COLUMNS.join(',')}\n`);
}

if (invokedDirectly) {
  if (ONE > 0) {
    const row = runWar(ONE, ISLANDS, TEAMS);
    process.stdout.write(`${COLUMNS.map((c) => row[c]).join(',')}\n`);
  } else {
    for (let i = SHARD; i < COUNT; i += SHARDS) {
      const row = runWar(seedFor(i), ISLANDS, TEAMS);
      process.stdout.write(`${COLUMNS.map((c) => row[c]).join(',')}\n`);
    }
  }
}

export { COLUMNS, PROGRESS, TICK_CAP, runWar, rulesFor, seedFor };
