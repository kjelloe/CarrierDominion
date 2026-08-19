// client/render/world.js - meshes built from engine data.
//
// The terrain mesh is sampled from engine/heightmap.js, the same function the
// server uses to decide whether a hull runs aground. There is no second,
// prettier heightmap: if the mesh shows a beach, the collision agrees.

import * as THREE from 'three';
import { islandHeightAt } from '../../engine/heightmap.js';
import { toMetres } from './coords.js';

const SEA_FLOOR_METRES = -60;

// Quantising the height before colouring it is what gives the retro styles
// their banded, map-like land: the same terrain, painted in four steps instead
// of a continuum.
function terrainColour(heightMetres, peakMetres, steps, target) {
  if (heightMetres < 0) return target.setRGB(0.16, 0.22, 0.26);
  if (heightMetres < 6) return target.setRGB(0.78, 0.72, 0.52);
  let t = Math.min(1, heightMetres / Math.max(1, peakMetres));
  if (steps > 0) t = Math.round(t * steps) / steps;
  if (t < 0.55) return target.setRGB(0.20 + t * 0.16, 0.42 - t * 0.10, 0.18);
  if (t < 0.85) return target.setRGB(0.42, 0.40, 0.36);
  return target.setRGB(0.86, 0.87, 0.90);
}

// One island, sampled on a grid across its bounding box. Grid resolution comes
// from the graphics preset; the geometry itself is identical in shape at every
// tier, only finer.
function buildIslandMesh(island, preset, style) {
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
      terrainColour(heightMetres, peakMetres, style.paletteSteps, colour);
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

  const material = new THREE.MeshLambertMaterial({
    vertexColors: true,
    flatShading: style.flatShading,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.receiveShadow = preset.shadows;
  mesh.castShadow = preset.shadows;
  mesh.name = `island-${island.id}`;
  return mesh;
}

// Detail smaller than a pixel is not detail, it is noise. A 100 m ripple seen
// from the strategic camera 7 km up crosses several waves per pixel and turns
// the whole sea into moire banding, so both the swell and the ripple are faded
// out with distance instead of being drawn at frequencies the screen cannot
// carry. Near the ship, where a wave is tens of pixels across, they are intact.
const OCEAN_VERTEX = `
  uniform float uTime;
  varying vec3 vWorld;
  varying float vDetail;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vDetail = 1.0 - smoothstep(900.0, 3600.0, length(cameraPosition - world.xyz));
    float w = sin(world.x * 0.012 + uTime * 1.1) * 0.9
            + sin(world.z * 0.017 - uTime * 0.8) * 0.7
            + sin((world.x + world.z) * 0.006 + uTime * 0.5) * 1.2;
    world.y += w * vDetail;
    vWorld = world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const OCEAN_FRAGMENT = `
  uniform vec3 uShallow;
  uniform vec3 uDeep;
  uniform float uTime;
  varying vec3 vWorld;
  varying float vDetail;
  void main() {
    float ripple = 0.5 + 0.5 * sin(vWorld.x * 0.014 + vWorld.z * 0.011 + uTime * 1.7) * vDetail;
    vec3 colour = mix(uDeep, uShallow, ripple * 0.35);
    gl_FragColor = vec4(colour, 1.0);
  }
`;

// The ocean is cosmetic: engine sea level is exactly z = 0 and waves never
// touch the simulation.
function buildOcean(sizeMetres, preset, style) {
  const segments = preset.oceanSegments;
  const geometry = new THREE.PlaneGeometry(sizeMetres * 1.5, sizeMetres * 1.5, segments, segments);
  let material;
  if (preset.oceanShader && style.oceanShader) {
    material = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uShallow: { value: new THREE.Color(0.20, 0.45, 0.55) },
        uDeep: { value: new THREE.Color(style.oceanColour) },
      },
      vertexShader: OCEAN_VERTEX,
      fragmentShader: OCEAN_FRAGMENT,
    });
  } else {
    material = new THREE.MeshBasicMaterial({ color: new THREE.Color(style.oceanColour) });
  }
  const mesh = new THREE.Mesh(geometry, material);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(sizeMetres / 2, 0, -sizeMetres / 2);
  mesh.name = 'ocean';
  return mesh;
}

// The 1988 sea was a grid running to a hard horizon. It is also the cheapest
// possible sense of speed: without it, a flat colour gives the eye nothing to
// measure motion against.
function buildOceanGrid(sizeMetres) {
  // Fixed ~300 m spacing rather than a fixed division count: the map grows
  // with the island count, and a count would stretch the mesh until it stopped
  // reading as motion.
  //
  // Not GridHelper. Its lines run the full width of the map, so the ones on
  // either side of the ship have an endpoint far behind the camera - and a
  // segment with a vertex behind the eye is exactly what line clipping gets
  // wrong: the whole line disappears. The grid then survives only in the
  // distance, which is the one place it does nothing, and vanishes from the
  // near water, which is the only place it sells speed. Cutting every line at
  // each crossing costs ~40k vertices once and cannot fail that way.
  const span = sizeMetres * 1.5;
  const cells = Math.max(40, Math.round(span / 300));
  const step = span / cells;
  const origin = sizeMetres / 2 - span / 2;
  const points = [];
  for (let line = 0; line <= cells; line += 1) {
    const fixed = origin + line * step;
    for (let cell = 0; cell < cells; cell += 1) {
      const from = origin + cell * step;
      const to = from + step;
      points.push(fixed, 6, -from, fixed, 6, -to);
      points.push(from, 6, -fixed, to, 6, -fixed);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
  // Faded with range, or the far cells pile into a solid slab of blue along
  // the horizon - which is both ugly and a lie about how far you can see.
  const material = new THREE.ShaderMaterial({
    uniforms: { uColour: { value: new THREE.Color(0x4fc3ff) } },
    vertexShader: `
      varying float vFade;
      void main() {
        vec4 world = modelMatrix * vec4(position, 1.0);
        vFade = 1.0 - smoothstep(2500.0, 8000.0, length(cameraPosition - world.xyz));
        gl_Position = projectionMatrix * viewMatrix * world;
      }
    `,
    fragmentShader: `
      uniform vec3 uColour;
      varying float vFade;
      void main() {
        if (vFade <= 0.02) discard;
        gl_FragColor = vec4(uColour, 0.55 * vFade);
      }
    `,
    transparent: true,
    depthWrite: false,
  });
  const grid = new THREE.LineSegments(geometry, material);
  grid.name = 'ocean-grid';
  return grid;
}

// A placeholder hull: a 330 m box with an island superstructure and a bow
// wedge, enough to read heading and scale at a glance.
function buildCarrier(teamColour, preset, style) {
  const group = new THREE.Group();
  const hullMaterial = new THREE.MeshLambertMaterial({ color: teamColour });
  const deckMaterial = new THREE.MeshLambertMaterial({
    color: style.deck,
    flatShading: style.flatShading,
  });

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

// A lighter: a blunt barge with a deckhouse aft. Read at a distance it should
// never be mistaken for a Walrus - one of these is a target worth chasing.
function buildLighter(teamColour) {
  const group = new THREE.Group();
  const hull = new THREE.Mesh(
    new THREE.BoxGeometry(26, 6, 11),
    new THREE.MeshLambertMaterial({ color: teamColour }),
  );
  hull.position.y = 3;
  group.add(hull);
  const cargo = new THREE.Mesh(
    new THREE.BoxGeometry(13, 5, 8),
    new THREE.MeshLambertMaterial({ color: 0x9a8f6a }),
  );
  cargo.position.set(3, 8, 0);
  group.add(cargo);
  const house = new THREE.Mesh(
    new THREE.BoxGeometry(6, 6, 7),
    new THREE.MeshLambertMaterial({ color: 0x62707c }),
  );
  house.position.set(-9, 9, 0);
  group.add(house);
  return group;
}

// A shot is drawn as a lit dart, not a hull: it is unlit on purpose so it reads
// as its own light source against a night sea, and it is small enough that
// seeing one at all means something is being shot at.
function buildShot(teamColour) {
  const group = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(1.6, 1.6, 22, 6),
    new THREE.MeshBasicMaterial({ color: teamColour }),
  );
  body.geometry.rotateZ(-Math.PI / 2);
  group.add(body);
  const flame = new THREE.Mesh(
    new THREE.SphereGeometry(3.4, 6, 5),
    new THREE.MeshBasicMaterial({ color: 0xffd58a }),
  );
  flame.position.x = -13;
  group.add(flame);
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
  buildOceanGrid,
  buildCarrier,
  buildManta,
  buildWalrus,
  buildLighter,
  buildShot,
  buildCommandNode,
  updateCommandNode,
  NEUTRAL_NODE_COLOUR,
  SEA_FLOOR_METRES,
};
