// The save format, which BOTH sides now use (2026-08-30).
//
// The server writes wars to disk; the client writes a solo war to
// localStorage, because in solo the engine runs in the tab and closing it
// used to be the end of the war. The format and the replay live in
// shared/savefile.js so the two cannot drift: a war written by either must be
// readable by the other, and the hash check must refuse a save the rules have
// moved underneath rather than limping back as a subtly different war.

import test from 'node:test';
import assert from 'node:assert/strict';

import { loadRules } from '../server/rules.js';
import { createGame, enqueueCommand, stepGame } from '../engine/game.js';
import { hashState } from '../shared/statehash.js';
import {
  SAVE_VERSION, gameFromState, readableSave, replayLog, saveGame, saveLogOnly,
} from '../shared/savefile.js';

const SEED = 20260818;

function playedGame(ticks) {
  const game = createGame(SEED, loadRules());
  enqueueCommand(game, { type: 'set_throttle', carrierId: 0, throttle: 60 });
  for (let i = 0; i < ticks; i++) stepGame(game);
  enqueueCommand(game, { type: 'set_rudder', carrierId: 0, rudder: 1 });
  for (let i = 0; i < ticks; i++) stepGame(game);
  return game;
}

test('a save replays back into exactly the war it came from', () => {
  const game = playedGame(40);
  const saved = JSON.parse(JSON.stringify(saveGame(game, SEED, 0)));
  const problem = { reason: '' };
  const state = replayLog(saved, loadRules(), problem);
  assert.notEqual(state, -1, `the replay refused: ${problem.reason}`);
  assert.equal(hashState(state), hashState(game.state));
  assert.equal(state.tick, game.state.tick);
});

test('a resumed game keeps its log, so it goes on saving from where it was', () => {
  // This is what makes a solo war survive more than one reload: the log has
  // to carry forward, or the second save is a war that starts mid-air.
  const game = playedGame(30);
  const saved = JSON.parse(JSON.stringify(saveGame(game, SEED, 0)));
  const problem = { reason: '' };
  const state = replayLog(saved, loadRules(), problem);
  const resumed = gameFromState(state, saved.commandLog);
  assert.equal(resumed.commandLog.length, game.commandLog.length);

  stepGame(resumed);
  stepGame(resumed);
  const again = saveGame(resumed, SEED, 0);
  const twice = replayLog(JSON.parse(JSON.stringify(again)), loadRules(), { reason: '' });
  assert.notEqual(twice, -1, 'a war saved twice could not be replayed');
  assert.equal(hashState(twice), hashState(resumed.state));
});

test('a save the rules have moved underneath is refused, not limped back', () => {
  const game = playedGame(20);
  const saved = saveGame(game, SEED, 0);
  // The hash is the guard. Corrupt it the way a rules change would.
  const moved = { ...saved, stateHash: 'ffffffffffffffff' };
  const problem = { reason: '' };
  assert.equal(replayLog(moved, loadRules(), problem), -1);
  assert.match(problem.reason, /does not reproduce/);
});

test('what this build will not even try to read', () => {
  const game = playedGame(5);
  const good = saveGame(game, SEED, 0);
  assert.equal(readableSave(good), 1);
  assert.equal(readableSave(undefined), 0);
  assert.equal(readableSave(null), 0);
  assert.equal(readableSave({ ...good, version: SAVE_VERSION + 1 }), 0);
  assert.equal(readableSave({ ...good, commandLog: 'not an array' }), 0);
  // A log-only rescue save carries no hash, so it cannot be verified and must
  // never resume by itself - a human decides.
  assert.equal(readableSave(saveLogOnly(game, SEED, 0)), 0);
});

test('a save survives the round trip through JSON, which is how it travels', () => {
  // localStorage and the disk both store text. A field that does not survive
  // JSON is a field that does not survive a save.
  const game = playedGame(15);
  const saved = saveGame(game, SEED, { islands: 8, teams: 2 });
  const there = JSON.parse(JSON.stringify(saved));
  assert.deepEqual(there, saved);
  assert.equal(typeof there.stateHash, 'string');
  assert.ok(there.commandLog.length > 0, 'the log did not travel');
});
