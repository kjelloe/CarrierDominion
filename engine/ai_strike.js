// engine/ai_strike.js - the half of the AI that fights rather than invades.
//
// Split out of ai_carrier.js to keep both modules under the size cap, and
// because the two behaviours answer different questions: that one asks "which
// island next", this one asks "is there something to kill right now". It runs
// on the same slow cadence and reads the same state.
//
// Mantas fly the strike. The carrier itself never manoeuvres to attack: it is
// the airfield, and steering it into a gunfight is how you lose one.

import { dist2D, mulDiv } from '../shared/fixed.js';
import { atan2B } from '../shared/trig.js';
import { EVT_SUPPLY_RUN, EVT_UNIT_LAUNCHED, pushEvent } from './events.js';
import { launchUnit, orderReturn, readyToLaunch } from './hangar.js';
import { fireUnit } from './weapons.js';
import {
  KIND_MANTA,
  ORDER_MOVE,
  UNIT_ACTIVE,
  UNIT_RETURNING,
  fuelPermil,
} from './units.js';

// How many airframes go out at once. Two is enough to matter and leaves the
// hangar with something for the next contact.
const STRIKE_MANTAS = 2;

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

// One strike decision for one team. Returns the enemy carrier id under attack,
// or -1 when there is nothing to attack - which the brain stores so the client
// and the tests can see what it is doing.
function manageStrike(state, brain) {
  const target = findStrikeTarget(state, brain.team);
  const flying = airborneMantas(state, brain.team);

  if (target === -1) {
    // Nothing in sight. Bring anything that is up back home rather than
    // letting it circle until the tanks run dry.
    if (brain.strikeCarrier !== -1) {
      for (let i = 0; i < flying.length; i++) orderReturn(flying[i]);
    }
    brain.strikeCarrier = -1;
    return -1;
  }

  brain.strikeCarrier = target.id;
  for (let i = 0; i < flying.length; i++) {
    if (fuelPermil(flying[i]) <= STRIKE_FUEL_PERMIL) {
      orderReturn(flying[i]);
      continue;
    }
    vectorTo(flying[i], target.x, target.y);
    // Pull the trigger. fireUnit is a no-op when nothing is in range or the
    // rail is still cooling, so this can simply be asked every cadence.
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
  STRIKE_FUEL_PERMIL,
  WITHDRAW_PERMIL,
  WITHDRAW_TICKS,
  spotted,
  findStrikeTarget,
  hullPermil,
  withdraw,
  manageStrike,
};
