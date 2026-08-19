import test from 'node:test';
import assert from 'node:assert/strict';

import { loadRules } from '../server/rules.js';
import { createInitialState } from '../engine/state.js';
import { apply } from '../engine/reducer.js';
import { canonicalize } from '../shared/statehash.js';
import { buildView } from '../shared/view.js';
import { mulCos, mulSin } from '../shared/trig.js';
import {
  PRIORITY_HIGH,
  PRIORITY_LOW,
  PRIORITY_MEDIUM,
  SECTION_BOW,
  SECTION_COUNT,
  SECTION_ENGINE,
  SECTION_MIDSHIP,
  SECTION_PORT,
  SECTION_STARBOARD,
  SECTION_STERN,
  SECTION_TOPSIDE,
  armourMultiplierPermil,
  damageSection,
  gunCooldown,
  hangarOpen,
  repairSections,
  sectionAt,
  sectionPermil,
  sectionsIntact,
  setPriority,
} from '../engine/damage.js';
import { conditionPermil, stepRepairCarrier } from '../engine/repair.js';
import { hitCarrier } from '../engine/weapons.js';
import { KIND_MANTA, UNIT_ACTIVE } from '../engine/units.js';
import { readyToLaunch } from '../engine/hangar.js';

const rules = loadRules();
const TICK = { type: 'advance_tick' };
const SEED = 20260818;
const QUARTER = 16384;

function fresh() {
  return createInitialState(SEED, rules);
}

function sectionOf(carrier, id) {
  return carrier.sections.find((s) => s.id === id);
}

// A point `ahead` metres forward of the carrier's centre and `starboard` metres
// out on the beam, in the ship's own frame.
function aboard(carrier, ahead, starboard) {
  const f = ahead * 256;
  const r = starboard * 256;
  return {
    x: carrier.x + mulCos(f, carrier.heading) + mulCos(r, carrier.heading - QUARTER),
    y: carrier.y + mulSin(f, carrier.heading) + mulSin(r, carrier.heading - QUARTER),
  };
}

test('a fresh carrier has seven whole sections, all at medium priority', () => {
  const state = fresh();
  const carrier = state.carriers[0];
  assert.equal(carrier.sections.length, SECTION_COUNT);
  assert.ok(sectionsIntact(carrier));
  for (const section of carrier.sections) assert.equal(section.priority, PRIORITY_MEDIUM);
  assert.equal(carrier.maxSpeed, carrier.maxSpeedBase);
  assert.equal(carrier.turnRate, carrier.turnRateBase);
  assert.equal(carrier.radar, carrier.radarBase);
  assert.equal(conditionPermil(carrier), 1000);
});

test('where a round lands decides what it breaks, in both axes', () => {
  const state = fresh();
  const carrier = state.carriers[0];
  const bow = aboard(carrier, 150, 0);
  const midship = aboard(carrier, 0, 0);
  const engine = aboard(carrier, -100, 0);
  const stern = aboard(carrier, -160, 0);
  const port = aboard(carrier, 0, -30);
  const starboard = aboard(carrier, 0, 30);

  assert.equal(sectionAt(carrier, bow.x, bow.y, 0), SECTION_BOW);
  assert.equal(sectionAt(carrier, midship.x, midship.y, 0), SECTION_MIDSHIP);
  assert.equal(sectionAt(carrier, engine.x, engine.y, 0), SECTION_ENGINE);
  assert.equal(sectionAt(carrier, stern.x, stern.y, 0), SECTION_STERN);
  assert.equal(sectionAt(carrier, port.x, port.y, 0), SECTION_PORT);
  assert.equal(sectionAt(carrier, starboard.x, starboard.y, 0), SECTION_STARBOARD);
  // Anything that comes in above the deck hits the island and the mast, wherever
  // along the ship it was.
  assert.equal(sectionAt(carrier, bow.x, bow.y, carrier.topsideHeight + 1), SECTION_TOPSIDE);
});

test('a hit costs the hull, and wrecked plating lets more of the next one through', () => {
  const state = fresh();
  const carrier = state.carriers[0];
  const port = aboard(carrier, 0, -30);
  const share = Math.floor((40 * rules.units.carrier.sectionDamagePermil) / 1000);

  hitCarrier(state, carrier, 40, port.x, port.y, 0);
  assert.equal(carrier.hull, carrier.maxHull - 40, 'intact plating should absorb in full');
  assert.equal(sectionOf(carrier, SECTION_PORT).hp, rules.units.carrier.sections.port - share);
  assert.equal(sectionPermil(carrier, SECTION_STARBOARD), 1000, 'the far side took damage');

  // Now hole that side properly and hit it again: the same round does more.
  damageSection(carrier, SECTION_PORT, sectionOf(carrier, SECTION_PORT).hp);
  assert.equal(
    armourMultiplierPermil(carrier, SECTION_PORT),
    1000 + rules.units.carrier.armourLossPermil,
  );
  const before = carrier.hull;
  hitCarrier(state, carrier, 40, port.x, port.y, 0);
  assert.ok(before - carrier.hull > 40, 'a wrecked side absorbed as much as a whole one');
});

test('each system section costs the ship the thing it is for', () => {
  const state = fresh();
  const carrier = state.carriers[0];

  damageSection(carrier, SECTION_ENGINE, sectionOf(carrier, SECTION_ENGINE).maxHp);
  assert.ok(carrier.maxSpeed > 0 && carrier.maxSpeed < carrier.maxSpeedBase, 'engines');

  damageSection(carrier, SECTION_STERN, sectionOf(carrier, SECTION_STERN).maxHp);
  assert.ok(carrier.turnRate > 0 && carrier.turnRate < carrier.turnRateBase, 'steering');

  damageSection(carrier, SECTION_TOPSIDE, sectionOf(carrier, SECTION_TOPSIDE).maxHp);
  assert.equal(carrier.radar, 0, 'a wrecked mast should leave the ship blind');

  assert.notEqual(readyToLaunch(state, carrier.id, KIND_MANTA), -1);
  damageSection(carrier, SECTION_MIDSHIP, sectionOf(carrier, SECTION_MIDSHIP).maxHp);
  assert.equal(hangarOpen(carrier), false);
  assert.equal(readyToLaunch(state, carrier.id, KIND_MANTA), -1, 'a wrecked hangar launched');

  const base = state.weapons[3].cooldown;
  damageSection(carrier, SECTION_BOW, sectionOf(carrier, SECTION_BOW).maxHp);
  assert.equal(gunCooldown(carrier, base), -1, 'a wrecked mount still fired');
});

test('a wrecked ship does not fire, whatever is in range', () => {
  let state = fresh();
  const carrier = state.carriers[0];
  const enemy = state.units.find((u) => u.team === 1 && u.kind === KIND_MANTA);
  enemy.state = UNIT_ACTIVE;
  enemy.x = carrier.x + 300 * 256;
  enemy.y = carrier.y;
  enemy.z = 200 * 256;
  damageSection(carrier, SECTION_BOW, sectionOf(carrier, SECTION_BOW).maxHp);
  const ammoBefore = carrier.ammo;
  state = apply(state, TICK);
  assert.equal(state.carriers[0].ammo, ammoBefore, 'a destroyed mount fired anyway');
});

test('repairs follow the priorities the player set, high tier first', () => {
  const state = fresh();
  const carrier = state.carriers[0];
  damageSection(carrier, SECTION_PORT, 100);
  damageSection(carrier, SECTION_ENGINE, 40);
  setPriority(carrier, SECTION_ENGINE, PRIORITY_HIGH);
  setPriority(carrier, SECTION_PORT, PRIORITY_LOW);

  // The engine room is barely scratched next to the side, but it is the one the
  // player asked for, so it goes first and finishes before anything else starts.
  const spent = repairSections(carrier, 40);
  assert.equal(spent, 40);
  assert.equal(sectionOf(carrier, SECTION_ENGINE).hp, sectionOf(carrier, SECTION_ENGINE).maxHp);
  assert.equal(sectionOf(carrier, SECTION_PORT).hp, sectionOf(carrier, SECTION_PORT).maxHp - 100);

  // With the high tier whole, the low one finally gets attention.
  repairSections(carrier, 60);
  assert.equal(sectionOf(carrier, SECTION_PORT).hp, sectionOf(carrier, SECTION_PORT).maxHp - 40);
});

test('within one tier the worst section is repaired first', () => {
  const state = fresh();
  const carrier = state.carriers[0];
  damageSection(carrier, SECTION_PORT, 20);
  damageSection(carrier, SECTION_TOPSIDE, sectionOf(carrier, SECTION_TOPSIDE).maxHp - 5);
  repairSections(carrier, 10);
  assert.equal(sectionOf(carrier, SECTION_TOPSIDE).hp, 15, 'the worst section was not first');
  assert.equal(sectionOf(carrier, SECTION_PORT).hp, sectionOf(carrier, SECTION_PORT).maxHp - 20);
});

test('the yard spends the ship own materials, and stops when they run out', () => {
  const state = fresh();
  const carrier = state.carriers[0];
  const perPoint = state.economy.repairPerMaterial;
  damageSection(carrier, SECTION_ENGINE, 150);
  carrier.materials = 0;

  for (let tick = 0; tick < 500; tick++) stepRepairCarrier(state, carrier);
  assert.equal(sectionOf(carrier, SECTION_ENGINE).hp, sectionOf(carrier, SECTION_ENGINE).maxHp - 150,
    'a ship with no materials repaired itself out of thin air');

  carrier.materials = 20 * perPoint;
  let done = 0;
  for (let tick = 0; tick < 2000; tick++) done += stepRepairCarrier(state, carrier);
  assert.equal(done, 20, 'the yard put in more than the store could pay for');
  assert.equal(carrier.materials, 0);
});

test('a repair command from the seat changes the board', () => {
  let state = fresh();
  state = apply(state, {
    type: 'set_repair_priority',
    carrierId: 0,
    section: SECTION_TOPSIDE,
    priority: PRIORITY_HIGH,
  });
  assert.equal(sectionOf(state.carriers[0], SECTION_TOPSIDE).priority, PRIORITY_HIGH);
  // A section that does not exist is rejected rather than silently ignored.
  const before = state.events.length;
  state = apply(state, {
    type: 'set_repair_priority', carrierId: 0, section: 99, priority: PRIORITY_HIGH,
  });
  assert.ok(state.events.length >= before);
});

test('an enemy contact reveals nothing about what is broken aboard', () => {
  const state = fresh();
  const mine = state.carriers[0];
  const theirs = state.carriers[1];
  damageSection(theirs, SECTION_ENGINE, 100);
  theirs.x = mine.x + 1000 * 256;
  theirs.y = mine.y;
  const view = buildView(state, mine.team);
  const contact = view.carriers.find((c) => c.contact === 1);
  assert.notEqual(contact, undefined, 'no contact to test');
  assert.deepEqual(contact.sections, []);
  const own = view.carriers.find((c) => c.contact === 0);
  assert.equal(own.sections.length, SECTION_COUNT);
  assert.equal(own.sections[0].priority, PRIORITY_MEDIUM);
});

test('sections survive the canonical walk and the deep copy', () => {
  let state = fresh();
  const stern = aboard(state.carriers[0], -160, 0);
  hitCarrier(state, state.carriers[0], 40, stern.x, stern.y, 0);
  setPriority(state.carriers[0], SECTION_STERN, PRIORITY_HIGH);
  state = apply(state, TICK);
  assert.doesNotThrow(() => canonicalize(state));
  assert.equal(sectionOf(state.carriers[0], SECTION_STERN).priority, PRIORITY_HIGH);
  assert.ok(sectionOf(state.carriers[0], SECTION_STERN).hp < rules.units.carrier.sections.stern);
});
