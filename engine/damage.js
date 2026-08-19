// engine/damage.js - the carrier's damaged sections (ruling #19).
//
// A hull number alone says only how close you are to sinking. The 1988 original
// tracked WHERE you were hit, and so does this: five sections laid out along
// the ship, fore to aft, each with its own health and its own consequence.
//
//   guns     bow mount        point defence slows, then stops
//   radar    forward mast     you see less far
//   bridge   island, midships the wheel answers slowly
//   hangar   midships         flight operations stop
//   engines  aft              the ship slows
//
// Where a round lands decides which one takes it, by projecting the impact onto
// the ship's own axis - so the aspect you present to an enemy is a real
// decision. Turning your damaged stern away from a strike is a tactic.
//
// A hit costs the general hull its full damage AND the section a share of it,
// so a carrier that is mechanically wrecked can still be afloat, and a carrier
// that is nearly sunk may still be able to fight. Those are different problems
// and the player should be able to tell them apart.

import { floorDiv, mulDiv } from '../shared/fixed.js';
import { mulCos, mulSin } from '../shared/trig.js';

const SECTION_ENGINES = 0;
const SECTION_HANGAR = 1;
const SECTION_BRIDGE = 2;
const SECTION_RADAR = 3;
const SECTION_GUNS = 4;
const SECTION_COUNT = 5;

// Aft to fore, matching the constants above: the array index IS the position
// along the ship, which is what makes the impact projection a simple lookup.
function createSections(carrierRules) {
  const hp = carrierRules.sections;
  return [
    { id: SECTION_ENGINES, hp: hp.engines, maxHp: hp.engines },
    { id: SECTION_HANGAR, hp: hp.hangar, maxHp: hp.hangar },
    { id: SECTION_BRIDGE, hp: hp.bridge, maxHp: hp.bridge },
    { id: SECTION_RADAR, hp: hp.radar, maxHp: hp.radar },
    { id: SECTION_GUNS, hp: hp.guns, maxHp: hp.guns },
  ];
}

function copySections(sections) {
  const out = [];
  for (let i = 0; i < sections.length; i++) {
    out.push({ id: sections[i].id, hp: sections[i].hp, maxHp: sections[i].maxHp });
  }
  return out;
}

// Health of one section in per-mil. A missing section reads as intact rather
// than as destroyed: a bug in the wiring must not silently disable a ship.
function sectionPermil(carrier, id) {
  for (let i = 0; i < carrier.sections.length; i++) {
    const section = carrier.sections[i];
    if (section.id !== id) continue;
    if (section.maxHp <= 0) return 1000;
    return mulDiv(section.hp, 1000, section.maxHp);
  }
  return 1000;
}

// Degraded capability, never zero: a floor of, say, 250 leaves a wrecked engine
// room still able to limp, which is a more interesting position to be in than
// dead in the water. Zero HP is the exception - then it really is gone.
function capability(carrier, id, floorPermil) {
  const health = sectionPermil(carrier, id);
  if (health <= 0) return 0;
  return health < floorPermil ? floorPermil : health;
}

// Derived stats live ON the carrier so every existing reader - the helm, the
// fog filter, the AI - keeps working without knowing about sections. They are
// recomputed from the untouched base values whenever damage or repair moves.
function applySectionEffects(carrier) {
  const engines = capability(carrier, SECTION_ENGINES, carrier.speedFloorPermil);
  const bridge = capability(carrier, SECTION_BRIDGE, carrier.turnFloorPermil);
  const radar = capability(carrier, SECTION_RADAR, carrier.radarFloorPermil);
  carrier.maxSpeed = mulDiv(carrier.maxSpeedBase, engines, 1000);
  carrier.turnRate = mulDiv(carrier.turnRateBase, bridge, 1000);
  carrier.radar = mulDiv(carrier.radarBase, radar, 1000);
  // A ship with no engine room at all still drifts under way; it just cannot
  // make headway. One unit per tick keeps the helm from dividing by nothing.
  if (carrier.maxSpeed < 1) carrier.maxSpeed = 1;
  if (carrier.turnRate < 1) carrier.turnRate = 1;
  return carrier;
}

// Flight operations need a hangar. This one is binary on purpose: a wrecked
// hangar deck is not a slower hangar deck, it is a closed one.
function hangarOpen(carrier) {
  return sectionPermil(carrier, SECTION_HANGAR) > 0;
}

// Point defence fires slower as the mount is chewed up, and not at all once it
// is gone. Returns -1 for "cannot fire".
function gunCooldown(carrier, baseCooldown) {
  const health = sectionPermil(carrier, SECTION_GUNS);
  if (health <= 0) return -1;
  return mulDiv(baseCooldown, 1000, health);
}

// Which section an impact at (x, y) lands on. The impact is projected onto the
// ship's forward axis and the result read off in fifths of the hull's length,
// stern first - which is exactly the order the array is built in.
function sectionAt(carrier, x, y) {
  const dx = x - carrier.x;
  const dy = y - carrier.y;
  const along = mulCos(dx, carrier.heading) + mulSin(dy, carrier.heading);
  const half = carrier.halfLength;
  if (half <= 0) return SECTION_BRIDGE;
  const span = mulDiv(half, 2, SECTION_COUNT);
  let index = floorDiv(along + half, span);
  if (index < 0) index = 0;
  if (index >= SECTION_COUNT) index = SECTION_COUNT - 1;
  return index;
}

// Put damage into one section. Returns what it actually absorbed - a section
// already at zero absorbs nothing, and the hull has taken the full hit anyway.
function damageSection(carrier, id, amount) {
  for (let i = 0; i < carrier.sections.length; i++) {
    const section = carrier.sections[i];
    if (section.id !== id) continue;
    const taken = amount < section.hp ? amount : section.hp;
    section.hp = section.hp - taken;
    applySectionEffects(carrier);
    return taken;
  }
  return 0;
}

// Spend a repair budget on the worst-damaged section first: a ship that cannot
// move or cannot see is in more trouble than one with a dented bow. Returns
// what was spent.
function repairSections(carrier, budget) {
  let spent = 0;
  let left = budget;
  while (left > 0) {
    let worst = -1;
    let worstPermil = 1000;
    for (let i = 0; i < carrier.sections.length; i++) {
      const section = carrier.sections[i];
      if (section.hp >= section.maxHp || section.maxHp <= 0) continue;
      const health = mulDiv(section.hp, 1000, section.maxHp);
      if (health >= worstPermil) continue;
      worstPermil = health;
      worst = i;
    }
    if (worst === -1) break;
    const section = carrier.sections[worst];
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
  SECTION_ENGINES,
  SECTION_HANGAR,
  SECTION_BRIDGE,
  SECTION_RADAR,
  SECTION_GUNS,
  SECTION_COUNT,
  createSections,
  copySections,
  sectionPermil,
  capability,
  applySectionEffects,
  hangarOpen,
  gunCooldown,
  sectionAt,
  damageSection,
  repairSections,
  sectionsIntact,
};
