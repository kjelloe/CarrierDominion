// engine/shots.js - what happens after the trigger.
//
// A shot is an entity with a life, not an instant line-of-fire test. It flies,
// it can miss, and it can be outrun - which is what makes a Manta's speed worth
// something and a lighter's slowness dangerous.
//
// Hit tests are against the SEGMENT travelled this tick, never the endpoint: a
// missile covers 15 m in a tick and a Manta is 12 m across, so an endpoint test
// would let rounds tunnel straight through their targets.
//
// Three kinds of round go through here and the differences are all data:
//   guided    re-aims at its target every tick, within a turn rate
//   splash    damages everything inside the blast, not only what it struck
//   trigger   a mine: it does not fly, it waits, and it goes off for whoever
//             walks into it

import { clampI, floorDiv, isqrt, mulDiv, turnToward } from '../shared/fixed.js';
import { atan2B, mulCos, mulSin } from '../shared/trig.js';
import {
  EVT_CARRIER_DAMAGED,
  EVT_CARRIER_SUNK,
  EVT_SHOT_FIRED,
  EVT_UNIT_HIT,
  EVT_UNIT_LOST,
  pushEvent,
} from './events.js';
import { UNIT_LOST, unitEngageable } from './units.js';
import { armourMultiplierPermil, damageSection, sectionAt } from './damage.js';
import { SCORE_CARRIER, SCORE_KILL, addScore } from './score.js';

// What a shot is chasing, so a guided round can be re-aimed at the right list.
const TARGET_UNIT = 0;
const TARGET_CARRIER = 1;
const TARGET_TURRET = 2;

function copyShot(shot) {
  return {
    id: shot.id,
    team: shot.team,
    weapon: shot.weapon,
    x: shot.x,
    y: shot.y,
    z: shot.z,
    heading: shot.heading,
    climb: shot.climb,
    speed: shot.speed,
    damage: shot.damage,
    blast: shot.blast,
    life: shot.life,
    guided: shot.guided,
    splash: shot.splash,
    trigger: shot.trigger,
    turn: shot.turn,
    targetKind: shot.targetKind,
    targetId: shot.targetId,
  };
}

// 3D squared distance. Coordinates reach ~8e6 units on the biggest map, so a
// squared term is ~6.4e13 and three of them stay well inside 2^53.
function distSq3D(ax, ay, az, bx, by, bz) {
  const dx = ax - bx;
  const dy = ay - by;
  const dz = az - bz;
  return dx * dx + dy * dy + dz * dz;
}

// Closest approach of a point to the segment a->b, squared. Integer only: the
// parameter is kept as a numerator/denominator pair rather than a fraction.
function segmentDistSq(ax, ay, az, bx, by, bz, px, py, pz) {
  const abx = bx - ax;
  const aby = by - ay;
  const abz = bz - az;
  const den = abx * abx + aby * aby + abz * abz;
  if (den === 0) return distSq3D(ax, ay, az, px, py, pz);
  const num = (px - ax) * abx + (py - ay) * aby + (pz - az) * abz;
  if (num <= 0) return distSq3D(ax, ay, az, px, py, pz);
  if (num >= den) return distSq3D(bx, by, bz, px, py, pz);
  return distSq3D(
    ax + mulDiv(abx, num, den),
    ay + mulDiv(aby, num, den),
    az + mulDiv(abz, num, den),
    px,
    py,
    pz,
  );
}

// Vertical rate that arrives at the target's altitude at about the same time as
// the horizontal run does. Clamped so a shot never climbs faster than it flies.
function climbFor(z, targetZ, groundRange, speed) {
  const ticks = speed > 0 ? floorDiv(groundRange, speed) : 0;
  if (ticks < 1) return clampI(targetZ - z, -speed, speed);
  return clampI(floorDiv(targetZ - z, ticks), -speed, speed);
}

function launchShot(state, team, x, y, z, weaponId, weapon, target) {
  const dx = target.x - x;
  const dy = target.y - y;
  const ground = isqrt(dx * dx + dy * dy);
  const shot = {
    id: state.nextShot,
    team: team,
    weapon: weaponId,
    x: x,
    y: y,
    z: z,
    heading: weapon.speed > 0 ? atan2B(dy, dx) : 0,
    climb: weapon.speed > 0 ? climbFor(z, target.z, ground, weapon.speed) : 0,
    speed: weapon.speed,
    damage: weapon.damage,
    blast: weapon.blast,
    life: weapon.life,
    guided: weapon.guided,
    splash: weapon.splash,
    trigger: weapon.trigger,
    turn: weapon.turn,
    // An unguided round is aimed where the target WAS. It keeps the target id
    // anyway, purely so the client can draw a tracer that means something.
    targetKind: target.kind,
    targetId: target.id,
  };
  state.nextShot = state.nextShot + 1;
  state.shots.push(shot);
  pushEvent(state.events, EVT_SHOT_FIRED, shot.id, team, target.id);
  return shot;
}

function findTargetPosition(state, shot) {
  if (shot.targetKind === TARGET_CARRIER) {
    for (let i = 0; i < state.carriers.length; i++) {
      const carrier = state.carriers[i];
      if (carrier.id === shot.targetId && carrier.hull > 0) {
        return { x: carrier.x, y: carrier.y, z: 0 };
      }
    }
    return -1;
  }
  for (let i = 0; i < state.units.length; i++) {
    const unit = state.units[i];
    if (unit.id === shot.targetId && unitEngageable(unit)) {
      return { x: unit.x, y: unit.y, z: unit.z };
    }
  }
  return -1;
}

// A guided round re-aims every tick, within its turn rate. When its target is
// gone it keeps its last heading and flies on until its life runs out, which is
// both simpler and more honest than deleting it mid-air.
function guide(state, shot) {
  if (shot.guided !== 1) return;
  const target = findTargetPosition(state, shot);
  if (target === -1) return;
  const dx = target.x - shot.x;
  const dy = target.y - shot.y;
  shot.heading = turnToward(shot.heading, atan2B(dy, dx), shot.turn);
  shot.climb = climbFor(shot.z, target.z, isqrt(dx * dx + dy * dy), shot.speed);
}

function hitUnit(state, unit, damage, byTeam) {
  unit.hp = unit.hp - damage;
  pushEvent(state.events, EVT_UNIT_HIT, unit.id, unit.team, damage);
  if (unit.hp > 0) return;
  unit.hp = 0;
  unit.state = UNIT_LOST;
  unit.speed = 0;
  unit.throttle = 0;
  unit.control = -1;
  pushEvent(state.events, EVT_UNIT_LOST, unit.id, unit.team, 0);
  addScore(state, byTeam, state.params.pointsPerKill, SCORE_KILL);
}

// A hit costs the hull its full damage and the section it landed on a share of
// it (ruling #19). The two are tracked apart because they are different kinds
// of trouble: one sinks you, the other stops you doing your job.
function hitCarrier(state, carrier, damage, x, y, z, byTeam) {
  const section = sectionAt(carrier, x, y, z);
  // Armour is read BEFORE the section takes this hit: the plating that was
  // there when the round arrived is what absorbed it.
  const through = mulDiv(damage, armourMultiplierPermil(carrier, section), 1000);
  damageSection(carrier, section, mulDiv(damage, carrier.sectionDamagePermil, 1000));
  const before = carrier.hull;
  carrier.hull = carrier.hull - through;
  if (carrier.hull < 0) carrier.hull = 0;
  pushEvent(state.events, EVT_CARRIER_DAMAGED, carrier.id, carrier.team, before - carrier.hull);
  if (carrier.hull === 0 && before > 0) {
    pushEvent(state.events, EVT_CARRIER_SUNK, carrier.id, carrier.team, 0);
    addScore(state, byTeam, state.params.pointsPerCarrier, SCORE_CARRIER);
  }
}

// The nearest thing the shot passed close enough to this tick, or -1.
//
// A round with a small blast uses it as a proximity fuze - it goes off near
// enough. A SPLASH round must actually strike: its blast is 70-120 m, and
// fuzing on that would detonate a bomb a hundred metres short of the target,
// which then misses everything standing behind it. The blast is what it
// damages, not what sets it off.
function findHit(state, shot, nx, ny, nz, params) {
  let best = -1;
  let bestDistance = 2147483647;
  const fuze = shot.splash === 1 ? 0 : shot.blast;
  const unitReach = fuze + params.hitRadiusUnit;
  const carrierReach = fuze + params.hitRadiusCarrier;
  const turretReach = fuze + params.hitRadiusTurret;
  for (let i = 0; i < state.carriers.length; i++) {
    const carrier = state.carriers[i];
    if (carrier.team === shot.team || carrier.hull <= 0) continue;
    const distance = segmentDistSq(shot.x, shot.y, shot.z, nx, ny, nz, carrier.x, carrier.y, 0);
    if (distance > carrierReach * carrierReach || distance >= bestDistance) continue;
    bestDistance = distance;
    best = { kind: TARGET_CARRIER, index: i };
  }
  for (let i = 0; i < state.units.length; i++) {
    const unit = state.units[i];
    if (unit.team === shot.team || !unitEngageable(unit)) continue;
    const distance = segmentDistSq(shot.x, shot.y, shot.z, nx, ny, nz, unit.x, unit.y, unit.z);
    if (distance > unitReach * unitReach || distance >= bestDistance) continue;
    bestDistance = distance;
    best = { kind: TARGET_UNIT, index: i };
  }
  for (let i = 0; i < state.turrets.length; i++) {
    const turret = state.turrets[i];
    if (turret.team === shot.team || turret.hp <= 0) continue;
    const distance = segmentDistSq(
      shot.x, shot.y, shot.z, nx, ny, nz, turret.x, turret.y, turret.z,
    );
    if (distance > turretReach * turretReach || distance >= bestDistance) continue;
    bestDistance = distance;
    best = { kind: TARGET_TURRET, index: i };
  }
  return best;
}

// A turret takes damage like anything else; the sweep in turret.js clears the
// wreck at the end of the tick.
function hitTurret(state, turret, damage, byTeam) {
  turret.hp = turret.hp - damage;
  if (turret.hp < 0) turret.hp = 0;
  pushEvent(state.events, EVT_UNIT_HIT, turret.id, turret.team, damage);
  if (turret.hp === 0) addScore(state, byTeam, state.params.pointsPerKill, SCORE_KILL);
}

// A cluster bomb, a napalm canister or a mine going off: everything hostile
// inside the blast takes it, not only whatever tripped it.
function detonate(state, shot, x, y, z, params) {
  const unitReach = shot.blast + params.hitRadiusUnit;
  const carrierReach = shot.blast + params.hitRadiusCarrier;
  const turretReach = shot.blast + params.hitRadiusTurret;
  for (let i = 0; i < state.carriers.length; i++) {
    const carrier = state.carriers[i];
    if (carrier.team === shot.team || carrier.hull <= 0) continue;
    if (distSq3D(x, y, z, carrier.x, carrier.y, 0) > carrierReach * carrierReach) continue;
    hitCarrier(state, carrier, shot.damage, x, y, z, shot.team);
  }
  for (let i = 0; i < state.units.length; i++) {
    const unit = state.units[i];
    if (unit.team === shot.team || !unitEngageable(unit)) continue;
    if (distSq3D(x, y, z, unit.x, unit.y, unit.z) > unitReach * unitReach) continue;
    hitUnit(state, unit, shot.damage, shot.team);
  }
  for (let i = 0; i < state.turrets.length; i++) {
    const turret = state.turrets[i];
    if (turret.team === shot.team || turret.hp <= 0) continue;
    if (distSq3D(x, y, z, turret.x, turret.y, turret.z) > turretReach * turretReach) continue;
    hitTurret(state, turret, shot.damage, shot.team);
  }
}

// A mine sits where it was laid until something that is not its owner comes
// close enough. Returns 1 when it went off.
function stepMine(state, shot, params) {
  const hit = findHit(state, shot, shot.x, shot.y, shot.z, params);
  if (hit === -1) return 0;
  detonate(state, shot, shot.x, shot.y, shot.z, params);
  return 1;
}

// Move every shot one tick, resolve what it hit, and keep the survivors. The
// array is rebuilt rather than spliced: removing from a list while walking it
// is the kind of thing that works until the day two shots land on one tick.
function stepShots(state, params) {
  const survivors = [];
  for (let i = 0; i < state.shots.length; i++) {
    const shot = state.shots[i];
    if (shot.trigger === 1) {
      if (stepMine(state, shot, params) === 1) continue;
      shot.life = shot.life - 1;
      if (shot.life > 0) survivors.push(shot);
      continue;
    }

    guide(state, shot);
    const nx = shot.x + mulCos(shot.speed, shot.heading);
    const ny = shot.y + mulSin(shot.speed, shot.heading);
    const nz = shot.z + shot.climb;
    const hit = findHit(state, shot, nx, ny, nz, params);
    if (hit !== -1) {
      if (shot.splash === 1) {
        detonate(state, shot, nx, ny, nz < 0 ? 0 : nz, params);
      } else if (hit.kind === TARGET_CARRIER) {
        hitCarrier(state, state.carriers[hit.index], shot.damage, nx, ny, nz, shot.team);
      } else if (hit.kind === TARGET_TURRET) {
        hitTurret(state, state.turrets[hit.index], shot.damage, shot.team);
      } else {
        hitUnit(state, state.units[hit.index], shot.damage, shot.team);
      }
      continue;
    }
    shot.x = nx;
    shot.y = ny;
    shot.z = nz < 0 ? 0 : nz;
    shot.life = shot.life - 1;
    // A splash round that reaches the end of its run goes off where it is: a
    // bomb that lands in the sand still throws sand.
    if (shot.life > 0) survivors.push(shot);
    else if (shot.splash === 1 && shot.trigger === 0) {
      detonate(state, shot, shot.x, shot.y, shot.z, params);
    }
  }
  state.shots = survivors;
}

export {
  TARGET_UNIT,
  TARGET_CARRIER,
  TARGET_TURRET,
  copyShot,
  distSq3D,
  segmentDistSq,
  climbFor,
  launchShot,
  guide,
  hitUnit,
  hitCarrier,
  hitTurret,
  findHit,
  detonate,
  stepMine,
  stepShots,
};
