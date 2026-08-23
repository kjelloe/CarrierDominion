// The Action Game (ruling 2026-08-23): the 1988 quick start - a developed war
// at tick zero, deterministic, hashed with the rules like any other rule.

import test from 'node:test';
import assert from 'node:assert/strict';

import { loadRules, withoutAi } from './helpers/rules.mjs';
import { createInitialState } from '../engine/state.js';
import { apply } from '../engine/reducer.js';
import { canonicalize, hashState } from '../shared/statehash.js';
import { dist2D } from '../shared/fixed.js';
import { worldHeightAt } from '../engine/heightmap.js';
import { ROLE_DEFENCE, ROLE_FACTORY, ROLE_RESOURCE } from '../engine/island.js';

const SEED = 20260818;

function actionRules() {
  const rules = withoutAi(loadRules());
  rules.rules = { ...rules.rules, actionStart: 1 };
  return rules;
}

test('the action start is a developed war: islands owned, roles set, guns up', () => {
  const state = createInitialState(SEED, actionRules());
  for (const team of state.teams) {
    const owned = state.islands.filter((i) => i.owner === team.id);
    assert.ok(owned.length >= 2, `team ${team.id} starts with ${owned.length} islands`);
    const plant = owned.find((i) => i.role === ROLE_FACTORY);
    assert.notEqual(plant, undefined, 'no stocked factory island');
    assert.ok(plant.factories >= 2 && plant.stockFuel > 0);
    assert.equal(team.stockpileIsland, plant.id, 'the depot must start at the plant');
    assert.notEqual(owned.find((i) => i.role === ROLE_RESOURCE), undefined);
  }
  // Guns exist where a defence island was dealt.
  const forts = state.islands.filter((i) => i.role === ROLE_DEFENCE);
  for (const fort of forts) {
    assert.equal(state.turrets.filter((t) => t.island === fort.id).length, fort.turrets);
  }
  // Some of the archipelago is still nobody's: the race is shortened, not gone.
  assert.ok(state.islands.some((i) => i.owner === -1), 'nothing left to take');
  assert.doesNotThrow(() => canonicalize(state));
});

test('the carriers start closer, in open water, with supply running', () => {
  const strategy = createInitialState(SEED, withoutAi(loadRules()));
  const action = createInitialState(SEED, actionRules());
  const far = dist2D(
    strategy.carriers[0].x, strategy.carriers[0].y,
    strategy.carriers[1].x, strategy.carriers[1].y,
  );
  const near = dist2D(
    action.carriers[0].x, action.carriers[0].y,
    action.carriers[1].x, action.carriers[1].y,
  );
  assert.ok(near < far, 'the action start did not shorten the crossing');
  for (const carrier of action.carriers) {
    assert.ok(worldHeightAt(action.islands, carrier.x, carrier.y) < -carrier.draught,
      'a nudged carrier starts aground');
    assert.equal(carrier.supplyRun, 1);
  }
});

test('the flag is a rule: same seed, different war, different hash - deterministically', () => {
  const a = createInitialState(SEED, actionRules());
  const b = createInitialState(SEED, actionRules());
  assert.equal(hashState(a), hashState(b), 'the action start is not deterministic');
  const strategy = createInitialState(SEED, withoutAi(loadRules()));
  assert.notEqual(hashState(a), hashState(strategy));
  assert.notEqual(a.rulesHash, strategy.rulesHash, 'two different wars wore one ruleset stamp');
});

test('an action war runs: the economy breathes from the first accrual', () => {
  let state = createInitialState(SEED, actionRules());
  const before = state.islands
    .filter((i) => i.owner === 0)
    .reduce((sum, i) => sum + i.stockFuel, 0);
  for (let i = 0; i < 120; i++) state = apply(state, { type: 'advance_tick' });
  const after = state.islands
    .filter((i) => i.owner === 0)
    .reduce((sum, i) => sum + i.stockFuel, 0);
  assert.ok(after > before, 'a stocked plant with materials made no fuel');
});
