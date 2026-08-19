// shared/fixed.js - integer fixed-point arithmetic for the deterministic engine.
//
// Conventions (plan-version1.md 2.2):
//   position/length : int32 fixed-point, UNIT = 256 units per metre
//   altitude        : same scale, 0 = ocean surface, positive = up
//   velocity        : units per tick (20 ticks/s)
//   angle           : 16-bit BAM, 0..65535, 0 = +X axis, growing counter-clockwise
//
// Every operation here is integer-only and must port to Luau unchanged.
// Luau numbers are IEEE doubles like JS, so the shared safety rule is the same:
// intermediate products must stay inside +/-2^53.

const UNIT = 256;
const UNIT_SHIFT_DIV = 256;

const ANGLE_FULL = 65536;
const ANGLE_HALF = 32768;
const ANGLE_QUARTER = 16384;

const I32_MIN = -2147483648;
const I32_MAX = 2147483647;

const MAX_EXACT = 9007199254740992; // 2^53

// Negative zero is poison in this codebase: it survives arithmetic, compares
// equal to 0 with ===, and yet Object.is and a few JSON round-trips can tell
// them apart. Every division normalises it away at the source.
function noNegZero(v) {
  return v === 0 ? 0 : v;
}

function idiv(a, b) {
  return noNegZero(Math.floor(a / b));
}

// Truncating division (toward zero). Use only where the sign asymmetry is
// intended; movement code wants floorDiv so that negative motion mirrors.
function truncDiv(a, b) {
  const q = a / b;
  return noNegZero(q < 0 ? Math.ceil(q) : Math.floor(q));
}

function floorDiv(a, b) {
  return noNegZero(Math.floor(a / b));
}

// Positive remainder regardless of sign, matching floorDiv.
function floorMod(a, b) {
  return a - Math.floor(a / b) * b;
}

function assertExact(product, label) {
  if (product > MAX_EXACT || product < -MAX_EXACT) {
    throw new RangeError(`${label} exceeds exact integer range: ${product}`);
  }
  return product;
}

// a * b where both are UNIT-scaled fixed-point; result is UNIT-scaled.
function mulFixed(a, b) {
  return floorDiv(assertExact(a * b, 'mulFixed'), UNIT);
}

// a / b where both are UNIT-scaled fixed-point; result is UNIT-scaled.
function divFixed(a, b) {
  if (b === 0) throw new RangeError('divFixed by zero');
  return floorDiv(assertExact(a * UNIT, 'divFixed'), b);
}

// (a * b) / c in one step, keeping the intermediate exact.
function mulDiv(a, b, c) {
  if (c === 0) throw new RangeError('mulDiv by zero');
  return floorDiv(assertExact(a * b, 'mulDiv'), c);
}

function toFixed(whole) {
  return whole * UNIT;
}

// Whole units, rounding toward negative infinity.
function toWhole(fixedValue) {
  return floorDiv(fixedValue, UNIT);
}

function clampI(value, lo, hi) {
  if (value < lo) return lo;
  if (value > hi) return hi;
  return value;
}

function signI(value) {
  if (value > 0) return 1;
  if (value < 0) return -1;
  return 0;
}

function absI(value) {
  return value < 0 ? -value : value;
}

// Integer square root, floor(sqrt(n)). Newton from a power-of-two seed so the
// iteration count is bounded and identical in every language.
function isqrt(n) {
  if (n < 0) throw new RangeError(`isqrt of negative: ${n}`);
  if (n < 2) return n;
  let guess = 1;
  while (guess * guess <= n) guess = guess * 2;
  for (let i = 0; i < 40; i++) {
    const next = idiv(guess + idiv(n, guess), 2);
    if (next >= guess) break;
    guess = next;
  }
  while (guess * guess > n) guess = guess - 1;
  while ((guess + 1) * (guess + 1) <= n) guess = guess + 1;
  return guess;
}

// Euclidean distance between two fixed-point points, in the same fixed scale.
// dx*dx overflows 2^53 past ~94 km at UNIT=256, so callers on world scale must
// pre-scale; the map is 32 km on a side, which fits.
function dist2D(ax, ay, bx, by) {
  const dx = ax - bx;
  const dy = ay - by;
  return isqrt(assertExact(dx * dx + dy * dy, 'dist2D'));
}

function distSq2D(ax, ay, bx, by) {
  const dx = ax - bx;
  const dy = ay - by;
  return assertExact(dx * dx + dy * dy, 'distSq2D');
}

function wrapAngle(angle) {
  return floorMod(angle, ANGLE_FULL);
}

// Shortest signed turn from -> to, in [-32768, 32767].
function angleDelta(from, to) {
  const d = floorMod(to - from, ANGLE_FULL);
  return d >= ANGLE_HALF ? d - ANGLE_FULL : d;
}

// Rotate `from` toward `to` by at most maxStep BAM.
function turnToward(from, to, maxStep) {
  const delta = angleDelta(from, to);
  if (delta > maxStep) return wrapAngle(from + maxStep);
  if (delta < -maxStep) return wrapAngle(from - maxStep);
  return wrapAngle(to);
}

// Move `value` toward `target` by at most maxStep.
function stepToward(value, target, maxStep) {
  const delta = target - value;
  if (delta > maxStep) return value + maxStep;
  if (delta < -maxStep) return value - maxStep;
  return target;
}

function assertI32(value, label) {
  if (!Number.isInteger(value) || value < I32_MIN || value > I32_MAX) {
    throw new RangeError(`${label} not an int32: ${value}`);
  }
  return value;
}

export {
  noNegZero,
  UNIT,
  UNIT_SHIFT_DIV,
  ANGLE_FULL,
  ANGLE_HALF,
  ANGLE_QUARTER,
  I32_MIN,
  I32_MAX,
  idiv,
  truncDiv,
  floorDiv,
  floorMod,
  mulFixed,
  divFixed,
  mulDiv,
  toFixed,
  toWhole,
  clampI,
  signI,
  absI,
  isqrt,
  dist2D,
  distSq2D,
  wrapAngle,
  angleDelta,
  turnToward,
  stepToward,
  assertI32,
};
