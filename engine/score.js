// engine/score.js - points, and the two optional ways a war can end on them.
//
// Points exist so a war can be given a shape other than "fight until somebody
// holds two thirds of the map": a POINT CAP ends it when a side has earned
// enough, a TIME CAP ends it at a fixed tick with the highest score winning.
// Both are off by default (0), and a war with both off behaves exactly as it
// did before this module existed.
//
// What earns points:
//   holding islands   accrued every 100 ticks, so the reward is for holding
//                     ground over time rather than for touching it once
//   killing a unit    awarded to the shooter, not to whoever watched it crash
//   sinking a carrier the big one
//
// Losses out of fuel earn nobody anything. That is deliberate: an enemy that
// strands itself is not a kill, and rewarding it would make waiting a tactic.

import { floorDiv } from '../shared/fixed.js';
import { EVT_SCORED, pushEvent } from './events.js';

const SCORE_ISLANDS = 0;
const SCORE_KILL = 1;
const SCORE_CARRIER = 2;

function teamIndex(state, team) {
  for (let i = 0; i < state.teams.length; i++) {
    if (state.teams[i].id === team) return i;
  }
  return -1;
}

function addScore(state, team, points, reason) {
  if (points <= 0) return 0;
  const index = teamIndex(state, team);
  if (index === -1) return 0;
  state.teams[index].score = state.teams[index].score + points;
  pushEvent(state.events, EVT_SCORED, team, points, reason);
  return points;
}

function scoreOf(state, team) {
  const index = teamIndex(state, team);
  return index === -1 ? 0 : state.teams[index].score;
}

// The side with the most points, or -1 when it is a tie. Used by the time cap,
// where somebody has to be ahead for the war to have been won rather than
// merely stopped.
function leader(state) {
  let best = -1;
  let bestScore = -1;
  let tied = false;
  for (let i = 0; i < state.teams.length; i++) {
    const team = state.teams[i];
    if (team.score > bestScore) {
      bestScore = team.score;
      best = team.id;
      tied = false;
    } else if (team.score === bestScore) {
      tied = true;
    }
  }
  return tied ? -1 : best;
}

function islandsHeldBy(state, team) {
  let held = 0;
  for (let i = 0; i < state.islands.length; i++) {
    if (state.islands[i].owner === team) held = held + 1;
  }
  return held;
}

// Island income, on the same hundred-tick beat as the economy, so the two
// accrue together and neither needs a per-team accumulator in state.
function stepScore(state, perIslandPer100Ticks) {
  if (perIslandPer100Ticks <= 0) return;
  if (state.tick % 100 !== 0) return;
  for (let i = 0; i < state.teams.length; i++) {
    const team = state.teams[i];
    const held = islandsHeldBy(state, team.id);
    if (held <= 0) continue;
    addScore(state, team.id, held * perIslandPer100Ticks, SCORE_ISLANDS);
  }
}

// How far through a capped war we are, in per-mil, for the HUD. Returns -1 when
// no cap is set, which is the HUD's cue to say nothing at all.
function capProgressPermil(state, pointCap, timeCapTicks) {
  if (pointCap > 0) {
    let best = 0;
    for (let i = 0; i < state.teams.length; i++) {
      if (state.teams[i].score > best) best = state.teams[i].score;
    }
    return floorDiv(best * 1000, pointCap);
  }
  if (timeCapTicks > 0) return floorDiv(state.tick * 1000, timeCapTicks);
  return -1;
}

export {
  SCORE_ISLANDS,
  SCORE_KILL,
  SCORE_CARRIER,
  addScore,
  scoreOf,
  leader,
  islandsHeldBy,
  stepScore,
  capProgressPermil,
};
