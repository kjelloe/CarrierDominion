// Rooms that outlive their people (C12) and rooms of one's own (C13): an
// abandoned war gives its room back to the next stranger, and `?room=new`
// opens a private table beside the shared one. The clock is injected so the
// ten-minute window passes in a test's milliseconds.

import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';

import { ABANDON_MS, createApp } from '../server/app.js';
import { loadRules } from '../server/rules.js';
import { applyLobby } from '../server/lobby.js';
import { saveGame } from '../server/save.js';
import { createGame, stepGame } from '../engine/game.js';

const rules = loadRules();
const SEED = 20260818;

async function withRooms(extra, run) {
  const clock = { now: 1000000 };
  const notes = [];
  const app = createApp({
    seed: SEED,
    rules: rules,
    lobby: true,
    bootId: 'boot-rooms',
    nowFn: () => clock.now,
    noteFn: (text) => notes.push(text),
    sweepMs: 10,
    ...extra,
  });
  const address = await app.listen(0, '127.0.0.1');
  try {
    await run({ app: app, clock: clock, notes: notes, wsUrl: `ws://127.0.0.1:${address.port}` });
  } finally {
    await app.close();
  }
}

function connect(url) {
  const socket = new WebSocket(url);
  const inbox = [];
  const waiters = [];
  socket.on('message', (raw) => {
    const message = JSON.parse(raw.toString());
    inbox.push(message);
    for (let i = waiters.length - 1; i >= 0; i--) {
      if (waiters[i].match(message)) {
        waiters[i].resolve(message);
        waiters.splice(i, 1);
      }
    }
  });
  return {
    socket: socket,
    next(match, timeoutMs = 4000) {
      for (const message of inbox) if (match(message)) return Promise.resolve(message);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('timed out waiting for message')), timeoutMs);
        waiters.push({ match: match, resolve: (message) => { clearTimeout(timer); resolve(message); } });
      });
    },
    send(message) {
      socket.send(JSON.stringify(message));
    },
    close() {
      if (socket.readyState === WebSocket.CLOSED) return Promise.resolve();
      const done = new Promise((resolve) => socket.once('close', resolve));
      socket.close();
      return done;
    },
  };
}

async function until(test, what) {
  for (let i = 0; i < 200; i++) {
    if (test()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`never happened: ${what}`);
}

async function startWar(sock) {
  sock.send({ type: 'lobby_ready', ready: true });
  sock.send({ type: 'lobby_start' });
  await sock.next((m) => m.type === 'welcome' && m.lobby === 0);
}

// --- C12 ---------------------------------------------------------------------

test('a war everybody left is saved, and its room opens to the next stranger', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cd-abandon-'));
  const path = join(dir, 'autosave.json');
  try {
    await withRooms({ savePath: path }, async ({ app, clock, notes, wsUrl }) => {
      const host = connect(wsUrl);
      await host.next((m) => m.type === 'welcome');
      await startWar(host);
      assert.equal(app.health().abandoned, 0, 'a war with its commander aboard is not abandoned');
      await host.close();
      await until(() => app.seats.length === 0, 'the host left');
      assert.equal(app.health().abandoned, 1, '/healthz does not say the war runs on the machine alone');

      clock.now += ABANDON_MS - 1;
      await new Promise((resolve) => setTimeout(resolve, 60));
      assert.equal(app.lobby.status, 'running', 'the room was taken back before the window ran out');

      clock.now += 1;
      await until(() => app.lobby.status === 'lobby', 'the room reopened');
      assert.ok(existsSync(path), 'the abandoned war was not saved');
      assert.equal(app.holder.held.length, 0, 'the old war\'s tokens still open seats');
      assert.ok(notes.some((line) => line.startsWith('war abandoned - room reopened')));
      assert.equal(app.health().abandoned, 0);

      // No code: an open room seats a stranger, where the war asked for one.
      const stranger = connect(wsUrl);
      const welcome = await stranger.next((m) => m.type === 'welcome');
      assert.equal(welcome.lobby, 1);
      assert.equal(welcome.team, 0);
      await stranger.close();
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('observers alone do not keep a war alive, and are told the room reopened', async () => {
  await withRooms({}, async ({ app, clock, wsUrl }) => {
    const host = connect(wsUrl);
    await host.next((m) => m.type === 'welcome');
    await startWar(host);
    const watcher = connect(`${wsUrl}/?spectate=1&code=${app.joinCode()}`);
    await watcher.next((m) => m.type === 'welcome' && m.spectator === true);
    await host.close();
    await until(() => app.seats.length === 1, 'the host left');
    clock.now += ABANDON_MS;
    const reopened = await watcher.next((m) => m.type === 'welcome' && m.lobby === 1);
    assert.equal(reopened.spectator, true);
    await watcher.close();
  });
});

test('a war resumed at boot that nobody comes back to reopens after the window', async () => {
  const options = { seed: SEED, islands: 8, enemy: 0, ending: 0, speed: 1 };
  const game = createGame(SEED, applyLobby(rules, options));
  for (let i = 0; i < 10; i++) stepGame(game);
  const saved = JSON.parse(JSON.stringify(saveGame(game, SEED, options)));
  await withRooms({ resume: saved }, async ({ app, clock }) => {
    assert.equal(app.resumed, 1, 'the war did not resume, so this proves nothing');
    assert.equal(app.health().abandoned, 1);
    clock.now += ABANDON_MS;
    await until(() => app.lobby.status === 'lobby', 'the resumed war\'s room reopened');
  });
});

test('a server without a room has nothing to reopen and runs on', async () => {
  const clock = { now: 0 };
  const app = createApp({ seed: SEED, rules: rules, nowFn: () => clock.now, sweepMs: 10 });
  await app.listen(0, '127.0.0.1');
  try {
    clock.now += ABANDON_MS * 2;
    await new Promise((resolve) => setTimeout(resolve, 60));
    assert.equal(app.health().abandoned, 0);
    assert.equal(app.health().status, 'running');
  } finally {
    await app.close();
  }
});

// --- C13 ---------------------------------------------------------------------

test('?room=new opens a private table: its own code, no observers, the machine opposite', async () => {
  await withRooms({}, async ({ app, wsUrl }) => {
    const mine = connect(`${wsUrl}/?room=new`);
    const welcome = await mine.next((m) => m.type === 'welcome');
    assert.equal(welcome.lobby, 1);
    assert.equal(welcome.team, 0);
    const lobby = await mine.next((m) => m.type === 'lobby');
    assert.notEqual(lobby.lobby.code, app.joinCode(), 'the private room shares the public code');
    assert.equal(lobby.lobby.options.observers, 0);
    assert.equal(lobby.lobby.options.enemy, 1);
    assert.equal(app.seats.length, 0, 'the socket sat down in the shared room');
    assert.equal(app.health().rooms, 1);

    await startWar(mine);
    const room = app.rooms[0];
    assert.deepEqual(room.savedOptions.aiTeams, [1], 'nobody is flying the other carrier');
    assert.equal(room.savePath, 0, 'a private room writes over the shared save');
    await mine.next((m) => m.type === 'snapshot');
    await mine.close();
  });
});

test('a friend with the code reaches the private room; a watcher is refused', async () => {
  await withRooms({}, async ({ app, wsUrl }) => {
    const mine = connect(`${wsUrl}/?room=new`);
    const code = (await mine.next((m) => m.type === 'lobby')).lobby.code;
    const friend = connect(`${wsUrl}/?code=${code}`);
    const welcome = await friend.next((m) => m.type === 'welcome');
    assert.equal(welcome.team, 1);
    assert.equal(app.rooms[0].seats.length, 2);
    assert.equal(app.seats.length, 0);
    const watcher = connect(`${wsUrl}/?spectate=1&code=${code}`);
    assert.match((await watcher.next((m) => m.type === 'rejected')).reason, /observers/);
    await Promise.all([mine.close(), friend.close(), watcher.close()]);
  });
});

test('a dropped player\'s token leads back into their own private room', async () => {
  await withRooms({}, async ({ app, wsUrl }) => {
    const mine = connect(`${wsUrl}/?room=new`);
    const first = await mine.next((m) => m.type === 'welcome');
    await mine.close();
    await until(() => app.rooms[0].seats.length === 0, 'the drop');
    const back = connect(`${wsUrl}/?token=${first.token}`);
    const welcome = await back.next((m) => m.type === 'welcome');
    assert.equal(welcome.resumed, 1);
    assert.equal(app.rooms[0].seats.length, 1);
    assert.equal(app.seats.length, 0, 'the token was spent in the shared room');
    await back.close();
  });
});

test('past the cap there is no free table, and a stale client opens nothing', async () => {
  await withRooms({ maxRooms: 1 }, async ({ app, wsUrl }) => {
    const stale = connect(`${wsUrl}/?room=new&proto=999`);
    assert.match((await stale.next((m) => m.type === 'rejected')).reason, /protocol/);
    assert.equal(app.rooms.length, 0, 'a refused socket left a room behind');
    const mine = connect(`${wsUrl}/?room=new`);
    await mine.next((m) => m.type === 'welcome');
    const late = connect(`${wsUrl}/?room=new`);
    assert.equal((await late.next((m) => m.type === 'rejected')).reason, 'no free table');
    const watcher = connect(`${wsUrl}/?room=new&spectate=1`);
    assert.match((await watcher.next((m) => m.type === 'rejected')).reason, /needs a player/);
    await Promise.all([mine.close(), late.close(), watcher.close(), stale.close()]);
  });
});

test('a private room nobody sits in is closed after the window, war or no war', async () => {
  await withRooms({}, async ({ app, clock, notes, wsUrl }) => {
    const idle = connect(`${wsUrl}/?room=new`);
    await idle.next((m) => m.type === 'welcome');
    const playing = connect(`${wsUrl}/?room=new`);
    await playing.next((m) => m.type === 'welcome');
    await startWar(playing);
    await Promise.all([idle.close(), playing.close()]);
    await until(() => app.rooms.every((room) => room.seats.length === 0), 'both left');
    clock.now += ABANDON_MS;
    await until(() => app.rooms.length === 0, 'the rooms were closed');
    assert.equal(notes.filter((line) => line.includes('closed, abandoned')).length, 2);
    assert.equal(app.lobby.status, 'lobby', 'the shared room was touched');
  });
});

test('an abandon window of 0 never gives a room up', async () => {
  const options = { seed: SEED, islands: 8, enemy: 0, ending: 0, speed: 1 };
  const game = createGame(SEED, applyLobby(rules, options));
  for (let i = 0; i < 10; i++) stepGame(game);
  const saved = JSON.parse(JSON.stringify(saveGame(game, SEED, options)));
  await withRooms({ resume: saved, abandonMs: 0 }, async ({ app, clock }) => {
    clock.now += ABANDON_MS * 2;
    await new Promise((resolve) => setTimeout(resolve, 60));
    assert.equal(app.lobby.status, 'running', 'a war resumed with the window off was reopened');
  });
});

test('the first player of a room hears that a friend sat down, so the clock is the table\'s', async () => {
  await withRooms({}, async ({ wsUrl }) => {
    const mine = connect(`${wsUrl}/?room=new`);
    const welcome = await mine.next((m) => m.type === 'welcome');
    assert.equal(welcome.speedLocked, 0);
    const code = (await mine.next((m) => m.type === 'lobby')).lobby.code;
    const friend = connect(`${wsUrl}/?code=${code}`);
    await friend.next((m) => m.type === 'welcome');
    const told = await mine.next((m) => m.type === 'vote' && m.players === 2);
    assert.equal(told.speed, -1, 'no proposal is open; this is only the head count');
    await Promise.all([mine.close(), friend.close()]);
  });
});
