// client/render/scene.js - the three.js side of the client.
//
// Renders whatever the latest VIEW says, at whatever frame rate the browser
// offers, interpolating between the 20 Hz snapshots. It knows nothing about
// transports, commands, or the engine's internals - hand it a view, it draws
// that view.

import * as THREE from 'three';
import { forwardFromHeading, headingToYaw, toMetres } from './coords.js';
import {
  NEUTRAL_NODE_COLOUR,
  buildCarrier,
  buildCommandNode,
  buildIslandMesh,
  buildLighter,
  buildManta,
  buildOcean,
  buildOceanGrid,
  buildShot,
  buildTurret,
  buildWalrus,
  updateCommandNode,
} from './world.js';
import { islandHeightAt } from '../../engine/heightmap.js';

const TEAM_COLOURS = [0x4f7fa8, 0xa85b4f];
const CHASE_BACK_METRES = 780;
const CHASE_UP_METRES = 400;
const STRATEGIC_UP_METRES = 7000;

function createRenderer(canvas, preset) {
  const renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: preset.antialias });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, preset.pixelRatioCap));
  renderer.shadowMap.enabled = preset.shadows;
  if (preset.shadows) renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  return renderer;
}

function createLights(scene, preset, sizeMetres, style) {
  scene.add(new THREE.HemisphereLight(0xbcd8f0, 0x35506a, style.hemiIntensity));
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
  return sun;
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

  const renderer = createRenderer(canvas, preset);
  createLights(scene, preset, sizeMetres, style);

  const ocean = buildOcean(sizeMetres, preset, style);
  scene.add(ocean);
  if (style.oceanGrid) scene.add(buildOceanGrid(sizeMetres));

  return {
    scene: scene,
    camera: camera,
    renderer: renderer,
    ocean: ocean,
    preset: preset,
    style: style,
    islands: {},
    nodes: {},
    carriers: {},
    units: {},
    shots: {},
    turrets: {},
    strategic: false,
    gunsight: false,
    followUnitId: -1,
    elapsed: 0,
    raycaster: new THREE.Raycaster(),
    seaPlane: new THREE.Plane(new THREE.Vector3(0, 1, 0), 0),
  };
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
      if (unit.kind === 0) group = buildManta(colour);
      else if (unit.kind === 2) group = buildLighter(colour);
      else group = buildWalrus(colour);
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
    const group = buildTurret(TEAM_COLOURS[turret.team % TEAM_COLOURS.length], turret.kind === 1);
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
  const x = toMetres(subject.x);
  const z = -toMetres(subject.y);
  const y = toMetres(subject.z);
  if (view3d.strategic) {
    view3d.camera.position.set(x, STRATEGIC_UP_METRES, z + 1200);
    view3d.camera.lookAt(x, 0, z);
    return;
  }
  const forward = forwardFromHeading(subject.heading);
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

function renderView(view3d, view, deltaSeconds, podBuildTicks) {
  view3d.elapsed += deltaSeconds;
  syncIslands(view3d, view);
  syncNodes(view3d, view, podBuildTicks);
  syncCarriers(view3d, view);
  syncUnits(view3d, view);
  syncTurrets(view3d, view);
  syncShots(view3d, view);
  placeCamera(view3d, chaseSubject(view3d, view));
  if (view3d.ocean.material.uniforms !== undefined) {
    view3d.ocean.material.uniforms.uTime.value = view3d.elapsed;
  }
  view3d.renderer.render(view3d.scene, view3d.camera);
}

function resize(view3d) {
  const width = window.innerWidth;
  const height = Math.max(1, window.innerHeight);
  view3d.camera.aspect = width / height;
  view3d.camera.updateProjectionMatrix();
  view3d.renderer.setSize(width, height, false);
}

export { createScene, renderView, resize, ownCarrierOf, pickSea, TEAM_COLOURS };
