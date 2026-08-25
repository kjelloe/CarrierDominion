// The room before the war, without a network: a seat is any object with a
// team, a name and a ready flag, which is what makes this testable at all.

import test from 'node:test';
import assert from 'node:assert/strict';

import { loadRules } from '../server/rules.js';
import {
  CHAT_KEPT,
  CHAT_MAX,
  OPTION_VALUES,
  allReady,
  applyLobby,
  canStart,
  createLobby,
  hostSeat,
  isHost,
  joinCode,
  lobbyView,
  say,
  setName,
  setOption,
  setReady,
} from '../server/lobby.js';
import { OPTION_ROWS } from '../client/panels/lobby.js';

const rules = loadRules();

function room(...teams) {
  return teams.map((team, i) => ({ team: team, name: `Commander ${i + 1}`, ready: 0 }));
}

function lobby() {
  return createLobby('boot-1', { seed: 20260818, islands: 8, enemy: 1, speed: 1 });
}

test('a join code is five readable characters, and the same for the same boot', () => {
  const code = joinCode('boot-1');
  assert.match(code, /^[0-9A-HJKMNP-TV-Z]{5}$/);
  assert.equal(joinCode('boot-1'), code, 'the same server gave two different codes');
  assert.notEqual(joinCode('boot-2'), code, 'two servers shared a code');
});

test('the host is the longest-seated player, and the seat passes when they go', () => {
  const seats = room(0, 1);
  assert.equal(hostSeat(seats), seats[0]);
  assert.equal(isHost(seats, seats[0]), true);
  assert.equal(isHost(seats, seats[1]), false);
  seats.shift();
  assert.equal(hostSeat(seats), seats[0], 'the lobby died with its host');
});

test('a spectator is never the host and never sails', () => {
  const seats = room(-1, 0);
  assert.equal(hostSeat(seats), seats[1]);
  assert.match(setReady(seats[0], 1), /spectators/);
});

test('only the host sets the war', () => {
  const seats = room(0, 1);
  const room1 = lobby();
  assert.equal(setOption(room1, seats, seats[0], 'islands', 16), '');
  assert.equal(room1.options.islands, 16);
  assert.match(setOption(room1, seats, seats[1], 'islands', 4), /only the host/);
  assert.equal(room1.options.islands, 16, 'a guest changed the war');
});

test('a value off the ladder is refused rather than clamped', () => {
  const seats = room(0);
  const room1 = lobby();
  assert.match(setOption(room1, seats, seats[0], 'islands', 7), /not a value/);
  assert.match(setOption(room1, seats, seats[0], 'nonsense', 1), /no such option/);
  assert.match(setOption(room1, seats, seats[0], 'seed', -1), /whole number/);
  assert.equal(setOption(room1, seats, seats[0], 'seed', 4242), '');
  assert.equal(room1.options.seed, 4242);
});

test('changing the war unreadies the room', () => {
  const seats = room(0, 1);
  const room1 = lobby();
  setReady(seats[0], 1);
  setReady(seats[1], 1);
  assert.equal(allReady(seats), true);
  setOption(room1, seats, seats[0], 'islands', 32);
  assert.equal(allReady(seats), false, 'the room sailed into a war it had not agreed to');
});

test('everybody ready, and one player alone is everybody', () => {
  const alone = room(0);
  const soloRoom = lobby();
  assert.match(canStart(soloRoom, alone, alone[0]), /not everybody/);
  setReady(alone[0], 1);
  assert.equal(canStart(soloRoom, alone, alone[0]), '');

  const seats = room(0, 1);
  const room2 = lobby();
  setReady(seats[0], 1);
  assert.match(canStart(room2, seats, seats[0]), /not everybody/);
  setReady(seats[1], 1);
  assert.equal(canStart(room2, seats, seats[0]), '');
  assert.match(canStart(room2, seats, seats[1]), /only the host/);
});

test('a war already started cannot be started again', () => {
  const seats = room(0);
  const room1 = lobby();
  setReady(seats[0], 1);
  room1.status = 'running';
  assert.match(canStart(room1, seats, seats[0]), /already started/);
});

test('names are trimmed to something printable, and a blank one is ignored', () => {
  const seat = { team: 0, name: 'Commander 1', ready: 0 };
  setName(seat, '  Halsey  ');
  assert.equal(seat.name, 'Halsey');
  setName(seat, '   ');
  assert.equal(seat.name, 'Halsey', 'a blank name wiped a real one');
  setName(seat, 'x'.repeat(80));
  assert.equal(seat.name.length, 24, 'a name of any length was accepted');
  assert.match(setName(seat, 42), /must be text/);
});

test('the room reads the same to everyone in it', () => {
  const seats = room(0, 1);
  const room1 = lobby();
  setReady(seats[1], 1);
  const view = lobbyView(room1, seats);
  assert.equal(view.code, room1.code);
  assert.equal(view.status, 'lobby');
  assert.equal(view.seats.length, 2);
  assert.equal(view.seats[0].host, 1);
  assert.equal(view.seats[1].host, 0);
  assert.equal(view.seats[1].ready, 1);
  assert.equal(view.ready, 0);
  assert.equal(view.options.islands, 8);
});

test('the room folds into a ruleset, which is all a war ever is', () => {
  const room1 = lobby();
  room1.options.islands = 16;
  room1.options.enemy = 0;
  room1.options.ending = 2;
  const chosen = applyLobby(rules, room1.options);
  assert.equal(chosen.world.islandCount, 16);
  assert.deepEqual(chosen.rules.aiTeams, [], 'an empty sea still had an enemy in it');
  assert.ok(chosen.rules.timeCapTicks > 0);
  assert.equal(chosen.rules.pointCap, 0);
  // And the ruleset it came from is untouched: a lobby does not edit the disk.
  assert.equal(rules.world.islandCount, 8);
});

test('a word in the room reaches the room, trimmed to something printable', () => {
  const seats = room(0, 1);
  const room1 = lobby();
  assert.equal(say(room1, seats, seats[0], '  going 16 islands  '), '');
  assert.equal(room1.chat.length, 1);
  assert.equal(room1.chat[0].text, 'going 16 islands');
  assert.equal(room1.chat[0].name, 'Commander 1');
  assert.equal(room1.chat[0].team, 0);

  assert.match(say(room1, seats, seats[1], '   '), /nothing to say/);
  assert.match(say(room1, seats, seats[1], 42), /must be text/);
  assert.equal(room1.chat.length, 1, 'an empty line was still recorded');

  // A long line with a terminal escape in it: bounded, and stripped to
  // printable ASCII before it goes anywhere near another client.
  const nasty = 'x'.repeat(400) + String.fromCharCode(27) + '[31m';
  say(room1, seats, seats[1], nasty);
  assert.equal(room1.chat[1].text.length, CHAT_MAX, 'a very long line was let through whole');
  assert.match(room1.chat[1].text, /^[ -~]+$/, 'control characters reached the other clients');
});

test('the room remembers a conversation, but not an unbounded one', () => {
  const seats = room(0);
  const room1 = lobby();
  for (let i = 0; i < CHAT_KEPT + 10; i++) say(room1, seats, seats[0], `line ${i}`);
  assert.equal(room1.chat.length, CHAT_KEPT);
  assert.equal(room1.chat[CHAT_KEPT - 1].text, `line ${CHAT_KEPT + 9}`);
  assert.equal(lobbyView(room1, seats).chat.length, CHAT_KEPT);
});

test('a spectator may still talk - they are in the room, just not sailing', () => {
  const seats = room(-1);
  const room1 = lobby();
  assert.equal(say(room1, seats, seats[0], 'good luck'), '');
  assert.equal(room1.chat[0].team, -1);
});

test('every ladder the room offers is one the server will accept', () => {
  // The failure this catches: a row in the client that offers a value the
  // server refuses, or stops short of one it allows. The island row sat at
  // 32 for two days after the 64-island ruling because nothing checked.
  for (const row of OPTION_ROWS) {
    const ladder = OPTION_VALUES[row.key];
    assert.notEqual(ladder, undefined, `the room offers "${row.key}", the server knows nothing of it`);
    assert.deepEqual(row.values, ladder, `the "${row.key}" ladders have drifted apart`);
  }
});

test('the room shows every option it holds', () => {
  const lobby = createLobby('probe-boot', { seed: 1, islands: 8, enemy: 1, speed: 1 });
  const shown = lobbyView(lobby, []).options;
  for (const key of Object.keys(lobby.options)) {
    assert.notEqual(shown[key], undefined, `the room keeps "${key}" to itself`);
  }
});

test('a war saved under the old switches still folds to the shape it was played in', () => {
  // The command log is the save format, so a war recorded before the start
  // ladder existed must still replay as the war it was: the fold reads the
  // two switches the ladder replaced.
  const rules = loadRules();
  const legacyAction = applyLobby(rules, { islands: 8, teams: 2, game: 1 });
  assert.equal(legacyAction.rules.startShape, 2, 'the old Action Game lost its estates');
  const legacyBare = applyLobby(rules, { islands: 8, teams: 2, home: 0 });
  assert.equal(legacyBare.rules.startShape, 1, 'the old from-zero opening grew an island');
  const legacyDefault = applyLobby(rules, { islands: 8, teams: 2 });
  assert.equal(legacyDefault.rules.startShape, 0);
  // And the ladder wins when it is present.
  const modern = applyLobby(rules, { islands: 8, teams: 2, start: 3, game: 1, home: 0 });
  assert.equal(modern.rules.startShape, 3, 'the ladder should outrank what it replaced');
});
