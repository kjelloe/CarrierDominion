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
import { computeNetwork, markNetworkDirty, onNetwork } from './network.js';
import { ROLE_FACTORY, ROLE_NONE, stockCapOf, terrainPermil } from './island.js';

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

// Mines and quarries: raw output straight into the island's own stock. What it
// makes is decided by the ROLE its owner gave it, scaled by how well the ground
// suits that role. An island nobody has configured produces nothing - taking it
// is the start of the job, not the end.
function produce(state) {
  for (let i = 0; i < state.islands.length; i++) {
    const island = state.islands[i];
    if (island.owner < 0 || island.role === ROLE_NONE) continue;
    const row = state.economy.income[island.role];
    if (row === undefined) continue;
    const bonus = terrainPermil(island, state.economy);
    const cap = stockCapOf(island, state.economy);
    island.stockFuel = capped(island.stockFuel + mulDiv(row.fuel, bonus, 1000), cap);
    island.stockMaterials = capped(
      island.stockMaterials + mulDiv(row.materials, bonus, 1000),
      cap,
    );
    island.stockOrdnance = capped(island.stockOrdnance + mulDiv(row.ordnance, bonus, 1000), cap);
  }
}

// Refineries: a factory turns materials into fuel, munitions and replacement
// vehicle chassis, and turns nothing into nothing. An enemy who takes your
// resource islands starves the factory without ever having to touch it.
//
// Throughput is per FACTORY BUILT, so the island's three factory slots are
// three times the plant, not a label. A factory island with nothing built on it
// yet is a building site.
// The quartermaster's hand on the plant (ruling 2026-08-23): each factory
// run's three outputs are reweighted by the owning team's bias - LOW 0,
// MEDIUM 1, HIGH 2 - normalised so all-MEDIUM is exactly the old behaviour.
// All-LOW idles the plant WITHOUT eating materials: an order to make nothing
// is an order to stop, not an order to waste.
function biasedOut(base, weight, weightSum) {
  if (weightSum <= 0) return 0;
  return mulDiv(base, weight * 3, weightSum);
}

function refine(state) {
  for (let i = 0; i < state.islands.length; i++) {
    const island = state.islands[i];
    if (island.owner < 0 || island.role !== ROLE_FACTORY || island.factories <= 0) continue;
    const team = teamById(state, island.owner);
    const wFuel = team === -1 ? 1 : team.biasFuel;
    const wOrdnance = team === -1 ? 1 : team.biasOrdnance;
    const wChassis = team === -1 ? 1 : team.biasChassis;
    const weightSum = wFuel + wOrdnance + wChassis;
    if (weightSum <= 0) continue;
    const cap = stockCapOf(island, state.economy);
    const bonus = terrainPermil(island, state.economy);
    for (let run = 0; run < island.factories; run++) {
      if (island.stockMaterials < state.economy.factoryIn) break;
      island.stockMaterials = island.stockMaterials - state.economy.factoryIn;
      island.stockFuel = capped(
        island.stockFuel + biasedOut(mulDiv(state.economy.factoryFuel, bonus, 1000), wFuel, weightSum),
        cap,
      );
      island.stockOrdnance = capped(
        island.stockOrdnance
          + biasedOut(mulDiv(state.economy.factoryOrdnance, bonus, 1000), wOrdnance, weightSum),
        cap,
      );
      island.stockChassis = capped(
        island.stockChassis + biasedOut(state.economy.factoryChassis, wChassis, weightSum),
        cap,
      );
    }
  }
}

// What actually moves: the network's share, but never more than the depot has
// room for. Shipping the share and capping the arrival DESTROYED the excess -
// the source was debited, the depot was full, and the difference vanished
// silently every accrual. A full depot now leaves goods where they are, which
// is also the signal a player can see: stock piling up at the mine means the
// depot needs a warehouse.
function shipAmount(available, sharePermil, room) {
  if (room <= 0) return 0;
  const share = mulDiv(available, sharePermil, 1000);
  return share < room ? share : room;
}

// The cargo network, abstracted: each accrual, every owned island ships a
// share of what it holds toward the team's stockpile island. No drone
// entities - the interesting decision is WHICH island is the stockpile and
// whether the chain is intact, not the individual sorties.
function shipToStockpile(state) {
  for (let t = 0; t < state.teams.length; t++) {
    const team = state.teams[t];
    if (team.stockpileIsland < 0) continue;
    const depot = islandById(state, team.stockpileIsland);
    if (depot === -1 || depot.owner !== team.id) continue;
    const cap = stockCapOf(depot, state.economy);
    const share = state.economy.networkPermil;
    for (let i = 0; i < state.islands.length; i++) {
      const island = state.islands[i];
      if (island.owner !== team.id || island.id === depot.id) continue;
      // Cut off from the chain: it keeps what it makes until the link is
      // restored, exactly as the original's manual describes.
      if (!onNetwork(state, island)) continue;
      const fuel = shipAmount(island.stockFuel, share, cap - depot.stockFuel);
      const materials = shipAmount(island.stockMaterials, share, cap - depot.stockMaterials);
      const ordnance = shipAmount(island.stockOrdnance, share, cap - depot.stockOrdnance);
      const chassis = shipAmount(island.stockChassis, share, cap - depot.stockChassis);
      island.stockFuel = island.stockFuel - fuel;
      island.stockMaterials = island.stockMaterials - materials;
      island.stockOrdnance = island.stockOrdnance - ordnance;
      island.stockChassis = island.stockChassis - chassis;
      depot.stockFuel = depot.stockFuel + fuel;
      depot.stockMaterials = depot.stockMaterials + materials;
      depot.stockOrdnance = depot.stockOrdnance + ordnance;
      depot.stockChassis = depot.stockChassis + chassis;
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
      markNetworkDirty(state);
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
  const total = { fuel: 0, materials: 0, ordnance: 0, chassis: 0 };
  for (let i = 0; i < state.islands.length; i++) {
    const island = state.islands[i];
    if (island.owner !== teamId) continue;
    total.fuel = total.fuel + island.stockFuel;
    total.materials = total.materials + island.stockMaterials;
    total.ordnance = total.ordnance + island.stockOrdnance;
    total.chassis = total.chassis + island.stockChassis;
  }
  return total;
}

function copyIncome(rows) {
  const out = [];
  for (let i = 0; i < rows.length; i++) {
    out.push({ fuel: rows[i].fuel, materials: rows[i].materials, ordnance: rows[i].ordnance });
  }
  return out;
}

function copyBuilds(rows) {
  const out = [];
  for (let i = 0; i < rows.length; i++) {
    out.push({ cost: rows[i].cost, ticks: rows[i].ticks, max: rows[i].max });
  }
  return out;
}

function copyEconomy(economy) {
  return {
    incomeEvery: economy.incomeEvery,
    factoryIn: economy.factoryIn,
    factoryFuel: economy.factoryFuel,
    factoryOrdnance: economy.factoryOrdnance,
    factoryChassis: economy.factoryChassis,
    chassisPerHull: economy.chassisPerHull,
    chassisPerEquipment: economy.chassisPerEquipment,
    hammerReload: economy.hammerReload,
    networkPermil: economy.networkPermil,
    stockCap: economy.stockCap,
    warehouseCap: economy.warehouseCap,
    terrainBonus: economy.terrainBonus,
    repairPerMaterial: economy.repairPerMaterial,
    unitRepairHp: economy.unitRepairHp,
    unitRepairMaterials: economy.unitRepairMaterials,
    income: copyIncome(economy.income),
    builds: copyBuilds(economy.builds),
  };
}

function createEconomy(econRules) {
  const builds = [];
  for (let i = 0; i < econRules.builds.length; i++) {
    builds.push({
      cost: econRules.builds[i].materials,
      ticks: econRules.builds[i].ticks,
      max: econRules.builds[i].max,
    });
  }
  return {
    incomeEvery: econRules.incomeEveryTicks,
    factoryIn: econRules.factoryMaterialsIn,
    factoryFuel: econRules.factoryFuelOut,
    factoryOrdnance: econRules.factoryOrdnanceOut,
    factoryChassis: econRules.factoryChassisOut,
    chassisPerHull: econRules.chassisPerHull,
    // Equipment - the Viewing Drone and the defence decoy - is simpler than
    // an airframe and priced accordingly (ruled 2026-08-25: the consumables
    // come back through the spine that already exists).
    chassisPerEquipment: econRules.chassisPerEquipment,
    hammerReload: econRules.hammerReloadPer100Ticks,
    networkPermil: econRules.networkSharePermil,
    stockCap: econRules.islandStockCap,
    warehouseCap: econRules.warehouseStockCap,
    terrainBonus: econRules.terrainBonusPermil,
    repairPerMaterial: econRules.repairPerMaterial,
    // The hangar mends what comes home (manual coverage review, item 7):
    // hull points per beat per stowed hull, and the materials they cost.
    unitRepairHp: econRules.unitRepairHpPer100Ticks,
    unitRepairMaterials: econRules.unitRepairMaterialsPer100Ticks,
    income: copyIncome(econRules.roleIncome),
    builds: builds,
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
