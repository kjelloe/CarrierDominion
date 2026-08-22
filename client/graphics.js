// client/graphics.js - the three presets, as data.
//
// Presets are a pure client concern: engine state and state hashes are
// identical on every tier, so a player on Low and a player on High are playing
// the same war and their hashes must match. Anything that would change the
// simulation does not belong in this file.

// The tier targets are real hardware (docs/07-graphics.md): Low is mobile and
// integrated GPUs (the true mobile pass is deferred), Medium is the pinned
// reference look, High is an RTX 4070/5070-class desktop. Tiers touch terrain,
// sea, models and lighting - never the interface, never the simulation.
//
// `oceanDetail` is the High-only water fragment path: an analytic-normal
// ripple field, fresnel toward the style's sky, and a sun glint. The vertex
// swell is identical to Medium on purpose, so Medium's pixels do not drift.
const PRESETS = {
  low: {
    label: 'Low',
    terrainGrid: 40,
    oceanShader: false,
    oceanDetail: false,
    oceanSegments: 1,
    shadows: false,
    shadowMapSize: 0,
    pixelRatioCap: 1,
    antialias: false,
    fogDensity: 0.00006,
    drawDistanceMetres: 12000,
  },
  medium: {
    label: 'Medium',
    terrainGrid: 72,
    oceanShader: true,
    oceanDetail: false,
    oceanSegments: 64,
    shadows: true,
    shadowMapSize: 1024,
    pixelRatioCap: 1.5,
    antialias: true,
    fogDensity: 0.00004,
    drawDistanceMetres: 20000,
  },
  high: {
    label: 'High',
    terrainGrid: 144,
    oceanShader: true,
    oceanDetail: true,
    oceanSegments: 256,
    shadows: true,
    shadowMapSize: 4096,
    pixelRatioCap: 2,
    antialias: true,
    fogDensity: 0.00003,
    drawDistanceMetres: 30000,
  },
};

const STORAGE_KEY = 'carrier-dominion.graphics';

function presetNames() {
  return ['low', 'medium', 'high'];
}

function readOverride(storage) {
  try {
    const stored = storage.getItem(STORAGE_KEY);
    return presetNames().includes(stored) ? stored : '';
  } catch {
    return '';
  }
}

function writeOverride(storage, level) {
  try {
    if (level === '') storage.removeItem(STORAGE_KEY);
    else storage.setItem(STORAGE_KEY, level);
  } catch { /* private browsing: the auto-detected tier still works */ }
}

// The override wins, then the auto-detected suggestion, then medium.
function resolveGraphics(suggested, override) {
  if (presetNames().includes(override)) return { level: override, source: 'override' };
  if (presetNames().includes(suggested)) return { level: suggested, source: 'auto' };
  return { level: 'medium', source: 'default' };
}

function presetFor(level) {
  return PRESETS[level] ?? PRESETS.medium;
}

export { PRESETS, STORAGE_KEY, presetNames, presetFor, resolveGraphics, readOverride, writeOverride };
