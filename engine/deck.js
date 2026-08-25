// engine/deck.js - getting off the ship, and back onto it.
//
// The 1988 deck cycle (ruled 2026-08-25, "full cycle incl. the lift"):
// launching is an OPERATION, not a keystroke. A craft rides up out of the
// hangar, ranges on the deck, and only then goes away:
//
//   IN HANGER  ->  ON FLIGHT DECK  ->  LAUNCHING  ->  away
//   DOCKING    ->  IN DOCK
//
// The lift is what does the first leg, and the lift is the MIDSHIP section
// (engine/damage.js hangarOpen). Wreck it and the cycle stops with your air
// group below decks - which is the point of the original listing LIFT on its
// repair-priorities screen.
//
// The original also let the player shuffle craft fore and aft on the deck.
// That was a 1988 interface for a 1988 problem and is deliberately not here:
// nothing about it is a decision.
//
// ABORT is standing: a craft anywhere in the cycle can be sent below again,
// which is what you press when a missile is inbound and you would rather not
// have a fuelled Manta sitting on the roof.

import { hangarOpen } from './damage.js';
import { launchUnit, recoverUnit, withinRecoveryRange } from './hangar.js';
import {
  UNIT_DOCKING,
  UNIT_LAUNCHING,
  UNIT_ON_DECK,
  UNIT_RETURNING,
  UNIT_STOWED,
} from './units.js';
import { EVT_UNIT_LAUNCHED, EVT_UNIT_RECOVERED, pushEvent } from './events.js';

// Begins the cycle. Returns 1 if the craft started up the lift, 0 if it is
// not in a position to (already out, or the hangar is wrecked).
//
// A cycle configured to take no time takes none AT ALL - the craft is away
// inside the command, exactly as it was before there was a cycle. That is
// what the scenario tests run on (test/helpers instantDeck): otherwise a
// zero-length leg would still cost a tick apiece and "launch" would not
// mean launched.
function beginLaunch(state, unit, carrier) {
  if (unit.state !== UNIT_STOWED) return 0;
  if (!hangarOpen(carrier)) return 0;
  unit.state = UNIT_ON_DECK;
  unit.deckTicks = 0;
  if (state.params.deckRangeTicks <= 0 && state.params.launchTicks <= 0) {
    sendAway(state, unit, carrier);
  }
  return 1;
}

// Off she goes. The existing placement decides WHERE - this file only
// decides WHEN.
function sendAway(state, unit, carrier) {
  unit.state = UNIT_STOWED;
  unit.deckTicks = 0;
  launchUnit(unit, carrier, state.params.deckHeight, state.weapons);
  pushEvent(state.events, EVT_UNIT_LAUNCHED, unit.id, unit.team, unit.kind);
}

// The approach. Like the launch, a dock configured to take no time takes
// none: fleet.js sets the craft docking AFTER this file has run for the
// tick, so without the short-circuit even a zero-length dock would cost a
// tick and "aboard" would not mean aboard.
function beginDocking(state, unit, carrier) {
  unit.state = UNIT_DOCKING;
  unit.deckTicks = 0;
  if (state.params.dockTicks <= 0) comeAboard(state, unit, carrier);
}

// Aboard. Everything the craft takes on comes out of the ship's own stores,
// which is recoverUnit's business and not this file's.
function comeAboard(state, unit, carrier) {
  recoverUnit(unit, carrier, state.weapons, state.presets);
  pushEvent(state.events, EVT_UNIT_RECOVERED, unit.id, unit.team, 0);
}

// Back below, from anywhere in the cycle. A craft already away is not the
// deck's business - that is a recall.
function abortDeck(unit) {
  if (unit.state !== UNIT_ON_DECK && unit.state !== UNIT_LAUNCHING) return 0;
  unit.state = UNIT_STOWED;
  unit.deckTicks = 0;
  return 1;
}

// How far through the current leg, in per-mil, for a progress bar that does
// not have to know the tick counts.
function deckProgressPermil(unit, params) {
  const total = legTicksOf(unit, params);
  if (total <= 0) return 0;
  const done = mulDivSafe(unit.deckTicks, 1000, total);
  return done > 1000 ? 1000 : done;
}

function legTicksOf(unit, params) {
  if (unit.state === UNIT_ON_DECK) return params.deckRangeTicks;
  if (unit.state === UNIT_LAUNCHING) return params.launchTicks;
  if (unit.state === UNIT_DOCKING) return params.dockTicks;
  return 0;
}

function mulDivSafe(a, b, c) {
  if (c === 0) return 0;
  return Math.floor((a * b) / c);
}

// One tick of every craft that is neither stowed nor away: the lift, the
// deck, the catapult and the dock.
function stepDeck(state) {
  for (let i = 0; i < state.units.length; i++) {
    const unit = state.units[i];
    if (unit.state !== UNIT_ON_DECK && unit.state !== UNIT_LAUNCHING
      && unit.state !== UNIT_DOCKING) continue;
    const carrier = carrierOf(state, unit.carrierId);
    if (carrier === -1) continue;

    // A wrecked hangar stops the lift where it is. The craft is not lost -
    // it waits on the ship for the yard to mend her.
    if (unit.state === UNIT_ON_DECK && !hangarOpen(carrier)) continue;
    // And a craft that has drifted back out of the recovery envelope has to
    // come round again: the approach is not a queue you keep your place in.
    if (unit.state === UNIT_DOCKING
      && !withinRecoveryRange(unit, carrier, state.params.recoverRange)) {
      unit.state = UNIT_RETURNING;
      unit.deckTicks = 0;
      continue;
    }

    unit.deckTicks = unit.deckTicks + 1;
    const leg = legTicksOf(unit, state.params);
    if (unit.deckTicks < leg) continue;
    unit.deckTicks = 0;

    if (unit.state === UNIT_ON_DECK) {
      unit.state = UNIT_LAUNCHING;
    } else if (unit.state === UNIT_LAUNCHING) {
      sendAway(state, unit, carrier);
    } else {
      comeAboard(state, unit, carrier);
    }
  }
  return state;
}

function carrierOf(state, carrierId) {
  for (let i = 0; i < state.carriers.length; i++) {
    if (state.carriers[i].id === carrierId) return state.carriers[i];
  }
  return -1;
}

export {
  abortDeck,
  beginDocking,
  beginLaunch,
  deckProgressPermil,
  legTicksOf,
  stepDeck,
};
