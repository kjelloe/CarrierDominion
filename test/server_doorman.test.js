// The door: who may join, and who must wait (owner rulings, 2026-08-31).
//
// Until this existed NOTHING gated a seat - a socket with no token and no code
// was handed team 0, a real carrier, on whatever hostname the game sat on. The
// owner's ruling was not "lock it": an open lobby is how a drop-in game works
// and every sibling on that box is one. It was two narrower things - a war
// already in progress needs the room's code, and the host can remove somebody
// who then cannot walk straight back in.
//
// `admit` is pure, so the policy is tested here without a network; the socket
// behaviour it produces is tested in server_ws.test.js.

import test from 'node:test';
import assert from 'node:assert/strict';

import { BAN_MS, admit, banAddress, bannedFor, createDoorman } from '../server/doorman.js';

// A clock the test drives, so a one-minute ban does not cost a minute.
function fakeClock(startMs) {
  const clock = { now: startMs };
  return { fn: () => clock.now, advance: (ms) => { clock.now += ms; } };
}

test('an open lobby lets a stranger in, and that is deliberate', () => {
  const door = createDoorman(() => 1000);
  assert.equal(admit(door, {
    address: '10.0.0.5', hasToken: 0, roomCode: 'ABCDE', started: 0, code: '',
  }), '', 'the lobby refused a newcomer, which is not what was ruled');
});

test('a war already sailed needs the room code', () => {
  const door = createDoorman(() => 1000);
  const refused = admit(door, {
    address: '10.0.0.5', hasToken: 0, roomCode: 'ABCDE', started: 1, code: '',
  });
  assert.match(refused, /join code/, `expected a refusal about the code, got "${refused}"`);
  assert.equal(admit(door, {
    address: '10.0.0.5', hasToken: 0, roomCode: 'ABCDE', started: 1, code: 'WRONG',
  }) === '', false, 'a wrong code was accepted');
  assert.equal(admit(door, {
    address: '10.0.0.5', hasToken: 0, roomCode: 'ABCDE', started: 1, code: 'ABCDE',
  }), '', 'the right code was refused');
});

test('a returning commander needs no code, because their token is stronger', () => {
  // The 2026-08-27 ruling: a commander back late gets their ship back. Making
  // them re-type a code to reclaim a seat this server already issued them a
  // token for would quietly undo it.
  const door = createDoorman(() => 1000);
  assert.equal(admit(door, {
    address: '10.0.0.5', hasToken: 1, roomCode: 'ABCDE', started: 1, code: '',
  }), '', 'a token holder was asked for the code');
});

test('a war with no room at all demands nothing', () => {
  // LOBBY=0 (every test, every probe, a headless host) issues no code, so
  // there is no lock and inventing one would refuse everybody forever.
  const door = createDoorman(() => 1000);
  assert.equal(admit(door, {
    address: '10.0.0.5', hasToken: 0, roomCode: '', started: 1, code: '',
  }), '');
});

test('a kicked address waits a minute, and is told how long', () => {
  const clock = fakeClock(100000);
  const door = createDoorman(clock.fn);
  banAddress(door, '10.0.0.7');

  const refused = admit(door, {
    address: '10.0.0.7', hasToken: 0, roomCode: 'ABCDE', started: 0, code: 'ABCDE',
  });
  assert.match(refused, /removed/, 'a kicked address got in');
  assert.match(refused, /\d+s/, 'the refusal does not say how long - "no" is a mystery');

  // Even with a valid token: the ban is checked BEFORE the token, or a kick
  // would be undone by the reconnect two seconds later.
  assert.notEqual(admit(door, {
    address: '10.0.0.7', hasToken: 1, roomCode: 'ABCDE', started: 1, code: '',
  }), '', 'a kicked player reclaimed their seat with their token');

  // Somebody else on another address is unaffected.
  assert.equal(admit(door, {
    address: '10.0.0.8', hasToken: 0, roomCode: 'ABCDE', started: 0, code: '',
  }), '', 'kicking one address shut out another');

  clock.advance(BAN_MS - 1000);
  assert.notEqual(bannedFor(door, '10.0.0.7'), 0, 'the ban expired early');
  clock.advance(2000);
  assert.equal(bannedFor(door, '10.0.0.7'), 0, 'the ban outlasted its minute');
  assert.equal(admit(door, {
    address: '10.0.0.7', hasToken: 0, roomCode: 'ABCDE', started: 0, code: '',
  }), '', 'a minute passed and they still could not come back');
});

test('the countdown never reads zero while the ban stands', () => {
  // Ceil, not round: at 400ms left a "0s" refusal reads as a refusal for no
  // reason at all.
  const clock = fakeClock(0);
  const door = createDoorman(clock.fn);
  banAddress(door, '10.0.0.9');
  clock.advance(BAN_MS - 400);
  assert.ok(bannedFor(door, '10.0.0.9') >= 1);
});

test('a second kick extends the wait rather than restarting the clock short', () => {
  const clock = fakeClock(0);
  const door = createDoorman(clock.fn);
  banAddress(door, '10.0.0.9');
  clock.advance(50000);
  banAddress(door, '10.0.0.9');
  assert.ok(bannedFor(door, '10.0.0.9') > 50, 'the second kick did not extend the ban');
  assert.equal(door.bans.length, 1, 'the same address was banned twice over');
});

test('an unknown address is never banned, or one kick closes the whole LAN', () => {
  const door = createDoorman(() => 1000);
  assert.equal(banAddress(door, ''), 0);
  assert.equal(banAddress(door, undefined), 0);
  assert.equal(bannedFor(door, ''), 0);
  assert.equal(admit(door, {
    address: '', hasToken: 0, roomCode: 'ABCDE', started: 0, code: '',
  }), '');
});

test('expired bans are forgotten, not merely ignored', () => {
  const clock = fakeClock(0);
  const door = createDoorman(clock.fn);
  banAddress(door, 'a');
  banAddress(door, 'b');
  assert.equal(door.bans.length, 2);
  clock.advance(BAN_MS + 1);
  bannedFor(door, 'anyone');
  assert.equal(door.bans.length, 0, 'the list grows forever on a long-running server');
});
