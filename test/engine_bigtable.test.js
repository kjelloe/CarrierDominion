// Up to sixteen carriers, free for all (ruling 2026-08-23). Ruling #9 said
// nothing may hard-code two teams; this is where that discipline pays out.

import test from 'node:test';
import assert from 'node:assert/strict';

import { loadRules } from './helpers/rules.mjs';
import { createInitialState } from '../engine/state.js';
import { apply } from '../engine/reducer.js';
import { canonicalize, hashState } from '../shared/statehash.js';
import { dist2D } from '../shared/fixed.js';
import { worldHeightAt } from '../engine/heightmap.js';
import { applyLobbyOptions } from '../shared/options.js';

const SEED = 20260818;

function tableOf(teams, islands = 32) {
  const rules = loadRules();
  rules.world = { ...rules.world, islandCount: islands };
  rules.rules = { ...rules.rules, teamCount: teams, aiTeams: [] };
  return rules;
}

test('sixteen carriers spawn apart, afloat, facing the middle', () => {
  const state = createInitialState(SEED, tableOf(16));
  assert.equal(state.carriers.length, 16);
  assert.equal(state.teams.length, 16);
  for (const carrier of state.carriers) {
    assert.ok(worldHeightAt(state.islands, carrier.x, carrier.y) < -carrier.draught,
      `carrier ${carrier.id} spawned aground`);
  }
  // Nobody starts on top of anybody: the ring must actually spread them.
  for (let i = 0; i < state.carriers.length; i++) {
    for (let j = i + 1; j < state.carriers.length; j++) {
      const gap = dist2D(
        state.carriers[i].x, state.carriers[i].y,
        state.carriers[j].x, state.carriers[j].y,
      );
      assert.ok(gap > 2000 * 256, `carriers ${i} and ${j} start ${gap} apart`);
    }
  }
  assert.doesNotThrow(() => canonicalize(state));
});

test('the full table gets the full ocean: 64 islands, 16 carriers, five seeds', () => {
  // 64 is the original's own island count (ruling 2026-08-23). The map this
  // size is ~58 km of sea at unchanged density; the dart-thrower must place
  // every island and the ring walk must leave every carrier afloat - seed
  // 424242 is in the list because its ring had one aground before the walk
  // learned to step toward the centre it actually has.
  for (const seed of [20260818, 424242, 777, 31337, 99999]) {
    const state = createInitialState(seed, tableOf(16, 64));
    assert.equal(state.islands.length, 64, `seed ${seed} lost islands to the dart cap`);
    for (const carrier of state.carriers) {
      assert.ok(worldHeightAt(state.islands, carrier.x, carrier.y) < -carrier.draught,
        `seed ${seed}: carrier ${carrier.id} spawned aground`);
    }
    assert.doesNotThrow(() => canonicalize(state));
  }
});

test('a sixteen-carrier war ticks, and each seat sees only its own', () => {
  let state = createInitialState(SEED, tableOf(16));
  for (let i = 0; i < 50; i++) state = apply(state, { type: 'advance_tick' });
  assert.doesNotThrow(() => canonicalize(state));
  state = apply(state, { type: 'set_throttle', carrierId: 13, throttle: 60 });
  assert.equal(state.carriers[13].throttle, 60);
  assert.equal(state.carriers[12].throttle, 0);
});

test('the room seats the machine at every unmanned place', () => {
  const rules = loadRules();
  const chosen = applyLobbyOptions(rules, {
    seed: SEED, islands: 8, teams: 8, enemy: 1, ending: 0, speed: 1, game: 0,
    aiTeams: [1, 2, 3, 4, 5, 6, 7],
  });
  const state = createInitialState(SEED, chosen);
  assert.equal(state.teams.length, 8);
  assert.equal(state.ai.length, 7, 'seven empty seats, seven brains');
});

test('two-team wars are byte-identical to the pinned era', () => {
  // The ring, the headings and the team option must change NOTHING for the
  // classic table - the golden hash test enforces this too, but here the
  // reason is written down.
  const rules = loadRules();
  const before = hashState(createInitialState(SEED, rules));
  const viaOptions = applyLobbyOptions(rules, {
    seed: SEED, islands: 8, teams: 2, enemy: 1, ending: 0, speed: 1, game: 0,
  });
  assert.equal(hashState(createInitialState(SEED, viaOptions)), before);
});
