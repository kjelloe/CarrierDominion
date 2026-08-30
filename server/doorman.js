// server/doorman.js - who may come through the door, and who may not yet.
//
// Two rules, both owner rulings of 2026-08-31, both about a game that is about
// to sit on a public hostname where nothing had ever gated a seat:
//
//   1. A war IN PROGRESS needs the room's join code. An open lobby is fine -
//      strangers wandering into a room that has not sailed is how a drop-in
//      game works - but once the table is playing, a newcomer needs the code
//      the host gave their friends. A returning commander's TOKEN still wins
//      on its own: ruling of 2026-08-27 says they get their ship back, and
//      making them re-type a code to reclaim a seat they already hold would
//      undo it.
//
//   2. The host can kick, and a kicked player cannot come straight back.
//      Sixty seconds, because the point is to end an interaction, not to
//      administer a ban list: long enough that returning is a decision,
//      short enough that a mistake costs nobody their evening.
//
// This module is PURE and knows nothing about sockets - it takes a clock and
// answers questions - so the policy can be tested without a network. Server
// timing constants live here as module constants rather than in data/, the
// same as GRACE_MS in reconnect.js: data/ is the SIMULATION's numbers, and
// nothing here may touch the war.

// How long a kicked address stays out. Not a punishment - a cooling-off.
const BAN_MS = 60000;

function createDoorman(nowFn) {
  return {
    nowFn: nowFn,
    // [{ address, untilMs }]. A list, not a Map: it is never more than a
    // handful of entries and this file stays in the plain-objects style the
    // rest of the codebase uses.
    bans: [],
  };
}

// Forget everybody whose minute is up. Called by both readers, so an expired
// ban can never be observed - there is no separate sweep to remember to run.
function sweepBans(doorman) {
  const now = doorman.nowFn();
  const kept = [];
  for (const entry of doorman.bans) {
    if (entry.untilMs > now) kept.push(entry);
  }
  doorman.bans = kept;
}

// An address with no name is not banned and cannot be: refusing every
// anonymous socket would refuse the whole LAN the moment one person is kicked.
function banAddress(doorman, address, ms) {
  if (address === undefined || address === null || address === '') return 0;
  sweepBans(doorman);
  const untilMs = doorman.nowFn() + (ms === undefined ? BAN_MS : ms);
  for (const entry of doorman.bans) {
    // Kicked twice inside a minute: the later kick sets the clock, so the
    // second one is not shortened by the first.
    if (entry.address === address) {
      if (untilMs > entry.untilMs) entry.untilMs = untilMs;
      return 1;
    }
  }
  doorman.bans.push({ address: address, untilMs: untilMs });
  return 1;
}

// Seconds left, or 0. Returns the REMAINDER rather than a boolean so the
// refusal can say how long - "come back in 43 seconds" is an answer, "no" is
// a mystery, and a player who is told nothing reconnects in a loop.
function bannedFor(doorman, address) {
  if (address === undefined || address === null || address === '') return 0;
  sweepBans(doorman);
  for (const entry of doorman.bans) {
    if (entry.address === address) {
      return Math.max(1, Math.ceil((entry.untilMs - doorman.nowFn()) / 1000));
    }
  }
  return 0;
}

// May this socket in? '' to admit, otherwise the reason to send back.
//
// `hasToken` is the escape hatch that keeps the 2026-08-27 ruling true: a
// commander coming back to their own seat presents a token, and a token is a
// stronger claim than a code because it names one seat and was issued by this
// server. The code is for people who have never been here.
function admit(doorman, options) {
  const wait = bannedFor(doorman, options.address);
  if (wait > 0) {
    return `you were removed from this table - try again in ${wait}s`;
  }
  if (options.hasToken === 1) return '';
  // No room at all (LOBBY=0) means no code was ever issued, so there is
  // nothing to demand and nothing to check. Say so plainly rather than
  // inventing a lock with no key.
  if (options.roomCode === '' || options.roomCode === undefined) return '';
  if (options.started !== 1) return '';
  if (options.code === options.roomCode) return '';
  return 'this war has already started - it needs the room\'s join code';
}

export { BAN_MS, createDoorman, banAddress, bannedFor, admit, sweepBans };
