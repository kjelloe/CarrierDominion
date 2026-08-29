// shared/savefile.js - what a saved war IS, and how it comes back.
//
// There is no snapshot format to design and none is designed here: a war IS
// its seed plus its ordered command log (docs/01), so that is what a save
// holds, plus the tick it had reached and the state hash it had. Resume
// replays the log through the same reducer and REFUSES if the hash disagrees
// - a save made under different rules or different code does not limp back as
// a subtly different war, it says so and stops.
//
// This half lives in `shared/` because BOTH SIDES SAVE (2026-08-30). The
// server writes wars to disk; the client writes a solo war to localStorage,
// because in solo the engine runs in the tab and closing it used to be the
// end of the war. One format, one replay, one hash check - a solo save and a
// server save are the same object, and a war written by either can be read by
// the other.
//
// The DISK is the server's business and stays there (`server/save.js`), as do
// the lobby options: rules are rebuilt from data/*.json plus whatever choices
// the war was started with, which is a different question on each side.

import { CMD_ADVANCE_TICK } from '../engine/commands.js';
import { createInitialState } from '../engine/state.js';
import { apply } from '../engine/reducer.js';
import { hashState } from './statehash.js';

const SAVE_VERSION = 1;

// The war as a plain object. `options` is the lobby/start choices or 0 for a
// war sailed straight from data/rules.json.
function saveGame(game, seed, options) {
  return {
    version: SAVE_VERSION,
    seed: seed,
    options: options,
    tick: game.state.tick,
    stateHash: hashState(game.state),
    commandLog: game.commandLog,
  };
}

// The same save with the state hash left blank, for the one case where the
// STATE is what broke: an engine fault mid-tick means `hashState` throws, so
// the ordinary save cannot be written at all - and the command log, which is
// the actual save format, is perfectly fine.
//
// Deliberately NOT resumable without a human: an empty hash cannot be
// verified, and resume refusing on a mismatch is a guard worth keeping.
function saveLogOnly(game, seed, options) {
  return {
    version: SAVE_VERSION,
    seed: seed,
    options: options,
    tick: game.state.tick,
    stateHash: '',
    commandLog: game.commandLog,
  };
}

// Replay a save into a state, against rules the CALLER has already resolved.
// Returns the state, or -1 with a reason via the `problem` out-parameter.
//
// Resolving the rules is the caller's job because the two sides do it
// differently: the server folds the saved lobby options, the client folds the
// start-menu choices it is booting with. The replay itself is the same.
function replayLog(saved, rules, problem) {
  let state = createInitialState(saved.seed, rules);
  let cursor = 0;
  while (state.tick < saved.tick) {
    while (cursor < saved.commandLog.length
      && saved.commandLog[cursor].tick === state.tick) {
      state = apply(state, saved.commandLog[cursor]);
      cursor = cursor + 1;
    }
    state = apply(state, { type: CMD_ADVANCE_TICK });
  }
  if (hashState(state) !== saved.stateHash) {
    problem.reason = 'the replay does not reproduce the saved war - '
      + 'the rules or the code have changed since it was saved';
    return -1;
  }
  return state;
}

// A game object continuing a replayed war: same state, same log, ready for
// the pump - whichever pump that is.
function gameFromState(state, commandLog) {
  return {
    state: state,
    queue: [],
    nextSequence: 0,
    snapshots: [],
    commandLog: commandLog,
    snapshotCapacity: 30,
    recordCommands: 1,
  };
}

// Is this object something this build can even try to read?
function readableSave(saved) {
  if (saved === undefined || saved === null) return 0;
  if (saved.version !== SAVE_VERSION) return 0;
  if (!Array.isArray(saved.commandLog)) return 0;
  if (typeof saved.stateHash !== 'string' || saved.stateHash === '') return 0;
  return 1;
}

export { SAVE_VERSION, saveGame, saveLogOnly, replayLog, gameFromState, readableSave };
