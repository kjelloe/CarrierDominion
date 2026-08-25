// engine/network.js - the resource network as a LINK GRAPH (proposal 3b,
// ruled 2026-08-25).
//
// The original's network was geography: islands linked where the ground
// allowed, an island cut off from the chain stockpiled locally and stopped
// building, and holding the links mattered as much as holding the islands.
// Ours had been a distance-free star to the depot - simple, and two of the
// original's textures poorer.
//
// The graph: two islands of the SAME owner are linked when their centres lie
// within `networkLinkUnits` of each other. Goods flow hop by hop toward the
// team's depot; `island.networkHops` is the number of hops to it (-1 when
// there is no path), which is all the rest of the engine needs:
//
//   -1  cut off - it keeps what it makes, and its Command Centre stops
//       building (the original's rule exactly)
//    0  the depot itself
//   >0  connected, and the number is how far the goods have to travel
//
// Islands do not move, so the graph can only change when OWNERSHIP or a
// DEPOT changes: capture, conversion, a command centre blown out, a new
// stockpile nomination. Those places raise state.netDirty and the reducer
// recomputes once, before anything reads it. No timer, no per-tick cost,
// and nothing to go stale.

import { dist2D } from '../shared/fixed.js';

function islandById(state, id) {
  for (let i = 0; i < state.islands.length; i++) {
    if (state.islands[i].id === id) return state.islands[i];
  }
  return -1;
}

function linked(state, a, b) {
  return dist2D(a.x, a.y, b.x, b.y) <= state.params.networkLink;
}

// Hops from each island to its own team's depot, or -1. Islands nobody owns
// are always -1: an unclaimed rock is not part of anybody's chain.
function computeNetwork(state) {
  if (state.params.networkLink <= 0) {
    // Topology off: the star. onNetwork answers from ownership alone, and
    // the hops field is left at its resting -1 so nothing reads meaning
    // into a number that has none.
    return;
  }
  for (let i = 0; i < state.islands.length; i++) state.islands[i].networkHops = -1;

  for (let t = 0; t < state.teams.length; t++) {
    const team = state.teams[t];
    if (team.stockpileIsland < 0) continue;
    const depot = islandById(state, team.stockpileIsland);
    if (depot === -1 || depot.owner !== team.id) continue;
    depot.networkHops = 0;

    // Breadth-first, in island-id order at every level, so the walk is the
    // same on every machine.
    let frontier = [depot];
    let hops = 0;
    while (frontier.length > 0) {
      hops = hops + 1;
      const next = [];
      for (let f = 0; f < frontier.length; f++) {
        const here = frontier[f];
        for (let i = 0; i < state.islands.length; i++) {
          const island = state.islands[i];
          if (island.owner !== team.id || island.networkHops !== -1) continue;
          if (!linked(state, here, island)) continue;
          island.networkHops = hops;
          next.push(island);
        }
      }
      frontier = next;
    }
  }
}

// Connected to its own depot: the test the economy and the yards use.
// With topology switched OFF this asks only whether somebody owns the rock -
// it must not consult networkHops, which would then be bookkeeping nobody
// maintains (a test that hands an island an owner would find it "cut off").
function onNetwork(state, island) {
  if (state.params.networkLink <= 0) return island.owner !== -1;
  return island.networkHops >= 0;
}

// Raised wherever ownership or a depot changes; the reducer clears it.
function markNetworkDirty(state) {
  state.netDirty = 1;
}

export { computeNetwork, onNetwork, markNetworkDirty };
