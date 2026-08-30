// tools/batch.mjs - the battery lane, with git as the transport.
//
// Ported from the sibling (shadowmandate/tools/batch.mjs, D25/S14), which
// replaced a LAN agent-mail hub: the dev machine commits a TASK and pushes,
// the worker pulls, runs it, commits a RESPONSE and pushes back. Nothing is
// peer-to-peer, so the worker can live anywhere that can reach the remote.
//
//   node tools/batch.mjs queue seeds 300               # dev: 300 seeds, default war
//   node tools/batch.mjs queue matrix 20 32 4          # dev: 20 seeds at 32 islands, 4 teams
//   node tools/batch.mjs status                        # either side: the board
//   node tools/batch.mjs run                           # worker: run everything pending
//   node tools/batch.mjs run --dry                     # worker: say what it would do
//
// A task with no response is pending. That is the whole protocol.
//
// WHY THIS GAME NEEDS IT. `npm run battery` is five seeds in eight seconds and
// answers "does the war still work". It cannot answer "how does the war behave"
// - five seeds cannot tell a coincidence from a rule, and on 2026-08-30 all
// five came back "team 0 wins by sinking", which looked like a side bias until
// forty-eight fresh seeds returned 25/22. The expensive question is the
// CONFIGURATION MATRIX: the lobby offers 4-64 islands and 2-16 teams, and a
// 32-island four-team war costs about 655 core-seconds against 15 for the
// default. That is the batch PC's work, not a laptop's.
//
// THE RULES THIS ENCODES, inherited from the sibling because each was earned:
//
//  - REFUSE TO SERVE ON A RED SUITE. Results from a broken build are worse than
//    no results, because they look like data.
//  - NAME THE COMMIT AND THE ERA IN EVERY RESULT. Here the era is the RULES
//    HASH: `state.rulesHash` hashes the whole ruleset, so two sweeps with the
//    same hash argue about the same war and two with different hashes do not.
//    This game has a better era than a version string and should use it.
//  - FLAG AN ERA MISMATCH, NEVER CORRECT IT. A sweep run under a different
//    ruleset than it was queued for is not wrong; it answers a different
//    question, and reading it as the old one is the stale-baseline hazard.
//  - REPORT FAILURE AS LOUDLY AS SUCCESS. A worker that dies quietly looks
//    like a worker with nothing to do, which is the worst of both.
//  - REFUSE EMPTY OUTPUT. A shard that dies silently would otherwise merge
//    into a cheerful "0 rows".
//  - WRITE NOTHING PRIVATE. These files are tracked. The runner records no
//    hostname and no user, and scrubs absolute paths out of captured errors.
//    `ops` stays gitignored for everything that genuinely is machine-specific.

import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { cpus } from 'node:os';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const TASKS = join(ROOT, 'batch', 'tasks');
const RESPONSES = join(ROOT, 'batch', 'responses');

// The job kinds, and the ONE place their arguments are defined. A second table
// elsewhere is how instruments end up measuring a game the engine no longer has.
const KINDS = {
  // Many seeds at one configuration: pacing, variance, and who wins.
  seeds: {
    args: (t) => ['--count', String(t.count ?? 100)],
    describe: (t) => `${t.count ?? 100} seeds, default war`,
  },
  // One cell of the islands x teams matrix. The reason this lane exists.
  matrix: {
    args: (t) => ['--count', String(t.count ?? 20),
      '--islands', String(t.islands ?? 8), '--teams', String(t.teams ?? 2)],
    describe: (t) => `${t.count ?? 20} seeds at ${t.islands ?? 8} islands, ${t.teams ?? 2} teams`,
  },
};

const read = (p) => JSON.parse(readFileSync(p, 'utf8'));
const ensure = (d) => mkdirSync(d, { recursive: true });

// Never write a machine path into a tracked file. Errors are the leak risk: a
// node stack trace is full of absolute paths, and this repo is built to be
// published.
function scrub(text, root = ROOT) {
  if (!text) return '';
  return String(text)
    .split(root).join('<repo>')
    .replace(/\/(home|Users)\/[^/\s:"']+/g, '~')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 600);
}

function git(...args) {
  const r = spawnSync('git', args, { cwd: ROOT, encoding: 'utf8' });
  return (r.stdout ?? '').trim();
}

// The era. Not a version string somebody has to remember to bump - the hash of
// the whole ruleset, which cannot be forgotten because it is computed from the
// data the war actually runs on.
function currentEra() {
  const r = spawnSync(process.execPath, ['-e', `
    import('./server/rules.js').then(async (m) => {
      const s = await import('./engine/state.js');
      process.stdout.write(s.createInitialState(1, m.loadRules()).rulesHash);
    });
  `], { cwd: ROOT, encoding: 'utf8' });
  const out = (r.stdout ?? '').trim();
  return out.length === 16 ? out : 'unknown';
}

function taskFiles() {
  if (!existsSync(TASKS)) return [];
  return readdirSync(TASKS).filter((f) => f.endsWith('.json')).sort();
}

function responseFor(id) {
  const p = join(RESPONSES, `${id}.json`);
  return existsSync(p) ? read(p) : null;
}

// -- queue (dev side) -------------------------------------------------------
function queue(argv) {
  const kind = argv[0];
  if (KINDS[kind] === undefined) {
    console.error(`unknown kind "${kind}". known: ${Object.keys(KINDS).join(' ')}`);
    process.exit(1);
  }
  ensure(TASKS);
  const seq = String(taskFiles().length + 1).padStart(4, '0');
  const id = `${seq}-${kind}`;
  const task = {
    id: id,
    kind: kind,
    count: Number(argv[1] ?? (kind === 'matrix' ? 20 : 100)),
    queuedForEra: currentEra(),
    queuedAtCommit: git('rev-parse', '--short', 'HEAD'),
  };
  if (kind === 'matrix') {
    task.islands = Number(argv[2] ?? 8);
    task.teams = Number(argv[3] ?? 2);
  }
  // No timestamp: a wall-clock stamp is the one field that would churn the
  // diff on every re-queue while saying nothing the commit does not say.
  writeFileSync(join(TASKS, `${id}.json`), `${JSON.stringify(task, null, 2)}\n`);
  console.log(`queued batch/tasks/${id}.json  (${KINDS[kind].describe(task)})`);
  console.log('\ncommit and push it, then the worker picks it up on its next pull.');
}

// -- status (either side) ---------------------------------------------------
function status() {
  const tasks = taskFiles().map((f) => read(join(TASKS, f)));
  if (tasks.length === 0) { console.log('no tasks queued'); return; }
  console.log(`era here: ${currentEra()}   commit: ${git('describe', '--always', '--dirty')}\n`);
  for (const t of tasks) {
    const r = responseFor(t.id);
    const state = r === null ? 'PENDING' : (r.status === 'ok' ? 'done' : 'FAILED');
    let detail = '';
    if (r !== null && r.status === 'ok') {
      detail = `${r.rows} rows on ${r.ranOnEra} @ ${r.commit}${r.eraMatch ? '' : '  <-- ERA MISMATCH'}`;
    } else if (r !== null) {
      detail = r.error;
    } else {
      detail = KINDS[t.kind] === undefined ? t.kind : KINDS[t.kind].describe(t);
    }
    console.log(`  ${state.padEnd(8)} ${t.id.padEnd(18)} ${detail}`);
  }
  const pending = tasks.filter((t) => responseFor(t.id) === null).length;
  console.log(`\n${pending} pending, ${tasks.length - pending} answered`);
}

// -- run (worker side) ------------------------------------------------------
function writeResponse(id, body) {
  ensure(RESPONSES);
  writeFileSync(join(RESPONSES, `${id}.json`), `${JSON.stringify(body, null, 2)}\n`);
}

function runTask(task, dry) {
  const spec = KINDS[task.kind];
  const commit = git('describe', '--always', '--dirty');
  const ranOnEra = currentEra();
  const base = {
    id: task.id,
    kind: task.kind,
    commit: commit,
    ranOnEra: ranOnEra,
    queuedForEra: task.queuedForEra ?? null,
    eraMatch: (task.queuedForEra ?? ranOnEra) === ranOnEra,
  };
  // Leave two cores. A worker that pins every core makes the machine
  // unusable for the person sitting at it, and the sibling shares this PC.
  const shards = Math.max(1, Math.min(cpus().length - 2, task.count ?? 1));
  if (dry) {
    console.log(`  would run ${task.id}: ${spec.describe(task)}, ${shards} shards`);
    return;
  }

  const parts = [];
  let failure = '';
  for (let i = 0; i < shards; i++) {
    const args = ['tools/sweep.mjs', ...spec.args(task), '--shards', String(shards), '--shard', String(i)];
    const r = spawnSync(process.execPath, args, {
      cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
    });
    // A shard that dies silently becomes a cheerful "0 rows" if nobody looks.
    if (r.status !== 0 || !r.stdout || r.stdout.trim() === '') {
      failure = `shard ${i} produced nothing: ${scrub(r.stderr) || `exit ${r.status}`}`;
      break;
    }
    parts.push(r.stdout);
  }

  if (failure !== '') {
    writeResponse(task.id, { ...base, status: 'failed', error: failure });
    console.log(`  FAILED ${task.id}: ${failure}`);
    return;
  }

  // Shard 0 writes the header (comments plus the column line); the rest are
  // data only, which is why sweep.mjs only prints it for shard 0.
  const lines = [];
  for (const out of parts) lines.push(...out.split('\n').filter((l) => l.length > 0));
  const dataRows = lines.filter((l) => !l.startsWith('#') && !l.startsWith('seed,')).length;
  if (dataRows <= 0) {
    writeResponse(task.id, { ...base, status: 'failed', error: 'no data rows after merging shards' });
    console.log(`  FAILED ${task.id}: no data rows`);
    return;
  }
  ensure(RESPONSES);
  writeFileSync(join(RESPONSES, `${task.id}.csv`), `${lines.join('\n')}\n`);
  writeResponse(task.id, { ...base, status: 'ok', shards: shards, rows: dataRows, csv: `${task.id}.csv` });
  console.log(`  ok ${task.id}: ${dataRows} rows -> batch/responses/${task.id}.csv`);
}

function run(argv) {
  const dry = argv.includes('--dry');
  const pending = taskFiles().map((f) => read(join(TASKS, f))).filter((t) => responseFor(t.id) === null);
  if (pending.length === 0) { console.log('nothing pending'); return; }
  console.log(`${pending.length} pending, era ${currentEra()}, commit ${git('describe', '--always', '--dirty')}`);

  if (!dry) {
    // REFUSE TO SERVE ON A RED SUITE.
    process.stdout.write('checking the suite... ');
    const t = spawnSync('npm', ['test'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    if (t.status !== 0) {
      const tail = scrub((t.stdout ?? '').split('\n').slice(-12).join(' '));
      console.log('RED - refusing to serve');
      for (const task of pending) {
        writeResponse(task.id, {
          id: task.id,
          kind: task.kind,
          status: 'failed',
          commit: git('describe', '--always', '--dirty'),
          ranOnEra: currentEra(),
          error: `npm test is RED on this commit - refusing to serve. ${tail}`,
        });
      }
      console.log('wrote a FAILED response for every pending task - commit and push so it is visible.');
      process.exit(1);
    }
    console.log('green');
  }
  for (const task of pending) runTask(task, dry);
  if (!dry) console.log('\ncommit batch/responses and push.');
}

// Only act when INVOKED, never when imported - importing this to test `scrub`
// must not run the CLI and call process.exit under the test runner.
const invokedDirectly = process.argv[1] !== undefined
  && new URL(`file://${process.argv[1]}`).pathname === new URL(import.meta.url).pathname;
if (invokedDirectly) {
  const [, , cmd, ...argv] = process.argv;
  if (cmd === 'queue') queue(argv);
  else if (cmd === 'status') status();
  else if (cmd === 'run') run(argv);
  else {
    console.log('usage: node tools/batch.mjs queue <kind> [args] | status | run [--dry]');
    console.log(`kinds: ${Object.keys(KINDS).join(' ')}`);
    process.exit(cmd === undefined ? 0 : 1);
  }
}

export { KINDS, scrub };
