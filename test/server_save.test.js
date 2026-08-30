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
import { pump } from '../server/clock.js';

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
    // Drive the clock rather than sleeping (review R-007). A 200 ms wait is
    // about four ticks of headroom on an idle machine and none at all on a
    // loaded runner - the same class of flake that cost the probe sweep its
    // authority. Pumping is exact and takes no time.
    pump(app.clock, app.clock.originMs + rules.rules.msPerTick * 3);
    assert.ok(app.game.state.tick >= 3, 'the clock did not advance');
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

// The command log IS the save format (docs/01), so every command in the
// vocabulary has to survive a JSON round trip and replay to the same hash.
// The six commands the squadron batch added had never been through it, and
// one of them carries an ARRAY - the first command that does.
test('a war full of the newest commands saves and resumes to the same hash', () => {
  const game = createGame(SEED, rules);
  for (let i = 0; i < 10; i++) stepGame(game);

  const walrus = game.state.units.find((u) => u.team === 0 && u.kind === 1);
  const manta = game.state.units.find((u) => u.team === 0 && u.kind === 0);
  const carrier = game.state.carriers[0];

  // The fitting screen, the pod rack, the deck, the screen, and a course -
  // including the array-carrying one.
  enqueueCommand(game, { type: 'set_station', unitId: walrus.id, station: 1, rounds: 0 });
  enqueueCommand(game, { type: 'set_pod_role', unitId: walrus.id, role: 2 });
  enqueueCommand(game, { type: 'set_device', unitId: walrus.id, device: 1, fitted: 1 });
  enqueueCommand(game, {
    type: 'set_decoy_pattern', carrierId: 0, pattern: 1, spread: 600,
  });
  for (let i = 0; i < 5; i++) stepGame(game);

  enqueueCommand(game, { type: 'launch_unit', carrierId: 0, kind: 0 });
  enqueueCommand(game, { type: 'abort_deck', unitId: manta.id });
  enqueueCommand(game, { type: 'launch_unit', carrierId: 0, kind: 0 });
  for (let i = 0; i < 120; i++) stepGame(game);

  const flown = game.state.units.find((u) => u.team === 0 && u.kind === 0 && u.state === 1);
  if (flown !== undefined) {
    enqueueCommand(game, {
      type: 'set_route',
      unitId: flown.id,
      points: [carrier.x + 4000, carrier.y + 4000, carrier.x + 6000, carrier.y + 2000],
    });
  }
  enqueueCommand(game, {
    type: 'set_route', carrierId: 0, points: [carrier.x + 9000, carrier.y],
  });
  for (let i = 0; i < 60; i++) stepGame(game);

  // Every one of them is in the log, and the log is what gets saved.
  const kinds = {};
  for (const entry of game.commandLog) kinds[entry.type] = 1;
  for (const type of ['set_station', 'set_pod_role', 'set_device',
    'set_decoy_pattern', 'abort_deck', 'set_route']) {
    assert.equal(kinds[type], 1, `${type} never reached the command log`);
  }

  const saved = JSON.parse(JSON.stringify(saveGame(game, SEED, 0)));
  const problem = { reason: '' };
  const resumed = resumeGame(saved, loadRules(), problem);
  assert.notEqual(resumed, -1, problem.reason);
  assert.equal(hashState(resumed.state), hashState(game.state),
    'a war with the newest commands did not replay to the same hash');
});

// --- a resumed war still has a room to go back to (review R-004) ---
//
// `app.lobby` used to be built only when nothing was resumed, so after a
// resume it was 0 and `reopenRoom` answered "there is no war room" for the
// life of the process. RESUME=auto is the SERVICE setting (server/index.js),
// which made that the hosted box's state after every restart: a table could
// finish the war they were in and then had no way to start another.

test('a resumed war keeps its war room, already running', async () => {
  const { applyLobby } = await import('../server/lobby.js');
  const options = { seed: SEED, islands: 8, enemy: 0, ending: 0, speed: 1 };
  const game = createGame(SEED, applyLobby(loadRules(), options));
  for (let i = 0; i < 10; i++) stepGame(game);
  const saved = JSON.parse(JSON.stringify(saveGame(game, SEED, options)));

  const app = createApp({ seed: SEED, rules: loadRules(), lobby: true, resume: saved });
  try {
    assert.equal(app.resumed, 1, 'the war did not resume, so this proves nothing');
    assert.notEqual(app.lobby, 0, 'a resumed war has no room to go back to');
    // Running, not 'lobby' - `inLobby()` gates the clock, so a resumed war
    // parked in a war room would never advance a tick.
    assert.equal(app.lobby.status, 'running',
      'the resumed war was parked in its own war room and would never tick');
    assert.notEqual(app.joinCode(), '', 'the room has no code to hand out');
    // And the room remembers what was actually being played.
    assert.equal(app.lobby.options.islands, 8, 'the room forgot the war it resumed');
  } finally {
    app.close();
  }
});

// --- an engine fault stops the clock without taking the server with it (R-005) ---

test('a throwing tick halts the war, saves it, and leaves the server up', () => {
  const folder = mkdtempSync(join(tmpdir(), 'cd-halt-'));
  const path = join(folder, 'war.json');
  try {
    const app = createApp({ seed: SEED, rules: rules, savePath: path });
    try {
      // A float in the state: the canonical hashing walk refuses it, which is
      // the shape of every deliberate engine assertion - the walk and
      // shared/fixed.js both throw on purpose.
      app.game.state.carriers[0].x = 0.5;
      // Drive the clock directly rather than waiting on wall time.
      pump(app.clock, app.clock.originMs + rules.rules.msPerTick * 2);
      assert.notEqual(app.halted, '', 'the fault passed unnoticed');
      assert.equal(app.clock.running, false, 'the clock kept running after a fault');
      assert.equal(app.health().ok, false, 'health still says everything is fine');
      // The state is what broke here, so the ordinary save cannot be written -
      // `saveGame` hashes the state. The command log still can be, and that is
      // the whole point of R-005: do not lose the evening.
      const rescued = readSave(`${path}.halted`);
      assert.equal(rescued.seed, SEED, 'the command log was lost with the fault');
      assert.ok(Array.isArray(rescued.commandLog), 'the rescue save has no log in it');
      assert.equal(rescued.stateHash, '',
        'a log-only save must not claim a hash it could not compute');
    } finally {
      app.close();
    }
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});
