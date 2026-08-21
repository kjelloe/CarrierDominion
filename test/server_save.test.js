// A war on disk and back: a save is seed + command log, resume is a replay,
// and a save that does not reproduce its own hash is refused, never fudged.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { loadRules } from '../server/rules.js';
import { createGame, enqueueCommand, stepGame } from '../engine/game.js';
import { hashState } from '../shared/statehash.js';
import { readSave, resumeGame, saveGame, writeSave } from '../server/save.js';
import { createApp } from '../server/app.js';

const rules = loadRules();
const SEED = 20260818;

// A short war with something in it: a helm order and a launch.
function playedGame() {
  const game = createGame(SEED, rules);
  for (let i = 0; i < 10; i++) stepGame(game);
  enqueueCommand(game, { type: 'set_throttle', carrierId: 0, throttle: 80 });
  for (let i = 0; i < 10; i++) stepGame(game);
  enqueueCommand(game, { type: 'launch_unit', carrierId: 0, kind: 0 });
  for (let i = 0; i < 30; i++) stepGame(game);
  return game;
}

test('a saved war resumes to the same hash, and keeps its log', () => {
  const game = playedGame();
  const saved = JSON.parse(JSON.stringify(saveGame(game, SEED, 0)));
  const problem = { reason: '' };
  const resumed = resumeGame(saved, loadRules(), problem);
  assert.notEqual(resumed, -1, problem.reason);
  assert.equal(hashState(resumed.state), hashState(game.state));
  assert.equal(resumed.state.tick, game.state.tick);
  assert.equal(resumed.commandLog.length, game.commandLog.length);

  // And the resumed war keeps playing, and keeps recording.
  enqueueCommand(resumed, { type: 'set_throttle', carrierId: 0, throttle: 20 });
  stepGame(resumed);
  assert.equal(resumed.commandLog.length, game.commandLog.length + 1);
});

test('a tampered or drifted save is refused with a reason, not resumed wrongly', () => {
  const game = playedGame();
  const saved = saveGame(game, SEED, 0);

  const tampered = JSON.parse(JSON.stringify(saved));
  tampered.commandLog[0].throttle = 100;
  const problem = { reason: '' };
  assert.equal(resumeGame(tampered, loadRules(), problem), -1);
  assert.match(problem.reason, /does not reproduce/);

  const alien = { version: 999 };
  const problem2 = { reason: '' };
  assert.equal(resumeGame(alien, loadRules(), problem2), -1);
  assert.match(problem2.reason, /not a save file/);
});

test('the file round-trips, and the app resumes from it', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cd-save-'));
  const path = join(dir, 'autosave.json');
  try {
    const game = playedGame();
    writeSave(path, saveGame(game, SEED, 0));
    const saved = readSave(path);

    const app = createApp({ seed: 999, rules: loadRules(), resume: saved });
    assert.equal(app.resumed, 1, app.resumeProblem);
    assert.equal(app.seed, SEED, 'the seed must come from the save, not the environment');
    assert.equal(app.game.state.tick, game.state.tick);
    assert.equal(hashState(app.game.state), hashState(game.state));
    await app.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('saveNow writes the running war; a lobby writes nothing', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cd-save-'));
  const path = join(dir, 'autosave.json');
  try {
    const roomed = createApp({
      seed: SEED, rules: loadRules(), lobby: true, savePath: path, bootId: 'x',
    });
    assert.equal(roomed.saveNow(), 0, 'a lobby has no war worth saving');
    await roomed.close();

    const app = createApp({ seed: SEED, rules: loadRules(), savePath: path });
    const address = await app.listen(0, '127.0.0.1');
    assert.ok(address.port > 0);
    await new Promise((resolve) => setTimeout(resolve, 200));
    assert.equal(app.saveNow(), 1);
    const saved = readSave(path);
    assert.equal(saved.seed, SEED);
    assert.ok(saved.tick > 0);
    await app.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a resumed war comes back at the speed its table chose', async () => {
  const { applyLobby } = await import('../server/lobby.js');
  const options = { seed: SEED, islands: 8, enemy: 0, ending: 0, speed: 8 };
  const game = createGame(SEED, applyLobby(loadRules(), options));
  for (let i = 0; i < 20; i++) stepGame(game);
  const saved = JSON.parse(JSON.stringify(saveGame(game, SEED, options)));

  const app = createApp({ seed: SEED, rules: loadRules(), speed: 1, resume: saved });
  assert.equal(app.resumed, 1, app.resumeProblem);
  assert.equal(app.speed, 8, 'the table chose x8 and the environment overruled it');
  await app.close();
});
