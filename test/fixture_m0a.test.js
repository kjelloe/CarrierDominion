import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { runM0A } from './fixtures/run_m0a.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const pinned = JSON.parse(readFileSync(join(HERE, 'fixtures', 'm0a.json'), 'utf8'));

// The M0-A fixture is the tripwire for the whole engine: a fixed seed, a fixed
// command script, and the state hash after every one of 300 ticks. When this
// fails, read the FIRST divergent tick - that is where the change bit.
test('the M0-A trajectory matches the pin, tick by tick', () => {
  const fresh = runM0A();
  assert.equal(fresh.seed, pinned.seed);
  assert.equal(fresh.ticks, pinned.ticks);
  assert.equal(fresh.rulesHash, pinned.rulesHash, 'data/*.json changed under the pin');
  assert.equal(fresh.steps.length, pinned.steps.length);

  for (let i = 0; i < fresh.steps.length; i++) {
    const a = pinned.steps[i];
    const b = fresh.steps[i];
    assert.equal(b.tick, a.tick);
    assert.equal(
      b.hash,
      a.hash,
      `trajectory diverges at tick ${b.tick} (first difference wins; ignore later ones)`,
    );
    assert.deepEqual(b.events, a.events, `event stream changed at tick ${b.tick}`);
  }
});

test('replaying the fixture twice in one process is identical', () => {
  const a = runM0A();
  const b = runM0A();
  assert.deepEqual(a.steps, b.steps);
});
