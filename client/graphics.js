// client/graphics.js - the three presets, as data.
//
// Presets are a pure client concern: engine state and state hashes are
// identical on every tier, so a player on Low and a player on High are playing
// the same war and their hashes must match. Anything that would change the
// simulation does not belong in this file.

const PRESETS = {
  low: {
    label: 'Low',
    terrainGrid: 40,
    oceanShader: false,
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
    terrainGrid: 112,
    oceanShader: true,
    oceanSegments: 192,
    shadows: true,
    shadowMapSize: 2048,
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
