// engine/state.js - state construction and the deep copy the reducer relies on.
//
// copyState deep-copies EVERY nested array and object. Sibling projects each
// lost a day to an aliasing bug where one forgotten array let a "previous"
// state mutate under a replay; the rule here is that a new entity kind is not
// done until it has a line in both createInitialState and copyState.
//
// No value in state may be null, undefined, or fractional. Absence is -1.

import { mulDiv } from '../shared/fixed.js';
import { hashState } from '../shared/statehash.js';
import { seedRng } from '../shared/prng.js';
import { HEADING_MANUAL } from './commands.js';
import { copyUnit, createLighter, createManta, createWalrus } from './units.js';
import { copyBrain, createBrain } from './ai_carrier.js';
import { copyEconomy, createEconomy } from './economy.js';
import {
  LOADOUT_CARRIER,
  copyArms,
  copyLoadouts,
  copyWeapons,
  createArms,
  createLoadouts,
  createWeapons,
} from './weapons.js';
import { copyShot } from './shots.js';
import { copySections, createSections } from './damage.js';
import { createIslands, startPositions, worldSizeMetres } from './worldgen.js';

const PHASE_RUNNING = 0;
const PHASE_OVER = 1;

function copyIsland(island) {
  return {
    id: island.id,
    kind: island.kind,
    owner: island.owner,
    x: island.x,
    y: island.y,
    radius: island.radius,
    peak: island.peak,
    seed: island.seed,
    noiseCell: island.noiseCell,
    noiseOctaves: island.noiseOctaves,
    noisePermil: island.noisePermil,
    warpCell: island.warpCell,
    warpPermil: island.warpPermil,
    nodeX: island.nodeX,
    nodeY: island.nodeY,
    podTeam: island.podTeam,
    podTicks: island.podTicks,
    stockFuel: island.stockFuel,
    stockMaterials: island.stockMaterials,
    stockOrdnance: island.stockOrdnance,
    stockChassis: island.stockChassis,
    role: island.role,
    factories: island.factories,
    warehouses: island.warehouses,
    turrets: island.turrets,
    building: island.building,
    buildTicks: island.buildTicks,
  };
}

function copyCarrier(carrier) {
  return {
    id: carrier.id,
    team: carrier.team,
    x: carrier.x,
    y: carrier.y,
    heading: carrier.heading,
    speed: carrier.speed,
    throttle: carrier.throttle,
    rudder: carrier.rudder,
    headingHold: carrier.headingHold,
    hull: carrier.hull,
    maxHull: carrier.maxHull,
    fuel: carrier.fuel,
    grounded: carrier.grounded,
    supplyRun: carrier.supplyRun,
    groundAccum: carrier.groundAccum,
    fuelAccum: carrier.fuelAccum,
    maxSpeed: carrier.maxSpeed,
    accel: carrier.accel,
    turnRate: carrier.turnRate,
    draught: carrier.draught,
    shallowBand: carrier.shallowBand,
    slowestSpeed: carrier.slowestSpeed,
    groundDamage: carrier.groundDamage,
    lookahead: carrier.lookahead,
    radar: carrier.radar,
    fuelCapacity: carrier.fuelCapacity,
    fuelBurnFull: carrier.fuelBurnFull,
    fuelBurnIdle: carrier.fuelBurnIdle,
    arms: copyArms(carrier.arms),
    weapon: carrier.weapon,
    aimKind: carrier.aimKind,
    aimId: carrier.aimId,
    cooldown: carrier.cooldown,
    heat: carrier.heat,
    heatAccum: carrier.heatAccum,
    overheated: carrier.overheated,
    ordnance: carrier.ordnance,
    ordnanceCapacity: carrier.ordnanceCapacity,
    reloadRate: carrier.reloadRate,
    reloadAccum: carrier.reloadAccum,
    maxSpeedBase: carrier.maxSpeedBase,
    turnRateBase: carrier.turnRateBase,
    radarBase: carrier.radarBase,
    halfLength: carrier.halfLength,
    halfBeam: carrier.halfBeam,
    topsideHeight: carrier.topsideHeight,
    armourLossPermil: carrier.armourLossPermil,
    materials: carrier.materials,
    materialsCapacity: carrier.materialsCapacity,
    chassis: carrier.chassis,
    repairRate: carrier.repairRate,
    repairAccum: carrier.repairAccum,
    repairReported: carrier.repairReported,
    sectionDamagePermil: carrier.sectionDamagePermil,
    speedFloorPermil: carrier.speedFloorPermil,
    turnFloorPermil: carrier.turnFloorPermil,
    radarFloorPermil: carrier.radarFloorPermil,
    sections: copySections(carrier.sections),
  };
}

function copyTeam(team) {
  return {
    id: team.id,
    // Goods live ON islands now (ruling #3), so a team record carries no
    // stores of its own - only which island it has nominated as the depot
    // everything is shipped to.
    stockpileIsland: team.stockpileIsland,
    score: team.score,
  };
}

function copyEvent(event) {
  return { code: event.code, a: event.a, b: event.b, c: event.c };
}

function copyState(state) {
  const islands = [];
  for (let i = 0; i < state.islands.length; i++) islands.push(copyIsland(state.islands[i]));
  const carriers = [];
  for (let i = 0; i < state.carriers.length; i++) carriers.push(copyCarrier(state.carriers[i]));
  const units = [];
  for (let i = 0; i < state.units.length; i++) units.push(copyUnit(state.units[i]));
  const teams = [];
  for (let i = 0; i < state.teams.length; i++) teams.push(copyTeam(state.teams[i]));
  const events = [];
  for (let i = 0; i < state.events.length; i++) events.push(copyEvent(state.events[i]));
  const ai = [];
  for (let i = 0; i < state.ai.length; i++) ai.push(copyBrain(state.ai[i]));
  const shots = [];
  for (let i = 0; i < state.shots.length; i++) shots.push(copyShot(state.shots[i]));
  return {
    tick: state.tick,
    seed: state.seed,
    rng: state.rng,
    phase: state.phase,
    winner: state.winner,
    winReason: state.winReason,
    rulesHash: state.rulesHash,
    params: {
      unitsPerMetre: state.params.unitsPerMetre,
      sizeUnits: state.params.sizeUnits,
      tickHz: state.params.tickHz,
      deckHeight: state.params.deckHeight,
      recoverRange: state.params.recoverRange,
      podRange: state.params.podRange,
      podBuildTicks: state.params.podBuildTicks,
      aiCadenceTicks: state.params.aiCadenceTicks,
      aiStandoff: state.params.aiStandoff,
      victoryIslandPermil: state.params.victoryIslandPermil,
      pointCap: state.params.pointCap,
      timeCapTicks: state.params.timeCapTicks,
      pointsPerIsland: state.params.pointsPerIsland,
      pointsPerKill: state.params.pointsPerKill,
      pointsPerCarrier: state.params.pointsPerCarrier,
      hitRadiusUnit: state.params.hitRadiusUnit,
      hitRadiusCarrier: state.params.hitRadiusCarrier,
    },
    weapons: copyWeapons(state.weapons),
    loadouts: copyLoadouts(state.loadouts),
    economy: copyEconomy(state.economy),
    teams: teams,
    carriers: carriers,
    units: units,
    islands: islands,
    ai: ai,
    shots: shots,
    nextShot: state.nextShot,
    events: events,
  };
}

function createCarrier(id, team, position, carrierRules, arms, unitsPerMetre) {
  return {
    id: id,
    team: team,
    x: position.x,
    y: position.y,
    heading: 8192, // pointing into the map from the south-west corner
    speed: 0,
    throttle: 0,
    rudder: 0,
    headingHold: HEADING_MANUAL,
    hull: carrierRules.hull,
    maxHull: carrierRules.hull,
    fuel: carrierRules.fuelCapacity,
    grounded: 0,
    supplyRun: 0,
    groundAccum: 0,
    fuelAccum: 0,
    maxSpeed: carrierRules.maxSpeedUnitsPerTick,
    accel: carrierRules.accelUnitsPerTickSq,
    turnRate: carrierRules.turnRateBamPerTick,
    draught: carrierRules.draughtMetres * unitsPerMetre,
    shallowBand: carrierRules.shallowBandMetres * unitsPerMetre,
    slowestSpeed: carrierRules.slowestSpeedUnitsPerTick,
    groundDamage: carrierRules.groundedHullPer100Ticks,
    lookahead: carrierRules.lookaheadMetres * unitsPerMetre,
    radar: carrierRules.radarRangeMetres * unitsPerMetre,
    fuelCapacity: carrierRules.fuelCapacity,
    fuelBurnFull: carrierRules.fuelBurnFullPer100Ticks,
    fuelBurnIdle: carrierRules.fuelBurnIdlePer100Ticks,
    arms: arms,
    weapon: arms.length > 0 ? arms[0].w : -1,
    // Pointer mode: what the player last clicked for the ship's laser.
    aimKind: -1,
    aimId: -1,
    cooldown: 0,
    heat: 0,
    heatAccum: 0,
    overheated: 0,
    ordnance: carrierRules.ordnanceCapacity,
    ordnanceCapacity: carrierRules.ordnanceCapacity,
    reloadRate: carrierRules.reloadRoundsPer100Ticks,
    reloadAccum: 0,
    // Undamaged capability. maxSpeed, turnRate and radar above are DERIVED
    // from these and the section health, and are recomputed on every hit and
    // every repair, so the rest of the engine can keep reading them directly.
    maxSpeedBase: carrierRules.maxSpeedUnitsPerTick,
    turnRateBase: carrierRules.turnRateBamPerTick,
    radarBase: carrierRules.radarRangeMetres * unitsPerMetre,
    halfLength: mulDiv(carrierRules.lengthMetres * unitsPerMetre, 1, 2),
    halfBeam: mulDiv(carrierRules.beamMetres * unitsPerMetre, 1, 2),
    // Above the deck is the island and the mast, and a round that gets up
    // there is hitting topside whatever else it was aimed at.
    topsideHeight: carrierRules.deckHeightMetres * unitsPerMetre,
    armourLossPermil: carrierRules.armourLossPermil,
    // The ship's own yard stores. The lighter fills these; the repair system
    // spends them.
    materials: 0,
    materialsCapacity: carrierRules.materialsCapacity,
    // Replacement hulls, in parts. A factory island makes them; the boat
    // brings them; the hangar assembles one when there is a gap to fill.
    chassis: 0,
    repairRate: carrierRules.repairPointsPer100Ticks,
    repairAccum: 0,
    repairReported: 0,
    sectionDamagePermil: carrierRules.sectionDamagePermil,
    speedFloorPermil: carrierRules.speedFloorPermil,
    turnFloorPermil: carrierRules.turnFloorPermil,
    radarFloorPermil: carrierRules.radarFloorPermil,
    sections: createSections(carrierRules),
  };
}

// rules = { rules, world, units } - the parsed data/*.json, passed in by the
// app layer. The engine never reads a file.
function createInitialState(seed, rules) {
  const base = rules.rules;
  const world = rules.world;
  const unitsPerMetre = base.unitsPerMetre;
  const generated = createIslands(seed, world, unitsPerMetre);
  const starts = startPositions(generated.islands, world, unitsPerMetre, base.teamCount);

  const teams = [];
  for (let t = 0; t < base.teamCount; t++) {
    teams.push({ id: t, stockpileIsland: -1, score: 0 });
  }

  const weapons = createWeapons(rules.weapons, unitsPerMetre);
  const loadouts = createLoadouts(rules.weapons);

  const carriers = [];
  for (let t = 0; t < base.teamCount; t++) {
    carriers.push(createCarrier(
      t,
      t,
      starts[t],
      rules.units.carrier,
      createArms(loadouts[LOADOUT_CARRIER], weapons),
      unitsPerMetre,
    ));
  }
  // Team 1 starts in the far corner and looks back across the map.
  for (let i = 1; i < carriers.length; i++) carriers[i].heading = 40960;

  // Every airframe and vehicle exists from tick zero, STOWED in its hangar.
  // Launching is then a state change, not a spawn: ids are stable across a
  // whole war, and a lost Manta is a record rather than a missing one.
  const units = [];
  for (let c = 0; c < carriers.length; c++) {
    const carrier = carriers[c];
    for (let m = 0; m < rules.units.carrier.hangarMantas; m++) {
      units.push(createManta(units.length, carrier.team, carrier.id, rules, unitsPerMetre));
    }
    for (let w = 0; w < rules.units.carrier.hangarWalruses; w++) {
      units.push(createWalrus(units.length, carrier.team, carrier.id, rules, unitsPerMetre));
    }
    for (let l = 0; l < rules.units.carrier.hangarLighters; l++) {
      units.push(createLighter(units.length, carrier.team, carrier.id, rules, unitsPerMetre));
    }
  }
  // Every hull's magazines, full, from the loadout for its kind.
  for (let i = 0; i < units.length; i++) {
    units[i].arms = createArms(loadouts[units[i].kind], weapons);
    units[i].weapon = units[i].arms.length > 0 ? units[i].arms[0].w : -1;
  }
  for (let i = 0; i < units.length; i++) {
    const carrier = carriers[units[i].carrierId];
    units[i].x = carrier.x;
    units[i].y = carrier.y;
    units[i].targetX = carrier.x;
    units[i].targetY = carrier.y;
  }

  // One brain per AI-held seat. A team with no brain is a human seat; a war
  // with no brains at all is two humans, which is a legitimate configuration
  // and the one the LAN server runs.
  const ai = [];
  for (let i = 0; i < (base.aiTeams ?? []).length; i++) {
    const team = base.aiTeams[i];
    if (team < base.teamCount) ai.push(createBrain(team));
  }

  return {
    tick: 0,
    seed: seedRng(seed),
    rng: generated.rngState,
    phase: PHASE_RUNNING,
    winner: -1,
    winReason: 0,
    rulesHash: hashState(rules),
    params: {
      unitsPerMetre: unitsPerMetre,
      sizeUnits: worldSizeMetres(world) * unitsPerMetre,
      tickHz: base.tickHz,
      deckHeight: rules.units.carrier.deckHeightMetres * unitsPerMetre,
      recoverRange: rules.units.carrier.recoverRangeMetres * unitsPerMetre,
      podRange: base.podRangeMetres * unitsPerMetre,
      podBuildTicks: base.podBuildTicks,
      aiCadenceTicks: base.aiCadenceTicks,
      aiStandoff: base.aiStandoffMetres * unitsPerMetre,
      victoryIslandPermil: base.victoryIslandPermil,
      pointCap: base.pointCap,
      timeCapTicks: base.timeCapTicks,
      pointsPerIsland: base.pointsPerIslandPer100Ticks,
      pointsPerKill: base.pointsPerUnitKill,
      pointsPerCarrier: base.pointsPerCarrierSunk,
      hitRadiusUnit: base.hitRadiusUnitMetres * unitsPerMetre,
      hitRadiusCarrier: base.hitRadiusCarrierMetres * unitsPerMetre,
    },
    weapons: weapons,
    loadouts: loadouts,
    economy: createEconomy(rules.economy),
    teams: teams,
    carriers: carriers,
    units: units,
    islands: generated.islands,
    ai: ai,
    shots: [],
    nextShot: 0,
    events: [],
  };
}

export { PHASE_RUNNING, PHASE_OVER, createInitialState, copyState };
