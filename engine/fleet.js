// engine/fleet.js - one tick for every unit that is out.
//
// Order matters and is part of the hash: carriers move first (in the reducer),
// then each unit in id order. A returning unit re-aims at its carrier every
// tick, because the carrier it is chasing is itself under way - aiming once at
// launch would send it to where the ship used to be.

import { floorDiv, mulDiv, wrapAngle } from '../shared/fixed.js';
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
  pushEvent,
} from './events.js';
import { orderReturn, recoverUnit, withinRecoveryRange } from './hangar.js';
import { hangarOpen } from './damage.js';
import { beginDocking } from './deck.js';
import { advanceRoute, legOf } from './route.js';
import {
  KIND_MANTA,
  ORDER_ATTACK,
  ORDER_ESCORT,
  ORDER_HOLD,
  ORDER_MOVE,
  KIND_DECOY,
  KIND_DRONE,
  KIND_INTERCEPTOR,
  burnUnitFuel,
  UNIT_ACTIVE,
  UNIT_DOCKING,
  UNIT_LANDED,
  UNIT_LOST,
  UNIT_RETURNING,
  UNIT_STOWED,
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
    // A craft on final flies its approach: DOCKING is a state of the deck
    // cycle, not a parking brake. It keeps steering for the ship, which is
    // what keeps it inside the envelope while the ship is under way.
    if (unit.state !== UNIT_ACTIVE && unit.state !== UNIT_RETURNING
      && unit.state !== UNIT_DOCKING) continue;

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
        const bam = wrapAngle(carrier2.heading + patternBearing(carrier2.decoyPattern, slot));
        const station = mulDiv(state.params.decoyStation, spreadPermilOf(carrier2), 1000);
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
    const outcome = unit.kind === KIND_MANTA || unit.kind === KIND_INTERCEPTOR
      ? stepManta(unit, state.islands, sizeUnits)
      : stepWalrus(unit, state.islands, sizeUnits);

    if (outcome === FLIGHT_OUT_OF_FUEL || outcome === DRIVE_OUT_OF_FUEL) {
      pushEvent(state.events, EVT_UNIT_LOST, unit.id, unit.team, 0);
      continue;
    }
    if (outcome === FLIGHT_ARRIVED || outcome === DRIVE_ARRIVED) {
      // A mark reached is not a destination reached (ruled 2026-08-25): if
      // there is another leg, steer for it and say nothing. Arrival is what
      // happens at the END of a course.
      if (advanceRoute(unit) === 1) {
        const leg = legOf(unit);
        unit.targetX = leg.x;
        unit.targetY = leg.y;
        unit.order = ORDER_MOVE;
        continue;
      }
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
      // Coming aboard is an approach, not a snap (ruled 2026-08-25): the
      // craft enters the recovery envelope and DOCKING runs on a clock,
      // which engine/deck.js finishes. Drift back out and you come round
      // again. The stores and the fuel are still recoverUnit's business.
      // Once, at the start of the approach. Calling it every tick while the
      // craft sits in the envelope restarts the clock every tick, and the
      // approach never finishes: aircraft flew an endless final, ran dry,
      // were rebuilt at chassis cost, and the economy bled out. Seed
      // 20260818 stopped resolving at all.
      if (canLand && unit.state !== UNIT_DOCKING
        && withinRecoveryRange(unit, carrier, state.params.recoverRange)) {
        beginDocking(state, unit, carrier);
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

// Put the screen out, or bring it home. Shared by the player's command and
// the machine's judgement so both sides of a war raise the same shield.
// Returns how many decoys moved.
function setDecoyScreen(state, carrier, out) {
  let moved = 0;
  for (let i = 0; i < state.units.length; i++) {
    const unit = state.units[i];
    if (unit.carrierId !== carrier.id || unit.kind !== KIND_DECOY || unit.hp <= 0) continue;
    if (out === 1 && unit.state === UNIT_STOWED) {
      unit.state = UNIT_ACTIVE;
      unit.x = carrier.x;
      unit.y = carrier.y;
      moved = moved + 1;
    } else if (out === 0 && unit.state === UNIT_ACTIVE) {
      unit.state = UNIT_STOWED;
      unit.x = carrier.x;
      unit.y = carrier.y;
      moved = moved + 1;
    }
  }
  return moved;
}

// Where the screen sits (docs/10 gap 5, built 2026-08-26). The original had
// a whole screen for this - a plan of the ship with the drones on it, and
// buttons to move them - because WHERE the bait is decides what it baits.
// Four patterns, ship-relative, one bearing per slot:
//
//   RING    round the hull, as it has always been
//   AHEAD   a forward arc: bait between you and what you are steaming at
//   ASTERN  the same behind, for a withdrawal
//   FLANKS  two out each beam
//
// Degrees, converted to BAM at use: the table reads as a diagram this way.
const PATTERN_RING = 0;
const PATTERN_AHEAD = 1;
const PATTERN_ASTERN = 2;
const PATTERN_FLANKS = 3;
const PATTERNS = [
  [0, 90, 180, 270],
  [-30, -10, 10, 30],
  [150, 170, 190, 210],
  [75, 105, 255, 285],
];

// How far out, in per-mil of the ruleset's station distance. Close bait is
// harder for a seeker to tell from the ship; far bait pulls the round wider
// of it. The player chooses.
const SPREAD_TIGHT = 600;
const SPREAD_WIDE = 1400;

function patternBearing(pattern, slot) {
  const row = PATTERNS[pattern] === undefined ? PATTERNS[PATTERN_RING] : PATTERNS[pattern];
  const degrees = row[slot % row.length];
  return wrapAngle(Math.round((degrees * 65536) / 360));
}

function spreadPermilOf(carrier) {
  return carrier.decoySpread <= 0 ? 1000 : carrier.decoySpread;
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

export {
  PATTERN_RING,
  PATTERN_AHEAD,
  PATTERN_ASTERN,
  PATTERN_FLANKS,
  SPREAD_TIGHT,
  SPREAD_WIDE,
  patternBearing,
  setDecoyScreen,
  stepDecoyScreens,
  stepUnits,
};
