// engine/island.js - what an island becomes after you take it.
//
// The ACCB pod builds the Command Centre; the Command Centre is the island's
// brain and the thing that makes it yours. What the island is FOR is then the
// owner's decision (ruling 2026-08-20), and it is one of three:
//
//   RESOURCE  mines raw materials into the network
//   FACTORY   up to three factories and their warehouses, turning materials
//             into fuel, munitions and replacement vehicle chassis
//   DEFENCE   laser and missile turrets, and no economic output at all
//
// The terrain still matters: an island the generator made resource-rich yields
// more as a Resource island than a bare rock does, and a natural fortress makes
// a better Defence island. So worldgen's `kind` is not overridden by the role -
// it is a bonus for choosing the role the ground suits.
//
// A role can only be set on an island with nothing built on it. Once you have
// poured concrete the decision is made, which is what stops the role being a
// free switch you flip whenever the front moves.

import { mulDiv } from '../shared/fixed.js';
import { EVT_ISLAND_ROLE, EVT_ISLAND_BUILT, pushEvent } from './events.js';
import { KIND_FACTORY, KIND_FORTRESS, KIND_RESOURCE } from './worldgen.js';

const ROLE_NONE = -1;
const ROLE_RESOURCE = 0;
const ROLE_FACTORY = 1;
const ROLE_DEFENCE = 2;

const BUILD_NONE = -1;
const BUILD_FACTORY = 0;
const BUILD_WAREHOUSE = 1;
const BUILD_TURRET = 2;

// Which building each role is allowed to put up. A factory island cannot raise
// turrets and a defence island cannot raise factories: that is the trade.
function roleAllows(role, what) {
  if (role === ROLE_FACTORY) return what === BUILD_FACTORY || what === BUILD_WAREHOUSE;
  if (role === ROLE_DEFENCE) return what === BUILD_TURRET;
  if (role === ROLE_RESOURCE) return what === BUILD_WAREHOUSE;
  return false;
}

function builtCount(island, what) {
  if (what === BUILD_FACTORY) return island.factories;
  if (what === BUILD_WAREHOUSE) return island.warehouses;
  if (what === BUILD_TURRET) return island.turrets;
  return 0;
}

function addBuilt(island, what) {
  if (what === BUILD_FACTORY) island.factories = island.factories + 1;
  else if (what === BUILD_WAREHOUSE) island.warehouses = island.warehouses + 1;
  else if (what === BUILD_TURRET) island.turrets = island.turrets + 1;
}

function anythingBuilt(island) {
  return island.factories + island.warehouses + island.turrets > 0
    || island.building !== BUILD_NONE;
}

// The terrain the generator laid down, as a multiplier on the role's output:
// a role that suits the ground pays better than one that does not.
function terrainPermil(island, economy) {
  if (island.role === ROLE_RESOURCE && island.kind === KIND_RESOURCE) return economy.terrainBonus;
  if (island.role === ROLE_FACTORY && island.kind === KIND_FACTORY) return economy.terrainBonus;
  if (island.role === ROLE_DEFENCE && island.kind === KIND_FORTRESS) return economy.terrainBonus;
  return 1000;
}

// Warehouses are what let an island hold more than the base cap, which is what
// makes a stockpile island worth developing rather than merely nominating.
function stockCapOf(island, economy) {
  return economy.stockCap + island.warehouses * economy.warehouseCap;
}

function setRole(state, island, role) {
  if (island.owner < 0) return 0;
  if (anythingBuilt(island)) return 0;
  if (role !== ROLE_RESOURCE && role !== ROLE_FACTORY && role !== ROLE_DEFENCE) return 0;
  island.role = role;
  pushEvent(state.events, EVT_ISLAND_ROLE, island.id, island.owner, role);
  return 1;
}

// What the team's cargo network can deliver to a site: the island's own
// materials first, then the depot it ships to.
//
// Paying from the island alone was the first version, and it deadlocked - the
// network moves a share of every island's stock TO the stockpile every accrual,
// so a factory island could never accumulate the price of its own factory. The
// network that empties the site is the same network that supplies it.
function payForBuild(state, island, cost) {
  const fromSite = island.stockMaterials < cost ? island.stockMaterials : cost;
  let left = cost - fromSite;
  let depot = -1;
  if (left > 0) {
    for (let t = 0; t < state.teams.length; t++) {
      const team = state.teams[t];
      if (team.id !== island.owner || team.stockpileIsland < 0) continue;
      for (let i = 0; i < state.islands.length; i++) {
        const candidate = state.islands[i];
        if (candidate.id !== team.stockpileIsland) continue;
        if (candidate.owner === island.owner) depot = candidate;
      }
    }
    if (depot === -1 || depot.stockMaterials < left) return 0;
  }
  island.stockMaterials = island.stockMaterials - fromSite;
  if (left > 0) depot.stockMaterials = depot.stockMaterials - left;
  return 1;
}

// Start something. It is paid for up front, and only one thing goes up at a
// time - a site, not a queue.
function startBuild(state, island, what, economy) {
  if (island.owner < 0 || island.building !== BUILD_NONE) return 0;
  if (!roleAllows(island.role, what)) return 0;
  const spec = economy.builds[what];
  if (spec === undefined) return 0;
  if (builtCount(island, what) >= spec.max) return 0;
  if (payForBuild(state, island, spec.cost) !== 1) return 0;
  island.building = what;
  island.buildTicks = spec.ticks;
  return 1;
}

// One tick of construction on every island that has something going up.
function stepBuild(state) {
  for (let i = 0; i < state.islands.length; i++) {
    const island = state.islands[i];
    if (island.building === BUILD_NONE) continue;
    // Lose the island and you lose the site: the work does not carry over to
    // whoever takes it next.
    if (island.owner < 0) {
      island.building = BUILD_NONE;
      island.buildTicks = 0;
      continue;
    }
    island.buildTicks = island.buildTicks - 1;
    if (island.buildTicks > 0) continue;
    addBuilt(island, island.building);
    pushEvent(state.events, EVT_ISLAND_BUILT, island.id, island.owner, island.building);
    island.building = BUILD_NONE;
    island.buildTicks = 0;
  }
}

// Everything an island loses when it changes hands. The command centre stays -
// that is the point of taking it rather than levelling it - but the work is
// the previous owner's, and the new owner starts from the ground.
function clearWorks(island) {
  island.role = ROLE_NONE;
  island.factories = 0;
  island.warehouses = 0;
  island.turrets = 0;
  island.building = BUILD_NONE;
  island.buildTicks = 0;
  return island;
}

export {
  ROLE_NONE,
  ROLE_RESOURCE,
  ROLE_FACTORY,
  ROLE_DEFENCE,
  BUILD_NONE,
  BUILD_FACTORY,
  BUILD_WAREHOUSE,
  BUILD_TURRET,
  roleAllows,
  builtCount,
  anythingBuilt,
  terrainPermil,
  stockCapOf,
  setRole,
  payForBuild,
  startBuild,
  stepBuild,
  clearWorks,
};
