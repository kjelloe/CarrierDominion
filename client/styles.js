// client/styles.js - art direction, as data.
//
// Three candidate treatments of the same geometry, so the choice can be made
// by looking rather than by imagining. Nothing here touches the simulation:
// two players on different styles see the same war and the same state hash.
//
//   retro   the 1988 look. Black sky, hard horizon, flat-shaded facets, a
//           four-step land palette, amber instruments. Reads instantly and
//           ages well, because it is not pretending to be a photograph.
//   modern  atmospheric haze, smooth shading, a shader sea, cool instruments.
//           Comfortable and familiar; the risk is that it looks like every
//           other indie naval game.
//   hybrid  a remaster: modern sky and sea, faceted low-poly land, a
//           restrained palette, amber instruments. The shapes read like the
//           original, the light does not.
//
// `?style=retro|modern|hybrid` picks one.

const STYLES = {
  retro: {
    label: '1988',
    sky: 0x05070b,
    fogDensityScale: 0,
    horizonBand: true,
    oceanShader: false,
    oceanColour: 0x0a2a4a,
    oceanGrid: true,
    flatShading: true,
    paletteSteps: 4,
    sunIntensity: 0.55,
    hemiIntensity: 0.55,
    deck: 0x2b2f33,
    hudInk: '#ffb03a',
    hudDim: '#a06a14',
    hudPanel: 'rgba(0, 0, 0, 0.82)',
    hudFont: 'ui-monospace, "Courier New", monospace',
  },
  modern: {
    label: 'Modern',
    sky: 0x7ea6c4,
    fogDensityScale: 1,
    horizonBand: false,
    oceanShader: true,
    oceanColour: 0x123048,
    oceanGrid: false,
    flatShading: false,
    paletteSteps: 0,
    sunIntensity: 1.35,
    hemiIntensity: 1.15,
    deck: 0x424b55,
    hudInk: '#e8f2fb',
    hudDim: '#7f9fbb',
    hudPanel: 'rgba(8, 16, 26, 0.72)',
    hudFont: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
  },
  hybrid: {
    label: 'Remaster',
    sky: 0x5b7f9e,
    fogDensityScale: 0.6,
    horizonBand: false,
    oceanShader: true,
    oceanColour: 0x0e2c44,
    oceanGrid: false,
    flatShading: true,
    paletteSteps: 6,
    sunIntensity: 1.15,
    hemiIntensity: 0.95,
    deck: 0x3a434d,
    hudInk: '#ffc061',
    hudDim: '#8d7a55',
    hudPanel: 'rgba(6, 12, 20, 0.78)',
    hudFont: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
  },
};

// Owner ruling 2026-08-19: retro is the game's look. The other two stay
// switchable - they cost nothing to keep, and they are the reference when a
// new render feature has to be judged against something.
const DEFAULT_STYLE = 'retro';

function styleNames() {
  return ['retro', 'modern', 'hybrid'];
}

function styleFor(name) {
  return STYLES[name] ?? STYLES[DEFAULT_STYLE];
}

function resolveStyle(requested) {
  return styleNames().includes(requested) ? requested : DEFAULT_STYLE;
}

// Push the instrument colours into CSS so the overlay matches the scene.
function applyStyleToDocument(style, root) {
  root.style.setProperty('--hud-ink', style.hudInk);
  root.style.setProperty('--hud-dim', style.hudDim);
  root.style.setProperty('--hud-panel', style.hudPanel);
  root.style.setProperty('--hud-font', style.hudFont);
}

export { STYLES, DEFAULT_STYLE, styleNames, styleFor, resolveStyle, applyStyleToDocument };
