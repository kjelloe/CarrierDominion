// client/render/waternormals.js - the mirror water's normal map, generated.
//
// The reference scene (docs/07-graphics.md §3) sampled waternormals.jpg; we
// ship no external textures, so the texture is computed: a sum of sines with
// INTEGER frequencies over [0,1)² - an integer frequency completes whole
// cycles across the tile, so the sum tiles perfectly with no seam to hide.
// Slopes are normalised so the steepest texel is a fixed maximum; the result
// is encoded tangent-space (x,y slopes in red/green, up in blue), which is
// what Water.js's getNoise() expects to sample.
//
// Deterministic from a fixed seed, so every client generates the identical
// texture - not for the simulation's sake (this is cosmetic, floats are fine
// here) but so two machines' screenshots stay comparable.

import * as THREE from 'three';

const SIZE = 256;
const WAVE_COUNT = 26;
// Steepest slope after normalisation. Past ~0.6 the distorted reflection
// starts tearing; the reference scene settled on 0.55.
const MAX_SLOPE = 0.55;
const SEED = 20260818;

function createWaterNormals() {
  // A small LCG: three.js's MathUtils has no seeded generator, and this needs
  // exactly "the same 26 waves every time", nothing statistical.
  let s = SEED >>> 0;
  const rand = () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };

  const waves = [];
  for (let i = 0; i < WAVE_COUNT; i++) {
    // Integer frequencies 1..12 per axis, signs mixed so the waves travel in
    // all four diagonal families rather than marching one way.
    const fx = (1 + Math.floor(rand() * 12)) * (rand() < 0.5 ? -1 : 1);
    const fy = 1 + Math.floor(rand() * 12);
    // Rough ocean spectrum: long waves carry the height, short ones the glint.
    const amplitude = 1 / (1 + Math.hypot(fx, fy));
    const phase = rand() * Math.PI * 2;
    waves.push({ fx: fx, fy: fy, amplitude: amplitude, phase: phase });
  }

  // Analytic slopes of the height field at each texel, then one normalisation
  // pass so MAX_SLOPE means what it says whatever the random draw produced.
  const slopeX = new Float32Array(SIZE * SIZE);
  const slopeY = new Float32Array(SIZE * SIZE);
  let steepest = 0;
  const TAU = Math.PI * 2;
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const u = x / SIZE;
      const v = y / SIZE;
      let sx = 0;
      let sy = 0;
      for (const wave of waves) {
        const c = wave.amplitude * Math.cos(TAU * (wave.fx * u + wave.fy * v) + wave.phase);
        sx += TAU * wave.fx * c;
        sy += TAU * wave.fy * c;
      }
      const index = y * SIZE + x;
      slopeX[index] = sx;
      slopeY[index] = sy;
      const magnitude = Math.max(Math.abs(sx), Math.abs(sy));
      if (magnitude > steepest) steepest = magnitude;
    }
  }

  const scale = steepest > 0 ? MAX_SLOPE / steepest : 0;
  const data = new Uint8Array(SIZE * SIZE * 4);
  for (let i = 0; i < SIZE * SIZE; i++) {
    const sx = slopeX[i] * scale;
    const sy = slopeY[i] * scale;
    const inverse = 1 / Math.sqrt(sx * sx + sy * sy + 1);
    data[i * 4] = Math.round((-sx * inverse * 0.5 + 0.5) * 255);
    data[i * 4 + 1] = Math.round((-sy * inverse * 0.5 + 0.5) * 255);
    data[i * 4 + 2] = Math.round((inverse * 0.5 + 0.5) * 255);
    data[i * 4 + 3] = 255;
  }

  const texture = new THREE.DataTexture(data, SIZE, SIZE, THREE.RGBAFormat);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}

export { createWaterNormals };
