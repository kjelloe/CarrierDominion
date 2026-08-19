// engine/economy.js - what holding an island is FOR.
//
// Income accrues in a lump every `incomeEveryTicks` rather than a fraction
// every tick. With integer resources the two are equivalent, and the lump
// version needs no per-team accumulator in state - which means one less field
// to forget in copyState, and a hash that does not churn on 19 ticks out of
// every 20.
//
// Resupply is the other half: a carrier lying off an island it owns draws fuel
// from the team's stores and patches its hull. That is the loop the whole game
// hangs on - islands pay for the ship, the ship takes islands.

import { dist2D } from '../shared/fixed.js';
import { EVT_RESUPPLIED, pushEvent } from './events.js';

function teamById(state, teamId) {
  for (let i = 0; i < state.teams.length; i++) {
    if (state.teams[i].id === teamId) return state.teams[i];
  }
  return -1;
}

function accrueIncome(state) {
  for (let i = 0; i < state.islands.length; i++) {
    const island = state.islands[i];
    if (island.owner < 0) continue;
    const team = teamById(state, island.owner);
    if (team === -1) continue;
    const row = state.economy.income[island.kind];
    if (row === undefined) continue;
    team.fuel = team.fuel + row.fuel;
    team.materials = team.materials + row.materials;
    team.ordnance = team.ordnance + row.ordnance;
  }
}

// The nearest island this carrier's team owns, within resupply range, or -1.
//
// Range is measured from the SHORE, not the centre. Measured from the centre
// it was unreachable: a 1 km island with a shallow shelf grounds a carrier
// long before it gets within 900 m of the middle, so the whole mechanism could
// never fire. The test that caught it was checking something else entirely.
function resupplyPointFor(state, carrier) {
  for (let i = 0; i < state.islands.length; i++) {
    const island = state.islands[i];
    if (island.owner !== carrier.team) continue;
    const offshore = dist2D(carrier.x, carrier.y, island.x, island.y) - island.radius;
    if (offshore <= state.economy.resupplyRange) return island;
  }
  return -1;
}

function resupplyCarriers(state) {
  for (let i = 0; i < state.carriers.length; i++) {
    const carrier = state.carriers[i];
    if (carrier.hull <= 0) continue;
    const island = resupplyPointFor(state, carrier);
    if (island === -1) continue;
    const team = teamById(state, carrier.team);
    if (team === -1) continue;

    let taken = 0;
    const room = carrier.fuelCapacity - carrier.fuel;
    if (room > 0 && team.fuel > 0) {
      let amount = state.economy.resupplyFuel;
      if (amount > room) amount = room;
      if (amount > team.fuel) amount = team.fuel;
      carrier.fuel = carrier.fuel + amount;
      team.fuel = team.fuel - amount;
      taken = amount;
    }

    const damage = carrier.maxHull - carrier.hull;
    if (damage > 0) {
      let repair = state.economy.resupplyHull;
      if (repair > damage) repair = damage;
      carrier.hull = carrier.hull + repair;
      taken = taken + repair;
    }

    if (taken > 0) pushEvent(state.events, EVT_RESUPPLIED, carrier.id, carrier.team, island.id);
  }
}

function stepEconomy(state) {
  if (state.economy.incomeEvery < 1) return;
  if (state.tick % state.economy.incomeEvery !== 0) return;
  accrueIncome(state);
  resupplyCarriers(state);
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
    resupplyRange: economy.resupplyRange,
    resupplyFuel: economy.resupplyFuel,
    resupplyHull: economy.resupplyHull,
    income: income,
  };
}

function createEconomy(econRules, unitsPerMetre) {
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
    resupplyRange: econRules.resupplyRangeMetres * unitsPerMetre,
    resupplyFuel: econRules.resupplyFuelPerAccrual,
    resupplyHull: econRules.resupplyHullPerAccrual,
    income: income,
  };
}

export { stepEconomy, accrueIncome, resupplyCarriers, resupplyPointFor, createEconomy, copyEconomy };
