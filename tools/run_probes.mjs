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
// Exit code is the number of failures, capped at 250.

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

const failed = [];
const began = Date.now();
for (const name of probes) {
  process.stdout.write(`${name.replace('.mjs', '').padEnd(20)} `);
  const result = await run(name);
  if (result.code === 0) {
    process.stdout.write('ok\n');
  } else {
    const last = result.out.trim().split('\n').filter((line) => line !== '').pop() ?? '';
    process.stdout.write(`FAILED (${result.code === 124 ? 'timeout' : result.code})\n`);
    failed.push({ name: result.name, why: last.slice(0, 120), out: result.out });
  }
}

const seconds = Math.round((Date.now() - began) / 1000);
process.stdout.write(`\n${probes.length - failed.length}/${probes.length} probes ok in ${seconds}s\n`);
for (const failure of failed) {
  process.stdout.write(`\n--- ${failure.name}\n${failure.out.trim().split('\n').slice(-12).join('\n')}\n`);
}
process.exit(Math.min(250, failed.length));
