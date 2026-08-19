import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ANGLE_FULL,
  UNIT,
  angleDelta,
  clampI,
  distSq2D,
  dist2D,
  divFixed,
  floorDiv,
  floorMod,
  isqrt,
  mulDiv,
  mulFixed,
  stepToward,
  truncDiv,
  turnToward,
  wrapAngle,
} from '../shared/fixed.js';

test('floorDiv rounds toward negative infinity on both signs', () => {
  assert.equal(floorDiv(7, 2), 3);
  assert.equal(floorDiv(-7, 2), -4);
  assert.equal(truncDiv(-7, 2), -3);
});

test('floorMod is always non-negative for a positive modulus', () => {
  assert.equal(floorMod(-1, 8), 7);
  assert.equal(floorMod(9, 8), 1);
  assert.equal(floorMod(0, 8), 0);
});

test('mulFixed and divFixed round-trip within one unit', () => {
  const a = 3 * UNIT + 128;
  const b = 2 * UNIT;
  const product = mulFixed(a, b);
  assert.equal(product, 7 * UNIT);
  const back = divFixed(product, b);
  assert.ok(Math.abs(back - a) <= 1, `${back} vs ${a}`);
});

test('mulDiv keeps the intermediate exact', () => {
  assert.equal(mulDiv(1000000, 53, 100), 530000);
  assert.equal(mulDiv(-1000000, 53, 100), -530000);
});

test('isqrt is the exact integer floor of the square root', () => {
  const cases = [0, 1, 2, 3, 4, 8, 9, 10, 99, 100, 101, 65535, 65536, 1000000, 2147395600];
  for (const n of cases) {
    const r = isqrt(n);
    assert.ok(r * r <= n, `${r}^2 > ${n}`);
    assert.ok((r + 1) * (r + 1) > n, `(${r}+1)^2 <= ${n}`);
  }
});

test('isqrt rejects a negative argument', () => {
  assert.throws(() => isqrt(-1), RangeError);
});

test('distances agree with their squared form', () => {
  const d2 = distSq2D(0, 0, 300, 400);
  assert.equal(d2, 250000);
  assert.equal(dist2D(0, 0, 300, 400), 500);
});

test('clampI clamps at both ends and passes the middle', () => {
  assert.equal(clampI(-5, 0, 10), 0);
  assert.equal(clampI(15, 0, 10), 10);
  assert.equal(clampI(5, 0, 10), 5);
});

test('wrapAngle folds any integer onto one turn', () => {
  assert.equal(wrapAngle(0), 0);
  assert.equal(wrapAngle(ANGLE_FULL), 0);
  assert.equal(wrapAngle(-1), ANGLE_FULL - 1);
  assert.equal(wrapAngle(ANGLE_FULL * 3 + 7), 7);
});

test('angleDelta takes the short way round', () => {
  assert.equal(angleDelta(0, 100), 100);
  assert.equal(angleDelta(100, 0), -100);
  assert.equal(angleDelta(0, 65535), -1);
  assert.equal(angleDelta(65535, 0), 1);
  assert.ok(Math.abs(angleDelta(0, 32768)) === 32768);
});

test('turnToward never overshoots and always arrives', () => {
  let heading = 0;
  for (let i = 0; i < 1000; i++) heading = turnToward(heading, 20000, 24);
  assert.equal(heading, 20000);
  assert.equal(turnToward(0, 10, 24), 10);
  assert.equal(turnToward(0, 65535, 24), 65535);
});

test('turnToward crosses the zero seam the short way', () => {
  assert.equal(turnToward(10, 65530, 24), 65530);
  assert.equal(turnToward(10, 65000, 24), 65522);
});

test('stepToward never overshoots and always arrives', () => {
  assert.equal(stepToward(0, 10, 3), 3);
  assert.equal(stepToward(9, 10, 3), 10);
  assert.equal(stepToward(0, -10, 3), -3);
  assert.equal(stepToward(-9, -10, 3), -10);
});
