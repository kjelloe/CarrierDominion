// The home island (proposal 3a, ruled 2026-08-25): the original's Base. The
// Strategy game starts each team on one developed island - a plant, a
// runway, two guns, a modest stock, the depot nomination, supply running -
// so the opening race is for the SECOND island, not the first pod.

import test from 'node:test';
import assert from 'node:assert/strict';

import { loadRules, withoutAi, bareRules } from './helpers/rules.mjs';
import { createInitialState } from '../engine/state.js';
import { canonicalize } from '../shared/statehash.js';
import { dist2D } from '../shared/fixed.js';
import { ROLE_FACTORY } from '../engine/island.js';

const SEED = 20260818;

test('each team starts on a developed base: plant, strip, guns, stock, depot', () => {
  const state = createInitialState(SEED, withoutAi(loadRules()));
  for (const team of state.teams) {
    const home = state.islands.find((island) => island.owner === team.id);
    assert.notEqual(home, undefined, `team ${team.id} has no home`);
    assert.equal(home.role, ROLE_FACTORY);
    assert.equal(home.factories, 1);
    assert.equal(home.runway, 1);
    assert.equal(home.turrets, 2);
    assert.ok(home.nodeHp > 0, 'a base without a command centre is a campsite');
    assert.ok(home.stockFuel > 0 && home.stockMaterials > 0);
    assert.equal(team.stockpileIsland, home.id);
    const carrier = state.carriers.find((c) => c.team === team.id);
    assert.equal(carrier.supplyRun, 1, 'the base supplies its ship from tick one');
    // The home is the NEAREST island - the base you anchor off, not a colony.
    for (const other of state.islands) {
      if (other.id === home.id) continue;
      assert.ok(
        dist2D(carrier.x, carrier.y, home.x, home.y)
          <= dist2D(carrier.x, carrier.y, other.x, other.y),
        `team ${team.id} home is not its nearest island`,
      );
    }
  }
  assert.doesNotThrow(() => canonicalize(state));
});

test('bare rules still give the blank ocean the engine tests build on', () => {
  const state = createInitialState(SEED, bareRules());
  assert.equal(state.islands.filter((island) => island.owner !== -1).length, 0);
});

test('the action game keeps its own estates - no double home', () => {
  const rules = withoutAi(loadRules());
  rules.rules = { ...rules.rules, actionStart: 1 };
  const state = createInitialState(SEED, rules);
  // Round-robin estates only: 2 islands per team on the 8-island sea
  // (share = max(2, floor(8/3))), not 2 + an extra home.
  for (const team of state.teams) {
    const held = state.islands.filter((island) => island.owner === team.id);
    assert.equal(held.length, 2, `team ${team.id} holds ${held.length}`);
  }
});
