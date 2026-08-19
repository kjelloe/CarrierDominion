// engine/weapons.js - shooting, and what a hit costs.
//
// Weapons are a per-KIND record held once in state.weapons, not copied onto
// every hull: a Manta's missile stats are the same for every Manta, and the
// only things that differ per unit are how many rounds are left and how long
// until the next one. Two integers per hull instead of eleven.
//
// A shot is an entity with a life, not an instant line-of-fire test. It flies,
// it can miss, and it can be outrun - which is what makes a Manta's speed worth
// something and a lighter's slowness dangerous. Hit tests are against the
// SEGMENT the shot travelled this tick, never the endpoint: a missile covers
// 15 m in a tick and a Manta is 12 m across, so an endpoint test would let
// shots tunnel straight through their targets.

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
import { KIND_MANTA, UNIT_ACTIVE, UNIT_LOST, UNIT_RETURNING } from './units.js';

// Where a weapon record lives in state.weapons. The first three are the unit
// KIND_* values on purpose, so a unit's weapon is state.weapons[unit.kind].
const WEAPON_CARRIER = 3;

// What a shot is chasing, so a guided round can be re-aimed at the right list.
const TARGET_UNIT = 0;
const TARGET_CARRIER = 1;

function weaponFrom(stats, unitsPerMetre) {
  const range = stats.rangeMetres * unitsPerMetre;
  const speed = stats.speedUnitsPerTick;
  return {
    range: range,
    damage: stats.damage,
    cooldown: stats.cooldownTicks,
    magazine: stats.magazine,
    speed: speed,
    turn: stats.turnRateBamPerTick,
    blast: stats.blastRadiusMetres * unitsPerMetre,
    // A shot lives exactly as long as its range allows. Unarmed kinds get 0,
    // which is also what stops them ever firing.
    life: speed > 0 ? floorDiv(range, speed) : 0,
    hitsAir: stats.hitsAir,
    hitsSurface: stats.hitsSurface,
    guided: stats.guided,
    ordnancePerRound: stats.ordnancePerRound,
  };
}

function createWeapons(rulesWeapons, unitsPerMetre) {
  return [
    weaponFrom(rulesWeapons.manta, unitsPerMetre),
    weaponFrom(rulesWeapons.walrus, unitsPerMetre),
    weaponFrom(rulesWeapons.lighter, unitsPerMetre),
    weaponFrom(rulesWeapons.carrier, unitsPerMetre),
  ];
}

function copyWeapon(weapon) {
  return {
    range: weapon.range,
    damage: weapon.damage,
    cooldown: weapon.cooldown,
    magazine: weapon.magazine,
    speed: weapon.speed,
    turn: weapon.turn,
    blast: weapon.blast,
    life: weapon.life,
    hitsAir: weapon.hitsAir,
    hitsSurface: weapon.hitsSurface,
    guided: weapon.guided,
    ordnancePerRound: weapon.ordnancePerRound,
  };
}

function copyWeapons(weapons) {
  const out = [];
  for (let i = 0; i < weapons.length; i++) out.push(copyWeapon(weapons[i]));
  return out;
}

function copyShot(shot) {
  return {
    id: shot.id,
    team: shot.team,
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
    turn: shot.turn,
    targetKind: shot.targetKind,
    targetId: shot.targetId,
  };
}

function isAir(kind) {
  return kind === KIND_MANTA;
}

function unitEngageable(unit) {
  if (unit.hp <= 0) return false;
  return unit.state === UNIT_ACTIVE || unit.state === UNIT_RETURNING;
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

// The nearest thing this weapon may shoot at, as { kind, id, x, y, z }, or -1.
// Enemy hulls only, inside weapon range, and only classes the weapon can
// engage - a Walrus gun cannot elevate onto a Manta.
function pickTarget(state, team, x, y, z, weapon) {
  if (weapon.range <= 0) return -1;
  const reach = weapon.range * weapon.range;
  let best = -1;
  let bestDistance = reach + 1;
  for (let i = 0; i < state.carriers.length; i++) {
    const carrier = state.carriers[i];
    if (carrier.team === team || carrier.hull <= 0) continue;
    if (weapon.hitsSurface !== 1) continue;
    const distance = distSq3D(x, y, z, carrier.x, carrier.y, 0);
    if (distance > reach || distance >= bestDistance) continue;
    bestDistance = distance;
    best = { kind: TARGET_CARRIER, id: carrier.id, x: carrier.x, y: carrier.y, z: 0 };
  }
  for (let i = 0; i < state.units.length; i++) {
    const unit = state.units[i];
    if (unit.team === team || !unitEngageable(unit)) continue;
    const wanted = isAir(unit.kind) ? weapon.hitsAir : weapon.hitsSurface;
    if (wanted !== 1) continue;
    const distance = distSq3D(x, y, z, unit.x, unit.y, unit.z);
    if (distance > reach || distance >= bestDistance) continue;
    bestDistance = distance;
    best = { kind: TARGET_UNIT, id: unit.id, x: unit.x, y: unit.y, z: unit.z };
  }
  return best;
}

// Vertical rate that arrives at the target's altitude at about the same time as
// the horizontal run does. Clamped so a shot never climbs faster than it flies.
function climbFor(z, targetZ, groundRange, speed) {
  const ticks = speed > 0 ? floorDiv(groundRange, speed) : 0;
  if (ticks < 1) return clampI(targetZ - z, -speed, speed);
  return clampI(floorDiv(targetZ - z, ticks), -speed, speed);
}

function launchShot(state, team, x, y, z, weapon, target) {
  const dx = target.x - x;
  const dy = target.y - y;
  const ground = isqrt(dx * dx + dy * dy);
  const shot = {
    id: state.nextShot,
    team: team,
    x: x,
    y: y,
    z: z,
    heading: atan2B(dy, dx),
    climb: climbFor(z, target.z, ground, weapon.speed),
    speed: weapon.speed,
    damage: weapon.damage,
    blast: weapon.blast,
    life: weapon.life,
    guided: weapon.guided,
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

// Ruling #18: a Manta does not shoot by itself. Somebody flies it - the player
// under direct control, or the AI agent that launched it - and that somebody
// pulls the trigger. Everything else defends itself: a ship's point defence
// and a Walrus gun engage on their own, because nobody asks a close-in mount
// for permission.
function needsTrigger(kind) {
  return kind === KIND_MANTA;
}

// Cooling down is not the same as choosing to shoot, and separating them is
// the whole reason this is its own function: a trigger-fired Manta that is
// never fired would otherwise never become ready again.
function coolDown(holder) {
  if (holder.cooldown > 0) holder.cooldown = holder.cooldown - 1;
  return holder.cooldown;
}

// One firing decision for one armed hull.
function serveWeapon(state, team, x, y, z, weapon, holder) {
  if (holder.cooldown > 0) return 0;
  if (holder.ammo <= 0 || weapon.magazine <= 0) return 0;
  const target = pickTarget(state, team, x, y, z, weapon);
  if (target === -1) return 0;
  launchShot(state, team, x, y, z, weapon, target);
  holder.ammo = holder.ammo - 1;
  holder.cooldown = weapon.cooldown;
  return 1;
}

function fireAll(state) {
  for (let i = 0; i < state.carriers.length; i++) {
    const carrier = state.carriers[i];
    if (carrier.hull <= 0) continue;
    const weapon = state.weapons[WEAPON_CARRIER];
    reloadCarrier(carrier, weapon);
    coolDown(carrier);
    serveWeapon(state, carrier.team, carrier.x, carrier.y, 0, weapon, carrier);
  }
  for (let i = 0; i < state.units.length; i++) {
    const unit = state.units[i];
    if (!unitEngageable(unit)) continue;
    coolDown(unit);
    if (needsTrigger(unit.kind)) continue;
    serveWeapon(state, unit.team, unit.x, unit.y, unit.z, state.weapons[unit.kind], unit);
  }
}

// Somebody pulled the trigger on this unit: the player flying it, or the AI
// agent that sent it. Returns 1 if a round left the rail - it is a miss, not an
// error, when there is nothing in range or the weapon is still cooling.
function fireUnit(state, unit) {
  if (!unitEngageable(unit)) return 0;
  return serveWeapon(state, unit.team, unit.x, unit.y, unit.z, state.weapons[unit.kind], unit);
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

function hitUnit(state, unit, damage) {
  unit.hp = unit.hp - damage;
  pushEvent(state.events, EVT_UNIT_HIT, unit.id, unit.team, damage);
  if (unit.hp > 0) return;
  unit.hp = 0;
  unit.state = UNIT_LOST;
  unit.speed = 0;
  unit.throttle = 0;
  unit.control = -1;
  pushEvent(state.events, EVT_UNIT_LOST, unit.id, unit.team, 0);
}

function hitCarrier(state, carrier, damage) {
  const before = carrier.hull;
  carrier.hull = carrier.hull - damage;
  if (carrier.hull < 0) carrier.hull = 0;
  pushEvent(state.events, EVT_CARRIER_DAMAGED, carrier.id, carrier.team, before - carrier.hull);
  if (carrier.hull === 0 && before > 0) {
    pushEvent(state.events, EVT_CARRIER_SUNK, carrier.id, carrier.team, 0);
  }
}

// Everything the shot passed within blast + body radius of this tick, nearest
// first. Returns -1 for a clean miss.
function findHit(state, shot, nx, ny, nz, hitUnitRadius, hitCarrierRadius) {
  let best = -1;
  let bestDistance = 2147483647;
  const unitReach = shot.blast + hitUnitRadius;
  const carrierReach = shot.blast + hitCarrierRadius;
  for (let i = 0; i < state.carriers.length; i++) {
    const carrier = state.carriers[i];
    if (carrier.team === shot.team || carrier.hull <= 0) continue;
    const distance = segmentDistSq(
      shot.x, shot.y, shot.z, nx, ny, nz, carrier.x, carrier.y, 0,
    );
    if (distance > carrierReach * carrierReach || distance >= bestDistance) continue;
    bestDistance = distance;
    best = { kind: TARGET_CARRIER, index: i };
  }
  for (let i = 0; i < state.units.length; i++) {
    const unit = state.units[i];
    if (unit.team === shot.team || !unitEngageable(unit)) continue;
    const distance = segmentDistSq(
      shot.x, shot.y, shot.z, nx, ny, nz, unit.x, unit.y, unit.z,
    );
    if (distance > unitReach * unitReach || distance >= bestDistance) continue;
    bestDistance = distance;
    best = { kind: TARGET_UNIT, index: i };
  }
  return best;
}

// Move every shot one tick, resolve what it hit, and keep the survivors. The
// array is rebuilt rather than spliced: removing from a list while walking it
// is the kind of thing that works until the day two shots land on one tick.
function stepShots(state, hitUnitRadius, hitCarrierRadius) {
  const survivors = [];
  for (let i = 0; i < state.shots.length; i++) {
    const shot = state.shots[i];
    guide(state, shot);
    const nx = shot.x + mulCos(shot.speed, shot.heading);
    const ny = shot.y + mulSin(shot.speed, shot.heading);
    const nz = shot.z + shot.climb;
    const hit = findHit(state, shot, nx, ny, nz, hitUnitRadius, hitCarrierRadius);
    if (hit !== -1) {
      if (hit.kind === TARGET_CARRIER) hitCarrier(state, state.carriers[hit.index], shot.damage);
      else hitUnit(state, state.units[hit.index], shot.damage);
      continue;
    }
    shot.x = nx;
    shot.y = ny;
    shot.z = nz < 0 ? 0 : nz;
    shot.life = shot.life - 1;
    if (shot.life > 0) survivors.push(shot);
  }
  state.shots = survivors;
}

function stepWeapons(state, hitUnitRadius, hitCarrierRadius) {
  fireAll(state);
  stepShots(state, hitUnitRadius, hitCarrierRadius);
}

// Called when a unit comes aboard. Rearming is a withdrawal from the ship's
// ordnance store, not a refill from nowhere (ruling #17): a Manta missile costs
// 25, a gun round costs 1, and a ship with an empty store sends its aircraft
// back up empty. Partial rearms are normal and deliberate - you take what there
// is rather than waiting for a full load.
function rearm(unit, weapons, carrier) {
  const weapon = weapons[unit.kind];
  unit.cooldown = 0;
  const wanted = weapon.magazine - unit.ammo;
  if (wanted <= 0) return unit;
  if (weapon.ordnancePerRound <= 0) {
    // Free to arm (or unarmed entirely): nothing to draw.
    unit.ammo = weapon.magazine;
    return unit;
  }
  const affordable = floorDiv(carrier.ordnance, weapon.ordnancePerRound);
  const rounds = affordable < wanted ? affordable : wanted;
  if (rounds <= 0) return unit;
  carrier.ordnance = carrier.ordnance - rounds * weapon.ordnancePerRound;
  unit.ammo = unit.ammo + rounds;
  return unit;
}

// The ready magazine is fed from the store continuously, at a fixed rate: a
// ship does not teleport shells to the mounts. Per 100 ticks so the rate can be
// a fraction of a round, exactly like fuel burn.
function reloadCarrier(carrier, weapon) {
  const wanted = weapon.magazine - carrier.ammo;
  if (wanted <= 0) {
    carrier.reloadAccum = 0;
    return 0;
  }
  const accum = carrier.reloadAccum + carrier.reloadRate;
  const due = floorDiv(accum, 100);
  carrier.reloadAccum = accum - due * 100;
  if (due <= 0) return 0;
  const rounds = due < wanted ? due : wanted;
  const perRound = weapon.ordnancePerRound;
  const affordable = perRound > 0 ? floorDiv(carrier.ordnance, perRound) : rounds;
  const taken = affordable < rounds ? affordable : rounds;
  if (taken <= 0) return 0;
  carrier.ordnance = carrier.ordnance - taken * perRound;
  carrier.ammo = carrier.ammo + taken;
  return taken;
}

export {
  WEAPON_CARRIER,
  TARGET_UNIT,
  TARGET_CARRIER,
  createWeapons,
  copyWeapons,
  copyShot,
  segmentDistSq,
  pickTarget,
  needsTrigger,
  coolDown,
  fireUnit,
  fireAll,
  stepShots,
  stepWeapons,
  hitUnit,
  hitCarrier,
  rearm,
  reloadCarrier,
};
