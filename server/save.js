// server/save.js - a war on disk, and the war back off it.
//
// There is no snapshot format to design and none is designed here: a war IS
// its seed plus its ordered command log (docs/01), so that is what a save
// file holds, plus the tick it had reached and the state hash it had. Resume
// replays the log through the same reducer and REFUSES if the hash disagrees
// - a save made under different rules or different code does not limp back as
// a subtly different war, it says so and stops.
//
// The options the war was started with travel as the LOBBY OPTIONS, not as a
// copy of the ruleset: rules are rebuilt from data/*.json plus the options,
// the same path a fresh war takes, and the hash check catches a data file
// that moved underneath the save.

import { readFileSync, renameSync, writeFileSync } from 'node:fs';

import { CMD_ADVANCE_TICK } from '../engine/commands.js';
import { createInitialState } from '../engine/state.js';
import { apply } from '../engine/reducer.js';
import { hashState } from '../shared/statehash.js';
import { applyLobby } from './lobby.js';

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
// the actual save format, is perfectly fine. Writing it beside the real save
// keeps the evening recoverable by hand.
//
// It is deliberately NOT resumable without a human: an empty hash cannot be
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

// Rebuild the exact state by replaying the log. Returns the state, or -1 with
// a reason via the `problem` out-parameter object.
function replayWar(saved, rules, problem) {
  const chosen = saved.options === 0 || saved.options === undefined
    ? rules
    : applyLobby(rules, saved.options);
  let state = createInitialState(saved.seed, chosen);
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

// A game object continuing the saved war: same state, same log, ready for the
// pump. Returns -1 (and fills `problem.reason`) rather than resuming wrongly.
function resumeGame(saved, rules, problem) {
  if (saved === undefined || saved === null || saved.version !== SAVE_VERSION) {
    problem.reason = 'not a save file this build understands';
    return -1;
  }
  const state = replayWar(saved, rules, problem);
  if (state === -1) return -1;
  return {
    state: state,
    queue: [],
    nextSequence: 0,
    snapshots: [],
    commandLog: saved.commandLog,
    snapshotCapacity: 30,
    recordCommands: 1,
  };
}

// Write-then-rename, so a crash mid-write leaves the previous save intact
// rather than half a JSON file.
function writeSave(path, saved) {
  writeFileSync(`${path}.tmp`, `${JSON.stringify(saved)}\n`);
  renameSync(`${path}.tmp`, path);
}

function readSave(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

export {
  SAVE_VERSION, saveGame, saveLogOnly, replayWar, resumeGame, writeSave, readSave,
};
