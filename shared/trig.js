// shared/trig.js - integer trigonometry over 16-bit BAM angles.
//
// Angles: 0..65535, 0 = +X, increasing counter-clockwise, 16384 = +Y.
// sinB/cosB return a fixed-point value scaled by SIN_ONE (65536 == 1.0).
// Values come from the committed table in trig_table.js with integer linear
// interpolation between entries; Math.sin is never called at runtime.

import { ANGLE_FULL, ANGLE_HALF, ANGLE_QUARTER, floorDiv, noNegZero, wrapAngle } from './fixed.js';
import { SIN_ONE, SIN_STEP, ATAN_STEPS, ATAN_STRIDE, SIN_TABLE, ATAN_TABLE } from './trig_table.js';

// Interpolated sin for one quadrant, r in [0, ANGLE_QUARTER].
function quadrantSin(r) {
  const i = floorDiv(r, SIN_STEP);
  const f = r - i * SIN_STEP;
  if (f === 0) return SIN_TABLE[i];
  const lo = SIN_TABLE[i];
  const hi = SIN_TABLE[i + 1];
  return lo + floorDiv((hi - lo) * f, SIN_STEP);
}

function sinB(angle) {
  const w = wrapAngle(angle);
  const quad = floorDiv(w, ANGLE_QUARTER);
  const r = w - quad * ANGLE_QUARTER;
  if (quad === 0) return quadrantSin(r);
  if (quad === 1) return quadrantSin(ANGLE_QUARTER - r);
  if (quad === 2) return noNegZero(-quadrantSin(r));
  return noNegZero(-quadrantSin(ANGLE_QUARTER - r));
}

function cosB(angle) {
  return sinB(angle + ANGLE_QUARTER);
}

// value * sin(angle), keeping the result in the caller's scale.
function mulSin(value, angle) {
  return floorDiv(value * sinB(angle), SIN_ONE);
}

function mulCos(value, angle) {
  return floorDiv(value * cosB(angle), SIN_ONE);
}

// atan(num/den) in BAM, requires 0 <= num <= den and den > 0.
function atanCore(num, den) {
  const scaled = floorDiv(num * ATAN_STEPS, den);
  const i = floorDiv(scaled, ATAN_STRIDE);
  const f = scaled - i * ATAN_STRIDE;
  if (f === 0) return ATAN_TABLE[i];
  const lo = ATAN_TABLE[i];
  const hi = ATAN_TABLE[i + 1];
  return lo + floorDiv((hi - lo) * f, ATAN_STRIDE);
}

// Heading of the vector (x, y) in BAM. (0, 0) is defined as 0 rather than an
// error: callers ask for the bearing to a coincident point often enough.
function atan2B(y, x) {
  if (x === 0 && y === 0) return 0;
  const ax = x < 0 ? -x : x;
  const ay = y < 0 ? -y : y;
  const base = ax >= ay ? atanCore(ay, ax) : ANGLE_QUARTER - atanCore(ax, ay);
  if (x >= 0 && y >= 0) return wrapAngle(base);
  if (x < 0 && y >= 0) return wrapAngle(ANGLE_HALF - base);
  if (x < 0) return wrapAngle(ANGLE_HALF + base);
  return wrapAngle(ANGLE_FULL - base);
}

export { SIN_ONE, sinB, cosB, mulSin, mulCos, atan2B };
