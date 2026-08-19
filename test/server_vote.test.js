// The speed vote, without a network: a seat here is any object with a team and
// a vote, which is the whole reason the rule lives in its own module.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  NO_VOTE,
  castVote,
  clearVotes,
  openProposal,
  playerSeats,
  tally,
  unanimous,
} from '../server/vote.js';

function table(...teams) {
  return teams.map((team) => ({ team: team, vote: NO_VOTE }));
}

test('a table nobody is sitting at carries nothing', () => {
  assert.equal(unanimous([]), NO_VOTE);
  assert.equal(unanimous(table(-1, -1)), NO_VOTE, 'spectators alone decided the clock');
});

test('a vote of one is unanimous by definition', () => {
  const seats = table(0);
  assert.equal(castVote(seats, seats[0], 8), '');
  assert.equal(unanimous(seats), 8);
});

test('two players must agree, and agreeing on different speeds is not agreeing', () => {
  const seats = table(0, 1);
  castVote(seats, seats[0], 4);
  assert.equal(unanimous(seats), NO_VOTE, 'one voice carried the table');
  castVote(seats, seats[1], 16);
  assert.equal(unanimous(seats), NO_VOTE, 'two different answers counted as agreement');
  castVote(seats, seats[1], 4);
  assert.equal(unanimous(seats), 4);
});

test('spectators do not vote, and do not block one either', () => {
  const seats = table(0, -1);
  assert.match(castVote(seats, seats[1], 2), /spectators/);
  castVote(seats, seats[0], 2);
  assert.equal(unanimous(seats), 2, 'a watcher held up the players');
  assert.equal(playerSeats(seats).length, 1);
});

test('a speed off the ladder is refused before it is ever counted', () => {
  const seats = table(0);
  assert.match(castVote(seats, seats[0], 7), /no such speed/);
  assert.equal(seats[0].vote, NO_VOTE);
});

test('the tally says how the table stands, which is what a HUD shows', () => {
  const seats = table(0, 1, -1);
  castVote(seats, seats[0], 4);
  const standing = tally(seats, 4);
  assert.equal(standing.agreed, 1);
  assert.equal(standing.players, 2, 'the spectator was counted as a voter');
  assert.equal(openProposal(seats), 4);
});

test('clearing the slate leaves no proposal open', () => {
  const seats = table(0, 1);
  castVote(seats, seats[0], 16);
  castVote(seats, seats[1], 16);
  assert.equal(unanimous(seats), 16);
  clearVotes(seats);
  assert.equal(unanimous(seats), NO_VOTE);
  assert.equal(openProposal(seats), NO_VOTE);
});

test('pausing is a speed like any other, and takes the same agreement', () => {
  const seats = table(0, 1);
  castVote(seats, seats[0], 0);
  assert.equal(unanimous(seats), NO_VOTE);
  castVote(seats, seats[1], 0);
  assert.equal(unanimous(seats), 0, 'a table cannot agree to stop the clock');
});
