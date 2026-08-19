// engine/supply.js - the logistics boat, and the only way fuel reaches a hull.
//
// A lighter shuttles between the team's stockpile island and its carrier. It
// stands OFF the beach to work cargo rather than driving up it, which is both
// what a lighter does and a neat way to avoid ever asking a boat to climb a
// hill: its loading station is a point on the water, computed on the line from
// the island toward the carrier.
//
// The run is a standing order on the carrier, not a per-trip command. Switch
// it on and the boat keeps cycling: load, deliver, load again. Switch it off
// and it finishes the leg it is on and comes home.

import { dist2D, mulDiv } from '../shared/fixed.js';
import { atan2B, mulCos, mulSin } from '../shared/trig.js';
import { EVT_SUPPLY_DELIVERED, EVT_SUPPLY_LOADED, EVT_UNIT_LAUNCHED, pushEvent } from './events.js';
import { islandById, teamById } from './economy.js';
import { launchUnit, orderReturn, readyToLaunch } from './hangar.js';
import {
  KIND_LIGHTER,
  ORDER_DELIVER,
  ORDER_LOAD,
  UNIT_ACTIVE,
  UNIT_RETURNING,
} from './units.js';

// Where a lighter works cargo: off the island's shore, on the side facing the
// carrier, so the run is as short as the geometry allows.
function loadingStation(island, carrier) {
  const bearing = atan2B(carrier.y - island.y, carrier.x - island.x);
  const standOff = island.radius + mulDiv(island.radius, island.warpPermil, 1000) + 40 * 256;
  return {
    x: island.x + mulCos(standOff, bearing),
    y: island.y + mulSin(standOff, bearing),
  };
}

function carrierFor(state, carrierId) {
  for (let i = 0; i < state.carriers.length; i++) {
    if (state.carriers[i].id === carrierId) return state.carriers[i];
  }
  return -1;
}

function lighterFor(state, carrierId) {
  for (let i = 0; i < state.units.length; i++) {
    const unit = state.units[i];
    if (unit.kind !== KIND_LIGHTER || unit.carrierId !== carrierId) continue;
    if (unit.state === UNIT_ACTIVE || unit.state === UNIT_RETURNING) return unit;
  }
  return -1;
}

function laden(unit) {
  return unit.cargoFuel + unit.cargoMaterials + unit.cargoOrdnance;
}

// How much of one good moves this tick: never more than there is, never more
// than the crew can shift, never more than there is room for.
function moveAmount(available, budget, room) {
  const want = budget < room ? budget : room;
  const moved = available < want ? available : want;
  return moved > 0 ? moved : 0;
}

// Loaded in priority order, because a lighter is smaller than the ship's
// appetite: fuel keeps the carrier moving, ordnance keeps it dangerous, and
// materials - which become hull repair at the other end - ride in what is left.
function loadFromDepot(state, unit, depot) {
  const room = unit.cargoCap - laden(unit);
  if (room <= 0) return 0;
  let worked = 0;

  const fuel = moveAmount(depot.stockFuel, unit.workRate, room);
  depot.stockFuel = depot.stockFuel - fuel;
  unit.cargoFuel = unit.cargoFuel + fuel;
  worked = worked + fuel;

  const ordnance = moveAmount(depot.stockOrdnance, unit.workRate - worked, room - worked);
  depot.stockOrdnance = depot.stockOrdnance - ordnance;
  unit.cargoOrdnance = unit.cargoOrdnance + ordnance;
  worked = worked + ordnance;

  const materials = moveAmount(depot.stockMaterials, unit.workRate - worked, room - worked);
  depot.stockMaterials = depot.stockMaterials - materials;
  unit.cargoMaterials = unit.cargoMaterials + materials;
  worked = worked + materials;

  return worked;
}

function unloadToCarrier(state, unit, carrier) {
  let worked = 0;
  const fuel = moveAmount(unit.cargoFuel, unit.workRate, carrier.fuelCapacity - carrier.fuel);
  unit.cargoFuel = unit.cargoFuel - fuel;
  carrier.fuel = carrier.fuel + fuel;
  worked = worked + fuel;

  // Ordnance goes into the ship's store, which is what rearms aircraft and
  // feeds point defence (ruling #17).
  const ordnance = moveAmount(
    unit.cargoOrdnance,
    unit.workRate - worked,
    carrier.ordnanceCapacity - carrier.ordnance,
  );
  unit.cargoOrdnance = unit.cargoOrdnance - ordnance;
  carrier.ordnance = carrier.ordnance + ordnance;
  worked = worked + ordnance;
  // Materials go into the ship's yard stores. They are not repairs yet: the
  // automatic repair system spends them, in the priority order the player set
  // (engine/repair.js).
  const materials = moveAmount(
    unit.cargoMaterials,
    unit.workRate - worked,
    carrier.materialsCapacity - carrier.materials,
  );
  unit.cargoMaterials = unit.cargoMaterials - materials;
  carrier.materials = carrier.materials + materials;
  worked = worked + materials;
  return worked;
}

// One lighter's tick. Returns nothing; it works purely through the unit's
// order and target, which the drive model then acts on.
function runLighter(state, unit, carrier, depot) {
  if (unit.order === ORDER_LOAD) {
    const station = loadingStation(depot, carrier);
    unit.targetX = station.x;
    unit.targetY = station.y;
    unit.state = UNIT_ACTIVE;
    const offshore = dist2D(unit.x, unit.y, depot.x, depot.y) - depot.radius;
    if (offshore > unit.loadRange) return;
    const worked = loadFromDepot(state, unit, depot);
    const full = laden(unit) >= unit.cargoCap;
    // Nothing left to load is as good a reason to sail as a full hold.
    if (full || worked === 0) {
      if (laden(unit) > 0) {
        pushEvent(state.events, EVT_SUPPLY_LOADED, unit.id, unit.team, unit.cargoFuel);
        unit.order = ORDER_DELIVER;
      }
    }
    return;
  }

  if (unit.order === ORDER_DELIVER) {
    unit.targetX = carrier.x;
    unit.targetY = carrier.y;
    unit.state = UNIT_ACTIVE;
    if (dist2D(unit.x, unit.y, carrier.x, carrier.y) > state.params.recoverRange) return;
    const worked = unloadToCarrier(state, unit, carrier);
    const empty = laden(unit) <= 0;
    if (empty || worked === 0) {
      pushEvent(state.events, EVT_SUPPLY_DELIVERED, unit.id, unit.team, 0);
      // Drop anything the ship could not take rather than shuttling it about.
      unit.cargoFuel = 0;
      unit.cargoMaterials = 0;
      unit.cargoOrdnance = 0;
      if (carrier.supplyRun === 1) unit.order = ORDER_LOAD;
      else orderReturn(unit);
    }
  }
}

function stepSupply(state) {
  for (let i = 0; i < state.carriers.length; i++) {
    const carrier = state.carriers[i];
    if (carrier.hull <= 0) continue;
    const team = teamById(state, carrier.team);
    if (team === -1) continue;
    const depot = team.stockpileIsland < 0 ? -1 : islandById(state, team.stockpileIsland);
    let unit = lighterFor(state, carrier.id);

    if (carrier.supplyRun !== 1 || depot === -1 || depot.owner !== carrier.team) {
      // No run, or nowhere to run to: whatever is out finishes its delivery
      // and then comes home.
      if (unit !== -1 && unit.order === ORDER_LOAD) orderReturn(unit);
      continue;
    }

    if (unit === -1) {
      const ready = readyToLaunch(state, carrier.id, KIND_LIGHTER);
      if (ready === -1) continue; // no boat left; the run waits
      launchUnit(ready, carrier, state.params.deckHeight);
      pushEvent(state.events, EVT_UNIT_LAUNCHED, ready.id, ready.team, ready.kind);
      ready.order = ORDER_LOAD;
      unit = ready;
    }
    if (unit.order !== ORDER_LOAD && unit.order !== ORDER_DELIVER) unit.order = ORDER_LOAD;
    runLighter(state, unit, carrier, depot);
  }
}

export {
  stepSupply,
  runLighter,
  loadingStation,
  loadFromDepot,
  unloadToCarrier,
  lighterFor,
  laden,
};
