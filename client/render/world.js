// client/render/world.js - meshes built from engine data.
//
// The terrain mesh is sampled from engine/heightmap.js, the same function the
// server uses to decide whether a hull runs aground. There is no second,
// prettier heightmap: if the mesh shows a beach, the collision agrees.

import * as THREE from 'three';
import { islandHeightAt } from '../../engine/heightmap.js';
import { toMetres } from './coords.js';

const SEA_FLOOR_METRES = -60;

function terrainColour(heightMetres, peakMetres, target) {
  if (heightMetres < 0) return target.setRGB(0.16, 0.22, 0.26);
  if (heightMetres < 6) return target.setRGB(0.78, 0.72, 0.52);
  const t = Math.min(1, heightMetres / Math.max(1, peakMetres));
  if (t < 0.55) return target.setRGB(0.20 + t * 0.16, 0.42 - t * 0.10, 0.18);
  if (t < 0.85) return target.setRGB(0.42, 0.40, 0.36);
  return target.setRGB(0.86, 0.87, 0.90);
}

// One island, sampled on a grid across its bounding box. Grid resolution comes
// from the graphics preset; the geometry itself is identical in shape at every
// tier, only finer.
function buildIslandMesh(island, preset) {
  const grid = preset.terrainGrid;
  const radius = island.radius;
  const span = radius * 2;
  const vertexCount = (grid + 1) * (grid + 1);
  const positions = new Float32Array(vertexCount * 3);
  const colours = new Float32Array(vertexCount * 3);
  const colour = new THREE.Color();
  const peakMetres = toMetres(island.peak);

  for (let j = 0; j <= grid; j++) {
    for (let i = 0; i <= grid; i++) {
      const index = j * (grid + 1) + i;
      const xUnits = Math.round(island.x - radius + (span * i) / grid);
      const yUnits = Math.round(island.y - radius + (span * j) / grid);
      const heightMetres = toMetres(islandHeightAt(island, xUnits, yUnits));
      const clamped = Math.max(heightMetres, SEA_FLOOR_METRES);
      positions[index * 3] = toMetres(xUnits);
      positions[index * 3 + 1] = clamped;
      positions[index * 3 + 2] = -toMetres(yUnits);
      terrainColour(heightMetres, peakMetres, colour);
      colours[index * 3] = colour.r;
      colours[index * 3 + 1] = colour.g;
      colours[index * 3 + 2] = colour.b;
    }
  }

  const indices = [];
  for (let j = 0; j < grid; j++) {
    for (let i = 0; i < grid; i++) {
      const a = j * (grid + 1) + i;
      const b = a + 1;
      const c = a + grid + 1;
      const d = c + 1;
      // Winding matters twice over: it decides which side is culled AND which
      // way computeVertexNormals points. Engine north maps to -z, which flips
      // the handedness of the grid, so the naive order (a, c, b) faces the
      // seabed - the islands were invisible from above and unlit from the side.
      indices.push(a, b, c, b, d, c);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colours, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();

  const material = new THREE.MeshLambertMaterial({ vertexColors: true });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.receiveShadow = preset.shadows;
  mesh.castShadow = preset.shadows;
  mesh.name = `island-${island.id}`;
  return mesh;
}

const OCEAN_VERTEX = `
  uniform float uTime;
  varying vec3 vWorld;
  void main() {
    vec3 p = position;
    float w = sin(p.x * 0.012 + uTime * 1.1) * 0.9
            + sin(p.y * 0.017 - uTime * 0.8) * 0.7
            + sin((p.x + p.y) * 0.006 + uTime * 0.5) * 1.2;
    p.z += w;
    vec4 world = modelMatrix * vec4(p, 1.0);
    vWorld = world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const OCEAN_FRAGMENT = `
  uniform vec3 uShallow;
  uniform vec3 uDeep;
  uniform float uTime;
  varying vec3 vWorld;
  void main() {
    float ripple = 0.5 + 0.5 * sin(vWorld.x * 0.05 + vWorld.z * 0.04 + uTime * 1.7);
    vec3 colour = mix(uDeep, uShallow, ripple * 0.35);
    gl_FragColor = vec4(colour, 1.0);
  }
`;

// The ocean is cosmetic: engine sea level is exactly z = 0 and waves never
// touch the simulation.
function buildOcean(sizeMetres, preset) {
  const segments = preset.oceanSegments;
  const geometry = new THREE.PlaneGeometry(sizeMetres * 1.5, sizeMetres * 1.5, segments, segments);
  let material;
  if (preset.oceanShader) {
    material = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uShallow: { value: new THREE.Color(0.20, 0.45, 0.55) },
        uDeep: { value: new THREE.Color(0.04, 0.12, 0.22) },
      },
      vertexShader: OCEAN_VERTEX,
      fragmentShader: OCEAN_FRAGMENT,
    });
  } else {
    material = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.07, 0.18, 0.28) });
  }
  const mesh = new THREE.Mesh(geometry, material);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(sizeMetres / 2, 0, -sizeMetres / 2);
  mesh.name = 'ocean';
  return mesh;
}

// A placeholder hull: a 330 m box with an island superstructure and a bow
// wedge, enough to read heading and scale at a glance.
function buildCarrier(teamColour, preset) {
  const group = new THREE.Group();
  const hullMaterial = new THREE.MeshLambertMaterial({ color: teamColour });
  const deckMaterial = new THREE.MeshLambertMaterial({ color: 0x424b55 });

  const hull = new THREE.Mesh(new THREE.BoxGeometry(330, 26, 72), hullMaterial);
  hull.position.y = 8;
  group.add(hull);

  const deck = new THREE.Mesh(new THREE.BoxGeometry(320, 3, 84), deckMaterial);
  deck.position.y = 22;
  group.add(deck);

  const superstructure = new THREE.Mesh(new THREE.BoxGeometry(34, 30, 22), hullMaterial);
  superstructure.position.set(-40, 38, 26);
  group.add(superstructure);

  // Rotate the GEOMETRY, not the mesh: composing two Euler angles on the mesh
  // makes the bow point somewhere diagonal, which is exactly the cue the
  // player uses to read heading.
  const bowGeometry = new THREE.ConeGeometry(36, 70, 4);
  bowGeometry.rotateY(Math.PI / 4);
  bowGeometry.rotateZ(-Math.PI / 2);
  const bow = new THREE.Mesh(bowGeometry, deckMaterial);
  bow.position.set(195, 10, 0);
  group.add(bow);

  if (preset.shadows) {
    for (const child of group.children) {
      child.castShadow = true;
      child.receiveShadow = true;
    }
  }
  return group;
}

// A Manta: a small delta pointing along +x, the same axis a carrier's bow uses,
// so one heading-to-yaw rule serves every hull in the game.
function buildManta(teamColour) {
  const group = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.ConeGeometry(9, 26, 3),
    new THREE.MeshLambertMaterial({ color: teamColour }),
  );
  body.geometry.rotateZ(-Math.PI / 2);
  group.add(body);
  const wing = new THREE.Mesh(
    new THREE.BoxGeometry(9, 1.4, 30),
    new THREE.MeshLambertMaterial({ color: 0x8fa4b8 }),
  );
  wing.position.x = -4;
  group.add(wing);
  return group;
}

// A Walrus: a squat hull with a turret block, deliberately unlike the Manta at
// a distance - most of the time you are reading these as silhouettes.
function buildWalrus(teamColour) {
  const group = new THREE.Group();
  const hull = new THREE.Mesh(
    new THREE.BoxGeometry(16, 5, 9),
    new THREE.MeshLambertMaterial({ color: teamColour }),
  );
  hull.position.y = 2.5;
  group.add(hull);
  const turret = new THREE.Mesh(
    new THREE.BoxGeometry(7, 4, 6),
    new THREE.MeshLambertMaterial({ color: 0x707c88 }),
  );
  turret.position.set(-1, 7, 0);
  group.add(turret);
  return group;
}

const NEUTRAL_NODE_COLOUR = 0xb9b3a4;

// The command node: a mast on a plinth, tall enough to spot from the air,
// coloured by whoever owns the island. A pod under construction shows as a ring
// that fills - see updateNodeProgress.
function buildCommandNode() {
  const group = new THREE.Group();
  const plinth = new THREE.Mesh(
    new THREE.CylinderGeometry(14, 18, 6, 8),
    new THREE.MeshLambertMaterial({ color: 0x5b5f66 }),
  );
  plinth.position.y = 3;
  group.add(plinth);
  const mast = new THREE.Mesh(
    new THREE.CylinderGeometry(2.5, 3.5, 44, 6),
    new THREE.MeshLambertMaterial({ color: NEUTRAL_NODE_COLOUR }),
  );
  mast.position.y = 28;
  mast.name = 'mast';
  group.add(mast);
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(11, 1.6, 6, 24),
    new THREE.MeshBasicMaterial({ color: NEUTRAL_NODE_COLOUR }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 7;
  ring.visible = false;
  ring.name = 'ring';
  group.add(ring);
  return group;
}

// owner < 0 is neutral. `progress` is 0..1 for a pod being built, or 0 for
// none; the ring appears only while one is going up.
function updateCommandNode(group, ownerColour, podColour, progress) {
  const mast = group.getObjectByName('mast');
  if (mast !== undefined) mast.material.color.setHex(ownerColour);
  const ring = group.getObjectByName('ring');
  if (ring === undefined) return;
  ring.visible = progress > 0;
  if (progress > 0) {
    ring.material.color.setHex(podColour);
    const scale = 0.35 + progress * 0.65;
    ring.scale.set(scale, scale, 1);
  }
}

export {
  buildIslandMesh,
  buildOcean,
  buildCarrier,
  buildManta,
  buildWalrus,
  buildCommandNode,
  updateCommandNode,
  NEUTRAL_NODE_COLOUR,
  SEA_FLOOR_METRES,
};
