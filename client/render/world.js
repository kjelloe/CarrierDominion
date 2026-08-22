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

// The High-tier fragment (docs/07-graphics.md, phase 1). Same vertex swell as
// Medium - the geometry must not drift between tiers - but the surface NORMAL
// is rebuilt per pixel from finer wave octaves, analytically: each octave is a
// sine, so its slope is a cosine and the normal costs no texture and tiles by
// construction. On top of that, the two things that make water read as water:
// fresnel (grazing angles lean toward the sky, near-vertical looks into the
// deep) and a specular glint down the scene's one fixed sun direction. All of
// it fades with vDetail, like the swell, so the strategic camera sees calm
// colour rather than shimmer-per-pixel noise.
const OCEAN_FRAGMENT_DETAIL = `
  uniform vec3 uShallow;
  uniform vec3 uDeep;
  uniform vec3 uSky;
  uniform vec3 uSunDir;
  uniform float uTime;
  varying vec3 vWorld;
  varying float vDetail;

  // Slope of the ripple field at this point: d/dx and d/dz of a handful of
  // travelling sines. Frequencies are spread irrationally so the pattern
  // never visibly repeats inside a map.
  vec2 rippleSlope(vec2 p, float t) {
    vec2 slope = vec2(0.0);
    slope += vec2(0.051, 0.033) * cos(dot(p, vec2(0.051, 0.033)) + t * 1.9) * 0.9;
    slope += vec2(-0.037, 0.061) * cos(dot(p, vec2(-0.037, 0.061)) - t * 1.4) * 0.7;
    slope += vec2(0.089, -0.074) * cos(dot(p, vec2(0.089, -0.074)) + t * 2.6) * 0.45;
    slope += vec2(0.153, 0.121) * cos(dot(p, vec2(0.153, 0.121)) - t * 3.4) * 0.25;
    slope += vec2(-0.201, 0.088) * cos(dot(p, vec2(-0.201, 0.088)) + t * 4.1) * 0.18;
    return slope;
  }

  void main() {
    vec2 slope = rippleSlope(vWorld.xz, uTime) * vDetail;
    vec3 normal = normalize(vec3(-slope.x, 1.0, -slope.y));
    vec3 view = normalize(cameraPosition - vWorld);

    float facing = max(dot(normal, view), 0.0);
    float fresnel = pow(1.0 - facing, 5.0);
    fresnel = 0.04 + 0.96 * fresnel;

    float ripple = 0.5 + 0.5 * sin(vWorld.x * 0.014 + vWorld.z * 0.011 + uTime * 1.7) * vDetail;
    vec3 body = mix(uDeep, uShallow, ripple * 0.35);
    vec3 colour = mix(body, uSky, fresnel * 0.6);

    // The glint path: tight and additive, brightest where the ripples happen
    // to mirror the sun into the eye - which is what sells the normals.
    float glint = pow(max(dot(reflect(-uSunDir, normal), view), 0.0), 160.0);
    colour += vec3(1.0, 0.93, 0.78) * glint * 0.9 * vDetail;

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
    // The sun direction matches createLights: the light stands at
    // (0.9, 0.6, -0.15) of the map with its target at the centre
    // (0.5, 0, -0.5), so the direction TO the sun is (0.4, 0.6, 0.35).
    material = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uShallow: { value: new THREE.Color(0.20, 0.45, 0.55) },
        uDeep: { value: new THREE.Color(style.oceanColour) },
        uSky: { value: new THREE.Color(style.sky) },
        uSunDir: { value: new THREE.Vector3(0.4, 0.6, 0.35).normalize() },
      },
      vertexShader: OCEAN_VERTEX,
      fragmentShader: preset.oceanDetail ? OCEAN_FRAGMENT_DETAIL : OCEAN_FRAGMENT,
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
      // A metre above the water, not six: at six the grid draws over every
      // beach in the archipelago, because a beach is lower than that.
      points.push(fixed, 1, -from, fixed, 1, -to);
      points.push(from, 1, -fixed, to, 1, -fixed);
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

  // The island earns its silhouette (playtest ruling 2026-08-22): a bridge
  // with a dark window band, a mast with a radar bar, and a runway stripe on
  // the deck - the cues that make a distant slab read as a CARRIER.
  const bridge = new THREE.Mesh(new THREE.BoxGeometry(22, 8, 24), hullMaterial);
  bridge.position.set(-36, 57, 26);
  group.add(bridge);
  const windows = new THREE.Mesh(
    new THREE.BoxGeometry(22.4, 2.6, 24.4),
    new THREE.MeshLambertMaterial({ color: 0x141c26 }),
  );
  windows.position.set(-36, 58.6, 26);
  group.add(windows);
  const mast = new THREE.Mesh(
    new THREE.CylinderGeometry(1.4, 2, 26, 6),
    new THREE.MeshLambertMaterial({ color: 0x3c444c }),
  );
  mast.position.set(-48, 74, 26);
  group.add(mast);
  const radarBar = new THREE.Mesh(
    new THREE.BoxGeometry(1.6, 1.6, 18),
    new THREE.MeshLambertMaterial({ color: 0xc9d4de }),
  );
  radarBar.position.set(-48, 86, 26);
  group.add(radarBar);
  const stripe = new THREE.Mesh(
    new THREE.BoxGeometry(300, 0.6, 4),
    new THREE.MeshLambertMaterial({ color: 0x39424e }),
  );
  stripe.position.set(-6, 23.9, -8);
  group.add(stripe);

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
// A Manta reads as an AIRCRAFT (playtest ruling 2026-08-22: silhouettes were
// too poor to name). Delta wing, a fuselage proud of it, a canopy, twin fins,
// a nozzle - still low-poly flat primitives, just enough of them that the
// shape answers "what is that" at a glance.
function buildManta(teamColour) {
  const group = new THREE.Group();
  const teamMat = new THREE.MeshLambertMaterial({ color: teamColour });
  const trimMat = new THREE.MeshLambertMaterial({ color: 0x8fa4b8 });

  // The delta: a flattened three-sided cone pointing down +x.
  const deltaGeometry = new THREE.ConeGeometry(13, 30, 3);
  deltaGeometry.rotateZ(-Math.PI / 2);
  deltaGeometry.scale(1, 0.16, 1.7);
  const delta = new THREE.Mesh(deltaGeometry, teamMat);
  delta.position.x = -3;
  group.add(delta);

  // Fuselage ridge and nose.
  const bodyGeometry = new THREE.CylinderGeometry(2.2, 3.6, 22, 6);
  bodyGeometry.rotateZ(-Math.PI / 2);
  const body = new THREE.Mesh(bodyGeometry, teamMat);
  body.position.set(2, 2.2, 0);
  group.add(body);
  const noseGeometry = new THREE.ConeGeometry(2.2, 8, 6);
  noseGeometry.rotateZ(-Math.PI / 2);
  const nose = new THREE.Mesh(noseGeometry, trimMat);
  nose.position.set(17, 2.2, 0);
  group.add(nose);

  // Canopy, twin outward-canted fins, nozzle.
  const canopy = new THREE.Mesh(
    new THREE.SphereGeometry(2.6, 6, 5),
    new THREE.MeshLambertMaterial({ color: 0x1d2b38 }),
  );
  canopy.scale.set(1.9, 0.9, 1);
  canopy.position.set(7, 4.2, 0);
  group.add(canopy);
  for (const side of [-1, 1]) {
    const fin = new THREE.Mesh(new THREE.BoxGeometry(7, 6, 0.8), trimMat);
    fin.position.set(-9, 4.5, side * 5.5);
    fin.rotation.x = side * -0.35;
    group.add(fin);
  }
  const nozzleGeometry = new THREE.CylinderGeometry(2.4, 1.9, 4, 6);
  nozzleGeometry.rotateZ(-Math.PI / 2);
  const nozzle = new THREE.Mesh(
    nozzleGeometry,
    new THREE.MeshLambertMaterial({ color: 0x3a4048 }),
  );
  nozzle.position.set(-10, 2.2, 0);
  group.add(nozzle);
  return group;
}

// A Walrus: a squat hull with a turret block, deliberately unlike the Manta at
// a distance - most of the time you are reading these as silhouettes.
function buildWalrus(teamColour) {
  const group = new THREE.Group();
  const teamMat = new THREE.MeshLambertMaterial({ color: teamColour });
  const darkMat = new THREE.MeshLambertMaterial({ color: 0x3c444c });

  const hull = new THREE.Mesh(new THREE.BoxGeometry(15, 4.5, 9), teamMat);
  hull.position.y = 3.4;
  group.add(hull);
  // The sloped glacis is what says "armoured vehicle" from the side.
  const glacis = new THREE.Mesh(new THREE.BoxGeometry(6, 4.5, 9), teamMat);
  glacis.position.set(9, 2.6, 0);
  glacis.rotation.z = -0.5;
  group.add(glacis);

  const turret = new THREE.Mesh(
    new THREE.CylinderGeometry(3.6, 4.2, 3.4, 8),
    new THREE.MeshLambertMaterial({ color: 0x707c88 }),
  );
  turret.position.set(-0.5, 7.4, 0);
  group.add(turret);
  const barrelGeometry = new THREE.CylinderGeometry(0.8, 0.8, 12, 5);
  barrelGeometry.rotateZ(-Math.PI / 2);
  const barrel = new THREE.Mesh(barrelGeometry, darkMat);
  barrel.position.set(6.5, 7.8, 0);
  group.add(barrel);

  // Wheel drums low on each flank: the amphibious drive train, and the cue
  // that this thing belongs on a beach rather than in the air.
  for (const side of [-1, 1]) {
    for (let i = 0; i < 3; i++) {
      const wheelGeometry = new THREE.CylinderGeometry(2.2, 2.2, 1.6, 8);
      wheelGeometry.rotateX(Math.PI / 2);
      const wheel = new THREE.Mesh(wheelGeometry, darkMat);
      wheel.position.set(-5 + i * 5.5, 2.2, side * 5.1);
      group.add(wheel);
    }
  }
  const stowage = new THREE.Mesh(new THREE.BoxGeometry(4, 2, 7), darkMat);
  stowage.position.set(-6.5, 6.6, 0);
  group.add(stowage);
  return group;
}

// A lighter: a blunt barge with a deckhouse aft. Read at a distance it should
// never be mistaken for a Walrus - one of these is a target worth chasing.
function buildLighter(teamColour) {
  const group = new THREE.Group();
  const teamMat = new THREE.MeshLambertMaterial({ color: teamColour });

  const hull = new THREE.Mesh(new THREE.BoxGeometry(26, 6, 11), teamMat);
  hull.position.y = 3;
  group.add(hull);
  // Raked bow and gunwales: a barge, not a brick.
  const bowGeometry = new THREE.CylinderGeometry(0.1, 5.5, 8, 4);
  bowGeometry.rotateZ(-Math.PI / 2);
  bowGeometry.rotateX(Math.PI / 4);
  const bow = new THREE.Mesh(bowGeometry, teamMat);
  bow.position.set(16.5, 3, 0);
  group.add(bow);
  for (const side of [-1, 1]) {
    const gunwale = new THREE.Mesh(
      new THREE.BoxGeometry(24, 1.6, 1),
      new THREE.MeshLambertMaterial({ color: 0x62707c }),
    );
    gunwale.position.set(0, 6.6, side * 5);
    group.add(gunwale);
  }

  // The open hold, darker and BELOW the gunwales, with crates riding in it.
  const hold = new THREE.Mesh(
    new THREE.BoxGeometry(14, 1.5, 8),
    new THREE.MeshLambertMaterial({ color: 0x2c3238 }),
  );
  hold.position.set(2.5, 6.2, 0);
  group.add(hold);
  const crates = new THREE.Mesh(
    new THREE.BoxGeometry(7, 3, 6),
    new THREE.MeshLambertMaterial({ color: 0x9a8f6a }),
  );
  crates.position.set(4, 8, 0);
  group.add(crates);

  // Wheelhouse aft, with a window band, and a stub crane.
  const house = new THREE.Mesh(
    new THREE.BoxGeometry(6, 6.5, 7),
    new THREE.MeshLambertMaterial({ color: 0x62707c }),
  );
  house.position.set(-9, 9, 0);
  group.add(house);
  const windows = new THREE.Mesh(
    new THREE.BoxGeometry(6.2, 1.6, 7.2),
    new THREE.MeshLambertMaterial({ color: 0x1d2b38 }),
  );
  windows.position.set(-9, 10.6, 0);
  group.add(windows);
  const crane = new THREE.Mesh(
    new THREE.CylinderGeometry(0.7, 0.7, 9, 5),
    new THREE.MeshLambertMaterial({ color: 0x3c444c }),
  );
  crane.position.set(-4.5, 10, 3.5);
  crane.rotation.z = 0.6;
  group.add(crane);
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

// An island battery: a squat base and a barrel, so it reads as a gun from the
// air without pretending to be a model. Missile batteries get the taller box.
// Drawn well over life size, and deliberately: a real emplacement is about
// twenty metres across, which is two pixels at the range its own missiles
// reach. A gun you cannot see is a gun you cannot plan around.
function buildTurret(teamColour, missile) {
  const group = new THREE.Group();
  const base = new THREE.Mesh(
    new THREE.CylinderGeometry(22, 30, 16, 6),
    new THREE.MeshLambertMaterial({ color: 0x4a4f55 }),
  );
  base.position.y = 8;
  group.add(base);
  const mount = new THREE.Mesh(
    missile ? new THREE.BoxGeometry(30, 26, 30) : new THREE.CylinderGeometry(13, 13, 16, 6),
    new THREE.MeshLambertMaterial({ color: teamColour }),
  );
  mount.position.y = 27;
  group.add(mount);
  if (missile) {
    // Four rails, so a missile battery reads as one at a glance.
    for (let i = 0; i < 4; i++) {
      const rail = new THREE.Mesh(
        new THREE.CylinderGeometry(2.6, 2.6, 34, 5),
        new THREE.MeshLambertMaterial({ color: 0xc9d4de }),
      );
      rail.geometry.rotateZ(-Math.PI / 2.6);
      rail.position.set(-4 + i * 3, 44, -12 + i * 8);
      group.add(rail);
    }
  } else {
    const barrel = new THREE.Mesh(
      new THREE.CylinderGeometry(4.2, 4.2, 48, 5),
      new THREE.MeshLambertMaterial({ color: 0x8fa4b8 }),
    );
    barrel.geometry.rotateZ(-Math.PI / 2);
    barrel.position.set(22, 30, 0);
    group.add(barrel);
  }
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
  buildTurret,
  buildCommandNode,
  updateCommandNode,
  NEUTRAL_NODE_COLOUR,
  SEA_FLOOR_METRES,
};
