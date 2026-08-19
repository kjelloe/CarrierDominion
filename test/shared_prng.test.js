import test from 'node:test';
import assert from 'node:assert/strict';

import { deriveSeed, mul32, nextRng, rollBetween, rollRange, seedRng } from '../shared/prng.js';

test('seedRng never returns the xorshift fixed point', () => {
  assert.notEqual(seedRng(0), 0);
  assert.notEqual(seedRng(4294967296), 0);
  assert.equal(seedRng(1), 1);
  assert.equal(seedRng(-1), 1);
});

test('nextRng stays a 32-bit unsigned integer', () => {
  let state = seedRng(12345);
  for (let i = 0; i < 10000; i++) {
    state = nextRng(state);
    assert.ok(Number.isInteger(state));
    assert.ok(state >= 0 && state <= 4294967295, `out of range: ${state}`);
    assert.notEqual(state, 0);
  }
});

test('the same seed replays the same stream', () => {
  const first = [];
  let a = seedRng(777);
  for (let i = 0; i < 100; i++) { a = nextRng(a); first.push(a); }
  let b = seedRng(777);
  for (let i = 0; i < 100; i++) { b = nextRng(b); assert.equal(b, first[i]); }
});

test('rollRange stays inside its bound and threads its state', () => {
  let state = seedRng(42);
  const counts = [0, 0, 0, 0, 0, 0];
  for (let i = 0; i < 6000; i++) {
    const rolled = rollRange(state, 6);
    state = rolled.rngState;
    assert.ok(rolled.value >= 0 && rolled.value < 6);
    counts[rolled.value] += 1;
  }
  for (const count of counts) assert.ok(count > 700, `lumpy distribution: ${counts.join(',')}`);
});

test('rollBetween is inclusive at both ends', () => {
  let state = seedRng(9);
  let sawLow = false;
  let sawHigh = false;
  for (let i = 0; i < 2000; i++) {
    const rolled = rollBetween(state, 10, 13);
    state = rolled.rngState;
    assert.ok(rolled.value >= 10 && rolled.value <= 13);
    if (rolled.value === 10) sawLow = true;
    if (rolled.value === 13) sawHigh = true;
  }
  assert.ok(sawLow && sawHigh);
});

test('rollRange rejects a non-positive bound', () => {
  assert.throws(() => rollRange(seedRng(1), 0), RangeError);
});

test('mul32 matches a reference modular multiply', () => {
  const cases = [[1, 1], [65535, 65537], [4294967295, 3], [123456789, 2654435761], [0, 999]];
  for (const [a, b] of cases) {
    const expected = Number((BigInt(a) * BigInt(b)) % 4294967296n);
    assert.equal(mul32(a, b), expected, `${a} * ${b}`);
  }
});

test('deriveSeed gives distinct streams per index', () => {
  const seen = {};
  for (let i = 0; i < 64; i++) {
    const derived = deriveSeed(2026, i);
    assert.ok(derived >= 1 && derived <= 4294967295);
    assert.equal(seen[derived], undefined, `stream collision at index ${i}`);
    seen[derived] = i;
  }
  assert.equal(deriveSeed(2026, 3), deriveSeed(2026, 3));
});
