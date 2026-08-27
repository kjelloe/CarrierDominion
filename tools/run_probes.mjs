// tools/run_probes.mjs - run every probe in debugging/probes and report.
//
// The probes are diagnostic tools, not the gate: they open browsers, take
// pictures and take minutes. Nothing ran them on a schedule, so three of
// them rotted quietly and read as broken features when they were finally
// run - one had been clicking the wrong menu row since a row was inserted
// above it, one read a HUD line that had moved to the instrument panel, and
// one asserted a throttle scale that predated the astern gear. Meanwhile a
// FOURTH was right all along: the island board really was throwing.
//
//   npm run probes            every probe
//   npm run probes -- lobby   just the ones whose name matches
//
// A failure is RETRIED ONCE and reported as `ok (2nd try)` (ruled
// 2026-08-27). Thirty-one browser launches back to back exhaust a loaded
// machine, and two probes were failing on that alone while passing perfectly
// well on their own - which cost the sweep most of its authority, because a
// sweep you have to re-run by hand to believe is one you stop reading.
//
// The retry is not there to make the sweep look green. A probe that only
// passes on the second attempt is listed under FLAKY at the end, by name,
// every time: flakiness is a defect to fix, not a pass to bank. What the
// retry buys is that a real failure is no longer buried among two false
// ones.
//
// Exit code is the number of probes that failed TWICE, capped at 250.

import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const HERE = dirname(fileURLToPath(import.meta.url));
const DIR = join(HERE, '..', 'debugging', 'probes');
const TIMEOUT_MS = 300000;

const filter = process.argv[2] ?? '';
const probes = readdirSync(DIR)
  .filter((name) => name.endsWith('.mjs') && !name.startsWith('_'))
  .filter((name) => filter === '' || name.includes(filter))
  .sort();

function run(name) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [join(DIR, name)], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    const keep = (chunk) => { out += chunk; };
    child.stdout.on('data', keep);
    child.stderr.on('data', keep);
    const timer = setTimeout(() => child.kill('SIGKILL'), TIMEOUT_MS);
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      resolve({ name: name, code: signal === null ? code : 124, out: out });
    });
  });
}

function why(result) {
  const last = result.out.trim().split('\n').filter((line) => line !== '').pop() ?? '';
  return last.slice(0, 120);
}

function verdict(code) {
  return code === 124 ? 'timeout' : String(code);
}

const failed = [];
const flaky = [];
const began = Date.now();
for (const name of probes) {
  process.stdout.write(`${name.replace('.mjs', '').padEnd(20)} `);
  const first = await run(name);
  if (first.code === 0) {
    process.stdout.write('ok\n');
    continue;
  }
  // Once more, alone, with the first run's browsers already gone.
  const second = await run(name);
  if (second.code === 0) {
    process.stdout.write(`ok (2nd try - FLAKY, first said ${verdict(first.code)})\n`);
    flaky.push({ name: name, why: why(first) });
    continue;
  }
  process.stdout.write(`FAILED twice (${verdict(first.code)}, then ${verdict(second.code)})\n`);
  failed.push({ name: name, why: why(second), out: second.out });
}

const seconds = Math.round((Date.now() - began) / 1000);
const clean = probes.length - failed.length - flaky.length;
process.stdout.write(`\n${clean}/${probes.length} probes ok first time in ${seconds}s`);
if (flaky.length > 0) process.stdout.write(`, ${flaky.length} only on retry`);
if (failed.length > 0) process.stdout.write(`, ${failed.length} failed twice`);
process.stdout.write('\n');

// Named every time, so a flaky probe cannot quietly become the normal state.
if (flaky.length > 0) {
  process.stdout.write('\nFLAKY - passed only on the second attempt. Each of these is a defect'
    + ' in the probe or in what it watches, not a pass:\n');
  for (const one of flaky) process.stdout.write(`  ${one.name}: ${one.why}\n`);
}

for (const failure of failed) {
  process.stdout.write(`\n--- ${failure.name}\n${failure.out.trim().split('\n').slice(-12).join('\n')}\n`);
}
process.exit(Math.min(250, failed.length));
