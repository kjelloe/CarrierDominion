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

// Value noise and a four-octave fBm. Cheap, and it costs one texture fetch
// fewer than a noise texture would.
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
  float fbm(vec2 p) {
    float v = 0.0;
    float a = 0.5;
    for (int i = 0; i < 4; i++) {
      v += a * noise(p);
      p = p * 2.03;
      a *= 0.5;
    }
    return v;
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

    vec2 p = at * 0.00035 + uDrift * uTime * 0.006;
    float n = fbm(p);
    // Coverage is a threshold on the noise, so "a few light clouds" and "an
    // overcast that has made its mind up" are the same field at two cuts.
    // The floor stops short of total: a deck with no break in it is
    // indistinguishable from a grey backdrop, and the breaks are what tell
    // you it is cloud at all.
    float edge = mix(0.74, 0.30, uCover);
    float mask = smoothstep(edge, edge + 0.16, n);
    if (mask <= 0.002) discard;

    // Thicker cloud is darker cloud, and a storm drags the whole deck toward
    // the grey-blue the owner asked for.
    float thick = smoothstep(edge, edge + 0.30, n);
    vec3 colour = mix(uLight, uDark, thick * (0.35 + 0.65 * uStorm));
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
    // Heavy weather closes the horizon in: the alpha floor rises with the
    // cover, so an overcast reaches the sea line instead of stopping short
    // of it.
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
  uniforms.uLight.value.lerp(sky.fogColour, sky.storm * 0.8);
  uniforms.uDark.value.copy(sky.fogColour).multiplyScalar(0.75);
  // The haze at the sea line IS the fog, so the whole horizon agrees.
  uniforms.uHaze.value.copy(sky.fogColour);
  // The shell rides the eye, so the view ray in the vertex shader is exact
  // and the cloud never has an edge to come round.
  view3d.clouds.position.copy(view3d.camera.position);
  return deltaSeconds;
}

// --- the swell -------------------------------------------------------------

const SWELL_SPAN = 1500;

// Gerstner waves: the crests sharpen and the troughs broaden as the sea gets
// up, which is what a sine sheet can never do and what makes a heavy sea
// look heavy. Four components, all running with the wind, at wavelengths
// that do not share a factor so the pattern does not repeat under the eye.
const SWELL_VERTEX = `
  uniform float uTime;
  uniform vec2 uWind;
  uniform float uHeight;
  uniform float uChop;
  varying vec3 vWorld;
  varying vec3 vNormal2;
  varying float vFade;

  void gerstner(vec2 dir, float wavelength, float amp, float steep,
                vec2 pos, float t, inout vec3 offset, inout vec3 normal) {
    float k = 6.28318530718 / wavelength;
    float c = sqrt(9.81 / k);
    vec2 d = normalize(dir);
    float f = k * (dot(d, pos) - c * t);
    float a = amp;
    float q = steep / (k * a * 4.0);
    offset.x += q * a * d.x * cos(f);
    offset.z += q * a * d.y * cos(f);
    offset.y += a * sin(f);
    float wa = k * a;
    normal.x -= d.x * wa * cos(f);
    normal.z -= d.y * wa * cos(f);
    normal.y -= q * wa * sin(f);
  }

  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vec2 pos = world.xz;
    vec3 offset = vec3(0.0);
    vec3 normal = vec3(0.0, 1.0, 0.0);
    float h = uHeight;
    gerstner(uWind,             139.0, h * 1.00, uChop, pos, uTime, offset, normal);
    gerstner(uWind + vec2( 0.35, 0.0), 71.0, h * 0.55, uChop, pos, uTime, offset, normal);
    gerstner(uWind + vec2(-0.30, 0.2), 37.0, h * 0.28, uChop, pos, uTime, offset, normal);
    gerstner(uWind + vec2( 0.15,-0.4), 17.0, h * 0.12, uChop, pos, uTime, offset, normal);

    // Fade the patch out at its rim so it meets the flat mirror sea without
    // a visible step. This is the whole reason the trick works.
    vec2 local = position.xy;
    float edge = max(abs(local.x), abs(local.y)) / ${(SWELL_SPAN / 2).toFixed(1)};
    vFade = 1.0 - smoothstep(0.62, 1.0, edge);

    world.xyz += offset * vFade;
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
  varying vec3 vWorld;
  varying vec3 vNormal2;
  varying float vFade;

  void main() {
    vec3 n = normalize(vNormal2);
    vec3 eye = normalize(cameraPosition - vWorld);
    float fres = pow(1.0 - max(0.0, dot(n, eye)), 4.0);
    vec3 colour = mix(uDeep, uSky, clamp(fres * 0.9, 0.0, 1.0));
    // A diffuse term and a floor. Fresnel alone put every wave face that
    // pointed away from the eye at the deep colour, so a swell read as black
    // terraces with grey tops instead of as water.
    float lambert = 0.45 + 0.55 * max(0.0, dot(n, normalize(uSunDir)));
    colour = colour * (0.55 + 0.45 * lambert) + uSky * 0.18;
    // Sun glint, and white water on the steep faces when it blows.
    float spec = pow(max(0.0, dot(reflect(-uSunDir, n), eye)), 90.0);
    colour += uSunColour * spec * 0.9;
    float crest = smoothstep(0.55, 0.95, 1.0 - n.y);
    colour = mix(colour, vec3(0.92, 0.95, 0.98), crest * uStorm * 0.7);
    // Alpha carries the rim fade, so the mirror sea shows through at the
    // edge rather than the patch ending in a line.
    gl_FragColor = vec4(colour, vFade);
  }
`;

function buildSwell(preset) {
  const segments = preset.oceanSegments >= 256 ? 256 : 128;
  const geometry = new THREE.PlaneGeometry(SWELL_SPAN, SWELL_SPAN, segments, segments);
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uWind: { value: new THREE.Vector2(1, 0) },
      uHeight: { value: 0.3 },
      uChop: { value: 0.4 },
      uDeep: { value: new THREE.Color(0x0b2a3a) },
      uSky: { value: new THREE.Color(0x9fc4dd) },
      uSunDir: { value: new THREE.Vector3(0.4, 0.6, 0.35) },
      uSunColour: { value: new THREE.Color(0xfff2df) },
      uStorm: { value: 0 },
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

function updateSwell(view3d, weather, sky) {
  const swell = view3d.swell;
  if (swell === null || swell === undefined) return;
  const uniforms = swell.material.uniforms;
  uniforms.uTime.value = view3d.elapsed;
  const bam = (weather.windBam / 65536) * Math.PI * 2;
  uniforms.uWind.value.set(Math.cos(bam), -Math.sin(bam));
  uniforms.uHeight.value = swellHeightOf(weather);
  uniforms.uChop.value = 0.25 + (weather.windPermil / 1000) * 0.6;
  uniforms.uStorm.value = sky.storm;
  uniforms.uSunDir.value.copy(view3d.sunDir);
  uniforms.uSunColour.value.copy(sky.lightColour);
  uniforms.uSky.value.copy(sky.fogColour);
  // Under the eye, snapped to a coarse grid so the patch does not shimmer
  // as it slides: the waves are computed in WORLD space, so moving the mesh
  // does not move the water.
  const step = SWELL_SPAN / 16;
  swell.position.x = Math.round(view3d.camera.position.x / step) * step;
  swell.position.z = Math.round(view3d.camera.position.z / step) * step;
}

export { buildClouds, updateClouds, buildSwell, updateSwell, swellHeightOf };
