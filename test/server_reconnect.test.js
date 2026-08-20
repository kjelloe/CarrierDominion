// Holding a seat for somebody who dropped, and handing it to the machine when
// they do not come back. Clock and tokens are injected, so none of this is
// timing-dependent.

import test from 'node:test';
import assert from 'node:assert/strict';

import { WebSocket } from 'ws';
import { createApp } from '../server/app.js';
import { loadRules } from '../server/rules.js';
import {
  GRACE_MS,
  createHolder,
  expired,
  holdSeat,
  isHeld,
  reclaim,
  release,
} from '../server/reconnect.js';

const rules = loadRules();

function holder(startMs = 1000) {
  const clock = { now: startMs };
  let next = 0;
  const made = createHolder(() => clock.now, () => `token-${next++}`);
  made.clock = clock;
  return made;
}

test('a dropped seat is held, and a spectator has nothing to hold', () => {
  const h = holder();
  const record = holdSeat(h, { team: 0, name: 'Halsey' });
  assert.equal(record.team, 0);
  assert.equal(record.name, 'Halsey');
  assert.match(record.token, /^token-/);
  assert.equal(record.untilMs, 1000 + GRACE_MS);
  assert.equal(isHeld(h, 0), true);
  assert.equal(holdSeat(h, { team: -1 }), -1, 'a watcher was given a seat to come back to');
});

test('a held seat is not free for somebody else to take', () => {
  const h = holder();
  holdSeat(h, { team: 1, name: 'Nimitz' });
  assert.equal(isHeld(h, 1), true);
  assert.equal(isHeld(h, 0), false);
  release(h, 1);
  assert.equal(isHeld(h, 1), false);
});

test('the same player comes back to the same seat, with their own name on it', () => {
  const h = holder();
  const record = holdSeat(h, { team: 1, name: 'Nimitz' });
  h.clock.now += 5000;
  const back = reclaim(h, record.token);
  assert.notEqual(back, -1);
  assert.equal(back.team, 1);
  assert.equal(back.name, 'Nimitz');
  // And the hold is spent: the same token does not work twice.
  assert.equal(reclaim(h, record.token), -1);
});

test('a token nobody issued gets nothing', () => {
  const h = holder();
  holdSeat(h, { team: 0, name: 'A' });
  assert.equal(reclaim(h, 'not-a-token'), -1);
  assert.equal(reclaim(h, ''), -1);
  assert.equal(reclaim(h, 42), -1);
});

test('a window that ran out is reported once, for the machine to take over', () => {
  const h = holder();
  const record = holdSeat(h, { team: 0, name: 'A' });
  assert.deepEqual(expired(h), [], 'a seat expired before its window did');
  h.clock.now += GRACE_MS + 1;
  assert.deepEqual(expired(h).map((r) => r.team), [0]);
  // Marking it taken stops it being reported again every tick.
  record.aiTaken = 1;
  assert.deepEqual(expired(h), []);
});

test('a late player is still let back in if nobody took the seat', () => {
  const h = holder();
  const record = holdSeat(h, { team: 0, name: 'A' });
  h.clock.now += GRACE_MS * 3;
  // The window is long gone, but the machine never took over - so the seat is
  // still theirs. The grace window exists to stop a race, not to punish
  // somebody whose train went into a tunnel.
  const back = reclaim(h, record.token);
  assert.notEqual(back, -1);
  assert.equal(back.team, 0);
});

test('once the machine has it, the token is no longer good', () => {
  const h = holder();
  const record = holdSeat(h, { team: 0, name: 'A' });
  h.clock.now += GRACE_MS + 1;
  for (const found of expired(h)) found.aiTaken = 1;
  assert.equal(reclaim(h, record.token), -1);
});

// --- and the same thing over a real socket -------------------------------

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
    open() {
      return new Promise((resolve, reject) => {
        socket.once('open', resolve);
        socket.once('error', reject);
      });
    },
    next(match, timeoutMs = 4000) {
      for (const message of inbox) if (match(message)) return Promise.resolve(message);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('timed out')), timeoutMs);
        waiters.push({ match: match, resolve: (m) => { clearTimeout(timer); resolve(m); } });
      });
    },
    close() { socket.close(); },
  };
}

test('a returning client is given its own carrier back', async () => {
  const app = createApp({ seed: 20260818, rules: rules });
  const address = await app.listen(0, '127.0.0.1');
  const wsUrl = `ws://127.0.0.1:${address.port}`;
  try {
    const first = connect(wsUrl);
    await first.open();
    const welcome = await first.next((m) => m.type === 'welcome');
    assert.equal(welcome.team, 0);
    assert.match(welcome.token, /.+/);
    assert.equal(welcome.resumed, 0);
    first.close();
    await new Promise((resolve) => setTimeout(resolve, 120));

    // A newcomer with no token must NOT be handed the held seat.
    const stranger = connect(wsUrl);
    await stranger.open();
    const strangerWelcome = await stranger.next((m) => m.type === 'welcome');
    assert.notEqual(strangerWelcome.team, 0, 'a stranger was put in a held seat');

    const back = connect(`${wsUrl}/?token=${welcome.token}`);
    await back.open();
    const resumed = await back.next((m) => m.type === 'welcome');
    assert.equal(resumed.team, 0, 'the returning player was not given their own seat');
    assert.equal(resumed.resumed, 1);
    stranger.close();
    back.close();
  } finally {
    await app.close();
  }
});

test('a seat nobody comes back to is handed to the machine', async () => {
  const clock = { now: 1000 };
  const app = createApp({
    seed: 20260818,
    rules: rules,
    nowFn: () => clock.now,
    tokenFn: () => 'fixed-token',
  });
  const address = await app.listen(0, '127.0.0.1');
  try {
    const player = connect(`ws://127.0.0.1:${address.port}`);
    await player.open();
    await player.next((m) => m.type === 'welcome');
    const brainsBefore = app.game.state.ai.map((b) => b.team);
    assert.equal(brainsBefore.includes(0), false, 'team 0 started under AI control');

    player.close();
    // Let the server notice the drop BEFORE moving the clock: the hold starts
    // when the seat is actually released, so advancing first would start the
    // window at the new now and the seat would never expire.
    await new Promise((resolve) => setTimeout(resolve, 200));
    assert.equal(app.holder.held.length, 1, 'the seat was not held at all');

    clock.now += GRACE_MS + 1;
    await new Promise((resolve) => setTimeout(resolve, 400));
    assert.ok(
      app.game.state.ai.some((b) => b.team === 0),
      'nobody came back and the carrier was left at anchor',
    );
  } finally {
    await app.close();
  }
});
