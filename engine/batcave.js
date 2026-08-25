// engine/batcave.js - the island's own teeth (ruled 2026-08-25, both).
//
// BAT CAVES: a Defence island scrambles droid interceptors - the original's
// Marauders - when a hostile hull enters its ring. They fly the ordinary
// flight model with an ATTACK order and the ordinary autopilot trigger
// discipline, park at home when the sky clears, are leashed to their own
// island, and are rebuilt from the island's materials when lost. They are a
// deliberate exception to units-from-tick-zero: they belong to islands, not
// the complement, and appear when first scrambled.
//
// NEUTRAL SILOS: every unowned island keeps one token missile silo from the
// day the map is made - team -1, six rounds, no resupply - so taking even a
// free island costs something (CRASH: "all the islands have missile
// silos"). Capture clears it with the rest of the previous tenancy.

import { dist2D } from '../shared/fixed.js';
import { EVT_UNIT_LOST, pushEvent } from './events.js';
import { createArms } from './weapons.js';
import { createTurret } from './turret.js';
import {
  KIND_INTERCEPTOR,
  ORDER_ATTACK,
  ORDER_HOLD,
  UNIT_ACTIVE,
  UNIT_LOST,
  UNIT_STOWED,
  createInterceptor,
} from './units.js';
import { ROLE_DEFENCE } from './island.js';

// Loadout row 6 (engine/weapons.js createLoadouts): laser + seekers.
const LOADOUT_INTERCEPTOR = 6;

// The airframe's raw stats ride params as a flat integer row (hashed like
// everything else); a synthetic ruleset hands them back to the creator.
function rulesFromRaw(raw) {
  return { units: { interceptor: {
    hull: raw[0],
    maxSpeedUnitsPerTick: raw[1],
    minSpeedUnitsPerTick: raw[2],
    accelUnitsPerTickSq: raw[3],
    turnRateBamPerTick: raw[4],
    cruiseAltitudeMetres: raw[5],
    ceilingMetres: raw[6],
    climbRateUnitsPerTick: raw[7],
    radarRangeMetres: raw[8],
    fuelCapacity: raw[9],
    fuelBurnPer100Ticks: raw[10],
    arriveRadiusMetres: raw[11],
  } } };
}

// The nearest hostile hull inside the island's ring, or -1. Carriers and
// units both wake the cave; the lighter does too - a supply run into a
// defended anchorage SHOULD be a risk.
function intruderNear(state, island, ring) {
  let best = -1;
  let bestDistance = 2147483647;
  for (let i = 0; i < state.carriers.length; i++) {
    const carrier = state.carriers[i];
    if (carrier.team === island.owner || carrier.hull <= 0) continue;
    const range = dist2D(carrier.x, carrier.y, island.x, island.y);
    if (range <= ring && range < bestDistance) {
      bestDistance = range;
      best = { kind: 1, id: carrier.id, x: carrier.x, y: carrier.y };
    }
  }
  for (let i = 0; i < state.units.length; i++) {
    const unit = state.units[i];
    if (unit.team === island.owner || unit.hp <= 0) continue;
    if (unit.state !== UNIT_ACTIVE && unit.state !== 2) continue;
    const range = dist2D(unit.x, unit.y, island.x, island.y);
    if (range <= ring && range < bestDistance) {
      bestDistance = range;
      best = { kind: 0, id: unit.id, x: unit.x, y: unit.y };
    }
  }
  return best;
}

function ownInterceptors(state, island) {
  const out = [];
  for (let i = 0; i < state.units.length; i++) {
    const unit = state.units[i];
    if (unit.kind === KIND_INTERCEPTOR && unit.landedIsland === island.id) out.push(unit);
  }
  return out;
}

function scramble(state, island, unit) {
  unit.state = UNIT_ACTIVE;
  unit.x = island.nodeX;
  unit.y = island.nodeY;
  unit.z = island.nodeZ + 20 * state.params.unitsPerMetre;
  unit.heading = 0;
  unit.fuel = unit.fuelCapacity;
  unit.throttle = 100;
  unit.control = -1;
}

function stepBatcaves(state) {
  const p = state.params;
  if (p.icPerIsland === undefined || p.icPerIsland <= 0) return;
  for (let i = 0; i < state.islands.length; i++) {
    const island = state.islands[i];
    const wing = ownInterceptors(state, island);

    // A cave whose island fell takes its parked aircraft with it, and any
    // still airborne lose the island that was flying them.
    const caveAlive = island.owner !== -1 && island.role === ROLE_DEFENCE;
    if (!caveAlive) {
      for (const unit of wing) {
        if (unit.state === UNIT_LOST) continue;
        if (unit.team === island.owner && island.owner !== -1) continue;
        unit.state = UNIT_LOST;
        unit.hp = 0;
        pushEvent(state.events, EVT_UNIT_LOST, unit.id, unit.team, 0);
      }
      continue;
    }

    const intruder = intruderNear(state, island, p.icPatrol);
    const live = wing.filter((unit) => unit.state !== UNIT_LOST && unit.team === island.owner);

    // Rebuild: a lost airframe is replaced from the island's own materials,
    // one per rebuild period, only while the cave stands.
    if (live.length < p.icPerIsland) {
      if (island.caveTicks > 0) island.caveTicks = island.caveTicks - 1;
      else if (island.stockMaterials >= p.icRebuildMaterials) {
        island.stockMaterials = island.stockMaterials - p.icRebuildMaterials;
        island.caveTicks = p.icRebuildTicks;
        const fresh = createInterceptor(
          state.units.length, island.owner, island.id,
          rulesFromRaw(p.icRaw), p.unitsPerMetre,
        );
        fresh.arms = createArms(state.loadouts[LOADOUT_INTERCEPTOR], state.weapons);
        fresh.weapon = fresh.arms.length > 0 ? fresh.arms[0].w : -1;
        state.units.push(fresh);
      }
    }

    for (const unit of live) {
      const distance = dist2D(unit.x, unit.y, island.x, island.y);
      if (unit.state === UNIT_STOWED) {
        if (intruder !== -1) scramble(state, island, unit);
        continue;
      }
      if (unit.state !== UNIT_ACTIVE) continue;
      // The leash: an interceptor never chases past its island's reach.
      if (distance > p.icLeash || intruder === -1) {
        // Home and park: near enough, it just lands.
        if (dist2D(unit.x, unit.y, island.nodeX, island.nodeY) <= p.icPark) {
          unit.state = UNIT_STOWED;
          unit.order = ORDER_HOLD;
          unit.x = island.nodeX;
          unit.y = island.nodeY;
          unit.z = island.nodeZ;
          unit.speed = 0;
        } else {
          unit.order = 1; // ORDER_MOVE home
          unit.targetX = island.nodeX;
          unit.targetY = island.nodeY;
          unit.orderTargetKind = -1;
          unit.orderTargetId = -1;
        }
        continue;
      }
      // Press the intruder: the ordinary attack order; the ordinary
      // autopilot trigger discipline does the shooting.
      unit.order = ORDER_ATTACK;
      unit.orderTargetKind = intruder.kind;
      unit.orderTargetId = intruder.id;
      unit.targetX = intruder.x;
      unit.targetY = intruder.y;
    }
  }
}

// One token missile silo on every island at worldgen time, team -1, six
// rounds, no resupply. Called once from createInitialState, before any
// start develops anything.
function raiseNeutralSilos(state, rounds) {
  if (rounds <= 0) return;
  for (let i = 0; i < state.islands.length; i++) {
    const island = state.islands[i];
    const arms = createArms(state.loadouts[5], state.weapons); // turretMissile
    for (let a = 0; a < arms.length; a++) {
      arms[a].n = arms[a].n < rounds ? arms[a].n : rounds;
    }
    const silo = createTurret(
      state, island, 1, state.params, state.weapons, state.loadouts, arms,
    );
    silo.team = -1;
    state.nextTurret = state.nextTurret + 1;
    state.turrets.push(silo);
    // NOT island.turrets: that counter is the OWNER'S works, and a token
    // silo on unclaimed rock is a feature of the map. Counting it made
    // anythingBuilt() true on every island, which froze every role choice.
  }
}

export { stepBatcaves, raiseNeutralSilos, LOADOUT_INTERCEPTOR };
