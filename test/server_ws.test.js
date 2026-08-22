import test from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';

import { createApp } from '../server/app.js';
import { loadRules } from '../server/rules.js';

const rules = loadRules();

async function withServer(run) {
  const app = createApp({ seed: 20260818, rules: rules });
  const address = await app.listen(0, '127.0.0.1');
  try {
    await run(app, `http://127.0.0.1:${address.port}`, `ws://127.0.0.1:${address.port}`);
  } finally {
    await app.close();
  }
}

function connect(wsUrl) {
  const socket = new WebSocket(wsUrl);
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
    inbox: inbox,
    open() {
      return new Promise((resolve, reject) => {
        socket.once('open', resolve);
        socket.once('error', reject);
      });
    },
    next(match, timeoutMs = 4000) {
      for (let i = 0; i < inbox.length; i++) {
        if (match(inbox[i])) return Promise.resolve(inbox[i]);
      }
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('timed out waiting for message')), timeoutMs);
        waiters.push({
          match: match,
          resolve: (message) => { clearTimeout(timer); resolve(message); },
        });
      });
    },
    // Where the inbox stands NOW: pass it to nextAfter so a wait cannot be
    // satisfied by a stale message from an earlier phase of the same test.
    mark() { return inbox.length; },
    nextAfter(mark, match, timeoutMs = 4000) {
      for (let i = mark; i < inbox.length; i++) {
        if (match(inbox[i])) return Promise.resolve(inbox[i]);
      }
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('timed out waiting for message')), timeoutMs);
        waiters.push({
          match: match,
          resolve: (message) => { clearTimeout(timer); resolve(message); },
        });
      });
    },
    send(message) { socket.send(JSON.stringify(message)); },
    close() { socket.close(); },
  };
}

test('healthz reports a live, ticking war', async () => {
  await withServer(async (app, httpUrl) => {
    await new Promise((resolve) => setTimeout(resolve, 200));
    const body = await (await fetch(`${httpUrl}/healthz`)).json();
    assert.equal(body.ok, true);
    assert.equal(body.game, 'carrier-dominion');
    assert.ok(body.tick > 0, 'the clock should be running');
    assert.match(body.stateHash, /^[0-9a-f]{16}$/);
    assert.equal(body.rulesHash, app.game.state.rulesHash);
    assert.ok(body.rssMb > 0);
    assert.equal(body.status, 'running');
    assert.equal(body.joinCode, '');
  });
});

test('healthz says a lobby is a lobby, not a hung server', async () => {
  const app = createApp({ seed: 20260818, rules: rules, lobby: true, bootId: 'boot-health' });
  const address = await app.listen(0, '127.0.0.1');
  try {
    await new Promise((resolve) => setTimeout(resolve, 200));
    const body = await (await fetch(`http://127.0.0.1:${address.port}/healthz`)).json();
    assert.equal(body.ok, true);
    assert.equal(body.status, 'lobby');
    assert.match(body.joinCode, /^[0-9A-HJKMNP-TV-Z]{5}$/);
    assert.equal(body.tick, 0, 'a war nobody started should not be ticking');
  } finally {
    await app.close();
  }
});

test('the client page and its module graph are served', async () => {
  await withServer(async (_app, httpUrl) => {
    for (const path of [
      '/',
      '/client/main.js',
      '/client/vendor/three.module.min.js',
      '/engine/game.js',
      '/shared/view.js',
      '/data/world.json',
    ]) {
      const response = await fetch(`${httpUrl}${path}`);
      assert.equal(response.status, 200, `${path} returned ${response.status}`);
    }
  });
});

test('a path traversal out of the served roots is refused', async () => {
  await withServer(async (_app, httpUrl) => {
    for (const path of ['/../package.json', '/client/../../package.json', '/data/../../ops/README.md']) {
      const response = await fetch(`${httpUrl}${path}`);
      assert.notEqual(response.status, 200, `${path} was served`);
    }
  });
});

test('a joining client is seated and starts receiving its own view', async () => {
  await withServer(async (_app, _httpUrl, wsUrl) => {
    const client = connect(wsUrl);
    await client.open();
    const welcome = await client.next((m) => m.type === 'welcome');
    assert.equal(welcome.team, 0);
    assert.equal(welcome.spectator, false);
    const snapshot = await client.next((m) => m.type === 'snapshot');
    assert.equal(snapshot.view.team, 0);
    assert.match(snapshot.stateHash, /^[0-9a-f]{16}$/);
    assert.equal(snapshot.view.rng, undefined, 'the view must not carry engine internals');
    client.close();
  });
});

test('two clients take the two seats and see different views', async () => {
  await withServer(async (_app, _httpUrl, wsUrl) => {
    const first = connect(wsUrl);
    await first.open();
    await first.next((m) => m.type === 'welcome');
    const second = connect(wsUrl);
    await second.open();
    const welcome = await second.next((m) => m.type === 'welcome');
    assert.equal(welcome.team, 1);
    const view = (await second.next((m) => m.type === 'snapshot')).view;
    assert.equal(view.team, 1);
    assert.equal(view.carriers[0].team, 1);
    first.close();
    second.close();
  });
});

test('a command from the seat that owns the hull is obeyed', async () => {
  await withServer(async (_app, _httpUrl, wsUrl) => {
    const client = connect(wsUrl);
    await client.open();
    await client.next((m) => m.type === 'welcome');
    client.send({ type: 'command', command: { type: 'set_throttle', carrierId: 0, throttle: 100 } });
    const moving = await client.next(
      (m) => m.type === 'snapshot' && m.view.carriers[0].throttle === 100,
      6000,
    );
    assert.equal(moving.view.carriers[0].throttle, 100);
    client.close();
  });
});

test('a command aimed at the other team hull is refused', async () => {
  await withServer(async (_app, _httpUrl, wsUrl) => {
    const client = connect(wsUrl);
    await client.open();
    await client.next((m) => m.type === 'welcome');
    client.send({ type: 'command', command: { type: 'set_throttle', carrierId: 1, throttle: 100 } });
    const rejected = await client.next((m) => m.type === 'rejected');
    assert.match(rejected.reason, /another team/);
    client.close();
  });
});

test('the tick is server-owned and cannot be driven by a client', async () => {
  await withServer(async (_app, _httpUrl, wsUrl) => {
    const client = connect(wsUrl);
    await client.open();
    await client.next((m) => m.type === 'welcome');
    client.send({ type: 'command', command: { type: 'advance_tick' } });
    const rejected = await client.next((m) => m.type === 'rejected');
    assert.match(rejected.reason, /server-owned/);
    client.close();
  });
});

test('rubbish on the wire is answered, not crashed on', async () => {
  await withServer(async (_app, _httpUrl, wsUrl) => {
    const client = connect(wsUrl);
    await client.open();
    await client.next((m) => m.type === 'welcome');
    client.socket.send('this is not json');
    const first = await client.next((m) => m.type === 'rejected');
    assert.match(first.reason, /malformed json/);
    client.send({ type: 'nonsense' });
    const second = await client.next((m) => m.type === 'rejected' && m.reason !== first.reason);
    assert.match(second.reason, /unknown message type/);
    client.close();
  });
});

test('one player alone carries the vote by themselves', async () => {
  await withServer(async (app, _httpUrl, wsUrl) => {
    const first = connect(wsUrl);
    await first.open();
    const welcome = await first.next((m) => m.type === 'welcome');
    assert.equal(welcome.speed, 1);
    assert.equal(welcome.speedLocked, 0);

    // A vote of one is unanimous by definition, so this needs no special case.
    first.send({ type: 'set_speed', speed: 8 });
    const confirmed = await first.next((m) => m.type === 'speed');
    assert.equal(confirmed.speed, 8);
    assert.equal(app.clock.speed, 8);
    first.close();
  });
});

test('in a shared war the clock moves only when everybody agrees', async () => {
  await withServer(async (app, _httpUrl, wsUrl) => {
    const first = connect(wsUrl);
    await first.open();
    await first.next((m) => m.type === 'welcome');

    const second = connect(wsUrl);
    await second.open();
    const joined = await second.next((m) => m.type === 'welcome');
    assert.equal(joined.speedLocked, 1, 'the newcomer should be told the clock is shared');

    // One voice is not enough - and the table is told where the vote stands.
    second.send({ type: 'set_speed', speed: 4 });
    const standing = await first.next((m) => m.type === 'vote');
    assert.equal(standing.speed, 4);
    assert.equal(standing.agreed, 1);
    assert.equal(standing.players, 2);
    assert.equal(app.clock.speed, 1, 'one vote moved the clock');

    // The other agrees, and it carries.
    first.send({ type: 'set_speed', speed: 4 });
    const carried = await second.next((m) => m.type === 'speed');
    assert.equal(carried.speed, 4);
    assert.equal(app.clock.speed, 4);

    // And the slate is clean for the next one. Matched on the cleared value
    // rather than on "the next vote message": the inbox still holds the one
    // that carried.
    const cleared = await second.next((m) => m.type === 'vote' && m.speed === -1);
    assert.equal(cleared.agreed, 0);

    first.close();
    second.close();
  });
});

test('a vote everybody but one agreed on carries when that one leaves', async () => {
  await withServer(async (app, _httpUrl, wsUrl) => {
    const first = connect(wsUrl);
    await first.open();
    await first.next((m) => m.type === 'welcome');
    const second = connect(wsUrl);
    await second.open();
    await second.next((m) => m.type === 'welcome');

    first.send({ type: 'set_speed', speed: 16 });
    await second.next((m) => m.type === 'vote');
    assert.equal(app.clock.speed, 1);

    // The seat that never voted goes. What is left is unanimous.
    second.close();
    const carried = await first.next((m) => m.type === 'speed');
    assert.equal(carried.speed, 16);
    assert.equal(app.clock.speed, 16);
    first.close();
  });
});

test('a speed off the ladder is refused', async () => {
  await withServer(async (app, _httpUrl, wsUrl) => {
    const client = connect(wsUrl);
    await client.open();
    await client.next((m) => m.type === 'welcome');
    client.send({ type: 'set_speed', speed: 3 });
    const refused = await client.next((m) => m.type === 'rejected');
    assert.match(refused.reason, /no such speed/);
    assert.equal(app.clock.speed, 1);
    client.close();
  });
});

test('a compressed server really does tick faster', async () => {
  const app = createApp({ seed: 20260818, rules: rules, speed: 16 });
  await app.listen(0, '127.0.0.1');
  try {
    await new Promise((resolve) => setTimeout(resolve, 400));
    // 400 ms at x16 is ~128 ticks; a x1 server would manage about 8. The
    // assertion is deliberately loose - this is about the multiplier being
    // applied at all, not about timer precision on a loaded machine.
    assert.ok(app.game.state.tick > 40, `only reached tick ${app.game.state.tick}`);
    assert.equal(app.health().speed, 16);
  } finally {
    await app.close();
  }
});

// A server started with lobby: true holds the war until the room says go.
async function withLobby(run) {
  const app = createApp({ seed: 20260818, rules: rules, lobby: true, bootId: 'boot-test' });
  const address = await app.listen(0, '127.0.0.1');
  try {
    await run(app, `ws://127.0.0.1:${address.port}`);
  } finally {
    await app.close();
  }
}

test('a lobby holds the war until the host starts it', async () => {
  await withLobby(async (app, wsUrl) => {
    const host = connect(wsUrl);
    await host.open();
    const welcome = await host.next((m) => m.type === 'welcome');
    assert.equal(welcome.lobby, 1, 'the client was not told it is in a lobby');
    const room = await host.next((m) => m.type === 'lobby');
    assert.match(room.lobby.code, /^[0-9A-HJKMNP-TV-Z]{5}$/);
    assert.equal(room.lobby.seats[0].host, 1);

    // No war yet, and nothing pretends otherwise.
    host.send({ type: 'command', command: { type: 'set_throttle', carrierId: 0, throttle: 50 } });
    const refused = await host.next((m) => m.type === 'rejected');
    assert.match(refused.reason, /not started/);

    host.send({ type: 'lobby_ready', ready: true });
    await host.next((m) => m.type === 'lobby' && m.lobby.ready === 1);
    host.send({ type: 'lobby_start' });
    const started = await host.next((m) => m.type === 'welcome' && m.lobby === 0);
    assert.equal(started.lobby, 0);
    const snapshot = await host.next((m) => m.type === 'snapshot');
    assert.ok(snapshot.tick >= 0);
    host.close();
  });
});

test('the lobby options are the war that starts', async () => {
  await withLobby(async (app, wsUrl) => {
    const host = connect(wsUrl);
    await host.open();
    await host.next((m) => m.type === 'welcome');

    host.send({ type: 'lobby_option', key: 'islands', value: 4 });
    host.send({ type: 'lobby_option', key: 'seed', value: 4242 });
    await host.next((m) => m.type === 'lobby' && m.lobby.options.seed === 4242);
    host.send({ type: 'lobby_ready', ready: true });
    host.send({ type: 'lobby_start' });
    const snapshot = await host.next((m) => m.type === 'snapshot');
    assert.equal(snapshot.view.islands.length, 4, 'the war ignored the room');
    assert.equal(app.seed, 4242);
    host.close();
  });
});

test('a guest cannot set the war, and cannot start it', async () => {
  await withLobby(async (app, wsUrl) => {
    const host = connect(wsUrl);
    await host.open();
    await host.next((m) => m.type === 'welcome');
    const guest = connect(wsUrl);
    await guest.open();
    await guest.next((m) => m.type === 'welcome');

    guest.send({ type: 'lobby_option', key: 'islands', value: 32 });
    const refusedOption = await guest.next((m) => m.type === 'rejected');
    assert.match(refusedOption.reason, /only the host/);

    guest.send({ type: 'lobby_ready', ready: true });
    guest.send({ type: 'lobby_start' });
    const refusedStart = await guest.next(
      (m) => m.type === 'rejected' && /only the host/.test(m.reason) && m !== refusedOption,
    );
    assert.match(refusedStart.reason, /only the host/);
    assert.equal(app.lobby.status, 'lobby', 'a guest started the war');
    host.close();
    guest.close();
  });
});

test('the host waits for the room', async () => {
  await withLobby(async (app, wsUrl) => {
    const host = connect(wsUrl);
    await host.open();
    await host.next((m) => m.type === 'welcome');
    const guest = connect(wsUrl);
    await guest.open();
    await guest.next((m) => m.type === 'welcome');

    host.send({ type: 'lobby_ready', ready: true });
    host.send({ type: 'lobby_start' });
    const waiting = await host.next((m) => m.type === 'rejected');
    assert.match(waiting.reason, /not everybody/);

    guest.send({ type: 'lobby_ready', ready: true });
    await host.next((m) => m.type === 'lobby' && m.lobby.ready === 1);
    host.send({ type: 'lobby_start' });
    await host.next((m) => m.type === 'snapshot');
    assert.equal(app.lobby.status, 'running');
    host.close();
    guest.close();
  });
});

test('the table gets its room back when the war ends, and fights again', async () => {
  const app = createApp({
    seed: 20260818, rules: rules, lobby: true, watch: true, bootId: 'boot-evening',
  });
  const address = await app.listen(0, '127.0.0.1');
  const client = connect(`ws://127.0.0.1:${address.port}`);
  try {
    await client.open();
    await client.next((m) => m.type === 'welcome' && m.lobby === 1);
    const code = app.lobby.code;

    // Reopening a room that is already open is a harmless no-op.
    client.send({ type: 'lobby_reopen' });

    // First war of the evening.
    client.send({ type: 'lobby_ready', ready: 1 });
    client.send({ type: 'lobby_start' });
    await client.next((m) => m.type === 'welcome' && m.lobby === 0);
    await client.next((m) => m.type === 'snapshot');

    // Mid-war the room stays shut: finishing and abandoning are different.
    client.send({ type: 'lobby_reopen' });
    await client.next((m) => m.type === 'rejected' && /not over/.test(m.reason));

    // The war ends; the host reopens the room. Same join code - one code is
    // a whole evening, not one war.
    app.game.state.phase = 1;
    app.game.state.winner = 0;
    app.game.state.winReason = 2;
    let mark = client.mark();
    client.send({ type: 'lobby_reopen' });
    await client.nextAfter(mark, (m) => m.type === 'welcome' && m.lobby === 1);
    const room = await client.nextAfter(mark, (m) => m.type === 'lobby');
    assert.equal(room.lobby.code, code, 'the join code changed between wars');
    assert.equal(room.lobby.status, 'lobby');
    assert.equal(room.lobby.seats[0].ready, 0, 'ready survived into the new table');

    // And the second war starts clean: fresh game, fresh ticks, fresh watchdog.
    const finished = app.game;
    mark = client.mark();
    client.send({ type: 'lobby_ready', ready: 1 });
    client.send({ type: 'lobby_start' });
    await client.nextAfter(mark, (m) => m.type === 'welcome' && m.lobby === 0);
    const fresh = await client.nextAfter(mark, (m) => m.type === 'snapshot');
    assert.notEqual(app.game, finished, 'the second war reused the finished game');
    assert.equal(app.game.state.phase, 0);
    assert.ok(fresh.tick <= 20, 'the second war inherited the first war clock');
    assert.equal(app.watch.findings.length, 0);
    assert.ok(app.watch.ticks <= fresh.tick, 'the watchdog carried the first war report over');
  } finally {
    client.close();
    await app.close();
  }
});
