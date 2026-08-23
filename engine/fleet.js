// engine/fleet.js - one tick for every unit that is out.
//
// Order matters and is part of the hash: carriers move first (in the reducer),
// then each unit in id order. A returning unit re-aims at its carrier every
// tick, because the carrier it is chasing is itself under way - aiming once at
// launch would send it to where the ship used to be.

import {
  DRIVE_ARRIVED,
  DRIVE_BLOCKED,
  DRIVE_HOME,
  DRIVE_OUT_OF_FUEL,
  stepWalrus,
} from './drive.js';
import { FLIGHT_ARRIVED, FLIGHT_HOME, FLIGHT_OUT_OF_FUEL, stepManta } from './flight.js';
import {
  EVT_UNIT_ARRIVED,
  EVT_UNIT_BLOCKED,
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
  UNIT_ACTIVE,
  UNIT_RETURNING,
  findCarrierById,
  fuelPermil,
} from './units.js';
import { designated } from './targeting.js';

function stepUnits(state) {
  const sizeUnits = state.params.sizeUnits;
  for (let i = 0; i < state.units.length; i++) {
    const unit = state.units[i];
    if (unit.state !== UNIT_ACTIVE && unit.state !== UNIT_RETURNING) continue;

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
    if (outcome === FLIGHT_HOME || outcome === DRIVE_HOME) {
      const canLand = carrier !== -1 && hangarOpen(carrier);
      if (canLand && withinRecoveryRange(unit, carrier, state.params.recoverRange)) {
        recoverUnit(unit, carrier, state.weapons);
        pushEvent(state.events, EVT_UNIT_RECOVERED, unit.id, unit.team, 0);
      }
    }
  }
}

export { stepUnits };
