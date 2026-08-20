// engine/flight.js - the Manta flight model.
//
// Sim-lite by ruling D2: thrust, drag, and turn rate are integer coefficients
// per airframe, there is no stall, and altitude is its own axis rather than a
// consequence of lift. What it must be is DETERMINISTIC and portable, so every
// value is an integer and every trigonometric call goes through the committed
// table.
//
// A Manta always carries some way on: below minSpeed it would be hovering,
// which this airframe only does on the deck.

import { clampI, mulDiv, stepToward, turnToward, wrapAngle } from '../shared/fixed.js';
import { atan2B, mulCos, mulSin } from '../shared/trig.js';
import { worldHeightAt } from './heightmap.js';
import {
  ORDER_HOLD,
  ORDER_MOVE,
  ORDER_RETURN,
  UNIT_LOST,
  UNIT_RETURNING,
  arrivedAtTarget,
  burnUnitFuel,
} from './units.js';

// The tallest islands out-top the cruise altitude (peaks reach 420 m, cruise
// is 400), so the autopilot flies the CONTOUR: at least this clear of the
// ground, at cruise wherever cruise is higher. The probe looks far enough
// ahead that the climb rate can actually deliver the clearance by the time the
// summit arrives - the extra height needed is small (tens of metres), but the
// climb is slow.
const TERRAIN_CLEARANCE_UNITS = 30 * 256;
const TERRAIN_PROBE_UNITS = 1400 * 256;

// What stepManta reports back to the orchestrator, which turns it into events.
const FLIGHT_NOTHING = 0;
const FLIGHT_OUT_OF_FUEL = 1;
const FLIGHT_ARRIVED = 2;
const FLIGHT_HOME = 3;

function desiredHeading(unit) {
  return atan2B(unit.targetY - unit.y, unit.targetX - unit.x);
}

// Under direct control the pilot's rudder wins; under orders the autopilot
// steers for the waypoint.
function steerManta(unit) {
  if (unit.control !== -1) {
    if (unit.rudder === 0) return unit.heading;
    return wrapAngle(unit.heading + unit.rudder * unit.turnRate);
  }
  if (unit.order === ORDER_HOLD) return unit.heading;
  return turnToward(unit.heading, desiredHeading(unit), unit.turnRate);
}

// Under orders a Manta flies at cruise; piloted, it obeys the throttle but
// never drops below the airframe minimum.
function targetSpeedFor(unit) {
  if (unit.control === -1) return unit.order === ORDER_HOLD ? unit.minSpeed : unit.maxSpeed;
  return clampI(mulDiv(unit.maxSpeed, unit.throttle, 100), unit.minSpeed, unit.maxSpeed);
}

// Where the nose should settle: cruise, or clear of the ground here and a
// probe ahead, whichever is higher. No crash mechanic - the airframe pops over
// the summit and settles back to cruise on the far side.
function targetAltitudeFor(unit, islands, sizeUnits) {
  let ground = worldHeightAt(islands, unit.x, unit.y);
  const aheadX = clampI(unit.x + mulCos(TERRAIN_PROBE_UNITS, unit.heading), 0, sizeUnits);
  const aheadY = clampI(unit.y + mulSin(TERRAIN_PROBE_UNITS, unit.heading), 0, sizeUnits);
  const ahead = worldHeightAt(islands, aheadX, aheadY);
  if (ahead > ground) ground = ahead;
  const clear = ground + TERRAIN_CLEARANCE_UNITS;
  return clear > unit.cruiseAltitude ? clear : unit.cruiseAltitude;
}

function stepManta(unit, islands, sizeUnits) {
  unit.heading = steerManta(unit);
  unit.speed = stepToward(unit.speed, targetSpeedFor(unit), unit.accel);

  unit.x = clampI(unit.x + mulCos(unit.speed, unit.heading), 0, sizeUnits);
  unit.y = clampI(unit.y + mulSin(unit.speed, unit.heading), 0, sizeUnits);
  unit.z = stepToward(unit.z, targetAltitudeFor(unit, islands, sizeUnits), unit.climbRate);

  if (burnUnitFuel(unit, unit.fuelBurn) === 1) {
    // Dry over the sea: the airframe is gone. Nothing to recover.
    unit.state = UNIT_LOST;
    unit.speed = 0;
    return FLIGHT_OUT_OF_FUEL;
  }
  if (unit.order === ORDER_MOVE && arrivedAtTarget(unit)) {
    unit.order = ORDER_HOLD;
    return FLIGHT_ARRIVED;
  }
  if (unit.state === UNIT_RETURNING && unit.order === ORDER_RETURN && arrivedAtTarget(unit)) {
    return FLIGHT_HOME;
  }
  return FLIGHT_NOTHING;
}

export {
  FLIGHT_NOTHING,
  FLIGHT_OUT_OF_FUEL,
  FLIGHT_ARRIVED,
  FLIGHT_HOME,
  TERRAIN_CLEARANCE_UNITS,
  stepManta,
  targetAltitudeFor,
  desiredHeading,
};
