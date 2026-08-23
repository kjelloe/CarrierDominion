// engine/action_start.js - the original's Action Game (ruling 2026-08-23).
//
// 1988 shipped two starts: the Strategy Game (everything from zero - our
// default) and the Action Game, where the war is already underway and you are
// minutes from contact. This builds that second start, deterministically, at
// tick zero, from nothing but the assembled state - so it lives inside
// createInitialState, is covered by the rules hash (the flag is a rule), and
// replays like everything else.
//
// The developed war, as ruled: each team gets its nearest third-ish of the
// archipelago - a stocked FACTORY island (the stockpile), a RESOURCE island,
// and DEFENCE islands with guns up - supply runs on, and the carriers nudged
// toward the middle as far as open water allows. The rest stays neutral:
// there is still a race, it just starts at speed.

import { dist2D, mulDiv } from '../shared/fixed.js';
import { mulCos, mulSin } from '../shared/trig.js';
import { worldHeightAt } from './heightmap.js';
import { UNIT_STOWED } from './units.js';
import { raiseTurret, ROLE_DEFENCE, ROLE_FACTORY, ROLE_RESOURCE } from './island.js';

// How much of the crossing the Action start skips: each carrier moves this
// far toward the map centre, stopping early wherever open water runs out.
const CLOSER_PERMIL = 300;

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

function stockIsland(island, fuel, materials, ordnance, chassis) {
  island.stockFuel = fuel;
  island.stockMaterials = materials;
  island.stockOrdnance = ordnance;
  island.stockChassis = chassis;
}

function developTeam(state, team, carrier, share) {
  for (let n = 0; n < share; n++) {
    const island = nearestUnowned(state, carrier.x, carrier.y);
    if (island === -1) return;
    island.owner = team.id;
    if (n === 0) {
      // The plant, stocked and nominated: the supply chain breathes from
      // tick one.
      island.role = ROLE_FACTORY;
      island.factories = 2;
      island.warehouses = 1;
      stockIsland(island, 20000, 3000, 2000, 24);
      team.stockpileIsland = island.id;
    } else if (n === 1) {
      island.role = ROLE_RESOURCE;
      stockIsland(island, 500, 2000, 0, 0);
    } else {
      island.role = ROLE_DEFENCE;
      for (let g = 0; g < 2; g++) raiseTurret(state, island);
      island.turrets = 2;
    }
  }
}

function prepareActionStart(state) {
  const centreX = mulDiv(state.params.sizeUnits, 1, 2);
  const centreY = centreX;
  const share = Math.max(2, Math.floor(state.islands.length / (state.teams.length + 1)));

  for (let t = 0; t < state.teams.length; t++) {
    const team = state.teams[t];
    let carrier = -1;
    for (let c = 0; c < state.carriers.length; c++) {
      if (state.carriers[c].team === team.id) carrier = state.carriers[c];
    }
    if (carrier === -1) continue;

    // Closer to the fight, one tenth at a time, stopping at the last step
    // that is still open water in every direction that matters.
    for (let step = 1; step <= 10; step++) {
      const permil = mulDiv(CLOSER_PERMIL, step, 10);
      const x = carrier.x + mulDiv(centreX - carrier.x, permil, 1000);
      const y = carrier.y + mulDiv(centreY - carrier.y, permil, 1000);
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

    developTeam(state, team, carrier, share);
  }
  return state;
}

export { CLOSER_PERMIL, prepareActionStart };
