// engine/units.js - the Manta and Walrus records, and the parts of their tick
// that are the same for both: fuel, arrival tests, and the order enum.
//
// The two movement models proper live in flight.js and drive.js. Everything a
// unit needs to move is copied into its record at build time (max speed, turn
// rate, burn), so the per-tick code never has to reach for the ruleset - which
// also means the tunables end up inside the state hash automatically.

import { dist2D, mulDiv, floorDiv } from '../shared/fixed.js';

const KIND_MANTA = 0;
const KIND_WALRUS = 1;
const KIND_LIGHTER = 2; // the logistics boat

// Where a unit is in its life cycle.
const UNIT_STOWED = 0; // in the hangar, not on the map
const UNIT_ACTIVE = 1; // out and under way
const UNIT_RETURNING = 2; // heading home under its own orders
const UNIT_LOST = 3; // destroyed or out of fuel away from the carrier

// What it is trying to do.
const ORDER_HOLD = 0;
const ORDER_MOVE = 1;
const ORDER_RETURN = 2;
const ORDER_LOAD = 3; // lighter: stand off the stockpile island and take cargo
const ORDER_DELIVER = 4; // lighter: bring it back to the carrier

function createManta(id, team, carrierId, rules, unitsPerMetre) {
  const stats = rules.units.manta;
  return {
    id: id,
    team: team,
    kind: KIND_MANTA,
    carrierId: carrierId,
    state: UNIT_STOWED,
    order: ORDER_HOLD,
    x: 0,
    y: 0,
    z: 0,
    heading: 0,
    speed: 0,
    hp: stats.hull,
    fuel: stats.fuelCapacity,
    fuelAccum: 0,
    targetX: 0,
    targetY: 0,
    control: -1,
    throttle: 0,
    rudder: 0,
    maxSpeed: stats.maxSpeedUnitsPerTick,
    minSpeed: stats.minSpeedUnitsPerTick,
    accel: stats.accelUnitsPerTickSq,
    turnRate: stats.turnRateBamPerTick,
    cruiseAltitude: stats.cruiseAltitudeMetres * unitsPerMetre,
    climbRate: stats.climbUnitsPerTick,
    radar: stats.radarRangeMetres * unitsPerMetre,
    fuelCapacity: stats.fuelCapacity,
    fuelBurn: stats.fuelBurnPer100Ticks,
    fuelBurnHover: stats.fuelBurnHoverPer100Ticks,
    arriveRadius: stats.arriveRadiusMetres * unitsPerMetre,
    maxClimbPermil: 0,
    landSpeed: 0,
    blocked: 0,
    avoidTicks: 0,
    avoidHeading: 0,
    pod: 0,
    cargoFuel: 0,
    cargoMaterials: 0,
    cargoCap: 0,
    loadRange: 0,
    workRate: 0,
  };
}

function createWalrus(id, team, carrierId, rules, unitsPerMetre) {
  const stats = rules.units.walrus;
  return {
    id: id,
    team: team,
    kind: KIND_WALRUS,
    carrierId: carrierId,
    state: UNIT_STOWED,
    order: ORDER_HOLD,
    x: 0,
    y: 0,
    z: 0,
    heading: 0,
    speed: 0,
    hp: stats.hull,
    fuel: stats.fuelCapacity,
    fuelAccum: 0,
    targetX: 0,
    targetY: 0,
    control: -1,
    throttle: 0,
    rudder: 0,
    maxSpeed: stats.maxSpeedUnitsPerTick,
    minSpeed: 0,
    accel: stats.accelUnitsPerTickSq,
    turnRate: stats.turnRateBamPerTick,
    cruiseAltitude: 0,
    climbRate: 0,
    radar: stats.radarRangeMetres * unitsPerMetre,
    fuelCapacity: stats.fuelCapacity,
    fuelBurn: stats.fuelBurnPer100Ticks,
    fuelBurnHover: stats.fuelBurnPer100Ticks,
    arriveRadius: stats.arriveRadiusMetres * unitsPerMetre,
    maxClimbPermil: stats.maxClimbPermil,
    landSpeed: stats.maxSpeedLandUnitsPerTick,
    blocked: 0,
    avoidTicks: 0,
    avoidHeading: 0,
    pod: 1,
    cargoFuel: 0,
    cargoMaterials: 0,
    cargoCap: 0,
    loadRange: 0,
    workRate: 0,
  };
}

// The logistics boat. It moves on the Walrus drive model but never targets
// land, so its climb limit is zero: if it somehow finds itself facing a beach
// it stops rather than crawling up one.
function createLighter(id, team, carrierId, rules, unitsPerMetre) {
  const stats = rules.units.lighter;
  return {
    id: id,
    team: team,
    kind: KIND_LIGHTER,
    carrierId: carrierId,
    state: UNIT_STOWED,
    order: ORDER_HOLD,
    x: 0,
    y: 0,
    z: 0,
    heading: 0,
    speed: 0,
    hp: stats.hull,
    fuel: stats.fuelCapacity,
    fuelAccum: 0,
    targetX: 0,
    targetY: 0,
    control: -1,
    throttle: 0,
    rudder: 0,
    maxSpeed: stats.maxSpeedUnitsPerTick,
    minSpeed: 0,
    accel: stats.accelUnitsPerTickSq,
    turnRate: stats.turnRateBamPerTick,
    cruiseAltitude: 0,
    climbRate: 0,
    radar: stats.radarRangeMetres * unitsPerMetre,
    fuelCapacity: stats.fuelCapacity,
    fuelBurn: stats.fuelBurnPer100Ticks,
    fuelBurnHover: stats.fuelBurnPer100Ticks,
    arriveRadius: stats.arriveRadiusMetres * unitsPerMetre,
    maxClimbPermil: 0,
    landSpeed: 0,
    blocked: 0,
    avoidTicks: 0,
    avoidHeading: 0,
    pod: 0,
    cargoFuel: 0,
    cargoMaterials: 0,
    cargoCap: stats.cargoCapacity,
    loadRange: stats.loadRangeMetres * unitsPerMetre,
    workRate: stats.workPerTick,
  };
}

function copyUnit(unit) {
  const copy = {
    id: unit.id,
    team: unit.team,
    kind: unit.kind,
    carrierId: unit.carrierId,
    state: unit.state,
    order: unit.order,
    x: unit.x,
    y: unit.y,
    z: unit.z,
    heading: unit.heading,
    speed: unit.speed,
    hp: unit.hp,
    fuel: unit.fuel,
    fuelAccum: unit.fuelAccum,
    targetX: unit.targetX,
    targetY: unit.targetY,
    control: unit.control,
    throttle: unit.throttle,
    rudder: unit.rudder,
    maxSpeed: unit.maxSpeed,
    minSpeed: unit.minSpeed,
    accel: unit.accel,
    turnRate: unit.turnRate,
    cruiseAltitude: unit.cruiseAltitude,
    climbRate: unit.climbRate,
    radar: unit.radar,
    fuelCapacity: unit.fuelCapacity,
    fuelBurn: unit.fuelBurn,
    fuelBurnHover: unit.fuelBurnHover,
    arriveRadius: unit.arriveRadius,
    maxClimbPermil: unit.maxClimbPermil,
    landSpeed: unit.landSpeed,
    blocked: unit.blocked,
    avoidTicks: unit.avoidTicks,
    avoidHeading: unit.avoidHeading,
    pod: unit.pod,
    cargoFuel: unit.cargoFuel,
    cargoMaterials: unit.cargoMaterials,
    cargoCap: unit.cargoCap,
    loadRange: unit.loadRange,
    workRate: unit.workRate,
  };
  return copy;
}

function findUnit(state, unitId) {
  for (let i = 0; i < state.units.length; i++) {
    if (state.units[i].id === unitId) return state.units[i];
  }
  return -1;
}

function findCarrierById(state, carrierId) {
  for (let i = 0; i < state.carriers.length; i++) {
    if (state.carriers[i].id === carrierId) return state.carriers[i];
  }
  return -1;
}

function stowedCount(state, carrierId, kind) {
  let count = 0;
  for (let i = 0; i < state.units.length; i++) {
    const unit = state.units[i];
    if (unit.carrierId === carrierId && unit.kind === kind && unit.state === UNIT_STOWED) {
      count = count + 1;
    }
  }
  return count;
}

function arrivedAtTarget(unit) {
  return dist2D(unit.x, unit.y, unit.targetX, unit.targetY) <= unit.arriveRadius;
}

// Fuel is spent per 100 ticks so an idle rate can be a fraction of a unit.
// Returns 1 when the tank ran dry on this tick.
function burnUnitFuel(unit, perHundred) {
  if (unit.fuel <= 0) return 0;
  const accum = unit.fuelAccum + perHundred;
  const spent = floorDiv(accum, 100);
  unit.fuelAccum = accum - spent * 100;
  unit.fuel = unit.fuel - spent;
  if (unit.fuel <= 0) {
    unit.fuel = 0;
    return 1;
  }
  return 0;
}

// Fraction of the tank left, in per-mil, for the AI's "can I still get home?"
// test and for the HUD.
function fuelPermil(unit) {
  if (unit.fuelCapacity <= 0) return 0;
  return mulDiv(unit.fuel, 1000, unit.fuelCapacity);
}

export {
  KIND_MANTA,
  KIND_WALRUS,
  KIND_LIGHTER,
  UNIT_STOWED,
  UNIT_ACTIVE,
  UNIT_RETURNING,
  UNIT_LOST,
  ORDER_HOLD,
  ORDER_MOVE,
  ORDER_RETURN,
  ORDER_LOAD,
  ORDER_DELIVER,
  createManta,
  createWalrus,
  createLighter,
  copyUnit,
  findUnit,
  findCarrierById,
  stowedCount,
  arrivedAtTarget,
  burnUnitFuel,
  fuelPermil,
};
