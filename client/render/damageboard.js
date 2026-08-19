// client/render/damageboard.js - the damage control board.
//
// A slowly turning wireframe of the ship, one box per section, coloured by how
// badly that section is hurt. It is a Mesh with `wireframe: true` rather than a
// LineSegments on purpose: it draws as wire and still raycasts as a solid, so a
// section can simply be clicked.
//
// The boxes are the same geometry the engine reasons about - bow forward,
// engine room aft of midships, steering gear in the tail, plating down each
// side, island and mast above the deck - so what you click is what a round
// would have hit coming in on that bearing.

import * as THREE from 'three';

// Ship-local metres. +x is the bow, +z is starboard, +y is up.
const SECTION_BOXES = [
  { id: 0, min: [55, 0, -18], max: [165, 26, 18] }, // bow
  { id: 1, min: [-55, 0, -18], max: [55, 26, 18] }, // midship
  { id: 2, min: [-165, 0, -18], max: [-132, 26, 18] }, // stern
  { id: 3, min: [-165, 0, -36], max: [165, 26, -18] }, // port
  { id: 4, min: [-165, 0, 18], max: [165, 26, 36] }, // starboard
  { id: 5, min: [-60, 26, -14], max: [60, 64, 14] }, // topside
  { id: 6, min: [-132, 0, -18], max: [-55, 26, 18] }, // engine
];

const COLOUR_SOUND = 0x2f6f4f;
const COLOUR_HURT = 0xc08a2a;
const COLOUR_BAD = 0xb8452e;
const COLOUR_OUT = 0x6a2018;

function colourFor(percent) {
  if (percent >= 100) return COLOUR_SOUND;
  if (percent <= 0) return COLOUR_OUT;
  if (percent < 35) return COLOUR_BAD;
  return COLOUR_HURT;
}

function buildSectionMesh(box) {
  const size = [
    box.max[0] - box.min[0],
    box.max[1] - box.min[1],
    box.max[2] - box.min[2],
  ];
  const geometry = new THREE.BoxGeometry(size[0], size[1], size[2]);
  const material = new THREE.MeshBasicMaterial({ color: COLOUR_SOUND, wireframe: true });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(
    (box.min[0] + box.max[0]) / 2,
    (box.min[1] + box.max[1]) / 2,
    (box.min[2] + box.max[2]) / 2,
  );
  mesh.userData.sectionId = box.id;
  return mesh;
}

function createBoard(canvas) {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(38, 1, 1, 3000);
  camera.position.set(285, 200, 262);
  camera.lookAt(0, 10, 0);

  const renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

  // The hull turns; the sections are children of it so they turn with it.
  const hull = new THREE.Group();
  const meshes = {};
  for (const box of SECTION_BOXES) {
    const mesh = buildSectionMesh(box);
    meshes[box.id] = mesh;
    hull.add(mesh);
  }
  scene.add(hull);

  return {
    scene: scene,
    camera: camera,
    renderer: renderer,
    hull: hull,
    meshes: meshes,
    raycaster: new THREE.Raycaster(),
    spin: 0,
  };
}

function updateBoard(board, sections) {
  for (const section of sections) {
    const mesh = board.meshes[section.id];
    if (mesh === undefined) continue;
    const percent = section.maxHp > 0 ? Math.round((section.hp * 100) / section.maxHp) : 100;
    mesh.material.color.setHex(colourFor(percent));
    // A section the player has marked HIGH is drawn solid-bright; LOW is dimmed
    // back, so the priorities are visible on the model and not only in the list.
    mesh.material.opacity = section.priority === 0 ? 0.35 : 1;
    mesh.material.transparent = section.priority === 0;
  }
}

function renderBoard(board, deltaSeconds, width, height) {
  board.spin += deltaSeconds * 0.35;
  board.hull.rotation.y = board.spin;
  if (board.width !== width || board.height !== height) {
    board.width = width;
    board.height = height;
    board.camera.aspect = width / Math.max(1, height);
    board.camera.updateProjectionMatrix();
    board.renderer.setSize(width, height, false);
  }
  board.renderer.render(board.scene, board.camera);
}

// Which section was clicked, or -1. Coordinates are normalised device space.
function pickSection(board, ndcX, ndcY) {
  board.raycaster.setFromCamera({ x: ndcX, y: ndcY }, board.camera);
  const hits = board.raycaster.intersectObjects(board.hull.children, false);
  if (hits.length === 0) return -1;
  return hits[0].object.userData.sectionId;
}

export { createBoard, updateBoard, renderBoard, pickSection, SECTION_BOXES };
