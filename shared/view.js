// shared/view.js - per-team fog filtering.
//
// This is the ONLY thing a client ever receives. Solo play runs the engine in
// the browser and still routes through here, so a solo player sees exactly what
// a networked one does and neither renderer can accidentally learn something
// the fog should hide. Nothing downstream of this module gets the raw state.
//
// Milestone 0 fog: islands are common knowledge (they are on the chart), own
// carriers are fully visible, enemy carriers appear only inside radar range and
// then only as a contact - position and heading, no fuel, no hull, no orders.

import { distSq2D } from './fixed.js';
import { teamHoldings } from '../engine/economy.js';

function ownCarrierView(carrier) {
  return {
    id: carrier.id,
    team: carrier.team,
    x: carrier.x,
    y: carrier.y,
    heading: carrier.heading,
    speed: carrier.speed,
    throttle: carrier.throttle,
    rudder: carrier.rudder,
    headingHold: carrier.headingHold,
    hull: carrier.hull,
    maxHull: carrier.maxHull,
    fuel: carrier.fuel,
    fuelCapacity: carrier.fuelCapacity,
    grounded: carrier.grounded,
    supplyRun: carrier.supplyRun,
    maxSpeed: carrier.maxSpeed,
    radar: carrier.radar,
    contact: 0,
  };
}

function contactView(carrier) {
  return {
    id: carrier.id,
    team: carrier.team,
    x: carrier.x,
    y: carrier.y,
    heading: carrier.heading,
    speed: 0,
    throttle: 0,
    rudder: 0,
    headingHold: -1,
    hull: -1,
    maxHull: -1,
    fuel: -1,
    fuelCapacity: -1,
    grounded: 0,
    supplyRun: 0,
    maxSpeed: 0,
    radar: 0,
    contact: 1,
  };
}

function ownUnitView(unit) {
  return {
    id: unit.id,
    team: unit.team,
    kind: unit.kind,
    carrierId: unit.carrierId,
    state: unit.state,
    order: unit.order,
    x: unit.x,
    y: unit.y,
    z: unit.z,
    heading: unit.heading,
    speed: unit.speed,
    hp: unit.hp,
    fuel: unit.fuel,
    fuelCapacity: unit.fuelCapacity,
    targetX: unit.targetX,
    targetY: unit.targetY,
    control: unit.control,
    throttle: unit.throttle,
    maxSpeed: unit.maxSpeed,
    pod: unit.pod,
    blocked: unit.blocked,
    cargoFuel: unit.cargoFuel,
    cargoMaterials: unit.cargoMaterials,
    cargoCap: unit.cargoCap,
    contact: 0,
  };
}

function unitContactView(unit) {
  return {
    id: unit.id,
    team: unit.team,
    kind: unit.kind,
    carrierId: -1,
    state: unit.state,
    order: -1,
    x: unit.x,
    y: unit.y,
    z: unit.z,
    heading: unit.heading,
    speed: 0,
    hp: -1,
    fuel: -1,
    fuelCapacity: -1,
    targetX: 0,
    targetY: 0,
    control: -1,
    throttle: 0,
    maxSpeed: 0,
    pod: 0,
    blocked: 0,
    cargoFuel: -1,
    cargoMaterials: -1,
    cargoCap: -1,
    contact: 1,
  };
}

function islandView(island, team) {
  const mine = island.owner === team;
  return {
    id: island.id,
    kind: island.kind,
    owner: island.owner,
    x: island.x,
    y: island.y,
    radius: island.radius,
    peak: island.peak,
    seed: island.seed,
    noiseCell: island.noiseCell,
    noiseOctaves: island.noiseOctaves,
    noisePermil: island.noisePermil,
    warpCell: island.warpCell,
    warpPermil: island.warpPermil,
    nodeX: island.nodeX,
    nodeY: island.nodeY,
    podTeam: island.podTeam,
    podTicks: island.podTicks,
    // What is piled up on an island is only visible to the side holding it.
    stockFuel: mine ? island.stockFuel : -1,
    stockMaterials: mine ? island.stockMaterials : -1,
    stockOrdnance: mine ? island.stockOrdnance : -1,
  };
}

// Every hull a team owns is a sensor: carriers reach furthest, but a Manta out
// on patrol is how you see anything at all beyond the carrier's own horizon.
function detectedBy(state, team, target) {
  for (let i = 0; i < state.carriers.length; i++) {
    const sensor = state.carriers[i];
    if (sensor.team !== team) continue;
    if (distSq2D(sensor.x, sensor.y, target.x, target.y) <= sensor.radar * sensor.radar) return true;
  }
  for (let i = 0; i < state.units.length; i++) {
    const sensor = state.units[i];
    if (sensor.team !== team) continue;
    if (sensor.state !== 1 && sensor.state !== 2) continue; // active or returning
    if (distSq2D(sensor.x, sensor.y, target.x, target.y) <= sensor.radar * sensor.radar) return true;
  }
  return false;
}

function buildView(state, team) {
  const carriers = [];
  for (let i = 0; i < state.carriers.length; i++) {
    const carrier = state.carriers[i];
    if (carrier.team === team) carriers.push(ownCarrierView(carrier));
    else if (detectedBy(state, team, carrier)) carriers.push(contactView(carrier));
  }
  const units = [];
  for (let i = 0; i < state.units.length; i++) {
    const unit = state.units[i];
    if (unit.team === team) {
      units.push(ownUnitView(unit));
    } else if (unit.state === 1 || unit.state === 2) {
      // A stowed enemy unit is inside a hangar and cannot be seen at all.
      if (detectedBy(state, team, unit)) units.push(unitContactView(unit));
    }
  }

  const islands = [];
  for (let i = 0; i < state.islands.length; i++) islands.push(islandView(state.islands[i], team));

  let stockpileIsland = -1;
  for (let i = 0; i < state.teams.length; i++) {
    if (state.teams[i].id === team) stockpileIsland = state.teams[i].stockpileIsland;
  }
  const holdings = teamHoldings(state, team);

  // Carrier events carry a carrier id in `a`; unit events (code 8 and up)
  // carry a unit id in `a` and the owning team in `b`. Either way a team hears
  // only about its own. Code 1 (command rejected) is feedback to whoever sent
  // the command and is passed through.
  const events = [];
  for (let i = 0; i < state.events.length; i++) {
    const event = state.events[i];
    // Island ownership is chart-level common knowledge in this design, so a
    // capture (17) and a displaced pod (16) are announced to everyone - you
    // would notice losing an island - and so is the end of the war (18).
    // Everything else is private.
    let mine = event.code === 1 || event.code === 16 || event.code === 17 || event.code === 18;
    if (event.code >= 8) {
      mine = mine || event.b === team;
    } else {
      for (let c = 0; c < carriers.length; c++) {
        if (carriers[c].contact === 0 && carriers[c].id === event.a) mine = true;
      }
    }
    if (mine) events.push({ code: event.code, a: event.a, b: event.b, c: event.c });
  }

  return {
    tick: state.tick,
    team: team,
    phase: state.phase,
    winner: state.winner,
    winReason: state.winReason,
    seed: state.seed,
    params: {
      unitsPerMetre: state.params.unitsPerMetre,
      sizeUnits: state.params.sizeUnits,
      tickHz: state.params.tickHz,
    },
    // Not a treasury: the sum of what is sitting on the islands you hold.
    resources: {
      id: team,
      fuel: holdings.fuel,
      materials: holdings.materials,
      ordnance: holdings.ordnance,
      stockpileIsland: stockpileIsland,
    },
    carriers: carriers,
    units: units,
    islands: islands,
    events: events,
  };
}

export { buildView };
