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

import { mkdirSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  SAVE_VERSION, gameFromState, readableSave, replayLog, saveGame as saveLog, saveLogOnly,
} from '../shared/savefile.js';
import { hashState } from '../shared/statehash.js';
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

// The server's save is the shared one plus the STATE itself (2026-11-19).
// Replaying the log is exact but linear in the war's length: the hosted war
// had reached tick 17 million, which is about four hours of replay before the
// port opened. The state lets a resume be instant; the log stays, for the
// replay viewer and as the fallback. Solo saves (shared/savefile.js) do not
// carry it: they live in localStorage, and solo wars are short.
function saveGame(game, seed, options) {
  return { ...saveLog(game, seed, options), state: game.state };
}

// The instant resume: the saved state, if it still is what it says. It must
// hash to the saved hash, sit at the saved tick, and have been made under the
// ruleset this server would fold from the saved options. Anything else is -1
// with a reason, and the caller falls back to replaying the log, which is the
// check that also catches a CODE change; this one cannot, and that is the
// trade made for resuming in a second instead of hours.
function checkpointGame(saved, rules, problem) {
  if (readableSave(saved) !== 1) {
    problem.reason = 'not a save file this build understands';
    return -1;
  }
  if (saved.state === null || typeof saved.state !== 'object') {
    problem.reason = 'the save carries no state';
    return -1;
  }
  const chosen = saved.options === 0 || saved.options === undefined ? rules : applyLobby(rules, saved.options);
  try {
    if (saved.state.rulesHash !== hashState(chosen)) {
      problem.reason = 'the rules have changed since it was saved';
      return -1;
    }
    if (saved.state.tick !== saved.tick || hashState(saved.state) !== saved.stateHash) {
      problem.reason = 'the saved state does not match its own hash';
      return -1;
    }
  } catch (error) {
    problem.reason = `the saved state is not a state: ${error.message}`;
    return -1;
  }
  return gameFromState(saved.state, saved.commandLog);
}

// A war given up (abandoned, or reopened by its host) is kept, but no longer
// resumed: a copy goes into `dir`, named so they sort oldest first, and only
// the newest `keep` stay (owner, 2026-11-19: the last 100).
function archiveSave(saved, dir, keep, stamp) {
  mkdirSync(dir, { recursive: true });
  writeSave(join(dir, `${stamp}-s${saved.seed}-t${saved.tick}.json`), saved);
  const kept = readdirSync(dir).filter((name) => name.endsWith('.json')).sort();
  for (const name of kept.slice(0, Math.max(0, kept.length - keep))) unlinkSync(join(dir, name));
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
  SAVE_VERSION, archiveSave, checkpointGame, saveGame, saveLogOnly, readableSave, replayWar, resumeGame,
  writeSave, readSave, gameFromState,
};
