// engine/economy.js - production and the cargo network.
//
// Ruling #3 replaced the placeholder "carrier near a friendly island refuels
// by magic" with the original's actual chain:
//
//   Resource island  ->  mines materials into its OWN stock
//   Factory island   ->  converts materials into fuel and ordnance
//   cargo network    ->  ships stock toward the team's stockpile island
//   supply boat      ->  ferries fuel from the stockpile to the carrier
//
// The first three live here; the boat lives in engine/supply.js. What matters
// about this shape is that goods have a LOCATION. Losing the island that was
// making your fuel costs you the fuel it had not shipped yet, and losing the
// stockpile strands everything upstream of it.
//
// Accrual happens in a lump every `incomeEvery` ticks rather than a fraction
// every tick: with integer goods the two are equivalent, and the lump needs no
// accumulators in state.

import { mulDiv } from '../shared/fixed.js';
import { EVT_STOCKPILE_SET, pushEvent } from './events.js';
import { KIND_FACTORY } from './worldgen.js';

function capped(value, cap) {
  return value > cap ? cap : value;
}

function teamById(state, teamId) {
  for (let i = 0; i < state.teams.length; i++) {
    if (state.teams[i].id === teamId) return state.teams[i];
  }
  return -1;
}

function islandById(state, islandId) {
  for (let i = 0; i < state.islands.length; i++) {
    if (state.islands[i].id === islandId) return state.islands[i];
  }
  return -1;
}

// Mines and quarries: raw output straight into the island's own stock.
function produce(state) {
  const cap = state.economy.stockCap;
  for (let i = 0; i < state.islands.length; i++) {
    const island = state.islands[i];
    if (island.owner < 0) continue;
    const row = state.economy.income[island.kind];
    if (row === undefined) continue;
    island.stockFuel = capped(island.stockFuel + row.fuel, cap);
    island.stockMaterials = capped(island.stockMaterials + row.materials, cap);
    island.stockOrdnance = capped(island.stockOrdnance + row.ordnance, cap);
  }
}

// Refineries: a factory turns materials into fuel and ordnance, and turns
// nothing into nothing. An enemy who takes your resource islands starves the
// factory without ever having to touch it.
function refine(state) {
  const cap = state.economy.stockCap;
  for (let i = 0; i < state.islands.length; i++) {
    const island = state.islands[i];
    if (island.owner < 0 || island.kind !== KIND_FACTORY) continue;
    if (island.stockMaterials < state.economy.factoryIn) continue;
    island.stockMaterials = island.stockMaterials - state.economy.factoryIn;
    island.stockFuel = capped(island.stockFuel + state.economy.factoryFuel, cap);
    island.stockOrdnance = capped(island.stockOrdnance + state.economy.factoryOrdnance, cap);
  }
}

// The cargo network, abstracted: each accrual, every owned island ships a
// share of what it holds toward the team's stockpile island. No drone
// entities - the interesting decision is WHICH island is the stockpile and
// whether the chain is intact, not the individual sorties.
function shipToStockpile(state) {
  const cap = state.economy.stockCap;
  for (let t = 0; t < state.teams.length; t++) {
    const team = state.teams[t];
    if (team.stockpileIsland < 0) continue;
    const depot = islandById(state, team.stockpileIsland);
    if (depot === -1 || depot.owner !== team.id) continue;
    for (let i = 0; i < state.islands.length; i++) {
      const island = state.islands[i];
      if (island.owner !== team.id || island.id === depot.id) continue;
      const fuel = mulDiv(island.stockFuel, state.economy.networkPermil, 1000);
      const materials = mulDiv(island.stockMaterials, state.economy.networkPermil, 1000);
      const ordnance = mulDiv(island.stockOrdnance, state.economy.networkPermil, 1000);
      island.stockFuel = island.stockFuel - fuel;
      island.stockMaterials = island.stockMaterials - materials;
      island.stockOrdnance = island.stockOrdnance - ordnance;
      depot.stockFuel = capped(depot.stockFuel + fuel, cap);
      depot.stockMaterials = capped(depot.stockMaterials + materials, cap);
      depot.stockOrdnance = capped(depot.stockOrdnance + ordnance, cap);
    }
  }
}

// A team with no stockpile has nowhere to ship to, so the first island it
// takes becomes one automatically. The player can move it later; the point is
// that the chain works before anyone has read a manual.
function claimDefaultStockpile(state) {
  for (let t = 0; t < state.teams.length; t++) {
    const team = state.teams[t];
    if (team.stockpileIsland >= 0) {
      const held = islandById(state, team.stockpileIsland);
      if (held !== -1 && held.owner === team.id) continue;
      team.stockpileIsland = -1; // lost it; look for another
    }
    for (let i = 0; i < state.islands.length; i++) {
      if (state.islands[i].owner !== team.id) continue;
      team.stockpileIsland = state.islands[i].id;
      pushEvent(state.events, EVT_STOCKPILE_SET, state.islands[i].id, team.id, 0);
      break;
    }
  }
}

function stepEconomy(state) {
  if (state.economy.incomeEvery < 1) return;
  if (state.tick % state.economy.incomeEvery !== 0) return;
  claimDefaultStockpile(state);
  produce(state);
  refine(state);
  shipToStockpile(state);
}

// What a team holds across everything it owns - the number the HUD shows.
function teamHoldings(state, teamId) {
  const total = { fuel: 0, materials: 0, ordnance: 0 };
  for (let i = 0; i < state.islands.length; i++) {
    const island = state.islands[i];
    if (island.owner !== teamId) continue;
    total.fuel = total.fuel + island.stockFuel;
    total.materials = total.materials + island.stockMaterials;
    total.ordnance = total.ordnance + island.stockOrdnance;
  }
  return total;
}

function copyEconomy(economy) {
  const income = [];
  for (let i = 0; i < economy.income.length; i++) {
    income.push({
      fuel: economy.income[i].fuel,
      materials: economy.income[i].materials,
      ordnance: economy.income[i].ordnance,
    });
  }
  return {
    incomeEvery: economy.incomeEvery,
    factoryIn: economy.factoryIn,
    factoryFuel: economy.factoryFuel,
    factoryOrdnance: economy.factoryOrdnance,
    networkPermil: economy.networkPermil,
    stockCap: economy.stockCap,
    repairPerMaterial: economy.repairPerMaterial,
    income: income,
  };
}

function createEconomy(econRules) {
  const income = [];
  for (let i = 0; i < econRules.islandIncome.length; i++) {
    income.push({
      fuel: econRules.islandIncome[i].fuel,
      materials: econRules.islandIncome[i].materials,
      ordnance: econRules.islandIncome[i].ordnance,
    });
  }
  return {
    incomeEvery: econRules.incomeEveryTicks,
    factoryIn: econRules.factoryMaterialsIn,
    factoryFuel: econRules.factoryFuelOut,
    factoryOrdnance: econRules.factoryOrdnanceOut,
    networkPermil: econRules.networkSharePermil,
    stockCap: econRules.islandStockCap,
    repairPerMaterial: econRules.repairPerMaterial,
    income: income,
  };
}

export {
  stepEconomy,
  produce,
  refine,
  shipToStockpile,
  claimDefaultStockpile,
  teamHoldings,
  teamById,
  islandById,
  createEconomy,
  copyEconomy,
};
