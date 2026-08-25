// The islands' own teeth (ruled 2026-08-25, both): every neutral island
// keeps a token six-round silo - taking even a free island costs something
// - and a Defence island's Bat Cave scrambles droid interceptors at
// intruders, leashed to their own rock, rebuilt from its materials.

import test from 'node:test';
import assert from 'node:assert/strict';

import { loadRules, withoutAi, bareRules } from './helpers/rules.mjs';
import { createInitialState } from '../engine/state.js';
import { apply } from '../engine/reducer.js';
import { canonicalize } from '../shared/statehash.js';
import { dist2D } from '../shared/fixed.js';
import { KIND_INTERCEPTOR, KIND_MANTA, UNIT_ACTIVE, UNIT_STOWED } from '../engine/units.js';
import { nextBuild } from '../engine/ai_estate.js';
import { ROLE_DEFENCE } from '../engine/island.js';

const TICK = { type: 'advance_tick' };
const SEED = 20260818;

test('every neutral island keeps a token silo; a developed start replaces its own', () => {
  const state = createInitialState(SEED, withoutAi(loadRules()));
  for (const island of state.islands) {
    const guns = state.turrets.filter((t) => t.island === island.id && t.hp > 0);
    if (island.owner === -1) {
      assert.equal(guns.length, 1, `island ${island.id} lost its silo`);
      assert.equal(guns[0].team, -1);
      for (const arm of guns[0].arms) {
        assert.ok(arm.n <= state.params.neutralSiloRounds, 'a silo with a full rack');
      }
    } else {
      // The home island: its own two guns, no leftover neutral hardware.
      assert.equal(guns.filter((t) => t.team === -1).length, 0,
        `island ${island.id} keeps a silo aimed at its owner`);
    }
  }
  assert.doesNotThrow(() => canonicalize(state));
});

// The map's teeth, without the machine or the home islands: bareRules is
// the BLANK ocean by definition, so this one asks for silos explicitly.
function toothyRules() {
  const rules = withoutAi(loadRules());
  rules.rules = { ...rules.rules, startShape: 1 };
  return rules;
}

test('the silo fires on a landing, then runs dry and falls silent', () => {
  let state = createInitialState(SEED, toothyRules());
  const island = state.islands[0];
  const silo = state.turrets.find((t) => t.island === island.id && t.team === -1);
  assert.notEqual(silo, undefined, 'the map should have teeth here');
  // A Manta parked in range: the silo engages it.
  const manta = state.units.find((u) => u.team === 0 && u.kind === KIND_MANTA);
  state = apply(state, { type: 'launch_unit', carrierId: 0, kind: KIND_MANTA });
  const flyer = state.units.find((u) => u.id === manta.id);
  flyer.x = silo.x + 800 * 256;
  flyer.y = silo.y;
  flyer.z = 300 * 256;
  let fired = 0;
  for (let i = 0; i < 400; i++) {
    state = apply(state, TICK);
    const held = state.units.find((u) => u.id === manta.id);
    if (held.state === UNIT_ACTIVE) {
      held.x = silo.x + 800 * 256;
      held.y = silo.y;
      held.z = 300 * 256;
      held.fuel = held.fuelCapacity;
      held.hp = held.maxHp; // immortal for the count - we are counting shots
    }
    fired = Math.max(fired, state.shots.filter((s) => s.team === -1).length ? 1 : fired);
    if (state.shots.some((s) => s.team === -1)) fired = 1;
  }
  assert.equal(fired, 1, 'the silo never fired');
  const spent = state.turrets.find((t) => t.id === silo.id);
  const left = spent.arms.reduce((n, a) => n + a.n, 0);
  assert.ok(left < state.params.neutralSiloRounds, 'no round was ever spent');
});

test('a Bat Cave scrambles, presses, and its wing dies with the island', () => {
  let state = createInitialState(SEED, bareRules());
  const island = state.islands[0];
  island.owner = 1;
  island.role = ROLE_DEFENCE;
  island.stockMaterials = 5000;
  island.nodeHp = state.params.commandCentreHp;

  // An intruder inside the ring wakes the cave: first the rebuild puts an
  // airframe in the cave, then the scramble puts it in the air.
  const manta = state.units.find((u) => u.team === 0 && u.kind === KIND_MANTA);
  state = apply(state, { type: 'launch_unit', carrierId: 0, kind: KIND_MANTA });
  let guard = 0;
  let airborne;
  while (guard < 20000) {
    state = apply(state, TICK);
    const held = state.units.find((u) => u.id === manta.id);
    if (held.state === UNIT_ACTIVE) {
      held.x = island.x + 3000 * 256;
      held.y = island.y;
      held.z = 350 * 256;
      held.fuel = held.fuelCapacity;
      held.hp = held.maxHp;
    }
    airborne = state.units.find(
      (u) => u.kind === KIND_INTERCEPTOR && u.team === 1 && u.state === UNIT_ACTIVE,
    );
    if (airborne !== undefined) break;
    guard += 1;
  }
  assert.notEqual(airborne, undefined, 'the cave never scrambled');
  assert.equal(airborne.landedIsland, island.id);
  // The scramble tick lifts it; the NEXT cave pass hands it the intruder.
  state = apply(state, TICK);
  const pressing = state.units.find((u) => u.id === airborne.id);
  assert.equal(pressing.orderTargetId, manta.id, 'the wing is not pressing the intruder');

  // The island falls: the wing falls with it.
  state.islands[0].owner = -1;
  state.islands[0].role = -1;
  state = apply(state, TICK);
  const wing = state.units.filter((u) => u.kind === KIND_INTERCEPTOR);
  assert.ok(wing.every((u) => u.state === 3), 'an orphan wing kept flying');
  assert.doesNotThrow(() => canonicalize(state));
});

// --- What the machine learned (ruled 2026-08-25) ---

test('the machine raises its screen on contact and docks it when clear', () => {
  const rules = loadRules();
  rules.rules = { ...rules.rules, aiTeams: [0], startShape: 1, neutralSiloRounds: 0 };
  let state = createInitialState(SEED, rules);
  // Out of sight of each other: no screen, because a screen costs speed.
  for (let i = 0; i <= state.params.aiCadenceTicks; i++) state = apply(state, TICK);
  const out = () => state.units.filter(
    (u) => u.team === 0 && u.kind === 4 && u.state === UNIT_ACTIVE,
  ).length;
  assert.equal(out(), 0, 'the machine screened an empty ocean');

  // Bring the enemy alongside: the screen goes up.
  state.carriers[1].x = state.carriers[0].x + 2000 * 256;
  state.carriers[1].y = state.carriers[0].y;
  for (let i = 0; i <= state.params.aiCadenceTicks; i++) state = apply(state, TICK);
  assert.equal(out(), 4, 'the machine took the seekers bare-hulled');

  // And home again when the enemy is gone.
  state.carriers[1].hull = 0;
  for (let i = 0; i <= state.params.aiCadenceTicks * 2; i++) state = apply(state, TICK);
  assert.equal(out(), 0, 'the machine kept the speed penalty for nothing');
});

test('the machine puts a strip on a mine it has fed', () => {
  const rules = loadRules();
  rules.rules = { ...rules.rules, aiTeams: [0], startShape: 1, neutralSiloRounds: 0 };
  const state = createInitialState(SEED, rules);
  const mine = state.islands[0];
  mine.owner = 0;
  mine.role = 0; // ROLE_RESOURCE
  mine.warehouses = 1;
  mine.stockMaterials = 9000;
  assert.equal(nextBuild(state, mine, state.economy), 6, 'a fed mine should get its strip');
  // A poor mine builds storage instead: a runway with no fuel is a road.
  mine.stockMaterials = 10;
  assert.equal(nextBuild(state, mine, state.economy), 1);
  // And once it has one, it goes back to storage.
  mine.stockMaterials = 9000;
  mine.runway = 1;
  assert.equal(nextBuild(state, mine, state.economy), 1);
});
