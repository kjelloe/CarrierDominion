// engine/drive.js - the Walrus amphibious drive model.
//
// The Walrus is the reason the terrain function has to be exact rather than
// approximately right: it swims across open water, crawls up a beach, and is
// stopped by a slope it cannot climb. All three decisions read the same
// heightmap the renderer draws.
//
// Slope is measured over a fixed probe distance, never over the distance this
// tick's speed happens to cover. Measuring per-step made a crawling Walrus
// unable to climb anything: integer terrain rises by at least one unit, so at
// speed 3 a one-unit step reads as a 333-per-mil cliff and the vehicle
// deadlocks - stop, accelerate, re-block, forever.

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
  damagePermil,
  leakFuel,
} from './units.js';

const DRIVE_NOTHING = 0;
const DRIVE_OUT_OF_FUEL = 1;
const DRIVE_ARRIVED = 2;
const DRIVE_HOME = 3;
const DRIVE_BLOCKED = 4;

// 2 m. Long enough that integer terrain quantisation averages out, short
// enough that it is genuinely "the ground under the next metre of track".
const SLOPE_PROBE_UNITS = 512;
// How far off the direct line the vehicle will look for a way up.
const AVOID_TURN_BAM = 8192; // 45 degrees
// And how long it commits to that detour once it starts one. Without the
// commitment the autopilot steers straight back into the slope the moment the
// probe clears, and the Walrus grinds along the same rock forever.
const AVOID_TICKS = 80;

// The surface a hull actually travels over: the ground where it is dry, the
// waterline where it is not. Measuring slope against the raw SEABED made the
// shelf around every island an unclimbable wall to anything afloat - a boat
// with a zero climb limit could not approach a beach at all, because the sand
// was rising under thirty metres of water. Only the part above the waterline
// is a hill.
function surfaceAt(islands, x, y) {
  const height = worldHeightAt(islands, x, y);
  return height > 0 ? height : 0;
}

function slopeAhead(unit, islands, surfaceHere, bam, sizeUnits) {
  const x = clampI(unit.x + mulCos(SLOPE_PROBE_UNITS, bam), 0, sizeUnits);
  const y = clampI(unit.y + mulSin(SLOPE_PROBE_UNITS, bam), 0, sizeUnits);
  const rise = surfaceAt(islands, x, y) - surfaceHere;
  // Only a climb is limited: dropping down a bank is always allowed.
  return rise > 0 ? mulDiv(rise, 1000, SLOPE_PROBE_UNITS) : 0;
}

function steerWalrus(unit) {
  if (unit.control !== -1) {
    if (unit.rudder === 0) return unit.heading;
    return wrapAngle(unit.heading + unit.rudder * agility(unit));
  }
  if (unit.avoidTicks > 0) return turnToward(unit.heading, unit.avoidHeading, agility(unit));
  if (unit.order === ORDER_HOLD) return unit.heading;
  return turnToward(unit.heading, atan2B(unit.targetY - unit.y, unit.targetX - unit.x), agility(unit));
}

// Ashore the tracks are slower than the water jets.
function agility(unit) {
  const scaled = mulDiv(unit.turnRate, damagePermil(unit), 1000);
  return scaled < 1 ? 1 : scaled;
}

function targetSpeedFor(unit, ashore, seaPermil) {
  // Damage slows the drive train in proportion (manual review, item 7).
  const sound = ashore === 1 ? unit.landSpeed : unit.maxSpeed;
  let top = mulDiv(sound, damagePermil(unit), 1000);
  // And a heavy sea slows anything punching through it (ruled 2026-08-26,
  // Q1b) - AFLOAT only. A Walrus climbing a hillside does not care what the
  // water is doing, and slowing it there would be classifying by the wrong
  // axis.
  if (ashore === 0) top = mulDiv(top, seaPermil, 1000);
  if (unit.control !== -1) return clampI(mulDiv(top, unit.throttle, 100), 0, top);
  if (unit.avoidTicks > 0) return top;
  return unit.order === ORDER_HOLD ? 0 : top;
}

// Facing a slope it cannot take, the vehicle looks 45 degrees either way and
// commits to whichever side climbs less. It is not path-finding - it is a
// driver following the contour until the way up opens.
function beginAvoidance(unit, islands, surfaceHere, sizeUnits) {
  const left = wrapAngle(unit.heading + AVOID_TURN_BAM);
  const right = wrapAngle(unit.heading - AVOID_TURN_BAM);
  const leftSlope = slopeAhead(unit, islands, surfaceHere, left, sizeUnits);
  const rightSlope = slopeAhead(unit, islands, surfaceHere, right, sizeUnits);
  unit.avoidHeading = leftSlope <= rightSlope ? left : right;
  unit.avoidTicks = AVOID_TICKS;
}

function stepWalrus(unit, islands, sizeUnits, seaPermil) {
  const heightHere = worldHeightAt(islands, unit.x, unit.y);
  const surfaceHere = heightHere > 0 ? heightHere : 0;
  const ashore = heightHere > 0 ? 1 : 0;
  if (unit.avoidTicks > 0) unit.avoidTicks = unit.avoidTicks - 1;

  unit.heading = steerWalrus(unit);
  unit.speed = stepToward(unit.speed, targetSpeedFor(unit, ashore, seaPermil), unit.accel);

  let reportBlocked = 0;
  if (slopeAhead(unit, islands, surfaceHere, unit.heading, sizeUnits) > unit.maxClimbPermil) {
    unit.speed = 0;
    reportBlocked = unit.blocked === 0 ? 1 : 0;
    unit.blocked = 1;
    if (unit.control === -1) beginAvoidance(unit, islands, surfaceHere, sizeUnits);
  } else {
    unit.blocked = 0;
    if (unit.speed !== 0) {
      unit.x = clampI(unit.x + mulCos(unit.speed, unit.heading), 0, sizeUnits);
      unit.y = clampI(unit.y + mulSin(unit.speed, unit.heading), 0, sizeUnits);
      const heightThere = worldHeightAt(islands, unit.x, unit.y);
      unit.z = heightThere > 0 ? heightThere : 0;
    }
  }

  leakFuel(unit);
  if (burnUnitFuel(unit, unit.fuelBurn) === 1) {
    unit.state = UNIT_LOST;
    unit.speed = 0;
    return DRIVE_OUT_OF_FUEL;
  }
  if (unit.order === ORDER_MOVE && arrivedAtTarget(unit)) {
    unit.order = ORDER_HOLD;
    unit.avoidTicks = 0;
    return DRIVE_ARRIVED;
  }
  if (unit.state === UNIT_RETURNING && unit.order === ORDER_RETURN && arrivedAtTarget(unit)) {
    return DRIVE_HOME;
  }
  return reportBlocked === 1 ? DRIVE_BLOCKED : DRIVE_NOTHING;
}

export {
  DRIVE_NOTHING,
  DRIVE_OUT_OF_FUEL,
  DRIVE_ARRIVED,
  DRIVE_HOME,
  DRIVE_BLOCKED,
  SLOPE_PROBE_UNITS,
  AVOID_TICKS,
  surfaceAt,
  slopeAhead,
  stepWalrus,
};
