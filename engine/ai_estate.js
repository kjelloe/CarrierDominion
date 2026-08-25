// engine/ai_estate.js - the AI's civil engineering.
//
// An island the AI takes and never develops produces nothing, so without this
// module the enemy carrier runs out of fuel three hours into a war and drifts.
// The plan is deliberately plain, because a plain plan executed is worth more
// than a clever one that stalls:
//
//   1. ground that is resource-rich becomes a Resource island
//   2. once there is something to refine, the next island becomes the Factory
//   3. a natural fortress becomes a Defence island
//   4. anything else mines, because materials are the bottleneck for all of it
//
// Then it builds, one site at a time, whatever the island's role allows and its
// own stock can pay for.

import { floorDiv } from '../shared/fixed.js';
import { EVT_STOCKPILE_SET, pushEvent } from './events.js';
import { markNetworkDirty } from './network.js';
import {
  BUILD_FACTORY,
  BUILD_RUNWAY,
  BUILD_TURRET,
  BUILD_UPGRADE_PD,
  BUILD_UPGRADE_COMM,
  BUILD_UPGRADE_RADAR,
  BUILD_UPGRADE_SPEED,
  BUILD_WAREHOUSE,
  carrierOfTeam,
  upgradeOwned,
  ROLE_DEFENCE,
  ROLE_FACTORY,
  ROLE_RESOURCE,
  builtCount,
  setRole,
  startBuild,
} from './island.js';
import { KIND_FORTRESS, KIND_RESOURCE } from './worldgen.js';

// How many islands this team holds in a role. `exceptId` leaves one out,
// which is what planFor needs: the question is what THIS island should be
// given the REST of the estate, and counting the island in its own answer
// makes the answer oscillate (see planFor).
function countRole(state, team, role, exceptId) {
  let count = 0;
  for (let i = 0; i < state.islands.length; i++) {
    const island = state.islands[i];
    if (island.id === exceptId) continue;
    if (island.owner === team && island.role === role) count = count + 1;
  }
  return count;
}

// The plant comes second, whatever the ground. Terrain-first was the earlier
// rule and it starved a side whose islands happened to all be resource-rich:
// every one of them became a mine, no factory was ever planned, and the carrier
// ran on the trickle of crude a mine produces. A factory on poor ground beats
// no factory at all.
// What this island should be, given the REST of the estate - and the rest
// is the whole point. Counting the island in its own answer made a single
// island flip role every three ticks for a whole war: RESOURCE, so the plan
// wants a FACTORY; now FACTORY, so the plan wants a RESOURCE. Nothing was
// ever built on it, no team ever raised a plant, and both fleets ran their
// bunkers dry by tick 300,000 with full holds of ore.
function planFor(state, team, island) {
  const skip = island.id;
  const mines = countRole(state, team, ROLE_RESOURCE, skip);
  const plants = countRole(state, team, ROLE_FACTORY, skip);
  const guns = countRole(state, team, ROLE_DEFENCE, skip);
  if (mines > 0 && plants < 1) return ROLE_FACTORY;
  // NOTHING before the first mine. A plant with nothing to refine produces
  // nothing, and the home island (ruled 2026-08-25) hands every team a
  // plant at tick one - which used to make the fortress rule below fire on
  // a team's SECOND island, leaving it a factory and a fort and no mine at
  // all. Measured on seed 900913: no materials, so no repair, so a carrier
  // pinned at three tenths of its hull withdrew for the rest of the war and
  // the war never ended.
  if (mines < 1) return ROLE_RESOURCE;
  if (island.kind === KIND_FORTRESS && plants > 0) return ROLE_DEFENCE;
  // Mine, plant, guns: the third island is the defended one. At "second mine
  // first" the AI never raised a gun at all in a whole war - it kept finding a
  // better use for every island it took, and there is always a better use.
  if (mines >= 1 && plants > 0 && guns < 1) return ROLE_DEFENCE;
  if (island.kind === KIND_RESOURCE) return ROLE_RESOURCE;
  return ROLE_RESOURCE;
}

// A plant is only worth what it can be fed. Two factories are within reach of a
// single mine; the third is only worth building when materials are actually
// piling up, or the AI builds a plant it then starves - which is exactly what
// the first version did, and both sides drifted to a stop with full warehouses
// of nothing.
const FED_PERMIL = 400;

function materialsPermil(state, team) {
  let have = 0;
  let cap = 0;
  for (let i = 0; i < state.islands.length; i++) {
    const island = state.islands[i];
    if (island.owner !== team) continue;
    have = have + island.stockMaterials;
    cap = cap + state.economy.stockCap;
  }
  if (cap <= 0) return 0;
  return floorDiv(have * 1000, cap);
}

// What to put up next on an island that already has a purpose. Factories first
// on a factory island - the plant is the point - then storage; a defence island
// simply keeps adding guns.
function nextBuild(state, island, economy) {
  if (island.role === ROLE_FACTORY) {
    const built = builtCount(island, BUILD_FACTORY);
    const room = built < economy.builds[BUILD_FACTORY].max;
    const fed = built < 2 || materialsPermil(state, island.owner) > FED_PERMIL;
    if (room && fed) return BUILD_FACTORY;
    const refit = nextRefit(state, island, economy);
    if (refit !== -1) return refit;
    return BUILD_WAREHOUSE;
  }
  if (island.role === ROLE_DEFENCE) return BUILD_TURRET;
  if (island.role === ROLE_RESOURCE) {
    // A strip on a fed mine is what lets the air group live with the
    // telemetry leash: land, drink the island's fuel, fly on (ruled
    // 2026-08-25). Warehouses first while the island is still poor - a
    // runway on a mine with nothing in it is a runway with no fuel.
    if (island.runway !== 1 && builtCount(island, BUILD_WAREHOUSE) > 0
      && island.stockMaterials >= economy.builds[BUILD_RUNWAY].cost * 2) {
      return BUILD_RUNWAY;
    }
    return BUILD_WAREHOUSE;
  }
  return -1;
}

// The AI buys the same refits the human does (ruling 2026-08-23, third
// review - before this, solo play handed the human a permanent speed,
// point-defence and radar edge). Speed first: it is the one that changes
// where the SHIP can be, which is the AI's whole game. Only with the plant
// standing and twice the price on the ground - a refit that starves the
// chassis line is a refit that loses the war politely.
function nextRefit(state, island, economy) {
  if (island.factories < 1) return -1;
  const carrier = carrierOfTeam(state, island.owner);
  if (carrier === -1 || carrier.hull <= 0) return -1;
  for (const what of [BUILD_UPGRADE_SPEED, BUILD_UPGRADE_PD, BUILD_UPGRADE_RADAR, BUILD_UPGRADE_COMM]) {
    if (upgradeOwned(carrier, what) === 1) continue;
    let underway = 0;
    for (let i = 0; i < state.islands.length; i++) {
      if (state.islands[i].owner === island.owner
        && state.islands[i].building === what) underway = 1;
    }
    if (underway === 1) continue;
    if (island.stockMaterials < economy.builds[what].cost * 2) return -1;
    return what;
  }
  return -1;
}

// The stockpile belongs at the FACTORY. The network ships every island's stock
// toward the depot; a factory refines only what is piled on its own ground. So
// depot-at-the-mine starves the plant on an 8-materials-a-beat trickle while
// sixty a beat sit under the digger - measured: both AI carriers drifted to
// zero fuel at tick ~350,000 with their materials at capacity. Depot at the
// plant, and the mine's output flows INTO the refinery on its own.
function siteStockpile(state, brain) {
  for (let t = 0; t < state.teams.length; t++) {
    const team = state.teams[t];
    if (team.id !== brain.team) continue;
    let held = -1;
    for (let i = 0; i < state.islands.length; i++) {
      const island = state.islands[i];
      if (island.owner !== team.id) continue;
      if (island.id === team.stockpileIsland && island.role === ROLE_FACTORY) return;
      if (held === -1 && island.role === ROLE_FACTORY) held = island.id;
    }
    if (held === -1) return;
    markNetworkDirty(state);
    team.stockpileIsland = held;
    pushEvent(state.events, EVT_STOCKPILE_SET, held, team.id, 0);
  }
}

// One estate decision for one team, on the AI cadence. It does at most one
// thing per island per turn: this runs alongside a war, not instead of it.
function manageIslands(state, brain) {
  siteStockpile(state, brain);
  for (let i = 0; i < state.islands.length; i++) {
    const island = state.islands[i];
    if (island.owner !== brain.team) continue;
    // A role is settled once ground is broken. Before that the plan may
    // still change its mind - and since pods are TYPED (ruled 2026-08-25)
    // an island arrives already roled, so "has no role" stopped being the
    // question. Asking only that froze the machine's estate: every captured
    // island came up a Resource island, no team ever built a factory, and
    // seed 20260818 ran its ship dry at tick 100,000 with a full hold and
    // an empty bunker.
    const want = planFor(state, brain.team, island);
    if (island.role !== want) {
      // setRole refuses once anything is built, which is the guard that
      // keeps this from churning a working island.
      setRole(state, island, want);
    }
    // And then BUILD, in the same turn. Re-roling used to skip the build,
    // which is a trap: planFor reads the team's own role counts, so every
    // re-role changes the answer for the next island, and a fleet of bare
    // islands can swap roles at each other for ever without a spade going
    // in the ground. The first thing built settles the role for good.
    if (island.building !== -1) continue;
    const what = nextBuild(state, island, state.economy);
    if (what === -1) continue;
    startBuild(state, island, what, state.economy);
  }
}

export { countRole, planFor, nextBuild, siteStockpile, manageIslands };
