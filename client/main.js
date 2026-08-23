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
import { createLocalTransport, createReplayTransport, createWsTransport } from './transport.js';
import { getGraphicsDiagnostics, suggestGraphicsLevel, describeGpu } from './diagnostics.js';
import { presetFor, readOverride, resolveGraphics, writeOverride, presetNames } from './graphics.js';
import { createScene, resetWorld, renderView, resize, ownCarrierOf, pickSea } from './render/scene.js';
import { createInstruments, drawInstruments, helmHitAt } from './render/instruments.js';
import { createSound, playEvents, playWarning, toggleMute, wakeSound } from './sound.js';
import { createDamagePanel, renderDamagePanel, toggleDamagePanel } from './panels/damage.js';
import {
  createIslandPanel,
  islandAt,
  openIslandPanel,
  renderIslandPanel,
} from './panels/island.js';
import {
  applyChoices,
  createStartPanel,
  seedFromClock,
  showStartPanel,
} from './panels/start.js';
import { createLobbyPanel, renderLobbyPanel } from './panels/lobby.js';
import { createStoresPanel, renderStoresPanel, toggleStoresPanel as flipStoresPanel } from './panels/stores.js';
import { createWaroverPanel, updateWaroverPanel } from './panels/warover.js';
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
  weaponName,
  knotsFrom,
  describeDamage,
  describeScore,
  describeSupply,
  describeUnit,
} from './hud.js';

const params = new URLSearchParams(window.location.search);
const MODE = params.get('mode') === 'lan'
  ? 'lan'
  : (params.get('mode') === 'replay' ? 'replay' : 'solo');
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
  climb: 0,
  selectedUnitId: -1,
  piloting: false,
  podBuildTicks: 1200,
  speed: START_SPEED,
  speedLocked: false,
  voteText: '',
  t: (key) => key,
  transport: undefined,
  scene3d: undefined,
  hud: undefined,
  damage: undefined,
  island: undefined,
  panel: undefined,
  instrumentColours: undefined,
  lobbyPanel: undefined,
  room: undefined,
  scopeRange: 8000,
  sound: createSound(),
  buildCosts: [0, 0, 0],
  lastFrameMs: 0,
  // Set when the room starts (or restarts) a war: the first snapshot of the
  // new war rebuilds the world at ITS size, dropping the old war's meshes.
  pendingWorldReset: false,
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
      climb: state.climb,
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
      climb: state.climb,
    });
    return;
  }
  if (next === state.rudder || state.carrierId < 0) return;
  state.rudder = next;
  state.transport.send({ type: 'set_rudder', carrierId: state.carrierId, rudder: next });
}

// The stick's vertical axis: only a piloted aircraft has one. Held keys, like
// the rudder - release and the nose levels.
function sendClimb(next) {
  if (!state.piloting) return;
  const unit = selectedUnit();
  if (unit === undefined || next === state.climb) return;
  state.climb = next;
  state.transport.send({
    type: 'set_unit_helm', unitId: unit.id, throttle: state.throttle, rudder: state.rudder,
    climb: next,
  });
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

// Escort: the selected unit takes station on the ship and fights what comes.
function orderEscort() {
  const unit = selectedUnit();
  if (unit === undefined) return;
  stopPiloting();
  state.transport.send({ type: 'order_unit_escort', unitId: unit.id });
  setHud(state.hud, 'status', state.t('status.escorting', { id: unit.id }));
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

// A burst of flares. The engine refuses it while the launchers are reloading
// or the store is short, so this only has to know how to ask.
function fireFlares() {
  if (state.carrierId === -1) return;
  const own = state.view === undefined ? undefined : ownCarrierOf(state.view);
  if (own !== undefined && own.flareCooldown > 0) {
    setHud(state.hud, 'status', state.t('status.flaresReloading'));
    return;
  }
  state.transport.send({ type: 'fire_flares', carrierId: state.carrierId });
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
  state.climb = 0;
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
  state.climb = 0;
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

// The virus bomb: for an island somebody else is holding and has developed.
// The pod is for ground you have cleared; this is for a working island.
function deployVirus() {
  const unit = selectedUnit();
  if (unit === undefined || unit.kind !== KIND_WALRUS) {
    setHud(state.hud, 'status', state.t('status.needWalrus'));
    return;
  }
  if (unit.virus !== 1) {
    setHud(state.hud, 'status', state.t('status.noVirus'));
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
  if (near.island.owner < 0 || near.island.owner === state.view.team) {
    setHud(state.hud, 'status', state.t('status.noCentre'));
    return;
  }
  state.transport.send({
    type: 'deploy_virus', unitId: unit.id, islandId: near.island.id,
  });
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
    // Not refused - proposed. The engine's answer arrives as a vote message.
    setHud(state.hud, 'status', state.t('status.speedVote'));
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

// Three ways to look at a war: over the shoulder, down the gunsight, and the
// map. C walks them in that order.
function cycleCamera() {
  const scene = state.scene3d;
  if (!scene.gunsight && !scene.strategic) scene.gunsight = true;
  else if (scene.gunsight) { scene.gunsight = false; scene.strategic = true; }
  else scene.strategic = false;
}

// The instrument panel is clickable (1988: "click directly on speed scale to
// set target speed"). The HELM box drives the SHIP even while a unit is being
// flown - it is the ship's helm, and it says so on the bezel. Rudder arrows
// act while held and CENTRE UP on release, exactly like the keys they mirror.
function bindPanelInput() {
  const canvas = document.getElementById('panel');
  canvas.style.pointerEvents = 'auto';
  let heldRudder = 0;
  const shipRudder = (next) => {
    if (state.carrierId < 0) return;
    state.transport.send({ type: 'set_rudder', carrierId: state.carrierId, rudder: next });
  };
  canvas.addEventListener('pointerdown', (event) => {
    const rect = canvas.getBoundingClientRect();
    const hit = helmHitAt(event.clientX - rect.left, event.clientY - rect.top);
    if (hit === -1) return;
    if (hit.kind === 'throttle') {
      if (state.carrierId < 0) return;
      state.transport.send({
        type: 'set_throttle', carrierId: state.carrierId, throttle: hit.throttle,
      });
      if (!state.piloting) state.throttle = hit.throttle;
      return;
    }
    heldRudder = hit.rudder;
    shipRudder(heldRudder);
  });
  const release = () => {
    if (heldRudder === 0) return;
    heldRudder = 0;
    shipRudder(0);
  };
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointerleave', release);
}

// The legend and its button agree about whether it is open.
function toggleHelp() {
  const hidden = document.getElementById('help').classList.toggle('hidden');
  document.getElementById('help-button').classList.toggle('open', !hidden);
}

// The diagnostic strip, likewise (playtest ruling 2026-08-22): hidden until
// the DBG button asks for it. Status feedback survives as a toast (hud.js).
function toggleDebug() {
  const hidden = document.getElementById('hud').classList.toggle('hidden');
  document.getElementById('debug-button').classList.toggle('open', !hidden);
}

// Hover tooltips (playtest ruling 2026-08-23): the label NAMES the button,
// the tooltip EXPLAINS it, after a deliberate pause - an accidental sweep of
// the pointer across a column should not raise a wall of prose.
const TIP_DELAY_MS = 600;

function attachTip(element, text) {
  let timer;
  const tip = () => document.getElementById('tip');
  element.addEventListener('pointerenter', () => {
    timer = setTimeout(() => {
      const node = tip();
      node.textContent = text;
      node.classList.add('on');
      const rect = element.getBoundingClientRect();
      // Beside the button, flipped to whichever side has room.
      const spaceRight = window.innerWidth - rect.right;
      node.style.top = `${Math.round(rect.top)}px`;
      if (spaceRight > 260) {
        node.style.left = `${Math.round(rect.right + 8)}px`;
        node.style.right = 'auto';
      } else {
        node.style.right = `${Math.round(window.innerWidth - rect.left + 8)}px`;
        node.style.left = 'auto';
      }
    }, TIP_DELAY_MS);
  });
  const hide = () => {
    clearTimeout(timer);
    tip().classList.remove('on');
  };
  element.addEventListener('pointerleave', hide);
  element.addEventListener('pointerdown', hide);
}

// The 1988 icon columns: ship and logistics on the left, air and ground ops
// on the right, one button per key in the legend. A button DISPATCHES its
// key, so the two input paths cannot drift - whatever H does, the button
// labelled H does, forever.
const ACTIONS_LEFT = [
  ['x', 'act.stop', 'tip.stop'], ['e', 'act.flares', 'tip.flares'],
  ['l', 'act.supply', 'tip.supply'], ['k', 'act.depot', 'tip.depot'],
  ['q', 'act.stores', 'tip.stores'],
  ['z', 'act.damage', 'tip.damage'], ['c', 'act.camera', 'tip.camera'],
  ['m', 'act.sound', 'tip.sound'],
];
const ACTIONS_RIGHT = [
  ['1', 'act.manta', 'tip.manta'], ['2', 'act.walrus', 'tip.walrus'],
  ['n', 'act.next', 'tip.next'], ['t', 'act.controls', 'tip.controls'],
  ['u', 'act.escort', 'tip.escort'],
  ['r', 'act.recall', 'tip.recall'], ['f', 'act.fire', 'tip.fire'],
  ['p', 'act.pod', 'tip.pod'], ['b', 'act.virus', 'tip.virus'],
];

function buildActionColumns(t) {
  const columns = [
    ['actions-left', ACTIONS_LEFT],
    ['actions-right', ACTIONS_RIGHT],
  ];
  for (const [id, actions] of columns) {
    const root = document.getElementById(id);
    for (const [key, label, tipKey] of actions) {
      const button = document.createElement('div');
      button.className = 'act';
      const keycap = document.createElement('span');
      keycap.className = 'k';
      keycap.textContent = key.toUpperCase();
      const text = document.createElement('span');
      text.className = 'l';
      text.textContent = t(label);
      button.append(keycap, text);
      button.addEventListener('pointerdown', (event) => {
        event.preventDefault();
        window.dispatchEvent(new KeyboardEvent('keydown', { key: key }));
      });
      attachTip(button, t(tipKey));
      root.append(button);
      // The weapon SELECTOR rides in the right column between FIRE and POD:
      // one button per weapon the selected hull carries, radio-style
      // (playtest ruling 2026-08-23 - a cycle key hides what a row of
      // buttons shows). V still cycles for the keyboard hand.
      if (key === 'f' && id === 'actions-right') {
        const group = document.createElement('div');
        group.id = 'weapon-group';
        root.append(group);
      }
    }
  }
  attachTip(document.getElementById('help-button'), t('tip.help'));
  attachTip(document.getElementById('debug-button'), t('tip.debug'));
}

// Rebuilt only when the holder or its loadout changes; the selection state
// and the round counts update in place every frame (the built-once rule).
const weaponGroup = { signature: '', buttons: [] };

function updateWeaponGroup() {
  const root = document.getElementById('weapon-group');
  if (root === null || state.view === undefined) return;
  const holder = selectedUnit() ?? ownCarrierOf(state.view);
  const arms = holder === undefined ? [] : holder.arms;
  const isUnit = holder !== undefined && holder.kind !== undefined;
  const signature = holder === undefined
    ? ''
    : `${isUnit ? holder.id : 'ship'}:${arms.map((a) => a.w).join(',')}`;

  if (signature !== weaponGroup.signature) {
    weaponGroup.signature = signature;
    weaponGroup.buttons = [];
    root.textContent = '';
    for (const arm of arms) {
      const button = document.createElement('div');
      button.className = 'wep';
      const name = document.createElement('span');
      name.textContent = weaponName(state.t, { weapon: arm.w }).toUpperCase();
      const count = document.createElement('span');
      count.className = 'n';
      button.append(name, count);
      button.addEventListener('pointerdown', (event) => {
        event.preventDefault();
        const chosen = selectedUnit();
        if (chosen === undefined) return; // the carrier has one weapon
        state.transport.send({ type: 'select_weapon', unitId: chosen.id, weapon: arm.w });
      });
      root.append(button);
      weaponGroup.buttons.push({ w: arm.w, root: button, count: count });
    }
  }
  for (const entry of weaponGroup.buttons) {
    const arm = arms.find((a) => a.w === entry.w);
    entry.root.classList.toggle('on', holder !== undefined && holder.weapon === entry.w);
    entry.count.textContent = arm === undefined ? '' : String(arm.n);
  }
}

function bindInput(level) {
  const held = { a: false, d: false, up: false, down: false };
  // A browser will not make a sound before the user has done something, so the
  // audio context is built on the first gesture and not at load.
  const wake = () => wakeSound(state.sound);
  window.addEventListener('keydown', wake, { once: true });
  window.addEventListener('pointerdown', wake, { once: true });
  window.addEventListener('keydown', (event) => {
    if (event.repeat) return;
    const key = event.key.toLowerCase();
    if (key === 'w') sendThrottle(state.throttle + THROTTLE_STEP);
    else if (key === 's') sendThrottle(state.throttle - THROTTLE_STEP);
    else if (key === 'x') sendThrottle(0);
    else if (key === 'a' || key === 'arrowleft') { held.a = true; sendRudder(1); }
    else if (key === 'd' || key === 'arrowright') { held.d = true; sendRudder(-1); }
    else if (key === 'arrowup') { held.up = true; sendClimb(1); }
    else if (key === 'arrowdown') { held.down = true; sendClimb(-1); }
    else if (key === '1') launch(KIND_MANTA);
    else if (key === '2') launch(KIND_WALRUS);
    else if (key === 'n') cycleSelection();
    else if (key === 'r') recallSelected();
    else if (key === 'u') orderEscort();
    else if (key === 'q') flipStoresPanel(state.stores);
    else if (key === 't') togglePiloting();
    else if (key === 'p') deployPod();
    else if (key === 'b') deployVirus();
    else if (key === 'f') fireSelected();
    else if (key === 'e') fireFlares();
    else if (key === 'z') toggleDamagePanel(state.damage);
    else if (key === 'v') cycleWeapon();
    else if (key === 'h') toggleHelp();
    else if (key === '[') zoomScope(1);
    else if (key === ']') zoomScope(-1);
    else if (key === 'm') {
      const muted = toggleMute(state.sound);
      setHud(state.hud, 'status', state.t(muted ? 'status.muted' : 'status.unmuted'));
    }
    else if (key === 'l') toggleSupplyRun();
    else if (key === 'k') nominateDepot();
    else if (key === ',') nudgeSpeed(-1);
    else if (key === '.') nudgeSpeed(1);
    else if (key === ' ') togglePause();
    else if (key === 'c' || key === 'tab') {
      event.preventDefault();
      cycleCamera();
    } else if (key === 'g') cycleGraphics(level);
    else return;
    event.preventDefault();
  });
  window.addEventListener('keyup', (event) => {
    const key = event.key.toLowerCase();
    if (key === 'a' || key === 'arrowleft') held.a = false;
    if (key === 'd' || key === 'arrowright') held.d = false;
    if (['a', 'd', 'arrowleft', 'arrowright'].includes(key)) {
      sendRudder(held.a ? 1 : (held.d ? -1 : 0));
    }
    if (key === 'arrowup') held.up = false;
    if (key === 'arrowdown') held.down = false;
    if (key === 'arrowup' || key === 'arrowdown') {
      sendClimb(held.up ? 1 : (held.down ? -1 : 0));
    }
  });
  window.addEventListener('blur', () => sendRudder(0));

  // Click an enemy to attack it, the empty sea to move there. The click is
  // resolved to a point on the water first; whether anything hostile is
  // standing near that point decides which of the two it was.
  window.addEventListener('pointerdown', (event) => {
    if (state.piloting || state.damage.open) return;
    const ndcX = (event.clientX / window.innerWidth) * 2 - 1;
    const ndcY = -(event.clientY / window.innerHeight) * 2 + 1;
    const target = pickSea(state.scene3d, ndcX, ndcY);
    if (target === -1) return;

    const enemy = enemyNear(target.x, target.y);
    const unit = selectedUnit();
    if (enemy === undefined) {
      // An island you hold opens its board; anything else closes it.
      const island = islandAt(state.view, target.x, target.y);
      openIslandPanel(state.island, island);
      if (island !== undefined) return;
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

    const size = state.view.params.sizeUnits;
    if (target.x < 0 || target.y < 0 || target.x > size || target.y > size) return;
    if (unit === undefined) {
      // Nothing selected: the click is a course for the SHIP - the original's
      // map + PROG + A, collapsed to one click. The autopilot steers, the
      // throttle stays yours, and any hand on the helm cancels it.
      if (state.carrierId === -1) return;
      state.transport.send({
        type: 'set_course', carrierId: state.carrierId, x: target.x, y: target.y,
      });
      setHud(state.hud, 'status', state.t('status.course'));
      return;
    }
    state.transport.send({
      type: 'order_unit_move', unitId: unit.id, x: target.x, y: target.y,
    });
  });
}

// A shared clock moves when everybody agrees (owner ruling 2026-08-20). The
// HUD says where the table stands so nobody is left wondering whether their
// key press did anything.
// The room, when there is one. A LAN server may hold the war in a lobby until
// the host starts it; a solo game never has one.
function onLobby(room) {
  state.room = room;
  renderLobbyPanel(state.lobbyPanel, room, state.team);
  // A reopened room covers the ending it follows: the result had its moment.
  document.getElementById('warover-panel').classList.remove('open');
}

function onVote(message) {
  if (message.speed < 0) {
    state.voteText = '';
  } else {
    state.voteText = state.t('speed.vote', {
      speed: describeSpeed(message.speed),
      agreed: message.agreed,
      players: message.players,
    });
  }
  setHud(state.hud, 'speedx', describeSpeed(state.speed)
    + (state.voteText === '' ? '' : ` - ${state.voteText}`));
}

function onSpeed(multiplier) {
  state.speed = multiplier;
  setHud(state.hud, 'speedx', describeSpeed(multiplier));
}

function onWelcome(message) {
  if ((message.lobby ?? 0) === 0 && state.room !== undefined) {
    state.room = undefined;
    renderLobbyPanel(state.lobbyPanel, undefined, message.team);
    // The room just started a war - the first one, or the next one of the
    // evening. Whatever is on the map belongs to the LAST war: rebuild the
    // world from the new war's first snapshot, and hand back the controls.
    state.pendingWorldReset = true;
    state.selectedUnitId = -1;
    state.piloting = false;
    state.throttle = 0;
    state.rudder = 0;
    state.climb = 0;
  }
  state.team = message.spectator ? 0 : message.team;
  state.speed = message.speed ?? 1;
  state.speedLocked = (message.speedLocked ?? 0) === 1;
  setHud(state.hud, 'speedx', describeSpeed(state.speed)
    + (state.speedLocked ? ` (${state.t('hud.locked')})` : ''));
  setHud(state.hud, 'seat', (message.replay ?? 0) === 1
    ? state.t('seat.replay', { team: message.team })
    : (message.spectator
      ? state.t('seat.spectator')
      : state.t('seat.team', { team: message.team })));
  setHud(state.hud, 'seed', message.seed);
  setHud(state.hud, 'status', state.t('status.connected'));
}

function onSnapshot(message) {
  if (state.pendingWorldReset && message.view !== undefined) {
    state.pendingWorldReset = false;
    resetWorld(state.scene3d, Math.round(message.view.params.sizeUnits / 256));
  }
  state.view = message.view;
  // Sound follows the VIEW's events, which are already fog-filtered: you hear
  // your own hulls and your own ship, and nothing over the horizon.
  playEvents(state.sound, message.view.events, window.performance.now());
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
  'replay finished': 'status.replayDone',
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
  drawPanel(deltaSeconds);
  const locked = playWarning(state.sound, state.view, nowMs);
  document.getElementById('sight').classList.toggle('warn', locked);
  setHud(state.hud, 'islands', describeIslands(state.t, state.view));
  setHud(state.hud, 'score', describeScore(state.t, state.view));
  setHud(state.hud, 'damage', describeDamage(state.t, state.view));
  setHud(state.hud, 'weapons', describeWeapons(state.t, state.view, selectedUnit()));
  setHud(state.hud, 'stores', describeStores(state.t, state.view));
  setHud(state.hud, 'supply', describeSupply(state.t, state.view));
  renderDamagePanel(state.damage, deltaSeconds);
  renderIslandPanel(state.island);
  renderStoresPanel(state.stores);
  updateWaroverPanel(state.warover, state.view);
  updateWeaponGroup();
  updateSight();
}

// Scope ranges, in metres. The narrow end is a knife fight alongside the ship;
// the wide end is most of an archipelago, where the scope stops being a sensor
// and becomes a chart - contacts still only appear where the fog allows.
const SCOPE_RANGES = [1000, 2000, 4000, 8000, 16000, 32000];

function zoomScope(direction) {
  const index = SCOPE_RANGES.indexOf(state.scopeRange);
  const next = Math.min(SCOPE_RANGES.length - 1, Math.max(0, index + direction));
  state.scopeRange = SCOPE_RANGES[next];
  setHud(state.hud, 'status', state.t('status.scope', { range: state.scopeRange }));
}

// The instrument panel. What it is handed is the fog-filtered view and a
// handful of already-translated strings: the drawing code does no wording, and
// the wording code does no drawing.
function drawPanel(deltaSeconds) {
  if (state.panel === undefined || state.view === undefined) return;
  const own = ownCarrierOf(state.view);
  const unit = selectedUnit();
  const holder = unit !== undefined && unit.arms !== undefined && unit.arms.length > 0
    ? unit
    : own;
  const params = state.view.params;
  drawInstruments(state.panel, state.view, own, {
    helmTitle: state.t('panel.helm'),
    scopeTitle: state.t('panel.scope'),
    scopeRange: state.scopeRange * params.unitsPerMetre,
    scopeLabel: `${state.scopeRange >= 1000 ? `${state.scopeRange / 1000}k` : state.scopeRange} m`,
    shipTitle: state.t('panel.ship'),
    throttle: state.t('hud.throttle'),
    speed: state.t('hud.speed'),
    knots: own === undefined
      ? ''
      : `${knotsFrom(own.speed, params.unitsPerMetre, params.tickHz)} ${state.t('hud.knots')}`,
    fuel: state.t('hud.fuel'),
    fuelFigure: own === undefined || own.fuelCapacity <= 0
      ? ''
      : `${Math.round((own.fuel * 100) / own.fuelCapacity)}%`,
    hull: state.t('hud.hull'),
    hullFigure: own === undefined ? '' : `${Math.round((own.hull * 100) / own.maxHull)}%`,
    ordnance: state.t('panel.ordnance'),
    ordnanceFigure: own === undefined ? '' : String(own.ordnance),
    materials: state.t('panel.materials'),
    materialsFigure: own === undefined ? '' : String(own.materials),
    bow: state.t('panel.bow'),
    stern: state.t('panel.stern'),
    flares: state.t('panel.flares'),
    flaresFigure: own === undefined || own.flareCooldown < 0
      ? ''
      : (own.flareCooldown > 0 ? state.t('panel.reloading') : state.t('panel.ready')),
    flaresPermil: own === undefined || own.flareReload <= 0
      ? 1000
      : Math.round(((own.flareReload - own.flareCooldown) * 1000) / own.flareReload),
    weapon: weaponName(state.t, holder),
    tally: holder === undefined ? '' : String(roundsOf(holder)),
  }, deltaSeconds, state.instrumentColours);
}

// The gunsight: shown while flying, and marked when a seeker has something on
// the nose. Locked is a colour rather than a word - you are busy flying.
function updateSight() {
  const sight = document.getElementById('sight');
  const unit = state.piloting ? selectedUnit() : undefined;
  const aiming = unit !== undefined || state.scene3d.gunsight === true;
  sight.classList.toggle('on', aiming);
  if (unit === undefined) {
    sight.classList.remove('lock');
    return;
  }
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
    'help.damage', 'help.scope', 'help.time'];
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
  document.getElementById('help-button').addEventListener('click', toggleHelp);
  document.getElementById('debug-button').addEventListener('click', toggleDebug);
  buildActionColumns(state.t);
  setHud(state.hud, 'status', state.t('status.loading'));

  const rules = await fetchRules();

  // A URL that already says what to run is somebody who has chosen - a shared
  // link, a probe, the smoke gate. Everybody else gets the menu.
  let seed = Number(params.get('seed') ?? 20260818);
  let startSpeed = START_SPEED;
  let styleName = params.get('style');
  if (!params.has('mode')) {
    const panel = createStartPanel(state.t, seedFromClock());
    const chosen = await showStartPanel(panel);
    seed = chosen.seed;
    const extras = applyChoices(rules, chosen.choices);
    startSpeed = extras.speed;
    state.speed = startSpeed;
    if (styleName === null) styleName = extras.style;
  }

  state.podBuildTicks = rules.rules.podBuildTicks;
  state.buildCosts = rules.economy.builds.map((row) => row.materials);
  // The two boards get a context rather than the client: a translator, the
  // current view, the seat's ship, prices, and a way to send a command.
  const panelContext = {
    t: (key, vars) => state.t(key, vars),
    view: () => state.view,
    ownCarrier: () => (state.view === undefined ? undefined : ownCarrierOf(state.view)),
    carrierId: () => state.carrierId,
    buildCost: (what) => state.buildCosts[what] ?? 0,
    send: (message) => state.transport.send(message),
  };
  state.damage = createDamagePanel(panelContext);
  state.island = createIslandPanel(panelContext);
  state.stores = createStoresPanel(panelContext);
  state.warover = createWaroverPanel(
    panelContext.t,
    MODE === 'lan'
      ? () => state.transport.sendMessage({ type: 'lobby_reopen' })
      : undefined,
  );
  // The lobby speaks to the SERVER, not to the reducer: its own sender, which
  // puts the message on the wire as it is.
  state.lobbyPanel = createLobbyPanel({
    t: panelContext.t,
    send: (message) => state.transport.sendMessage(message),
  });
  const diag = getGraphicsDiagnostics();
  const override = params.get('graphics') ?? readOverride(window.localStorage);
  const resolved = resolveGraphics(suggestGraphicsLevel(diag), override);
  const preset = presetFor(resolved.level);
  setHud(state.hud, 'graphics', `${preset.label} (${resolved.source})`);
  document.getElementById('gpu').textContent = describeGpu(diag);

  const style = styleFor(resolveStyle(styleName));
  applyStyleToDocument(style, document.documentElement);
  setHud(state.hud, 'graphics', `${preset.label} / ${style.label} (${resolved.source})`);

  // The map grows with the island count, so the ocean plane, the sun's aim and
  // the sea grid have to use the SCALED size - the base size leaves the far
  // corners of a big archipelago outside the water.
  const sizeMetres = worldSizeMetres(rules.world);
  state.scene3d = createScene(document.getElementById('view'), preset, sizeMetres, style);
  state.panel = createInstruments(document.getElementById('panel'));
  state.instrumentColours = style.instruments;
  bindPanelInput();
  // Probes open the island board without having to hit an island with a
  // screen-space click; the board itself is the same one a click opens.
  window.__openIsland = (islandId) => {
    const island = state.view === undefined
      ? undefined
      : state.view.islands.find((i) => i.id === islandId);
    openIslandPanel(state.island, island);
  };
  // Render probes reach the scene graph through this; nothing in the game uses
  // it, and it holds no state the client does not already own.
  window.__scene3d = state.scene3d;
  // Probes photograph states a live war takes hours to reach - a finished war,
  // a scope full of remembered ghosts - by pausing and swapping the view. The
  // next real snapshot overwrites it, which is why the probe pauses first.
  window.__debugView = (view) => { state.view = view; };
  resize(state.scene3d);
  window.addEventListener('resize', () => resize(state.scene3d));

  if (MODE === 'replay') {
    // The autosaved war, played back through the same reducer. 404 means no
    // war has been saved yet, and the honest answer is to say so and stop.
    const response = await fetch('/data/autosave.json');
    if (!response.ok) {
      setHud(state.hud, 'status', state.t('status.noReplay'));
      document.getElementById('debug-button').click();
      return;
    }
    const save = await response.json();
    setHud(state.hud, 'seat', state.t('seat.replay', { team: SEAT }));
    state.transport = createReplayTransport(save, rules, SEAT);
  } else if (MODE === 'lan') {
    const scheme = window.location.protocol === 'https:' ? 'wss' : 'ws';
    state.transport = createWsTransport(`${scheme}://${window.location.host}`);
  } else {
    state.transport = createLocalTransport(seed, rules, SEAT, startSpeed);
  }
  setHud(state.hud, 'transport', state.t(MODE === 'lan' ? 'transport.ws' : 'transport.local'));
  bindInput(resolved.level);
  state.transport.connect({
    onWelcome: onWelcome,
    onSnapshot: onSnapshot,
    onSpeed: onSpeed,
    onVote: onVote,
    onLobby: onLobby,
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
