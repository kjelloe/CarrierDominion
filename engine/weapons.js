// engine/weapons.js - what a hull carries, and when it decides to use it.
//
// Weapon records live once in state.weapons, indexed by weapon id, and
// state.loadouts says which ids each hull kind carries. A hull keeps only what
// differs between two identical airframes: which weapon is selected, how many
// rounds of each it has left, how long until the next shot, and how hot the
// mount is. Everything else is looked up.
//
// The 1988 sets (ruling 2026-08-20): a Manta cycles laser, cluster bomb,
// napalm and missile; a Walrus cannon and mines; the carrier its 360-degree
// laser. Flight and damage are in shots.js - this module stops at the trigger.

import { floorDiv, mulDiv } from '../shared/fixed.js';
import { KIND_DRONE, KIND_MANTA, copyArms, unitEngageable } from './units.js';
import { gunCooldown } from './damage.js';
import { sweepTurrets } from './turret.js';
import { launchShot, stepShots, TARGET_CARRIER, TARGET_TURRET, TARGET_UNIT } from './shots.js';
import { aimFor, carrierAim } from './targeting.js';

// Where the carrier's loadout sits in state.loadouts. The first three entries
// are the unit KIND_* values on purpose, so a unit's loadout is
// state.loadouts[unit.kind].
const LOADOUT_CARRIER = 3;

function weaponFrom(stats, unitsPerMetre) {
  const range = stats.rangeMetres * unitsPerMetre;
  const speed = stats.speedUnitsPerTick;
  // A round lives exactly as long as its range allows. A mine does not fly, so
  // its life is stated outright instead.
  let life = 0;
  if (stats.trigger === 1) life = stats.lifeTicks;
  else if (speed > 0) life = floorDiv(range, speed);
  return {
    range: range,
    damage: stats.damage,
    cooldown: stats.cooldownTicks,
    magazine: stats.magazine,
    speed: speed,
    turn: stats.turnRateBamPerTick,
    blast: stats.blastRadiusMetres * unitsPerMetre,
    life: life,
    hitsAir: stats.hitsAir,
    hitsSurface: stats.hitsSurface,
    guided: stats.guided,
    splash: stats.splash,
    trigger: stats.trigger,
    heatPerShot: stats.heatPerShot,
    heatMax: stats.heatMax,
    heatCool: stats.heatCoolPer100Ticks,
    heatReady: stats.heatReadyPermil,
    ordnancePerRound: stats.ordnancePerRound,
  };
}

function createWeapons(rulesWeapons, unitsPerMetre) {
  const out = [];
  for (let i = 0; i < rulesWeapons.list.length; i++) {
    out.push(weaponFrom(rulesWeapons.list[i], unitsPerMetre));
  }
  return out;
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
    splash: weapon.splash,
    trigger: weapon.trigger,
    heatPerShot: weapon.heatPerShot,
    heatMax: weapon.heatMax,
    heatCool: weapon.heatCool,
    heatReady: weapon.heatReady,
    ordnancePerRound: weapon.ordnancePerRound,
  };
}

function copyWeapons(weapons) {
  const out = [];
  for (let i = 0; i < weapons.length; i++) out.push(copyWeapon(weapons[i]));
  return out;
}

// Indexed so that state.loadouts[unit.kind] is a unit's loadout, with the
// carrier and then the two turret types after the three unit kinds.
function createLoadouts(rulesWeapons) {
  const source = rulesWeapons.loadouts;
  const rows = [
    source.manta,
    source.walrus,
    source.lighter,
    source.carrier,
    source.turretLaser,
    source.turretMissile,
    // Row 6: the Bat Cave's interceptor (ruled 2026-08-25).
    source.interceptor === undefined ? [] : source.interceptor,
  ];
  const out = [];
  for (let i = 0; i < rows.length; i++) {
    const row = [];
    for (let j = 0; j < rows[i].length; j++) row.push(rows[i][j]);
    out.push(row);
  }
  return out;
}

function copyLoadouts(loadouts) {
  const out = [];
  for (let i = 0; i < loadouts.length; i++) {
    const row = [];
    for (let j = 0; j < loadouts[i].length; j++) row.push(loadouts[i][j]);
    out.push(row);
  }
  return out;
}

// A hull's magazines: one entry per weapon it carries, full at build time.
function createArms(loadout, weapons) {
  const out = [];
  for (let i = 0; i < loadout.length; i++) {
    const id = loadout[i];
    out.push({ w: id, n: weapons[id].magazine });
  }
  return out;
}

function armEntry(holder, weaponId) {
  for (let i = 0; i < holder.arms.length; i++) {
    if (holder.arms[i].w === weaponId) return holder.arms[i];
  }
  return -1;
}

function roundsOf(holder, weaponId) {
  const entry = armEntry(holder, weaponId);
  return entry === -1 ? 0 : entry.n;
}

// Cycle to the next weapon this hull carries. Selecting is free and instant -
// what it costs you is the shot you did not take while you were deciding.
function selectWeapon(holder, weaponId) {
  if (armEntry(holder, weaponId) === -1) return 0;
  holder.weapon = weaponId;
  return 1;
}

function nextWeapon(holder) {
  if (holder.arms.length === 0) return -1;
  let index = 0;
  for (let i = 0; i < holder.arms.length; i++) {
    if (holder.arms[i].w === holder.weapon) index = i;
  }
  return holder.arms[(index + 1) % holder.arms.length].w;
}

// Heat, for the mounts that have it. A laser fired in bursts is fine; a laser
// held down goes out until it has cooled to its ready line - which is the
// original's rule, and the reason burst discipline is a skill.
function coolHeat(holder, weapon) {
  if (weapon.heatMax <= 0) {
    holder.heat = 0;
    holder.heatAccum = 0;
    holder.overheated = 0;
    return;
  }
  const accum = holder.heatAccum + weapon.heatCool;
  const shed = floorDiv(accum, 100);
  holder.heatAccum = accum - shed * 100;
  holder.heat = holder.heat - shed;
  if (holder.heat < 0) holder.heat = 0;
  if (holder.overheated === 1 && holder.heat <= mulDiv(weapon.heatMax, weapon.heatReady, 1000)) {
    holder.overheated = 0;
  }
}

function addHeat(holder, weapon) {
  if (weapon.heatMax <= 0) return;
  holder.heat = holder.heat + weapon.heatPerShot;
  if (holder.heat < weapon.heatMax) return;
  holder.heat = weapon.heatMax;
  holder.overheated = 1;
}

function isAir(kind) {
  return kind === KIND_MANTA || kind === KIND_DRONE;
}

function distSq(ax, ay, az, bx, by, bz) {
  const dx = ax - bx;
  const dy = ay - by;
  const dz = az - bz;
  return dx * dx + dy * dy + dz * dz;
}

// The nearest thing this weapon may shoot at, as { kind, id, x, y, z }, or -1.
// Enemy hulls only, inside weapon range, and only classes it can engage.
// Turrets count on both sides of that: they shoot, and they are shot at.
function pickTarget(state, team, x, y, z, weapon) {
  if (weapon.range <= 0) return -1;
  const reach = weapon.range * weapon.range;
  let best = -1;
  let bestDistance = reach + 1;
  for (let i = 0; i < state.carriers.length; i++) {
    const carrier = state.carriers[i];
    if (carrier.team === team || carrier.hull <= 0) continue;
    if (weapon.hitsSurface !== 1) continue;
    const distance = distSq(x, y, z, carrier.x, carrier.y, 0);
    if (distance > reach || distance >= bestDistance) continue;
    bestDistance = distance;
    best = { kind: TARGET_CARRIER, id: carrier.id, x: carrier.x, y: carrier.y, z: 0 };
  }
  for (let i = 0; i < state.units.length; i++) {
    const unit = state.units[i];
    if (unit.team === team || !unitEngageable(unit)) continue;
    const wanted = isAir(unit.kind) ? weapon.hitsAir : weapon.hitsSurface;
    if (wanted !== 1) continue;
    const distance = distSq(x, y, z, unit.x, unit.y, unit.z);
    if (distance > reach || distance >= bestDistance) continue;
    bestDistance = distance;
    best = { kind: TARGET_UNIT, id: unit.id, x: unit.x, y: unit.y, z: unit.z };
  }
  for (let i = 0; i < state.turrets.length; i++) {
    const turret = state.turrets[i];
    if (turret.team === team || turret.hp <= 0) continue;
    if (weapon.hitsSurface !== 1) continue;
    const distance = distSq(x, y, z, turret.x, turret.y, turret.z);
    if (distance > reach || distance >= bestDistance) continue;
    bestDistance = distance;
    best = { kind: TARGET_TURRET, id: turret.id, x: turret.x, y: turret.y, z: turret.z };
  }
  return best;
}

// Who waits for a trigger, and who shoots on its own.
//
// Ruling #18 put a pilot behind every Manta missile; the follow-up said an
// autopilot Manta does BOTH - it defends itself and it presses the attack it
// was sent on. So the line is not the airframe, it is the cockpit. A ship's
// laser and a Walrus cannon never wait: nobody asks a close-in mount for
// permission.
function needsTrigger(unit) {
  return unit.kind === KIND_MANTA && unit.control !== -1;
}

// The mount that heats is the mount that cools. Heat lives on the HULL, so
// cooling must follow the hull's heat-capable weapon, never the selected one:
// cooling with the selection let a pilot clear an overheated laser instantly by
// cycling to the cluster bomb (heatMax 0 zeroes the accumulator) and back.
function heatWeaponOf(state, holder) {
  for (let i = 0; i < holder.arms.length; i++) {
    const weapon = state.weapons[holder.arms[i].w];
    if (weapon !== undefined && weapon.heatMax > 0) return weapon;
  }
  return -1;
}

// Cooling down is not the same as choosing to shoot, and separating them is the
// whole reason this is its own function: a trigger-fired Manta that is never
// fired would otherwise never become ready again.
function coolDown(state, holder) {
  if (holder.cooldown > 0) holder.cooldown = holder.cooldown - 1;
  const mount = heatWeaponOf(state, holder);
  if (mount === -1) {
    // No heat-capable mount aboard: the accumulator has nothing to hold.
    holder.heat = 0;
    holder.heatAccum = 0;
    holder.overheated = 0;
  } else {
    coolHeat(holder, mount);
  }
  return holder.cooldown;
}

// One firing decision for one armed hull. `cooldownOverride` is how a damaged
// carrier mount fires more slowly than an undamaged one; `aim` is a target the
// caller has already decided on, for the cases where somebody is aiming.
function serveWeapon(state, team, x, y, z, holder, cooldownOverride, aim) {
  if (holder.cooldown > 0 || holder.overheated === 1) return 0;
  const weapon = state.weapons[holder.weapon];
  if (weapon === undefined) return 0;
  const entry = armEntry(holder, holder.weapon);
  if (entry === -1 || entry.n <= 0) return 0;

  // A mine is laid where the layer stands; everything else needs something to
  // aim at first.
  let target = -1;
  if (weapon.trigger === 1) target = { kind: TARGET_UNIT, id: -1, x: x, y: y, z: z };
  else if (aim !== undefined) target = aim;
  else target = pickTarget(state, team, x, y, z, weapon);
  if (target === -1) return 0;

  launchShot(state, team, x, y, z, holder.weapon, weapon, target);
  entry.n = entry.n - 1;
  holder.cooldown = cooldownOverride > 0 ? cooldownOverride : weapon.cooldown;
  addHeat(holder, weapon);
  return 1;
}

// A turret is a hull that cannot move, so it needs no aim rules and no trigger
// question: it defends its island.
function fireTurrets(state) {
  for (let i = 0; i < state.turrets.length; i++) {
    const turret = state.turrets[i];
    if (turret.hp <= 0 || turret.arms.length === 0) continue;
    coolDown(state, turret);
    serveWeapon(state, turret.team, turret.x, turret.y, turret.z, turret, 0);
  }
}

function fireAll(state) {
  for (let i = 0; i < state.carriers.length; i++) {
    const carrier = state.carriers[i];
    if (carrier.hull <= 0) continue;
    const weapon = state.weapons[carrier.weapon];
    reloadCarrier(carrier, weapon);
    coolDown(state, carrier);
    // A chewed-up mount fires slowly and a destroyed one not at all. The
    // point-defence upgrade quickens the healthy base rate.
    const baseCooldown = carrier.upPd === 1 ? carrier.pdCooldownUpgraded : weapon.cooldown;
    const cooldown = gunCooldown(carrier, baseCooldown);
    if (cooldown < 0) continue;
    // Pointer mode: the target the player clicked comes first, while it lives
    // and is in reach.
    const nearest = pickTarget(state, carrier.team, carrier.x, carrier.y, 0, weapon);
    const aim = carrierAim(state, carrier, weapon, nearest);
    serveWeapon(state, carrier.team, carrier.x, carrier.y, 0, carrier, cooldown, aim);
  }
  for (let i = 0; i < state.units.length; i++) {
    const unit = state.units[i];
    if (unit.arms.length === 0) continue;
    if (!unitEngageable(unit)) continue;
    const selected = state.weapons[unit.weapon];
    coolDown(state, unit);
    if (needsTrigger(unit)) continue;
    // A mine is laid deliberately, like the ACCB pod - never by an autopilot
    // that happens to be carrying some. Otherwise a Walrus with mines selected
    // seeds the whole beach on its way past.
    if (selected.trigger === 1) continue;
    const nearest = pickTarget(state, unit.team, unit.x, unit.y, unit.z, selected);
    serveWeapon(state, unit.team, unit.x, unit.y, unit.z, unit, 0, aimFor(state, unit, selected, nearest));
  }
}

// Somebody pulled the trigger: the player flying it, or the AI agent that sent
// it. Returns 1 if a round left the rail - it is a miss, not an error, when
// there is nothing in range, the mount is cooling, or it has overheated.
function fireUnit(state, unit) {
  if (!unitEngageable(unit) || unit.arms.length === 0) return 0;
  const weapon = state.weapons[unit.weapon];
  if (weapon === undefined) return 0;
  const nearest = pickTarget(state, unit.team, unit.x, unit.y, unit.z, weapon);
  return serveWeapon(state, unit.team, unit.x, unit.y, unit.z, unit, 0, aimFor(state, unit, weapon, nearest));
}

// Called when a unit comes aboard. Rearming is a withdrawal from the ship's
// ordnance store, not a refill from nowhere (ruling #17), and it works down the
// loadout in order: partial rearms are normal, and a ship with an empty store
// sends its aircraft back up as it is.
function rearm(unit, weapons, carrier, presets) {
  unit.cooldown = 0;
  unit.heat = 0;
  unit.heatAccum = 0;
  unit.overheated = 0;
  // The launch preset (ruled 2026-08-25): a Manta's arms fill to the
  // PRESET'S share of each magazine, not always the brim - a scout that
  // carries no bombs costs the ordnance store nothing for bombs it will
  // never drop. Other kinds, and a missing table, fill as always.
  const row = unit.kind === KIND_MANTA && presets !== undefined && carrier.mantaPreset !== undefined
    ? presets[carrier.mantaPreset]
    : undefined;
  for (let i = 0; i < unit.arms.length; i++) {
    const entry = unit.arms[i];
    const weapon = weapons[entry.w];
    const cap = row === undefined || row[i] === undefined
      ? weapon.magazine
      : mulDiv(weapon.magazine, row[i], 1000);
    let wanted = cap - entry.n;
    if (wanted < 0) wanted = 0;
    if (wanted <= 0) continue;
    if (weapon.ordnancePerRound <= 0) {
      entry.n = cap;
      continue;
    }
    const affordable = floorDiv(carrier.ordnance, weapon.ordnancePerRound);
    const rounds = affordable < wanted ? affordable : wanted;
    if (rounds <= 0) continue;
    carrier.ordnance = carrier.ordnance - rounds * weapon.ordnancePerRound;
    entry.n = entry.n + rounds;
  }
  return unit;
}

// The ready magazine is fed from the store continuously: a ship does not
// teleport shells to the mounts. Per 100 ticks so the rate can be a fraction of
// a round, exactly like fuel burn.
function reloadCarrier(carrier, weapon) {
  const entry = armEntry(carrier, carrier.weapon);
  if (entry === -1) return 0;
  const wanted = weapon.magazine - entry.n;
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
  entry.n = entry.n + taken;
  return taken;
}

function stepWeapons(state, params) {
  // Firing is a decision and a finished war decides nothing new; a round
  // already in the air was decided when it left the rail, so it still flies.
  if (state.phase === 0) {
    fireAll(state);
    fireTurrets(state);
  }
  stepShots(state, params);
  sweepTurrets(state);
}

export {
  LOADOUT_CARRIER,
  createWeapons,
  copyWeapons,
  createLoadouts,
  copyLoadouts,
  createArms,
  copyArms,
  armEntry,
  roundsOf,
  selectWeapon,
  nextWeapon,
  coolHeat,
  addHeat,
  pickTarget,
  needsTrigger,
  coolDown,
  serveWeapon,
  fireAll,
  fireTurrets,
  fireUnit,
  rearm,
  reloadCarrier,
  stepWeapons,
};
