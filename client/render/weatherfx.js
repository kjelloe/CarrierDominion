// client/render/weatherfx.js - the weather you stand IN.
//
// weathersky.js draws the sky and the sea; this draws the air between them
// and what it does to the ship: rain, spray, and the shafts of light that
// come through a broken deck. All of it is High-tier + modern only, all of it
// is cosmetic, and every figure comes from shared/weather.js - which is a
// pure function of (seed, tick), so two players in one storm are standing in
// the same rain.
//
// Nothing here allocates per frame. The rain is one instanced draw whose
// drops are positioned entirely in the vertex shader from a per-drop seed and
// the clock; the spray is the same trick around the ship; the shafts are two
// triangles. A storm costs three draw calls.

import * as THREE from '../vendor/three.module.min.js';

// Hoisted: these were being allocated inside the update functions, which run
// every frame. A Color per effect per frame is not a leak, but it is garbage
// the collector has to walk during a render loop that has better things to do.
const WHITE = new THREE.Color(0xffffff);

// The box of rain that rides the eye. SMALL on purpose: 9000 drops spread
// through a 220 m cube is emptier than a light shower, because the volume
// grows as the cube of the span and the eye only ever sees the near few
// metres of it. A 64 m box with the same drops looks like weather; beyond it
// the fog and the grey sky do the work, which is what distance does to real
// rain anyway.
const RAIN_BOX = new THREE.Vector3(64, 42, 64);
const RAIN_DROPS = 11000;
// Below this there is weather but no rain: cloud and wind come first, and a
// storm that spits from the first grey cloud reads as a switch being thrown.
const RAIN_STARTS_AT = 0.18;

const RAIN_VERTEX = `
  precision highp float;
  attribute vec3 aSeed;
  uniform float uTime;
  uniform float uFall;
  uniform vec2 uWind;
  uniform float uSlant;
  uniform vec3 uBox;
  uniform float uShare;
  uniform float uLength;
  varying float vFade;

  void main() {
    // Each drop keeps its own column of air and falls down it forever,
    // wrapping at the bottom, and that mod() is the whole animation: nothing is
    // written back and nothing is updated on the CPU.
    float phase = mod(uTime * uFall + aSeed.y * 977.0, uBox.y);
    vec3 local = vec3((aSeed.x - 0.5) * uBox.x, uBox.y * 0.5 - phase, (aSeed.z - 0.5) * uBox.z);
    // The wind carries a drop sideways as it falls, so rain slants with the
    // same wind that raised the sea. A vertical downpour beside a running sea
    // is the tell that two systems are not talking to each other.
    local.xz += uWind * (phase * uSlant);

    // A drop the storm is not heavy enough to have gets parked far below and
    // faded out, rather than branching in the shader.
    float carried = step(aSeed.x, uShare);

    vec3 fallDir = normalize(vec3(uWind.x * uSlant, -1.0, uWind.y * uSlant));
    vec4 mv = modelViewMatrix * vec4(local, 1.0);
    // Billboard the streak: across the view, stretched along the fall.
    vec3 viewFall = normalize((modelViewMatrix * vec4(fallDir, 0.0)).xyz);
    vec3 across = normalize(cross(viewFall, vec3(0.0, 0.0, 1.0)));
    mv.xyz += across * position.x * 0.06;
    mv.xyz += viewFall * position.y * uLength;

    // Fade at the box's rim so drops arrive and leave rather than popping,
    // and fade the very near ones so the eye is not full of streaks.
    float far = 1.0 - smoothstep(uBox.x * 0.34, uBox.x * 0.56, length(mv.xyz));
    float near = smoothstep(1.2, 5.0, length(mv.xyz));
    vFade = far * near * carried;
    gl_Position = projectionMatrix * mv;
  }
`;

const RAIN_FRAGMENT = `
  precision highp float;
  uniform vec3 uColour;
  uniform float uStrength;
  varying float vFade;
  void main() {
    float a = vFade * uStrength;
    if (a <= 0.002) discard;
    gl_FragColor = vec4(uColour, a);
  }
`;

function buildRain() {
  const streak = new THREE.PlaneGeometry(1, 1);
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.index = streak.index;
  geometry.attributes.position = streak.attributes.position;
  geometry.attributes.uv = streak.attributes.uv;

  // Deterministic drops, like every other generated thing here: two machines
  // photographing the same storm should photograph the same rain.
  let s = 20260829 >>> 0;
  const rand = () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
  const seeds = new Float32Array(RAIN_DROPS * 3);
  for (let i = 0; i < RAIN_DROPS * 3; i++) seeds[i] = rand();
  geometry.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 3));
  geometry.instanceCount = RAIN_DROPS;
  // The box rides the eye and is never off screen; culling it by its origin
  // would blink the whole storm out whenever the camera turned.
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), RAIN_BOX.length());

  const material = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uFall: { value: 55 },
      uWind: { value: new THREE.Vector2(1, 0) },
      uSlant: { value: 0.35 },
      uBox: { value: RAIN_BOX.clone() },
      uShare: { value: 0 },
      uLength: { value: 1.6 },
      uColour: { value: new THREE.Color(0xc8d6e4) },
      uStrength: { value: 0 },
    },
    vertexShader: RAIN_VERTEX,
    fragmentShader: RAIN_FRAGMENT,
    transparent: true,
    depthWrite: false,
    fog: false,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = 3;
  mesh.name = 'rain';
  return mesh;
}

// How hard it is raining, 0..1, from the weather. Rain is the STORM's, not
// the cloud's: an overcast sky that is not a squall stays dry, which is what
// makes the squall mean something when it arrives.
function rainStrengthOf(sky) {
  if (sky.storm <= RAIN_STARTS_AT) return 0;
  return (sky.storm - RAIN_STARTS_AT) / (1 - RAIN_STARTS_AT);
}

function updateRain(view3d, weather, sky) {
  const rain = view3d.rain;
  if (rain === null || rain === undefined) return 0;
  const strength = rainStrengthOf(sky);
  rain.visible = strength > 0.01;
  if (!rain.visible) return 0;

  const uniforms = rain.material.uniforms;
  uniforms.uTime.value = view3d.elapsed;
  uniforms.uShare.value = strength;
  // Heavier rain is faster, longer-streaked and closer to white.
  uniforms.uFall.value = 30 + strength * 26;
  uniforms.uLength.value = 0.7 + strength * 1.1;
  uniforms.uStrength.value = 0.20 + strength * 0.40;
  const bam = (weather.windBam / 65536) * Math.PI * 2;
  uniforms.uWind.value.set(Math.cos(bam), -Math.sin(bam));
  uniforms.uSlant.value = 0.12 + (weather.windPermil / 1000) * 0.55;
  // Rain takes the light it falls through, so it is grey at dusk and never a
  // sheet of white against a dark sky.
  uniforms.uColour.value.copy(sky.lightColour).lerp(WHITE, 0.35);

  rain.position.copy(view3d.camera.position);
  return strength;
}


// --- SPRAY -------------------------------------------------------------------
//
// Two things throw water: the sea itself when it is up, and the ship's bow
// when it is driving into it. Both are the same trick as the rain - one
// instanced draw, all the motion in the vertex shader - but the puffs rise,
// slow, spread and fade instead of falling.
//
// The bow is the important one. A carrier at speed in a heavy sea with a dry
// bow looks like a model on glass, and it is the single cheapest thing that
// says "this ship is moving through water" rather than over it.

const SPRAY_PUFFS = 900;
const SPRAY_LIFE = 1.9;

const SPRAY_VERTEX = `
  precision highp float;
  attribute vec3 aSeed;
  uniform float uTime;
  uniform vec2 uWind;
  uniform float uShare;
  uniform float uReach;
  uniform float uRise;
  uniform float uSize;
  varying float vFade;
  varying vec2 vPuff;

  void main() {
    // Each puff has its own birth offset, so they do not pulse together.
    float age = fract(uTime / ${SPRAY_LIFE.toFixed(1)} + aSeed.x * 31.7);
    float carried = step(aSeed.y, uShare);

    // Thrown up and forward from the bow line, then carried off by the wind
    // and pulled back down. Nothing here is physics; it is the shape of the
    // thing, which is what the eye reads.
    vec2 out2 = vec2(aSeed.z - 0.5, aSeed.x - 0.5) * uReach;
    float rise = uRise * age * (1.3 - age);
    vec3 local = vec3(out2.x, rise, out2.y);
    local.xz += uWind * (age * uReach * 0.55);

    vec4 mv = modelViewMatrix * vec4(local, 1.0);
    float grow = uSize * (0.45 + age * 1.5);
    mv.xy += position.xy * grow;
    vPuff = position.xy * 2.0;
    // In on a rise, out on a long tail - a puff of spray does not blink off.
    vFade = smoothstep(0.0, 0.12, age) * (1.0 - smoothstep(0.35, 1.0, age)) * carried;
    gl_Position = projectionMatrix * mv;
  }
`;

const SPRAY_FRAGMENT = `
  precision highp float;
  uniform vec3 uColour;
  uniform float uStrength;
  varying float vFade;
  varying vec2 vPuff;
  void main() {
    // A soft round puff. The first version reached for gl_PointCoord, which
    // means nothing in a triangle shader - and never used the value it read,
    // so every puff of spray was a hard-edged rectangle. The quad's own
    // coordinates are what this needed.
    float r = length(vPuff);
    float soft = 1.0 - smoothstep(0.25, 1.0, r);
    float a = vFade * uStrength * soft;
    if (a <= 0.003) discard;
    gl_FragColor = vec4(uColour, a);
  }
`;

function buildSpray() {
  const puff = new THREE.PlaneGeometry(1, 1);
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.index = puff.index;
  geometry.attributes.position = puff.attributes.position;
  geometry.attributes.uv = puff.attributes.uv;

  let s = 20260830 >>> 0;
  const rand = () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
  const seeds = new Float32Array(SPRAY_PUFFS * 3);
  for (let i = 0; i < SPRAY_PUFFS * 3; i++) seeds[i] = rand();
  geometry.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 3));
  geometry.instanceCount = SPRAY_PUFFS;
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 300);

  const material = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uWind: { value: new THREE.Vector2(1, 0) },
      uShare: { value: 0 },
      uReach: { value: 40 },
      uRise: { value: 26 },
      uSize: { value: 5 },
      uColour: { value: new THREE.Color(0xdfe9f2) },
      uStrength: { value: 0 },
    },
    vertexShader: SPRAY_VERTEX,
    fragmentShader: SPRAY_FRAGMENT,
    transparent: true,
    depthWrite: false,
    // A raw ShaderMaterial does not get three.js fog for free: asking for it
    // without declaring fogColor and friends makes refreshFogUniforms reach
    // for a uniform that is not there, on every draw. The spray is within a
    // hundred metres of the ship anyway, where fog has nothing to say.
    fog: false,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = 2;
  mesh.name = 'spray';
  return mesh;
}

// Spray follows the SHIP, not the eye: it is thrown by a bow going through
// water, so it belongs where that bow is.
function updateSpray(view3d, weather, sky, own) {
  const spray = view3d.spray;
  if (spray === null || spray === undefined) return;
  if (own === undefined) { spray.visible = false; return; }

  const wind = weather.windPermil / 1000;
  const speed = own.maxSpeed > 0 ? Math.abs(own.speed) / own.maxSpeed : 0;
  // A sea alone throws some; a bow driving into that sea throws much more.
  // Neither alone is enough: a stopped ship in a gale still smokes a little,
  // and a ship at speed on glass barely wets its paint.
  const share = Math.min(1, wind * 0.55 * (0.25 + speed) + speed * wind * 0.9);
  spray.visible = share > 0.02;
  if (!spray.visible) return;

  const uniforms = spray.material.uniforms;
  uniforms.uTime.value = view3d.elapsed;
  uniforms.uShare.value = share;
  uniforms.uReach.value = 34 + wind * 30;
  uniforms.uRise.value = 14 + wind * 26 + speed * 14;
  uniforms.uSize.value = 3.5 + wind * 4.5;
  uniforms.uStrength.value = 0.10 + share * 0.34;
  const bam = (weather.windBam / 65536) * Math.PI * 2;
  uniforms.uWind.value.set(Math.cos(bam), -Math.sin(bam));
  uniforms.uColour.value.copy(sky.lightColour).lerp(WHITE, 0.6);

  // At the bow, a little forward of the hull's middle.
  const yaw = (own.heading / 65536) * Math.PI * 2;
  spray.position.set(
    view3d.ownX + Math.cos(yaw) * 120,
    2,
    view3d.ownZ - Math.sin(yaw) * 120,
  );
}


// --- SUNBEAMS ----------------------------------------------------------------
//
// Crepuscular rays: the shafts that come down through a hole in the cloud.
//
// Done in SCREEN SPACE, on one full-screen triangle drawn after everything
// else, rather than as a post-processing pass. A real god-ray pass wants the
// scene rendered to a target and radially blurred, which means an
// EffectComposer, two more render targets and a rewrite of the render loop -
// a great deal of machinery, and a great deal of risk, for an effect that is
// mostly believed rather than examined. This samples nothing: it draws
// streaks radiating from wherever the sun is on screen, and lets the sky,
// the cloud cover and the sun's own elevation say how strong they are.
//
// The honest limitation, since it will be noticed eventually: these shafts
// are not occluded by islands or by the ship. A hull between you and the sun
// does not cut them. Fixing that needs the depth buffer, and therefore the
// pass this deliberately avoids.

const BEAM_VERTEX = `
  precision highp float;
  varying vec2 vUv;
  void main() {
    vUv = uv;
    // A full-screen triangle in clip space; no camera involved.
    gl_Position = vec4(position.xy * 2.0, 0.0, 1.0);
  }
`;

const BEAM_FRAGMENT = `
  precision highp float;
  uniform vec2 uSun;
  uniform float uStrength;
  uniform vec3 uColour;
  uniform float uAspect;
  uniform float uTime;
  varying vec2 vUv;

  float hash(float n) { return fract(sin(n) * 43758.5453); }

  void main() {
    if (uStrength <= 0.003) discard;
    vec2 d = vUv - uSun;
    d.x *= uAspect;
    float dist = length(d);
    float angle = atan(d.y, d.x);

    // The shafts themselves: a few dozen soft wedges around the sun, at fixed
    // angles that drift very slowly, so the light looks like it is coming
    // through moving cloud rather than through a fan.
    // FEW and BROAD. The first version used high frequencies and a hard
    // power, and the result was a lens flare - a sharp star pinned to the
    // sun. Crepuscular rays are wide soft wedges with gaps between them,
    // because they are the shape of the holes in the cloud, not the shape of
    // the sun.
    float rays = 0.0;
    for (int i = 0; i < 3; i++) {
      float f = 3.0 + float(i) * 4.0;
      float phase = hash(float(i) * 3.7) * 6.2831 + uTime * (0.010 + float(i) * 0.006);
      rays += (0.5 + 0.5 * sin(angle * f + phase)) * (0.5 - float(i) * 0.12);
    }
    rays = pow(clamp(rays, 0.0, 1.0), 1.5);

    // Bright at the sun, gone by the edge of the frame; and nothing at all
    // behind the eye, which is what a negative uSun.y would mean.
    // The shafts reach well down the frame; the glow around the sun itself is
    // kept small, because a big one is the flare look again.
    float falloff = exp(-dist * 2.0);
    float core = exp(-dist * 16.0);
    float a = (rays * falloff * 0.9 + core * 0.16) * uStrength;
    if (a <= 0.002) discard;
    gl_FragColor = vec4(uColour * a, a);
  }
`;

function buildBeams() {
  const geometry = new THREE.PlaneGeometry(1, 1);
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uSun: { value: new THREE.Vector2(0.5, 0.5) },
      uStrength: { value: 0 },
      uColour: { value: new THREE.Color(0xfff0d8) },
      uAspect: { value: 1.78 },
      uTime: { value: 0 },
    },
    vertexShader: BEAM_VERTEX,
    fragmentShader: BEAM_FRAGMENT,
    transparent: true,
    depthWrite: false,
    depthTest: false,
    blending: THREE.AdditiveBlending,
    fog: false,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  // Last of everything: shafts are light reaching the eye, not an object.
  mesh.renderOrder = 20;
  mesh.name = 'sunbeams';
  return mesh;
}

const BEAM_SUN = new THREE.Vector3();
const BEAM_FORWARD = new THREE.Vector3();

function updateBeams(view3d, weather, sky) {
  const beams = view3d.beams;
  if (beams === null || beams === undefined) return;

  // Where the sun is on screen. Behind the camera means no shafts at all -
  // and "behind" is decided by the camera's own forward vector, NOT by the
  // projected z. A point 20 km away sits beyond the far plane, so its z
  // clamps to exactly 1 and a `z < 1` test throws away every sun that is
  // plainly in the middle of the frame. Projected from close in for the same
  // reason: only the direction matters, and near points keep their precision.
  BEAM_SUN.copy(view3d.sunDir).multiplyScalar(200).add(view3d.camera.position);
  const projected = BEAM_SUN.project(view3d.camera);
  view3d.camera.getWorldDirection(BEAM_FORWARD);
  const inFront = BEAM_FORWARD.dot(view3d.sunDir) > 0;
  const x = projected.x * 0.5 + 0.5;
  const y = projected.y * 0.5 + 0.5;

  // Shafts need three things at once: a sun that is up, cloud for it to come
  // through, and NOT so much cloud that nothing gets through at all. A clear
  // sky has no shafts because there is nothing to shape them, and the middle
  // of a squall has none because the sun is not reaching the water.
  const gap = Math.max(0, 1 - Math.abs(sky.cloud - 0.55) / 0.55);
  const height = Math.max(0, Math.min(1, view3d.sunDir.y * 3));
  const offScreen = Math.max(0, Math.min(1,
    1 - (Math.max(0, Math.max(x - 1.35, -0.35 - x)) + Math.max(0, Math.max(y - 1.35, -0.35 - y))) * 2));
  const strength = inFront
    ? gap * height * offScreen * (1 - sky.storm * 0.75) * 0.40
    : 0;

  beams.visible = strength > 0.004;
  if (!beams.visible) return;
  const uniforms = beams.material.uniforms;
  uniforms.uSun.value.set(x, y);
  uniforms.uStrength.value = strength;
  uniforms.uAspect.value = window.innerWidth / Math.max(1, window.innerHeight);
  uniforms.uTime.value = view3d.elapsed;
  uniforms.uColour.value.copy(sky.lightColour).lerp(WHITE, 0.4);
}

export {
  buildRain, updateRain, rainStrengthOf, RAIN_BOX,
  buildSpray, updateSpray,
  buildBeams, updateBeams,
};
