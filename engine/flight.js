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

import { clampI, dist2D, mulDiv, stepToward, turnToward, wrapAngle } from '../shared/fixed.js';
import { atan2B, mulCos, mulSin } from '../shared/trig.js';
import { worldHeightAt } from './heightmap.js';
import {
  ORDER_HOLD,
  ORDER_LAND,
  ORDER_MOVE,
  ORDER_RETURN,
  UNIT_LOST,
  UNIT_RETURNING,
  arrivedAtTarget,
  burnUnitFuel,
  damagePermil,
  leakFuel,
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
// 5, not 4: fleet.js compares FLIGHT and DRIVE outcomes in one chain, and
// DRIVE_BLOCKED is already 4 - a landing that reads as "blocked" parks the
// approach in a holding pattern forever (found the measured way).
const FLIGHT_LANDING = 5;
// The approach (manual item 2: "decrease in speed as you near the runway"):
// inside APPROACH the Manta slows to minimum flying speed - its turning
// circle shrinks with it - and the strip catches it inside CAPTURE. Without
// the slowdown a fast Manta's turn radius exceeds the capture ring and it
// orbits the airfield until the tank is dry (measured: a 425 m orbit).
const LAND_APPROACH_UNITS = 512000; // 2,000 m
const LAND_CAPTURE_UNITS = 128000; // 500 m
const FLIGHT_HOME = 3;

function desiredHeading(unit) {
  return atan2B(unit.targetY - unit.y, unit.targetX - unit.x);
}

// Under direct control the pilot's rudder wins; under orders the autopilot
// steers for the waypoint.
function steerManta(unit) {
  if (unit.control !== -1) {
    if (unit.rudder === 0) return unit.heading;
    return wrapAngle(unit.heading + unit.rudder * agility(unit));
  }
  if (unit.order === ORDER_HOLD) return unit.heading;
  return turnToward(unit.heading, desiredHeading(unit), agility(unit));
}

// Under orders a Manta flies at cruise; piloted, it obeys the throttle but
// never drops below the airframe minimum.
// Maneuverability degrades with the same proportion as speed.
function agility(unit) {
  const scaled = mulDiv(unit.turnRate, damagePermil(unit), 1000);
  return scaled < 1 ? 1 : scaled;
}

function targetSpeedFor(unit) {
  // Damage slows the airframe in proportion (manual review, item 7), but
  // never below flying speed - the anti-stall hardware has never yet failed.
  const top = mulDiv(unit.maxSpeed, damagePermil(unit), 1000);
  const ceiling = top < unit.minSpeed ? unit.minSpeed : top;
  if (unit.order === ORDER_LAND
    && dist2D(unit.x, unit.y, unit.targetX, unit.targetY) <= LAND_APPROACH_UNITS) {
    return unit.minSpeed;
  }
  if (unit.control === -1) return unit.order === ORDER_HOLD ? unit.minSpeed : ceiling;
  return clampI(mulDiv(ceiling, unit.throttle, 100), unit.minSpeed, ceiling);
}

// How low an aircraft may fly: wavetop height. Low enough to duck under a
// radar horizon in spirit, high enough that the sea is scenery rather than a
// wall. In calm water this is the rule's calm figure; in a gale the wavetops
// come up to meet the pilot and the floor rises with them (ruled 2026-08-26,
// Q1b), which is why the floor arrives as an argument rather than living
// here as a constant. This is the calm-water figure, and the default for
// callers that have no weather to hand (tests, mostly).
const PILOT_FLOOR_UNITS = 12 * 256;

// Where the nose should settle. The autopilot flies cruise; a PILOT flies the
// stick - climb toward the ceiling, dive toward the wavetops, or hold what
// they have. Terrain always wins upward, whoever is flying: the no-crash
// ruling holds for a pilot diving at a hillside too, and the contour probe
// simply out-votes the stick until the rock is behind them.
function targetAltitudeFor(unit, islands, sizeUnits, floorUnits) {
  const floor = floorUnits === undefined ? PILOT_FLOOR_UNITS : floorUnits;
  let ground = worldHeightAt(islands, unit.x, unit.y);
  const aheadX = clampI(unit.x + mulCos(TERRAIN_PROBE_UNITS, unit.heading), 0, sizeUnits);
  const aheadY = clampI(unit.y + mulSin(TERRAIN_PROBE_UNITS, unit.heading), 0, sizeUnits);
  const ahead = worldHeightAt(islands, aheadX, aheadY);
  if (ahead > ground) ground = ahead;
  const clear = ground + TERRAIN_CLEARANCE_UNITS;
  let wanted = unit.cruiseAltitude;
  if (unit.control !== -1) {
    if (unit.climb > 0) wanted = unit.ceiling;
    else if (unit.climb < 0) wanted = floor;
    else wanted = unit.z;
  }
  // The sea floor binds the AIRCRAFT, not the stick. The AI cruises far above
  // it and is unaffected today, but if it ever learns to attack low the rule
  // already covers it - a limit that binds only the human is a limit the
  // human reads as the game cheating.
  if (wanted < floor) wanted = floor;
  return clear > wanted ? clear : wanted;
}

function stepManta(unit, islands, sizeUnits, floorUnits) {
  unit.heading = steerManta(unit);
  unit.speed = stepToward(unit.speed, targetSpeedFor(unit), unit.accel);

  unit.x = clampI(unit.x + mulCos(unit.speed, unit.heading), 0, sizeUnits);
  unit.y = clampI(unit.y + mulSin(unit.speed, unit.heading), 0, sizeUnits);
  unit.z = stepToward(unit.z, targetAltitudeFor(unit, islands, sizeUnits, floorUnits), unit.climbRate);

  leakFuel(unit);
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
  if (unit.order === ORDER_LAND
    && dist2D(unit.x, unit.y, unit.targetX, unit.targetY) <= LAND_CAPTURE_UNITS) {
    return FLIGHT_LANDING;
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
  FLIGHT_LANDING,
  TERRAIN_CLEARANCE_UNITS,
  PILOT_FLOOR_UNITS,
  stepManta,
  targetAltitudeFor,
  desiredHeading,
};
