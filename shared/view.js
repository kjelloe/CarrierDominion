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

import { teamHoldings } from '../engine/economy.js';
import { covered, ghostsFor } from '../engine/contacts.js';

// What is in the magazines. A contact gets an empty list: how many missiles an
// enemy has left is not something radar tells you.
function armsView(arms) {
  const out = [];
  for (let i = 0; i < arms.length; i++) out.push({ w: arms[i].w, n: arms[i].n });
  return out;
}

function sectionsView(sections) {
  const out = [];
  for (let i = 0; i < sections.length; i++) {
    out.push({
      id: sections[i].id,
      hp: sections[i].hp,
      maxHp: sections[i].maxHp,
      priority: sections[i].priority,
    });
  }
  return out;
}

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
    weapon: carrier.weapon,
    arms: armsView(carrier.arms),
    heat: carrier.heat,
    overheated: carrier.overheated,
    ordnance: carrier.ordnance,
    ordnanceCapacity: carrier.ordnanceCapacity,
    materials: carrier.materials,
    materialsCapacity: carrier.materialsCapacity,
    chassis: carrier.chassis,
    flareCooldown: carrier.flareCooldown,
    flareReload: carrier.flareReload,
    flareCost: carrier.flareCost,
    sections: sectionsView(carrier.sections),
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
    weapon: -1,
    arms: [],
    heat: -1,
    overheated: 0,
    ordnance: -1,
    ordnanceCapacity: -1,
    materials: -1,
    materialsCapacity: -1,
    flareCooldown: -1,
    flareReload: -1,
    flareCost: -1,
    // What is broken aboard an enemy ship is exactly what you would most like
    // to know, so a radar contact tells you nothing about it.
    sections: [],
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
    cargoOrdnance: unit.cargoOrdnance,
    cargoCap: unit.cargoCap,
    virus: unit.virus,
    weapon: unit.weapon,
    arms: armsView(unit.arms),
    heat: unit.heat,
    overheated: unit.overheated,
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
    cargoOrdnance: -1,
    cargoCap: -1,
    virus: 0,
    weapon: -1,
    arms: [],
    heat: -1,
    overheated: 0,
    contact: 1,
  };
}

function islandView(island, team) {
  // team -1 is the spectator, who owns nothing - without the guard, an
  // UNOWNED island (owner -1) would count as "mine" and show its stocks.
  const mine = team >= 0 && island.owner === team;
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
    virusTeam: island.virusTeam,
    virusTicks: island.virusTicks,
    // What an island has been made INTO is visible from the sea - you can see
    // a factory - but what is piled up inside it is not.
    role: island.role,
    factories: island.factories,
    warehouses: island.warehouses,
    turrets: island.turrets,
    building: island.building,
    buildTicks: mine ? island.buildTicks : -1,
    stockFuel: mine ? island.stockFuel : -1,
    stockMaterials: mine ? island.stockMaterials : -1,
    stockOrdnance: mine ? island.stockOrdnance : -1,
    stockChassis: mine ? island.stockChassis : -1,
  };
}

// Every hull a team owns is a sensor: carriers reach furthest, but a Manta out
// on patrol is how you see anything at all beyond the carrier's own horizon.
// The rule itself lives in engine/contacts.js so the memory system, the AI and
// this filter can never disagree about what a team's sensors reach - and it
// says a sunk carrier senses nothing, which an earlier version of this file
// forgot.
function detectedBy(state, team, target) {
  return covered(state, team, target.x, target.y);
}

// A shot in the air is visible the way anything else is: your own always, an
// enemy's only where one of your hulls can see it. Nothing about a shot is
// hidden once it IS visible - it is a missile, not a secret.
//
// `warn` is the exception that proves it: a guided round with THIS team's
// carrier as its target. A ship knows when something has locked onto it - that
// is what a lock warning is - and it is the piece of information that makes
// evasion a decision rather than a surprise.
function aimedAtTeam(state, shot, team) {
  if (shot.guided !== 1 || shot.targetKind !== 1) return false;
  for (let i = 0; i < state.carriers.length; i++) {
    const carrier = state.carriers[i];
    if (carrier.id === shot.targetId && carrier.team === team) return true;
  }
  return false;
}

function shotView(state, shot, team) {
  const warn = aimedAtTeam(state, shot, team) ? 1 : 0;
  return {
    id: shot.id,
    team: shot.team,
    x: shot.x,
    y: shot.y,
    z: shot.z,
    heading: shot.heading,
    warn: warn,
  };
}

// A turret is a building: visible to anyone who can see the island, because a
// gun emplacement is not a secret. Its magazine is.
function turretView(turret, team) {
  const mine = team >= 0 && turret.team === team;
  return {
    id: turret.id,
    island: turret.island,
    team: turret.team,
    kind: turret.kind,
    x: turret.x,
    y: turret.y,
    z: turret.z,
    hp: mine ? turret.hp : -1,
    maxHp: turret.maxHp,
    overheated: mine ? turret.overheated : 0,
  };
}

// Empty while the war runs; every team's final score once it is over.
function scoreboard(state) {
  const out = [];
  if (state.phase === 0) return out;
  for (let i = 0; i < state.teams.length; i++) {
    out.push({ id: state.teams[i].id, score: state.teams[i].score });
  }
  return out;
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

  const shots = [];
  for (let i = 0; i < state.shots.length; i++) {
    const shot = state.shots[i];
    // A round aimed at YOUR ship is on your scope whether or not anything of
    // yours can see it: the ship's own warning receiver is what sees it. One
    // aimed at somebody else is not - checking only "is it guided at a carrier"
    // would have shown every side every missile in the war.
    const aimedHere = aimedAtTeam(state, shot, team);
    if (shot.team === team || aimedHere || detectedBy(state, team, shot)) {
      shots.push(shotView(state, shot, team));
    }
  }

  const turrets = [];
  for (let i = 0; i < state.turrets.length; i++) turrets.push(turretView(state.turrets[i], team));

  // The chart's memory: marks for hulls this team HAS seen and no longer does
  // - position, heading and when, nothing live. A spectator remembers nothing.
  const contacts = team >= 0 ? ghostsFor(state, team) : [];

  const islands = [];
  for (let i = 0; i < state.islands.length; i++) islands.push(islandView(state.islands[i], team));

  let stockpileIsland = -1;
  let score = 0;
  for (let i = 0; i < state.teams.length; i++) {
    if (state.teams[i].id !== team) continue;
    stockpileIsland = state.teams[i].stockpileIsland;
    score = state.teams[i].score;
  }
  // Spectators hold nothing; summing "islands owned by -1" would total the
  // unowned ones.
  const holdings = team >= 0
    ? teamHoldings(state, team)
    : { fuel: 0, materials: 0, ordnance: 0, chassis: 0 };

  // Carrier events carry a carrier id in `a`; unit events (code 8 and up)
  // carry a unit id in `a` and the owning team in `b`. Either way a team hears
  // only about its own. Code 1 (command rejected) is feedback to whoever sent
  // the command and is passed through.
  //
  // Chart-level common knowledge is announced to everyone: a displaced pod
  // (16), a capture (17), a CONVERSION (36) - it is a capture, and the side
  // that just lost its island working is the side that most needs to hear it -
  // a carrier sinking (21), and the end of the war (18).
  //
  // Two codes carry the team in `a` rather than `b` and are routed by it:
  // scored (29, b is the points) and an AI seat change (38, b is the flag).
  // Routing those by `b` sent score events to whichever team the point value
  // happened to equal.
  const events = [];
  for (let i = 0; i < state.events.length; i++) {
    const event = state.events[i];
    let mine = event.code === 1 || event.code === 16 || event.code === 17
      || event.code === 18 || event.code === 21 || event.code === 36;
    if (event.code === 29 || event.code === 38) {
      mine = mine || event.a === team;
    } else if (event.code >= 8) {
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
      pointCap: state.params.pointCap,
      timeCapTicks: state.params.timeCapTicks,
    },
    // Not a treasury: the sum of what is sitting on the islands you hold.
    resources: {
      id: team,
      fuel: holdings.fuel,
      materials: holdings.materials,
      ordnance: holdings.ordnance,
      chassis: holdings.chassis,
      stockpileIsland: stockpileIsland,
      score: score,
    },
    carriers: carriers,
    units: units,
    shots: shots,
    turrets: turrets,
    contacts: contacts,
    islands: islands,
    // Everybody's final score, revealed only when the war is over: during it,
    // the enemy's score is fog like everything else of theirs, but an ending
    // is a result and a result has a scoreboard.
    scores: scoreboard(state),
    events: events,
  };
}

export { buildView };
