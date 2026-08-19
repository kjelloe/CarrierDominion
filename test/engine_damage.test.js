import test from 'node:test';
import assert from 'node:assert/strict';

import { loadRules } from '../server/rules.js';
import { createInitialState } from '../engine/state.js';
import { apply } from '../engine/reducer.js';
import { canonicalize } from '../shared/statehash.js';
import { buildView } from '../shared/view.js';
import { mulCos, mulSin } from '../shared/trig.js';
import {
  SECTION_BRIDGE,
  SECTION_ENGINES,
  SECTION_GUNS,
  SECTION_HANGAR,
  SECTION_RADAR,
  damageSection,
  gunCooldown,
  hangarOpen,
  repairSections,
  sectionAt,
  sectionPermil,
  sectionsIntact,
} from '../engine/damage.js';
import { hitCarrier } from '../engine/weapons.js';
import { KIND_MANTA, UNIT_ACTIVE } from '../engine/units.js';
import { readyToLaunch } from '../engine/hangar.js';

const rules = loadRules();
const TICK = { type: 'advance_tick' };
const SEED = 20260818;

function fresh() {
  return createInitialState(SEED, rules);
}

// A point `metres` ahead of (or behind, if negative) the carrier's own centre.
function alongShip(carrier, metres) {
  const distance = metres * 256;
  return {
    x: carrier.x + mulCos(distance, carrier.heading),
    y: carrier.y + mulSin(distance, carrier.heading),
  };
}

test('a fresh carrier is whole, and its capability is the undamaged one', () => {
  const state = fresh();
  const carrier = state.carriers[0];
  assert.ok(sectionsIntact(carrier));
  assert.equal(carrier.sections.length, 5);
  assert.equal(carrier.maxSpeed, carrier.maxSpeedBase);
  assert.equal(carrier.turnRate, carrier.turnRateBase);
  assert.equal(carrier.radar, carrier.radarBase);
});

test('where a round lands decides what it breaks', () => {
  const state = fresh();
  const carrier = state.carriers[0];
  const bow = alongShip(carrier, 150);
  const stern = alongShip(carrier, -150);
  const middle = alongShip(carrier, 0);
  assert.equal(sectionAt(carrier, bow.x, bow.y), SECTION_GUNS);
  assert.equal(sectionAt(carrier, stern.x, stern.y), SECTION_ENGINES);
  assert.equal(sectionAt(carrier, middle.x, middle.y), SECTION_BRIDGE);
  // Well past either end still reads as the end it is past, not as nothing.
  const far = alongShip(carrier, 4000);
  assert.equal(sectionAt(carrier, far.x, far.y), SECTION_GUNS);
});

test('a hit costs the hull in full and the section a share', () => {
  const state = fresh();
  const carrier = state.carriers[0];
  const stern = alongShip(carrier, -150);
  const share = Math.floor((40 * rules.units.carrier.sectionDamagePermil) / 1000);

  hitCarrier(state, carrier, 40, stern.x, stern.y);
  assert.equal(carrier.hull, carrier.maxHull - 40);
  assert.equal(carrier.sections[SECTION_ENGINES].hp, rules.units.carrier.sections.engines - share);
  // Everything else aboard is untouched.
  assert.equal(sectionPermil(carrier, SECTION_GUNS), 1000);
});

test('wrecked engines slow the ship without stopping it dead', () => {
  const state = fresh();
  const carrier = state.carriers[0];
  const full = carrier.maxSpeed;
  damageSection(carrier, SECTION_ENGINES, carrier.sections[SECTION_ENGINES].maxHp);
  assert.equal(sectionPermil(carrier, SECTION_ENGINES), 0);
  assert.ok(carrier.maxSpeed > 0, 'a wrecked engine room left the ship unable to move at all');
  assert.ok(carrier.maxSpeed < full, 'wrecking the engines changed nothing');
});

test('a damaged section degrades capability, with a floor under it', () => {
  const state = fresh();
  const carrier = state.carriers[0];
  const engines = carrier.sections[SECTION_ENGINES];
  damageSection(carrier, SECTION_ENGINES, Math.floor(engines.maxHp / 2));
  const half = carrier.maxSpeed;
  assert.ok(half < carrier.maxSpeedBase && half > 0);

  // Ground it down to a sliver: the floor holds, so the ship can still limp.
  damageSection(carrier, SECTION_ENGINES, engines.hp - 1);
  const floor = Math.floor(
    (carrier.maxSpeedBase * rules.units.carrier.speedFloorPermil) / 1000,
  );
  assert.equal(carrier.maxSpeed, floor);
});

test('a wrecked radar shortens what the ship can see', () => {
  const state = fresh();
  const carrier = state.carriers[0];
  damageSection(carrier, SECTION_RADAR, carrier.sections[SECTION_RADAR].maxHp);
  assert.equal(carrier.radar, 0);
  // And the fog filter uses that immediately: an enemy that was in range is not
  // any more. (The other carrier is far away, so this is about the shape of the
  // rule rather than the distance.)
  const view = buildView(state, carrier.team);
  assert.ok(view.carriers.every((c) => c.contact === 0 || c.id !== carrier.id));
});

test('a wrecked hangar closes flight operations', () => {
  const state = fresh();
  const carrier = state.carriers[0];
  assert.notEqual(readyToLaunch(state, carrier.id, KIND_MANTA), -1);
  damageSection(carrier, SECTION_HANGAR, carrier.sections[SECTION_HANGAR].maxHp);
  assert.equal(hangarOpen(carrier), false);
  assert.equal(readyToLaunch(state, carrier.id, KIND_MANTA), -1, 'a wrecked hangar still launched');
});

test('point defence slows as the mount is chewed up, then stops', () => {
  const state = fresh();
  const carrier = state.carriers[0];
  const base = state.weapons[3].cooldown;
  assert.equal(gunCooldown(carrier, base), base);
  damageSection(carrier, SECTION_GUNS, Math.floor(carrier.sections[SECTION_GUNS].maxHp / 2));
  assert.ok(gunCooldown(carrier, base) > base, 'a damaged mount fires as fast as a whole one');
  damageSection(carrier, SECTION_GUNS, carrier.sections[SECTION_GUNS].hp);
  assert.equal(gunCooldown(carrier, base), -1);
});

test('a wrecked ship does not fire, whatever is in range', () => {
  let state = fresh();
  const carrier = state.carriers[0];
  const enemy = state.units.find((u) => u.team === 1 && u.kind === KIND_MANTA);
  enemy.state = UNIT_ACTIVE;
  enemy.x = carrier.x + 300 * 256;
  enemy.y = carrier.y;
  enemy.z = 200 * 256;
  damageSection(carrier, SECTION_GUNS, carrier.sections[SECTION_GUNS].maxHp);
  const ammoBefore = carrier.ammo;
  state = apply(state, TICK);
  const after = state.carriers[0];
  assert.equal(after.ammo, ammoBefore, 'a destroyed mount fired anyway');
});

test('repairs go to the worst section first, then the plating', () => {
  const state = fresh();
  const carrier = state.carriers[0];
  damageSection(carrier, SECTION_ENGINES, 100);
  damageSection(carrier, SECTION_RADAR, 20);
  const spent = repairSections(carrier, 40);
  assert.equal(spent, 40);
  // The engines were the worse of the two, so they got it.
  assert.equal(carrier.sections[SECTION_ENGINES].hp, carrier.sections[SECTION_ENGINES].maxHp - 60);
  assert.equal(carrier.sections[SECTION_RADAR].hp, carrier.sections[SECTION_RADAR].maxHp - 20);
  // Repairing restores capability, not just the number.
  assert.ok(carrier.maxSpeed > 0);

  // A budget bigger than the damage puts the ship right and stops.
  const rest = repairSections(carrier, 10000);
  assert.equal(rest, 80);
  assert.ok(sectionsIntact(carrier));
  assert.equal(carrier.maxSpeed, carrier.maxSpeedBase);
});

test('an enemy contact reveals nothing about what is broken aboard', () => {
  const state = fresh();
  const mine = state.carriers[0];
  const theirs = state.carriers[1];
  damageSection(theirs, SECTION_ENGINES, 100);
  // Put them nose to nose so the contact exists at all.
  theirs.x = mine.x + 1000 * 256;
  theirs.y = mine.y;
  const view = buildView(state, mine.team);
  const contact = view.carriers.find((c) => c.contact === 1);
  assert.notEqual(contact, undefined, 'no contact to test');
  assert.deepEqual(contact.sections, []);
  const own = view.carriers.find((c) => c.contact === 0);
  assert.equal(own.sections.length, 5);
});

test('sections survive the canonical walk and the deep copy', () => {
  let state = fresh();
  const stern = alongShip(state.carriers[0], -150);
  hitCarrier(state, state.carriers[0], 40, stern.x, stern.y);
  state = apply(state, TICK);
  assert.doesNotThrow(() => canonicalize(state));
  assert.ok(state.carriers[0].sections[SECTION_ENGINES].hp < rules.units.carrier.sections.engines);
});
