// engine/action_start.js - the original's Action Game (ruling 2026-08-23).
//
// 1988 shipped two starts: the Strategy Game (everything from zero - our
// default) and the Action Game, where the war is already underway and you are
// minutes from contact. This builds that second start, deterministically, at
// tick zero, from nothing but the assembled state - so it lives inside
// createInitialState, is covered by the rules hash (the flag is a rule), and
// replays like everything else.
//
// The developed war, as ruled: each team gets its nearest share of the
// archipelago - a stocked FACTORY island (the stockpile), a RESOURCE island,
// and DEFENCE islands with guns up - supply runs on, and the carriers nudged
// toward the middle as far as open water allows. The rest stays neutral:
// there is still a race, it just starts at speed.
//
// Order matters (third review, 2026-08-23): allocation for EVERY team runs
// before any carrier moves, round-robin so a table bigger than the
// archipelago shorts every seat equally instead of the last seats entirely -
// and the nudge refuses to stop anywhere a hostile action-start battery
// already reaches. The first shape of this file nudged then developed, one
// team at a time, and seed 31337's team 14 started 2,289 m from a rival
// missile battery and was sunk by tick 7,137 without a decision being made.

import { dist2D, mulDiv } from '../shared/fixed.js';
import { mulCos, mulSin } from '../shared/trig.js';
import { worldHeightAt } from './heightmap.js';
import { UNIT_STOWED } from './units.js';
import { raiseTurret, ROLE_DEFENCE, ROLE_FACTORY, ROLE_RESOURCE } from './island.js';

// How much of the crossing the Action start skips: each carrier moves this
// far toward the map centre, stopping early wherever open water runs out.
const CLOSER_PERMIL = 300;

// A spawn must not sit inside a gun envelope it never chose to enter: the
// margin past the longest turret weapon's reach, in metres.
const HOSTILE_GUN_MARGIN_METRES = 1200;

function nearestUnowned(state, x, y) {
  let best = -1;
  let bestDistance = 2147483647;
  for (let i = 0; i < state.islands.length; i++) {
    const island = state.islands[i];
    if (island.owner !== -1) continue;
    const distance = dist2D(x, y, island.x, island.y);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = island;
    }
  }
  return best;
}

// Deep water at the point and around it, the same test the spawn suite runs:
// a nudged carrier with a shoal one lookahead off the bow grounds on its
// first order, which would be a poor way to start an Action Game.
function openWaterAt(state, carrier, x, y) {
  if (worldHeightAt(state.islands, x, y) >= -carrier.draught) return false;
  for (let a = 0; a < 8; a++) {
    const bam = mulDiv(a, 65536, 8);
    const px = x + mulCos(carrier.lookahead * 2, bam);
    const py = y + mulSin(carrier.lookahead * 2, bam);
    if (worldHeightAt(state.islands, px, py) >= -carrier.draught) return false;
  }
  return true;
}

// The longest reach of any weapon a turret carries, so the clearance rule
// reads the actual loadout rather than hard-coding today's missile figure.
function longestTurretReach(state) {
  let reach = 0;
  for (let t = 0; t < state.turrets.length; t++) {
    const arms = state.turrets[t].arms;
    for (let a = 0; a < arms.length; a++) {
      const weapon = state.weapons[arms[a].w];
      if (weapon !== undefined && weapon.range > reach) reach = weapon.range;
    }
  }
  return reach;
}

function insideHostileGuns(state, team, x, y, clearance) {
  for (let t = 0; t < state.turrets.length; t++) {
    const turret = state.turrets[t];
    if (turret.team === team) continue;
    if (dist2D(x, y, turret.x, turret.y) < clearance) return true;
  }
  return false;
}

function stockIsland(island, fuel, materials, ordnance, chassis) {
  island.stockFuel = fuel;
  island.stockMaterials = materials;
  island.stockOrdnance = ordnance;
  island.stockChassis = chassis;
}

function developIsland(state, team, island, round) {
  island.owner = team.id;
  island.nodeHp = state.params.commandCentreHp;
  if (round === 0) {
    // The plant, stocked and nominated: the supply chain breathes from
    // tick one.
    island.role = ROLE_FACTORY;
    island.factories = 2;
    island.warehouses = 1;
    stockIsland(island, 20000, 3000, 2000, 24);
    team.stockpileIsland = island.id;
  } else if (round === 1) {
    island.role = ROLE_RESOURCE;
    stockIsland(island, 500, 2000, 0, 0);
  } else {
    island.role = ROLE_DEFENCE;
    for (let g = 0; g < 2; g++) raiseTurret(state, island);
    island.turrets = 2;
  }
}

function carrierOf(state, teamId) {
  for (let c = 0; c < state.carriers.length; c++) {
    if (state.carriers[c].team === teamId) return state.carriers[c];
  }
  return -1;
}

function prepareActionStart(state) {
  const centreX = mulDiv(state.params.sizeUnits, 1, 2);
  const centreY = centreX;
  const share = Math.max(2, Math.floor(state.islands.length / (state.teams.length + 1)));

  // Every team's estate first, ROUND-ROBIN: one island per team per round,
  // nearest to that team's spawn. Sequential whole-share grabs let early
  // seats empty the archipelago before late seats chose at all, and a
  // table of sixteen on a small map gave seats 0..n islands and the rest
  // nothing. Short every seat equally instead.
  for (let round = 0; round < share; round++) {
    for (let t = 0; t < state.teams.length; t++) {
      const carrier = carrierOf(state, state.teams[t].id);
      if (carrier === -1) continue;
      const island = nearestUnowned(state, carrier.x, carrier.y);
      if (island === -1) continue;
      developIsland(state, state.teams[t], island, round);
    }
  }

  // Now the nudge, against the finished map: closer to the fight, one tenth
  // at a time, stopping at the last step that is still open water AND
  // outside every rival battery's reach.
  const clearance = longestTurretReach(state)
    + HOSTILE_GUN_MARGIN_METRES * state.params.unitsPerMetre;
  for (let t = 0; t < state.teams.length; t++) {
    const team = state.teams[t];
    const carrier = carrierOf(state, team.id);
    if (carrier === -1) continue;

    for (let step = 1; step <= 10; step++) {
      const permil = mulDiv(CLOSER_PERMIL, step, 10);
      const x = carrier.x + mulDiv(centreX - carrier.x, permil, 1000);
      const y = carrier.y + mulDiv(centreY - carrier.y, permil, 1000);
      if (!openWaterAt(state, carrier, x, y)) break;
      if (insideHostileGuns(state, team.id, x, y, clearance)) break;
      carrier.x = x;
      carrier.y = y;
    }
    // The allocation itself may have raised a rival's guns beside this
    // seat's SPAWN (crowded rings, small maps): back straight away from the
    // nearest offending battery until clear, staying in open water.
    for (let retreat = 0; retreat < 40; retreat++) {
      if (!insideHostileGuns(state, team.id, carrier.x, carrier.y, clearance)) break;
      let threat = -1;
      let threatDistance = 2147483647;
      for (let g = 0; g < state.turrets.length; g++) {
        const turret = state.turrets[g];
        if (turret.team === team.id) continue;
        const distance = dist2D(carrier.x, carrier.y, turret.x, turret.y);
        if (distance < threatDistance) {
          threatDistance = distance;
          threat = turret;
        }
      }
      if (threat === -1 || threatDistance <= 0) break;
      const stepUnits = 400 * state.params.unitsPerMetre;
      const x = carrier.x + mulDiv(carrier.x - threat.x, stepUnits, threatDistance);
      const y = carrier.y + mulDiv(carrier.y - threat.y, stepUnits, threatDistance);
      if (!openWaterAt(state, carrier, x, y)) break;
      carrier.x = x;
      carrier.y = y;
    }

    carrier.supplyRun = 1;
    // The hangar moved with the ship: stowed hulls sit wherever it now is.
    for (let u = 0; u < state.units.length; u++) {
      const unit = state.units[u];
      if (unit.carrierId !== carrier.id || unit.state !== UNIT_STOWED) continue;
      unit.x = carrier.x;
      unit.y = carrier.y;
      unit.targetX = carrier.x;
      unit.targetY = carrier.y;
    }
  }
  return state;
}

export { CLOSER_PERMIL, prepareActionStart };
