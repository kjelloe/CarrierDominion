// engine/targeting.js - who is being shot at, and who decided that.
//
// The 1988 original put the player in the targeting loop at three levels, and
// this module is all three (ruling 2026-08-20):
//
//   attack order   you designate an enemy, the autopilot closes and engages it
//   boresight      under direct control you AIM: the round goes down the nose,
//                  and a missile needs a lock inside the seeker cone
//   pointer mode   you click a target and the ship's laser prefers it
//
// The engine still picks a target when nobody has expressed a preference -
// that is what makes an unattended hull defend itself - but a preference always
// wins while it is valid.

import { angleDelta, dist2D } from '../shared/fixed.js';
import { atan2B, mulCos, mulSin } from '../shared/trig.js';
import { KIND_MANTA, unitEngageable } from './units.js';

const TARGET_UNIT = 0;
const TARGET_CARRIER = 1;

// How far off the nose a seeker will still lock. About 22 degrees either way:
// wide enough to be usable in a turning fight, narrow enough that pointing the
// aircraft is the skill.
const SEEKER_CONE = 4096;

// A designated target as { kind, id, x, y, z, air }, or -1 when it is gone,
// dead, or was never set. Callers treat -1 as "no preference" rather than as an
// error. `air` classifies by KIND, the same rule the rest of the engine uses -
// a Manta is an air target sitting on the water just as much as at cruise.
function designated(state, kind, id) {
  if (id < 0) return -1;
  if (kind === TARGET_CARRIER) {
    for (let i = 0; i < state.carriers.length; i++) {
      const carrier = state.carriers[i];
      if (carrier.id === id && carrier.hull > 0) {
        return { kind: TARGET_CARRIER, id: carrier.id, x: carrier.x, y: carrier.y, z: 0, air: 0 };
      }
    }
    return -1;
  }
  for (let i = 0; i < state.units.length; i++) {
    const unit = state.units[i];
    if (unit.id === id && unitEngageable(unit)) {
      return {
        kind: TARGET_UNIT,
        id: unit.id,
        x: unit.x,
        y: unit.y,
        z: unit.z,
        air: unit.kind === KIND_MANTA ? 1 : 0,
      };
    }
  }
  return -1;
}

// Is this thing something that weapon may engage, and is it hostile?
function engageable(weapon, team, targetTeam, isAirTarget) {
  if (targetTeam === team) return false;
  return (isAirTarget ? weapon.hitsAir : weapon.hitsSurface) === 1;
}

// The enemy closest to the nose, inside the seeker cone and inside range. This
// is what a missile locks onto when the player pulls the trigger: point the
// aircraft, get a lock, fire.
function lockOn(state, team, x, y, z, heading, weapon) {
  if (weapon.range <= 0) return -1;
  let best = -1;
  let bestOff = SEEKER_CONE + 1;
  for (let i = 0; i < state.carriers.length; i++) {
    const carrier = state.carriers[i];
    if (carrier.hull <= 0 || !engageable(weapon, team, carrier.team, false)) continue;
    if (dist2D(x, y, carrier.x, carrier.y) > weapon.range) continue;
    const off = angleDelta(heading, atan2B(carrier.y - y, carrier.x - x));
    const away = off < 0 ? -off : off;
    if (away > SEEKER_CONE || away >= bestOff) continue;
    bestOff = away;
    best = { kind: TARGET_CARRIER, id: carrier.id, x: carrier.x, y: carrier.y, z: 0 };
  }
  for (let i = 0; i < state.units.length; i++) {
    const unit = state.units[i];
    if (!unitEngageable(unit) || !engageable(weapon, team, unit.team, unit.kind === 0)) continue;
    if (dist2D(x, y, unit.x, unit.y) > weapon.range) continue;
    const off = angleDelta(heading, atan2B(unit.y - y, unit.x - x));
    const away = off < 0 ? -off : off;
    if (away > SEEKER_CONE || away >= bestOff) continue;
    bestOff = away;
    best = { kind: TARGET_UNIT, id: unit.id, x: unit.x, y: unit.y, z: unit.z };
  }
  return best;
}

// Where an unguided round goes when the player fires: straight down the nose,
// out to the weapon's range. Whether it hits is then a question for the flight,
// not for a lookup - which is the whole point of aiming.
function boresight(x, y, z, heading, weapon) {
  return {
    kind: TARGET_UNIT,
    id: -1,
    x: x + mulCos(weapon.range, heading),
    y: y + mulSin(weapon.range, heading),
    z: z,
  };
}

// What this hull is shooting at, in order of who asked for it:
//   1. the pilot, aiming - boresight for a gun, a lock for a missile
//   2. an attack order, while its target lives
//   3. nothing in particular, so the engine picks the nearest
// Returns -1 for "do not fire".
function aimFor(state, unit, weapon, fallback) {
  if (unit.control !== -1) {
    if (weapon.guided === 1) return lockOn(state, unit.team, unit.x, unit.y, unit.z, unit.heading, weapon);
    return boresight(unit.x, unit.y, unit.z, unit.heading, weapon);
  }
  const ordered = designated(state, unit.orderTargetKind, unit.orderTargetId);
  if (ordered !== -1) {
    const isAir = ordered.air === 1;
    if (engageable(weapon, unit.team, -1, isAir) && dist2D(unit.x, unit.y, ordered.x, ordered.y) <= weapon.range) {
      return ordered;
    }
  }
  return fallback;
}

// The ship's laser in pointer mode: the target the player clicked, while it is
// alive and in range, otherwise whatever the mount would have chosen anyway.
function carrierAim(state, carrier, weapon, fallback) {
  const pointed = designated(state, carrier.aimKind, carrier.aimId);
  if (pointed === -1) return fallback;
  if (dist2D(carrier.x, carrier.y, pointed.x, pointed.y) > weapon.range) return fallback;
  return pointed;
}

export {
  TARGET_UNIT,
  TARGET_CARRIER,
  SEEKER_CONE,
  designated,
  lockOn,
  boresight,
  aimFor,
  carrierAim,
};
