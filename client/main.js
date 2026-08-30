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
import { weatherAt } from '../shared/weather.js';
import { createLocalTransport, createReplayTransport, createWsTransport } from './transport.js';
import { getGraphicsDiagnostics, suggestGraphicsLevel, describeGpu } from './diagnostics.js';
import { presetFor, readOverride, resolveGraphics, writeOverride, presetNames } from './graphics.js';
import {
  AUTOSAVE_MS, agoText, clearSoloSave, readSoloSave, writeSoloSave,
} from './localsave.js';
import { gameFromState, replayLog } from '../shared/savefile.js';
import { createScene, resetWorld, renderView, resize, ownCarrierOf, pickSea, TEAM_COLOURS } from './render/scene.js';
import {
  createInstruments, drawFlightInstruments, drawInstruments, forgetPanelHeight, helmHitAt,
} from './render/instruments.js';
import { createSound, playEvents, playWarning, startAmbience, toggleMute, wakeSound } from './sound.js';
import { createDamagePanel, renderDamagePanel, toggleDamagePanel } from './panels/damage.js';
import {
  createIslandPanel,
  islandAt,
  openIslandPanel,
  renderIslandPanel,
} from './panels/island.js';
import {
  applyChoices,
  choicesFromParams,
  namedInParams,
  createStartPanel,
  seedFromClock,
  showStartPanel,
} from './panels/start.js';
import { createLobbyPanel, renderLobbyPanel } from './panels/lobby.js';
import { createStoresPanel, renderStoresPanel, toggleStoresPanel as flipStoresPanel } from './panels/stores.js';
import {
  createSquadronPanel,
  renderSquadronPanel,
  toggleSquadronPanel as flipSquadronPanel,
} from './panels/squadron.js';
import { createChartPanel, renderChart, toggleChart, fitChart } from './panels/chart.js';
import { createWaroverPanel, updateWaroverPanel } from './panels/warover.js';
import { nextWeapon } from '../engine/weapons.js';
import { describeSpeed, isSpeed, stepSpeed } from '../shared/speeds.js';
import { createTranslator, fetchCatalog, pickLang, DEFAULT_LANG } from './i18n.js';
import { applyStyleToDocument, resolveStyle, styleFor } from './styles.js';
import { startDiorama } from './render/diorama.js';
import { dist2D } from '../shared/fixed.js';
// A Manta parked on an island runway is still 'out' for the chips.
const UNIT_LANDED_STATE = 4;
import { islandName } from '../shared/names.js';
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
  degreesFrom,
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

// Where the sky is read from. -1 means "wherever the war has got to", which
// is every real game; a number freezes it for a screenshot.
const WEATHER_PARAM = new URLSearchParams(window.location.search).get('weather');

const state = {
  weatherTick: WEATHER_PARAM === null ? -1 : Math.max(0, Number(WEATHER_PARAM) | 0),
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
  signals: [],
  signalsOpen: false,
  // Set once when a war ends, so the solo autosave is dropped exactly once.
  soloSaveCleared: false,
  // Which low-fuel marks have already been announced (see warnOnFuel).
  fuelWarned: {},
  surrenderArmedMs: 0,
  lastTelemetry: 0,
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
      && (unit.state === UNIT_ACTIVE || unit.state === UNIT_RETURNING
        || unit.state === UNIT_LANDED_STATE),
  );
}

// What NEXT and the chips will actually NAME: the hulls a commander flies.
// The lighter runs its own errand, the aerostat has no stick, the decoys
// are a screen - selecting any of them would only turn the next click on
// open water into an order for something that never wanted one. This
// matters from the first second now: with a home island the supply boat is
// afloat at tick 1, and it used to grab the selection before the player had
// touched anything, turning click-to-sail into click-to-move-the-boat.
function selectableUnits() {
  return afloatUnits().filter((unit) => unit.kind === KIND_MANTA || unit.kind === KIND_WALRUS);
}

function selectedUnit() {
  return afloatUnits().find((unit) => unit.id === state.selectedUnitId);
}

// The SHIP has an astern gear down to -25 (the bottom quarter of the scale,
// as 1988 had it); a craft's throttle stays 0..100.
function clampThrottle(value, floor) {
  return Math.max(floor, Math.min(100, value));
}

// W/S and A/D drive whatever the player is currently at the controls of: the
// piloted unit if there is one, otherwise the carrier's helm.
function sendThrottle(next) {
  if (state.piloting) {
    const wanted = clampThrottle(next, 0);
    const unit = selectedUnit();
    if (unit === undefined) return;
    state.throttle = wanted;
    state.transport.send({
      type: 'set_unit_helm', unitId: unit.id, throttle: wanted, rudder: state.rudder,
      climb: state.climb,
    });
    return;
  }
  const wanted = clampThrottle(next, -25);
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
  const units = selectableUnits();
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

// A solo war writes itself down every half minute, and again whenever the tab
// goes away - which is the moment that matters, because that is when it used
// to be lost. `pagehide` covers closing and navigating; `visibilitychange`
// covers a phone being locked or a tab going to the background, where
// `pagehide` may never fire at all.
function startSoloAutosave(seed, style) {
  let complained = false;
  const write = () => {
    const transport = state.transport;
    if (transport === undefined || typeof transport.localGame !== 'function') return;
    const game = transport.localGame();
    if (game === 0 || game === undefined || game.state === undefined) return;
    // Nothing to save before the war has started, and nothing worth saving
    // after it has ended.
    if (game.state.tick === 0 || game.state.phase !== 0) return;
    const trouble = writeSoloSave(window.localStorage, game, seed, state.savedChoices ?? 0, {
      style: style.label,
      islands: game.state.islands.length,
    });
    // Say it once. A full quota is not a reason to stop playing, but it IS a
    // reason the player should know the war is no longer being kept.
    if (trouble !== '' && !complained) {
      complained = true;
      setHud(state.hud, 'status', state.t('status.saveFailed', { why: trouble }));
    }
  };
  // Anything that is about to reload the page can take the war with it.
  state.saveSoloNow = write;
  window.setInterval(write, AUTOSAVE_MS);
  window.addEventListener('pagehide', write);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') write();
  });
}

function cycleGraphics(currentLevel) {
  const names = presetNames();
  const next = names[(names.indexOf(currentLevel) + 1) % names.length];
  writeOverride(window.localStorage, next);
  // A preset changes renderer construction (antialias, shadow maps), so it is
  // applied by reloading rather than by rebuilding half the scene in place.
  //
  // And the URL has to let go first. `?graphics=` outranks the stored
  // override on startup, so a page opened with the tier pinned in its address
  // would write the new choice, reload, read the URL again and come back
  // exactly as it was - the control doing nothing but restarting the war.
  // Dropping the parameter is what makes the click mean something.
  const url = new URL(window.location.href);
  url.searchParams.delete('graphics');
  // A SOLO war goes with you. The tier change still reloads - a preset
  // changes how the renderer is built - but the war is written down first and
  // asked for back on the way in, so changing tier mid-war costs a moment of
  // black screen rather than the evening (owner's ask, 2026-08-30).
  if (MODE === 'solo' && typeof state.saveSoloNow === 'function') {
    state.saveSoloNow();
    if (readSoloSave(window.localStorage) !== 0) url.searchParams.set('resume', 'local');
  }
  window.location.href = url.toString();
}

// The camera tabs (playtest ruling 2026-08-24): the original's interface
// always SAID which console you were at, so ours does - three clickable tabs
// top centre, the lit one is where you are. C still cycles through them.
const CAMERA_MODES = [
  { name: 'helm', label: 'camera.helm' },
  { name: 'weapon', label: 'camera.weapon' },
  { name: 'birdseye', label: 'camera.birdseye' },
  // The original's map screen (second source review): a real chart, not a
  // camera - but it lives on the same tab row because it answers the same
  // question, "what am I looking at".
  { name: 'chart', label: 'camera.chart' },
  // The DRONE view exists only while a Viewing Drone is up - the tab
  // appears with the eye and leaves with it (proposal 5).
  { name: 'drone', label: 'camera.drone' },
];
const cameraTabs = {};

function ownDroneUp() {
  if (state.view === undefined) return undefined;
  return state.view.units.find(
    (unit) => unit.team === state.view.team && unit.kind === 3 && unit.state === 1,
  );
}

function cameraMode() {
  if (state.chart !== undefined && state.chart.open) return 'chart';
  if (state.scene3d === undefined) return 'helm';
  if (state.scene3d.droneView) return 'drone';
  if (state.scene3d.gunsight) return 'weapon';
  if (state.scene3d.strategic) return 'birdseye';
  return 'helm';
}

function setCameraMode(name) {
  const scene = state.scene3d;
  if (scene === undefined) return;
  if (name === 'chart') {
    if (state.chart !== undefined && !state.chart.open) showConsole('chart');
    scene.droneView = false;
  } else {
    if (state.chart !== undefined && state.chart.open) showConsoleNone();
    scene.droneView = name === 'drone' && ownDroneUp() !== undefined;
    scene.gunsight = name === 'weapon';
    scene.strategic = name === 'birdseye';
  }
  updateCameraTabs();
}

function buildCameraTabs(t) {
  const root = document.getElementById('camera-tabs');
  for (const mode of CAMERA_MODES) {
    const tab = document.createElement('div');
    tab.className = 'cam-tab';
    tab.textContent = t(mode.label);
    tab.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      setCameraMode(mode.name);
    });
    attachTip(tab, t('tip.cameraTabs'));
    root.append(tab);
    cameraTabs[mode.name] = tab;
  }
}

function updateCameraTabs() {
  const current = cameraMode();
  for (const mode of CAMERA_MODES) {
    if (cameraTabs[mode.name] !== undefined) {
      cameraTabs[mode.name].classList.toggle('on', mode.name === current);
    }
  }
  // In WEAPON view the selector IS the console: the chips move to the
  // bottom centre, full size (the CSS reads this class).
  document.body.classList.toggle('weapon-mode', current === 'weapon');
  document.body.classList.toggle('drone-mode', current === 'drone');
  // The DRONE tab stands only while an eye is up.
  if (cameraTabs.drone !== undefined) {
    cameraTabs.drone.style.display = ownDroneUp() !== undefined ? '' : 'none';
  }
}

// Three ways to look at a war: over the shoulder, down the gunsight, and the
// map. C walks them in that order.
function cycleCamera() {
  const scene = state.scene3d;
  // C walks the three WAYS OF SEEING; the chart steps aside first.
  if (state.chart !== undefined && state.chart.open) showConsoleNone();
  scene.droneView = false;
  if (!scene.gunsight && !scene.strategic) scene.gunsight = true;
  else if (scene.gunsight) { scene.gunsight = false; scene.strategic = true; }
  else scene.strategic = false;
  updateCameraTabs();
}

// The instrument panel is clickable (1988: "click directly on speed scale to
// set target speed"). Rudder arrows act while held and CENTRE UP on release,
// exactly like the keys they mirror.
function bindPanelInput() {
  const canvas = document.getElementById('panel');
  canvas.style.pointerEvents = 'auto';
  let heldRudder = 0;
  // The helm drives whatever the panel is SHOWING (playtest ruling
  // 2026-08-24, superseding round two's ship-always rule): at the ship's
  // helm it is the ship's wheel; at the controls of a craft the panel is
  // the craft's, and so is its throttle scale. sendThrottle/sendRudder
  // already route by who is being piloted - the keys and the clicks agree.
  canvas.addEventListener('pointerdown', (event) => {
    const rect = canvas.getBoundingClientRect();
    const hit = helmHitAt(event.clientX - rect.left, event.clientY - rect.top);
    if (hit === -1) return;
    if (hit.kind === 'throttle') {
      sendThrottle(hit.throttle);
      return;
    }
    heldRudder = hit.rudder;
    sendRudder(heldRudder);
  });
  const release = () => {
    if (heldRudder === 0) return;
    heldRudder = 0;
    sendRudder(0);
  };
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointerleave', release);
  // A finger lifted off the glass can end as a CANCEL rather than an up -
  // without this a touch rudder stays hard over after the finger is gone.
  canvas.addEventListener('pointercancel', release);
}

// The signals log (manual coverage review, item 9): the original's Messaging
// Computer kept the last sixteen reports with their ages, because a toast is
// history you missed and a log is history you can read. Events are already
// fog-filtered by the view; this only puts words on the ones worth keeping.
const SIGNALS_KEPT = 16;

function kindWord(kind) {
  if (kind === KIND_MANTA) return state.t('unit.manta');
  if (kind === KIND_WALRUS) return state.t('unit.walrus');
  return state.t('unit.lighter');
}

function islandWord(view, islandId) {
  const island = view.islands.find((i) => i.id === islandId);
  return island === undefined ? '?' : islandName(island);
}

function signalText(view, event) {
  const t = state.t;
  const code = event.code;
  if (code === 5) return t('log.grounded');
  if (code === 6) return t('log.fuelEmpty');
  if (code === 7) return t('log.fuelRestored');
  if (code === 8) return t('log.launched', { kind: kindWord(event.c) });
  if (code === 9 || code === 10 || code === 11 || code === 12) {
    const unit = view.units.find((u) => u.id === event.a);
    const kind = kindWord(unit === undefined ? 0 : unit.kind);
    if (code === 9) return t('log.recovered', { kind: kind });
    if (code === 10) return t('log.unitLost', { kind: kind });
    if (code === 11) return t('log.arrived', { kind: kind });
    return t('log.blocked', { kind: kind });
  }
  if (code === 15) return t('log.podDeployed', { island: islandWord(view, event.a) });
  if (code === 16) return t('log.podLost', { island: islandWord(view, event.a) });
  if (code === 17) return t('log.captured', { island: islandWord(view, event.a), team: event.b });
  if (code === 18) return t('log.warOver');
  if (code === 19) return t('log.resupplied', { island: islandWord(view, event.c) });
  if (code === 20) return t('log.carrierDamaged', { points: event.c });
  if (code === 21) return t('log.carrierSunk', { team: event.b });
  if (code === 22) return t('log.stockpileSet', { island: islandWord(view, event.a) });
  if (code === 24) return t('log.supplyDelivered');
  if (code === 25) return t(event.c === 1 ? 'log.supplyRunOn' : 'log.supplyRunOff');
  if (code === 30) return t('log.roleSet', { island: islandWord(view, event.a) });
  if (code === 31) return t('log.built', { island: islandWord(view, event.a) });
  if (code === 32) return t('log.hullReplaced', { kind: kindWord(event.c) });
  if (code === 34) return t('log.turretLost', { island: islandWord(view, event.c) });
  if (code === 35) return t('log.virusDeployed', { island: islandWord(view, event.a) });
  if (code === 36) return t('log.converted', { island: islandWord(view, event.a) });
  if (code === 37) return t('log.flares');
  if (code === 39) return t(event.b === 1 ? 'log.courseSet' : 'log.courseDone');
  if (code === 41) {
    const unit = view.units.find((u) => u.id === event.a);
    return t('log.telemetryLost', { kind: kindWord(unit === undefined ? 0 : unit.kind) });
  }
  if (code === 43) return t('log.nodeDestroyed', { island: islandWord(view, event.a) });
  if (code === 42) {
    const unit = view.units.find((u) => u.id === event.a);
    return t('log.landed', {
      kind: kindWord(unit === undefined ? 0 : unit.kind),
      island: islandWord(view, event.c),
    });
  }
  return '';
}

function collectSignals(view) {
  for (const event of view.events) {
    const text = signalText(view, event);
    if (text === '') continue;
    state.signals.push({ tick: view.tick, text: text });
  }
  if (state.signals.length > SIGNALS_KEPT) {
    state.signals.splice(0, state.signals.length - SIGNALS_KEPT);
  }
}


// --- the console (ruled 2026-08-26, Q5b) -----------------------------------
//
// Six overlays with six keys became one overlay with a tab strip. The panels
// themselves are untouched: each still owns its element, its `.open` class
// and its own toggle, and this only decides WHICH of them is open at a time.
// That is why every panel module and every probe still reads the same.
//
// Each panel's key still works and still means what it meant - pressing it
// selects that tab, and pressing it again closes the console - so nobody has
// to relearn anything.
const CONSOLE_TABS = [
  { name: 'squadron', key: 'J', label: 'console.squadron' },
  { name: 'stores', key: 'Q', label: 'console.stores' },
  { name: 'damage', key: 'Z', label: 'console.damage' },
  { name: 'island', key: '', label: 'console.island' },
  // The chart is a member of the console - opening another tab must close
  // it, and closing the console must put the map away - but it gets NO tab
  // of its own (owner's ruling 2026-08-28). The camera bar already has
  // CHART, and that one is strictly better: it opens the same map AND lights
  // the camera bar to match, where this one left the bar reading HELM with a
  // map on the screen. Two buttons for one thing, one of them worse.
  { name: 'chart', key: '', label: 'console.chart', hidden: true },
  { name: 'log', key: 'I', label: 'console.log' },
];

// Whether a tab's panel is currently showing, and how to make it show or not.
// Routed through each panel's OWN toggle so the panel's internal `open` flag
// never drifts from the class on its element - a second source of truth here
// is how a panel ends up rendering into a box nobody can see.
function consolePanelOpen(name) {
  const root = document.getElementById(`${name}-panel`);
  return root !== null && root.classList.contains('open');
}

function setConsolePanel(name, wanted) {
  if (consolePanelOpen(name) === wanted) return;
  if (name === 'squadron') flipSquadronPanel(state.squadron);
  else if (name === 'stores') flipStoresPanel(state.stores);
  else if (name === 'damage') toggleDamagePanel(state.damage);
  else if (name === 'chart') toggleChart(state.chart, state.view);
  else if (name === 'log') toggleSignals();
  else if (name === 'island') {
    // The island board is the one tab that needs a subject. Opening it with
    // nothing chosen would show an empty box, so the tab simply does not
    // open until the player has picked an island off the sea or the chart.
    //
    // Closing it only HIDES it: openIslandPanel(undefined) also forgets which
    // island it was showing, and showConsole closes every tab before opening
    // one - so routing the close through there wiped the subject on the way
    // to displaying it.
    if (wanted) openIslandPanel(state.island, islandById(state.island.islandId));
    else document.getElementById('island-panel').classList.remove('open');
  }
}

function islandById(islandId) {
  if (islandId === undefined || islandId < 0) return undefined;
  if (state.view === undefined) return undefined;
  for (const island of state.view.islands) {
    if (island.id === islandId) return island;
  }
  return undefined;
}

function consoleTabAvailable(name) {
  if (name !== 'island') return true;
  return islandById(state.island.islandId) !== undefined;
}

// Show the console at one tab. Passing the tab that is already showing closes
// the console, which is what a key that used to be a toggle should still do.
function showConsole(name) {
  const shell = document.getElementById('console');
  if (shell === null) return;
  // A tab with nothing to show does NOTHING - it must not close the console
  // out from under whatever the player was actually reading. Checked before
  // anything is torn down, for exactly that reason.
  if (!consoleTabAvailable(name)) return;
  if (shell.classList.contains('open') && consolePanelOpen(name)) {
    showConsoleNone();
    return;
  }
  for (const tab of CONSOLE_TABS) setConsolePanel(tab.name, false);
  setConsolePanel(name, true);
  shell.classList.add('open');
  shell.classList.toggle('chart', name === 'chart');
  renderConsoleTabs();
  // PROG's label names whose course it will lay, so it has to follow the
  // selection rather than only chart clicks. Cheap: it writes only on change.
  if (state.updateChartButtons !== undefined) state.updateChartButtons();
}

function showConsoleNone() {
  const shell = document.getElementById('console');
  if (shell === null) return;
  for (const tab of CONSOLE_TABS) setConsolePanel(tab.name, false);
  shell.classList.remove('open', 'chart');
  renderConsoleTabs();
}

// The top row's real height, published so the button columns can start below
// it. On a narrow phone the row wraps to two lines and a fixed offset puts
// the columns underneath it (measured at 740x360). Written only when it
// changes, so this is free in the frame loop.
function syncBarHeight() {
  const bar = document.getElementById('top-bar');
  if (bar === null) return;
  const wanted = `${Math.round(bar.getBoundingClientRect().bottom) + 12}px`;
  if (syncBarHeight.last === wanted) return;
  syncBarHeight.last = wanted;
  document.documentElement.style.setProperty('--bar-clear', wanted);
}

// The button columns' real widths, published so an open console can sit
// between them. They WRAP into extra columns when the window is short (the
// ruling is that every action stays visible), so this is not a constant: at
// 1280x540 the right column is two buttons wide and a console that assumed one
// sat underneath it. Same shape as syncBarHeight above, and written only when
// it changes, so it is free in the frame loop.
function syncColumnWidths() {
  const left = document.getElementById('actions-left');
  const right = document.getElementById('actions-right');
  if (left === null || right === null) return;
  const wantedLeft = `${Math.round(left.getBoundingClientRect().width)}px`;
  const wantedRight = `${Math.round(right.getBoundingClientRect().width)}px`;
  if (syncColumnWidths.left !== wantedLeft) {
    syncColumnWidths.left = wantedLeft;
    document.documentElement.style.setProperty('--col-left', wantedLeft);
  }
  if (syncColumnWidths.right !== wantedRight) {
    syncColumnWidths.right = wantedRight;
    document.documentElement.style.setProperty('--col-right', wantedRight);
  }
}

function renderConsoleTabs() {
  const strip = document.getElementById('console-tabs');
  if (strip === null) return;
  let signature = '';
  for (const tab of CONSOLE_TABS) {
    if (tab.hidden === true) continue;
    signature += `${tab.name}${consolePanelOpen(tab.name) ? '1' : '0'}`
      + `${consoleTabAvailable(tab.name) ? 'y' : 'n'}`;
  }
  if (strip.__signature === signature) return;
  strip.__signature = signature;
  strip.textContent = '';
  // The row's height can only change when its contents do - here - or when
  // the window does (the resize handler). Reading `getBoundingClientRect`
  // every frame to find that out is a layout flush per frame, which is the
  // opposite of what a mobile pass is for.
  window.setTimeout(syncBarHeight, 0);
  for (const tab of CONSOLE_TABS) {
    if (tab.hidden === true) continue;
    const node = document.createElement('div');
    node.className = 'console-tab';
    if (consolePanelOpen(tab.name)) node.classList.add('on');
    if (!consoleTabAvailable(tab.name)) node.classList.add('off');
    node.textContent = state.t(tab.label);
    if (tab.key !== '') {
      const key = document.createElement('span');
      key.className = 'k';
      key.textContent = tab.key;
      node.append(key);
    }
    node.addEventListener('pointerdown', (event) => {
      event.stopPropagation();
      showConsole(tab.name);
    });
    strip.append(node);
  }
}

function toggleSignals() {
  state.signalsOpen = !state.signalsOpen;
  document.getElementById('log-panel').classList.toggle('open', state.signalsOpen);
  document.getElementById('msg-button').classList.toggle('open', state.signalsOpen);
}

function renderSignals() {
  if (!state.signalsOpen || state.view === undefined) return;
  const body = document.getElementById('log-body');
  const hz = state.view.params.tickHz > 0 ? state.view.params.tickHz : 20;
  let text = '';
  for (let i = state.signals.length - 1; i >= 0; i--) {
    const entry = state.signals[i];
    const seconds = Math.max(0, Math.round((state.view.tick - entry.tick) / hz));
    text += `<div><span class="age">-${seconds}s</span>${entry.text}</div>`;
  }
  if (text !== body.__last) {
    body.__last = text;
    body.textContent = '';
    for (let i = state.signals.length - 1; i >= 0; i--) {
      const entry = state.signals[i];
      const seconds = Math.max(0, Math.round((state.view.tick - entry.tick) / hz));
      const line = document.createElement('div');
      const age = document.createElement('span');
      age.className = 'age';
      age.textContent = `-${seconds}s`;
      line.append(age, entry.text);
      body.append(line);
    }
  }
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
// Every key that DOES something must also be a thing you can click (playtest
// 2026-08-28). Four were keyboard-only: Y put the decoy screen out - a whole
// ruled feature whose label had been sitting unused in both language files -
// O looked astern, [ and ] worked the scope, and , and . proposed a clock.
// A player who never reads the key list could not reach any of them.
const ACTIONS_LEFT = [
  ['x', 'act.stop', 'tip.stop'], ['e', 'act.flares', 'tip.flares'],
  ['y', 'act.decoys', 'tip.decoys'],
  ['l', 'act.supply', 'tip.supply'], ['k', 'act.depot', 'tip.depot'],
  ['q', 'act.stores', 'tip.stores'], ['j', 'act.squadron', 'tip.squadron'],
  ['z', 'act.damage', 'tip.damage'], ['c', 'act.camera', 'tip.camera'],
  ['o', 'act.rear', 'tip.rear'], [']', 'act.scope', 'tip.scope'],
  [',', 'act.slower', 'tip.slower'], ['.', 'act.faster', 'tip.faster'],
  ['m', 'act.sound', 'tip.sound'],
];
const ACTIONS_RIGHT = [
  ['1', 'act.manta', 'tip.manta'], ['2', 'act.walrus', 'tip.walrus'],
  ['3', 'act.drone', 'tip.drone'],
  ['n', 'act.next', 'tip.next'], ['t', 'act.controls', 'tip.controls'],
  ['u', 'act.escort', 'tip.escort'],
  ['r', 'act.recall', 'tip.recall'], ['f', 'act.fire', 'tip.fire'],
  ['p', 'act.pod', 'tip.pod'], ['b', 'act.virus', 'tip.virus'],
];

// Every column button, by key, so the frame loop can wake and sleep them
// (playtest ruling 2026-08-24: buttons are context-enabled - a PILOT button
// with nothing to pilot is plainly asleep, not a mystery).
const actionButtons = {};

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
      actionButtons[key] = button;
      // The loadout preset cycler rides under the MANTA launch button
      // (ruled 2026-08-25): what the deck arms the next launch with.
      if (key === '1' && id === 'actions-right') {
        const preset = document.createElement('div');
        preset.className = 'act';
        preset.id = 'preset-chip';
        const cap = document.createElement('span');
        cap.className = 'k';
        cap.textContent = t('preset.balanced');
        const label2 = document.createElement('span');
        label2.className = 'l';
        label2.textContent = t('act.preset');
        preset.append(cap, label2);
        preset.addEventListener('pointerdown', (event) => {
          event.preventDefault();
          if (state.view === undefined || state.carrierId < 0) return;
          const own = ownCarrierOf(state.view);
          const next = ((own?.mantaPreset ?? 0) + 1) % PRESET_KEYS.length;
          state.transport.send({
            type: 'set_loadout_preset', carrierId: state.carrierId, preset: next,
          });
        });
        attachTip(preset, t('tip.preset'));
        root.append(preset);
        actionButtons.preset = preset;
      }
      // The flying hand's vertical axis, for a screen with no arrow keys
      // (touch ruling 2026-08-23): two HELD buttons under TAKE CONTROLS,
      // wired like the keys they mirror - press noses over, release holds
      // the altitude. Harmless with no Manta flown: sendClimb refuses.
      if (key === 't' && id === 'actions-right') {
        for (const [label2, tip2, dir] of [
          ['act.climb', 'tip.climb', 1], ['act.dive', 'tip.dive', -1],
        ]) {
          const held = document.createElement('div');
          held.className = 'act hold';
          const cap = document.createElement('span');
          cap.className = 'k';
          cap.textContent = dir > 0 ? '▲' : '▼';
          const text2 = document.createElement('span');
          text2.className = 'l';
          text2.textContent = t(label2);
          held.append(cap, text2);
          const stop = () => sendClimb(0);
          held.addEventListener('pointerdown', (event) => {
            event.preventDefault();
            sendClimb(dir);
          });
          held.addEventListener('pointerup', stop);
          held.addEventListener('pointerleave', stop);
          held.addEventListener('pointercancel', stop);
          attachTip(held, t(tip2));
          root.append(held);
          actionButtons[dir > 0 ? 'climb' : 'dive'] = held;
        }
      }
      // The weapon SELECTOR rides in the right column between FIRE and POD:
      // one button per weapon the selected hull carries, radio-style
      // (playtest ruling 2026-08-23 - a cycle key hides what a row of
      // buttons shows). V still cycles for the keyboard hand.
      if (key === 'f' && id === 'actions-right') {
        // FIRE and the weapons it fires are ONE wrap unit. When the column
        // splits in two - which it does on a short window - a plain sibling
        // pair can land at the foot of one column and the head of the other,
        // and a playtester reads that as "there are no weapon buttons"
        // (2026-08-29). Putting both inside one container makes them a single
        // flex item, so no wrap can ever come between them.
        const together = document.createElement('div');
        together.id = 'fire-group';
        const group = document.createElement('div');
        group.id = 'weapon-group';
        root.removeChild(button);
        together.append(button, group);
        root.append(together);
      }
    }
  }
  attachTip(document.getElementById('help-button'), t('tip.help'));
  attachTip(document.getElementById('debug-button'), t('tip.debug'));
}

// What each button needs to be worth pressing. Computed every frame from the
// view - cheap (a few array scans), and the alternative is a player pressing
// PILOT with nothing to pilot and learning nothing from the silence.
function updateActionButtons() {
  if (state.view === undefined) return;
  const view = state.view;
  const ship = ownCarrierOf(view);
  const alive = ship !== undefined;
  const chosen = selectedUnit();
  const stowed = (kind) => view.units.some(
    (unit) => unit.team === view.team && unit.kind === kind && unit.state === 0,
  );
  const enabled = {
    x: alive, e: alive, l: alive, k: alive, q: alive, z: alive,
    y: alive,
    o: true, ']': true, ',': true, '.': true,
    c: true, m: true,
    1: alive && stowed(KIND_MANTA),
    2: alive && stowed(KIND_WALRUS),
    3: alive && stowed(3),
    n: selectableUnits().length > 0,
    t: chosen !== undefined && chosen.kind !== 3, // an aerostat has no stick
    u: chosen !== undefined && chosen.kind !== 2 && chosen.kind !== 3,
    r: chosen !== undefined && chosen.kind !== 3, // the eye comes down on its own
    f: alive || (chosen !== undefined && state.piloting),
    p: chosen !== undefined && chosen.kind === KIND_WALRUS,
    b: chosen !== undefined && chosen.kind === KIND_WALRUS,
    preset: alive,
    climb: state.piloting && chosen !== undefined && chosen.kind === KIND_MANTA,
    dive: state.piloting && chosen !== undefined && chosen.kind === KIND_MANTA,
  };
  for (const key of Object.keys(actionButtons)) {
    actionButtons[key].classList.toggle('off', enabled[key] === false);
  }
  // And one button is LIT rather than merely awake: the one that says you can
  // fly the thing you have just selected. Asleep-at-a-third tells a player
  // what the ship can do; it does not tell them what they can do next, and a
  // Manta that has just gone away is flyable with nothing on screen saying so
  // (playtest 2026-08-29). It goes out the moment you take the controls,
  // because then T means release and that is not news.
  const canFly = chosen !== undefined && chosen.kind !== 3 && !state.piloting;
  if (actionButtons.t !== undefined) actionButtons.t.classList.toggle('ready', canFly);
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
    else if (key === '3') launch(3); // the Viewing Drone
    else if (key === 'y') {
      // One button either way: out if any are home, home if any are out.
      if (state.view !== undefined && state.carrierId >= 0) {
        const anyOut = state.view.units.some(
          (u) => u.team === state.view.team && u.kind === 4 && u.state === 1,
        );
        state.transport.send({
          type: anyOut ? 'dock_decoys' : 'deploy_decoys', carrierId: state.carrierId,
        });
      }
    }
    // Direct hull select (the original's 1-4; ours are taken by the launch
    // keys, so the row above them serves): 5-8 name the Nth hull that is out.
    else if (key >= '5' && key <= '8') {
      const out = selectableUnits();
      const chosen = out[Number(key) - 5];
      if (chosen !== undefined) {
        state.selectedUnitId = chosen.id;
        if (state.piloting) state.scene3d.followUnitId = chosen.id;
      }
    }
    else if (key === 'i') showConsole('log');
    else if (key === 'o') {
      state.scene3d.rearView = state.scene3d.rearView !== true;
      setHud(state.hud, 'status', state.t('status.rearView', {
        state: state.t(state.scene3d.rearView ? 'hud.on' : 'hud.off'),
      }));
    }
    // Striking the colours takes TWO Escapes inside three seconds: a war is
    // not a thing to concede by resting a hand on the keyboard.
    else if (key === 'escape') {
      const now = window.performance.now();
      if (now - state.surrenderArmedMs < 3000) {
        state.surrenderArmedMs = 0;
        if (state.carrierId >= 0) {
          state.transport.send({ type: 'surrender', carrierId: state.carrierId });
          setHud(state.hud, 'status', state.t('status.surrendered'));
        }
      } else {
        state.surrenderArmedMs = now;
        setHud(state.hud, 'status', state.t('status.surrenderArm'));
      }
    }
    else if (key === 'n') cycleSelection();
    else if (key === 'r') recallSelected();
    else if (key === 'u') orderEscort();
    else if (key === 'q') showConsole('stores');
    // J for the squadron console (ruled 2026-08-25): the 1988 Manta and
    // Walrus screens, where hulls are outfitted, launched and recovered.
    else if (key === 'j') showConsole('squadron');
    else if (key === 't') togglePiloting();
    else if (key === 'p') deployPod();
    else if (key === 'b') deployVirus();
    else if (key === 'f') fireSelected();
    else if (key === 'e') fireFlares();
    else if (key === 'z') showConsole('damage');
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

  // The stick, for a hand that is already on the mouse (playtest 2026-08-28).
  // Hold the RIGHT button over the view while piloting and drag: up noses
  // down, down pulls up, exactly like the arrow keys it mirrors, and letting
  // go levels off the way releasing the key does. The arrows and the
  // CLIMB/DIVE buttons are unchanged - this is a third way to the same
  // command, for the hand that is already steering.
  //
  // Only for a craft that HAS a vertical axis. A Walrus has no stick, and a
  // drag that silently does nothing is worse than no drag at all.
  const stick = { held: false, fromY: 0 };
  const STICK_DEADZONE = 18;

  function stickCraft() {
    if (!state.piloting) return undefined;
    const unit = selectedUnit();
    if (unit === undefined || unit.kind !== KIND_MANTA) return undefined;
    return unit;
  }

  document.getElementById('view').addEventListener('contextmenu', (event) => {
    // Right-dragging the sky must not raise the browser's menu on top of it.
    if (state.piloting) event.preventDefault();
  });

  window.addEventListener('pointerdown', (event) => {
    if (event.button !== 2 || event.target !== document.getElementById('view')) return;
    if (stickCraft() === undefined) return;
    event.preventDefault();
    stick.held = true;
    stick.fromY = event.clientY;
  });

  window.addEventListener('pointermove', (event) => {
    if (!stick.held) return;
    const moved = event.clientY - stick.fromY;
    if (moved < -STICK_DEADZONE) sendClimb(1);
    else if (moved > STICK_DEADZONE) sendClimb(-1);
    else sendClimb(0);
  });

  const releaseStick = () => {
    if (!stick.held) return;
    stick.held = false;
    sendClimb(0);
  };
  window.addEventListener('pointerup', releaseStick);
  window.addEventListener('pointercancel', releaseStick);
  window.addEventListener('blur', releaseStick);

  // Click an enemy to attack it, the empty sea to move there. The click is
  // resolved to a point on the water first; whether anything hostile is
  // standing near that point decides which of the two it was.
  window.addEventListener('pointerdown', (event) => {
    // Only a click on the WORLD is a click on the sea. Buttons, panels and
    // boards all live above the view canvas, and without this guard a tap
    // on the MANTA button ALSO laid a course to whatever water happened to
    // stand behind it - the touch probe caught it on the first phone, and
    // the desktop had quietly had it all along.
    if (event.target !== document.getElementById('view')) return;
    if (state.piloting || state.damage.open) return;
    const ndcX = (event.clientX / window.innerWidth) * 2 - 1;
    const ndcY = -(event.clientY / window.innerHeight) * 2 + 1;
    const target = pickSea(state.scene3d, ndcX, ndcY);
    if (target === -1) return;
    // In DRONE view a click IS the trigger: a Hammerhead at the point under
    // the crosshair, nothing else (proposal 5 - the original's remote
    // targeting screen).
    if (cameraMode() === 'drone') {
      state.transport.send({
        type: 'fire_hammerhead', carrierId: state.carrierId, x: target.x, y: target.y,
      });
      return;
    }
    handleWorldPoint(target);
  });
}

// A point on the WORLD, however it was pointed at - a click through the 3D
// viewport or a click on the chart resolve to the same engine-unit point and
// mean the same things: an enemy is a target, a friendly runway is an
// approach, an island is its board, open water is a course or a move.
function handleWorldPoint(target) {
  const enemy = enemyNear(target.x, target.y);
  const unit = selectedUnit();
  if (enemy === undefined) {
    const island = islandAt(state.view, target.x, target.y);
    // A Manta selected and a friendly runway under the click: that is an
    // approach, not a board (manual item 2). The board is still there -
    // click with nothing selected.
    if (island !== undefined && unit !== undefined && unit.kind === KIND_MANTA
      && island.owner === state.view.team && island.runway === 1) {
      state.transport.send({ type: 'order_unit_land', unitId: unit.id, islandId: island.id });
      setHud(state.hud, 'status', state.t('status.landing', { island: islandName(island) }));
      return;
    }
    // An island you hold opens its board; anything else dismisses it. Both go
    // through the console so the tab strip agrees with what is showing.
    //
    // "Dismisses it" means the ISLAND tab and nothing else. Closing the whole
    // console here shut the CHART the moment the player clicked open water on
    // it - which is the click that lays a course, so the map closed under
    // every course the player laid.
    const wasIsland = consolePanelOpen('island');
    openIslandPanel(state.island, island);
    if (island !== undefined) showConsole('island');
    else if (wasIsland) showConsoleNone();
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
}

// A shared clock moves when everybody agrees (owner ruling 2026-08-20). The
// HUD says where the table stands so nobody is left wondering whether their
// key press did anything.
// The shop window's keeper: one diorama + one ambience at a time, restarted
// whole on a style change, torn down whole when a war takes the screen. It
// serves both doors - the solo start menu and the LAN war room, which share
// the #start-panel root. A splash that throws is caught and skipped: it must
// never cost anyone the menu.
const showcase = { diorama: null, ambience: null, styleName: '' };

function armAmbience() {
  if (showcase.ambience !== null) return;
  const begin = () => {
    if (showcase.diorama === null || showcase.ambience !== null) return;
    wakeSound(state.sound);
    showcase.ambience = startAmbience(state.sound) ?? null;
  };
  // A browser will not make a sound before the user has done something, so
  // the surf waits for the first gesture - which the menu always gets.
  if (state.sound.ctx !== undefined) begin();
  else {
    window.addEventListener('pointerdown', begin, { once: true });
    window.addEventListener('keydown', begin, { once: true });
  }
}

function openShowcase(requestedStyle) {
  const resolved = resolveStyle(requestedStyle);
  if (showcase.diorama !== null && showcase.styleName === resolved) return;
  closeShowcase();
  try {
    showcase.diorama = startDiorama(styleFor(resolved));
    showcase.styleName = resolved;
    document.getElementById('start-panel').classList.add('showcase');
    document.body.classList.add('showcase');
  } catch { /* menu on a plain background instead */ }
  armAmbience();
}

function closeShowcase() {
  if (showcase.diorama !== null) showcase.diorama.stop();
  if (showcase.ambience !== null) showcase.ambience.stop();
  showcase.diorama = null;
  showcase.ambience = null;
  showcase.styleName = '';
  // `showcase` only. `solo-menu` says WHICH menu is on screen, not whether the
  // diorama is running, and this function does not own it - it is added once
  // when the solo menu opens. Removing it here meant changing the look (which
  // restarts the diorama through openShowcase) dropped it for good, and the
  // rule that hides the menu's own small header needs BOTH classes:
  //   #start-panel.showcase.solo-menu #start-title { display: none; }
  // So from the first style change onward the player saw the game's name
  // twice - the big card, and the small header underneath it.
  document.getElementById('start-panel').classList.remove('showcase');
  document.body.classList.remove('showcase', 'war-room');
}

// The room, when there is one. A LAN server may hold the war in a lobby until
// the host starts it; a solo game never has one.
function onLobby(room) {
  state.room = room;
  renderLobbyPanel(state.lobbyPanel, room, state.team);
  // A reopened room covers the ending it follows: the result had its moment.
  document.getElementById('warover-panel').classList.remove('open');
  // The war room gets the shop window too (owner ruling 2026-08-23): the
  // lobby is the longest stare at a standing screen an evening has.
  if (document.getElementById('start-panel').classList.contains('open')) {
    openShowcase(state.styleName);
    document.body.classList.add('war-room');
  } else {
    closeShowcase();
  }
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
    closeShowcase();
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
  collectSignals(message.view);
  // The last view, for probes. It is the same object the renderer is about to
  // draw, so a probe that asserts on it is asserting on what is on screen.
  window.__lastView = message.view;
  // ?weather=<tick> holds the sky at one moment (a debug affordance, and
  // how the probes photograph a storm). Without it the sky follows the war.
  //
  // It overrides the RENDER, not the war: the engine is still at its own
  // tick, so figures the simulation computed from the real weather - the
  // carrier's `radarNow`, the boats' speed - stay as the war left them. A
  // frozen storm therefore shows its sea state but not its radar loss, and
  // that is correct rather than a bug worth chasing.
  if (state.weatherTick >= 0 && message.view !== undefined) {
    message.view.weather = weatherAt(message.view.seed, state.weatherTick);
  }
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
  if (state.selectedUnitId === -1 && selectableUnits().length > 0) cycleSelection();
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
  // The marker follows the selection - hidden while piloting, when the
  // camera itself is the answer to "which one is mine".
  state.scene3d.selectedUnitId = state.piloting ? -1 : state.selectedUnitId;
  const eyeUp = ownDroneUp();
  state.scene3d.droneUnitId = eyeUp === undefined ? -1 : eyeUp.id;
  if (state.scene3d.droneView && eyeUp === undefined) {
    // The eye is gone: the picture goes with it.
    state.scene3d.droneView = false;
  }
  const droneInfo = document.getElementById('drone-info');
  if (eyeUp !== undefined && state.scene3d.droneView) {
    const own = ownCarrierOf(state.view);
    droneInfo.textContent = state.t('drone.info', {
      rounds: own === undefined ? 0 : own.hammerRounds,
      seconds: Math.max(0, Math.round(eyeUp.fuel / (state.view.params.tickHz || 20))),
    });
    droneInfo.classList.add('on');
  } else {
    droneInfo.classList.remove('on');
  }
  renderView(state.scene3d, state.view, deltaSeconds, state.podBuildTicks);
  updateCameraTabs();
  updateActionButtons();
  // AFTER the buttons: their enabled/disabled set changes what the columns
  // contain, which changes how they wrap, which changes how wide they are -
  // and an open console positions itself between them. Both of these were
  // wired only to `resize`, which fires while the MENU is up: at that point
  // the action columns do not exist yet, syncColumnWidths returned early, and
  // the custom properties stayed unset for the whole war. Their own comments
  // always said "free in the frame loop"; now they are in it.
  syncBarHeight();
  syncColumnWidths();
  setHud(state.hud, 'tick', state.view.tick);
  setHud(state.hud, 'hash', state.stateHash === '' ? '-' : state.stateHash);
  updateCarrierHud(state.hud, ownCarrierOf(state.view), state.view.params);
  setHud(state.hud, 'hangar', describeHangar(state.t, state.view.units, state.view.team));
  setHud(state.hud, 'unit', describeUnit(state.t, selectedUnit(), state.view.params));
  drawPanel(deltaSeconds);
  // The link warning (item 1): the moment the picture starts to fade, say
  // so - the pilot is busy flying and the leash gives no second chance.
  const flown = state.piloting ? selectedUnit() : undefined;
  const link = flown === undefined ? 0 : (flown.telemetry ?? 0);
  if (link !== state.lastTelemetry) {
    state.lastTelemetry = link;
    if (link === 1) setHud(state.hud, 'status', state.t('status.telemetryWeak'));
  }
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
  renderSquadronPanel(state.squadron);
  renderSignals();
  // The console's tab bar is always on screen now (playtest 2026-08-28), so
  // it is kept current every frame rather than only when the console opens.
  // It rebuilds only when something it shows has actually changed.
  renderConsoleTabs();
  updateLocation();
  updateAlwaysOn();
  renderChart(state.chart, state.view, ownTeamColour());
  // The ending screen is the one thing nothing may cover, and there is
  // nothing left to manage once the war is over (docs/06: after the war ends
  // nothing new is decided). Shut the console on the tick the phase flips.
  if (state.view !== undefined && state.view.phase !== 0
    && document.getElementById('console').classList.contains('open')) {
    showConsoleNone();
  }
  // A war that is OVER is not a war to come back to. The autosave stops at
  // the whistle (it refuses a finished war), so without this the last record
  // would sit in storage offering to "resume" something already won - which
  // resumes to the tick before the ending and then ends again immediately.
  if (state.view !== undefined && state.view.phase !== 0 && !state.soloSaveCleared) {
    state.soloSaveCleared = true;
    clearSoloSave(window.localStorage);
  }
  updateWaroverPanel(state.warover, state.view);
  updateWeaponGroup();
  updateSight();
}

function ownTeamColour() {
  if (state.view === undefined) return '#ffe08a';
  const hex = TEAM_COLOURS[state.view.team >= 0 ? state.view.team % TEAM_COLOURS.length : 0];
  return `#${hex.toString(16).padStart(6, '0')}`;
}

// The 1988 constants (second source review): the score is ALWAYS on screen,
// the pause state is a lit button, the autopilot state is a lit A, and the
// hulls that are out stand as chips - what exists, which one is named.
const unitChips = { signature: '', chips: [] };

const PRESET_KEYS = ['preset.balanced', 'preset.scout', 'preset.bomber', 'preset.interceptor'];

function updateAlwaysOn() {
  if (state.view === undefined) return;
  const shipNow = ownCarrierOf(state.view);
  const presetChip = document.getElementById('preset-chip');
  if (presetChip !== null && shipNow !== undefined) {
    const cap = presetChip.querySelector('.k');
    const want = state.t(PRESET_KEYS[shipNow.mantaPreset ?? 0]);
    if (cap.textContent !== want) cap.textContent = want;
  }
  document.getElementById('score-strip').textContent = describeScore(state.t, state.view);
  document.getElementById('pause-button').classList.toggle('on', state.speed === 0);
  const own = ownCarrierOf(state.view);
  document.getElementById('auto-chip').classList.toggle('on',
    own !== undefined && own.courseX >= 0);

  const out = afloatUnits();
  const signature = out.map((unit) => `${unit.id}:${unit.kind}:${unit.state}`).join(',');
  if (signature !== unitChips.signature) {
    unitChips.signature = signature;
    unitChips.chips = [];
    const root = document.getElementById('unit-chips');
    root.textContent = '';
    for (const unit of out) {
      const chip = document.createElement('div');
      chip.className = 'unit-chip';
      const letter = ['M', 'W', 'L', 'D', 'Y', 'I'][unit.kind] ?? '?';
      const pod = unit.commPod === 1 ? '\u25CE' : ''; // the comm-pod airframe
      chip.textContent = `${letter}${unit.id}${pod}${unit.state === 4 ? '\u2193' : ''}`;
      const flyable = unit.kind === KIND_MANTA || unit.kind === KIND_WALRUS;
      if (flyable) {
        chip.addEventListener('pointerdown', (event) => {
          event.preventDefault();
          state.selectedUnitId = unit.id;
          if (state.piloting) state.scene3d.followUnitId = unit.id;
        });
      } else {
        // Shown, because knowing the boat is out matters; not selectable,
        // because naming it would only misdirect the next click.
        chip.style.cursor = 'default';
        chip.style.opacity = '0.6';
      }
      attachTip(chip, state.t('tip.unitChip'));
      root.append(chip);
      unitChips.chips.push({ id: unit.id, chip: chip });
    }
  }
  for (const entry of unitChips.chips) {
    entry.chip.classList.toggle('on', entry.id === state.selectedUnitId);
  }
}

// The location status readout, as the original's bottom-centre display:
// position in kilometres from the chart's south-west corner, bearing in
// degrees, and the island the subject stands off - named, because a name is
// what "in range of" needs to mean anything.
function updateLocation() {
  const line = document.getElementById('location');
  if (state.view === undefined) { line.textContent = ''; return; }
  const subject = (state.piloting ? selectedUnit() : undefined) ?? ownCarrierOf(state.view);
  if (subject === undefined) { line.textContent = ''; return; }
  const perKm = state.view.params.unitsPerMetre * 1000;
  const x = (Math.round((subject.x * 10) / perKm) / 10).toFixed(1);
  const y = (Math.round((subject.y * 10) / perKm) / 10).toFixed(1);
  let near = '';
  for (const island of state.view.islands) {
    if (dist2D(subject.x, subject.y, island.x, island.y)
      < island.radius + 2500 * state.view.params.unitsPerMetre) {
      near = ` · ${islandName(island)}`;
      break;
    }
  }
  const bearing = String(degreesFrom(subject.heading)).padStart(3, '0');
  line.textContent = `X ${x} Y ${y} km · ${bearing}°${near}`;
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

// How full the selected weapon's magazine is, against the ruleset's figure -
// the view carries rounds, not capacities, so the client keeps the table.
function magazinePermil(unit) {
  const arm = (unit.arms ?? []).find((a) => a.w === unit.weapon);
  if (arm === undefined) return 0;
  const magazine = state.magazines[arm.w] ?? 0;
  if (magazine <= 0) return arm.n > 0 ? 1000 : 0;
  return Math.min(1000, Math.round((arm.n * 1000) / magazine));
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
  // At the controls of a craft, the panel is the CRAFT's (playtest ruling
  // 2026-08-24): flight or drive instruments, the scope centred on the hull
  // you are flying, its condition and the way home - not the ship's helm.
  if (state.piloting && unit !== undefined) {
    window.__panelMode = 'flight';
    const flying = unit.kind === KIND_MANTA;
    const home = own === undefined
      ? ''
      : `${(Math.round(dist2D(unit.x, unit.y, own.x, own.y) / params.unitsPerMetre / 100) / 10)} km`;
    drawFlightInstruments(state.panel, state.view, unit, {
      conditions: conditionsLine(state, state.view === undefined ? undefined : state.view.own),
      helmTitle: state.t(flying ? 'panel.flight' : 'panel.drive'),
      scopeTitle: state.t('panel.scope'),
      scopeRange: state.scopeRange * params.unitsPerMetre,
      scopeLabel: `${state.scopeRange >= 1000 ? `${state.scopeRange / 1000}k` : state.scopeRange} m`,
      craftTitle: state.t(flying ? 'unit.manta' : 'unit.walrus').toUpperCase(),
      throttle: state.t('hud.throttle'),
      speed: state.t('hud.speed'),
      speedFigure: `${knotsFrom(unit.speed, params.unitsPerMetre, params.tickHz)} ${state.t('hud.knots')}`,
      fuel: state.t('hud.fuel'),
      fuelFigure: unit.fuelCapacity <= 0
        ? ''
        : `${Math.round((unit.fuel * 100) / unit.fuelCapacity)}%`,
      rudderActive: state.rudder,
      hull: state.t('hud.hull'),
      hullFigure: unit.maxHp > 0 ? `${Math.round((unit.hp * 100) / unit.maxHp)}%` : '',
      secondLabel: state.t(flying ? 'panel.alt' : 'panel.ammo'),
      secondPermil: flying
        ? (unit.ceiling > 0 ? Math.round((unit.z * 1000) / unit.ceiling) : 0)
        : magazinePermil(unit),
      secondFigure: flying
        ? `${Math.round(unit.z / params.unitsPerMetre)} m`
        : String(roundsOf(unit)),
      weapon: weaponName(state.t, unit),
      tally: String(roundsOf(unit)),
      homeLabel: state.t('panel.toCarrier'),
      homeFigure: home,
    }, deltaSeconds, state.instrumentColours);
    return;
  }
  window.__panelMode = 'ship';
  warnOnFuel(own);
  // At the gun, the right box becomes the gunnery console (docs/10 gap 5).
  const atTheGun = state.scene3d !== undefined && state.scene3d.gunsight === true;
  const aimBam = gunBearing(own);
  drawInstruments(state.panel, state.view, own, {
    conditions: conditionsLine(state, own),
    gunnery: atTheGun ? 1 : 0,
    gunTitle: state.t('panel.gunnery'),
    aimBam: aimBam,
    bearing: `${String(Math.round((aimBam * 360) / 65536)).padStart(3, '0')}°`,
    temp: state.t('panel.temp'),
    tempFigure: own === undefined || own.heatMax <= 0
      ? ''
      : `${Math.round((own.heat * 100) / own.heatMax)}%`,
    overheated: state.t('panel.overheated'),
    weaponState: own !== undefined && own.overheated === 1
      ? state.t('panel.gunHot')
      : state.t('panel.gunReady'),
    mountState: own !== undefined && own.radar > 0
      ? state.t('panel.mountReady')
      : state.t('panel.mountOut'),
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

// Where the mount is looking, in engine BAM. The ship's laser does not slew
// mechanically in our model - it fires at what it is pointed at - so the
// honest bearing is the DESIGNATED target when there is one, and the
// boresight otherwise. Drawn ship-relative on the console, which is why a
// target abeam swings the line out to the beam exactly as the original's
// turret diagram did.
// What the weather is costing the ship, in the two ways it can (rulings of
// 2026-08-26): the sea that slows the boats, and the rain that shortens the
// radar picture. Empty on a calm clear day, so the line only appears when it
// has something to say.
const SEA_WORDS = ['sea.calm', 'sea.slight', 'sea.moderate', 'sea.rough', 'sea.high', 'sea.gale'];

// Fuel became a real constraint on 2026-08-27 (ruling Q6b: a full bunker is
// about an hour of hard steaming, where before you could cross a whole war
// flat out and finish with a fifth left). A cost the player only discovers by
// running dry is not a decision, it is an ambush - and the engine's only fuel
// event fires at ZERO, which is far too late to act on.
//
// So the ship says so on the way down, once per threshold crossed. Rising back
// through a mark re-arms it, because a lighter's delivery is exactly the news
// that makes the next warning worth hearing.
const FUEL_MARKS = [
  { permil: 250, key: 'status.fuelLow' },
  { permil: 100, key: 'status.fuelCritical' },
];

function warnOnFuel(own) {
  if (own === undefined || own.fuelCapacity <= 0) return;
  const permil = Math.floor((own.fuel * 1000) / own.fuelCapacity);
  for (const mark of FUEL_MARKS) {
    const below = permil <= mark.permil;
    if (below && state.fuelWarned[mark.permil] !== 1) {
      state.fuelWarned[mark.permil] = 1;
      setHud(state.hud, 'status', state.t(mark.key, { percent: Math.round(permil / 10) }));
    } else if (!below) {
      state.fuelWarned[mark.permil] = 0;
    }
  }
}

function conditionsLine(state, own) {
  const view = state.view;
  if (view === undefined || view.weather === undefined) return '';
  const sea = view.weather.windPermil;
  const parts = [];
  if (sea >= 150) {
    const step = Math.min(SEA_WORDS.length - 1, Math.floor(sea / 175));
    parts.push(`${state.t('hud.sea')} ${state.t(SEA_WORDS[step])}`);
  }
  // radarNow is what this set actually reaches right now; radar is what it
  // reaches in fair weather. The player is told the loss, not the number,
  // because the loss is the part that changes their mind.
  if (own !== undefined && own.radar > 0 && own.radarNow >= 0 && own.radarNow < own.radar) {
    const lost = Math.round(100 - (own.radarNow * 100) / own.radar);
    if (lost >= 1) parts.push(`${state.t('hud.radarLoss')} -${lost}%`);
  }
  return parts.join('  ');
}

function gunBearing(own) {
  if (own === undefined) return 0;
  const view = state.view;
  if (view !== undefined && own.aimKind >= 0 && own.aimId >= 0) {
    // A complete kind switch, not an else: units, turrets and carriers have
    // separate id sequences that all start at zero, so a kind this does not
    // know must find NOTHING rather than the wrong entity of another list.
    // Validation bounds aimKind to unit-or-carrier today; that is exactly
    // the sort of bound that gets widened.
    let target;
    if (own.aimKind === 1) target = view.carriers.find((c) => c.id === own.aimId);
    else if (own.aimKind === 0) target = view.units.find((u) => u.id === own.aimId);
    if (target !== undefined) {
      const bam = Math.atan2(target.y - own.y, target.x - own.x) * (65536 / (Math.PI * 2));
      return ((Math.round(bam - own.heading) % 65536) + 65536) % 65536;
    }
  }
  // No designation: down the boresight, which is astern in rear view.
  return state.scene3d !== undefined && state.scene3d.rearView === true ? 32768 : 0;
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
  // `help.console` replaces the lone `help.damage` line: the list named Z and
  // never mentioned J or Q at all, so the squadron console and the
  // quartermaster - two of the biggest screens in the game - were reachable
  // only by someone who had read the docs.
  const lines = ['help.helm', 'help.units', 'help.orders', 'help.supply', 'help.weapons', 'help.targeting', 'help.island',
    'help.console', 'help.scope', 'help.time', 'help.extras', 'help.drone'];
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
  document.getElementById('title-card').textContent = state.t('start.title');
  document.getElementById('rotate-gate').textContent = state.t('touch.rotate');
  renderHelp(state.t);
  document.getElementById('help-button').addEventListener('click', toggleHelp);
  document.getElementById('debug-button').addEventListener('click', toggleDebug);
  document.getElementById('msg-button').addEventListener('click', () => showConsole('log'));
  document.getElementById('log-title').textContent = state.t('log.title');
  attachTip(document.getElementById('msg-button'), state.t('tip.log'));
  buildActionColumns(state.t);
  buildCameraTabs(state.t);
  updateCameraTabs();
  setHud(state.hud, 'status', state.t('status.loading'));

  const rules = await fetchRules();

  // A URL that already says what to run is somebody who has chosen - a shared
  // link, a probe, the smoke gate. Everybody else gets the menu.
  let seed = Number(params.get('seed') ?? 20260818);
  let startSpeed = START_SPEED;
  let styleName = params.get('style');

  // Resuming skips the menu and takes the war's OWN choices back: the rules
  // must be rebuilt exactly as they were, or the replay hash will not match
  // and the resume is refused for a reason that is really our own doing.
  const resumeRecord = params.get('resume') === 'local'
    ? readSoloSave(window.localStorage)
    : 0;
  if (resumeRecord !== 0) {
    seed = resumeRecord.save.seed;
    const saved = resumeRecord.save.options;
    if (saved !== 0 && saved !== undefined) {
      const extras = applyChoices(rules, saved);
      startSpeed = extras.speed;
      state.speed = startSpeed;
      if (styleName === null) styleName = extras.style;
    }
    state.savedChoices = saved;
  }

  // Every menu row is also a query parameter, so one link is a whole game
  // (2026-08-30). With the menu shown they become its starting position; with
  // the menu skipped they ARE the game. A value the menu does not offer is
  // refused rather than clamped, and said out loud - two friends opening the
  // same link must get the same war or the link is worse than useless.
  const rejected = [];
  const urlChoices = choicesFromParams(params, rejected);
  const namedByUrl = namedInParams(params);

  if (!params.has('mode') && resumeRecord === 0) {
    // The shop window: a staged island assault behind the menu, torn down
    // whole before the war claims the screen (see openShowcase).
    openShowcase(styleName);
    document.getElementById('start-panel').classList.add('solo-menu');
    const panel = createStartPanel(state.t, seedFromClock());
    // A link that named settings opens the menu ON them, so the recipient can
    // see what they were sent and change their mind.
    panel.choices = urlChoices;
    if (params.has('seed')) panel.seed = seed;
    // The war you walked away from, offered back at the top of the menu.
    const waiting = readSoloSave(window.localStorage);
    if (waiting !== 0) {
      panel.resume = { save: waiting.save, ago: agoText(waiting.savedAt, Date.now()) };
      panel.onDiscard = () => clearSoloSave(window.localStorage);
    }
    // The look row previews live - unless the URL already dictated a style,
    // in which case the URL wins at BEGIN and the preview would be a lie.
    if (styleName === null) {
      panel.onStyle = (name) => {
        applyStyleToDocument(styleFor(resolveStyle(name)), document.documentElement);
        openShowcase(name);
      };
    }
    const chosen = await showStartPanel(panel);
    closeShowcase();
    // The solo menu is done with, so its marker goes too - here, where it was
    // added, and not inside closeShowcase, which restarts the diorama on every
    // style change. Leaving it set would let it meet a later `showcase` (the
    // war room takes the diorama as well) and hide THAT header, which is the
    // one carrying the join code.
    document.getElementById('start-panel').classList.remove('solo-menu');
    seed = chosen.seed;
    const extras = applyChoices(rules, chosen.choices);
    startSpeed = extras.speed;
    state.speed = startSpeed;
    if (styleName === null) styleName = extras.style;
    // Kept so a solo war can be rebuilt exactly as it was started.
    state.savedChoices = chosen.choices;
  }

  // Menu skipped: the link's own settings are the war. Applied here so
  // `?mode=solo&islands=16&start=2` means what it plainly says - before this
  // it meant nothing at all, and the recipient of a carefully written link
  // got the defaults.
  if (params.has('mode') && resumeRecord === 0 && namedByUrl.length > 0) {
    const extras = applyChoices(rules, urlChoices);
    startSpeed = params.has('speed') ? startSpeed : extras.speed;
    state.speed = startSpeed;
    if (styleName === null) styleName = extras.style;
    state.savedChoices = urlChoices;
  }

  state.podBuildTicks = rules.rules.podBuildTicks;
  state.buildCosts = rules.economy.builds.map((row) => row.materials);
  state.magazines = (rules.weapons?.list ?? []).map((weapon) => weapon.magazine ?? 0);
  state.weaponWeights = (rules.weapons?.list ?? []).map((w) => w.weightGrams ?? 0);
  // The two boards get a context rather than the client: a translator, the
  // current view, the seat's ship, prices, and a way to send a command.
  const panelContext = {
    t: (key, vars) => state.t(key, vars),
    view: () => state.view,
    ownCarrier: () => (state.view === undefined ? undefined : ownCarrierOf(state.view)),
    carrierId: () => state.carrierId,
    buildCost: (what) => state.buildCosts[what] ?? 0,
    send: (message) => state.transport.send(message),
    // The weapon table comes from the RULESET the server served, not from
    // the view: it is the same for every hull and never changes in a war.
    weaponLabel: (id) => weaponName(state.t, { weapon: id }).toUpperCase(),
    weaponWeight: (id) => state.weaponWeights[id] ?? 0,
    weaponMagazine: (id) => state.magazines[id] ?? 0,
  };
  state.damage = createDamagePanel(panelContext);
  state.island = createIslandPanel(panelContext);
  state.stores = createStoresPanel(panelContext);
  state.squadron = createSquadronPanel(panelContext);
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
  state.chart = createChartPanel({
    t: (key, vars) => state.t(key, vars),
    onPoint: (point) => handleWorldPoint(point),
    colours: () => state.instrumentColours,
    // Whose course to draw: the hull under the pointer, if one is selected.
    routeSubject: () => selectedUnit(),
  });
  // RESOURCES (docs/10 gap 5), the original's own button on the same map.
  const resBtn = document.getElementById('chart-resources');
  resBtn.textContent = state.t('chart.resources');
  resBtn.addEventListener('click', () => {
    state.chart.resources = !state.chart.resources;
    resBtn.classList.toggle('on', state.chart.resources);
  });
  attachTip(resBtn, state.t('tip.resources'));
  const netBtn = document.getElementById('chart-network');
  netBtn.textContent = state.t('chart.network');
  netBtn.addEventListener('click', () => {
    state.chart.network = !state.chart.network;
    netBtn.classList.toggle('on', state.chart.network);
  });
  // PROG and LAY (ruled 2026-08-25), the 1988 map's own pair: PROG turns
  // taps into legs, LAY sends the course. Whoever is selected gets it -
  // a Manta, a Walrus, or the ship when nothing is.
  const progBtn = document.getElementById('chart-prog');
  progBtn.textContent = state.t('chart.prog');
  progBtn.addEventListener('click', () => {
    state.chart.prog = !state.chart.prog;
    progBtn.classList.toggle('on', state.chart.prog);
    if (!state.chart.prog) state.chart.legs = [];
    updateChartButtons();
  });
  attachTip(progBtn, state.t('tip.prog'));
  const layBtn = document.getElementById('chart-lay');
  layBtn.textContent = state.t('chart.lay');
  layBtn.addEventListener('click', () => {
    const legs = state.chart.legs;
    if (legs.length === 0) return;
    const points = [];
    for (const leg of legs) points.push(leg.x, leg.y);
    const unit = selectedUnit();
    if (unit !== undefined) state.transport.send({ type: 'set_route', unitId: unit.id, points: points });
    else if (state.carrierId >= 0) {
      state.transport.send({ type: 'set_route', carrierId: state.carrierId, points: points });
    }
    state.chart.legs = [];
    state.chart.prog = false;
    progBtn.classList.remove('on');
    updateChartButtons();
  });
  attachTip(layBtn, state.t('tip.lay'));
  // PROG says WHOSE course it is laying (playtest 2026-08-28). The button
  // routes to the selected craft if there is one and to the ship otherwise,
  // which is right - but it never said so, so a player with nothing selected
  // laid four waypoints, watched the carrier take them, and reasonably
  // concluded that plotting a course for a Manta did not work. The subject
  // is now on the button itself, where the decision is made.
  function progSubject() {
    const unit = selectedUnit();
    if (unit === undefined) return state.t('chart.ship');
    const letter = ['M', 'W', 'L', 'D', 'Y', 'I'][unit.kind] ?? '?';
    return `${letter}${unit.id}`;
  }

  function updateChartButtons() {
    layBtn.classList.toggle('off', state.chart.legs.length === 0);
    const who = progSubject();
    const wanted = state.t('chart.progFor', { who: who });
    if (progBtn.textContent !== wanted) progBtn.textContent = wanted;
  }
  state.updateChartButtons = updateChartButtons;
  updateChartButtons();

  const clearBtn = document.getElementById('chart-clear');
  clearBtn.textContent = state.t('chart.clear');
  clearBtn.addEventListener('click', () => {
    // A course being laid is thrown away first; only then does CLEAR reach
    // the standing one.
    if (state.chart.legs.length > 0) {
      state.chart.legs = [];
      updateChartButtons();
      return;
    }
    const unit = selectedUnit();
    if (unit !== undefined) {
      state.transport.send({ type: 'set_route', unitId: unit.id, points: [] });
      return;
    }
    if (state.carrierId < 0) return;
    state.transport.send({ type: 'set_route', carrierId: state.carrierId, points: [] });
    state.transport.send({ type: 'set_course', carrierId: state.carrierId, x: -1, y: -1 });
  });
  const fitBtn = document.getElementById('chart-fit');
  fitBtn.textContent = state.t('chart.fit');
  fitBtn.addEventListener('click', () => {
    if (state.view !== undefined) fitChart(state.chart, state.view);
  });
  const pauseButton = document.getElementById('pause-button');
  pauseButton.textContent = state.t('hud.pause');
  pauseButton.addEventListener('click', togglePause);
  attachTip(pauseButton, state.t('tip.pause'));
  const autoChip = document.getElementById('auto-chip');
  autoChip.addEventListener('click', () => {
    if (!autoChip.classList.contains('on') || state.carrierId < 0) return;
    state.transport.send({ type: 'set_course', carrierId: state.carrierId, x: -1, y: -1 });
  });
  attachTip(autoChip, state.t('tip.auto'));
  const diag = getGraphicsDiagnostics();
  const override = params.get('graphics') ?? readOverride(window.localStorage);
  const resolved = resolveGraphics(suggestGraphicsLevel(diag), override);
  const preset = presetFor(resolved.level);
  setHud(state.hud, 'graphics', `${preset.label} (${resolved.source})`);
  document.getElementById('gpu').textContent = describeGpu(diag);

  const style = styleFor(resolveStyle(styleName));
  state.styleName = resolveStyle(styleName);
  applyStyleToDocument(style, document.documentElement);
  setHud(state.hud, 'graphics', `${preset.label} / ${style.label} (${resolved.source})`);

  // The map grows with the island count, so the ocean plane, the sun's aim and
  // the sea grid have to use the SCALED size - the base size leaves the far
  // corners of a big archipelago outside the water.
  const sizeMetres = worldSizeMetres(rules.world);
  // SAY WHICH TIER YOU ARE ON, permanently, and say it loudest when it is
  // costing you something. A playtester on `?style=modern` asked why there
  // were no waves: the weather, the mirror sea and the swell are gated on
  // `physicalEffects`, which only HIGH sets, and choosing the modern LOOK does
  // not choose the tier that pays for it. Nothing on screen said so - the tier
  // lived in the DBG strip, which is hidden by default - and a transient
  // status line was no good either, because "connected" arrives a moment
  // later and takes it (playtest 2026-08-29).
  //
  // It is also the clickable G the controls audit had exempted. The exemption
  // was defensible when the tier was a setting nobody needed mid-war; it stops
  // being defensible the moment the tier decides whether there is weather.
  const wantsMore = style.physicalSky === true && preset.physicalEffects !== true;
  const tierChip = document.getElementById('tier-chip');
  if (tierChip !== null) {
    tierChip.textContent = `${style.label} · ${preset.label}`;
    tierChip.classList.toggle('short', wantsMore);
    attachTip(tierChip, state.t(wantsMore ? 'tip.needHigh' : 'tip.tier'));
    // Changing tier RELOADS THE PAGE - a preset changes how the renderer is
    // constructed, so it cannot be swapped in place. In a LAN war the server
    // holds the war and a reload just reconnects; in SOLO the engine runs in
    // this tab, so a reload throws the war away.
    //
    // That was already true of the G key, and G was obscure enough that
    // nobody hit it. Putting a button on it beside PAUSE - and then telling
    // the playtester to press it - turns a footgun nobody found into one
    // they will. So in solo, mid-war, it arms first and fires on the second
    // click, the same idiom the game already uses for surrender.
    tierChip.addEventListener('click', () => {
      // No arming any more, and no warning: since 2026-08-30 a solo war is
      // written down and resumed across the reload, so this costs a moment of
      // black screen rather than the evening. The double-click guard was the
      // right answer to a war that could be lost; the better answer was to
      // stop losing it.
      cycleGraphics(resolved.level);
    });
  }

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
    if (island !== undefined) showConsole('island');
  };
  // Render probes reach the scene graph through this; nothing in the game uses
  // it, and it holds no state the client does not already own.
  window.__scene3d = state.scene3d;
  // Probes photograph states a live war takes hours to reach - a finished war,
  // a scope full of remembered ghosts - by pausing and swapping the view. The
  // next real snapshot overwrites it, which is why the probe pauses first.
  window.__debugView = (view) => { state.view = view; };
  resize(state.scene3d);
  window.addEventListener('resize', () => {
    // The stylesheet may have chosen a different panel height for the new
    // shape, and the instruments cache it rather than re-reading style every
    // frame.
    forgetPanelHeight();
    syncBarHeight();
    syncColumnWidths();
    resize(state.scene3d);
  });

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
    // A solo war saves itself, and comes back if asked (2026-08-30). The
    // record is the ordinary save format, so the hash check refuses one the
    // rules have moved underneath rather than resuming a subtly different
    // war - and a refusal says so and sails a fresh one rather than leaving
    // the player at a blank screen.
    let resumed = 0;
    if (resumeRecord !== 0) {
      const record = resumeRecord;
      {
        const problem = { reason: '' };
        const state0 = replayLog(record.save, rules, problem);
        if (state0 === -1) {
          setHud(state.hud, 'status', state.t('status.resumeRefused', {
            why: problem.reason,
          }));
          clearSoloSave(window.localStorage);
        } else {
          resumed = gameFromState(state0, record.save.commandLog);
          setHud(state.hud, 'status', state.t('status.resumed', { tick: record.save.tick }));
        }
      }
    }
    state.transport = createLocalTransport(seed, rules, SEAT, startSpeed, resumed);
    startSoloAutosave(seed, style);
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
  // Said AFTER the transport has settled: "connected" arrives a moment into
  // the boot and takes the status line with it, which is how the tier hint
  // was lost a day ago. This is the same trap, so it gets the same answer -
  // say it once the noisy part of startup is over.
  if (rejected.length > 0) {
    window.setTimeout(() => {
      setHud(state.hud, 'status', state.t('status.linkRefused', { what: rejected.join(' ') }));
    }, 1200);
  }

  window.requestAnimationFrame(frame);
}

main().catch((error) => {
  const hudRoot = document.getElementById('hud');
  if (hudRoot) hudRoot.textContent = state.t('status.startFailed', { reason: error.message });
  throw error;
});
