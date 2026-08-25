// client/render/diorama.js - the shop window behind the start menu.
//
// A staged island assault, built from the game's OWN builders - the same
// carrier, Manta, Walrus, turret and shot meshes the war renders, over a real
// heightmap island - so the splash never drifts from what the game looks
// like. Purely cosmetic and purely client: it owns a separate canvas and a
// separate renderer, runs only while the start menu is open, and is torn down
// whole before the war's renderer claims the screen. The one WebGL rule that
// matters here: never touch the game's #view canvas - a canvas hands out its
// context once, and the war needs it.
//
// Everything is floats and wall-clock time, which is fine on this side of the
// line: no engine, no state, no hash. The island itself is a fixed fabricated
// record run through engine/heightmap.js, so the terrain is the game's real
// terrain, not a lookalike.

import * as THREE from 'three';
import { islandHeightAt } from '../../engine/heightmap.js';
import { toMetres } from './coords.js';
import { TEAM_COLOURS } from './scene.js';
import {
  buildCarrier,
  buildIslandMesh,
  buildManta,
  buildOcean,
  buildOceanGrid,
  buildShot,
  buildTurret,
  buildWalrus,
} from './world.js';

const U = 256; // engine units per metre, as everywhere

// A hand-picked island: big enough to read as terrain, seed chosen for a
// good silhouette. The record mirrors worldgen's shape so heightmap.js is
// none the wiser.
const ISLE = {
  id: 0,
  x: 3000 * U,
  y: 3000 * U,
  radius: 1100 * U,
  peak: 320 * U,
  seed: 424242,
  noiseCell: 200 * U,
  noiseOctaves: 3,
  noisePermil: 420,
  warpCell: Math.round(1100 * U * 0.3),
  warpPermil: 120,
};
const SEA_METRES = 6000;
const CENTRE = { x: 3000, z: -3000 }; // scene metres; engine north is -z

const ATTACKER = TEAM_COLOURS[0];
const DEFENDER = TEAM_COLOURS[1];

function groundAt(xMetres, yMetresNorth) {
  return toMetres(islandHeightAt(ISLE, Math.round(xMetres * U), Math.round(yMetresNorth * U)));
}

// Walk outward along a bearing until the terrain enters a height band -
// how the set dresser finds a beach for the Walrus and shoulders for the
// guns without knowing this particular island's shape in advance.
function placeOnSlope(bearing, minH, maxH) {
  for (let r = 1300; r > 100; r -= 20) {
    const x = 3000 + Math.cos(bearing) * r;
    const yNorth = 3000 + Math.sin(bearing) * r;
    const h = groundAt(x, yNorth);
    if (h >= minH && h <= maxH) return { x: x, y: h, z: -yNorth };
  }
  return { x: 3000, y: groundAt(3000, 3000), z: -3000 };
}

function faceAlong(group, vx, vz) {
  group.rotation.y = Math.atan2(-vz, vx);
}

// One looping tracer: a shot dart flying an arc from A to B forever, each on
// its own phase so the sky never empties.
function makeTracer(scene, from, to, seconds, offset, colour, arc) {
  const dart = buildShot(colour);
  scene.add(dart);
  return (elapsed) => {
    const t = ((elapsed + offset) / seconds) % 1;
    const x = from.x + (to.x - from.x) * t;
    const y = from.y + (to.y - from.y) * t + Math.sin(t * Math.PI) * arc;
    const z = from.z + (to.z - from.z) * t;
    dart.position.set(x, y, z);
    faceAlong(dart, to.x - from.x, to.z - from.z);
  };
}

function startDiorama(style) {
  const canvas = document.createElement('canvas');
  canvas.id = 'diorama';
  document.body.appendChild(canvas);

  const renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true });
  // Fixed modest cost, deliberately below the war's own tiers: a menu
  // backdrop on an integrated GPU must not stutter the menu.
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(style.sky);
  // Thinner than the war's own haze: the whole stage is inside 3 km and has
  // to stay crisp, or the island reads as a washed-out pancake (it did).
  if (style.fogDensityScale > 0) {
    scene.fog = new THREE.FogExp2(style.sky, 0.00003 * style.fogDensityScale);
  }

  scene.add(new THREE.HemisphereLight(0xbcd8f0, 0x35506a, style.hemiIntensity));
  const sun = new THREE.DirectionalLight(0xfff2df, style.sunIntensity);
  const aim = new THREE.Object3D();
  aim.position.set(CENTRE.x, 0, CENTRE.z);
  scene.add(aim);
  sun.position.set(CENTRE.x + 3200, 2600, CENTRE.z - 1200);
  sun.target = aim;
  scene.add(sun);

  // The shop window shows the detailed hulls whatever the machine would run
  // the war at: the dressing is a few dozen flat primitives, and a splash
  // exists to be looked at.
  const stagePreset = {
    terrainGrid: 96, shadows: false, modelDetail: true,
    oceanSegments: 64, oceanShader: true, oceanDetail: false,
  };
  scene.add(buildIslandMesh(ISLE, stagePreset, style));
  scene.add(buildOcean(SEA_METRES, stagePreset, style));
  if (style.oceanGrid) scene.add(buildOceanGrid(SEA_METRES, style));

  // The cast. Defences on the island's shoulders, the Walrus on the beach it
  // is storming, the carrier standing off with its bow toward the fight.
  const gun = buildTurret(DEFENDER, false, true);
  const gunSpot = placeOnSlope(0.4, 25, 80);
  gun.position.set(gunSpot.x, gunSpot.y, gunSpot.z);
  scene.add(gun);
  const battery = buildTurret(DEFENDER, true, true);
  const batterySpot = placeOnSlope(2.1, 25, 80);
  battery.position.set(batterySpot.x, batterySpot.y, batterySpot.z);
  scene.add(battery);

  const beach = placeOnSlope(-1.1, 1, 4);
  const walrus = buildWalrus(ATTACKER, true);
  walrus.position.set(beach.x, beach.y + 2, beach.z);
  faceAlong(walrus, CENTRE.x - beach.x, CENTRE.z - beach.z);
  scene.add(walrus);

  const carrier = buildCarrier(ATTACKER, stagePreset, style);
  const carrierAt = { x: CENTRE.x - 1500, y: 0, z: CENTRE.z + 1150 };
  carrier.position.set(carrierAt.x, 0, carrierAt.z);
  faceAlong(carrier, CENTRE.x - carrierAt.x, CENTRE.z - carrierAt.z);
  scene.add(carrier);

  const mantas = [
    { mesh: buildManta(ATTACKER, true), radius: 1250, altitude: 300, speed: 0.16, phase: 0 },
    { mesh: buildManta(ATTACKER, true), radius: 950, altitude: 430, speed: -0.12, phase: 2.4 },
  ];
  for (const manta of mantas) scene.add(manta.mesh);

  // Fire in both directions: the battery reaches for the ship, the ship and
  // a diving Manta answer, the gun walks rounds along the beach approach.
  const deck = { x: carrierAt.x, y: 30, z: carrierAt.z };
  const tracers = [
    makeTracer(scene, { x: batterySpot.x, y: batterySpot.y + 40, z: batterySpot.z }, deck, 4.2, 0, DEFENDER, 260),
    makeTracer(scene, deck, { x: batterySpot.x, y: batterySpot.y + 20, z: batterySpot.z }, 3.4, 1.3, ATTACKER, 320),
    makeTracer(scene, { x: gunSpot.x, y: gunSpot.y + 32, z: gunSpot.z },
      { x: beach.x - 140, y: 6, z: beach.z + 90 }, 2.2, 0.6, DEFENDER, 60),
  ];

  const camera = new THREE.PerspectiveCamera(50, 1, 5, 22000);

  const resizeNow = () => {
    const width = window.innerWidth;
    const height = Math.max(1, window.innerHeight);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height, false);
  };
  resizeNow();
  window.addEventListener('resize', resizeNow);

  let raf = 0;
  const startedAt = performance.now();
  const frame = (now) => {
    const elapsed = (now - startedAt) / 1000;

    for (const manta of mantas) {
      const a = manta.phase + elapsed * manta.speed;
      manta.mesh.position.set(
        CENTRE.x + Math.cos(a) * manta.radius,
        manta.altitude,
        CENTRE.z + Math.sin(a) * manta.radius,
      );
      faceAlong(manta.mesh, -Math.sin(a) * manta.speed, Math.cos(a) * manta.speed);
      manta.mesh.rotation.z = manta.speed > 0 ? -0.25 : 0.25; // bank into the turn
    }
    for (const tracer of tracers) tracer(elapsed);
    // The Walrus works the waterline rather than standing like a monument.
    walrus.position.x = beach.x + Math.sin(elapsed * 0.35) * 45;

    // Close and low: a diorama, not a chart. The island spills past the
    // menu box, the shore action plays on its flanks, and the carrier grows
    // to foreground scale whenever the orbit brings it near the eye.
    const orbit = elapsed * 0.045;
    camera.position.set(
      CENTRE.x + Math.cos(orbit) * 1750,
      420 + Math.sin(elapsed * 0.11) * 60,
      CENTRE.z + Math.sin(orbit) * 1750,
    );
    camera.lookAt(CENTRE.x, 110, CENTRE.z);

    const uniforms = scene.getObjectByName('ocean')?.material.uniforms;
    if (uniforms !== undefined && uniforms.uTime !== undefined) uniforms.uTime.value = elapsed;

    renderer.render(scene, camera);
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);

  // The probe hook, same pattern as __scene3d: real objects, not a mock.
  window.__diorama = { renderer: renderer, scene: scene, camera: camera };

  return {
    stop: () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resizeNow);
      renderer.dispose();
      // Hand the GPU its context back NOW: every look-row flip builds a
      // fresh canvas, browsers cap live WebGL contexts around sixteen, and
      // a discarded context otherwise waits for the garbage collector.
      renderer.forceContextLoss();
      canvas.remove();
      delete window.__diorama;
    },
  };
}

export { startDiorama };
