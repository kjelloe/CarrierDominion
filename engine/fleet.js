// engine/fleet.js - one tick for every unit that is out.
//
// Order matters and is part of the hash: carriers move first (in the reducer),
// then each unit in id order. A returning unit re-aims at its carrier every
// tick, because the carrier it is chasing is itself under way - aiming once at
// launch would send it to where the ship used to be.

import { floorDiv, wrapAngle } from '../shared/fixed.js';
import { mulCos, mulSin } from '../shared/trig.js';
import { worldHeightAt } from './heightmap.js';
import {
  DRIVE_ARRIVED,
  DRIVE_BLOCKED,
  DRIVE_HOME,
  DRIVE_OUT_OF_FUEL,
  stepWalrus,
} from './drive.js';
import { FLIGHT_ARRIVED, FLIGHT_HOME, FLIGHT_LANDING, FLIGHT_OUT_OF_FUEL, stepManta } from './flight.js';
import {
  EVT_UNIT_ARRIVED,
  EVT_UNIT_BLOCKED,
  EVT_UNIT_LANDED,
  EVT_UNIT_LOST,
  EVT_UNIT_RECOVERED,
  pushEvent,
} from './events.js';
import { orderReturn, recoverUnit, withinRecoveryRange } from './hangar.js';
import { hangarOpen } from './damage.js';
import {
  KIND_MANTA,
  ORDER_ATTACK,
  ORDER_ESCORT,
  ORDER_HOLD,
  KIND_DECOY,
  KIND_DRONE,
  ORDER_LAND,
  burnUnitFuel,
  UNIT_ACTIVE,
  UNIT_LANDED,
  UNIT_LOST,
  UNIT_RETURNING,
  findCarrierById,
  fuelPermil,
} from './units.js';
import { designated } from './targeting.js';

function stepUnits(state) {
  const sizeUnits = state.params.sizeUnits;
  for (let i = 0; i < state.units.length; i++) {
    const unit = state.units[i];
    // A Manta down on a runway does not move; the island refuels it from
    // its own fuel stock, tick by tick, until the tank or the stock is done
    // (manual item 2: the Command Centre takes the aircraft and readies it).
    if (unit.state === UNIT_LANDED) {
      refuelFromIsland(state, unit);
      continue;
    }
    if (unit.state !== UNIT_ACTIVE && unit.state !== UNIT_RETURNING) continue;

    // A decoy on station rides the ship in rigid formation: four points
    // around the hull on its own heading. It neither burns nor steers -
    // if it is hit, the sweep takes it like any hull.
    if (unit.kind === KIND_DECOY) {
      if (unit.state === UNIT_ACTIVE) {
        const carrier2 = findCarrierById(state, unit.carrierId);
        if (carrier2 === -1 || carrier2.hull <= 0) {
          unit.state = UNIT_LOST;
          unit.hp = 0;
          pushEvent(state.events, EVT_UNIT_LOST, unit.id, unit.team, 0);
          continue;
        }
        const slot = decoySlot(state, unit);
        const bam = wrapAngle(carrier2.heading + slot * 16384);
        const station = state.params.decoyStation;
        unit.x = carrier2.x + mulCos(station, bam);
        unit.y = carrier2.y + mulSin(station, bam);
        unit.z = 0;
        unit.heading = carrier2.heading;
        unit.speed = carrier2.speed;
      }
      continue;
    }

    // The Viewing Drone: no orders, no helm - it climbs to its ceiling,
    // drifts back down as its endurance burns, and is gone at the water.
    if (unit.kind === KIND_DRONE) {
      const dry = burnUnitFuel(unit, unit.fuelBurn) === 1;
      if (unit.fuel > floorDiv(unit.fuelCapacity, 2) && unit.z < unit.ceiling) {
        unit.z = unit.z + unit.climbRate;
        if (unit.z > unit.ceiling) unit.z = unit.ceiling;
      } else {
        unit.z = unit.z - unit.sinkRate;
      }
      if (dry || unit.z <= 0) {
        unit.z = 0;
        unit.state = UNIT_LOST;
        unit.hp = 0;
        pushEvent(state.events, EVT_UNIT_LOST, unit.id, unit.team, 0);
      }
      continue;
    }

    const carrier = findCarrierById(state, unit.carrierId);
    if (unit.state === UNIT_RETURNING && carrier !== -1) {
      unit.targetX = carrier.x;
      unit.targetY = carrier.y;
    }
    // Escort chases its own airfield: target the ship every tick, fight
    // whatever comes into reach (fireAll already does that for any autopilot
    // hull), and break off for the deck before the tank becomes the enemy.
    if (unit.order === ORDER_ESCORT) {
      if (carrier === -1 || fuelPermil(unit) <= 300) {
        orderReturn(unit);
      } else {
        unit.targetX = carrier.x;
        unit.targetY = carrier.y;
      }
    }
    // An attack order chases: the thing it was sent at is moving, so aiming
    // once at the order would send it where the target used to be. When the
    // target is gone the order is finished - it does not wander on.
    if (unit.order === ORDER_ATTACK) {
      const mark = designated(state, unit.orderTargetKind, unit.orderTargetId);
      if (mark === -1) {
        unit.order = ORDER_HOLD;
        unit.orderTargetKind = -1;
        unit.orderTargetId = -1;
      } else {
        unit.targetX = mark.x;
        unit.targetY = mark.y;
      }
    }

    // A lighter uses the surface drive model, like a Walrus - it simply never
    // gets an order that would take it ashore.
    const outcome = unit.kind === KIND_MANTA
      ? stepManta(unit, state.islands, sizeUnits)
      : stepWalrus(unit, state.islands, sizeUnits);

    if (outcome === FLIGHT_OUT_OF_FUEL || outcome === DRIVE_OUT_OF_FUEL) {
      pushEvent(state.events, EVT_UNIT_LOST, unit.id, unit.team, 0);
      continue;
    }
    if (outcome === FLIGHT_ARRIVED || outcome === DRIVE_ARRIVED) {
      pushEvent(state.events, EVT_UNIT_ARRIVED, unit.id, unit.team, 0);
      continue;
    }
    if (outcome === DRIVE_BLOCKED) {
      pushEvent(state.events, EVT_UNIT_BLOCKED, unit.id, unit.team, 0);
      continue;
    }
    if (outcome === FLIGHT_LANDING) {
      landOnRunway(state, unit);
      continue;
    }
    if (outcome === FLIGHT_HOME || outcome === DRIVE_HOME) {
      const canLand = carrier !== -1 && hangarOpen(carrier);
      if (canLand && withinRecoveryRange(unit, carrier, state.params.recoverRange)) {
        recoverUnit(unit, carrier, state.weapons, state.presets);
        pushEvent(state.events, EVT_UNIT_RECOVERED, unit.id, unit.team, 0);
      }
    }
  }
}

// Set the aircraft down: on the strip by the node, at ground level, still.
// The order stands as LAND while parked so a relaunch is any NEW order.
function landOnRunway(state, unit) {
  const island = islandByIndex(state, unit.landedIsland);
  if (island === -1 || island.owner !== unit.team || island.runway !== 1) {
    // The runway changed hands (or was never there) while the Manta was
    // inbound: the approach becomes a holding pattern, not a capture.
    unit.order = ORDER_HOLD;
    return;
  }
  unit.state = UNIT_LANDED;
  unit.landedIsland = island.id;
  unit.speed = 0;
  unit.throttle = 0;
  unit.control = -1;
  unit.z = worldHeightAt(state.islands, unit.x, unit.y);
  if (unit.z < 0) unit.z = 0;
  pushEvent(state.events, EVT_UNIT_LANDED, unit.id, unit.team, island.id);
}

function islandByIndex(state, id) {
  if (id < 0 || id >= state.islands.length) return -1;
  return state.islands[id];
}

// The island's own fuel stock feeds the parked aircraft - goods have a
// location, and this fuel never touched the carrier's bunker.
const RUNWAY_REFUEL_PER_100 = 4000;

function refuelFromIsland(state, unit) {
  const island = islandByIndex(state, unit.landedIsland);
  if (island === -1 || island.owner !== unit.team || island.runway !== 1) {
    // The ground changed owner under a parked aircraft: it is captured with
    // the island - the plainest reading of "the works change hands".
    unit.state = UNIT_LOST;
    unit.hp = 0;
    unit.landedIsland = -1;
    pushEvent(state.events, EVT_UNIT_LOST, unit.id, unit.team, 0);
    return;
  }
  if (unit.fuel >= unit.fuelCapacity || island.stockFuel <= 0) return;
  const accum = unit.fuelAccum + RUNWAY_REFUEL_PER_100;
  const move = floorDiv(accum, 100);
  unit.fuelAccum = accum - move * 100;
  let taken = move;
  if (taken > island.stockFuel) taken = island.stockFuel;
  if (taken > unit.fuelCapacity - unit.fuel) taken = unit.fuelCapacity - unit.fuel;
  island.stockFuel = island.stockFuel - taken;
  unit.fuel = unit.fuel + taken;
}

// Which of the four stations this decoy holds: its rank among its ship's
// own decoys, stable because unit ids are stable for the whole war.
function decoySlot(state, unit) {
  let slot = 0;
  for (let i = 0; i < state.units.length; i++) {
    const other = state.units[i];
    if (other.carrierId !== unit.carrierId || other.kind !== KIND_DECOY) continue;
    if (other.id === unit.id) break;
    slot += 1;
  }
  return slot;
}

// The screen's price: the ship pays a quarter of her top speed while any
// decoy rides out. Recomputed every tick from what is actually deployed,
// so the last decoy dying lifts the penalty by itself.
function stepDecoyScreens(state) {
  for (let c = 0; c < state.carriers.length; c++) {
    const carrier = state.carriers[c];
    let out = 0;
    for (let i = 0; i < state.units.length; i++) {
      const unit = state.units[i];
      if (unit.carrierId === carrier.id && unit.kind === KIND_DECOY
        && unit.state === UNIT_ACTIVE && unit.hp > 0) out = 1;
    }
    carrier.decoysOut = out;
  }
}

export { stepUnits, stepDecoyScreens };
