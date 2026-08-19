// engine/victory.js - how a war ends.
//
// Two routes, both from the original: hold most of the archipelago, or sink the
// other carrier. The second is unreachable until weapons exist, but it is
// wired now so the end-of-war path is exercised by tests from the start rather
// than bolted on the day combat lands.

import { mulDiv } from '../shared/fixed.js';
import { EVT_WAR_OVER, pushEvent } from './events.js';

const PHASE_RUNNING = 0;
const PHASE_OVER = 1;

const WIN_NONE = 0;
const WIN_ISLANDS = 1;
const WIN_CARRIER_SUNK = 2;

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

function checkVictory(state, islandPermil) {
  if (state.phase !== PHASE_RUNNING) return;
  const needed = mulDiv(state.islands.length, islandPermil, 1000);

  // Last carrier afloat wins outright, before any counting of islands.
  let alive = -1;
  let aliveCount = 0;
  for (let i = 0; i < state.teams.length; i++) {
    if (afloatCarriers(state, state.teams[i].id) > 0) {
      alive = state.teams[i].id;
      aliveCount = aliveCount + 1;
    }
  }
  if (aliveCount === 1 && state.teams.length > 1) {
    state.phase = PHASE_OVER;
    state.winner = alive;
    state.winReason = WIN_CARRIER_SUNK;
    pushEvent(state.events, EVT_WAR_OVER, alive, WIN_CARRIER_SUNK, 0);
    return;
  }

  for (let i = 0; i < state.teams.length; i++) {
    const team = state.teams[i].id;
    if (islandsHeldBy(state, team) < needed) continue;
    state.phase = PHASE_OVER;
    state.winner = team;
    state.winReason = WIN_ISLANDS;
    pushEvent(state.events, EVT_WAR_OVER, team, WIN_ISLANDS, 0);
    return;
  }
}

export {
  PHASE_RUNNING,
  PHASE_OVER,
  WIN_NONE,
  WIN_ISLANDS,
  WIN_CARRIER_SUNK,
  islandsHeldBy,
  afloatCarriers,
  checkVictory,
};
