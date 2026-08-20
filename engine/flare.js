// engine/flare.js - the answer to the missile-lock warning.
//
// A warning you cannot act on is only bad news delivered early. Flares are what
// turn "something has locked onto you" into a decision: fire them and every
// heat-seeker already in the air near the ship loses its lock and flies on
// blind, on the heading it happened to be holding.
//
// Three things make that a decision rather than a button:
//
//   they cost      each burst is ordnance out of the same store that feeds the
//                  guns and rearms the aircraft
//   they wait      a cooldown, so a burst is a moment you pick rather than a
//                  stream you hold down
//   they are local everything hostile and guided within the burst radius is
//                  broken; a salvo still on its way in is not
//
// A broken seeker is not deleted. It keeps its speed and its heading and runs
// out of life somewhere astern, which is both simpler and more honest than a
// missile that evaporates - and it means a badly timed burst can still leave a
// round flying at you by luck.

import { distSq2D } from '../shared/fixed.js';
import { EVT_FLARES, pushEvent } from './events.js';

// Returns '' when this ship may fire a burst, otherwise the reason.
function checkFlares(carrier) {
  if (carrier.hull <= 0) return 'the ship is gone';
  if (carrier.flareCooldown > 0) return 'the launchers are still reloading';
  if (carrier.ordnance < carrier.flareCost) return 'no ordnance for flares';
  return '';
}

// Break the lock on everything hostile, guided and near. Returns how many
// seekers were blinded, which is what the event carries and what a test reads.
function fireFlares(state, carrier) {
  carrier.ordnance = carrier.ordnance - carrier.flareCost;
  carrier.flareCooldown = carrier.flareReload;
  const reach = carrier.flareRadius * carrier.flareRadius;
  let blinded = 0;
  for (let i = 0; i < state.shots.length; i++) {
    const shot = state.shots[i];
    if (shot.team === carrier.team || shot.guided !== 1) continue;
    if (distSq2D(shot.x, shot.y, carrier.x, carrier.y) > reach) continue;
    // The seeker is blinded, not the missile destroyed: it flies on.
    shot.guided = 0;
    shot.targetId = -1;
    blinded = blinded + 1;
  }
  pushEvent(state.events, EVT_FLARES, carrier.id, carrier.team, blinded);
  return blinded;
}

function stepFlares(state) {
  for (let i = 0; i < state.carriers.length; i++) {
    const carrier = state.carriers[i];
    if (carrier.flareCooldown > 0) carrier.flareCooldown = carrier.flareCooldown - 1;
  }
}

// Is anything guided in the air with this ship's name on it? The same question
// the client's warning asks, asked here so the AI can answer it too.
function lockedOn(state, carrier) {
  for (let i = 0; i < state.shots.length; i++) {
    const shot = state.shots[i];
    if (shot.team === carrier.team || shot.guided !== 1) continue;
    if (shot.targetKind !== 1 || shot.targetId !== carrier.id) continue;
    return true;
  }
  return false;
}

// The AI's rule, and a defensible one for a human too: fire when something is
// locked on AND close enough for the burst to reach it. Firing at the moment of
// launch wastes the burst - the missile is thirty seconds away and the
// launchers will not have reloaded when it arrives.
function shouldFlare(state, carrier) {
  if (checkFlares(carrier) !== '') return false;
  const reach = carrier.flareRadius * carrier.flareRadius;
  for (let i = 0; i < state.shots.length; i++) {
    const shot = state.shots[i];
    if (shot.team === carrier.team || shot.guided !== 1) continue;
    if (shot.targetKind !== 1 || shot.targetId !== carrier.id) continue;
    if (distSq2D(shot.x, shot.y, carrier.x, carrier.y) <= reach) return true;
  }
  return false;
}

export { checkFlares, fireFlares, stepFlares, lockedOn, shouldFlare };
