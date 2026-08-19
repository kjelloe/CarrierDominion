// tools/repin_m0a.mjs - re-pin the M0-A fixture.
//
// Refuses to write when the EVENT stream changed, unless --force is given.
// A moved hash with an identical event stream is usually a tuning change; a
// moved event stream means the simulation did something different, and that
// wants a human explanation in dev-log.md before it becomes the new truth.
//
//   node tools/repin_m0a.mjs           check + write when only hashes moved
//   node tools/repin_m0a.mjs --force   write regardless
//   node tools/repin_m0a.mjs --check   never write, exit 1 on any drift

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runM0A } from '../test/fixtures/run_m0a.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const PIN = join(HERE, '..', 'test', 'fixtures', 'm0a.json');

const force = process.argv.includes('--force');
const checkOnly = process.argv.includes('--check');

const fresh = runM0A();

function eventsDiffer(oldSteps, newSteps) {
  if (!oldSteps || oldSteps.length !== newSteps.length) return 'step count changed';
  for (let i = 0; i < newSteps.length; i++) {
    const a = (oldSteps[i].events ?? []).join(',');
    const b = newSteps[i].events.join(',');
    if (a !== b) return `tick ${newSteps[i].tick}: events [${a}] -> [${b}]`;
  }
  return '';
}

function hashesDiffer(oldSteps, newSteps) {
  if (!oldSteps || oldSteps.length !== newSteps.length) return 'step count changed';
  for (let i = 0; i < newSteps.length; i++) {
    if (oldSteps[i].hash !== newSteps[i].hash) {
      return `first at tick ${newSteps[i].tick}: ${oldSteps[i].hash} -> ${newSteps[i].hash}`;
    }
  }
  return '';
}

if (!existsSync(PIN)) {
  if (checkOnly) {
    process.stderr.write('no pin on disk\n');
    process.exit(1);
  }
  writeFileSync(PIN, JSON.stringify(fresh, null, 2) + '\n');
  process.stdout.write(`pinned ${fresh.steps.length} ticks (new fixture)\n`);
  process.exit(0);
}

const existing = JSON.parse(readFileSync(PIN, 'utf8'));
const hashDrift = hashesDiffer(existing.steps, fresh.steps);
const eventDrift = eventsDiffer(existing.steps, fresh.steps);

if (hashDrift === '' && eventDrift === '') {
  process.stdout.write('fixture unchanged\n');
  process.exit(0);
}

process.stdout.write(`hash drift: ${hashDrift || 'none'}\n`);
process.stdout.write(`event drift: ${eventDrift || 'none'}\n`);

if (checkOnly) process.exit(1);

if (eventDrift !== '' && !force) {
  process.stderr.write('\nREFUSING to re-pin: the event stream moved, not just the numbers.\n');
  process.stderr.write('Explain the behaviour change in dev-log.md, then re-run with --force.\n');
  process.exit(1);
}

writeFileSync(PIN, JSON.stringify(fresh, null, 2) + '\n');
process.stdout.write(`re-pinned ${fresh.steps.length} ticks\n`);
