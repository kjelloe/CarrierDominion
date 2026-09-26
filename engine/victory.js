// engine/victory.js - how a war ends.
//
// Four routes now. Two are always live and come from the original: hold most of
// the archipelago, or sink the other carrier. Two are optional end conditions
// the host may switch on (ruling 2026-08-20): a POINT CAP, first to the score,
// and a TIME CAP, highest score when the clock runs out. Both are off when
// their rule is 0, which is the default, so a plain war is unchanged.
//
// Order matters and is part of the contract: annihilation first (there is
// nobody left to win), then the last carrier afloat, then points, then islands,
// then the clock. A war that satisfies two conditions on the same tick ends by
// the more decisive one.

import { mulDiv } from '../shared/fixed.js';
import { EVT_WAR_OVER, pushEvent } from './events.js';
import { leader } from './score.js';

const PHASE_RUNNING = 0;
const PHASE_OVER = 1;

const WIN_NONE = 0;
const WIN_ISLANDS = 1;
const WIN_CARRIER_SUNK = 2;
// Both carriers on the bottom. Two air groups can and do finish each other on
// the same tick, and without this the war simply never ends - which is exactly
// what the first AI-vs-AI run after weapons landed did for 900,000 ticks.
const WIN_DRAW = 3;
const WIN_POINTS = 4;
const WIN_TIME = 5;
// Nobody won; the war stopped moving and was called (ruling 39.1b, 2026-09-06).
// Distinct from WIN_TIME because "the clock ran out on a live war" and "nothing
// has happened for hours" are different things to tell a player.
const WIN_STALLED = 6;

// How many islands anybody holds at all. The island victory used to be a
// fraction of EVERY island including the neutral ones, which is why it never
// fired on a real map: 440 measured wars produced ZERO island wins at 16, 32
// and 64 islands, because two thirds of 64 is 43 and the widest split anyone
// ever reached was 11 to 10 (ruling 39.2a, 2026-09-06).
function islandsClaimed(state) {
  let claimed = 0;
  for (let i = 0; i < state.islands.length; i++) {
    if (state.islands[i].owner !== -1) claimed = claimed + 1;
  }
  return claimed;
}

function islandsHeldBy(state, team) {
  let held = 0;
  for (let i = 0; i < state.islands.length; i++) {
    if (state.islands[i].owner === team) held = held + 1;
  }
  return held;
}

function afloatCarriers(state, team) {
  let afloat = 0;
  for (let i = 0; i < state.carriers.length; i++) {
    if (state.carriers[i].team === team && state.carriers[i].hull > 0) afloat = afloat + 1;
  }
  return afloat;
}

function endWar(state, winner, reason) {
  state.phase = PHASE_OVER;
  state.winner = winner;
  state.winReason = reason;
  pushEvent(state.events, EVT_WAR_OVER, winner, reason, 0);
}

function checkVictory(state, params) {
  if (state.phase !== PHASE_RUNNING) return;
  // Three tests, and a team must pass ALL of them (ruling 39.2a):
  //
  //   1. two thirds of the islands anybody has CLAIMED - measuring against the
  //      whole archipelago is why this never fired on a real map;
  //   2. at least `victoryMinIslands` outright, so a war cannot be won on tick
  //      five by holding one island while the enemy holds none; and
  //   3. TWICE what the next-best team holds.
  //
  // (3) is what makes it a conquest rather than a land grab. Without it the
  // first pass of this rule ended seed 1299716 at tick 72,050 with the winner
  // on two islands of eight and five still neutral - technically two thirds of
  // what was claimed, and plainly not a victory. With it, 10 to 5 on a
  // 32-island map wins and 11 to 10 on a 64-island one does not, which is the
  // difference between a decisive war and a stalemate that the clock should
  // settle instead.
  const claimed = islandsClaimed(state);
  let needed = mulDiv(claimed, params.victoryIslandPermil, 1000);
  if (needed < params.victoryMinIslands) needed = params.victoryMinIslands;
  // Never zero. Two thirds of a one-island map rounds down to nothing, and a
  // threshold of nothing is met before the war starts - a tiny test map used to
  // declare a winner on tick zero, holding no islands at all.
  if (needed < 1) needed = 1;

  // Last carrier afloat wins outright, before any counting of islands.
  let alive = -1;
  let aliveCount = 0;
  for (let i = 0; i < state.teams.length; i++) {
    if (afloatCarriers(state, state.teams[i].id) > 0) {
      alive = state.teams[i].id;
      aliveCount = aliveCount + 1;
    }
  }
  if (aliveCount === 0 && state.teams.length > 0) {
    endWar(state, -1, WIN_DRAW);
    return;
  }
  if (aliveCount === 1 && state.teams.length > 1) {
    endWar(state, alive, WIN_CARRIER_SUNK);
    return;
  }

  // Point cap: first past the post. A tie on the same tick is a draw, because
  // there is no honest way to break it.
  if (params.pointCap > 0) {
    let reached = -1;
    let tied = false;
    for (let i = 0; i < state.teams.length; i++) {
      if (state.teams[i].score < params.pointCap) continue;
      if (reached === -1) reached = state.teams[i].id;
      else tied = true;
    }
    if (reached !== -1) {
      endWar(state, tied ? -1 : reached, tied ? WIN_DRAW : WIN_POINTS);
      return;
    }
  }

  for (let i = 0; i < state.teams.length; i++) {
    const team = state.teams[i].id;
    const held = islandsHeldBy(state, team);
    if (held < needed) continue;
    // The margin. Everyone else's best, doubled.
    let runnerUp = 0;
    for (let j = 0; j < state.teams.length; j++) {
      if (state.teams[j].id === team) continue;
      const theirs = islandsHeldBy(state, state.teams[j].id);
      if (theirs > runnerUp) runnerUp = theirs;
    }
    if (held < runnerUp * 2) continue;
    endWar(state, team, WIN_ISLANDS);
    return;
  }

  // Time cap: the clock only decides a war nothing else has.
  if (params.timeCapTicks > 0 && state.tick >= params.timeCapTicks) {
    const ahead = leader(state);
    endWar(state, ahead, ahead === -1 ? WIN_DRAW : WIN_TIME);
    return;
  }

  // And LAST, the stop-loss (ruling 39.1b). A war where nothing has moved for
  // hours is not a war anybody is still playing: 18 of 300 measured wars at
  // the default settings sat with both carriers out of fuel, hulls untouched,
  // for up to 519,804 ticks. The fuel lifeline should make that rare; this
  // makes it FINITE either way, because "the game never ends" is the one
  // outcome a player cannot do anything about.
  //
  // Counted from the last thing that moved the war, not from the start, and
  // the threshold sits well above the worst quiet stretch a healthy war has
  // ever shown (243,022 ticks across 282 resolved wars).
  if (params.stallCapTicks > 0 && state.tick - state.lastProgressTick >= params.stallCapTicks) {
    // The REASON is always the stall, even when nobody is ahead. A war called
    // because nothing had happened for hours is not the same thing as two
    // carriers going down together, and WIN_DRAW already means that - the
    // winner may be -1, and the ending screen says which it was.
    endWar(state, leader(state), WIN_STALLED);
  }
}

export {
  PHASE_RUNNING,
  PHASE_OVER,
  WIN_NONE,
  WIN_ISLANDS,
  WIN_CARRIER_SUNK,
  WIN_DRAW,
  WIN_POINTS,
  WIN_TIME,
  WIN_STALLED,
  endWar,
  islandsHeldBy,
  afloatCarriers,
  checkVictory,
};
