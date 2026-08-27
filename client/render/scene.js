// client/render/scene.js - the three.js side of the client.
//
// Renders whatever the latest VIEW says, at whatever frame rate the browser
// offers, interpolating between the 20 Hz snapshots. It knows nothing about
// transports, commands, or the engine's internals - hand it a view, it draws
// that view.

import * as THREE from 'three';
import { Sky } from '../vendor/Sky.js';
import { skyStateOf, sunDirection } from './skystate.js';
import { buildClouds, buildSwell, updateClouds, updateSwell } from './weathersky.js';
import { forwardFromHeading, headingToYaw, toMetres } from './coords.js';
import {
  NEUTRAL_NODE_COLOUR,
  SUN_DIRECTION,
  buildCarrier,
  buildCommandNode,
  buildDroneUnit,
  buildDecoyUnit,
  buildIslandMesh,
  buildLighter,
  buildManta,
  buildMirrorOcean,
  buildOcean,
  buildOceanGrid,
  buildRunway,
  buildSelectionMarker,
  buildShot,
  buildTurret,
  buildWalrus,
  updateCommandNode,
} from './world.js';
import { islandHeightAt } from '../../engine/heightmap.js';

// Sixteen distinguishable hulls (ruling 2026-08-23: up to 16 carriers, free
// for all). The first two are the classic pair; the rest are spaced around
// the wheel with the sea-blues avoided, because a hull the colour of the
// ocean is a hull nobody finds.
const TEAM_COLOURS = [
  0x4f7fa8, 0xa85b4f, 0x5fa85f, 0xa8974f, 0x8a5fa8, 0x4fa89b,
  0xa84f7e, 0x7ea84f, 0xc2703e, 0x3e86c2, 0xc2b83e, 0x6f6fc2,
  0x3ec24f, 0xc23e3e, 0x8f8f8f, 0xd9a0d0,
];
const CHASE_BACK_METRES = 780;
const CHASE_UP_METRES = 400;
const STRATEGIC_UP_METRES = 7000;

// The phase-2 pair of gates (docs/07 §3): the tier pays for the physical sky
// and the mirror water, the style asks for them. Retro never asks; nothing
// below High ever pays.
function wantsPhysicalSky(preset, style) {
  return preset.physicalEffects === true && style.physicalSky === true;
}

function wantsMirrorWater(preset, style) {
  return preset.physicalEffects === true && style.mirrorWater === true;
}

// ACES exposure for the Preetham sky's OUTPUT, and the counterintuitive
// lesson that cost the reference scene its debugging day: exposure must
// DECREASE as the sun rises, or the day sky washes out to white - ~0.5 at
// the horizon, ~0.3 at high sun, with rayleigh left alone at 2.0. Our sun is
// fixed at ~49° elevation, so the curve collapses to one number near its
// high end. If the sun ever moves, the curve comes back with it.
const ACES_EXPOSURE_FIXED_SUN = 0.32;

function createRenderer(canvas, preset, style) {
  const renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: preset.antialias });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, preset.pixelRatioCap));
  renderer.shadowMap.enabled = preset.shadows;
  if (preset.shadows) renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  if (wantsPhysicalSky(preset, style)) {
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = ACES_EXPOSURE_FIXED_SUN;
  }
  return renderer;
}

// The Preetham skydome, and the sky AS the light: the dome is rendered once
// through PMREM into scene.environment, so every material sees the same
// atmosphere it stands under. With a fixed sun that render happens exactly
// once per scene build (docs/07 lesson 4 says "at most once per frame behind
// a dirty flag"; a sun that cannot move needs no flag at all).
function addPhysicalSky(view3d) {
  const sky = new Sky();
  sky.scale.setScalar(450000);
  const uniforms = sky.material.uniforms;
  uniforms.turbidity.value = 2;
  // Exposure is the blueness lever, not rayleigh - raising rayleigh makes
  // the sky BRIGHTER, not bluer (docs/07 lesson 3).
  uniforms.rayleigh.value = 2.0;
  uniforms.mieCoefficient.value = 0.005;
  uniforms.mieDirectionalG.value = 0.8;
  uniforms.sunPosition.value.copy(SUN_DIRECTION);

  const pmrem = new THREE.PMREMGenerator(view3d.renderer);
  const skyScene = new THREE.Scene();
  skyScene.add(sky);
  if (view3d.envTarget !== null) view3d.envTarget.dispose();
  view3d.envTarget = pmrem.fromScene(skyScene);
  pmrem.dispose();
  view3d.scene.environment = view3d.envTarget.texture;
  // add() reparents the dome out of the throwaway PMREM scene.
  view3d.scene.add(sky);
  view3d.skyDome = sky;
}

function createLights(scene, preset, sizeMetres, style) {
  const hemi = new THREE.HemisphereLight(0xbcd8f0, 0x35506a, style.hemiIntensity);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff2df, style.sunIntensity);
  // Aim the sun at the middle of the map, not at the scene origin: the origin
  // is the map's south-west CORNER, so a default-target sun lights the sea and
  // leaves every hull in the archipelago as a silhouette.
  const centre = new THREE.Object3D();
  centre.position.set(sizeMetres / 2, 0, -sizeMetres / 2);
  scene.add(centre);
  sun.target = centre;
  sun.position.set(sizeMetres * 0.9, sizeMetres * 0.6, -sizeMetres * 0.15);
  if (preset.shadows) {
    sun.castShadow = true;
    sun.shadow.mapSize.set(preset.shadowMapSize, preset.shadowMapSize);
    sun.shadow.camera.near = 100;
    sun.shadow.camera.far = sizeMetres * 1.5;
    const extent = 4000;
    sun.shadow.camera.left = -extent;
    sun.shadow.camera.right = extent;
    sun.shadow.camera.top = extent;
    sun.shadow.camera.bottom = -extent;
  }
  scene.add(sun);
  // A weak fill from the opposite quarter. Without it a hull is a silhouette
  // whenever the chase camera happens to sit between the sun and the ship,
  // which is most of the time.
  const fill = new THREE.DirectionalLight(0xc8dcf0, 0.45);
  fill.position.set(-sizeMetres * 0.4, sizeMetres * 0.3, sizeMetres * 0.6);
  fill.target = centre;
  scene.add(fill);
  return { sun: sun, hemi: hemi };
}

function createScene(canvas, preset, sizeMetres, style) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(style.sky);
  // A style may switch the haze off entirely: the 1988 look wants a hard
  // horizon, not distance fading to nothing.
  const fogDensity = preset.fogDensity * style.fogDensityScale;
  if (fogDensity > 0) scene.fog = new THREE.FogExp2(style.sky, fogDensity);

  const camera = new THREE.PerspectiveCamera(
    58,
    window.innerWidth / Math.max(1, window.innerHeight),
    5,
    preset.drawDistanceMetres,
  );

  const renderer = createRenderer(canvas, preset, style);
  const lights = createLights(scene, preset, sizeMetres, style);

  // The fog exists by here, which buildMirrorOcean depends on (lesson 2).
  const ocean = wantsMirrorWater(preset, style)
    ? buildMirrorOcean(sizeMetres, style, scene.fog)
    : buildOcean(sizeMetres, preset, style);
  scene.add(ocean);
  if (style.oceanGrid) scene.add(buildOceanGrid(sizeMetres, style));

  const view3d = {
    scene: scene,
    camera: camera,
    renderer: renderer,
    ocean: ocean,
    preset: preset,
    style: style,
    islands: {},
    nodes: {},
    runways: {},
    carriers: {},
    units: {},
    shots: {},
    turrets: {},
    strategic: false,
    gunsight: false,
    rearView: false,
    droneView: false,
    droneUnitId: -1,
    followUnitId: -1,
    selectedUnitId: -1,
    marker: null,
    elapsed: 0,
    envTarget: null,
    // The weather's handles (owner's ask, 2026-08-26). All null on tiers
    // that do not have a physical sky, and applyWeather returns early there.
    sizeMetres: sizeMetres,
    sun: lights.sun,
    hemi: lights.hemi,
    skyDome: null,
    clouds: null,
    swell: null,
    sunDir: new THREE.Vector3(0.4, 0.6, 0.35).normalize(),
    envSunDir: new THREE.Vector3(0, -1, 0),
    fogDensityBase: fogDensity,
    raycaster: new THREE.Raycaster(),
    seaPlane: new THREE.Plane(new THREE.Vector3(0, 1, 0), 0),
  };
  if (wantsPhysicalSky(preset, style)) {
    addPhysicalSky(view3d);
    // Weather scenery rides with the physical sky, on the same gate: it is
    // the High-tier, modern-look pass and nothing else ever sees it.
    view3d.clouds = buildClouds(sizeMetres);
    scene.add(view3d.clouds);
    view3d.swell = buildSwell(preset);
    scene.add(view3d.swell);
    keepCloudsOutOfReflections(view3d, ocean);
  }
  return view3d;
}

function syncIslands(view3d, view) {
  for (const island of view.islands) {
    if (view3d.islands[island.id] !== undefined) continue;
    const mesh = buildIslandMesh(island, view3d.preset, view3d.style);
    view3d.islands[island.id] = mesh;
    view3d.scene.add(mesh);
  }
}

// Command nodes are their own layer: the island mesh is built once and never
// touched again, while a node changes colour every time the island changes
// hands.
function syncNodes(view3d, view, podBuildTicks) {
  for (const island of view.islands) {
    let group = view3d.nodes[island.id];
    if (group === undefined) {
      group = buildCommandNode();
      group.position.set(
        toMetres(island.nodeX),
        toMetres(islandHeightAt(island, island.nodeX, island.nodeY)),
        -toMetres(island.nodeY),
      );
      view3d.nodes[island.id] = group;
      view3d.scene.add(group);
    }
    // The strip appears when the island builds one - its own layer, since
    // the island mesh itself is built once and never touched again.
    if (island.runway === 1 && view3d.runways[island.id] === undefined) {
      const strip = buildRunway(island);
      strip.position.set(
        toMetres(island.nodeX),
        toMetres(islandHeightAt(island, island.nodeX, island.nodeY)) + 1.2,
        -toMetres(island.nodeY),
      );
      view3d.runways[island.id] = strip;
      view3d.scene.add(strip);
    }
    if (island.runway !== 1 && view3d.runways[island.id] !== undefined) {
      view3d.scene.remove(view3d.runways[island.id]);
      delete view3d.runways[island.id];
    }
    const ownerColour = island.owner < 0
      ? NEUTRAL_NODE_COLOUR
      : TEAM_COLOURS[island.owner % TEAM_COLOURS.length];
    const podColour = island.podTeam < 0
      ? NEUTRAL_NODE_COLOUR
      : TEAM_COLOURS[island.podTeam % TEAM_COLOURS.length];
    const progress = island.podTeam < 0 || podBuildTicks <= 0
      ? 0
      : Math.min(1, island.podTicks / podBuildTicks);
    updateCommandNode(group, ownerColour, podColour, progress);
  }
}

function syncCarriers(view3d, view) {
  const seen = {};
  for (const carrier of view.carriers) {
    seen[carrier.id] = true;
    let group = view3d.carriers[carrier.id];
    if (group === undefined) {
      group = buildCarrier(
        TEAM_COLOURS[carrier.team % TEAM_COLOURS.length],
        view3d.preset,
        view3d.style,
      );
      // A radar contact is a ghost, not a hull: it is drawn dimmed so nobody
      // mistakes a blip for full knowledge of the enemy.
      if (carrier.contact === 1) dimForContact(group);
      view3d.carriers[carrier.id] = group;
      view3d.scene.add(group);
    }
    group.position.set(toMetres(carrier.x), 0, -toMetres(carrier.y));
    group.rotation.y = headingToYaw(carrier.heading);
  }
  for (const id of Object.keys(view3d.carriers)) {
    if (seen[id] === undefined) {
      view3d.scene.remove(view3d.carriers[id]);
      delete view3d.carriers[id];
    }
  }
}

function dimForContact(group) {
  for (const child of group.children) {
    child.material = child.material.clone();
    child.material.transparent = true;
    child.material.opacity = 0.42;
  }
}

// UNIT_STOWED units are inside a hangar and are simply not drawn: the view
// still lists them (they are yours, you may launch them) but there is nothing
// on the map to see.
function syncUnits(view3d, view) {
  const seen = {};
  for (const unit of view.units) {
    if (unit.state === 0 || unit.state === 3) continue;
    seen[unit.id] = true;
    let group = view3d.units[unit.id];
    if (group === undefined) {
      const colour = TEAM_COLOURS[unit.team % TEAM_COLOURS.length];
      const detail = view3d.preset.modelDetail === true;
      if (unit.kind === 0) group = buildManta(colour, detail);
      else if (unit.kind === 2) group = buildLighter(colour, detail);
      else if (unit.kind === 3) group = buildDroneUnit(colour);
      else if (unit.kind === 4) group = buildDecoyUnit(colour);
      else if (unit.kind === 5) group = buildManta(colour, false); // the Marauder
      else group = buildWalrus(colour, detail);
      if (unit.contact === 1) dimForContact(group);
      view3d.units[unit.id] = group;
      view3d.scene.add(group);
    }
    group.position.set(toMetres(unit.x), toMetres(unit.z), -toMetres(unit.y));
    group.rotation.y = headingToYaw(unit.heading);
  }
  for (const id of Object.keys(view3d.units)) {
    if (seen[id] === undefined) {
      view3d.scene.remove(view3d.units[id]);
      delete view3d.units[id];
    }
  }
}

// Island batteries. They never move, so they are built once and only removed -
// when they are shot away, or when the island changes hands and the new owner's
// guns are not the old owner's.
function syncTurrets(view3d, view) {
  const seen = {};
  for (const turret of view.turrets) {
    seen[turret.id] = true;
    if (view3d.turrets[turret.id] !== undefined) continue;
    const group = buildTurret(
      turret.team < 0 ? NEUTRAL_NODE_COLOUR : TEAM_COLOURS[turret.team % TEAM_COLOURS.length],
      turret.kind === 1,
      view3d.preset.modelDetail === true,
    );
    group.position.set(toMetres(turret.x), toMetres(turret.z), -toMetres(turret.y));
    view3d.turrets[turret.id] = group;
    view3d.scene.add(group);
  }
  for (const id of Object.keys(view3d.turrets)) {
    if (seen[id] === undefined) {
      view3d.scene.remove(view3d.turrets[id]);
      delete view3d.turrets[id];
    }
  }
}

// Shots come and go every few ticks, so they are rebuilt from the view rather
// than tracked: anything the view no longer lists has either hit something or
// run out of range, and either way it is gone.
function syncShots(view3d, view) {
  const seen = {};
  for (const shot of view.shots) {
    seen[shot.id] = true;
    let group = view3d.shots[shot.id];
    if (group === undefined) {
      group = buildShot(TEAM_COLOURS[shot.team % TEAM_COLOURS.length]);
      view3d.shots[shot.id] = group;
      view3d.scene.add(group);
    }
    group.position.set(toMetres(shot.x), toMetres(shot.z), -toMetres(shot.y));
    group.rotation.y = headingToYaw(shot.heading);
  }
  for (const id of Object.keys(view3d.shots)) {
    if (seen[id] === undefined) {
      view3d.scene.remove(view3d.shots[id]);
      delete view3d.shots[id];
    }
  }
}

// The camera chases whatever the player is actually flying: a unit under
// direct control if there is one, otherwise the carrier.
function chaseSubject(view3d, view) {
  if (view3d.followUnitId !== -1) {
    for (const unit of view.units) {
      if (unit.id === view3d.followUnitId && (unit.state === 1 || unit.state === 2)) {
        return { x: unit.x, y: unit.y, z: unit.z, heading: unit.heading, back: 140, up: 55 };
      }
    }
  }
  const carrier = ownCarrierOf(view);
  if (carrier === undefined) {
    // A seat with no ship - the spectator's chart view, or a sunk one - has
    // nothing to chase, so it gets the strategic pull-back over the middle of
    // the map rather than a camera that never places and stares at a corner.
    view3d.strategic = true;
    view3d.gunsight = false;
    const middle = Math.floor((view.params?.sizeUnits ?? 0) / 2);
    return { x: middle, y: middle, z: 0, heading: 16384, back: 0, up: 0 };
  }
  return {
    x: carrier.x,
    y: carrier.y,
    z: 0,
    heading: carrier.heading,
    back: CHASE_BACK_METRES,
    up: CHASE_UP_METRES,
  };
}

// Eye heights for the gunsight view: a Manta's canopy sits just above the
// airframe; the carrier's mount is the laser on the island, well above the
// deck, which is also why the ship's own bow never blocks the picture.
const GUNSIGHT_UNIT_EYE_METRES = 3;
const GUNSIGHT_CARRIER_EYE_METRES = 24;

function placeCamera(view3d, subject) {
  if (subject === undefined) return;
  // The DRONE view (proposal 5): straight down from the aerostat, north up -
  // the original's remote screen, and the picture the Hammerhead aims on.
  if (view3d.droneView === true && view3d.droneUnitId !== -1) {
    const eye = view3d.units[view3d.droneUnitId];
    if (eye !== undefined) {
      view3d.camera.up.set(0, 0, -1);
      view3d.camera.position.set(eye.position.x, Math.max(60, eye.position.y), eye.position.z);
      view3d.camera.lookAt(eye.position.x, 0, eye.position.z);
      return;
    }
  }
  view3d.camera.up.set(0, 1, 0);
  const x = toMetres(subject.x);
  const z = -toMetres(subject.y);
  const y = toMetres(subject.z);
  if (view3d.strategic) {
    view3d.camera.position.set(x, STRATEGIC_UP_METRES, z + 1200);
    view3d.camera.lookAt(x, 0, z);
    return;
  }
  // The REAR VIEW selector (manual coverage review, item 10): the picture
  // out of the back, in chase and gunsight alike - the strategic pull-back
  // has no back to look out of.
  const facing = forwardFromHeading(subject.heading);
  const forward = view3d.rearView === true
    ? { x: -facing.x, z: -facing.z }
    : facing;
  if (view3d.gunsight) {
    // Down the barrel: eye ON the mount, horizon level, crosshair centred.
    // What the weapon can reach is what fills the screen - aiming is looking.
    // The carrier's eye is the FORWARD mount, out past the bow spike - from
    // anywhere on the hull the ship's own bow towers through the middle of
    // the picture.
    const aboard = subject.z > 0;
    const eye = y + (aboard ? GUNSIGHT_UNIT_EYE_METRES : GUNSIGHT_CARRIER_EYE_METRES);
    const nose = aboard ? 8 : 245;
    view3d.camera.position.set(x + forward.x * nose, eye, z + forward.z * nose);
    view3d.camera.lookAt(x + forward.x * 1600, eye, z + forward.z * 1600);
    return;
  }
  view3d.camera.position.set(
    x - forward.x * subject.back,
    y + subject.up,
    z - forward.z * subject.back,
  );
  view3d.camera.lookAt(x, y + 30, z);
}

// Turn a click into a point on the sea, in ENGINE units. Returns -1 when the
// ray misses the water entirely (a click at the sky).
function pickSea(view3d, ndcX, ndcY) {
  view3d.raycaster.setFromCamera({ x: ndcX, y: ndcY }, view3d.camera);
  const hit = view3d.raycaster.ray.intersectPlane(view3d.seaPlane, new THREE.Vector3());
  if (hit === null) return -1;
  return { x: Math.round(hit.x * 256), y: Math.round(-hit.z * 256) };
}

function ownCarrierOf(view) {
  for (const carrier of view.carriers) {
    if (carrier.team === view.team && carrier.contact === 0) return carrier;
  }
  return undefined;
}

// The selection marker rides above whatever NEXT last named, spinning and
// bobbing so the eye finds it among a dozen identical silhouettes.
function syncMarker(view3d, view) {
  let target;
  if (view3d.selectedUnitId !== -1) {
    for (const unit of view.units) {
      if (unit.id === view3d.selectedUnitId
        && (unit.state === 1 || unit.state === 2)) target = unit;
    }
  }
  if (target === undefined) {
    if (view3d.marker !== null) view3d.marker.visible = false;
    return;
  }
  if (view3d.marker === null) {
    view3d.marker = buildSelectionMarker();
    view3d.scene.add(view3d.marker);
  }
  view3d.marker.visible = true;
  view3d.marker.position.set(
    toMetres(target.x),
    toMetres(target.z) + 26 + Math.sin(view3d.elapsed * 3) * 2.5,
    -toMetres(target.y),
  );
  view3d.marker.rotation.y = view3d.elapsed * 1.4;
}

function renderView(view3d, view, deltaSeconds, podBuildTicks) {
  view3d.elapsed += deltaSeconds;
  // The sky first: everything else is lit by whatever it decides.
  applyWeather(view3d, view, deltaSeconds);
  syncIslands(view3d, view);
  syncNodes(view3d, view, podBuildTicks);
  syncCarriers(view3d, view);
  syncUnits(view3d, view);
  syncTurrets(view3d, view);
  syncShots(view3d, view);
  syncMarker(view3d, view);
  placeCamera(view3d, chaseSubject(view3d, view));
  const uniforms = view3d.ocean.material.uniforms;
  if (uniforms !== undefined) {
    // Our own water calls it uTime; the vendored mirror water calls it time.
    if (uniforms.uTime !== undefined) uniforms.uTime.value = view3d.elapsed;
    if (uniforms.time !== undefined) uniforms.time.value = view3d.elapsed;
  }
  syncSea(view3d, view);
  view3d.renderer.render(view3d.scene, view3d.camera);
}

// How far the sun may move before the sky is worth baking again. PMREM is
// expensive (docs/07 lesson 4) and the environment map is a low-frequency
// thing - a couple of degrees of sun makes no visible difference to it, and
// baking every frame costs more than the whole rest of the scene.
const ENV_REBAKE_COSINE = 0.9995;

// One frame of weather (owner's ask, 2026-08-26). The war says what the sky
// is; this puts it on the screen. High tier and a physical-sky style only -
// everywhere else the sun stays where it always was, because a fixed sun is
// exactly what those tiers were tuned around.
function applyWeather(view3d, view, deltaSeconds) {
  const weather = view === undefined ? undefined : view.weather;
  if (weather === undefined) return;
  if (!wantsPhysicalSky(view3d.preset, view3d.style)) return;

  const sky = skyStateOf(weather);
  sunDirection(weather, view3d.sunDir);

  // The light itself.
  if (view3d.sun !== undefined && view3d.sun !== null) {
    const reach = view3d.sizeMetres * 0.9;
    view3d.sun.position.set(
      view3d.sizeMetres / 2 + view3d.sunDir.x * reach,
      Math.max(view3d.sizeMetres * 0.05, view3d.sunDir.y * reach),
      -view3d.sizeMetres / 2 + view3d.sunDir.z * reach,
    );
    view3d.sun.color.copy(sky.lightColour);
    view3d.sun.intensity = sky.sunIntensity;
  }
  if (view3d.hemi !== undefined && view3d.hemi !== null) {
    view3d.hemi.intensity = sky.hemiIntensity;
  }
  view3d.renderer.toneMappingExposure = sky.exposure;
  if (view3d.scene.fog !== null && view3d.scene.fog !== undefined) {
    view3d.scene.fog.color.copy(sky.fogColour);
    if (view3d.scene.fog.density !== undefined) {
      view3d.scene.fog.density = view3d.fogDensityBase / Math.max(0.2, sky.fogFar);
    }
  }

  // The dome, and the image-based light baked from it.
  if (view3d.skyDome !== null && view3d.skyDome !== undefined) {
    const uniforms = view3d.skyDome.material.uniforms;
    uniforms.sunPosition.value.copy(view3d.sunDir);
    uniforms.turbidity.value = sky.turbidity;
    // The sky BEHIND the cloud has to darken too, and rayleigh is the lever:
    // docs/07 lesson 3 records that raising it makes the sky brighter, so
    // lowering it is how a storm gets a dark sky rather than a bright one
    // with dark cloud pasted over it.
    //
    // This also fixes the sea. The mirror water reflects the dome, and at the
    // grazing angles that fill most of the frame the reflection is ALL of the
    // colour - `waterColor` has no say there at all. So a bright dome meant a
    // bright sea in a squall, brighter than the same sea at noon, and no
    // amount of tinting the water could touch it.
    uniforms.rayleigh.value = 2.0 * (1 - 0.78 * sky.storm) * (1 - 0.25 * sky.cloud);
    if (view3d.sunDir.dot(view3d.envSunDir) < ENV_REBAKE_COSINE) {
      view3d.envSunDir.copy(view3d.sunDir);
      rebakeEnvironment(view3d);
    }
  }
  if (view3d.clouds !== null && view3d.clouds !== undefined) {
    updateClouds(view3d, weather, sky, deltaSeconds);
  }
}

// Re-bake the sky into an environment map. Behind the dirty flag above, and
// it disposes the target it replaces - two of these a second with no dispose
// is how a scene runs out of texture memory in a long war.
function rebakeEnvironment(view3d) {
  const pmrem = new THREE.PMREMGenerator(view3d.renderer);
  const skyScene = new THREE.Scene();
  const dome = view3d.skyDome;
  const parent = dome.parent;
  skyScene.add(dome);
  const target = pmrem.fromScene(skyScene);
  pmrem.dispose();
  if (view3d.envTarget !== null) view3d.envTarget.dispose();
  view3d.envTarget = target;
  view3d.scene.environment = target.texture;
  if (parent !== null && parent !== undefined) parent.add(dome);
  else view3d.scene.add(dome);
}

// The colour a sea goes when the weather has its way with it: a cold
// grey-blue, deliberately darker than any style's fair-weather ocean.
const STORM_SEA = new THREE.Color(0x1b2530);

// The sea, as the weather leaves it. The mirror water's ripples grow and
// steepen with the wind; our own shader sea gets the same treatment through
// its own uniforms; and the near-field swell patch rides under the eye.
// The mirror water renders the whole scene from a mirrored camera to build
// its reflection. The cloud shell must not be in that pass: it RIDES THE EYE
// (that is what makes a shell work at all), so from a mirrored camera it is
// in the wrong place entirely, and what it puts on the water is not a cloud
// reflection but a smear that moves with the ship. It showed up as pale
// mottled patches that grew with cover, which reads as "the sea has weird
// bald spots".
//
// Water.js already hides ITSELF for that pass with `scope.visible = false`;
// this does the same for the shell by wrapping the hook rather than editing
// the vendored file. The Preetham dome still reflects, so the sea keeps a
// sky in it - just the sky's colour rather than a cloud in the wrong place.
function keepCloudsOutOfReflections(view3d, ocean) {
  const original = ocean.onBeforeRender;
  if (typeof original !== 'function') return;
  ocean.onBeforeRender = function wrapped(renderer, scene, camera) {
    const clouds = view3d.clouds;
    const wasVisible = clouds === null || clouds === undefined ? false : clouds.visible;
    if (clouds !== null && clouds !== undefined) clouds.visible = false;
    original.call(this, renderer, scene, camera);
    if (clouds !== null && clouds !== undefined) clouds.visible = wasVisible;
  };
}

// The one sea colour, computed once and given to BOTH surfaces. The swell
// patch and the mirror plane are different materials drawing the same water,
// and while the mirror was being tinted by the weather the patch kept a
// hardcoded blue - so the seam where the patch fades out became visible as a
// tone step in the middle of the picture, worse the heavier the weather.
// Anything that colours the sea has to colour all of it.
function seaColourFor(view3d, sky, out) {
  out.set(view3d.style.oceanColour);
  out.lerp(STORM_SEA, sky.storm * 0.75 + sky.cloud * 0.2);
  out.multiplyScalar(0.35 + 0.65 * sky.day);
  return out;
}

const SEA_SCRATCH = new THREE.Color();

function syncSea(view3d, view) {
  const weather = view === undefined ? undefined : view.weather;
  if (weather === undefined) return;
  const sky = skyStateOf(weather);
  const seaColour = seaColourFor(view3d, sky, SEA_SCRATCH);
  const uniforms = view3d.ocean.material.uniforms;
  if (uniforms !== undefined && uniforms.distortionScale !== undefined) {
    // The vendored mirror water. `size` is the ripple scale and
    // `distortionScale` how hard they bend the reflection - a calm sea is
    // large and lazy, a gale is small and violent.
    const wind = weather.windPermil / 1000;
    uniforms.size.value = 3 + wind * 9;
    uniforms.distortionScale.value = 1.8 + wind * 5.5;
    if (uniforms.sunDirection !== undefined) {
      uniforms.sunDirection.value.copy(view3d.sunDir);
    }
    // The sea takes its colour from the sky above it. Without this the water
    // kept its fair-weather blue and its white sun glitter through a squall,
    // and a storm at dawn came out brown: the sea was the brightest, warmest
    // thing in the frame, which is the one thing a storm sea is not.
    if (uniforms.waterColor !== undefined) {
      uniforms.waterColor.value.copy(seaColour);
    }
    if (uniforms.sunColor !== undefined) {
      uniforms.sunColor.value.copy(sky.lightColour);
      uniforms.sunColor.value.multiplyScalar(1 - sky.storm * 0.6);
    }
  }
  if (uniforms !== undefined && uniforms.uSunDir !== undefined) {
    uniforms.uSunDir.value.copy(view3d.sunDir);
  }
  if (view3d.swell !== null && view3d.swell !== undefined) {
    updateSwell(view3d, weather, sky, seaColour);
  }
}

// A NEW war on the same page: same renderer, same camera, fresh world. The
// old graph is dropped whole - islands and nodes are cached by id, and a new
// war puts different geometry under the same ids - and the ocean is rebuilt
// at the new war's size, because the room may have chosen a different
// archipelago. The renderer and canvas survive: a second WebGL context on the
// same canvas is not a thing a browser hands out twice.
function resetWorld(view3d, sizeMetres) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(view3d.style.sky);
  const fogDensity = view3d.preset.fogDensity * view3d.style.fogDensityScale;
  if (fogDensity > 0) scene.fog = new THREE.FogExp2(view3d.style.sky, fogDensity);
  createLights(scene, view3d.preset, sizeMetres, view3d.style);
  const ocean = wantsMirrorWater(view3d.preset, view3d.style)
    ? buildMirrorOcean(sizeMetres, view3d.style, scene.fog)
    : buildOcean(sizeMetres, view3d.preset, view3d.style);
  scene.add(ocean);
  if (view3d.style.oceanGrid) scene.add(buildOceanGrid(sizeMetres, view3d.style));
  view3d.scene = scene;
  view3d.ocean = ocean;
  if (wantsPhysicalSky(view3d.preset, view3d.style)) {
    addPhysicalSky(view3d);
    // A NEW war brings a new ocean object, so the reflection hook has to be
    // put back on it - the old one went out with the old graph.
    if (view3d.clouds !== null && view3d.clouds !== undefined) {
      scene.add(view3d.clouds);
      keepCloudsOutOfReflections(view3d, ocean);
    }
    if (view3d.swell !== null && view3d.swell !== undefined) scene.add(view3d.swell);
  }
  view3d.islands = {};
  view3d.nodes = {};
  view3d.runways = {};
  view3d.carriers = {};
  view3d.units = {};
  view3d.shots = {};
  view3d.turrets = {};
  view3d.followUnitId = -1;
  view3d.selectedUnitId = -1;
  view3d.marker = null;
  view3d.strategic = false;
  view3d.gunsight = false;
  view3d.rearView = false;
  view3d.droneView = false;
  view3d.droneUnitId = -1;
  return view3d;
}

function resize(view3d) {
  const width = window.innerWidth;
  const height = Math.max(1, window.innerHeight);
  view3d.camera.aspect = width / height;
  view3d.camera.updateProjectionMatrix();
  view3d.renderer.setSize(width, height, false);
}

export { createScene, resetWorld, renderView, resize, ownCarrierOf, pickSea, TEAM_COLOURS };
