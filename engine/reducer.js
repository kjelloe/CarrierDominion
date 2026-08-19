// engine/reducer.js - the whole simulation entry point: apply(state, command).
//
// Pure: the input state is never mutated, the same (state, command) pair always
// returns the same next state, and nothing here reads a clock, a file, or a
// socket. Every tick of every war - solo in the browser, LAN on the server,
// headless in a sim - goes through this function and no other.

import { copyState } from './state.js';
import { PHASE_RUNNING } from './victory.js';
import {
  CMD_ADVANCE_TICK,
  CMD_DEPLOY_POD,
  CMD_FIRE_UNIT,
  CMD_LAUNCH_UNIT,
  CMD_ORDER_UNIT_ATTACK,
  CMD_ORDER_UNIT_MOVE,
  CMD_RECALL_UNIT,
  CMD_RELEASE_CONTROL,
  CMD_SET_HEADING,
  CMD_SET_RUDDER,
  CMD_SET_THROTTLE,
  CMD_SELECT_WEAPON,
  CMD_SET_CARRIER_AIM,
  CMD_SET_ISLAND_ROLE,
  CMD_BUILD_ON_ISLAND,
  CMD_SET_REPAIR_PRIORITY,
  CMD_SET_STOCKPILE,
  CMD_SET_SUPPLY_RUN,
  CMD_SET_UNIT_HELM,
  CMD_TAKE_CONTROL,
  HEADING_MANUAL,
  validateCommand,
} from './commands.js';
import {
  EVT_COMMAND_REJECTED,
  EVT_HEADING_SET,
  EVT_RUDDER_SET,
  EVT_THROTTLE_SET,
  EVT_UNIT_CONTROL,
  EVT_UNIT_LAUNCHED,
  EVT_UNIT_ORDERED,
  EVT_STOCKPILE_SET,
  EVT_SUPPLY_RUN,
  pushEvent,
} from './events.js';
import { stepCarriers } from './carrier.js';
import { checkDeploy, deployPod, stepCapture } from './capture.js';
import { stepAi } from './ai_carrier.js';
import { checkVictory } from './victory.js';
import { stepEconomy, teamById } from './economy.js';
import { stepSupply } from './supply.js';
import { stepRepair } from './repair.js';
import { stepScore } from './score.js';
import { setRole, startBuild, stepBuild } from './island.js';
import { setPriority } from './damage.js';
import { stepUnits } from './fleet.js';
import { fireUnit, selectWeapon, stepWeapons } from './weapons.js';
import { launchUnit, orderReturn, readyToLaunch } from './hangar.js';
import {
  ORDER_ATTACK,
  ORDER_MOVE,
  UNIT_ACTIVE,
  UNIT_RETURNING,
  findUnit,
} from './units.js';
import { designated } from './targeting.js';

function findCarrier(state, carrierId) {
  for (let i = 0; i < state.carriers.length; i++) {
    if (state.carriers[i].id === carrierId) return state.carriers[i];
  }
  return -1;
}

function reject(next) {
  pushEvent(next.events, EVT_COMMAND_REJECTED, 0, 0, 0);
  return next;
}

function applyThrottle(next, command) {
  const carrier = findCarrier(next, command.carrierId);
  if (carrier === -1) return reject(next);
  carrier.throttle = command.throttle;
  pushEvent(next.events, EVT_THROTTLE_SET, carrier.id, carrier.throttle, 0);
  return next;
}

function applyRudder(next, command) {
  const carrier = findCarrier(next, command.carrierId);
  if (carrier === -1) return reject(next);
  carrier.rudder = command.rudder;
  // Touching the wheel drops any heading hold; the helm is one authority.
  carrier.headingHold = HEADING_MANUAL;
  pushEvent(next.events, EVT_RUDDER_SET, carrier.id, carrier.rudder, 0);
  return next;
}

function applyHeading(next, command) {
  const carrier = findCarrier(next, command.carrierId);
  if (carrier === -1) return reject(next);
  carrier.headingHold = command.heading;
  carrier.rudder = 0;
  pushEvent(next.events, EVT_HEADING_SET, carrier.id, carrier.headingHold, 0);
  return next;
}

function applyLaunch(next, command) {
  const carrier = findCarrier(next, command.carrierId);
  if (carrier === -1) return reject(next);
  const unit = readyToLaunch(next, carrier.id, command.kind);
  if (unit === -1) return reject(next);
  launchUnit(unit, carrier, next.params.deckHeight);
  pushEvent(next.events, EVT_UNIT_LAUNCHED, unit.id, unit.team, unit.kind);
  return next;
}

function applyRecall(next, command) {
  const unit = findUnit(next, command.unitId);
  if (unit === -1) return reject(next);
  if (unit.state !== UNIT_ACTIVE && unit.state !== UNIT_RETURNING) return reject(next);
  orderReturn(unit);
  pushEvent(next.events, EVT_UNIT_ORDERED, unit.id, unit.order, 0);
  return next;
}

function applyUnitMove(next, command) {
  const unit = findUnit(next, command.unitId);
  if (unit === -1) return reject(next);
  if (unit.state !== UNIT_ACTIVE && unit.state !== UNIT_RETURNING) return reject(next);
  if (command.x > next.params.sizeUnits || command.y > next.params.sizeUnits) return reject(next);
  unit.state = UNIT_ACTIVE;
  unit.order = ORDER_MOVE;
  unit.control = -1;
  unit.targetX = command.x;
  unit.targetY = command.y;
  pushEvent(next.events, EVT_UNIT_ORDERED, unit.id, unit.order, 0);
  return next;
}

// The autopilot Attack order: you designate, it closes and engages. Refused
// for a target that is already gone, so a stale click does not send an aircraft
// to an empty patch of sea.
function applyUnitAttack(next, command) {
  const unit = findUnit(next, command.unitId);
  if (unit === -1) return reject(next);
  if (unit.state !== UNIT_ACTIVE && unit.state !== UNIT_RETURNING) return reject(next);
  const target = designated(next, command.targetKind, command.targetId);
  if (target === -1) return reject(next);
  unit.state = UNIT_ACTIVE;
  unit.order = ORDER_ATTACK;
  unit.control = -1;
  unit.orderTargetKind = command.targetKind;
  unit.orderTargetId = command.targetId;
  unit.targetX = target.x;
  unit.targetY = target.y;
  pushEvent(next.events, EVT_UNIT_ORDERED, unit.id, unit.order, 0);
  return next;
}

// Pointer mode for the ship's laser. targetKind -1 clears it.
function applyCarrierAim(next, command) {
  const carrier = findCarrier(next, command.carrierId);
  if (carrier === -1) return reject(next);
  if (command.targetKind === -1) {
    carrier.aimKind = -1;
    carrier.aimId = -1;
    return next;
  }
  if (designated(next, command.targetKind, command.targetId) === -1) return reject(next);
  carrier.aimKind = command.targetKind;
  carrier.aimId = command.targetId;
  return next;
}

function applyTakeControl(next, command) {
  const unit = findUnit(next, command.unitId);
  if (unit === -1) return reject(next);
  if (unit.state !== UNIT_ACTIVE && unit.state !== UNIT_RETURNING) return reject(next);
  // One seat per team for now; the seat id IS the team until crews exist.
  unit.control = unit.team;
  unit.state = UNIT_ACTIVE;
  unit.throttle = 100;
  unit.rudder = 0;
  pushEvent(next.events, EVT_UNIT_CONTROL, unit.id, 1, 0);
  return next;
}

function applyReleaseControl(next, command) {
  const unit = findUnit(next, command.unitId);
  if (unit === -1) return reject(next);
  unit.control = -1;
  unit.rudder = 0;
  pushEvent(next.events, EVT_UNIT_CONTROL, unit.id, 0, 0);
  return next;
}

function applyUnitHelm(next, command) {
  const unit = findUnit(next, command.unitId);
  if (unit === -1) return reject(next);
  if (unit.control === -1) return reject(next);
  unit.throttle = command.throttle;
  unit.rudder = command.rudder;
  return next;
}

function findIsland(state, islandId) {
  for (let i = 0; i < state.islands.length; i++) {
    if (state.islands[i].id === islandId) return state.islands[i];
  }
  return -1;
}

// Firing is a command, not a tick effect (ruling #18). A Manta that nobody
// flies is a Manta that never shoots.
function applyFire(next, command) {
  const unit = findUnit(next, command.unitId);
  if (unit === -1) return reject(next);
  if (unit.state !== UNIT_ACTIVE && unit.state !== UNIT_RETURNING) return reject(next);
  fireUnit(next, unit);
  return next;
}

// Weapon select. Free and instant; what it costs is the shot you did not take
// while you were deciding.
function applySelectWeapon(next, command) {
  const unit = findUnit(next, command.unitId);
  if (unit === -1) return reject(next);
  if (selectWeapon(unit, command.weapon) !== 1) return reject(next);
  return next;
}

function applyDeployPod(next, command) {
  const unit = findUnit(next, command.unitId);
  if (unit === -1) return reject(next);
  const island = findIsland(next, command.islandId);
  if (island === -1) return reject(next);
  if (checkDeploy(unit, island, next.params.podRange) !== '') return reject(next);
  deployPod(next, unit, island);
  return next;
}

// What an island is for. Only its owner decides, and only while there is
// nothing built on it (island.js) - once concrete is poured the decision is
// made.
function applyIslandRole(next, command) {
  const carrier = findCarrier(next, command.carrierId);
  if (carrier === -1) return reject(next);
  const island = findIsland(next, command.islandId);
  if (island === -1 || island.owner !== carrier.team) return reject(next);
  if (setRole(next, island, command.role) !== 1) return reject(next);
  return next;
}

// Start a factory, a warehouse, or a turret. Paid for out of the island's own
// materials, and refused when the role does not allow it, the slots are full,
// or the stock is short.
function applyIslandBuild(next, command) {
  const carrier = findCarrier(next, command.carrierId);
  if (carrier === -1) return reject(next);
  const island = findIsland(next, command.islandId);
  if (island === -1 || island.owner !== carrier.team) return reject(next);
  if (startBuild(next, island, command.what, next.economy) !== 1) return reject(next);
  return next;
}

function applySetStockpile(next, command) {
  const carrier = findCarrier(next, command.carrierId);
  if (carrier === -1) return reject(next);
  const island = findIsland(next, command.islandId);
  if (island === -1 || island.owner !== carrier.team) return reject(next);
  const team = teamById(next, carrier.team);
  if (team === -1) return reject(next);
  team.stockpileIsland = island.id;
  pushEvent(next.events, EVT_STOCKPILE_SET, island.id, team.id, 0);
  return next;
}

function applySetSupplyRun(next, command) {
  const carrier = findCarrier(next, command.carrierId);
  if (carrier === -1) return reject(next);
  carrier.supplyRun = command.active;
  pushEvent(next.events, EVT_SUPPLY_RUN, carrier.id, carrier.team, carrier.supplyRun);
  return next;
}

// The damage board: which section the automatic repair system sees to first.
function applyRepairPriority(next, command) {
  const carrier = findCarrier(next, command.carrierId);
  if (carrier === -1) return reject(next);
  if (setPriority(carrier, command.section, command.priority) !== 1) return reject(next);
  return next;
}

function advanceTick(next) {
  // Order is the simulation's contract and part of every hash: the AI decides
  // first (so its orders take effect this tick, not next), then hulls move,
  // then they shoot from where they now are, then pods build, then the war is
  // checked for an ending. A finished war still ticks - the world does not
  // freeze - but nothing new is decided.
  //
  // Weapons go AFTER movement so a shot is fired from the position the shooter
  // reached this tick, and a hull that just closed to weapon range gets to use
  // it. It goes BEFORE capture so a Walrus killed on the beach cannot also
  // plant its pod on the tick it died.
  next.tick = next.tick + 1;
  if (next.phase === PHASE_RUNNING) {
    stepAi(next, next.params.aiCadenceTicks, next.params.aiStandoff);
  }
  stepCarriers(next);
  stepUnits(next);
  stepWeapons(next, next.params.hitRadiusUnit, next.params.hitRadiusCarrier);
  stepCapture(next, next.params.podBuildTicks);
  stepBuild(next);
  stepEconomy(next);
  stepSupply(next);
  // Repairs last: the boat has landed this tick's materials, and the yard
  // spends what is in the store, not what is in the hold.
  stepRepair(next);
  stepScore(next, next.params.pointsPerIsland);
  checkVictory(next, next.params);
  return next;
}

function apply(state, command) {
  const next = copyState(state);
  // Events describe what THIS command caused; the pump concatenates them.
  next.events = [];

  const problem = validateCommand(command);
  if (problem !== '') return reject(next);

  const type = command.type;
  if (type === CMD_ADVANCE_TICK) return advanceTick(next);
  if (type === CMD_SET_THROTTLE) return applyThrottle(next, command);
  if (type === CMD_SET_RUDDER) return applyRudder(next, command);
  if (type === CMD_SET_HEADING) return applyHeading(next, command);
  if (type === CMD_LAUNCH_UNIT) return applyLaunch(next, command);
  if (type === CMD_RECALL_UNIT) return applyRecall(next, command);
  if (type === CMD_ORDER_UNIT_MOVE) return applyUnitMove(next, command);
  if (type === CMD_ORDER_UNIT_ATTACK) return applyUnitAttack(next, command);
  if (type === CMD_SET_CARRIER_AIM) return applyCarrierAim(next, command);
  if (type === CMD_TAKE_CONTROL) return applyTakeControl(next, command);
  if (type === CMD_RELEASE_CONTROL) return applyReleaseControl(next, command);
  if (type === CMD_SET_UNIT_HELM) return applyUnitHelm(next, command);
  if (type === CMD_DEPLOY_POD) return applyDeployPod(next, command);
  if (type === CMD_FIRE_UNIT) return applyFire(next, command);
  if (type === CMD_SELECT_WEAPON) return applySelectWeapon(next, command);
  if (type === CMD_SET_STOCKPILE) return applySetStockpile(next, command);
  if (type === CMD_SET_SUPPLY_RUN) return applySetSupplyRun(next, command);
  if (type === CMD_SET_REPAIR_PRIORITY) return applyRepairPriority(next, command);
  if (type === CMD_SET_ISLAND_ROLE) return applyIslandRole(next, command);
  if (type === CMD_BUILD_ON_ISLAND) return applyIslandBuild(next, command);
  return reject(next);
}

export { apply, findCarrier, findIsland };
