// engine/state.js - state construction and the deep copy the reducer relies on.
//
// copyState deep-copies EVERY nested array and object. Sibling projects each
// lost a day to an aliasing bug where one forgotten array let a "previous"
// state mutate under a replay; the rule here is that a new entity kind is not
// done until it has a line in both createInitialState and copyState.
//
// No value in state may be null, undefined, or fractional. Absence is -1.

import { mulDiv } from '../shared/fixed.js';
import { atan2B } from '../shared/trig.js';
import { hashState } from '../shared/statehash.js';
import { seedRng } from '../shared/prng.js';
import { HEADING_MANUAL } from './commands.js';
import { KIND_DECOY, KIND_DRONE, copyUnit, createDecoy, createDrone, createLighter, createManta, createWalrus } from './units.js';
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
import { copyContacts } from './contacts.js';
import { copySections, createSections } from './damage.js';
import { copyTurrets } from './turret.js';
import { createIslands, startPositions, worldSizeMetres } from './worldgen.js';
import { prepareActionStart, prepareHomeIslands } from './action_start.js';

function presetsFrom(presetRules) {
  const out = [];
  const fills = presetRules === undefined ? [[1000, 1000, 1000, 1000]] : presetRules.fills;
  for (let i = 0; i < fills.length; i++) out.push(fills[i].slice());
  return out;
}

function copyPresets(presets) {
  const out = [];
  for (let i = 0; i < presets.length; i++) out.push(presets[i].slice());
  return out;
}

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
    virusTeam: island.virusTeam,
    virusTicks: island.virusTicks,
    virusVictim: island.virusVictim,
    stockFuel: island.stockFuel,
    stockMaterials: island.stockMaterials,
    stockOrdnance: island.stockOrdnance,
    stockChassis: island.stockChassis,
    role: island.role,
    factories: island.factories,
    warehouses: island.warehouses,
    turrets: island.turrets,
    runway: island.runway,
    nodeHp: island.nodeHp,
    nodeZ: island.nodeZ,
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
    flareCost: carrier.flareCost,
    flareReload: carrier.flareReload,
    flareRadius: carrier.flareRadius,
    flareCooldown: carrier.flareCooldown,
    podMaterials: carrier.podMaterials,
    virusOrdnance: carrier.virusOrdnance,
    courseX: carrier.courseX,
    courseY: carrier.courseY,
    upSpeed: carrier.upSpeed,
    upPd: carrier.upPd,
    upRadar: carrier.upRadar,
    mantaPreset: carrier.mantaPreset,
    hammerRounds: carrier.hammerRounds,
    hammerCooldown: carrier.hammerCooldown,
    decoysOut: carrier.decoysOut,
    decoyPenalty: carrier.decoyPenalty,
    maxSpeedUpgraded: carrier.maxSpeedUpgraded,
    radarUpgraded: carrier.radarUpgraded,
    pdCooldownUpgraded: carrier.pdCooldownUpgraded,
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
    // The quartermaster's production bias (ruling 2026-08-23): LOW 0,
    // MEDIUM 1, HIGH 2 per output category, reweighting every factory run.
    biasFuel: team.biasFuel,
    biasOrdnance: team.biasOrdnance,
    biasChassis: team.biasChassis,
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
      virusRange: state.params.virusRange,
      virusBuildTicks: state.params.virusBuildTicks,
      aiCadenceTicks: state.params.aiCadenceTicks,
      aiStandoff: state.params.aiStandoff,
      telemetryFade: state.params.telemetryFade,
      telemetryLoss: state.params.telemetryLoss,
      commandCentreHp: state.params.commandCentreHp,
      decoyStation: state.params.decoyStation,
      decoySeduce: state.params.decoySeduce,
      victoryIslandPermil: state.params.victoryIslandPermil,
      pointCap: state.params.pointCap,
      timeCapTicks: state.params.timeCapTicks,
      pointsPerIsland: state.params.pointsPerIsland,
      pointsPerKill: state.params.pointsPerKill,
      pointsPerCarrier: state.params.pointsPerCarrier,
      hitRadiusUnit: state.params.hitRadiusUnit,
      hitRadiusCarrier: state.params.hitRadiusCarrier,
      hitRadiusTurret: state.params.hitRadiusTurret,
      turretRing: state.params.turretRing,
      turretHull: state.params.turretHull,
    },
    weapons: copyWeapons(state.weapons),
    loadouts: copyLoadouts(state.loadouts),
    presets: copyPresets(state.presets),
    economy: copyEconomy(state.economy),
    teams: teams,
    carriers: carriers,
    units: units,
    islands: islands,
    ai: ai,
    shots: shots,
    nextShot: state.nextShot,
    turrets: copyTurrets(state.turrets),
    nextTurret: state.nextTurret,
    contacts: copyContacts(state.contacts),
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
    // Decoy flares: a burst costs ordnance out of the same store that feeds
    // the guns, so defending yourself and arming yourself compete.
    flareCost: carrierRules.flareOrdnance,
    flareReload: carrierRules.flareReloadTicks,
    flareRadius: carrierRules.flareRadiusMetres * unitsPerMetre,
    flareCooldown: 0,
    // What the ship's stores charge for a Walrus payload: an ACCB pod is a
    // construction device and costs materials; a virus bomb is a munition and
    // costs ordnance. Ruling #3 - neither is conjured.
    podMaterials: carrierRules.podMaterials,
    virusOrdnance: carrierRules.virusOrdnance,
    // The programmed course (ruling 2026-08-23, the original's PROG + A):
    // -1 is no course. The autopilot steers; the throttle stays yours.
    courseX: -1,
    courseY: -1,
    // The three upgrades (ruling 2026-08-23): built at a factory island you
    // hold, once each. A richer tech tree is noted for later.
    upSpeed: 0,
    upPd: 0,
    upRadar: 0,
    // The launch loadout preset for the air group (ruled 2026-08-25):
    // 0 balanced, 1 scout, 2 bomber, 3 interceptor - data in weapons.json.
    mantaPreset: 0,
    // The Hammerhead battery (ruled 2026-08-25): rounds aboard and the
    // launcher's cooldown. Fired only through a Viewing Drone's picture.
    hammerRounds: carrierRules.hammerheadRounds === undefined ? 0 : carrierRules.hammerheadRounds,
    hammerCooldown: 0,
    // The decoy screen: 1 while any decoy rides out, and the top-speed
    // price the ship pays for it (both from data at build time).
    decoysOut: 0,
    decoyPenalty: 0,
    maxSpeedUpgraded: carrierRules.maxSpeedUpgradedUnitsPerTick,
    radarUpgraded: carrierRules.radarUpgradedRangeMetres * unitsPerMetre,
    pdCooldownUpgraded: carrierRules.pdUpgradedCooldownTicks,
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
    // The ship's own yard stores. The lighter refills these; the repair system
    // and the pod locker spend them. The ship SAILS with a finite issue, like
    // its bunker and its ordnance - enough for the opening moves, not the war.
    materials: carrierRules.startMaterials,
    materialsCapacity: carrierRules.materialsCapacity,
    // Replacement hulls, in parts. A factory island makes them, the boat brings
    // them, and the hangar assembles one when there is a gap to fill. The ship
    // sails with none: a reserve aboard only resurrected the first loss for
    // free, and the deadlock it was meant to cover is handled ashore instead
    // (engine/supply.js dispatchBoat).
    chassis: carrierRules.startChassis,
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
    teams.push({ id: t, stockpileIsland: -1, score: 0, biasFuel: 1, biasOrdnance: 1, biasChassis: 1 });
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
  // Team 1 starts in the far corner and looks back across the map. A bigger
  // table (>2 teams) sits around a ring, and everyone faces the middle - the
  // two-team headings stay exactly as pinned.
  if (base.teamCount <= 2) {
    for (let i = 1; i < carriers.length; i++) carriers[i].heading = 40960;
  } else {
    const centre = mulDiv(worldSizeMetres(world) * unitsPerMetre, 1, 2);
    for (let i = 0; i < carriers.length; i++) {
      carriers[i].heading = atan2B(centre - carriers[i].y, centre - carriers[i].x);
    }
  }

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
    // The Viewing Drones (ruled 2026-08-25): aboard from tick zero like
    // every hull - launching is a state change, not a spawn.
    const droneCount = rules.units.drone === undefined ? 0 : rules.units.drone.perCarrier;
    for (let d = 0; d < droneCount; d++) {
      units.push(createDrone(units.length, carrier.team, carrier.id, rules, unitsPerMetre));
    }
    carrier.decoyPenalty = rules.units.decoy === undefined
      ? 0 : rules.units.decoy.speedPenaltyPermil;
    const decoyCount = rules.units.decoy === undefined ? 0 : rules.units.decoy.perCarrier;
    for (let d = 0; d < decoyCount; d++) {
      units.push(createDecoy(units.length, carrier.team, carrier.id, rules, unitsPerMetre));
    }
  }
  // Every hull's magazines, full, from the loadout for its kind. The
  // Viewing Drone (kind 3) is unarmed - and loadouts[3] is the CARRIER's
  // battery, an index collision that must never reach a unit.
  for (let i = 0; i < units.length; i++) {
    if (units[i].kind === KIND_DRONE || units[i].kind === KIND_DECOY) continue;
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

  const state = {
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
      virusRange: base.virusRangeMetres * unitsPerMetre,
      virusBuildTicks: base.virusBuildTicks,
      aiCadenceTicks: base.aiCadenceTicks,
      aiStandoff: base.aiStandoffMetres * unitsPerMetre,
      // The telemetry leash (manual coverage review, item 1): a remote
      // drone's picture fades past FADE and the link dies at LOSS.
      telemetryFade: base.telemetryFadeMetres * unitsPerMetre,
      telemetryLoss: base.telemetryLossMetres * unitsPerMetre,
      // The command centre's Neutron Shields (second source review, item
      // 1): what "vast quantities of firepower" has to chew through.
      commandCentreHp: base.commandCentreHp,
      // The decoy screen's geometry (units.decoy is otherwise per-hull data).
      decoyStation: rules.units.decoy === undefined
        ? 0 : rules.units.decoy.stationMetres * unitsPerMetre,
      decoySeduce: rules.units.decoy === undefined
        ? 0 : rules.units.decoy.seduceRadiusMetres * unitsPerMetre,
      victoryIslandPermil: base.victoryIslandPermil,
      pointCap: base.pointCap,
      timeCapTicks: base.timeCapTicks,
      pointsPerIsland: base.pointsPerIslandPer100Ticks,
      pointsPerKill: base.pointsPerUnitKill,
      pointsPerCarrier: base.pointsPerCarrierSunk,
      hitRadiusUnit: base.hitRadiusUnitMetres * unitsPerMetre,
      hitRadiusCarrier: base.hitRadiusCarrierMetres * unitsPerMetre,
      hitRadiusTurret: base.hitRadiusTurretMetres * unitsPerMetre,
      turretRing: base.turretRingPermil,
      turretHull: base.turretHull,
    },
    weapons: weapons,
    loadouts: loadouts,
    // Launch loadout presets: fill permil per Manta arm, straight from
    // data/weapons.json - the fitting screen's faithful-light middle.
    presets: presetsFrom(rules.weapons.mantaPresets),
    economy: createEconomy(rules.economy),
    teams: teams,
    carriers: carriers,
    units: units,
    islands: generated.islands,
    ai: ai,
    shots: [],
    nextShot: 0,
    turrets: [],
    nextTurret: 0,
    // What each team remembers seeing (engine/contacts.js). Empty at the
    // start: nobody has seen anything yet.
    contacts: [],
    events: [],
  };
  // The Action Game (ruling 2026-08-23): the war pre-developed at tick zero.
  // Inside createInitialState on purpose - the flag is a RULE, hashed with
  // the rest, so a replay of an action war is an action war.
  if (base.actionStart === 1) prepareActionStart(state);
  else if (base.homeIslandStart === 1) prepareHomeIslands(state);
  return state;
}

export { PHASE_RUNNING, PHASE_OVER, createInitialState, copyState };
