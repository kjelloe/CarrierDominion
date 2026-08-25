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
const UNIT_LANDED = 4; // a Manta down on an island runway (manual item 2)

// What it is trying to do.
const ORDER_HOLD = 0;
const ORDER_MOVE = 1;
const ORDER_RETURN = 2;
const ORDER_LOAD = 3; // lighter: stand off the stockpile island and take cargo
const ORDER_DELIVER = 4; // lighter: bring it back to the carrier
// Sent at something, the way the original's autopilot Attack order worked: you
// designate, the autopilot closes and engages.
const ORDER_ATTACK = 5;
// Follow the ship and fight what comes (the original's Escort): a standing
// combat air patrol that chases its own moving airfield.
const ORDER_ESCORT = 6;
// Land on a friendly island runway, refuel from its stock, await relaunch.
const ORDER_LAND = 7;
// KIND 3: the Viewing Drone (ruled 2026-08-25) - a slow aerial camera, the
// eye the Hammerhead aims through. No arms, no orders: it climbs, drifts
// down over its endurance, and is gone.
const KIND_DRONE = 3;
// KIND 4: the passive defence decoy (ruled 2026-08-25) - an inflatable
// stationed off the ship, bait for seekers, dead weight for the engines.
const KIND_DECOY = 4;
// KIND 5: the Bat Cave's interceptor (ruled 2026-08-25) - a Defence
// island's droid aircraft. carrierId is -1: its home is landedIsland.
const KIND_INTERCEPTOR = 5;

// The payload budget, in grams. Absent means a hull that carries no stores:
// the lighter carries cargo, which is a different book entirely.
function payloadGramsFrom(stats) {
  return stats.payloadKg === undefined ? 0 : stats.payloadKg * 1000;
}

function createManta(id, team, carrierId, rules, unitsPerMetre) {
  const stats = rules.units.manta;
  return {
    id: id,
    team: team,
    kind: KIND_MANTA,
    carrierId: carrierId,
    landedIsland: -1,
    commPod: 0,
    state: UNIT_STOWED,
    order: ORDER_HOLD,
    x: 0,
    y: 0,
    z: 0,
    heading: 0,
    speed: 0,
    hp: stats.hull,
    maxHp: stats.hull,
    // What it may carry, in grams (ruled 2026-08-25). See engine/payload.js.
    payloadMaxGrams: payloadGramsFrom(stats),
    podGrams: 0,
    virusGrams: 0,
    podRole: -1,
    fuel: stats.fuelCapacity,
    fuelAccum: 0,
    targetX: 0,
    targetY: 0,
    control: -1,
    throttle: 0,
    rudder: 0,
    // The pilot's hand on the stick: -1 dive, 0 hold, +1 climb. Autopilots
    // ignore it and fly the contour (engine/flight.js).
    climb: 0,
    maxSpeed: stats.maxSpeedUnitsPerTick,
    minSpeed: stats.minSpeedUnitsPerTick,
    accel: stats.accelUnitsPerTickSq,
    turnRate: stats.turnRateBamPerTick,
    cruiseAltitude: stats.cruiseAltitudeMetres * unitsPerMetre,
    ceiling: stats.ceilingMetres * unitsPerMetre,
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
    sinkRate: 0,
    pod: 0,
    virus: 0,
    orderTargetKind: -1,
    orderTargetId: -1,
    cargoFuel: 0,
    cargoMaterials: 0,
    cargoOrdnance: 0,
    cargoChassis: 0,
    cargoCap: 0,
    loadRange: 0,
    workRate: 0,
    arms: [],
    weapon: -1,
    cooldown: 0,
    heat: 0,
    heatAccum: 0,
    overheated: 0,
  };
}

function createWalrus(id, team, carrierId, rules, unitsPerMetre) {
  const stats = rules.units.walrus;
  const carrierStats = rules.units.carrier;
  return {
    id: id,
    team: team,
    kind: KIND_WALRUS,
    carrierId: carrierId,
    landedIsland: -1,
    commPod: 0,
    state: UNIT_STOWED,
    order: ORDER_HOLD,
    x: 0,
    y: 0,
    z: 0,
    heading: 0,
    speed: 0,
    hp: stats.hull,
    maxHp: stats.hull,
    // What it may carry, in grams (ruled 2026-08-25). See engine/payload.js.
    payloadMaxGrams: payloadGramsFrom(stats),
    podGrams: carrierStats.podKg * 1000,
    // Which kind of pod is aboard (ruled 2026-08-25): -1 none, otherwise the
    // island role it will raise. A vehicle sails with a Resource pod by
    // default, which is what an early war wants first.
    podRole: 0,
    virusGrams: carrierStats.virusKg * 1000,
    fuel: stats.fuelCapacity,
    fuelAccum: 0,
    targetX: 0,
    targetY: 0,
    control: -1,
    throttle: 0,
    rudder: 0,
    climb: 0,
    maxSpeed: stats.maxSpeedUnitsPerTick,
    minSpeed: 0,
    accel: stats.accelUnitsPerTickSq,
    turnRate: stats.turnRateBamPerTick,
    cruiseAltitude: 0,
    ceiling: 0,
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
    sinkRate: 0,
    // A pod is standard complement - the original sailed with them - but a
    // virus bomb is a munition, drawn from the ship's ordnance store at the
    // ramp (engine/hangar.js provisionWalrus), not carried from the shipyard.
    pod: 1,
    virus: 0,
    orderTargetKind: -1,
    orderTargetId: -1,
    cargoFuel: 0,
    cargoMaterials: 0,
    cargoOrdnance: 0,
    cargoChassis: 0,
    cargoCap: 0,
    loadRange: 0,
    workRate: 0,
    arms: [],
    weapon: -1,
    cooldown: 0,
    heat: 0,
    heatAccum: 0,
    overheated: 0,
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
    landedIsland: -1,
    commPod: 0,
    state: UNIT_STOWED,
    order: ORDER_HOLD,
    x: 0,
    y: 0,
    z: 0,
    heading: 0,
    speed: 0,
    hp: stats.hull,
    maxHp: stats.hull,
    // What it may carry, in grams (ruled 2026-08-25). See engine/payload.js.
    payloadMaxGrams: payloadGramsFrom(stats),
    podGrams: 0,
    virusGrams: 0,
    podRole: -1,
    fuel: stats.fuelCapacity,
    fuelAccum: 0,
    targetX: 0,
    targetY: 0,
    control: -1,
    throttle: 0,
    rudder: 0,
    climb: 0,
    maxSpeed: stats.maxSpeedUnitsPerTick,
    minSpeed: 0,
    accel: stats.accelUnitsPerTickSq,
    turnRate: stats.turnRateBamPerTick,
    cruiseAltitude: 0,
    ceiling: 0,
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
    sinkRate: 0,
    pod: 0,
    virus: 0,
    orderTargetKind: -1,
    orderTargetId: -1,
    cargoFuel: 0,
    cargoMaterials: 0,
    cargoOrdnance: 0,
    cargoChassis: 0,
    cargoCap: stats.cargoCapacity,
    loadRange: stats.loadRangeMetres * unitsPerMetre,
    workRate: stats.workPerTick,
    arms: [],
    weapon: -1,
    cooldown: 0,
    heat: 0,
    heatAccum: 0,
    overheated: 0,
  };
}

// The Viewing Drone: the lighter's record shape (the canonical walk wants
// one field set per list), with the aerostat's numbers. Fuel IS endurance:
// one unit per tick, burned by the ordinary burn machinery.
function createDrone(id, team, carrierId, rules, unitsPerMetre) {
  const stats = rules.units.drone;
  return {
    id: id,
    team: team,
    kind: KIND_DRONE,
    carrierId: carrierId,
    landedIsland: -1,
    commPod: 0,
    state: UNIT_STOWED,
    order: ORDER_HOLD,
    x: 0,
    y: 0,
    z: 0,
    heading: 0,
    speed: 0,
    hp: stats.hull,
    maxHp: stats.hull,
    payloadMaxGrams: payloadGramsFrom(stats),
    podGrams: 0,
    virusGrams: 0,
    podRole: -1,
    fuel: stats.enduranceTicks,
    fuelAccum: 0,
    targetX: 0,
    targetY: 0,
    control: -1,
    throttle: 0,
    rudder: 0,
    climb: 0,
    maxSpeed: 0,
    minSpeed: 0,
    accel: 0,
    turnRate: 0,
    cruiseAltitude: stats.ceilingMetres * unitsPerMetre,
    ceiling: stats.ceilingMetres * unitsPerMetre,
    climbRate: stats.climbMetresPerTick * unitsPerMetre,
    radar: stats.viewRadiusMetres * unitsPerMetre,
    fuelCapacity: stats.enduranceTicks,
    fuelBurn: 100,
    fuelBurnHover: 100,
    arriveRadius: 0,
    maxClimbPermil: 0,
    landSpeed: 0,
    blocked: 0,
    avoidTicks: 0,
    avoidHeading: 0,
    sinkRate: stats.sinkMetresPerTick * unitsPerMetre,
    pod: 0,
    virus: 0,
    orderTargetKind: -1,
    orderTargetId: -1,
    cargoFuel: 0,
    cargoMaterials: 0,
    cargoOrdnance: 0,
    cargoChassis: 0,
    cargoCap: 0,
    loadRange: 0,
    workRate: 0,
    arms: [],
    weapon: -1,
    cooldown: 0,
    heat: 0,
    heatAccum: 0,
    overheated: 0,
  };
}

// The interceptor: manta-shaped, island-homed. Created when a Bat Cave
// first scrambles (a deliberate exception to units-from-tick-zero: these
// belong to islands, not the complement, and pre-creating two per island
// on a 64-island sea would be bloat for nothing).
function createInterceptor(id, team, homeIsland, rules, unitsPerMetre) {
  const stats = rules.units.interceptor;
  const record = createManta(id, team, -1, { units: { manta: {
    hull: stats.hull,
    maxSpeedUnitsPerTick: stats.maxSpeedUnitsPerTick,
    minSpeedUnitsPerTick: stats.minSpeedUnitsPerTick,
    accelUnitsPerTickSq: stats.accelUnitsPerTickSq,
    turnRateBamPerTick: stats.turnRateBamPerTick,
    cruiseAltitudeMetres: stats.cruiseAltitudeMetres,
    ceilingMetres: stats.ceilingMetres,
    climbUnitsPerTick: stats.climbRateUnitsPerTick,
    fuelBurnHoverPer100Ticks: stats.fuelBurnPer100Ticks,
    radarRangeMetres: stats.radarRangeMetres,
    payloadKg: stats.payloadKg,
    fuelCapacity: stats.fuelCapacity,
    fuelBurnPer100Ticks: stats.fuelBurnPer100Ticks,
    arriveRadiusMetres: stats.arriveRadiusMetres,
  } } }, unitsPerMetre);
  record.kind = KIND_INTERCEPTOR;
  record.landedIsland = homeIsland;
  return record;
}

// The decoy: the drone's record shape, riding the ship in rigid formation.
function createDecoy(id, team, carrierId, rules, unitsPerMetre) {
  const stats = rules.units.decoy;
  const record = createDrone(id, team, carrierId, {
    units: {
      drone: {
        ceilingMetres: 0, climbMetresPerTick: 0, sinkMetresPerTick: 0,
        enduranceTicks: 1, viewRadiusMetres: 0, perCarrier: 0,
        hull: stats.hull,
      },
    },
  }, unitsPerMetre);
  record.kind = KIND_DECOY;
  record.fuel = 0;
  record.fuelCapacity = 0;
  record.fuelBurn = 0;
  record.fuelBurnHover = 0;
  record.radar = 0;
  return record;
}

// The magazines, copied by value. Kept here rather than imported from
// weapons.js so the two modules do not have to know about each other: units.js
// owns the record, weapons.js owns what the record means.
function copyArms(arms) {
  const out = [];
  for (let i = 0; i < arms.length; i++) out.push({ w: arms[i].w, n: arms[i].n });
  return out;
}

function copyUnit(unit) {
  const copy = {
    id: unit.id,
    team: unit.team,
    kind: unit.kind,
    carrierId: unit.carrierId,
    landedIsland: unit.landedIsland,
    commPod: unit.commPod,
    state: unit.state,
    order: unit.order,
    x: unit.x,
    y: unit.y,
    z: unit.z,
    heading: unit.heading,
    speed: unit.speed,
    hp: unit.hp,
    maxHp: unit.maxHp,
    payloadMaxGrams: unit.payloadMaxGrams,
    podGrams: unit.podGrams,
    podRole: unit.podRole,
    virusGrams: unit.virusGrams,
    fuel: unit.fuel,
    fuelAccum: unit.fuelAccum,
    targetX: unit.targetX,
    targetY: unit.targetY,
    control: unit.control,
    throttle: unit.throttle,
    rudder: unit.rudder,
    climb: unit.climb,
    maxSpeed: unit.maxSpeed,
    minSpeed: unit.minSpeed,
    accel: unit.accel,
    turnRate: unit.turnRate,
    cruiseAltitude: unit.cruiseAltitude,
    ceiling: unit.ceiling,
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
    sinkRate: unit.sinkRate,
    pod: unit.pod,
    virus: unit.virus,
    orderTargetKind: unit.orderTargetKind,
    orderTargetId: unit.orderTargetId,
    cargoFuel: unit.cargoFuel,
    cargoMaterials: unit.cargoMaterials,
    cargoOrdnance: unit.cargoOrdnance,
    cargoChassis: unit.cargoChassis,
    cargoCap: unit.cargoCap,
    loadRange: unit.loadRange,
    workRate: unit.workRate,
    arms: copyArms(unit.arms),
    weapon: unit.weapon,
    cooldown: unit.cooldown,
    heat: unit.heat,
    heatAccum: unit.heatAccum,
    overheated: unit.overheated,
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

// Out, alive, and therefore both a target and a shooter. Lives here rather
// than in weapons.js because it is a fact about the unit, and because shots.js
// needs it too.
function unitEngageable(unit) {
  if (unit.hp <= 0) return false;
  // A Manta parked on a runway is a target like any other - a runway is a
  // place to refuel, not a sanctuary.
  return unit.state === UNIT_ACTIVE || unit.state === UNIT_RETURNING
    || unit.state === UNIT_LANDED;
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

// The repair state as a drive scale (manual coverage review, item 7): the
// original slowed a hull in direct proportion to its damage. Floored at a
// quarter so a cripple still crawls home rather than becoming scenery.
function damagePermil(unit) {
  if (unit.maxHp <= 0) return 1000;
  const permil = floorDiv(unit.hp * 1000, unit.maxHp);
  return permil < 250 ? 250 : (permil > 1000 ? 1000 : permil);
}

// Below this repair state the hull leaks fuel (the original's two-minute
// clock): the whole tank in FUEL_LEAK_TICKS on top of the normal burn.
const LEAK_BELOW_PERMIL = 120;
const FUEL_LEAK_TICKS = 2400;

function leakFuel(unit) {
  if (unit.fuel <= 0 || damagePermil(unit) === 1000) return;
  if (floorDiv(unit.hp * 1000, unit.maxHp) >= LEAK_BELOW_PERMIL) return;
  burnUnitFuel(unit, floorDiv(unit.fuelCapacity * 100, FUEL_LEAK_TICKS));
}

// Fraction of the tank left, in per-mil, for the AI's "can I still get home?"
// test and for the HUD.
function fuelPermil(unit) {
  if (unit.fuelCapacity <= 0) return 0;
  return mulDiv(unit.fuel, 1000, unit.fuelCapacity);
}

export {
  damagePermil,
  leakFuel,
  UNIT_LANDED,
  ORDER_LAND,
  KIND_DRONE,
  createDrone,
  KIND_DECOY,
  createDecoy,
  KIND_INTERCEPTOR,
  createInterceptor,
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
  ORDER_ATTACK,
  ORDER_ESCORT,
  createManta,
  createWalrus,
  createLighter,
  copyUnit,
  findUnit,
  findCarrierById,
  stowedCount,
  arrivedAtTarget,
  unitEngageable,
  copyArms,
  burnUnitFuel,
  fuelPermil,
};
