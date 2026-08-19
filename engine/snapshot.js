// engine/snapshot.js - what leaves the engine.
//
// The hash identifies the exact authoritative state at this tick; the views are
// the only payload a client may see. Note the deliberate difference from the
// sibling projects: hashState here walks the WHOLE state canonically rather
// than writing a hand-maintained field list. A new field can therefore never be
// forgotten by the hash - the failure mode that costs the most debugging - and
// the canonical walk doubles as the state-hygiene assertion (no floats, no
// nulls, no non-ASCII).

import { hashState as canonicalHash } from '../shared/statehash.js';
import { buildView } from '../shared/view.js';

function hashState(state) {
  return canonicalHash(state);
}

// The trajectory hash with the transient event list removed. Use it to tell a
// pure presentation change (events reworded or re-ordered) from a real
// simulation change when a golden hash moves.
function trajectoryHash(state) {
  const copy = {};
  const keys = Object.keys(state);
  for (let i = 0; i < keys.length; i++) {
    if (keys[i] !== 'events') copy[keys[i]] = state[keys[i]];
  }
  return canonicalHash(copy);
}

function createSnapshot(state) {
  const views = [];
  for (let t = 0; t < state.teams.length; t++) views.push(buildView(state, state.teams[t].id));
  return {
    tick: state.tick,
    stateHash: hashState(state),
    // State is never exposed here: only fog-filtered views are transport payloads.
    views: views,
  };
}

export { hashState, trajectoryHash, createSnapshot };
