// engine/carrier.js - helm handling and carrier movement integration.
//
// Order per tick, and it matters for the hash: turn, then work out how much
// water is under the keel, then accelerate against that limit, then translate,
// then test the bow, then burn fuel, then take grounding damage.
//
// Shoal behaviour has three stages, which is the whole point of the shallow
// shelf around every island: in shoaling water the ship SLOWS, on the shelf
// itself it HALTS, and held there it takes hull damage until it is steered
// clear. Backing off works by reversing the helm, never by teleporting.

import { clampI, dist2D, floorDiv, mulDiv, stepToward, turnToward, wrapAngle } from '../shared/fixed.js';
import { atan2B, mulCos, mulSin } from '../shared/trig.js';
import { HEADING_MANUAL } from './commands.js';
import {
  EVT_CARRIER_DAMAGED,
  EVT_CARRIER_GROUNDED,
  EVT_CARRIER_SUNK,
  EVT_COURSE,
  EVT_FUEL_EMPTY,
  EVT_FUEL_RESTORED,
  pushEvent,
} from './events.js';
import { worldHeightAt } from './heightmap.js';

// The keel clears terrain shallower than this; -draught is the waterline depth
// the hull needs.
function grounds(islands, x, y, draught) {
  return worldHeightAt(islands, x, y) > -draught;
}

// Water under the keel at a point, in fixed units. Negative means the ground
// is already above the keel line.
function clearanceAt(islands, x, y, draught) {
  return -worldHeightAt(islands, x, y) - draught;
}

// Close enough to call the course sailed: half a kilometre, which is inside
// the recovery circle and well clear of any island's shallows.
const COURSE_ARRIVE_UNITS = 500 * 256;

function steer(carrier) {
  // A programmed course steers for the mark every tick, because the mark
  // does not move but the ship's idea of "toward it" does.
  if (carrier.courseX >= 0) {
    return turnToward(
      carrier.heading,
      atan2B(carrier.courseY - carrier.y, carrier.courseX - carrier.x),
      carrier.turnRate,
    );
  }
  if (carrier.headingHold !== HEADING_MANUAL) {
    return turnToward(carrier.heading, carrier.headingHold, carrier.turnRate);
  }
  if (carrier.rudder === 0) return carrier.heading;
  return wrapAngle(carrier.heading + carrier.rudder * carrier.turnRate);
}

// A master who feels the bottom coming up eases the throttle. Inside the
// shallow band the ship's top speed falls off linearly with the water left
// under the keel, so shoaling water is felt before it is hit.
function shoalLimit(carrier, clearance) {
  if (clearance >= carrier.shallowBand) return carrier.maxSpeed;
  if (clearance <= 0) return 0;
  const limited = mulDiv(carrier.maxSpeed, clearance, carrier.shallowBand);
  return limited < carrier.slowestSpeed ? carrier.slowestSpeed : limited;
}

function burnFuel(carrier) {
  // Astern burns like ahead: the engines do not care which way they push.
  const open = carrier.throttle < 0 ? -carrier.throttle : carrier.throttle;
  const perHundred = carrier.fuelBurnIdle
    + mulDiv(carrier.fuelBurnFull - carrier.fuelBurnIdle, open, 100);
  const accum = carrier.fuelAccum + perHundred;
  const spent = floorDiv(accum, 100);
  carrier.fuelAccum = accum - spent * 100;
  carrier.fuel = carrier.fuel - spent;
  if (carrier.fuel < 0) carrier.fuel = 0;
}

// Sitting on a shelf works the hull. Damage accrues per 100 ticks, like fuel,
// so the rate can be a fraction of a hull point.
function grindHull(carrier, events) {
  const accum = carrier.groundAccum + carrier.groundDamage;
  const taken = floorDiv(accum, 100);
  carrier.groundAccum = accum - taken * 100;
  if (taken <= 0) return;
  const before = carrier.hull;
  carrier.hull = carrier.hull - taken;
  if (carrier.hull < 0) carrier.hull = 0;
  pushEvent(events, EVT_CARRIER_DAMAGED, carrier.id, carrier.team, before - carrier.hull);
  if (carrier.hull === 0 && before > 0) {
    pushEvent(events, EVT_CARRIER_SUNK, carrier.id, carrier.team, 0);
  }
}

function stepCarrier(carrier, islands, sizeUnits, events) {
  if (carrier.hull <= 0) {
    carrier.speed = 0;
    return;
  }
  const hadFuel = carrier.fuel > 0;
  carrier.heading = steer(carrier);

  const clearance = clearanceAt(islands, carrier.x, carrier.y, carrier.draught);
  // A negative throttle is the astern gear (manual coverage review, item
  // 4): a quarter of the scale, like the original's speed indicator. The
  // shallow-water limit binds the MAGNITUDE either way.
  let targetSpeed = mulDiv(carrier.maxSpeed, carrier.throttle, 100);
  const limit = shoalLimit(carrier, clearance);
  if (targetSpeed > limit) targetSpeed = limit;
  if (targetSpeed < -limit) targetSpeed = -limit;
  if (!hadFuel) targetSpeed = 0;
  carrier.speed = stepToward(carrier.speed, targetSpeed, carrier.accel);

  // The bow is tested a fixed distance ahead, not just at the next position:
  // at one unit per tick a hull would otherwise creep into a shoal and
  // re-report grounding on every tick. With a lookahead, a ship pinned against
  // a shore stays grounded (and reports once) until it is steered clear.
  // Making sternway, it is the STERN that feels the bottom coming up - the
  // lookahead swings aft, which is also what lets a grounded ship BACK OFF
  // the reef instead of being pinned by her own bow test.
  const wayAft = carrier.speed < 0 || (carrier.speed === 0 && carrier.throttle < 0);
  const feeler = wayAft ? wrapAngle(carrier.heading + 32768) : carrier.heading;
  const nextX = clampI(carrier.x + mulCos(carrier.speed, carrier.heading), 0, sizeUnits);
  const nextY = clampI(carrier.y + mulSin(carrier.speed, carrier.heading), 0, sizeUnits);
  const bowX = carrier.x + mulCos(carrier.lookahead, feeler);
  const bowY = carrier.y + mulSin(carrier.lookahead, feeler);
  const blocked = grounds(islands, bowX, bowY, carrier.draught)
    || grounds(islands, nextX, nextY, carrier.draught);

  if (blocked) {
    if (carrier.grounded === 0) {
      carrier.grounded = 1;
      carrier.groundAccum = 0;
      pushEvent(events, EVT_CARRIER_GROUNDED, carrier.id, carrier.team, 0);
      // The autopilot has no answer to a shoal - backing off is seamanship,
      // and seamanship is the player's. It disengages and says so rather
      // than holding the wheel against the rocks.
      if (carrier.courseX >= 0) {
        carrier.courseX = -1;
        carrier.courseY = -1;
        pushEvent(events, EVT_COURSE, carrier.id, 0, 0);
      }
    }
    carrier.speed = 0;
    grindHull(carrier, events);
  } else {
    carrier.grounded = 0;
    carrier.groundAccum = 0;
    carrier.x = nextX;
    carrier.y = nextY;
  }

  // Course sailed: the autopilot lets go and reports, and the way comes off
  // at the player's own throttle unless they act.
  if (carrier.courseX >= 0
    && dist2D(carrier.x, carrier.y, carrier.courseX, carrier.courseY) <= COURSE_ARRIVE_UNITS) {
    carrier.courseX = -1;
    carrier.courseY = -1;
    carrier.throttle = 0;
    pushEvent(events, EVT_COURSE, carrier.id, 0, 0);
  }

  burnFuel(carrier);
  if (hadFuel && carrier.fuel === 0) pushEvent(events, EVT_FUEL_EMPTY, carrier.id, carrier.team, 0);
  if (!hadFuel && carrier.fuel > 0) pushEvent(events, EVT_FUEL_RESTORED, carrier.id, carrier.team, 0);
}

function stepCarriers(state) {
  for (let i = 0; i < state.carriers.length; i++) {
    stepCarrier(state.carriers[i], state.islands, state.params.sizeUnits, state.events);
  }
}

export { stepCarriers, stepCarrier, grounds, clearanceAt, shoalLimit };
