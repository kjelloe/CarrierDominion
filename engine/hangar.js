// engine/hangar.js - launching and recovering.
//
// The hangar is not a counter: every unit exists in state from the first tick
// and is simply STOWED, which means launching is a state change rather than a
// spawn. Replays, hashes, and the fog filter all get simpler for it, and a
// destroyed Manta is a distinguishable record rather than a decremented number.

import { dist2D } from '../shared/fixed.js';
import { mulCos, mulSin } from '../shared/trig.js';
import { rearm } from './weapons.js';
import { hangarOpen } from './damage.js';
import {
  KIND_MANTA,
  KIND_WALRUS,
  ORDER_HOLD,
  ORDER_RETURN,
  UNIT_ACTIVE,
  UNIT_RETURNING,
  UNIT_STOWED,
} from './units.js';

const LAUNCH_AHEAD_UNITS = 120 * 256; // 120 m clear of the bow
const LAUNCH_ABEAM_UNITS = 90 * 256; // and off to starboard for a Walrus

function readyToLaunch(state, carrierId, kind) {
  // A wrecked hangar deck is a closed one: nothing goes up (ruling #19).
  for (let c = 0; c < state.carriers.length; c++) {
    const carrier = state.carriers[c];
    if (carrier.id === carrierId && !hangarOpen(carrier)) return -1;
  }
  for (let i = 0; i < state.units.length; i++) {
    const unit = state.units[i];
    if (unit.carrierId !== carrierId) continue;
    if (unit.kind !== kind) continue;
    if (unit.state !== UNIT_STOWED) continue;
    if (unit.hp <= 0) continue;
    // An empty tank stays on the deck. Fuel comes from the ship's own bunker
    // now, and a dry ship launching a dry aircraft is a unit thrown away.
    if (unit.fuel <= 0) continue;
    return unit;
  }
  return -1;
}

// Fuel is drawn from the carrier's own bunker (ruling #3): a partial tank is
// what a short bunker buys, exactly like a partial rearm.
function refuelFromCarrier(unit, carrier) {
  const wanted = unit.fuelCapacity - unit.fuel;
  if (wanted <= 0) return 0;
  const taken = wanted < carrier.fuel ? wanted : carrier.fuel;
  carrier.fuel = carrier.fuel - taken;
  unit.fuel = unit.fuel + taken;
  unit.fuelAccum = 0;
  return taken;
}

// A Walrus payload is drawn from the ship's stores, and only when it is
// missing: the pod costs materials (it is a construction device), the virus
// bomb costs ordnance (it is a munition). A store too short to pay issues
// nothing, and the vehicle goes out without.
function provisionWalrus(unit, carrier) {
  if (unit.kind !== KIND_WALRUS) return unit;
  if (unit.pod === 0 && carrier.materials >= carrier.podMaterials) {
    carrier.materials = carrier.materials - carrier.podMaterials;
    unit.pod = 1;
  }
  if (unit.virus === 0 && carrier.ordnance >= carrier.virusOrdnance) {
    carrier.ordnance = carrier.ordnance - carrier.virusOrdnance;
    unit.virus = 1;
  }
  return unit;
}

// Puts the unit on the map ahead of its carrier. A Manta leaves the deck at
// deck height and climbs; a Walrus enters the water abeam.
function launchUnit(unit, carrier, deckHeightUnits) {
  const aheadX = mulCos(LAUNCH_AHEAD_UNITS, carrier.heading);
  const aheadY = mulSin(LAUNCH_AHEAD_UNITS, carrier.heading);
  unit.state = UNIT_ACTIVE;
  unit.order = ORDER_HOLD;
  unit.heading = carrier.heading;
  unit.control = -1;
  unit.throttle = 0;
  unit.rudder = 0;
  unit.climb = 0;
  if (unit.kind === KIND_MANTA) {
    unit.x = carrier.x + aheadX;
    unit.y = carrier.y + aheadY;
    unit.z = deckHeightUnits;
    unit.speed = unit.minSpeed;
  } else {
    // Abeam to starboard: rotate the ahead vector a quarter turn clockwise.
    unit.x = carrier.x + mulCos(LAUNCH_ABEAM_UNITS, carrier.heading + 49152);
    unit.y = carrier.y + mulSin(LAUNCH_ABEAM_UNITS, carrier.heading + 49152);
    unit.z = 0;
    unit.speed = 0;
  }
  // A payload the stores could not issue at recovery is issued now if they can
  // pay: what a Walrus carries out is decided at the ramp, not remembered from
  // its last trip.
  provisionWalrus(unit, carrier);
  unit.targetX = unit.x;
  unit.targetY = unit.y;
  return unit;
}

function orderReturn(unit) {
  unit.state = UNIT_RETURNING;
  unit.order = ORDER_RETURN;
  unit.control = -1;
  return unit;
}

function withinRecoveryRange(unit, carrier, recoverRangeUnits) {
  return dist2D(unit.x, unit.y, carrier.x, carrier.y) <= recoverRangeUnits;
}

// Back in the hangar. Everything the unit takes aboard comes out of the ship's
// own stores (ruling #3): fuel from the bunker, rounds from the ordnance store,
// payloads from materials and ordnance. Short stores mean short issues.
function recoverUnit(unit, carrier, weapons) {
  unit.state = UNIT_STOWED;
  unit.order = ORDER_HOLD;
  unit.control = -1;
  unit.speed = 0;
  unit.throttle = 0;
  unit.rudder = 0;
  unit.climb = 0;
  unit.blocked = 0;
  refuelFromCarrier(unit, carrier);
  rearm(unit, weapons, carrier);
  provisionWalrus(unit, carrier);
  unit.x = carrier.x;
  unit.y = carrier.y;
  unit.z = 0;
  unit.targetX = carrier.x;
  unit.targetY = carrier.y;
  return unit;
}

export {
  LAUNCH_AHEAD_UNITS,
  LAUNCH_ABEAM_UNITS,
  readyToLaunch,
  refuelFromCarrier,
  provisionWalrus,
  launchUnit,
  orderReturn,
  withinRecoveryRange,
  recoverUnit,
};
