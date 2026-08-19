// engine/capture.js - taking an island with an ACCB pod.
//
// The GDD's "hold the node for sixty seconds" is replaced by the original's
// pod (ruling Q9): a Walrus carries an Amphibious Command Centre Builder to
// the island's command node, deploys it, and the pod builds itself over a
// fixed number of ticks. The Walrus is then free to leave - what is at risk is
// the pod, not the vehicle.
//
// A pod being built can be interrupted by an enemy Walrus deploying its own,
// which resets the clock to the newcomer. Combat will give the other, louder
// way to stop one; this is the peaceful race.

import { dist2D } from '../shared/fixed.js';
import { EVT_ISLAND_CAPTURED, EVT_POD_DEPLOYED, EVT_POD_LOST, pushEvent } from './events.js';
import { KIND_WALRUS, UNIT_ACTIVE } from './units.js';
import { clearWorks } from './island.js';

// Returns '' when this unit may deploy on this island, otherwise the reason.
function checkDeploy(unit, island, podRangeUnits) {
  if (unit.kind !== KIND_WALRUS) return 'only a Walrus carries a pod';
  if (unit.state !== UNIT_ACTIVE) return 'the vehicle is not ashore';
  if (unit.pod !== 1) return 'no pod aboard';
  if (island.owner === unit.team) return 'the island is already yours';
  if (dist2D(unit.x, unit.y, island.nodeX, island.nodeY) > podRangeUnits) {
    return 'too far from the command node';
  }
  return '';
}

function nearestIsland(state, x, y) {
  let best = -1;
  let bestDistance = 2147483647;
  for (let i = 0; i < state.islands.length; i++) {
    const island = state.islands[i];
    const distance = dist2D(x, y, island.nodeX, island.nodeY);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = island;
    }
  }
  return best;
}

function deployPod(state, unit, island) {
  // Displacing a rival's half-built pod is a capture in itself: the clock
  // restarts for the newcomer rather than continuing where the enemy left off.
  if (island.podTeam !== -1 && island.podTeam !== unit.team) {
    pushEvent(state.events, EVT_POD_LOST, island.id, island.podTeam, 0);
  }
  island.podTeam = unit.team;
  island.podTicks = 0;
  unit.pod = 0;
  pushEvent(state.events, EVT_POD_DEPLOYED, island.id, unit.team, unit.id);
}

// One tick of every pod that is building.
function stepCapture(state, podBuildTicks) {
  for (let i = 0; i < state.islands.length; i++) {
    const island = state.islands[i];
    if (island.podTeam === -1) continue;
    island.podTicks = island.podTicks + 1;
    if (island.podTicks < podBuildTicks) continue;
    island.owner = island.podTeam;
    island.podTeam = -1;
    island.podTicks = 0;
    // A new command centre means a new plan. The command centre itself is what
    // you took the island FOR, but the previous owner's works are theirs: the
    // new owner starts from bare ground and decides what it is for.
    clearWorks(state, island);
    pushEvent(state.events, EVT_ISLAND_CAPTURED, island.id, island.owner, 0);
  }
}

export { checkDeploy, deployPod, nearestIsland, stepCapture };
