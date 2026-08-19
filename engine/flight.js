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
import {
  ORDER_HOLD,
  ORDER_MOVE,
  ORDER_RETURN,
  UNIT_LOST,
  UNIT_RETURNING,
  arrivedAtTarget,
  burnUnitFuel,
} from './units.js';

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

function stepManta(unit, sizeUnits) {
  unit.heading = steerManta(unit);
  unit.speed = stepToward(unit.speed, targetSpeedFor(unit), unit.accel);

  unit.x = clampI(unit.x + mulCos(unit.speed, unit.heading), 0, sizeUnits);
  unit.y = clampI(unit.y + mulSin(unit.speed, unit.heading), 0, sizeUnits);
  unit.z = stepToward(unit.z, unit.cruiseAltitude, unit.climbRate);

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
  stepManta,
  desiredHeading,
};
