// engine/virus.js - the virus bomb.
//
// The other way to take an island, and the 1988 original's cleverest idea. An
// ACCB pod builds a NEW command centre on ground you have cleared, and the
// island comes to you bare. A virus bomb subverts the command centre that is
// already there: the island changes sides with everything on it - its factories,
// its warehouses, and its guns, which were shooting at you a moment ago.
//
// That makes the two payloads answer different questions. The pod is how you
// take a rock. The bomb is how you take a WORKING island, and it is worth the
// longer wait and the deeper approach it demands.
//
//   pod    any island that is not yours     -> yours, bare
//   virus  an island somebody else HOLDS    -> yours, intact
//
// A conversion in progress is interrupted by anything that changes who holds
// the island, because a virus needs a command centre to subvert and the one it
// was working on is gone.

import { dist2D } from '../shared/fixed.js';
import { EVT_ISLAND_CONVERTED, EVT_VIRUS_DEPLOYED, pushEvent } from './events.js';
import { KIND_WALRUS, UNIT_ACTIVE } from './units.js';

// Returns '' when this unit may bomb this island, otherwise the reason.
function checkVirus(unit, island, rangeUnits) {
  if (unit.kind !== KIND_WALRUS) return 'only a Walrus carries a virus bomb';
  if (unit.state !== UNIT_ACTIVE) return 'the vehicle is not ashore';
  if (unit.virus !== 1) return 'no virus bomb aboard';
  if (island.owner < 0) return 'there is no command centre here to subvert';
  if (island.owner === unit.team) return 'the island is already yours';
  if (dist2D(unit.x, unit.y, island.nodeX, island.nodeY) > rangeUnits) {
    return 'too far from the command centre';
  }
  return '';
}

function deployVirus(state, unit, island) {
  island.virusTeam = unit.team;
  island.virusTicks = 0;
  unit.virus = 0;
  pushEvent(state.events, EVT_VIRUS_DEPLOYED, island.id, unit.team, unit.id);
  return island;
}

// Hand the island over intact, guns and all. This is the whole point of the
// weapon: the previous owner's investment becomes yours rather than rubble.
function convert(state, island) {
  const team = island.virusTeam;
  island.owner = team;
  island.virusTeam = -1;
  island.virusTicks = 0;
  // A pod being built here is somebody else's plan for an island that is now
  // spoken for.
  island.podTeam = -1;
  island.podTicks = 0;
  for (let i = 0; i < state.turrets.length; i++) {
    if (state.turrets[i].island === island.id) state.turrets[i].team = team;
  }
  pushEvent(state.events, EVT_ISLAND_CONVERTED, island.id, team, 0);
  return island;
}

// One tick of every virus that is working. Slower than a pod: subverting a
// command centre is harder than building one on empty ground, and the prize is
// bigger.
function stepVirus(state, virusTicks) {
  for (let i = 0; i < state.islands.length; i++) {
    const island = state.islands[i];
    if (island.virusTeam === -1) continue;
    // The island changed hands, or fell neutral, while the bomb was working.
    if (island.owner < 0 || island.owner === island.virusTeam) {
      island.virusTeam = -1;
      island.virusTicks = 0;
      continue;
    }
    island.virusTicks = island.virusTicks + 1;
    if (island.virusTicks < virusTicks) continue;
    convert(state, island);
  }
}

export { checkVirus, deployVirus, convert, stepVirus };
