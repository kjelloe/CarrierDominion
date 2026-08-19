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
  CMD_LAUNCH_UNIT,
  CMD_ORDER_UNIT_MOVE,
  CMD_RECALL_UNIT,
  CMD_RELEASE_CONTROL,
  CMD_SET_HEADING,
  CMD_SET_RUDDER,
  CMD_SET_THROTTLE,
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
import { stepUnits } from './fleet.js';
import { launchUnit, orderReturn, readyToLaunch } from './hangar.js';
import {
  ORDER_MOVE,
  UNIT_ACTIVE,
  UNIT_RETURNING,
  findUnit,
} from './units.js';

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

function applyDeployPod(next, command) {
  const unit = findUnit(next, command.unitId);
  if (unit === -1) return reject(next);
  const island = findIsland(next, command.islandId);
  if (island === -1) return reject(next);
  if (checkDeploy(unit, island, next.params.podRange) !== '') return reject(next);
  deployPod(next, unit, island);
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

function advanceTick(next) {
  // Order is the simulation's contract and part of every hash: the AI decides
  // first (so its orders take effect this tick, not next), then hulls move,
  // then pods build, then the war is checked for an ending. A finished war
  // still ticks - the world does not freeze - but nothing new is decided.
  next.tick = next.tick + 1;
  if (next.phase === PHASE_RUNNING) {
    stepAi(next, next.params.aiCadenceTicks, next.params.aiStandoff);
  }
  stepCarriers(next);
  stepUnits(next);
  stepCapture(next, next.params.podBuildTicks);
  stepEconomy(next);
  stepSupply(next);
  checkVictory(next, next.params.victoryIslandPermil);
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
  if (type === CMD_TAKE_CONTROL) return applyTakeControl(next, command);
  if (type === CMD_RELEASE_CONTROL) return applyReleaseControl(next, command);
  if (type === CMD_SET_UNIT_HELM) return applyUnitHelm(next, command);
  if (type === CMD_DEPLOY_POD) return applyDeployPod(next, command);
  if (type === CMD_SET_STOCKPILE) return applySetStockpile(next, command);
  if (type === CMD_SET_SUPPLY_RUN) return applySetSupplyRun(next, command);
  return reject(next);
}

export { apply, findCarrier, findIsland };
