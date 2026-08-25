// engine/ai_carrier.js - the enemy carrier, as a state machine.
//
// The AI runs INSIDE the reducer, on a slow cadence, exactly like Fireline's
// regency: it is part of the deterministic war, so every replay, every golden
// hash, and every headless sim covers it. It is not a separate process poking
// commands in from outside, and it gets no information a player would not have
// - it reads the same state, but it is written to only look at what its own
// hulls could see. (When real fog lands, this is the module that must be
// audited against it.)
//
// The machine is deliberately small. It picks an island, steams to it, puts a
// Walrus ashore, and plants a pod. That is the whole game loop; doing it
// competently is worth more than doing something clever badly.

import { dist2D, mulDiv } from '../shared/fixed.js';
import { atan2B } from '../shared/trig.js';
import { checkDeploy, deployPod } from './capture.js';
import { checkVirus, deployVirus } from './virus.js';
import { skirtRadius } from './heightmap.js';
import { orderReturn, readyToLaunch } from './hangar.js';
import {
  KIND_WALRUS,
  ORDER_MOVE,
  UNIT_ACTIVE,
  UNIT_RETURNING,
  UNIT_STOWED,
  unitCommitted,
} from './units.js';
import { EVT_SUPPLY_RUN, pushEvent } from './events.js';
import { teamById } from './economy.js';
import { manageStrike, withdraw } from './ai_strike.js';
import { setDecoyScreen } from './fleet.js';
import { covered } from './contacts.js';
import { awaitingHull } from './repair.js';
import { manageIslands, planFor } from './ai_estate.js';
import { beginLaunch } from './deck.js';
import { fireFlares, shouldFlare } from './flare.js';

const AI_SEEK = 0; // steaming toward the chosen island
const AI_INVADE = 1; // in position, getting a Walrus to the node
const AI_WAIT = 2; // pod is building, nothing to do but hold station

// How long a grounded carrier commits to its escape course. It has to cover
// the turn (a carrier needs over a thousand ticks to come about) AND then put
// real distance between itself and the shelf, or it simply grounds again on
// the next leg.
const BACKOFF_TICKS = 6000;

function findCarrierForTeam(state, team) {
  for (let i = 0; i < state.carriers.length; i++) {
    if (state.carriers[i].team === team) return state.carriers[i];
  }
  return -1;
}

function findUnitById(state, unitId) {
  for (let i = 0; i < state.units.length; i++) {
    if (state.units[i].id === unitId) return state.units[i];
  }
  return -1;
}

function standoffFor(island, extraUnits) {
  return skirtRadius(island) + mulDiv(island.radius, island.warpPermil, 1000) + extraUnits;
}

// The nearest island this team does not already own and is not already taking.
function chooseTarget(state, team, carrier) {
  let best = -1;
  let bestDistance = 2147483647;
  for (let i = 0; i < state.islands.length; i++) {
    const island = state.islands[i];
    if (island.owner === team) continue;
    if (island.podTeam === team) continue;
    const distance = dist2D(carrier.x, carrier.y, island.x, island.y);
    if (distance >= bestDistance) continue;
    bestDistance = distance;
    best = island.id;
  }
  return best;
}

function islandById(state, islandId) {
  for (let i = 0; i < state.islands.length; i++) {
    if (state.islands[i].id === islandId) return state.islands[i];
  }
  return -1;
}

// Steer the carrier at a point and pick a throttle for how close it is.
function steerCarrierTo(carrier, x, y, slowRadius) {
  carrier.headingHold = atan2B(y - carrier.y, x - carrier.x);
  carrier.rudder = 0;
  const distance = dist2D(carrier.x, carrier.y, x, y);
  if (distance <= slowRadius) {
    carrier.throttle = 0;
    return 1;
  }
  carrier.throttle = distance < slowRadius * 3 ? 40 : 100;
  return 0;
}

// The Walrus this brain is currently using, or -1.
// The vehicle this brain has committed, whether it is ashore, at sea, or
// still riding the lift. Counting only ACTIVE would send a second Walrus
// every turn of the five seconds the deck cycle takes, and then a third.
function activeWalrus(state, brain) {
  if (brain.walrusId === -1) return -1;
  const unit = findUnitById(state, brain.walrusId);
  if (unit === -1) return -1;
  if (!unitCommitted(unit)) return -1;
  return unit;
}

function seek(state, brain, carrier, standoffExtra) {
  if (brain.targetIsland === -1) {
    brain.targetIsland = chooseTarget(state, carrier.team, carrier);
    if (brain.targetIsland === -1) {
      carrier.throttle = 0; // nothing left to take
      return;
    }
  }
  const island = islandById(state, brain.targetIsland);
  if (island === -1 || island.owner === carrier.team) {
    brain.targetIsland = -1;
    return;
  }
  const arrived = steerCarrierTo(carrier, island.x, island.y, standoffFor(island, standoffExtra));
  if (arrived === 1) brain.mode = AI_INVADE;
}

function invade(state, brain, carrier) {
  const island = islandById(state, brain.targetIsland);
  if (island === -1 || island.owner === carrier.team) {
    brain.mode = AI_SEEK;
    brain.targetIsland = -1;
    return;
  }
  if (island.podTeam === carrier.team || island.virusTeam === carrier.team) {
    brain.mode = AI_WAIT;
    return;
  }

  let walrus = activeWalrus(state, brain);
  if (walrus === -1) {
    const ready = readyToLaunch(state, carrier.id, KIND_WALRUS);
    if (ready === -1) {
      // No vehicle left to send; go and find an easier island.
      brain.mode = AI_SEEK;
      brain.targetIsland = -1;
      return;
    }
    // Through the deck, like the player (2026-08-26). The machine used to
    // launch instantly while a human waited five seconds on the lift, which
    // was an oversight of the deck slice rather than a decision.
    if (beginLaunch(state, ready, carrier) === 0) return;
    brain.walrusId = ready.id;
    walrus = ready;
  }

  // Still on its way up: nothing to order yet.
  if (walrus.state !== UNIT_ACTIVE && walrus.state !== UNIT_RETURNING) return;

  if (walrus.pod !== 1) {
    orderReturn(walrus);
    brain.walrusId = -1;
    return;
  }
  // A developed island is worth taking whole. The bomb is slower, so it is
  // only worth the wait when there is something on the island to inherit.
  const worthConverting = island.factories + island.warehouses + island.turrets > 0;
  if (worthConverting && checkVirus(walrus, island, state.params.virusRange) === '') {
    deployVirus(state, walrus, island);
    brain.mode = AI_WAIT;
    return;
  }
  if (checkDeploy(walrus, island, state.params.podRange) === '') {
    // Type the pod NOW, not when the vehicle sailed (ruled 2026-08-25: pods
    // are typed). planFor reads the estate as it stands, and the estate at
    // the beach is not the estate at the ship - a from-zero war can be tens
    // of thousands of ticks between the two. Typing at launch gave every
    // island in such a war the role the FIRST one wanted, so no AI team ever
    // built a factory and both fleets ran their bunkers dry.
    walrus.podRole = planFor(state, brain.team, island);
    deployPod(state, walrus, island);
    brain.mode = AI_WAIT;
    return;
  }
  // Keep the order fresh: the node does not move, but the vehicle may have
  // been knocked onto a HOLD by arriving somewhere else.
  walrus.order = ORDER_MOVE;
  walrus.state = UNIT_ACTIVE;
  walrus.targetX = island.nodeX;
  walrus.targetY = island.nodeY;
}

function waitForPod(state, brain, carrier) {
  const island = islandById(state, brain.targetIsland);
  if (island === -1) {
    brain.mode = AI_SEEK;
    brain.targetIsland = -1;
    return;
  }
  carrier.throttle = 0;
  if (island.owner === carrier.team) {
    // Taken. Bring the vehicle home and go again.
    const walrus = activeWalrus(state, brain);
    if (walrus !== -1) orderReturn(walrus);
    brain.walrusId = -1;
    brain.targetIsland = -1;
    brain.mode = AI_SEEK;
    return;
  }
  if (island.podTeam !== carrier.team && island.virusTeam !== carrier.team) {
    // Somebody displaced us. Try again with whatever is still aboard.
    brain.mode = AI_INVADE;
  }
}

// Nearest island by centre distance, or -1.
function nearestIsland(state, x, y) {
  let best = -1;
  let bestDistance = 2147483647;
  for (let i = 0; i < state.islands.length; i++) {
    const distance = dist2D(x, y, state.islands[i].x, state.islands[i].y);
    if (distance >= bestDistance) continue;
    bestDistance = distance;
    best = state.islands[i];
  }
  return best;
}

// A grounded carrier that keeps steering at its target grinds on the same
// shoal forever - which is exactly what the first version of this AI did, for
// three hours of game time, having just captured the island it was stuck on.
// Aground, it commits to a course straight out to sea and holds it.
// Returns 1 when the escape has the helm this tick.
function backOff(state, brain, carrier) {
  if (brain.avoidTicks > 0) {
    brain.avoidTicks = brain.avoidTicks - 1;
    carrier.headingHold = brain.avoidHeading;
    carrier.rudder = 0;
    carrier.throttle = 60;
    return 1;
  }
  if (carrier.grounded !== 1) return 0;
  const island = nearestIsland(state, carrier.x, carrier.y);
  if (island === -1) return 0;
  brain.avoidHeading = atan2B(carrier.y - island.y, carrier.x - island.x);
  brain.avoidTicks = BACKOFF_TICKS;
  carrier.headingHold = brain.avoidHeading;
  carrier.rudder = 0;
  carrier.throttle = 60;
  return 1;
}

// Fuel management, such as it is: call for a supply run when the tanks get
// low, call it off when they are nearly full. The AI has to do this or it
// simply stops in the middle of the ocean two hours in - the placeholder
// economy used to refuel it for free, and ruling #3 took that away.
const SUPPLY_CALL_PERMIL = 500;
const SUPPLY_STAND_DOWN_PERMIL = 900;

// How many repairs' worth of materials counts as "enough aboard to mend".
// Small: the point is to notice an EMPTY hold, not to hoard.
const MEND_RESERVE = 20;

function manageSupply(state, brain, carrier) {
  const team = teamById(state, brain.team);
  if (team === -1 || team.stockpileIsland < 0) {
    carrier.supplyRun = 0;
    return;
  }
  // Whichever is emptier decides. Ordnance was added by ruling #17 and matters
  // as much as fuel: a ship with a dry magazine is a target, not a warship.
  const fuelLevel = mulDiv(carrier.fuel, 1000, carrier.fuelCapacity);
  const ordnanceLevel = carrier.ordnanceCapacity > 0
    ? mulDiv(carrier.ordnance, 1000, carrier.ordnanceCapacity)
    : 1000;
  const level = ordnanceLevel < fuelLevel ? ordnanceLevel : fuelLevel;
  // PARTS are a reason to call the boat too, and the shopping list forgot
  // them: a ship with a full bunker, a full magazine and an annihilated air
  // group would sit there forever while the chassis it needed piled up at
  // the depot. Measured on seed 900913 - 192 chassis ashore, no boat out,
  // no aircraft, 100,000 ticks of nothing. Fuel and ordnance were the only
  // things the machine had ever thought to ask for.
  const wantsParts = awaitingHull(state, carrier)
    && carrier.chassis < state.economy.chassisPerHull;
  // And MATERIALS, for the same reason and by the same oversight. Materials
  // are what the yard turns into hull, so a damaged ship with an empty
  // materials hold cannot mend - and a ship that cannot mend retreats, and
  // keeps retreating. Seed 20260818 spent 340,000 ticks doing exactly that
  // at 87 of 1,000 hull with 61,571 materials sitting at its own depot.
  const wantsMaterials = carrier.hull < carrier.maxHull
    && carrier.materials < state.economy.repairPerMaterial * MEND_RESERVE;
  if (carrier.supplyRun === 0
    && (level < SUPPLY_CALL_PERMIL || wantsParts || wantsMaterials)) {
    carrier.supplyRun = 1;
    pushEvent(state.events, EVT_SUPPLY_RUN, carrier.id, carrier.team, 1);
  } else if (carrier.supplyRun === 1 && level > SUPPLY_STAND_DOWN_PERMIL
    && !wantsParts && !wantsMaterials) {
    carrier.supplyRun = 0;
    pushEvent(state.events, EVT_SUPPLY_RUN, carrier.id, carrier.team, 0);
  }
}

// One AI turn for one team. Called from the reducer on the AI cadence.
// The decoy screen, as the machine plays it (ruled 2026-08-25). The rule
// that matters is WHEN, not whether: "an enemy is on radar" was tried first
// and produced a stable crawl - both fleets screened at twelve kilometres,
// both at three quarters speed, so neither closed, and seed 900913 grew a
// 64,000-tick dead stretch and ran to 165k ticks instead of 75k. The screen
// is bait for seekers, so it goes out when seekers are a real prospect: one
// already in the air with this ship's name on it, or an enemy carrier close
// enough to launch. Otherwise the ship would rather have its speed.
function seekerInbound(state, carrier) {
  for (let i = 0; i < state.shots.length; i++) {
    const shot = state.shots[i];
    if (shot.team === carrier.team || shot.guided !== 1) continue;
    if (shot.targetKind === 1 && shot.targetId === carrier.id) return 1;
  }
  return 0;
}

// Twice the longest guided reach in the ruleset: far enough to be inflated
// before the first round arrives, near enough that it is a fight and not a
// sighting. Derived, so it tracks the weapon table rather than a constant.
function seekerAlertRange(state) {
  let longest = 0;
  for (let i = 0; i < state.weapons.length; i++) {
    const weapon = state.weapons[i];
    if (weapon.guided === 1 && weapon.range > longest) longest = weapon.range;
  }
  return longest * 2;
}

function manageScreen(state, brain, carrier) {
  let threat = seekerInbound(state, carrier);
  if (threat === 0) {
    const alert = seekerAlertRange(state);
    for (let i = 0; i < state.carriers.length; i++) {
      const enemy = state.carriers[i];
      if (enemy.team === brain.team || enemy.hull <= 0) continue;
      if (!covered(state, brain.team, enemy.x, enemy.y)) continue;
      if (dist2D(carrier.x, carrier.y, enemy.x, enemy.y) <= alert) threat = 1;
    }
  }
  setDecoyScreen(state, carrier, threat);
}

function stepAiTeam(state, brain, standoffExtra) {
  const carrier = findCarrierForTeam(state, brain.team);
  if (carrier === -1 || carrier.hull <= 0) return;
  // Flares first: a missile arriving is more urgent than anything else on the
  // list, and the burst is worthless once it has landed.
  if (shouldFlare(state, carrier)) fireFlares(state, carrier);
  manageScreen(state, brain, carrier);
  manageSupply(state, brain, carrier);
  // An island the AI takes and never develops produces nothing, so the estate
  // is managed before anything else: it is what pays for the rest.
  manageIslands(state, brain);
  if (backOff(state, brain, carrier) === 1) return;
  // A battered carrier breaks contact before it does anything else. Only a
  // healthy one goes looking for a fight.
  if (withdraw(state, brain, carrier) === 1) return;
  // Air defence and strike run alongside the invasion plan rather than
  // replacing it: the carrier keeps steaming for its island while its Mantas
  // deal with whatever has come over the horizon.
  manageStrike(state, brain);
  if (brain.mode === AI_SEEK) seek(state, brain, carrier, standoffExtra);
  else if (brain.mode === AI_INVADE) invade(state, brain, carrier);
  else waitForPod(state, brain, carrier);
}

function stepAi(state, cadenceTicks, standoffExtra) {
  if (cadenceTicks < 1) return;
  if (state.tick % cadenceTicks !== 0) return;
  for (let i = 0; i < state.ai.length; i++) stepAiTeam(state, state.ai[i], standoffExtra);
}

function createBrain(team) {
  return {
    team: team,
    mode: AI_SEEK,
    targetIsland: -1,
    walrusId: -1,
    avoidTicks: 0,
    avoidHeading: 0,
    strikeCarrier: -1,
    retreatTicks: 0,
    retreatHeading: 0,
    // The last tick this team had LIVE contact with an enemy carrier. The
    // patrol gate reads it: patrols are for re-finding a lost war, not for
    // opening-move rushes (engine/ai_strike.js).
    lastContactTick: 0,
  };
}

function copyBrain(brain) {
  return {
    team: brain.team,
    mode: brain.mode,
    targetIsland: brain.targetIsland,
    walrusId: brain.walrusId,
    avoidTicks: brain.avoidTicks,
    avoidHeading: brain.avoidHeading,
    strikeCarrier: brain.strikeCarrier,
    retreatTicks: brain.retreatTicks,
    retreatHeading: brain.retreatHeading,
    lastContactTick: brain.lastContactTick,
  };
}

export {
  BACKOFF_TICKS,
  SUPPLY_CALL_PERMIL,
  manageSupply,
  AI_SEEK,
  AI_INVADE,
  AI_WAIT,
  UNIT_STOWED,
  stepAi,
  stepAiTeam,
  createBrain,
  copyBrain,
  chooseTarget,
  standoffFor,
};
