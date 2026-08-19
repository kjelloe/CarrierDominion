// server/vote.js - the speed vote.
//
// Time compression is a table decision, not a private one (owner ruling
// 2026-08-20): in a shared war the clock changes when EVERY player agrees, and
// not before. One player alone still runs the clock as they like - a vote of
// one is unanimous by definition, and no special case is needed to say so.
//
// Spectators do not vote. They are watching somebody else's war.
//
// Deliberately pure and socket-free: a seat here is any object with `team` and
// `vote`, so the whole rule can be tested without a network.

import { isSpeed } from '../shared/speeds.js';

const NO_VOTE = -1;

function isPlayer(seat) {
  return seat.team !== -1;
}

function playerSeats(seats) {
  const out = [];
  for (let i = 0; i < seats.length; i++) {
    if (isPlayer(seats[i])) out.push(seats[i]);
  }
  return out;
}

function clearVotes(seats) {
  for (let i = 0; i < seats.length; i++) seats[i].vote = NO_VOTE;
  return seats;
}

// Record one seat's wish. Returns '' when it was taken, or a reason.
function castVote(seats, seat, speed) {
  if (!isPlayer(seat)) return 'spectators do not vote on the clock';
  if (!isSpeed(speed)) return 'no such speed';
  seat.vote = speed;
  return '';
}

// How the table stands on a proposal: how many players want it, out of how many
// there are. This is what the HUD shows while a vote is open.
function tally(seats, speed) {
  const players = playerSeats(seats);
  let agreed = 0;
  for (let i = 0; i < players.length; i++) {
    if (players[i].vote === speed) agreed = agreed + 1;
  }
  return { agreed: agreed, players: players.length, speed: speed };
}

// The speed every player has voted for, or -1. A table with nobody at it
// carries nothing: an empty war has no opinion to act on.
function unanimous(seats) {
  const players = playerSeats(seats);
  if (players.length === 0) return NO_VOTE;
  const first = players[0].vote;
  if (first === NO_VOTE) return NO_VOTE;
  for (let i = 1; i < players.length; i++) {
    if (players[i].vote !== first) return NO_VOTE;
  }
  return first;
}

// The open proposal, for a seat that has just joined or a HUD that wants to
// show one: the first speed anybody has asked for, or -1 when nobody has.
function openProposal(seats) {
  const players = playerSeats(seats);
  for (let i = 0; i < players.length; i++) {
    if (players[i].vote !== NO_VOTE) return players[i].vote;
  }
  return NO_VOTE;
}

export { NO_VOTE, isPlayer, playerSeats, clearVotes, castVote, tally, unanimous, openProposal };
