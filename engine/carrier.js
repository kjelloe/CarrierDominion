// engine/carrier.js - helm handling and carrier movement integration.
//
// Order per tick, and it matters for the hash: turn, then accelerate, then
// translate, then test the seabed, then burn fuel. A carrier that grounds
// keeps its heading but loses its way on, and only the translation is undone -
// so backing off a shoal works by reversing the helm, not by teleporting.

import { clampI, floorDiv, mulDiv, stepToward, turnToward, wrapAngle } from '../shared/fixed.js';
import { mulCos, mulSin } from '../shared/trig.js';
import { HEADING_MANUAL } from './commands.js';
import { EVT_CARRIER_GROUNDED, EVT_FUEL_EMPTY, EVT_FUEL_RESTORED, pushEvent } from './events.js';
import { worldHeightAt } from './heightmap.js';

// The keel clears terrain shallower than this; -draught is the waterline depth
// the hull needs.
function grounds(islands, x, y, draught) {
  return worldHeightAt(islands, x, y) > -draught;
}

function steer(carrier) {
  if (carrier.headingHold !== HEADING_MANUAL) {
    return turnToward(carrier.heading, carrier.headingHold, carrier.turnRate);
  }
  if (carrier.rudder === 0) return carrier.heading;
  return wrapAngle(carrier.heading + carrier.rudder * carrier.turnRate);
}

function burnFuel(carrier) {
  const perHundred = carrier.fuelBurnIdle
    + mulDiv(carrier.fuelBurnFull - carrier.fuelBurnIdle, carrier.throttle, 100);
  const accum = carrier.fuelAccum + perHundred;
  const spent = floorDiv(accum, 100);
  carrier.fuelAccum = accum - spent * 100;
  carrier.fuel = carrier.fuel - spent;
  if (carrier.fuel < 0) carrier.fuel = 0;
}

function stepCarrier(carrier, islands, sizeUnits, events) {
  const hadFuel = carrier.fuel > 0;
  carrier.heading = steer(carrier);

  let targetSpeed = mulDiv(carrier.maxSpeed, carrier.throttle, 100);
  if (!hadFuel) targetSpeed = 0;
  carrier.speed = stepToward(carrier.speed, targetSpeed, carrier.accel);

  // The bow is tested a fixed distance ahead, not just at the next position:
  // at one unit per tick a hull would otherwise creep into a shoal and
  // re-report grounding on every tick. With a lookahead, a ship pinned against
  // a shore stays grounded (and reports once) until it is steered clear.
  const nextX = clampI(carrier.x + mulCos(carrier.speed, carrier.heading), 0, sizeUnits);
  const nextY = clampI(carrier.y + mulSin(carrier.speed, carrier.heading), 0, sizeUnits);
  const bowX = carrier.x + mulCos(carrier.lookahead, carrier.heading);
  const bowY = carrier.y + mulSin(carrier.lookahead, carrier.heading);
  const blocked = grounds(islands, bowX, bowY, carrier.draught)
    || grounds(islands, nextX, nextY, carrier.draught);

  if (blocked) {
    if (carrier.grounded === 0) {
      carrier.grounded = 1;
      pushEvent(events, EVT_CARRIER_GROUNDED, carrier.id, 0, 0);
    }
    carrier.speed = 0;
  } else {
    carrier.grounded = 0;
    carrier.x = nextX;
    carrier.y = nextY;
  }

  burnFuel(carrier);
  if (hadFuel && carrier.fuel === 0) pushEvent(events, EVT_FUEL_EMPTY, carrier.id, 0, 0);
  if (!hadFuel && carrier.fuel > 0) pushEvent(events, EVT_FUEL_RESTORED, carrier.id, 0, 0);
}

function stepCarriers(state) {
  for (let i = 0; i < state.carriers.length; i++) {
    stepCarrier(state.carriers[i], state.islands, state.params.sizeUnits, state.events);
  }
}

export { stepCarriers, stepCarrier, grounds };
