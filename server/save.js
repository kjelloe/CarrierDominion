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

import {
  SAVE_VERSION, gameFromState, readableSave, replayLog, saveGame, saveLogOnly,
} from '../shared/savefile.js';
import { applyLobby } from './lobby.js';

// The FORMAT and the REPLAY moved to shared/savefile.js on 2026-08-30, because
// both sides save now: the server writes wars to disk, and the client writes a
// solo war to localStorage - in solo the engine runs in the tab, so closing it
// used to be the end of the war. What stays here is what is genuinely the
// server's: the disk, and folding the saved LOBBY options back into the rules.

// Rebuild the exact state by replaying the log, with the saved lobby options
// folded in. Returns the state, or -1 with a reason via `problem`.
function replayWar(saved, rules, problem) {
  const chosen = saved.options === 0 || saved.options === undefined
    ? rules
    : applyLobby(rules, saved.options);
  return replayLog(saved, chosen, problem);
}

// A game object continuing the saved war: same state, same log, ready for the
// pump. Returns -1 (and fills `problem.reason`) rather than resuming wrongly.
function resumeGame(saved, rules, problem) {
  if (readableSave(saved) !== 1) {
    problem.reason = 'not a save file this build understands';
    return -1;
  }
  const state = replayWar(saved, rules, problem);
  if (state === -1) return -1;
  return gameFromState(state, saved.commandLog);
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
