// engine/turret.js - what a Defence island is actually for.
//
// A turret is a hull that cannot move: it has a position, health, a magazine
// and a mount that overheats, so it goes through exactly the same firing and
// damage machinery as everything else. That is the whole design - a turret is
// not a special case, it is a stationary shooter.
//
// They are laid out on a ring around the island's command node, alternating
// laser and missile, so a defence island is dangerous at both ranges: the
// missiles make a carrier plan around it, the lasers make a strike pay for the
// approach.
//
// Turrets belong to the ISLAND. Take the island and the previous owner's guns
// go with the rest of their works - you do not inherit them, because the reason
// to storm a defence island should be to stop it shooting, not to acquire it.

import { mulDiv } from '../shared/fixed.js';
import { mulCos, mulSin } from '../shared/trig.js';
import { islandHeightAt } from './heightmap.js';
import { EVT_TURRET_LOST, pushEvent } from './events.js';

const TURRET_LASER = 0;
const TURRET_MISSILE = 1;

// Where state.loadouts keeps the two turret loadouts, after the three unit
// kinds and the carrier.
const LOADOUT_TURRET_LASER = 4;
const LOADOUT_TURRET_MISSILE = 5;

const QUARTER = 16384;

// Guns go on a ring around the command node, one per quarter, so wherever a
// strike comes in from it is met by something.
function turretPlace(island, index, ringPermil) {
  const reach = mulDiv(island.radius, ringPermil, 1000);
  const bearing = (index * QUARTER) & 65535;
  const x = island.nodeX + mulCos(reach, bearing);
  const y = island.nodeY + mulSin(reach, bearing);
  const ground = islandHeightAt(island, x, y);
  return { x: x, y: y, z: ground > 0 ? ground : 0 };
}

function createTurret(state, island, index, params, weapons, loadouts, arms) {
  const kind = index % 2 === 0 ? TURRET_LASER : TURRET_MISSILE;
  const spot = turretPlace(island, index, params.turretRing);
  return {
    id: state.nextTurret,
    island: island.id,
    team: island.owner,
    kind: kind,
    x: spot.x,
    y: spot.y,
    z: spot.z,
    hp: params.turretHull,
    maxHp: params.turretHull,
    arms: arms,
    weapon: arms.length > 0 ? arms[0].w : -1,
    cooldown: 0,
    heat: 0,
    heatAccum: 0,
    overheated: 0,
  };
}

function copyTurret(turret) {
  const arms = [];
  for (let i = 0; i < turret.arms.length; i++) {
    arms.push({ w: turret.arms[i].w, n: turret.arms[i].n });
  }
  return {
    id: turret.id,
    island: turret.island,
    team: turret.team,
    kind: turret.kind,
    x: turret.x,
    y: turret.y,
    z: turret.z,
    hp: turret.hp,
    maxHp: turret.maxHp,
    arms: arms,
    weapon: turret.weapon,
    cooldown: turret.cooldown,
    heat: turret.heat,
    heatAccum: turret.heatAccum,
    overheated: turret.overheated,
  };
}

function turretsOn(state, islandId) {
  let count = 0;
  for (let i = 0; i < state.turrets.length; i++) {
    if (state.turrets[i].island === islandId) count = count + 1;
  }
  return count;
}

function loadoutForTurret(kind) {
  return kind === TURRET_MISSILE ? LOADOUT_TURRET_MISSILE : LOADOUT_TURRET_LASER;
}

function alive(turret) {
  return turret.hp > 0;
}

// Everything an island's guns are: removed when it changes hands, and when the
// last of them is shot away.
function clearTurretsOn(state, islandId) {
  const kept = [];
  for (let i = 0; i < state.turrets.length; i++) {
    if (state.turrets[i].island !== islandId) kept.push(state.turrets[i]);
  }
  state.turrets = kept;
}

// Drop the wreckage. Done once a tick rather than at the moment of the killing
// hit, so a shot resolving against a list is never removing from it.
function sweepTurrets(state) {
  let lost = 0;
  const kept = [];
  for (let i = 0; i < state.turrets.length; i++) {
    const turret = state.turrets[i];
    if (alive(turret)) {
      kept.push(turret);
      continue;
    }
    pushEvent(state.events, EVT_TURRET_LOST, turret.id, turret.team, turret.island);
    lost = lost + 1;
  }
  if (lost > 0) state.turrets = kept;
  return lost;
}

function copyTurrets(turrets) {
  const out = [];
  for (let i = 0; i < turrets.length; i++) out.push(copyTurret(turrets[i]));
  return out;
}

export {
  TURRET_LASER,
  TURRET_MISSILE,
  LOADOUT_TURRET_LASER,
  LOADOUT_TURRET_MISSILE,
  turretPlace,
  createTurret,
  copyTurret,
  copyTurrets,
  turretsOn,
  loadoutForTurret,
  alive,
  clearTurretsOn,
  sweepTurrets,
};
