// shared/noise.js - integer value noise. Same function on the server, in the
// solo in-browser engine, and in the client mesher, so terrain never disagrees
// between what the physics thinks and what the player sees.
//
// All lattice coordinates must satisfy |g| < 32768 (they are folded onto an
// unsigned 16-bit range before hashing, which keeps the Luau bit32 port simple).

import { floorDiv, mulDiv } from './fixed.js';
import { mul32 } from './prng.js';

const NOISE_ONE = 65536; // noise output scale: 0..65535
const SMOOTH_ONE = 1024; // interpolation fraction scale

function fold16(v) {
  return ((v + 32768) % 65536 + 65536) % 65536;
}

// Deterministic 0..65535 value at an integer lattice point.
function hashLattice(seed, gx, gy) {
  const ux = fold16(gx);
  const uy = fold16(gy);
  let h = (seed + mul32(ux, 374761393) + mul32(uy, 668265263)) % 4294967296;
  h = (h ^ (h >>> 13)) >>> 0;
  h = mul32(h, 1274126177);
  h = (h ^ (h >>> 16)) >>> 0;
  return h % NOISE_ONE;
}

// 3f^2 - 2f^3 on the SMOOTH_ONE scale.
function smoothstep(f) {
  return floorDiv(f * f * (3 * SMOOTH_ONE - 2 * f), SMOOTH_ONE * SMOOTH_ONE);
}

function lerpI(a, b, t) {
  return a + floorDiv((b - a) * t, SMOOTH_ONE);
}

// Value noise in [0, 65535] at fixed-point position (x, y) with the given
// lattice cell size, also in fixed-point units.
function valueNoise2(seed, x, y, cellSize) {
  const gx = floorDiv(x, cellSize);
  const gy = floorDiv(y, cellSize);
  const fx = smoothstep(mulDiv(x - gx * cellSize, SMOOTH_ONE, cellSize));
  const fy = smoothstep(mulDiv(y - gy * cellSize, SMOOTH_ONE, cellSize));
  const h00 = hashLattice(seed, gx, gy);
  const h10 = hashLattice(seed, gx + 1, gy);
  const h01 = hashLattice(seed, gx, gy + 1);
  const h11 = hashLattice(seed, gx + 1, gy + 1);
  const top = lerpI(h00, h10, fx);
  const bottom = lerpI(h01, h11, fx);
  return lerpI(top, bottom, fy);
}

// Fractal sum, octaves halving the cell size and the amplitude. Result is
// normalised back to [0, 65535].
function fbm2(seed, x, y, cellSize, octaves) {
  let total = 0;
  let amplitude = NOISE_ONE;
  let normalisation = 0;
  let cell = cellSize;
  for (let i = 0; i < octaves; i++) {
    const sample = valueNoise2(seed + i * 7919, x, y, cell);
    total = total + floorDiv(sample * amplitude, NOISE_ONE);
    normalisation = normalisation + amplitude;
    amplitude = floorDiv(amplitude, 2);
    cell = floorDiv(cell, 2);
    if (cell < 1 || amplitude < 1) break;
  }
  if (normalisation < 1) return 0;
  return mulDiv(total, NOISE_ONE - 1, normalisation);
}

export { NOISE_ONE, hashLattice, valueNoise2, fbm2 };
