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
  CMD_DEPLOY_VIRUS,
  CMD_FIRE_FLARES,
  CMD_FIRE_UNIT,
  CMD_SET_AI,
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
  CMD_SET_COURSE,
  CMD_ORDER_UNIT_ESCORT,
  CMD_ORDER_UNIT_LAND,
  CMD_SET_LOADOUT_PRESET,
  CMD_FIRE_HAMMERHEAD,
  CMD_SET_SUPPLY_BIAS,
  CMD_SURRENDER,
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
  EVT_CARRIER_SUNK,
  EVT_SUPPLY_RUN,
  EVT_AI_SEAT,
  EVT_COURSE,
  EVT_SUPPLY_BIAS,
  pushEvent,
} from './events.js';
import { stepCarriers } from './carrier.js';
import { checkDeploy, deployPod, stepCapture } from './capture.js';
import { checkVirus, deployVirus, stepVirus } from './virus.js';
import { createBrain, stepAi } from './ai_carrier.js';
import { checkVictory } from './victory.js';
import { stepEconomy, teamById } from './economy.js';
import { stepSupply } from './supply.js';
import { stepRepair } from './repair.js';
import { stepTelemetry } from './telemetry.js';
import { stepScore } from './score.js';
import { setRole, startBuild, stepBuild } from './island.js';
import { setPriority } from './damage.js';
import { checkFlares, fireFlares, stepFlares } from './flare.js';
import { stepContacts } from './contacts.js';
import { stepUnits } from './fleet.js';
import { fireUnit, selectWeapon, stepWeapons } from './weapons.js';
import { launchShot } from './shots.js';
import { launchUnit, orderReturn, readyToLaunch } from './hangar.js';
import { dist2D, floorDiv } from '../shared/fixed.js';
import {
  KIND_DRONE,
  KIND_LIGHTER,
  KIND_MANTA,
  ORDER_ATTACK,
  ORDER_ESCORT,
  ORDER_LAND,
  ORDER_MOVE,
  UNIT_ACTIVE,
  UNIT_LANDED,
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
  // Touching the wheel drops any heading hold or course; the helm is one
  // authority.
  carrier.headingHold = HEADING_MANUAL;
  carrier.courseX = -1;
  carrier.courseY = -1;
  pushEvent(next.events, EVT_RUDDER_SET, carrier.id, carrier.rudder, 0);
  return next;
}

function applyHeading(next, command) {
  const carrier = findCarrier(next, command.carrierId);
  if (carrier === -1) return reject(next);
  carrier.headingHold = command.heading;
  carrier.rudder = 0;
  // The helm is one authority: a hand on the heading drops any course.
  carrier.courseX = -1;
  carrier.courseY = -1;
  pushEvent(next.events, EVT_HEADING_SET, carrier.id, carrier.headingHold, 0);
  return next;
}

// The programmed course (the original's map + PROG + A): the autopilot takes
// the wheel, the throttle stays yours. (-1, -1) clears it, and so does any
// hand on the rudder or the heading - the helm is one authority.
function applyCourse(next, command) {
  const carrier = findCarrier(next, command.carrierId);
  if (carrier === -1) return reject(next);
  if (command.x === -1 && command.y === -1) {
    carrier.courseX = -1;
    carrier.courseY = -1;
    pushEvent(next.events, EVT_COURSE, carrier.id, 0, 0);
    return next;
  }
  if (command.x > next.params.sizeUnits || command.y > next.params.sizeUnits) return reject(next);
  carrier.courseX = command.x;
  carrier.courseY = command.y;
  carrier.rudder = 0;
  carrier.headingHold = HEADING_MANUAL;
  pushEvent(next.events, EVT_COURSE, carrier.id, 1, 0);
  return next;
}

// Escort: follow the ship, fight what comes. The one order with no target -
// the target is home.
// A parked Manta answers a new order by taking off first: any legitimate
// unit order lifts it from the runway back to ACTIVE (manual item 2 - click
// LAUNCH and the Command Centre sends it up).
function liftOff(unit) {
  if (unit.state !== UNIT_LANDED) return;
  unit.state = UNIT_ACTIVE;
  unit.landedIsland = -1;
  unit.throttle = 100;
}

// The Hammerhead (ruled 2026-08-25, player-only): valid only while one of
// the team's Viewing Drones is up and the mark is inside ITS picture, and
// inside the missile's own range from the ship. The round is a splash shot
// whose life ends AT the mark - splash rounds detonate at the end of their
// run, so the existing rule does the fuzing.
const HAMMERHEAD_WEAPON = 9;

function applyFireHammerhead(next, command) {
  if (next.phase !== PHASE_RUNNING) return reject(next);
  const carrier = findCarrier(next, command.carrierId);
  if (carrier === -1 || carrier.hull <= 0) return reject(next);
  if (carrier.hammerRounds <= 0 || carrier.hammerCooldown > 0) return reject(next);
  const weaponId = HAMMERHEAD_WEAPON;
  const weapon = next.weapons[weaponId];
  if (weapon === undefined) return reject(next);
  const range = dist2D(carrier.x, carrier.y, command.x, command.y);
  if (range > weapon.range) return reject(next);
  let seen = 0;
  for (let i = 0; i < next.units.length; i++) {
    const unit = next.units[i];
    if (unit.team !== carrier.team || unit.kind !== KIND_DRONE) continue;
    if (unit.state !== UNIT_ACTIVE) continue;
    if (dist2D(unit.x, unit.y, command.x, command.y) <= unit.radar) seen = 1;
  }
  if (seen === 0) return reject(next);
  if (carrier.ordnance < weapon.ordnancePerRound) return reject(next);
  carrier.ordnance = carrier.ordnance - weapon.ordnancePerRound;
  carrier.hammerRounds = carrier.hammerRounds - 1;
  carrier.hammerCooldown = weapon.cooldown;
  const shot = launchShot(next, carrier.team, carrier.x, carrier.y, 64,
    weaponId, weapon, { kind: 0, id: -1, x: command.x, y: command.y, z: 0 });
  const flight = weapon.speed > 0 ? floorDiv(range, weapon.speed) : 1;
  shot.life = flight < 1 ? 1 : flight;
  return next;
}

function applyLoadoutPreset(next, command) {
  const carrier = findCarrier(next, command.carrierId);
  if (carrier === -1) return reject(next);
  if (command.preset >= next.presets.length) return reject(next);
  carrier.mantaPreset = command.preset;
  return next;
}

function applyUnitLand(next, command) {
  const unit = findUnit(next, command.unitId);
  if (unit === -1 || unit.kind !== KIND_MANTA) return reject(next);
  if (unit.state !== UNIT_ACTIVE && unit.state !== UNIT_RETURNING
    && unit.state !== UNIT_LANDED) return reject(next);
  const island = command.islandId >= 0 && command.islandId < next.islands.length
    ? next.islands[command.islandId]
    : -1;
  if (island === -1 || island.owner !== unit.team || island.runway !== 1) return reject(next);
  liftOff(unit);
  unit.state = UNIT_ACTIVE;
  unit.order = ORDER_LAND;
  unit.landedIsland = island.id;
  unit.targetX = island.nodeX;
  unit.targetY = island.nodeY;
  unit.control = -1;
  unit.throttle = 100;
  pushEvent(next.events, EVT_UNIT_ORDERED, unit.id, unit.order, 0);
  return next;
}

function applyUnitEscort(next, command) {
  const unit = findUnit(next, command.unitId);
  if (unit === -1) return reject(next);
  if (unit.state !== UNIT_ACTIVE && unit.state !== UNIT_RETURNING
    && unit.state !== UNIT_LANDED) return reject(next);
  liftOff(unit);
  if (unit.kind === KIND_LIGHTER) return reject(next); // the boat has a job
  unit.state = UNIT_ACTIVE;
  unit.order = ORDER_ESCORT;
  unit.control = -1;
  unit.orderTargetKind = -1;
  unit.orderTargetId = -1;
  pushEvent(next.events, EVT_UNIT_ORDERED, unit.id, unit.order, 0);
  return next;
}

// The quartermaster's bias: which of the factory's three outputs the war
// effort leans on. LOW starves an output entirely; all-LOW idles the plant.
function applySupplyBias(next, command) {
  const carrier = findCarrier(next, command.carrierId);
  if (carrier === -1) return reject(next);
  const team = teamById(next, carrier.team);
  if (team === -1) return reject(next);
  if (command.item === 0) team.biasFuel = command.level;
  else if (command.item === 1) team.biasOrdnance = command.level;
  else team.biasChassis = command.level;
  pushEvent(next.events, EVT_SUPPLY_BIAS, command.item, team.id, command.level);
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
  if (unit.state !== UNIT_ACTIVE && unit.state !== UNIT_RETURNING
    && unit.state !== UNIT_LANDED) return reject(next);
  liftOff(unit);
  orderReturn(unit);
  pushEvent(next.events, EVT_UNIT_ORDERED, unit.id, unit.order, 0);
  return next;
}

function applyUnitMove(next, command) {
  const unit = findUnit(next, command.unitId);
  if (unit === -1) return reject(next);
  if (unit.state !== UNIT_ACTIVE && unit.state !== UNIT_RETURNING
    && unit.state !== UNIT_LANDED) return reject(next);
  liftOff(unit);
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
  if (unit.state !== UNIT_ACTIVE && unit.state !== UNIT_RETURNING
    && unit.state !== UNIT_LANDED) return reject(next);
  liftOff(unit);
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
  if (unit.state !== UNIT_ACTIVE && unit.state !== UNIT_RETURNING
    && unit.state !== UNIT_LANDED) return reject(next);
  liftOff(unit);
  // One seat per team for now; the seat id IS the team until crews exist.
  unit.control = unit.team;
  unit.state = UNIT_ACTIVE;
  unit.throttle = 100;
  unit.rudder = 0;
  unit.climb = 0;
  pushEvent(next.events, EVT_UNIT_CONTROL, unit.id, 1, 0);
  return next;
}

function applyReleaseControl(next, command) {
  const unit = findUnit(next, command.unitId);
  if (unit === -1) return reject(next);
  unit.control = -1;
  unit.rudder = 0;
  unit.climb = 0;
  pushEvent(next.events, EVT_UNIT_CONTROL, unit.id, 0, 0);
  return next;
}

function applyUnitHelm(next, command) {
  const unit = findUnit(next, command.unitId);
  if (unit === -1) return reject(next);
  if (unit.control === -1) return reject(next);
  unit.throttle = command.throttle;
  unit.rudder = command.rudder;
  unit.climb = command.climb === undefined ? 0 : command.climb;
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
// Striking the colours: the commander scuttles the ship. Victory resolution
// then does its ordinary work - in a duel the other side is last afloat, at
// a bigger table the war goes on without this seat. Refused post-war (there
// is nothing left to concede) and refused for a ship already gone.
function applySurrender(next, command) {
  if (next.phase !== PHASE_RUNNING) return reject(next);
  const carrier = findCarrier(next, command.carrierId);
  if (carrier === -1 || carrier.hull <= 0) return reject(next);
  carrier.hull = 0;
  carrier.speed = 0;
  carrier.throttle = 0;
  pushEvent(next.events, EVT_CARRIER_SUNK, carrier.id, carrier.team, 0);
  return next;
}

function applyFire(next, command) {
  // After the whistle no trigger answers - the automatic guns already hold
  // their fire post-war, and a manual pilot is not an exception to the
  // ending (third review: the command path skipped the aftermath rule).
  if (next.phase !== PHASE_RUNNING) return reject(next);
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

// A burst of flares. Refused when the launchers are reloading or the store is
// short, because both are the cost that makes the timing a decision.
function applyFlares(next, command) {
  const carrier = findCarrier(next, command.carrierId);
  if (carrier === -1) return reject(next);
  if (checkFlares(carrier) !== '') return reject(next);
  fireFlares(next, carrier);
  return next;
}

// A seat handed to the machine, or taken back from it. This is a COMMAND
// rather than something the server does to the state directly, because the
// command log is the replay: a war where the AI took over at tick 40,000 has to
// replay as a war where the AI took over at tick 40,000.
function applySetAi(next, command) {
  const has = [];
  for (let i = 0; i < next.ai.length; i++) has.push(next.ai[i].team);
  if (command.active === 1) {
    if (command.team < 0 || command.team >= next.teams.length) return reject(next);
    if (has.includes(command.team)) return next;
    next.ai.push(createBrain(command.team));
    pushEvent(next.events, EVT_AI_SEAT, command.team, 1, 0);
    return next;
  }
  if (!has.includes(command.team)) return next;
  const kept = [];
  for (let i = 0; i < next.ai.length; i++) {
    if (next.ai[i].team !== command.team) kept.push(next.ai[i]);
  }
  next.ai = kept;
  pushEvent(next.events, EVT_AI_SEAT, command.team, 0, 0);
  return next;
}

function applyDeployPod(next, command) {
  // Post-war spending refused (ruling 2026-08-23, third review): a pod bought after the war can never finish building,
  // so taking the payment would burn stores on a decision that cannot land.
  if (next.phase !== PHASE_RUNNING) return reject(next);
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
  // Post-war spending refused (ruling 2026-08-23, third review): a site started after the war can never finish,
  // so taking the payment would burn stores on a decision that cannot land.
  if (next.phase !== PHASE_RUNNING) return reject(next);
  const carrier = findCarrier(next, command.carrierId);
  if (carrier === -1) return reject(next);
  const island = findIsland(next, command.islandId);
  if (island === -1 || island.owner !== carrier.team) return reject(next);
  if (startBuild(next, island, command.what, next.economy) !== 1) return reject(next);
  return next;
}

// The virus bomb: the other way to take an island, and the one that takes it
// with everything on it.
function applyDeployVirus(next, command) {
  // Post-war spending refused (ruling 2026-08-23, third review): a bomb bought after the war can never convert,
  // so taking the payment would burn stores on a decision that cannot land.
  if (next.phase !== PHASE_RUNNING) return reject(next);
  const unit = findUnit(next, command.unitId);
  if (unit === -1) return reject(next);
  const island = findIsland(next, command.islandId);
  if (island === -1) return reject(next);
  if (checkVirus(unit, island, next.params.virusRange) !== '') return reject(next);
  deployVirus(next, unit, island);
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
  for (let i = 0; i < next.carriers.length; i++) {
    if (next.carriers[i].hammerCooldown > 0) {
      next.carriers[i].hammerCooldown = next.carriers[i].hammerCooldown - 1;
    }
  }
  stepUnits(next);
  // The leash bites where the tick's movement put everyone: a craft that
  // crossed the loss line this tick is gone before it can shoot from there.
  stepTelemetry(next);
  stepFlares(next);
  stepWeapons(next, next.params);
  // Memory follows the shooting: everything has moved and this tick's dead
  // are dead, so what each team saw - and stopped seeing - is settled now.
  // It runs after the war ends too: eyes do not close when the whistle blows.
  stepContacts(next);
  // "Nothing new is decided" after the war ends, and these are the deciders:
  // no capture completes, no virus converts, no site finishes, no accrual
  // lands, no point scores. Hulls still move, rounds already in the air still
  // fly (stepWeapons stops the FIRING, not the flight), boats still deliver
  // and the yard still mends - the world winds down, it does not freeze.
  if (next.phase === PHASE_RUNNING) {
    stepCapture(next, next.params.podBuildTicks);
    stepVirus(next, next.params.virusBuildTicks);
    stepBuild(next);
    stepEconomy(next);
  }
  stepSupply(next);
  // Repairs last: the boat has landed this tick's materials, and the yard
  // spends what is in the store, not what is in the hold.
  stepRepair(next);
  if (next.phase === PHASE_RUNNING) {
    stepScore(next, next.params.pointsPerIsland);
  }
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
  if (type === CMD_SET_COURSE) return applyCourse(next, command);
  if (type === CMD_ORDER_UNIT_ESCORT) return applyUnitEscort(next, command);
  if (type === CMD_ORDER_UNIT_LAND) return applyUnitLand(next, command);
  if (type === CMD_SET_LOADOUT_PRESET) return applyLoadoutPreset(next, command);
  if (type === CMD_FIRE_HAMMERHEAD) return applyFireHammerhead(next, command);
  if (type === CMD_SET_SUPPLY_BIAS) return applySupplyBias(next, command);
  if (type === CMD_LAUNCH_UNIT) return applyLaunch(next, command);
  if (type === CMD_RECALL_UNIT) return applyRecall(next, command);
  if (type === CMD_ORDER_UNIT_MOVE) return applyUnitMove(next, command);
  if (type === CMD_ORDER_UNIT_ATTACK) return applyUnitAttack(next, command);
  if (type === CMD_SET_CARRIER_AIM) return applyCarrierAim(next, command);
  if (type === CMD_TAKE_CONTROL) return applyTakeControl(next, command);
  if (type === CMD_RELEASE_CONTROL) return applyReleaseControl(next, command);
  if (type === CMD_SET_UNIT_HELM) return applyUnitHelm(next, command);
  if (type === CMD_DEPLOY_POD) return applyDeployPod(next, command);
  if (type === CMD_DEPLOY_VIRUS) return applyDeployVirus(next, command);
  if (type === CMD_FIRE_UNIT) return applyFire(next, command);
  if (type === CMD_FIRE_FLARES) return applyFlares(next, command);
  if (type === CMD_SET_AI) return applySetAi(next, command);
  if (type === CMD_SURRENDER) return applySurrender(next, command);
  if (type === CMD_SELECT_WEAPON) return applySelectWeapon(next, command);
  if (type === CMD_SET_STOCKPILE) return applySetStockpile(next, command);
  if (type === CMD_SET_SUPPLY_RUN) return applySetSupplyRun(next, command);
  if (type === CMD_SET_REPAIR_PRIORITY) return applyRepairPriority(next, command);
  if (type === CMD_SET_ISLAND_ROLE) return applyIslandRole(next, command);
  if (type === CMD_BUILD_ON_ISLAND) return applyIslandBuild(next, command);
  return reject(next);
}

export { apply, findCarrier, findIsland };
