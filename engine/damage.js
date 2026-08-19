// engine/damage.js - the carrier's damage board (rulings #19 and #23).
//
// Seven sections, as the 1988 original had them, and geometric rather than
// functional: BOW, MIDSHIP, STERN, PORT, STARBOARD, TOPSIDE, ENGINE. Where a
// round lands is worked out in the ship's own frame - how far forward, how far
// out on the beam, how high - so which way you turn is a real decision, in both
// axes rather than only fore and aft.
//
// Two things follow from a section's health:
//
//   1. Systems. Only some sections carry one, exactly as the original named
//      consequences for the engine and the weapon sections and left the rest as
//      structure: bow the point-defence mount, midship the hangar deck, stern
//      the steering gear, topside the mast and sensors, engine the machinery.
//   2. Armour. EVERY section, including the plain plating of the sides, absorbs
//      less as it is chewed up: a hit on a wrecked section does up to half as
//      much again to the hull. That is what makes presenting your good side
//      worth doing, and it needs no new system to say so.
//
// Repairs are the player's call to direct: each section carries a priority, and
// the automatic repair system works through high, then medium, then low, worst
// first inside each tier, spending the ship's own materials.

import { floorDiv, mulDiv } from '../shared/fixed.js';
import { mulCos, mulSin } from '../shared/trig.js';

const SECTION_BOW = 0;
const SECTION_MIDSHIP = 1;
const SECTION_STERN = 2;
const SECTION_PORT = 3;
const SECTION_STARBOARD = 4;
const SECTION_TOPSIDE = 5;
const SECTION_ENGINE = 6;
const SECTION_COUNT = 7;

const PRIORITY_LOW = 0;
const PRIORITY_MEDIUM = 1;
const PRIORITY_HIGH = 2;

// A quarter turn in BAM: forward minus this is starboard.
const QUARTER = 16384;

function createSections(carrierRules) {
  const hp = carrierRules.sections;
  const rows = [
    { id: SECTION_BOW, hp: hp.bow },
    { id: SECTION_MIDSHIP, hp: hp.midship },
    { id: SECTION_STERN, hp: hp.stern },
    { id: SECTION_PORT, hp: hp.port },
    { id: SECTION_STARBOARD, hp: hp.starboard },
    { id: SECTION_TOPSIDE, hp: hp.topside },
    { id: SECTION_ENGINE, hp: hp.engine },
  ];
  const out = [];
  for (let i = 0; i < rows.length; i++) {
    out.push({
      id: rows[i].id,
      hp: rows[i].hp,
      maxHp: rows[i].hp,
      // Everything starts at medium, so a player who never opens the damage
      // board still gets sensible repairs.
      priority: PRIORITY_MEDIUM,
    });
  }
  return out;
}

function copySections(sections) {
  const out = [];
  for (let i = 0; i < sections.length; i++) {
    out.push({
      id: sections[i].id,
      hp: sections[i].hp,
      maxHp: sections[i].maxHp,
      priority: sections[i].priority,
    });
  }
  return out;
}

function sectionAtIndex(carrier, id) {
  for (let i = 0; i < carrier.sections.length; i++) {
    if (carrier.sections[i].id === id) return i;
  }
  return -1;
}

// Health of one section in per-mil. A section that is not there reads as
// intact: a hole in the wiring must not silently disable a ship.
function sectionPermil(carrier, id) {
  const index = sectionAtIndex(carrier, id);
  if (index === -1) return 1000;
  const section = carrier.sections[index];
  if (section.maxHp <= 0) return 1000;
  return mulDiv(section.hp, 1000, section.maxHp);
}

// Degraded capability with a floor under it: a wrecked engine room still lets
// the ship limp, which is a more interesting position than dead in the water.
// Zero is the exception - then it really is gone.
function capability(carrier, id, floorPermil) {
  const health = sectionPermil(carrier, id);
  if (health <= 0) return 0;
  return health < floorPermil ? floorPermil : health;
}

// Derived stats live ON the carrier, recomputed from untouched base values
// whenever damage or repair moves, so the helm, the fog filter and the AI keep
// reading them directly and know nothing about sections.
function applySectionEffects(carrier) {
  const engine = capability(carrier, SECTION_ENGINE, carrier.speedFloorPermil);
  const stern = capability(carrier, SECTION_STERN, carrier.turnFloorPermil);
  const topside = capability(carrier, SECTION_TOPSIDE, carrier.radarFloorPermil);
  carrier.maxSpeed = mulDiv(carrier.maxSpeedBase, engine, 1000);
  carrier.turnRate = mulDiv(carrier.turnRateBase, stern, 1000);
  carrier.radar = mulDiv(carrier.radarBase, topside, 1000);
  if (carrier.maxSpeed < 1) carrier.maxSpeed = 1;
  if (carrier.turnRate < 1) carrier.turnRate = 1;
  return carrier;
}

// Flight operations need a hangar deck. Binary on purpose: a wrecked deck is
// not a slower deck, it is a closed one.
function hangarOpen(carrier) {
  return sectionPermil(carrier, SECTION_MIDSHIP) > 0;
}

// Point defence fires slower as the bow mount is chewed up, and not at all once
// it is gone. Returns -1 for "cannot fire".
function gunCooldown(carrier, baseCooldown) {
  const health = sectionPermil(carrier, SECTION_BOW);
  if (health <= 0) return -1;
  return mulDiv(baseCooldown, 1000, health);
}

// Which section an impact lands on, in the ship's own frame. Height first - a
// round that comes in above the deck hits the island and the mast - then the
// beam, then how far forward. `armourLossPermil` is not consulted here; this is
// only about geometry.
function sectionAt(carrier, x, y, z) {
  if (z >= carrier.topsideHeight) return SECTION_TOPSIDE;
  const dx = x - carrier.x;
  const dy = y - carrier.y;
  const along = mulCos(dx, carrier.heading) + mulSin(dy, carrier.heading);
  const abeam = mulCos(dx, carrier.heading - QUARTER) + mulSin(dy, carrier.heading - QUARTER);
  const absAbeam = abeam < 0 ? -abeam : abeam;
  // Out past half the beam is a hit on the flank rather than on the length.
  if (absAbeam * 2 > carrier.halfBeam) {
    return abeam < 0 ? SECTION_PORT : SECTION_STARBOARD;
  }
  const half = carrier.halfLength;
  if (half <= 0) return SECTION_MIDSHIP;
  if (along > floorDiv(half, 3)) return SECTION_BOW;
  if (along > -floorDiv(half, 3)) return SECTION_MIDSHIP;
  // The tail is the steering gear; the long stretch ahead of it is machinery.
  if (along > -mulDiv(half, 4, 5)) return SECTION_ENGINE;
  return SECTION_STERN;
}

// What a hit on this section costs the hull, in per-mil of the raw damage.
// Intact plating absorbs; wrecked plating lets it through.
function armourMultiplierPermil(carrier, id) {
  const health = sectionPermil(carrier, id);
  return 1000 + mulDiv(carrier.armourLossPermil, 1000 - health, 1000);
}

// Put damage into one section. Returns what it absorbed; a section already at
// zero absorbs nothing, and the hull has taken the hit regardless.
function damageSection(carrier, id, amount) {
  const index = sectionAtIndex(carrier, id);
  if (index === -1) return 0;
  const section = carrier.sections[index];
  const taken = amount < section.hp ? amount : section.hp;
  section.hp = section.hp - taken;
  applySectionEffects(carrier);
  return taken;
}

function setPriority(carrier, id, priority) {
  const index = sectionAtIndex(carrier, id);
  if (index === -1) return 0;
  carrier.sections[index].priority = priority;
  return 1;
}

// The worst-damaged section in the highest tier that still has damage in it.
// High before medium before low, exactly as the original's repair board did it.
function nextRepairTarget(carrier) {
  for (let tier = PRIORITY_HIGH; tier >= PRIORITY_LOW; tier--) {
    let worst = -1;
    let worstPermil = 1001;
    for (let i = 0; i < carrier.sections.length; i++) {
      const section = carrier.sections[i];
      if (section.priority !== tier) continue;
      if (section.hp >= section.maxHp || section.maxHp <= 0) continue;
      const health = mulDiv(section.hp, 1000, section.maxHp);
      if (health >= worstPermil) continue;
      worstPermil = health;
      worst = i;
    }
    if (worst !== -1) return worst;
  }
  return -1;
}

// Spend a repair budget across the sections in priority order. Returns what was
// actually spent, which is less than the budget once the ship is whole.
function repairSections(carrier, budget) {
  let spent = 0;
  let left = budget;
  while (left > 0) {
    const index = nextRepairTarget(carrier);
    if (index === -1) break;
    const section = carrier.sections[index];
    const missing = section.maxHp - section.hp;
    const put = left < missing ? left : missing;
    section.hp = section.hp + put;
    spent = spent + put;
    left = left - put;
  }
  if (spent > 0) applySectionEffects(carrier);
  return spent;
}

function sectionsIntact(carrier) {
  for (let i = 0; i < carrier.sections.length; i++) {
    if (carrier.sections[i].hp < carrier.sections[i].maxHp) return false;
  }
  return true;
}

export {
  SECTION_BOW,
  SECTION_MIDSHIP,
  SECTION_STERN,
  SECTION_PORT,
  SECTION_STARBOARD,
  SECTION_TOPSIDE,
  SECTION_ENGINE,
  SECTION_COUNT,
  PRIORITY_LOW,
  PRIORITY_MEDIUM,
  PRIORITY_HIGH,
  createSections,
  copySections,
  sectionPermil,
  capability,
  applySectionEffects,
  hangarOpen,
  gunCooldown,
  sectionAt,
  armourMultiplierPermil,
  damageSection,
  setPriority,
  nextRepairTarget,
  repairSections,
  sectionsIntact,
};
