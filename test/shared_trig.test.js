import test from 'node:test';
import assert from 'node:assert/strict';

import { ANGLE_FULL, ANGLE_HALF, ANGLE_QUARTER, angleDelta, noNegZero } from '../shared/fixed.js';
import { SIN_ONE, atan2B, cosB, mulCos, mulSin, sinB } from '../shared/trig.js';

// The table is 1025 entries across a quadrant with linear interpolation
// between them, so the worst-case error is a few parts in 65536.
const TOLERANCE = 8;

test('sinB tracks Math.sin within table tolerance', () => {
  let worst = 0;
  for (let bam = 0; bam < ANGLE_FULL; bam += 7) {
    const expected = Math.round(Math.sin((bam / ANGLE_FULL) * Math.PI * 2) * SIN_ONE);
    const error = Math.abs(sinB(bam) - expected);
    if (error > worst) worst = error;
  }
  assert.ok(worst <= TOLERANCE, `worst sin error ${worst}`);
});

test('cosB tracks Math.cos within table tolerance', () => {
  let worst = 0;
  for (let bam = 0; bam < ANGLE_FULL; bam += 7) {
    const expected = Math.round(Math.cos((bam / ANGLE_FULL) * Math.PI * 2) * SIN_ONE);
    const error = Math.abs(cosB(bam) - expected);
    if (error > worst) worst = error;
  }
  assert.ok(worst <= TOLERANCE, `worst cos error ${worst}`);
});

test('cardinal angles are exact', () => {
  assert.equal(sinB(0), 0);
  assert.equal(sinB(ANGLE_QUARTER), SIN_ONE);
  assert.equal(sinB(ANGLE_HALF), 0);
  assert.equal(sinB(ANGLE_QUARTER * 3), -SIN_ONE);
  assert.equal(cosB(0), SIN_ONE);
  assert.equal(cosB(ANGLE_QUARTER), 0);
  assert.equal(cosB(ANGLE_HALF), -SIN_ONE);
});

test('sinB is odd and periodic', () => {
  for (let bam = 0; bam < ANGLE_FULL; bam += 137) {
    assert.equal(sinB(bam + ANGLE_FULL), sinB(bam));
    assert.equal(sinB(-bam), noNegZero(-sinB(bam)));
  }
});

test('sin^2 + cos^2 stays on the unit circle', () => {
  for (let bam = 0; bam < ANGLE_FULL; bam += 53) {
    const s = sinB(bam);
    const c = cosB(bam);
    const magnitude = Math.round(Math.sqrt(s * s + c * c));
    assert.ok(Math.abs(magnitude - SIN_ONE) <= 16, `|v| = ${magnitude} at ${bam}`);
  }
});

test('mulSin and mulCos scale a length without leaving the integers', () => {
  const length = 1000;
  assert.equal(mulCos(length, 0), length);
  assert.equal(mulSin(length, ANGLE_QUARTER), length);
  assert.equal(mulCos(length, ANGLE_HALF), -length);
  assert.ok(Number.isInteger(mulSin(length, 12345)));
});

test('atan2B inverts a heading', () => {
  let worst = 0;
  for (let bam = 0; bam < ANGLE_FULL; bam += 13) {
    const x = mulCos(1000000, bam);
    const y = mulSin(1000000, bam);
    const error = Math.abs(angleDelta(bam, atan2B(y, x)));
    if (error > worst) worst = error;
  }
  assert.ok(worst <= 8, `worst atan2 error ${worst} BAM`);
});

test('atan2B handles the axes and the origin', () => {
  assert.equal(atan2B(0, 100), 0);
  assert.equal(atan2B(100, 0), ANGLE_QUARTER);
  assert.equal(atan2B(0, -100), ANGLE_HALF);
  assert.equal(atan2B(-100, 0), ANGLE_QUARTER * 3);
  assert.equal(atan2B(0, 0), 0);
});
