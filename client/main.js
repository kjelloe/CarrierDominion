// client/main.js - wiring only.
//
// Picks a transport, resolves a graphics preset, turns input into commands, and
// draws whatever view arrives. All of those are somebody else's module; this
// file is the harness that connects them and nothing else.
//
//   ?mode=solo   run the engine in this tab (default)
//   ?mode=lan    connect to the authoritative server over ws
//   ?team=1      take the other seat in solo play
//   ?graphics=low|medium|high   override the auto-detected preset
//   ?speed=0|1|2|4|8|16         start compressed (0 starts paused)
//   ?lang=en|no                 override the browser's language
//   ?style=retro|modern|hybrid  art direction (see client/styles.js)

import { fetchRules } from './rules.js';
import { createLocalTransport, createWsTransport } from './transport.js';
import { getGraphicsDiagnostics, suggestGraphicsLevel, describeGpu } from './diagnostics.js';
import { presetFor, readOverride, resolveGraphics, writeOverride, presetNames } from './graphics.js';
import { createScene, renderView, resize, ownCarrierOf, pickSea } from './render/scene.js';
import { createBoard, pickSection, renderBoard, updateBoard } from './render/damageboard.js';
import { nextWeapon } from '../engine/weapons.js';
import { describeSpeed, isSpeed, stepSpeed } from '../shared/speeds.js';
import { createTranslator, fetchCatalog, pickLang, DEFAULT_LANG } from './i18n.js';
import { applyStyleToDocument, resolveStyle, styleFor } from './styles.js';
import { worldSizeMetres } from '../engine/worldgen.js';
import {
  createHud,
  setHud,
  tickFps,
  updateCarrierHud,
  describeHangar,
  describeIslands,
  describeStores,
  describeWeapons,
  roundsOf,
  describeDamage,
  describeScore,
  sectionPercent,
  SECTION_KEYS,
  PRIORITY_KEYS,
  describeSupply,
  describeUnit,
} from './hud.js';

const params = new URLSearchParams(window.location.search);
const MODE = params.get('mode') === 'lan' ? 'lan' : 'solo';
const SEAT = Number(params.get('team') ?? 0);
// `?speed=0` is a legitimate request to start paused, and Number(null) is 0 -
// so an ABSENT parameter has to be distinguished from a zero one, or every
// war without a query string starts frozen.
const START_SPEED = params.has('speed') && isSpeed(Number(params.get('speed')))
  ? Number(params.get('speed'))
  : 1;
const THROTTLE_STEP = 10;

const KIND_MANTA = 0;
const KIND_WALRUS = 1;
const UNIT_ACTIVE = 1;
const UNIT_RETURNING = 2;
const POD_RANGE_UNITS = 60 * 256; // matches data/rules.json podRangeMetres

const state = {
  view: undefined,
  stateHash: '',
  carrierId: -1,
  team: SEAT,
  throttle: 0,
  rudder: 0,
  selectedUnitId: -1,
  piloting: false,
  podBuildTicks: 1200,
  speed: START_SPEED,
  speedLocked: false,
  t: (key) => key,
  transport: undefined,
  scene3d: undefined,
  hud: undefined,
  board: undefined,
  damageRows: [],
  damageOpen: false,
  islandId: -1,
  islandStamp: '',
  buildCosts: [0, 0, 0],
  lastFrameMs: 0,
};

function afloatUnits() {
  if (state.view === undefined) return [];
  return state.view.units.filter(
    (unit) => unit.team === state.view.team
      && (unit.state === UNIT_ACTIVE || unit.state === UNIT_RETURNING),
  );
}

function selectedUnit() {
  return afloatUnits().find((unit) => unit.id === state.selectedUnitId);
}

function clampThrottle(value) {
  return Math.max(0, Math.min(100, value));
}

// W/S and A/D drive whatever the player is currently at the controls of: the
// piloted unit if there is one, otherwise the carrier's helm.
function sendThrottle(next) {
  const wanted = clampThrottle(next);
  if (state.piloting) {
    const unit = selectedUnit();
    if (unit === undefined) return;
    state.throttle = wanted;
    state.transport.send({
      type: 'set_unit_helm', unitId: unit.id, throttle: wanted, rudder: state.rudder,
    });
    return;
  }
  if (wanted === state.throttle || state.carrierId < 0) return;
  state.throttle = wanted;
  state.transport.send({ type: 'set_throttle', carrierId: state.carrierId, throttle: wanted });
}

function sendRudder(next) {
  if (state.piloting) {
    const unit = selectedUnit();
    if (unit === undefined || next === state.rudder) return;
    state.rudder = next;
    state.transport.send({
      type: 'set_unit_helm', unitId: unit.id, throttle: state.throttle, rudder: next,
    });
    return;
  }
  if (next === state.rudder || state.carrierId < 0) return;
  state.rudder = next;
  state.transport.send({ type: 'set_rudder', carrierId: state.carrierId, rudder: next });
}

function cycleSelection() {
  const units = afloatUnits();
  if (units.length === 0) {
    state.selectedUnitId = -1;
    return;
  }
  const index = units.findIndex((unit) => unit.id === state.selectedUnitId);
  state.selectedUnitId = units[(index + 1) % units.length].id;
}

function launch(kind) {
  if (state.carrierId < 0) return;
  state.transport.send({ type: 'launch_unit', carrierId: state.carrierId, kind: kind });
}

function recallSelected() {
  const unit = selectedUnit();
  if (unit === undefined) return;
  stopPiloting();
  state.transport.send({ type: 'recall_unit', unitId: unit.id });
}

// Ruling #18: a Manta shoots when its pilot says so. The engine picks the
// target - nearest enemy in range that this weapon can engage - but the trigger
// is yours, and it is a no-op if there is nothing there or the rail is cooling.
// The damage control board. It is only built when it is first opened: a player
// who never presses Z never pays for a second WebGL context.
function toggleDamageBoard() {
  const panel = document.getElementById('damage-panel');
  const open = !panel.classList.contains('open');
  panel.classList.toggle('open', open);
  state.damageOpen = open;
  if (!open || state.board !== undefined) return;
  const canvas = document.getElementById('damage-view');
  state.board = createBoard(canvas);
  document.getElementById('damage-title').textContent = state.t('damage.title');
  document.getElementById('damage-legend').textContent = state.t('damage.legend');
  canvas.addEventListener('pointerdown', (event) => {
    const bounds = canvas.getBoundingClientRect();
    const ndcX = ((event.clientX - bounds.left) / bounds.width) * 2 - 1;
    const ndcY = -(((event.clientY - bounds.top) / bounds.height) * 2 - 1);
    cyclePriority(pickSection(state.board, ndcX, ndcY));
  });
  buildDamageRows();
}

// The rows are built ONCE and then only have their text rewritten. Rebuilding
// them every frame - which is what this did first - replaces the element under
// the pointer sixty times a second, so a click lands on a node that has already
// been thrown away.
function buildDamageRows() {
  const list = document.getElementById('damage-list');
  list.textContent = '';
  state.damageRows = [];
  for (const key of SECTION_KEYS) {
    const row = document.createElement('div');
    row.className = 'damage-row';
    const name = document.createElement('span');
    name.className = 'damage-name';
    name.textContent = state.t(key);
    const value = document.createElement('span');
    value.textContent = '-';
    row.append(name, value);
    const index = state.damageRows.length;
    row.addEventListener('click', () => cyclePriority(index));
    list.append(row);
    state.damageRows.push(value);
  }
}

// Low, medium, high, and round again. The engine holds the authority; this only
// asks, and the next view answers.
function cyclePriority(sectionId) {
  if (sectionId === -1 || state.carrierId === -1) return;
  const carrier = ownCarrierOf(state.view);
  if (carrier === undefined) return;
  const section = carrier.sections.find((s) => s.id === sectionId);
  if (section === undefined) return;
  state.transport.send({
    type: 'set_repair_priority',
    carrierId: state.carrierId,
    section: sectionId,
    priority: (section.priority + 1) % 3,
  });
}

function renderDamageBoard(deltaSeconds) {
  if (!state.damageOpen || state.board === undefined) return;
  const carrier = ownCarrierOf(state.view);
  if (carrier === undefined) return;
  updateBoard(state.board, carrier.sections);
  const canvas = document.getElementById('damage-view');
  renderBoard(state.board, deltaSeconds, canvas.clientWidth, canvas.clientHeight);

  for (const section of carrier.sections) {
    const value = state.damageRows[section.id];
    if (value === undefined) continue;
    const percent = sectionPercent(section);
    value.textContent = `${percent}% ${state.t(PRIORITY_KEYS[section.priority] ?? '')}`;
  }
  document.getElementById('damage-stores').textContent = state.t('damage.stores', {
    materials: carrier.materials,
    capacity: carrier.materialsCapacity,
  });
}

// Cycle the selected unit's loadout: laser, cluster, napalm, missile for a
// Manta; cannon and mines for a Walrus.
// ---------------------------------------------------------------------------
// The island board: what a captured island is for, and what is going up on it.

const ROLE_KEYS = ['island.roleResource', 'island.roleFactory', 'island.roleDefence'];
const BUILD_KEYS = ['build.factory', 'build.warehouse', 'build.turret'];
// Which buildings each role allows, mirroring engine/island.js. The engine is
// the authority - this only decides what to offer.
const ROLE_BUILDS = [[1], [0, 1], [2]];

// What the cargo network could put toward a site: the island's own stock plus
// whatever is sitting at the depot, which is what engine/island.js will spend.
function depotMaterials() {
  if (state.view === undefined) return 0;
  const depotId = state.view.resources.stockpileIsland;
  if (depotId < 0) return 0;
  const depot = state.view.islands.find((i) => i.id === depotId);
  return depot === undefined || depot.stockMaterials < 0 ? 0 : depot.stockMaterials;
}

function islandAt(x, y) {
  if (state.view === undefined) return undefined;
  for (const island of state.view.islands) {
    if (island.owner !== state.view.team) continue;
    if (Math.hypot(island.x - x, island.y - y) <= island.radius * 1.6) return island;
  }
  return undefined;
}

function openIslandPanel(island) {
  state.islandId = island === undefined ? -1 : island.id;
  document.getElementById('island-panel').classList.toggle('open', island !== undefined);
}

function actionRow(label, enabled, onPick) {
  const row = document.createElement('div');
  row.className = enabled ? 'island-row island-act' : 'island-row island-act off';
  const text = document.createElement('span');
  text.textContent = label;
  row.append(text);
  if (enabled) row.addEventListener('click', onPick);
  return row;
}

function infoRow(label, value) {
  const row = document.createElement('div');
  row.className = 'island-row';
  const left = document.createElement('span');
  left.className = 'hud-label';
  left.textContent = label;
  const right = document.createElement('span');
  right.textContent = value;
  row.append(left, right);
  return row;
}

// Rebuilt whenever the island's numbers change, and not every frame: the rows
// are clickable, and an element replaced under the pointer cannot be clicked.
function renderIslandPanel() {
  if (state.islandId === -1 || state.view === undefined) return;
  const island = state.view.islands.find((i) => i.id === state.islandId);
  if (island === undefined || island.owner !== state.view.team) {
    openIslandPanel(undefined);
    return;
  }
  const stamp = [
    island.role, island.factories, island.warehouses, island.turrets,
    island.building, Math.floor(island.buildTicks / 20), island.stockMaterials,
  ].join('/');
  if (stamp === state.islandStamp) return;
  state.islandStamp = stamp;

  document.getElementById('island-title').textContent = state.t('island.title', { id: island.id });
  const body = document.getElementById('island-body');
  body.textContent = '';
  const roleName = island.role < 0
    ? state.t('island.roleNone')
    : state.t(ROLE_KEYS[island.role]);
  body.append(infoRow(state.t('island.role'), roleName));
  body.append(infoRow(
    state.t('island.works'),
    `${island.factories}f / ${island.warehouses}w / ${island.turrets}t`,
  ));
  body.append(infoRow(
    state.t('island.stock'),
    `m ${island.stockMaterials} / f ${island.stockFuel} / o ${island.stockOrdnance}`,
  ));

  if (island.building >= 0) {
    body.append(infoRow('', state.t('island.building', {
      what: state.t(BUILD_KEYS[island.building]),
      ticks: island.buildTicks,
    })));
  }

  const built = island.factories + island.warehouses + island.turrets;
  if (built === 0 && island.building < 0) {
    for (let role = 0; role < ROLE_KEYS.length; role++) {
      if (role === island.role) continue;
      body.append(actionRow(
        state.t('island.setRole', { role: state.t(ROLE_KEYS[role]) }),
        true,
        () => state.transport.send({
          type: 'set_island_role',
          carrierId: state.carrierId,
          islandId: island.id,
          role: role,
        }),
      ));
    }
  }
  if (island.role >= 0 && island.building < 0) {
    for (const what of ROLE_BUILDS[island.role]) {
      const cost = state.buildCosts[what] ?? 0;
      body.append(actionRow(
        state.t('island.build', { what: state.t(BUILD_KEYS[what]), cost: cost }),
        island.stockMaterials + depotMaterials() >= cost,
        () => state.transport.send({
          type: 'build_on_island',
          carrierId: state.carrierId,
          islandId: island.id,
          what: what,
        }),
      ));
    }
  }
  document.getElementById('island-note').textContent = built > 0
    ? `${state.t('island.locked')} - ${state.t('island.close')}`
    : state.t('island.close');
}

// Anything hostile within this of the clicked point counts as "you clicked
// that". Generous on purpose: a contact is a small thing on a big ocean.
const CLICK_PICK_UNITS = 500 * 256;

function enemyNear(x, y) {
  if (state.view === undefined) return undefined;
  let best;
  let bestDistance = CLICK_PICK_UNITS;
  for (const carrier of state.view.carriers) {
    if (carrier.team === state.view.team) continue;
    const distance = Math.hypot(carrier.x - x, carrier.y - y);
    if (distance > bestDistance) continue;
    bestDistance = distance;
    best = { kind: 1, id: carrier.id };
  }
  for (const unit of state.view.units) {
    if (unit.team === state.view.team) continue;
    const distance = Math.hypot(unit.x - x, unit.y - y);
    if (distance > bestDistance) continue;
    bestDistance = distance;
    best = { kind: 0, id: unit.id };
  }
  return best;
}

function cycleWeapon() {
  const unit = selectedUnit();
  if (unit === undefined || unit.arms === undefined || unit.arms.length < 2) return;
  const next = nextWeapon(unit);
  if (next === -1) return;
  state.transport.send({ type: 'select_weapon', unitId: unit.id, weapon: next });
}

function fireSelected() {
  const unit = selectedUnit();
  if (unit === undefined) return;
  if (unit.overheated === 1) {
    setHud(state.hud, 'status', state.t('status.overheated'));
    return;
  }
  if (roundsOf(unit) <= 0) {
    setHud(state.hud, 'status', state.t('status.noAmmo'));
    return;
  }
  state.transport.send({ type: 'fire_unit', unitId: unit.id });
}

function stopPiloting() {
  if (!state.piloting) return;
  const unit = selectedUnit();
  state.piloting = false;
  state.scene3d.followUnitId = -1;
  if (unit !== undefined) state.transport.send({ type: 'release_control', unitId: unit.id });
  const carrier = ownCarrierOf(state.view);
  state.throttle = carrier === undefined ? 0 : carrier.throttle;
  state.rudder = 0;
}

function togglePiloting() {
  if (state.piloting) {
    stopPiloting();
    return;
  }
  const unit = selectedUnit();
  if (unit === undefined) return;
  state.piloting = true;
  state.throttle = 100;
  state.rudder = 0;
  state.scene3d.followUnitId = unit.id;
  state.transport.send({ type: 'take_control', unitId: unit.id });
}

// The nearest command node to the selected Walrus. The engine checks range
// again; this only picks which island the player probably meant.
function nearestNode(unit) {
  let best;
  let bestDistance = Infinity;
  for (const island of state.view.islands) {
    const dx = island.nodeX - unit.x;
    const dy = island.nodeY - unit.y;
    const distance = Math.hypot(dx, dy);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = island;
    }
  }
  return { island: best, distance: bestDistance };
}

function deployPod() {
  const unit = selectedUnit();
  if (unit === undefined || unit.kind !== KIND_WALRUS) {
    setHud(state.hud, 'status', state.t('status.needWalrus'));
    return;
  }
  if (unit.pod !== 1) {
    setHud(state.hud, 'status', state.t('status.noPod'));
    return;
  }
  const near = nearestNode(unit);
  if (near.island === undefined) return;
  if (near.distance > POD_RANGE_UNITS) {
    setHud(state.hud, 'status', state.t('status.tooFar', {
      metres: Math.round(near.distance / 256),
    }));
    return;
  }
  state.transport.send({ type: 'deploy_pod', unitId: unit.id, islandId: near.island.id });
}

// Compression is a request, not a setting: solo obliges immediately, a shared
// LAN war refuses until the voting slice exists, and either way the HUD only
// changes when the transport confirms.
function requestSpeed(multiplier) {
  if (!isSpeed(multiplier)) return;
  if (state.speedLocked) {
    setHud(state.hud, 'status', state.t('status.speedLocked'));
    return;
  }
  state.transport.setSpeed(multiplier);
}

function nudgeSpeed(direction) {
  requestSpeed(stepSpeed(state.speed, direction));
}

function togglePause() {
  requestSpeed(state.speed === 0 ? 1 : 0);
}

function toggleSupplyRun() {
  if (state.carrierId < 0 || state.view === undefined) return;
  const carrier = ownCarrierOf(state.view);
  if (carrier === undefined) return;
  state.transport.send({
    type: 'set_supply_run',
    carrierId: state.carrierId,
    active: carrier.supplyRun === 1 ? 0 : 1,
  });
}

// Nominate the nearest island you hold as the depot everything is shipped to.
function nominateDepot() {
  if (state.carrierId < 0 || state.view === undefined) return;
  const carrier = ownCarrierOf(state.view);
  if (carrier === undefined) return;
  let best;
  let bestDistance = Infinity;
  for (const island of state.view.islands) {
    if (island.owner !== state.view.team) continue;
    const distance = Math.hypot(island.x - carrier.x, island.y - carrier.y);
    if (distance >= bestDistance) continue;
    bestDistance = distance;
    best = island;
  }
  if (best === undefined) {
    setHud(state.hud, 'status', state.t('status.noOwnedIsland'));
    return;
  }
  state.transport.send({ type: 'set_stockpile', carrierId: state.carrierId, islandId: best.id });
  setHud(state.hud, 'status', state.t('status.stockpileSet', { island: best.id }));
}

function cycleGraphics(currentLevel) {
  const names = presetNames();
  const next = names[(names.indexOf(currentLevel) + 1) % names.length];
  writeOverride(window.localStorage, next);
  // A preset changes renderer construction (antialias, shadow maps), so it is
  // applied by reloading rather than by rebuilding half the scene in place.
  window.location.reload();
}

function bindInput(level) {
  const held = { a: false, d: false };
  window.addEventListener('keydown', (event) => {
    if (event.repeat) return;
    const key = event.key.toLowerCase();
    if (key === 'w') sendThrottle(state.throttle + THROTTLE_STEP);
    else if (key === 's') sendThrottle(state.throttle - THROTTLE_STEP);
    else if (key === 'x') sendThrottle(0);
    else if (key === 'a') { held.a = true; sendRudder(1); }
    else if (key === 'd') { held.d = true; sendRudder(-1); }
    else if (key === '1') launch(KIND_MANTA);
    else if (key === '2') launch(KIND_WALRUS);
    else if (key === 'n') cycleSelection();
    else if (key === 'r') recallSelected();
    else if (key === 't') togglePiloting();
    else if (key === 'p') deployPod();
    else if (key === 'f') fireSelected();
    else if (key === 'z') toggleDamageBoard();
    else if (key === 'v') cycleWeapon();
    else if (key === 'l') toggleSupplyRun();
    else if (key === 'k') nominateDepot();
    else if (key === ',') nudgeSpeed(-1);
    else if (key === '.') nudgeSpeed(1);
    else if (key === ' ') togglePause();
    else if (key === 'c' || key === 'tab') {
      event.preventDefault();
      state.scene3d.strategic = !state.scene3d.strategic;
    } else if (key === 'g') cycleGraphics(level);
    else return;
    event.preventDefault();
  });
  window.addEventListener('keyup', (event) => {
    const key = event.key.toLowerCase();
    if (key === 'a') held.a = false;
    if (key === 'd') held.d = false;
    if (key === 'a' || key === 'd') sendRudder(held.a ? 1 : (held.d ? -1 : 0));
  });
  window.addEventListener('blur', () => sendRudder(0));

  // Click an enemy to attack it, the empty sea to move there. The click is
  // resolved to a point on the water first; whether anything hostile is
  // standing near that point decides which of the two it was.
  window.addEventListener('pointerdown', (event) => {
    if (state.piloting || state.damageOpen) return;
    const ndcX = (event.clientX / window.innerWidth) * 2 - 1;
    const ndcY = -(event.clientY / window.innerHeight) * 2 + 1;
    const target = pickSea(state.scene3d, ndcX, ndcY);
    if (target === -1) return;

    const enemy = enemyNear(target.x, target.y);
    const unit = selectedUnit();
    if (enemy === undefined) {
      // An island you hold opens its board; anything else closes it.
      const island = islandAt(target.x, target.y);
      if (island !== undefined) {
        openIslandPanel(island);
        return;
      }
      openIslandPanel(undefined);
    }
    if (enemy !== undefined) {
      // With a unit selected the click is an attack order; with none, it is the
      // ship's laser going to pointer mode on that contact.
      if (unit !== undefined) {
        state.transport.send({
          type: 'order_unit_attack',
          unitId: unit.id,
          targetKind: enemy.kind,
          targetId: enemy.id,
        });
        setHud(state.hud, 'status', state.t('status.attacking', { id: enemy.id }));
      } else if (state.carrierId !== -1) {
        state.transport.send({
          type: 'set_carrier_aim',
          carrierId: state.carrierId,
          targetKind: enemy.kind,
          targetId: enemy.id,
        });
        setHud(state.hud, 'status', state.t('status.pointing', { id: enemy.id }));
      }
      return;
    }

    if (unit === undefined) return;
    const size = state.view.params.sizeUnits;
    if (target.x < 0 || target.y < 0 || target.x > size || target.y > size) return;
    state.transport.send({
      type: 'order_unit_move', unitId: unit.id, x: target.x, y: target.y,
    });
  });
}

function onSpeed(multiplier) {
  state.speed = multiplier;
  setHud(state.hud, 'speedx', describeSpeed(multiplier));
}

function onWelcome(message) {
  state.team = message.spectator ? 0 : message.team;
  state.speed = message.speed ?? 1;
  state.speedLocked = (message.speedLocked ?? 0) === 1;
  setHud(state.hud, 'speedx', describeSpeed(state.speed)
    + (state.speedLocked ? ` (${state.t('hud.locked')})` : ''));
  setHud(state.hud, 'seat', message.spectator
    ? state.t('seat.spectator')
    : state.t('seat.team', { team: message.team }));
  setHud(state.hud, 'seed', message.seed);
  setHud(state.hud, 'status', state.t('status.connected'));
}

function onSnapshot(message) {
  state.view = message.view;
  // The last view, for probes. It is the same object the renderer is about to
  // draw, so a probe that asserts on it is asserting on what is on screen.
  window.__lastView = message.view;
  state.stateHash = message.stateHash ?? '';
  const own = ownCarrierOf(message.view);
  if (own !== undefined) {
    state.carrierId = own.id;
    // The server is the authority on the helm; adopt what it reports so a
    // rejected or lost command cannot leave the HUD lying.
    if (!state.piloting) {
      state.throttle = own.throttle;
      state.rudder = own.rudder;
    }
  }
  // A selection that has been recovered, lost, or shot down stops being one.
  if (state.selectedUnitId !== -1 && selectedUnit() === undefined) {
    state.selectedUnitId = -1;
    state.piloting = false;
    state.scene3d.followUnitId = -1;
  }
  if (state.selectedUnitId === -1 && afloatUnits().length > 0) cycleSelection();
}

function onRejected(reason) {
  setHud(state.hud, 'status', state.t('status.rejected', { reason: reason }));
}

const CLOSE_KEYS = {
  disconnected: 'status.disconnected',
  'connection error': 'status.error',
  closed: 'status.closed',
};

function onClosed(reason) {
  setHud(state.hud, 'status', state.t(CLOSE_KEYS[reason] ?? 'status.disconnected'));
}

function frame(nowMs) {
  window.requestAnimationFrame(frame);
  if (state.view === undefined) return;
  const deltaSeconds = state.lastFrameMs === 0 ? 0 : (nowMs - state.lastFrameMs) / 1000;
  state.lastFrameMs = nowMs;
  tickFps(state.hud, nowMs);
  renderView(state.scene3d, state.view, deltaSeconds, state.podBuildTicks);
  setHud(state.hud, 'tick', state.view.tick);
  setHud(state.hud, 'hash', state.stateHash === '' ? '-' : state.stateHash);
  updateCarrierHud(state.hud, ownCarrierOf(state.view), state.view.params);
  setHud(state.hud, 'hangar', describeHangar(state.t, state.view.units, state.view.team));
  setHud(state.hud, 'unit', describeUnit(state.t, selectedUnit(), state.view.params));
  setHud(state.hud, 'islands', describeIslands(state.t, state.view));
  setHud(state.hud, 'score', describeScore(state.t, state.view));
  setHud(state.hud, 'damage', describeDamage(state.t, state.view));
  setHud(state.hud, 'weapons', describeWeapons(state.t, state.view, selectedUnit()));
  setHud(state.hud, 'stores', describeStores(state.t, state.view));
  setHud(state.hud, 'supply', describeSupply(state.t, state.view));
  renderDamageBoard(deltaSeconds);
  renderIslandPanel();
  updateSight();
}

// The gunsight: shown while flying, and marked when a seeker has something on
// the nose. Locked is a colour rather than a word - you are busy flying.
function updateSight() {
  const sight = document.getElementById('sight');
  const unit = state.piloting ? selectedUnit() : undefined;
  sight.classList.toggle('on', unit !== undefined);
  if (unit === undefined) return;
  sight.classList.toggle('lock', hasLock(unit));
}

// A cheap client-side echo of the engine's seeker rule: something hostile
// within the cone, ahead. The engine decides for real when the trigger goes.
const SIGHT_CONE = 4096;

function hasLock(unit) {
  if (state.view === undefined) return false;
  const contacts = [];
  for (const carrier of state.view.carriers) {
    if (carrier.team !== state.view.team) contacts.push(carrier);
  }
  for (const other of state.view.units) {
    if (other.team !== state.view.team) contacts.push(other);
  }
  for (const contact of contacts) {
    const bearing = Math.atan2(contact.y - unit.y, contact.x - unit.x);
    const bam = Math.round((bearing / (Math.PI * 2)) * 65536) & 65535;
    let off = (bam - unit.heading) & 65535;
    if (off > 32768) off -= 65536;
    if (Math.abs(off) <= SIGHT_CONE) return true;
  }
  return false;
}

function renderHelp(t) {
  const help = document.getElementById('help');
  help.textContent = '';
  const lines = ['help.helm', 'help.units', 'help.orders', 'help.supply', 'help.weapons', 'help.targeting', 'help.island',
    'help.damage', 'help.time'];
  for (const key of lines) {
    const line = document.createElement('div');
    line.textContent = t(key);
    help.append(line);
  }
  const gpu = document.createElement('div');
  gpu.id = 'gpu';
  gpu.textContent = t('gpu.detecting');
  help.append(gpu);
}

async function main() {
  const lang = pickLang(params.get('lang'), window.navigator.language);
  const catalog = await fetchCatalog(lang);
  const fallback = lang === DEFAULT_LANG ? undefined : await fetchCatalog(DEFAULT_LANG);
  state.t = createTranslator(catalog, fallback);
  document.documentElement.lang = lang;

  const hudRoot = document.getElementById('hud');
  state.hud = createHud(hudRoot, state.t);
  renderHelp(state.t);
  setHud(state.hud, 'status', state.t('status.loading'));

  const rules = await fetchRules();
  state.podBuildTicks = rules.rules.podBuildTicks;
  state.buildCosts = rules.economy.builds.map((row) => row.materials);
  const diag = getGraphicsDiagnostics();
  const override = params.get('graphics') ?? readOverride(window.localStorage);
  const resolved = resolveGraphics(suggestGraphicsLevel(diag), override);
  const preset = presetFor(resolved.level);
  setHud(state.hud, 'graphics', `${preset.label} (${resolved.source})`);
  document.getElementById('gpu').textContent = describeGpu(diag);

  const style = styleFor(resolveStyle(params.get('style')));
  applyStyleToDocument(style, document.documentElement);
  setHud(state.hud, 'graphics', `${preset.label} / ${style.label} (${resolved.source})`);

  // The map grows with the island count, so the ocean plane, the sun's aim and
  // the sea grid have to use the SCALED size - the base size leaves the far
  // corners of a big archipelago outside the water.
  const sizeMetres = worldSizeMetres(rules.world);
  state.scene3d = createScene(document.getElementById('view'), preset, sizeMetres, style);
  // Probes open the island board without having to hit an island with a
  // screen-space click; the board itself is the same one a click opens.
  window.__openIsland = (islandId) => {
    const island = state.view === undefined
      ? undefined
      : state.view.islands.find((i) => i.id === islandId);
    openIslandPanel(island);
  };
  // Render probes reach the scene graph through this; nothing in the game uses
  // it, and it holds no state the client does not already own.
  window.__scene3d = state.scene3d;
  resize(state.scene3d);
  window.addEventListener('resize', () => resize(state.scene3d));

  if (MODE === 'lan') {
    const scheme = window.location.protocol === 'https:' ? 'wss' : 'ws';
    state.transport = createWsTransport(`${scheme}://${window.location.host}`);
  } else {
    const seed = Number(params.get('seed') ?? 20260818);
    state.transport = createLocalTransport(seed, rules, SEAT, START_SPEED);
  }
  setHud(state.hud, 'transport', state.t(MODE === 'lan' ? 'transport.ws' : 'transport.local'));
  bindInput(resolved.level);
  state.transport.connect({
    onWelcome: onWelcome,
    onSnapshot: onSnapshot,
    onSpeed: onSpeed,
    onRejected: onRejected,
    onClosed: onClosed,
  });
  window.requestAnimationFrame(frame);
}

main().catch((error) => {
  const hudRoot = document.getElementById('hud');
  if (hudRoot) hudRoot.textContent = state.t('status.startFailed', { reason: error.message });
  throw error;
});
