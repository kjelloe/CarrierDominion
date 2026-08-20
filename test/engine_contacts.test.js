// The chart's memory (owner ruling 2026-08-21): detection stays radar-range
// only, but what a team HAS seen leaves a mark - kept until it is disproved by
// looking back, never expired by looking away.

import test from 'node:test';
import assert from 'node:assert/strict';

import { loadRules, withoutAi } from './helpers/rules.mjs';
import { createInitialState } from '../engine/state.js';
import { apply } from '../engine/reducer.js';
import { canonicalize } from '../shared/statehash.js';
import { buildView } from '../shared/view.js';
import { CONTACT_CARRIER, CONTACT_UNIT, covered, remembered, stepContacts } from '../engine/contacts.js';
import { KIND_MANTA, KIND_WALRUS, UNIT_ACTIVE, UNIT_LOST } from '../engine/units.js';

const rules = withoutAi(loadRules());
const TICK = { type: 'advance_tick' };
const SEED = 20260818;

function fresh() {
  return createInitialState(SEED, rules);
}

// Park the enemy carrier a given distance east of ours, dead in the water.
function enemyAt(state, offsetUnits) {
  const own = state.carriers[0];
  const enemy = state.carriers[1];
  enemy.x = own.x + offsetUnits;
  enemy.y = own.y;
  enemy.throttle = 0;
  enemy.speed = 0;
  return enemy;
}

test('a contact that leaves the radar leaves a ghost where it was', () => {
  let state = fresh();
  const radar = state.carriers[0].radar;
  const enemy = enemyAt(state, radar - 2000);
  state = apply(state, TICK);
  assert.notEqual(remembered(state.contacts, 0, CONTACT_CARRIER, enemy.id), -1);

  // It slips over the horizon: the mark stays, at the last seen spot, with
  // the tick it was last seen on.
  const lastX = state.carriers[1].x;
  const seenTick = state.tick;
  state.carriers[1].x = state.carriers[0].x + radar * 3;
  state = apply(state, TICK);
  const ghost = remembered(state.contacts, 0, CONTACT_CARRIER, enemy.id);
  assert.notEqual(ghost, -1, 'the memory went with the contact');
  assert.equal(ghost.x, lastX);
  assert.equal(ghost.tick, seenTick);

  // Ticks pass; the ghost neither moves nor fades.
  for (let i = 0; i < 50; i++) state = apply(state, TICK);
  const later = remembered(state.contacts, 0, CONTACT_CARRIER, enemy.id);
  assert.equal(later.x, lastX);
  assert.equal(later.tick, seenTick);
  assert.doesNotThrow(() => canonicalize(state));
});

test('looking back disproves a ghost; seeing the hull again refreshes it', () => {
  let state = fresh();
  const radar = state.carriers[0].radar;
  // WELL inside the sweep - past the rim margin - so its spot can be scanned.
  const enemy = enemyAt(state, Math.floor(radar / 2));
  state = apply(state, TICK);

  // Refresh: still in sight, the mark tracks the hull tick for tick.
  state.carriers[1].x = state.carriers[1].x + 500;
  state = apply(state, TICK);
  const fresh1 = remembered(state.contacts, 0, CONTACT_CARRIER, enemy.id);
  assert.equal(fresh1.x, state.carriers[1].x);
  assert.equal(fresh1.tick, state.tick);

  // It vanishes to the far side of the map, but its OLD spot is still well
  // under our radar: the scan comes back empty and the mark is disproved.
  state.carriers[1].x = state.carriers[0].x + radar * 4;
  state = apply(state, TICK);
  assert.equal(remembered(state.contacts, 0, CONTACT_CARRIER, enemy.id), -1,
    'a ghost survived a scan of the spot it haunted');
});

test('a ghost at the rim is NOT disproved - the rim is ambiguous on purpose', () => {
  let state = fresh();
  const radar = state.carriers[0].radar;
  // Just inside the rim: within the disprove margin of the edge.
  const enemy = enemyAt(state, radar - 2000);
  state = apply(state, TICK);
  state.carriers[1].x = state.carriers[0].x + radar * 4;
  state = apply(state, TICK);
  assert.notEqual(remembered(state.contacts, 0, CONTACT_CARRIER, enemy.id), -1,
    'a contact that sailed over the horizon left no mark at all');
});

test('memory of a kill you did not witness persists until you visit the wreck', () => {
  let state = fresh();
  const radar = state.carriers[0].radar;
  const enemy = enemyAt(state, radar - 2000);
  state = apply(state, TICK);

  // Out of sight, then sunk by nobody we can see.
  state.carriers[1].x = state.carriers[0].x + radar * 3;
  state = apply(state, TICK);
  state.carriers[1].hull = 0;
  state = apply(state, TICK);
  assert.notEqual(remembered(state.contacts, 0, CONTACT_CARRIER, enemy.id), -1,
    'the team knew about a sinking it could not have seen');
});

test('a sunk carrier is not a sensor', () => {
  const state = fresh();
  const own = state.carriers[0];
  assert.equal(covered(state, 0, own.x + 1000, own.y), true);
  own.hull = 0;
  assert.equal(covered(state, 0, own.x + 1000, own.y), false,
    'a mast under water was still painting contacts');
});

test('units leave ghosts too, and each team remembers only for itself', () => {
  let state = fresh();
  const own = state.carriers[0];
  const enemyManta = state.units.find((u) => u.team === 1 && u.kind === KIND_MANTA);
  enemyManta.state = UNIT_ACTIVE;
  enemyManta.x = own.x + 2000;
  enemyManta.y = own.y;
  enemyManta.z = 300 * 256;
  state = apply(state, TICK);
  const seen = remembered(state.contacts, 0, CONTACT_UNIT, enemyManta.id);
  assert.notEqual(seen, -1);
  assert.equal(seen.unitKind, KIND_MANTA);
  // Team 1 has no mark for its own aircraft: memory is of ENEMIES.
  assert.equal(remembered(state.contacts, 1, CONTACT_UNIT, enemyManta.id), -1);
});

// --- The AI acting on the chart's memory (engine/ai_strike.js) ---

test('a ghost on the chart is worth one scout, and the search disproves itself', () => {
  const aiRules = loadRules();
  aiRules.rules = { ...aiRules.rules, aiTeams: [0] };
  let state = createInitialState(SEED, aiRules);
  const own = state.carriers[0];
  const enemy = state.carriers[1];

  // Park the enemy out of everyone's sight, and plant a memory of it at a spot
  // a few kilometres from our carrier - as if it had been seen and lost.
  const spotX = own.x + 12000 * 256;
  const spotY = own.y;
  state.contacts = [{
    team: 0, kind: CONTACT_CARRIER, id: enemy.id, unitKind: -1,
    x: spotX, y: spotY, heading: 0, tick: 1,
  }];
  state.tick = 10;

  // The AI sends exactly one aircraft to look.
  let scouts = 0;
  for (let i = 0; i < 40 && scouts === 0; i++) {
    state = apply(state, TICK);
    scouts = state.units.filter(
      (u) => u.team === 0 && u.kind === KIND_MANTA && u.state === UNIT_ACTIVE,
    ).length;
  }
  assert.equal(scouts, 1, 'a memory is worth one scout, not a strike package');
  const scout = state.units.find(
    (u) => u.team === 0 && u.kind === KIND_MANTA && u.state === UNIT_ACTIVE,
  );
  assert.equal(scout.targetX, spotX, 'the scout was not sent at the ghost');

  // It flies there, scans the empty spot, the ghost is disproved, and with
  // nothing left to look for the scout is recalled - no timer anywhere.
  let ticks = 0;
  while (ticks < 30000
    && remembered(state.contacts, 0, CONTACT_CARRIER, enemy.id) !== -1) {
    state = apply(state, TICK);
    ticks += 1;
  }
  assert.notEqual(ticks, 30000, 'the scout never disproved the ghost');
  for (let i = 0; i < 10; i++) state = apply(state, TICK);
  const after = state.units.find((u) => u.id === scout.id);
  assert.notEqual(after.state, UNIT_ACTIVE, 'the scout kept searching for a disproved memory');
});

test('a hunt that finds the carrier becomes a strike', () => {
  const aiRules = loadRules();
  aiRules.rules = { ...aiRules.rules, aiTeams: [0] };
  let state = createInitialState(SEED, aiRules);
  const own = state.carriers[0];
  const enemy = state.carriers[1];

  // The enemy is NEAR the remembered spot - moved a little, as real ones do.
  enemy.x = own.x + 12000 * 256;
  enemy.y = own.y + 1500 * 256;
  state.contacts = [{
    team: 0, kind: CONTACT_CARRIER, id: enemy.id, unitKind: -1,
    x: own.x + 12000 * 256, y: own.y, heading: 0, tick: 1,
  }];
  state.tick = 10;

  // The scout closes on the spot, its radar re-acquires the hull, and the
  // strike machinery takes over: the brain marks the carrier under attack.
  let ticks = 0;
  while (ticks < 30000 && state.ai[0].strikeCarrier === -1) {
    state = apply(state, TICK);
    ticks += 1;
  }
  assert.equal(state.ai[0].strikeCarrier, enemy.id, 'the hunt never became a strike');
});
