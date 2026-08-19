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
  const islandPermil = params.victoryIslandPermil;
  // Never zero. Two thirds of a one-island map rounds down to nothing, and a
  // threshold of nothing is met before the war starts - a tiny test map used to
  // declare a winner on tick zero, holding no islands at all.
  let needed = mulDiv(state.islands.length, islandPermil, 1000);
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
    if (islandsHeldBy(state, team) < needed) continue;
    endWar(state, team, WIN_ISLANDS);
    return;
  }

  // Time cap last: the clock only decides a war nothing else has.
  if (params.timeCapTicks > 0 && state.tick >= params.timeCapTicks) {
    const ahead = leader(state);
    endWar(state, ahead, ahead === -1 ? WIN_DRAW : WIN_TIME);
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
  endWar,
  islandsHeldBy,
  afloatCarriers,
  checkVictory,
};
