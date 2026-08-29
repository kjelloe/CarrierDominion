// client/render/weathersky.js - the cloud deck and the near-field swell.
//
// Two pieces of High-tier scenery driven by shared/weather.js (owner's ask,
// 2026-08-26). Both are purely cosmetic: engine sea level is exactly z = 0,
// the swell never touches it, and no material here is ever asked what the
// war thinks.
//
// THE CLOUD DECK is one big horizontal plane a long way up, with an fBm
// shader on it. Coverage, colour and darkness all come from the weather, so
// the same function that makes the sea rough makes the sky close in. It
// drifts with the wind, because a cloud deck that ignores the wind while the
// waves obey it reads as two unrelated animations.
//
// THE SWELL is the answer to "the mirror sea is geometrically flat". It is a
// displaced patch that FOLLOWS THE CAMERA: about a kilometre and a half of
// real Gerstner waves under the eye, fading out at its rim into the mirror
// plane that runs to the horizon. That is the standard trick, and it is the
// only way to have both real waves near the ship and real reflections far
// from it without a projected grid.

import * as THREE from '../vendor/three.module.min.js';

// The deck is drawn on a SHELL around the eye, not on a plane above it, and
// this is the whole trick: a flat plane 2.6 km up is only visible when you
// look up, and a chase camera looking at the horizon never does - the deck
// sat beyond the far plane at every angle the player actually sees. On a
// shell, each fragment projects its own view ray onto a VIRTUAL deck at
// CLOUD_HEIGHT, so the cloud converges at the horizon the way cloud does,
// at every elevation, with no far plane to fall off.
const CLOUD_HEIGHT = 2200;

// How dark a storm's cloud base is allowed to get. Slate, not soot.
const STORM_CLOUD_FLOOR = new THREE.Color(0x424b59);
const SHELL_RADIUS = 8000;

const CLOUD_VERTEX = `
  varying vec3 vRay;
  void main() {
    // The direction from the eye to this bit of shell, in world space. The
    // shell rides the camera, so this is exactly the view ray.
    vRay = (modelMatrix * vec4(position, 1.0)).xyz - cameraPosition;
    gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0);
  }
`;

// Cloud is SHAPE, not a smear. The first version was a four-octave value
// fBm sampled at one low frequency, and it looked exactly like that: soft
// airbrushed blobs with no edge, no billow and no inside. Three things fix
// it, and they are the three things every convincing procedural cloud does.
//
//   1. DOMAIN WARPING. Sampling the noise at a position that has itself been
//      displaced by noise is what turns round blobs into curling, torn,
//      wind-sheared shapes. It is the single biggest difference here.
//   2. MORE OCTAVES, and a base frequency high enough that the fine ones are
//      visible rather than smeared across ten kilometres of deck.
//   3. LIGHT FROM A DIRECTION. A cloud lit flatly is a stain. Sampling the
//      density a short way TOWARD THE SUN and comparing gives the bright rim
//      where the deck thins into the light - the silver lining - for the cost
//      of one extra sample, plus a forward-scatter glow near the sun itself.
const CLOUD_FRAGMENT = `
  precision highp float;
  uniform float uTime;
  uniform vec2 uDrift;
  uniform float uCover;
  uniform float uStorm;
  uniform float uFlash;
  uniform vec3 uLight;
  uniform vec3 uDark;
  uniform vec3 uHaze;
  uniform vec3 uSunDir;
  varying vec3 vRay;

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
  }
  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
               mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
  }
  // Three octaves for the warp field - it only needs to be lumpy, not
  // detailed - and five for the cloud itself.
  float fbm3(vec2 p) {
    float v = 0.0;
    float a = 0.5;
    for (int i = 0; i < 3; i++) { v += a * noise(p); p = p * 2.07; a *= 0.5; }
    return v;
  }
  float fbm5(vec2 p) {
    float v = 0.0;
    float a = 0.5;
    for (int i = 0; i < 5; i++) { v += a * noise(p); p = p * 2.03; a *= 0.5; }
    return v;
  }
  float density(vec2 p) {
    // The warp. Two decorrelated fbm fields displace the sample point; the
    // offsets are the usual arbitrary large constants, there to keep the two
    // fields from being the same field.
    vec2 q = vec2(fbm3(p + vec2(1.7, 9.2)), fbm3(p + vec2(8.3, 2.8)));
    return fbm5(p + q * 1.35);
  }

  void main() {
    vec3 dir = normalize(vRay);
    // Where this ray meets the deck, RELATIVE TO THE EYE. Getting this wrong
    // is how the strategic view - which flies well above the cloud - ended up
    // with a brown dome pasted over the whole archipelago: the first version
    // assumed the eye was always underneath.
    float rel = ${CLOUD_HEIGHT.toFixed(1)} - cameraPosition.y;
    // Right AT the sea line the deck is pure haze rather than nothing: a gap
    // here let the Preetham dome show a bright strip under a storm sky, and
    // the strip is exactly where the eye rests.
    if (abs(dir.y) <= 0.0004) discard;
    float t = rel / dir.y;
    // Behind the eye: this ray never reaches the deck at all.
    if (t <= 0.0) discard;
    // A ray that grazes the deck lands absurdly far out; clamp it so the
    // noise keeps its precision and the horizon does not smear.
    t = min(t, 90000.0);
    vec2 at = dir.xz * t;

    vec2 p = at * 0.00062 + uDrift * uTime * 0.006;
    float n = density(p);
    // Coverage is a threshold on the noise, so "a few light clouds" and "an
    // overcast that has made its mind up" are the same field at two cuts.
    // The floor stops short of total: a deck with no break in it is
    // indistinguishable from a grey backdrop, and the breaks are what tell
    // you it is cloud at all.
    float edge = mix(0.72, 0.28, uCover);
    float mask = smoothstep(edge, edge + 0.10, n);
    if (mask <= 0.002) discard;

    // Thicker cloud is darker cloud, and a storm drags the whole deck toward
    // the grey-blue the owner asked for.
    float thick = smoothstep(edge, edge + 0.26, n);
    vec3 colour = mix(uLight, uDark, thick * (0.35 + 0.65 * uStorm));

    // The silver lining: density a short step TOWARD the sun. Where the deck
    // thins in that direction the light is coming through, and that edge is
    // most of what makes cloud read as three-dimensional rather than painted.
    vec2 toSun = normalize(uSunDir.xz + vec2(0.0001, 0.0));
    float ahead = density(p + toSun * 0.055);
    // A storm still has structure - it is a dark sky, not an absent one - so
    // the rim is dimmed rather than switched off.
    float rim = clamp((n - ahead) * 2.6, 0.0, 1.0) * (1.0 - uStorm * 0.35);
    colour += uLight * rim * 0.55 * mask;
    // And forward scatter: the deck glows where the sun is behind it.
    float facing = max(0.0, dot(dir, normalize(uSunDir)));
    colour += uLight * pow(facing, 7.0) * (1.0 - thick * 0.7) * 0.45;

    // A stroke lights the deck from inside.
    colour += vec3(0.85, 0.88, 1.0) * uFlash * (0.35 + 0.65 * thick);

    // At the horizon the deck does not fade to nothing - it becomes the
    // HAZE. Fading alpha there left a pink Preetham band under a storm sky,
    // because the dome is not fogged and the weather never reached it. Going
    // to the fog colour instead makes the sea, the far islands and the sky
    // all agree about what the air is doing, which is the whole difference
    // between "grey clouds" and "weather".
    float horizon = smoothstep(0.0004, 0.022, abs(dir.y));
    colour = mix(uHaze, colour, horizon);
    // Seen from ABOVE - the strategic pull-back flies over the weather - the
    // deck thins to a hint. That view is a command view, not a window: a
    // storm that hides which side holds which island is a storm that costs
    // the player the war for a picture.
    float above = step(0.0, cameraPosition.y - ${CLOUD_HEIGHT.toFixed(1)});
    // In the middle of a squall the deck is solid. Leaving the mask alone
    // let ~20% of the Preetham dome through, and a low sun behind a storm is
    // the brightest thing in the sky - so a storm read as a warm pale band
    // sitting exactly where the eye rests.
    float body = mix(mask, 1.0, uStorm * 0.85) * (0.55 + 0.45 * uCover);
    float lowHaze = (1.0 - horizon) * uCover * uCover;
    float alpha = clamp(max(body * horizon, lowHaze), 0.0, 1.0) * mix(1.0, 0.20, above);
    gl_FragColor = vec4(colour, alpha);
  }
`;

function buildClouds(sizeMetres) {
  const geometry = new THREE.SphereGeometry(SHELL_RADIUS, 32, 16);
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uDrift: { value: new THREE.Vector2(1, 0) },
      uCover: { value: 0.2 },
      uStorm: { value: 0 },
      uFlash: { value: 0 },
      uLight: { value: new THREE.Color(0xfdfbf6) },
      uDark: { value: new THREE.Color(0x39434f) },
      uHaze: { value: new THREE.Color(0x9fb3c4) },
      uSunDir: { value: new THREE.Vector3(0.4, 0.6, 0.35) },
    },
    vertexShader: CLOUD_VERTEX,
    fragmentShader: CLOUD_FRAGMENT,
    transparent: true,
    depthWrite: false,
    side: THREE.BackSide,
    // The deck is the distance: it must not be fogged, and it must not be
    // depth-tested against a world it is notionally behind.
    fog: false,
    depthTest: false,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(sizeMetres / 2, 0, -sizeMetres / 2);
  // First among the transparent things, and behind everything solid.
  mesh.renderOrder = -1;
  mesh.frustumCulled = false;
  mesh.name = 'clouds';
  return mesh;
}

function updateClouds(view3d, weather, sky, deltaSeconds) {
  const uniforms = view3d.clouds.material.uniforms;
  uniforms.uTime.value = view3d.elapsed;
  uniforms.uCover.value = sky.cloud;
  uniforms.uStorm.value = sky.storm;
  uniforms.uFlash.value = sky.flash;
  const bam = (weather.windBam / 65536) * Math.PI * 2;
  uniforms.uDrift.value.set(Math.cos(bam), -Math.sin(bam));
  // The deck picks up the light it stands in, so dawn cloud is pink and
  // midnight cloud is nearly the sea.
  uniforms.uLight.value.copy(sky.lightColour).lerp(new THREE.Color(0xffffff), 0.55);
  // Except in a storm, where there is no lit side: a squall's cloud base is
  // grey all the way through. Without this the near-white "lit" colour was
  // the brightest thing in a storm frame and the whole sky read warm.
  uniforms.uLight.value.lerp(sky.fogColour, sky.storm * 0.78);
  // The dark side of the cloud, with a FLOOR. Straight fog colour times 0.75
  // in a storm - where the fog itself is nearly black - gave a squall an
  // unreadable black ceiling: no shape, no billow, nothing to look at. A
  // storm sky is dark, not absent, so the darkest cloud is lifted toward a
  // slate grey as the storm builds.
  uniforms.uDark.value.copy(sky.fogColour).multiplyScalar(0.95);
  uniforms.uDark.value.lerp(STORM_CLOUD_FLOOR, sky.storm * 0.7);
  // The haze at the sea line IS the fog, so the whole horizon agrees.
  uniforms.uHaze.value.copy(sky.fogColour);
  uniforms.uSunDir.value.copy(view3d.sunDir);
  // The shell rides the eye, so the view ray in the vertex shader is exact
  // and the cloud never has an edge to come round.
  view3d.clouds.position.copy(view3d.camera.position);
  return deltaSeconds;
}

// --- the swell -------------------------------------------------------------

const SWELL_SPAN = 1500;

// A SEA IS A SPECTRUM, not a few waves. The first version ran four Gerstner
// components all within a few degrees of the wind, and it read exactly as
// that is: corduroy. Parallel ridges of one size, marching. The owner's word
// for it was "uniform", which is the right word.
//
// What a real sea has, and what this now has:
//
//   * MANY components (twelve), at wavelengths spaced geometrically from a
//     210 m swell down to 4.5 m chop, each jittered so no two share a factor
//     and the pattern never closes.
//   * DIRECTIONAL SPREAD. This is the part that was missing. Long swell runs
//     with the wind because it was raised by a wind that has been blowing a
//     while somewhere else; the short chop fans out to either side. So the
//     spread grows with frequency: the 210 m swell sits within ~7 degrees of
//     the wind, the 4.5 m chop as much as 80 degrees off it. Crossing wave
//     trains are what make water look alive rather than combed.
//   * An AMPLITUDE SPECTRUM. Height goes as wavelength^0.75, so the long
//     waves carry the shape of the sea and the short ones only texture it.
//
// The reference scene reached the same conclusion from the other end: its
// normal map is a sum of 26 waves in mixed directions (suntest/qwen38,
// createWaterNormalsTexture). Ours is the same idea in geometry.
const SWELL_WAVES = 12;
const SWELL_LONGEST = 210;
const SWELL_SHORTEST = 4.5;
const SWELL_SEED = 20260827;

// Built once, on the CPU, deterministically - two machines must draw the same
// sea for a screenshot to be worth comparing.
function buildWaveSpectrum() {
  let s = SWELL_SEED >>> 0;
  const rand = () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
  const waves = [];
  let total = 0;
  for (let i = 0; i < SWELL_WAVES; i++) {
    const t = i / (SWELL_WAVES - 1);
    // Geometric spacing, jittered: neighbouring wavelengths in a harmonic
    // ratio beat against each other and the beat is visible as a repeat.
    const wavelength = SWELL_LONGEST
      * Math.pow(SWELL_SHORTEST / SWELL_LONGEST, t)
      * (0.85 + rand() * 0.3);
    // Spread grows with frequency (see above): swell hugs the wind, chop fans.
    const spread = (0.08 + 0.92 * t) * (Math.PI / 2);
    const angle = (rand() * 2 - 1) * spread;
    const amp = Math.pow(wavelength / SWELL_LONGEST, 0.75);
    total += amp;
    waves.push({ angle: angle, wavelength: wavelength, amp: amp, phase: rand() * Math.PI * 2 });
  }
  // Normalise so uHeight means the height of the SEA, not of one wave.
  const packed = [];
  const phases = [];
  for (const wave of waves) {
    packed.push(new THREE.Vector4(
      Math.cos(wave.angle),
      Math.sin(wave.angle),
      wave.wavelength,
      wave.amp / total,
    ));
    phases.push(wave.phase);
  }
  return { packed: packed, phases: phases };
}

const SWELL_VERTEX = `
  uniform float uTime;
  uniform vec2 uWind;
  uniform float uHeight;
  uniform float uChop;
  // rotation cos, rotation sin, wavelength, amplitude share.
  uniform vec4 uWave[${SWELL_WAVES}];
  uniform float uPhase[${SWELL_WAVES}];
  varying vec3 vWorld;
  varying vec3 vNormal2;
  varying float vFade;
  varying float vLift;

  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vec2 pos = world.xz;
    vec3 offset = vec3(0.0);
    vec3 normal = vec3(0.0, 1.0, 0.0);
    vec2 wind = normalize(uWind);

    for (int i = 0; i < ${SWELL_WAVES}; i++) {
      vec4 w = uWave[i];
      // Each component's direction is its own fixed angle FROM THE WIND, so
      // the whole sea swings together as the wind turns instead of the
      // spectrum re-rolling.
      vec2 d = vec2(wind.x * w.x - wind.y * w.y, wind.x * w.y + wind.y * w.x);
      float k = 6.28318530718 / w.z;
      float c = sqrt(9.81 / k);
      float a = uHeight * w.w;
      float f = k * (dot(d, pos) - c * uTime) + uPhase[i];
      // Gerstner Q, shared across the whole spectrum so the crests sharpen
      // without the surface ever folding through itself.
      float q = uChop / (k * a * float(${SWELL_WAVES}));
      float cf = cos(f);
      float sf = sin(f);
      offset.x += q * a * d.x * cf;
      offset.z += q * a * d.y * cf;
      offset.y += a * sf;
      float wa = k * a;
      normal.x -= d.x * wa * cf;
      normal.z -= d.y * wa * cf;
      normal.y -= q * wa * sf;
    }

    // Fade the patch out at its rim so it meets the flat mirror sea without
    // a visible step. This is the whole reason the trick works.
    vec2 local = position.xy;
    float edge = max(abs(local.x), abs(local.y)) / ${(SWELL_SPAN / 2).toFixed(1)};
    vFade = 1.0 - smoothstep(0.62, 1.0, edge);

    world.xyz += offset * vFade;
    // How high this bit of water is standing, normalised against the sea's
    // own height. The fragment needs it for the light that comes THROUGH a
    // wave rather than off it.
    vLift = clamp(offset.y / max(0.35, uHeight), -1.0, 1.0) * 0.5 + 0.5;
    vWorld = world.xyz;
    vNormal2 = normalize(mix(vec3(0.0, 1.0, 0.0), normalize(normal), vFade));
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const SWELL_FRAGMENT = `
  precision highp float;
  uniform vec3 uDeep;
  uniform vec3 uSky;
  uniform vec3 uSunDir;
  uniform vec3 uSunColour;
  uniform float uStorm;
  uniform float uWindStrength;
  uniform float uTime;
  uniform vec2 uWind;
  uniform vec3 uScatter;
  varying vec3 vWorld;
  varying vec3 vNormal2;
  varying float vFade;
  varying float vLift;

  float rhash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
  }
  float rnoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(rhash(i), rhash(i + vec2(1.0, 0.0)), u.x),
               mix(rhash(i + vec2(0.0, 1.0)), rhash(i + vec2(1.0, 1.0)), u.x), u.y);
  }

  // The ripple the GEOMETRY cannot carry. At 256 segments across 1500 m the
  // vertices are six metres apart, so everything shorter than a six-metre
  // wave - which is all of the glitter - has to live in the normal. Without
  // it the sea between crests is a mirror-smooth facet and reads as plastic.
  vec3 ripple(vec2 pos, float t) {
    vec2 drift = normalize(uWind) * t;
    float e = 0.35;
    vec2 q = pos * 0.55 - drift * 1.1;
    float h1 = rnoise(q);
    float hx = rnoise(q + vec2(e, 0.0));
    float hy = rnoise(q + vec2(0.0, e));
    vec2 q2 = pos * 1.9 + drift * 0.7;
    float h2 = rnoise(q2);
    float hx2 = rnoise(q2 + vec2(e, 0.0));
    float hy2 = rnoise(q2 + vec2(0.0, e));
    // Strength rides the wind: glassy water is glassy.
    float amp = 0.06 + 0.26 * uWindStrength;
    return vec3(-( (hx - h1) + 0.5 * (hx2 - h2) ) * amp,
                 0.0,
                -( (hy - h1) + 0.5 * (hy2 - h2) ) * amp);
  }

  void main() {
    vec3 n = normalize(vNormal2 + ripple(vWorld.xz, uTime) * vFade);
    vec3 eye = normalize(cameraPosition - vWorld);
    float fres = pow(1.0 - max(0.0, dot(n, eye)), 4.0);
    vec3 colour = mix(uDeep, uSky, clamp(fres * 0.9, 0.0, 1.0));
    // A diffuse term and a floor. Fresnel alone put every wave face that
    // pointed away from the eye at the deep colour, so a swell read as black
    // terraces with grey tops instead of as water.
    float lambert = 0.45 + 0.55 * max(0.0, dot(n, normalize(uSunDir)));
    colour = colour * (0.55 + 0.45 * lambert) + uSky * 0.18;
    // LIGHT THROUGH THE WAVE. This is the thing that separates water from a
    // shiny surface: on the far side of a crest from the sun, the sun is
    // coming THROUGH the water and the wave glows from inside, greener and
    // brighter than any reflection. It needs three things at once - a raised
    // piece of water, the sun roughly behind it, and the eye roughly facing
    // it - which is exactly when a real swell lights up.
    float through = pow(max(0.0, dot(eye, -normalize(uSunDir))), 3.0);
    float lifted = smoothstep(0.5, 1.0, vLift);
    colour += uScatter * through * lifted * (0.35 + 0.65 * uWindStrength) * vFade;
    // Troughs are deeper water and read darker; without this the sea is one
    // tone with ripples drawn on it.
    colour *= 0.82 + 0.18 * smoothstep(0.0, 1.0, vLift);

    // Sun glint, and white water on the steep faces when it blows.
    float spec = pow(max(0.0, dot(reflect(-uSunDir, n), eye)), 90.0);
    colour += uSunColour * spec * 0.9;
    // Whitecaps break on STEEPNESS, and steepness comes from wind long before
    // it comes from a storm - keying them to uStorm alone left a fresh breeze
    // looking like a millpond right up until the squall arrived.
    //
    // But the test is on the WAVE, not on the ripple. Using the perturbed
    // normal meant every centimetre of fine chop counted as a breaking crest
    // and a gale turned the whole sea white - brighter than noon, which is
    // the one thing a storm sea is not. Real whitecaps are sparse: a fraction
    // of the surface even in a gale, on the steep faces of the big waves
    // only.
    vec3 waveNormal = normalize(vNormal2);
    float steep = smoothstep(0.62, 0.95, 1.0 - waveNormal.y);
    float foam = steep * smoothstep(0.35, 0.95, uWindStrength);
    colour = mix(colour, vec3(0.92, 0.95, 0.98), clamp(foam * (0.45 + 0.4 * uStorm), 0.0, 0.6));
    // Alpha carries the rim fade, so the mirror sea shows through at the
    // edge rather than the patch ending in a line.
    gl_FragColor = vec4(colour, vFade);
  }
`;

function buildSwell(preset) {
  const spectrum = buildWaveSpectrum();
  const segments = preset.oceanSegments >= 256 ? 256 : 128;
  const geometry = new THREE.PlaneGeometry(SWELL_SPAN, SWELL_SPAN, segments, segments);
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uWind: { value: new THREE.Vector2(1, 0) },
      uHeight: { value: 0.3 },
      uChop: { value: 0.4 },
      uWave: { value: spectrum.packed },
      uPhase: { value: spectrum.phases },
      uDeep: { value: new THREE.Color(0x0b2a3a) },
      uSky: { value: new THREE.Color(0x9fc4dd) },
      uSunDir: { value: new THREE.Vector3(0.4, 0.6, 0.35) },
      uSunColour: { value: new THREE.Color(0xfff2df) },
      uStorm: { value: 0 },
      uWindStrength: { value: 0 },
      uScatter: { value: new THREE.Color(0x1d5c52) },
    },
    vertexShader: SWELL_VERTEX,
    fragmentShader: SWELL_FRAGMENT,
    transparent: true,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = 0.05;
  mesh.renderOrder = 1;
  mesh.name = 'swell';
  return mesh;
}

// Height in metres, by weather. A glassy calm is not flat - the sea always
// breathes - and a full gale is about four metres, which at our scale is a
// Walrus disappearing into a trough.
function swellHeightOf(weather) {
  return 0.25 + (weather.windPermil / 1000) * 3.75;
}

function updateSwell(view3d, weather, sky, seaColour) {
  const swell = view3d.swell;
  if (swell === null || swell === undefined) return;
  const uniforms = swell.material.uniforms;
  uniforms.uTime.value = view3d.elapsed;
  const bam = (weather.windBam / 65536) * Math.PI * 2;
  uniforms.uWind.value.set(Math.cos(bam), -Math.sin(bam));
  uniforms.uHeight.value = swellHeightOf(weather);
  uniforms.uChop.value = 0.25 + (weather.windPermil / 1000) * 0.6;
  uniforms.uStorm.value = sky.storm;
  uniforms.uWindStrength.value = weather.windPermil / 1000;
  // The scatter colour is the sea's own, pushed toward the green a wave goes
  // when the sun is behind it, and dimmed with the light.
  uniforms.uScatter.value.set(0x1d5c52).multiplyScalar(0.25 + 0.75 * sky.day);
  uniforms.uSunDir.value.copy(view3d.sunDir);
  uniforms.uSunColour.value.copy(sky.lightColour);
  uniforms.uSky.value.copy(sky.fogColour);
  // The same water the mirror plane is drawing (scene.js seaColourFor), or
  // the seam where this patch fades out shows as a tone step.
  if (seaColour !== undefined) uniforms.uDeep.value.copy(seaColour);
  // Under the eye, snapped to a coarse grid so the patch does not shimmer
  // as it slides: the waves are computed in WORLD space, so moving the mesh
  // does not move the water.
  const step = SWELL_SPAN / 16;
  swell.position.x = Math.round(view3d.camera.position.x / step) * step;
  swell.position.z = Math.round(view3d.camera.position.z / step) * step;
}

export { buildClouds, updateClouds, buildSwell, updateSwell, swellHeightOf };
