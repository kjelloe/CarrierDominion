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
import { recoverUnit, withinRecoveryRange } from './hangar.js';
import { KIND_MANTA, UNIT_ACTIVE, UNIT_RETURNING, findCarrierById } from './units.js';

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

    const outcome = unit.kind === KIND_MANTA
      ? stepManta(unit, sizeUnits)
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
      if (carrier !== -1 && withinRecoveryRange(unit, carrier, state.params.recoverRange)) {
        recoverUnit(unit, carrier);
        pushEvent(state.events, EVT_UNIT_RECOVERED, unit.id, unit.team, 0);
      }
    }
  }
}

export { stepUnits };
