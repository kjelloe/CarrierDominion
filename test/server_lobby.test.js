// The room before the war, without a network: a seat is any object with a
// team, a name and a ready flag, which is what makes this testable at all.

import test from 'node:test';
import assert from 'node:assert/strict';

import { loadRules } from '../server/rules.js';
import {
  allReady,
  applyLobby,
  canStart,
  createLobby,
  hostSeat,
  isHost,
  joinCode,
  lobbyView,
  setName,
  setOption,
  setReady,
} from '../server/lobby.js';

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
