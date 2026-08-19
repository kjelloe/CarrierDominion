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
  });
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
