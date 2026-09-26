// engine/lifeline.js - a carrier that has run dry can always get home.
//
// Owner ruling 39.1a (2026-09-06), from the first full battery matrix: 18 of
// 300 wars at the DEFAULT settings ended nowhere with both carriers at zero
// fuel, hulls untouched, six of eight islands still neutral, and nothing moving
// again for up to 519,804 ticks. The supply boat is "the only way fuel reaches
// a hull" (engine/supply.js), and a fleet with too little territory never got
// one out - so running dry was permanent, and a war with a stranded carrier
// could not end.
//
// The ruling keeps fuel biting (the Q6 ruling of 2026-08-27) and removes the
// dead end: a team that still owns an island with fuel in it gets a trickle.
//
// Three things make this a lifeline and not a second supply chain:
//
//   - It is DEBITED from an island's own store. Ruling #3 - nothing is
//     conjured, and a comment claiming "from the team's reserves" is not a
//     deduction. No island with fuel, no lifeline.
//   - It stops at a FLOOR, not at a full bunker. Enough to weigh anchor and
//     reach a friendly shore; nowhere near enough to fight a war on.
//   - It is slow. `lifelineFuelPerTick` is a fraction of what the boat brings,
//     so calling for a proper supply run is always the better answer.

import { floorDiv } from '../shared/fixed.js';

// Where the fuel comes from: the island this team owns with the most in it.
// Deterministic - ties break on the lower island id, which is the order the
// list is walked in - because two machines must agree on which store paid.
function richestOwnedIsland(state, team) {
  let best = -1;
  let most = 0;
  for (let i = 0; i < state.islands.length; i++) {
    const island = state.islands[i];
    if (island.owner !== team) continue;
    if (island.stockFuel > most) {
      most = island.stockFuel;
      best = i;
    }
  }
  return best;
}

// One tick of the lifeline, for every carrier that needs it.
function stepLifeline(state) {
  const perTick = state.params.lifelineFuelPerTick;
  if (perTick <= 0) return;
  // Every Nth tick, not every tick: a trickle you can watch is a trickle, and
  // one fuel a tick would refill a bunker faster than the boat does.
  const every = state.params.lifelineEveryTicks;
  if (every > 1 && state.tick % every !== 0) return;
  // A floor measured against the hull's own bunker, so it scales with the ship
  // rather than with a number somebody has to remember to keep in step.
  for (let c = 0; c < state.carriers.length; c++) {
    const carrier = state.carriers[c];
    if (carrier.hull <= 0) continue;
    const floor = floorDiv(carrier.fuelCapacity * state.params.lifelineFloorPermil, 1000);
    if (carrier.fuel >= floor) continue;
    const at = richestOwnedIsland(state, carrier.team);
    if (at === -1) continue;
    const island = state.islands[at];
    // Never more than the island has, and never past the floor: the lifeline
    // exists to un-strand a ship, and topping it up further would quietly
    // replace the supply boat this game is partly about.
    let moved = perTick;
    if (moved > island.stockFuel) moved = island.stockFuel;
    if (moved > floor - carrier.fuel) moved = floor - carrier.fuel;
    if (moved <= 0) continue;
    island.stockFuel = island.stockFuel - moved;
    carrier.fuel = carrier.fuel + moved;
  }
}

export { stepLifeline, richestOwnedIsland };
