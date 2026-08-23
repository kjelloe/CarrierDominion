// engine/ai_strike.js - the half of the AI that fights rather than invades.
//
// Split out of ai_carrier.js to keep both modules under the size cap, and
// because the two behaviours answer different questions: that one asks "which
// island next", this one asks "is there something to kill right now". It runs
// on the same slow cadence and reads the same state.
//
// Mantas fly the strike. The carrier itself never manoeuvres to attack: it is
// the airfield, and steering it into a gunfight is how you lose one.

import { dist2D, floorDiv, mulDiv } from '../shared/fixed.js';
import { atan2B, mulCos, mulSin } from '../shared/trig.js';
import { CONTACT_CARRIER, remembered } from './contacts.js';
import { EVT_SUPPLY_RUN, EVT_UNIT_LAUNCHED, pushEvent } from './events.js';
import { launchUnit, orderReturn, readyToLaunch } from './hangar.js';
import { fireUnit, roundsOf, selectWeapon } from './weapons.js';
import {
  KIND_MANTA,
  ORDER_MOVE,
  KIND_LIGHTER,
  UNIT_ACTIVE,
  UNIT_RETURNING,
  fuelPermil,
} from './units.js';

// How many airframes go out at once. Two is enough to matter and leaves the
// hangar with something for the next contact.
const STRIKE_MANTAS = 2;

// The weapon a strike flies with. A Manta starts on its laser, which is a
// 1400 m weapon: sending it at a carrier with that selected means flying inside
// the ship's own point defence to use it. The missile reaches 3000 m.
const STRIKE_WEAPON = 3;

// What it falls back to when the rails are empty: a Manta with no missiles is
// still worth something on the way home.
const FALLBACK_WEAPON = 0;

// Below this the Manta is kept on the deck: a strike is a round trip, and a
// half-empty aircraft is a loss, not an attack.
const STRIKE_FUEL_PERMIL = 400;

// Anything a team's own hulls can see. Deliberately the same rule the fog
// filter uses - the AI must not learn anything a player would not.
function spotted(state, team, x, y) {
  for (let i = 0; i < state.carriers.length; i++) {
    const sensor = state.carriers[i];
    if (sensor.team !== team || sensor.hull <= 0) continue;
    if (dist2D(sensor.x, sensor.y, x, y) <= sensor.radar) return true;
  }
  for (let i = 0; i < state.units.length; i++) {
    const sensor = state.units[i];
    if (sensor.team !== team) continue;
    if (sensor.state !== UNIT_ACTIVE && sensor.state !== UNIT_RETURNING) continue;
    if (dist2D(sensor.x, sensor.y, x, y) <= sensor.radar) return true;
  }
  return false;
}

// The enemy carrier this team can see and is nearest to, or -1. Carriers only:
// spending a strike on a lighter would be a poor trade and a worse AI.
function findStrikeTarget(state, team) {
  let best = -1;
  let bestDistance = 2147483647;
  for (let i = 0; i < state.carriers.length; i++) {
    const enemy = state.carriers[i];
    if (enemy.team === team || enemy.hull <= 0) continue;
    if (!spotted(state, team, enemy.x, enemy.y)) continue;
    let distance = 2147483647;
    for (let c = 0; c < state.carriers.length; c++) {
      const own = state.carriers[c];
      if (own.team !== team || own.hull <= 0) continue;
      const d = dist2D(own.x, own.y, enemy.x, enemy.y);
      if (d < distance) distance = d;
    }
    if (distance >= bestDistance) continue;
    bestDistance = distance;
    best = enemy;
  }
  return best;
}

function airborneMantas(state, team) {
  const out = [];
  for (let i = 0; i < state.units.length; i++) {
    const unit = state.units[i];
    if (unit.team !== team || unit.kind !== KIND_MANTA) continue;
    if (unit.state !== UNIT_ACTIVE) continue;
    out.push(unit);
  }
  return out;
}

// Send an aircraft at a point. Getting it there is only half the job: a Manta
// fires only when somebody pulls the trigger (ruling #18), and for an AI-flown
// aircraft that somebody is this module.
function vectorTo(unit, x, y) {
  unit.order = ORDER_MOVE;
  unit.state = UNIT_ACTIVE;
  unit.control = -1;
  unit.throttle = 100;
  unit.targetX = x;
  unit.targetY = y;
}

// The ghost of an enemy carrier on this team's chart, or -1. When there is
// more than one (bigger wars), the one remembered most recently.
function carrierGhost(state, team) {
  let best = -1;
  for (let i = 0; i < state.carriers.length; i++) {
    const enemy = state.carriers[i];
    if (enemy.team === team) continue;
    const ghost = remembered(state.contacts, team, CONTACT_CARRIER, enemy.id);
    if (ghost === -1 || ghost.tick >= state.tick) continue;
    if (best === -1 || ghost.tick > best.tick) best = ghost;
  }
  return best;
}

// One aircraft goes to look at a mark on the chart - a remembered ghost, or a
// patrol point. For a ghost the search is self-terminating: the scout's own
// radar either re-acquires the carrier - live target, and the strike takes
// over next cadence - or scans the spot clean, which DISPROVES the ghost, and
// with no ghost left the scout is recalled. No search timer, no patrol state
// in the brain.
function huntGhost(state, brain, mark, flying, carrier) {
  let scout = -1;
  for (let i = 0; i < flying.length; i++) {
    const manta = flying[i];
    if (scout === -1 && fuelPermil(manta) > STRIKE_FUEL_PERMIL) {
      scout = manta;
      continue;
    }
    // One pair of eyes is enough for a memory; everything else goes home.
    orderReturn(manta);
  }
  if (scout === -1) {
    if (carrier === -1) return;
    const ready = readyToLaunch(state, carrier.id, KIND_MANTA);
    if (ready === -1 || fuelPermil(ready) <= STRIKE_FUEL_PERMIL) return;
    launchUnit(ready, carrier, state.params.deckHeight);
    pushEvent(state.events, EVT_UNIT_LAUNCHED, ready.id, ready.team, ready.kind);
    scout = ready;
  }
  vectorTo(scout, mark.x, mark.y);
}

// Patrolling costs bunker fuel every sortie, so it is a luxury the ship only
// affords above half a tank: insurance flights must never be what strands it.
const PATROL_SHIP_FUEL_PERMIL = 500;

// And it is a MID-WAR luxury. Without this gate the first patrol flew the
// moment anybody owned an island, found the enemy carrier in the opening, and
// autonomous strike cycles sank somebody by tick 11,000-20,000 on three of
// five battery seeds - the entire economy game deleted by eagerness. Patrols
// exist to break the 60,000-tick silences the watchdog flags, so they begin at
// half that: long enough for a war to develop, early enough that the scout's
// transit still beats the tripwire.
const PATROL_QUIET_TICKS = 30000;

// How long a patrol dwells on one island before the search moves on. Long
// enough for the transit and a proper look; short enough that a full sweep of
// the enemy's holdings finishes inside one watchdog window. Without rotation
// the patrol re-checked the same nearest island forever while the enemy
// carrier sat two islands further on - seed 424242 stalled 60,000 ticks with
// scouts dutifully airborne the whole time.
const PATROL_ROTATE_TICKS = 9000;

// A scout is a pair of eyes, not a raid: it stands OFF the island it is
// checking, on the side facing home. Its radar reaches 5,000 m and a missile
// battery reaches 3,500, so from four kilometres out it sweeps the anchorage
// without ever entering the guns' reach - overflying the node was how patrols
// fed a fortress island a steady diet of airframes.
const PATROL_STANDOFF_UNITS = 4000 * 256;

// Where to look when you know NOTHING: the islands the enemy HOLDS, in
// rotation. Ownership is chart-level common knowledge, a carrier is most
// often found near its conquests - and its guns are on the chart too, so the
// sweep walks them least-defended first. Rotation is driven by the tick, so
// it is replay-deterministic and needs no state in the brain.
function patrolMark(state, team, carrier) {
  const marks = [];
  for (let i = 0; i < state.islands.length; i++) {
    const island = state.islands[i];
    if (island.owner < 0 || island.owner === team) continue;
    marks.push(island);
  }
  if (marks.length === 0) return -1;
  // Least guns first, nearest first inside a tier: the sweep starts where a
  // scout is most likely to come home.
  marks.sort((a, b) => {
    if (a.turrets !== b.turrets) return a.turrets - b.turrets;
    const da = dist2D(carrier.x, carrier.y, a.nodeX, a.nodeY);
    const db = dist2D(carrier.x, carrier.y, b.nodeX, b.nodeY);
    if (da !== db) return da - db;
    return a.id - b.id;
  });
  const island = marks[floorDiv(state.tick, PATROL_ROTATE_TICKS) % marks.length];
  const away = dist2D(carrier.x, carrier.y, island.nodeX, island.nodeY);
  if (away <= PATROL_STANDOFF_UNITS) {
    // Already inside the standoff: the carrier's own radar covers the
    // anchorage, and a mark on the node would only walk the scout into the
    // guns for nothing.
    return { x: carrier.x, y: carrier.y };
  }
  const bearing = atan2B(carrier.y - island.nodeY, carrier.x - island.nodeX);
  return {
    x: island.nodeX + mulCos(PATROL_STANDOFF_UNITS, bearing),
    y: island.nodeY + mulSin(PATROL_STANDOFF_UNITS, bearing),
  };
}

// One strike decision for one team. Returns the enemy carrier id under attack,
// or -1 when there is nothing to attack - which the brain stores so the client
// and the tests can see what it is doing.
// The leash, obeyed (manual review, item 1): a drone past FADE is a drone
// about to be lost, so the machine brings it home before the link does the
// deciding. Runs first, every cadence, whatever else the brain wants.
function leashUnits(state, brain) {
  if (state.params.telemetryLoss <= 0) return;
  let carrier = -1;
  for (let i = 0; i < state.carriers.length; i++) {
    if (state.carriers[i].team === brain.team) carrier = state.carriers[i];
  }
  if (carrier === -1 || carrier.hull <= 0) return;
  for (let i = 0; i < state.units.length; i++) {
    const unit = state.units[i];
    if (unit.team !== brain.team || unit.kind === KIND_LIGHTER) continue;
    if (unit.state !== UNIT_ACTIVE) continue;
    if (dist2D(unit.x, unit.y, carrier.x, carrier.y) > state.params.telemetryFade) {
      orderReturn(unit);
    }
  }
}

// A mark the ship cannot cover is a mark that costs the scout: the machine
// declines errands beyond the leash rather than paying for them.
function withinLeash(state, carrier, x, y) {
  if (state.params.telemetryLoss <= 0) return true;
  if (carrier === -1) return false;
  return dist2D(carrier.x, carrier.y, x, y)
    <= mulDiv(state.params.telemetryFade, 900, 1000);
}

function manageStrike(state, brain) {
  leashUnits(state, brain);
  const target = findStrikeTarget(state, brain.team);
  const flying = airborneMantas(state, brain.team);

  if (target === -1) {
    brain.strikeCarrier = -1;
    let carrier = -1;
    for (let i = 0; i < state.carriers.length; i++) {
      if (state.carriers[i].team === brain.team) carrier = state.carriers[i];
    }
    // Nothing in sight - but is anything REMEMBERED? A ghost on the chart is
    // worth one scout (owner ruling 2026-08-21: the chart remembers, and an
    // AI that reads the same chart should act on it).
    const ghost = carrierGhost(state, brain.team);
    if (ghost !== -1 && withinLeash(state, carrier, ghost.x, ghost.y)) {
      huntGhost(state, brain, ghost, flying, carrier);
      return -1;
    }
    // Nothing in sight, nothing remembered: patrol, if the silence has grown
    // long enough to be worth breaking and the bunker can afford eyes in the
    // air. This is what keeps two blind fleets from spending fifty quiet
    // minutes failing to find each other - without turning the opening into
    // a carrier hunt.
    if (carrier !== -1
      && state.tick - brain.lastContactTick >= PATROL_QUIET_TICKS
      && carrier.fuelCapacity > 0
      && mulDiv(carrier.fuel, 1000, carrier.fuelCapacity) > PATROL_SHIP_FUEL_PERMIL) {
      const mark = patrolMark(state, brain.team, carrier);
      if (mark !== -1 && withinLeash(state, carrier, mark.x, mark.y)) {
        huntGhost(state, brain, mark, flying, carrier);
        return -1;
      }
    }
    // Nothing to see, nothing remembered, nowhere worth looking. Bring
    // anything that is up back home rather than letting it circle until the
    // tanks run dry.
    for (let i = 0; i < flying.length; i++) orderReturn(flying[i]);
    return -1;
  }

  brain.strikeCarrier = target.id;
  brain.lastContactTick = state.tick;
  for (let i = 0; i < flying.length; i++) {
    if (fuelPermil(flying[i]) <= STRIKE_FUEL_PERMIL) {
      orderReturn(flying[i]);
      continue;
    }
    vectorTo(flying[i], target.x, target.y);
    // Missiles while there are missiles; the gun once they are gone.
    const armed = roundsOf(flying[i], STRIKE_WEAPON) > 0;
    selectWeapon(flying[i], armed ? STRIKE_WEAPON : FALLBACK_WEAPON);
    fireUnit(state, flying[i]);
  }

  let carrier = -1;
  for (let i = 0; i < state.carriers.length; i++) {
    if (state.carriers[i].team === brain.team) carrier = state.carriers[i];
  }
  if (carrier === -1) return target.id;

  for (let launched = flying.length; launched < STRIKE_MANTAS; launched++) {
    const ready = readyToLaunch(state, carrier.id, KIND_MANTA);
    if (ready === -1) break;
    if (fuelPermil(ready) <= STRIKE_FUEL_PERMIL) break;
    launchUnit(ready, carrier, state.params.deckHeight);
    pushEvent(state.events, EVT_UNIT_LAUNCHED, ready.id, ready.team, ready.kind);
    vectorTo(ready, target.x, target.y);
  }
  return target.id;
}

// Below this much hull the carrier breaks off rather than trading to the
// death. Without it two AIs grind each other to the bottom on the same tick.
// Half was measured, not guessed: at a third, both sides still died together
// once point defence started reloading from the ordnance store, because a
// four-Manta wave carries 640 damage and a carrier is 1000.
const WITHDRAW_PERMIL = 500;

// A carrier makes 8 knots. Opening three kilometres - out of missile reach -
// takes about this long, which is why the commitment is measured in tens of
// thousands of ticks and not hundreds.
const WITHDRAW_TICKS = 12000;

function hullPermil(carrier) {
  if (carrier.maxHull <= 0) return 0;
  return mulDiv(carrier.hull, 1000, carrier.maxHull);
}

// Steer directly away from the nearest enemy carrier, recall the air group,
// and call for supply: the lighter brings fuel AND materials, and materials are
// hull repair. Returns 1 while the retreat has the helm.
function withdraw(state, brain, carrier) {
  if (brain.retreatTicks > 0) {
    brain.retreatTicks = brain.retreatTicks - 1;
    carrier.headingHold = brain.retreatHeading;
    carrier.rudder = 0;
    carrier.throttle = 100;
    return 1;
  }
  if (hullPermil(carrier) >= WITHDRAW_PERMIL) return 0;
  const enemy = findStrikeTarget(state, brain.team);
  if (enemy === -1) return 0;

  brain.retreatHeading = atan2B(carrier.y - enemy.y, carrier.x - enemy.x);
  brain.retreatTicks = WITHDRAW_TICKS;
  brain.strikeCarrier = -1;
  carrier.headingHold = brain.retreatHeading;
  carrier.rudder = 0;
  carrier.throttle = 100;
  if (carrier.supplyRun === 0) {
    carrier.supplyRun = 1;
    pushEvent(state.events, EVT_SUPPLY_RUN, carrier.id, carrier.team, 1);
  }
  const flying = airborneMantas(state, brain.team);
  for (let i = 0; i < flying.length; i++) orderReturn(flying[i]);
  return 1;
}

export {
  STRIKE_MANTAS,
  STRIKE_WEAPON,
  FALLBACK_WEAPON,
  STRIKE_FUEL_PERMIL,
  WITHDRAW_PERMIL,
  WITHDRAW_TICKS,
  spotted,
  findStrikeTarget,
  carrierGhost,
  huntGhost,
  patrolMark,
  PATROL_SHIP_FUEL_PERMIL,
  hullPermil,
  withdraw,
  manageStrike,
};
