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

// Owner's ruling 2026-08-27 (review R-006): **they should get their ship
// back.** This test used to assert the opposite - that once the AI had the
// carrier the token was spent - and that rule had a defect hiding behind it:
// the sweep RELEASED the hold, so `reclaim` could not find the token at all
// and a late commander was handed the lowest free seat instead, with someone
// else's carrier and their own name discarded.
//
// The machine is a caretaker, not a claimant.
test('a commander back late gets their own carrier back off the machine', () => {
  const h = holder();
  const record = holdSeat(h, { team: 0, name: 'A' });
  h.clock.now += GRACE_MS + 1;
  for (const found of expired(h)) found.aiTaken = 1;
  const back = reclaim(h, record.token);
  assert.notEqual(back, -1, 'the token no longer opened the seat it named');
  assert.equal(back.team, 0, 'they were given somebody else\'s carrier');
  assert.equal(back.name, 'A', 'they came back as a stranger');
});

test('a seat the machine is minding is still open to a newcomer', () => {
  // The other half of the ruling: a hold that is only being kept for an
  // absent commander must not reserve the seat forever, or a war leaks a
  // carrier every time somebody leaves for good.
  const h = holder();
  holdSeat(h, { team: 0, name: 'A' });
  assert.equal(isHeld(h, 0), true, 'a fresh hold is a hold');
  h.clock.now += GRACE_MS + 1;
  for (const found of expired(h)) found.aiTaken = 1;
  assert.equal(isHeld(h, 0), false, 'the machine kept a newcomer out of an empty seat');
});

test('a hold the machine has taken is swept once, not every tick', () => {
  // `expired` must stop reporting a record the caretaker already has, or the
  // server enqueues set_ai for the same team on every single tick forever.
  const h = holder();
  holdSeat(h, { team: 0, name: 'A' });
  h.clock.now += GRACE_MS + 1;
  const first = expired(h);
  assert.equal(first.length, 1);
  for (const found of first) found.aiTaken = 1;
  const second = expired(h);
  assert.equal(second.length, 0, 'the same expired hold was reported twice');
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

// --- the token is not guessable, and not confusable (review R-012) ----------

test('a seat token is long and not drawn from Math.random', async () => {
  const { createApp } = await import('../server/app.js');
  const { loadRules } = await import('../server/rules.js');
  const app = createApp({ seed: 20260818, rules: loadRules() });
  try {
    const seen = new Set();
    for (let i = 0; i < 64; i++) {
      const token = app.holder.tokenFn();
      assert.ok(token.length >= 16, `a token of ${token.length} characters is guessable`);
      assert.ok(!seen.has(token), 'two seat tokens came out the same');
      seen.add(token);
      // base64url only, so it survives a query string untouched.
      assert.match(token, /^[A-Za-z0-9_-]+$/);
    }
  } finally {
    await app.close();
  }
});

test('a parameter that merely ends in "token" does not reclaim a seat', async () => {
  // `indexOf('token=')` matched `?xtoken=` too, so a query parameter whose
  // NAME happened to end in the right letters was read as a seat token
  // (review R-012). The URL is parsed now.
  const app = createApp({ seed: 20260818, rules: rules });
  const address = await app.listen(0, '127.0.0.1');
  const wsUrl = `ws://127.0.0.1:${address.port}`;
  try {
    const first = connect(wsUrl);
    await first.open();
    const welcome = await first.next((m) => m.type === 'welcome');
    assert.equal(welcome.team, 0);
    first.close();
    await new Promise((resolve) => setTimeout(resolve, 120));

    // The real token, under a name that is not `token`.
    const sneak = connect(`${wsUrl}/?xtoken=${welcome.token}`);
    await sneak.open();
    const got = await sneak.next((m) => m.type === 'welcome');
    assert.equal(got.resumed, 0, 'a lookalike parameter reclaimed a held seat');
    assert.notEqual(got.team, 0, 'a lookalike parameter was given the held carrier');
    sneak.close();

    // And the real one still works, so the parser did not simply stop reading.
    const back = connect(`${wsUrl}/?token=${welcome.token}`);
    await back.open();
    const resumed = await back.next((m) => m.type === 'welcome');
    assert.equal(resumed.resumed, 1, 'the genuine token stopped working');
    assert.equal(resumed.team, 0);
    back.close();
  } finally {
    await app.close();
  }
});
