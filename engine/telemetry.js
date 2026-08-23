// engine/telemetry.js - the leash (manual coverage review, item 1).
//
// The original's deepest control principle: Mantas and Walruses are DRONES,
// flown over an encrypted video link from the carrier. Past ~20 km the
// picture degrades; at ~26 km the link is gone and the craft SELF-DESTRUCTS
// rather than fall into enemy hands. It is what forces the carrier itself to
// sail into danger - the air group is a hand, not a longer arm.
//
// The lighter is exempt: the original's transfer drone was semi-submersible
// and autonomous, and so is ours. A craft whose carrier has SUNK has no
// signal source at all - the link check fails the way the manual says it
// would, which also winds a dead seat's leftovers out of a long free-for-all.
//
// Rules with telemetryLossMetres of 0 switch the leash off entirely.

import { dist2D } from '../shared/fixed.js';
import { EVT_TELEMETRY_LOST, pushEvent } from './events.js';
import { KIND_LIGHTER, UNIT_ACTIVE, UNIT_LOST, UNIT_RETURNING } from './units.js';

function carrierById(state, id) {
  for (let i = 0; i < state.carriers.length; i++) {
    if (state.carriers[i].id === id) return state.carriers[i];
  }
  return -1;
}

// The link state for one unit: 0 sound, 1 fading, 2 lost. Shared with the
// view so the cockpit warning and the engine's verdict cannot disagree.
function telemetryState(state, unit) {
  if (state.params.telemetryLoss <= 0) return 0;
  if (unit.kind === KIND_LIGHTER) return 0;
  const carrier = carrierById(state, unit.carrierId);
  if (carrier === -1 || carrier.hull <= 0) return 2;
  const range = dist2D(unit.x, unit.y, carrier.x, carrier.y);
  if (range > state.params.telemetryLoss) return 2;
  if (range > state.params.telemetryFade) return 1;
  return 0;
}

function stepTelemetry(state) {
  if (state.params.telemetryLoss <= 0) return;
  for (let i = 0; i < state.units.length; i++) {
    const unit = state.units[i];
    if (unit.state !== UNIT_ACTIVE && unit.state !== UNIT_RETURNING) continue;
    if (telemetryState(state, unit) !== 2) continue;
    unit.hp = 0;
    unit.state = UNIT_LOST;
    unit.speed = 0;
    unit.throttle = 0;
    unit.control = -1;
    pushEvent(state.events, EVT_TELEMETRY_LOST, unit.id, unit.team, 0);
  }
}

export { telemetryState, stepTelemetry };
