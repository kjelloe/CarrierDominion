// server/reconnect.js - holding a seat for somebody who dropped.
//
// Adapted from multiciv's seat-grace (../multiciv/shared/lobby-reconnect.js and
// its server half). The shape is the same and so is the reason: a phone that
// locks its screen, a laptop that sleeps, a wifi hiccup - none of those should
// cost a player their carrier, and none of them should freeze the war for
// everybody else either.
//
// So a dropped seat is HELD, not freed:
//
//   within the grace window   the same player, presenting the token they were
//                             issued, gets their own seat back
//   after it                  the seat is released and the AI takes the war
//                             over, so the other side is fighting somebody
//
// The AI takeover is the part multiciv taught us to include. Without it a
// dropped player's carrier sits at anchor for the rest of the war, which is
// worse for their opponent than losing to a machine.
//
// Pure and socket-free: a held seat is a plain record and the clock is injected.

const GRACE_MS = 90000;

function createHolder(nowFn, tokenFn) {
  return {
    held: [],
    nowFn: nowFn,
    tokenFn: tokenFn,
    graceMs: GRACE_MS,
  };
}

// A seat somebody has just dropped out of. Returns the held record, or -1 for a
// seat not worth holding - a spectator has nothing to come back to.
function holdSeat(holder, seat) {
  if (seat.team === -1) return -1;
  const record = {
    team: seat.team,
    name: seat.name === undefined ? '' : seat.name,
    token: seat.token === undefined || seat.token === '' ? holder.tokenFn() : seat.token,
    untilMs: holder.nowFn() + holder.graceMs,
    aiTaken: 0,
  };
  holder.held.push(record);
  return record;
}

// The same player, back. Returns the held record so the seat can be restored
// with its name, or -1 when the token is unknown or has run out.
function reclaim(holder, token) {
  if (typeof token !== 'string' || token === '') return -1;
  const now = holder.nowFn();
  for (let i = 0; i < holder.held.length; i++) {
    const record = holder.held[i];
    if (record.token !== token) continue;
    holder.held.splice(i, 1);
    // An expired hold is still honoured if the seat has not been taken by
    // anybody since: the grace window exists to stop a race, not to punish
    // somebody whose train went into a tunnel.
    if (record.untilMs < now && record.aiTaken === 1) return -1;
    return record;
  }
  return -1;
}

// Is this seat spoken for? A live seat and a held one both block a newcomer
// from taking the team, or a reconnecting player would find a stranger in it.
function isHeld(holder, team) {
  for (let i = 0; i < holder.held.length; i++) {
    if (holder.held[i].team === team) return true;
  }
  return false;
}

// Holds whose window has run out and which have not yet been handed over.
// Returns them; the caller decides what "handed over" means, which here is
// giving the team to the AI.
function expired(holder) {
  const now = holder.nowFn();
  const out = [];
  for (let i = 0; i < holder.held.length; i++) {
    const record = holder.held[i];
    if (record.untilMs <= now && record.aiTaken === 0) out.push(record);
  }
  return out;
}

// Drop a hold entirely - the seat is nobody's now.
function release(holder, team) {
  const kept = [];
  for (let i = 0; i < holder.held.length; i++) {
    if (holder.held[i].team !== team) kept.push(holder.held[i]);
  }
  holder.held = kept;
  return holder;
}

export { GRACE_MS, createHolder, holdSeat, reclaim, isHeld, expired, release };
