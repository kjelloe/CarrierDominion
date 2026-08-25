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
import { payloadGramsOf } from '../engine/payload.js';
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

test('a table is never larger than its archipelago', () => {
  // Third review finding 7: 4 islands with 16 carriers passed the lobby and
  // handed most seats a war with nothing in it. The clamp lives in the fold,
  // so it is hashed and every path agrees.
  const rules = loadRules();
  const chosen = applyLobbyOptions(rules, {
    seed: SEED, islands: 4, teams: 16, enemy: 0, ending: 0, speed: 1, game: 0, aiTeams: [],
  });
  assert.equal(chosen.world.islandCount, 16, 'the archipelago should rise to the table');
  const state = createInitialState(SEED, chosen);
  assert.equal(state.islands.length, 16);
  assert.equal(state.carriers.length, 16);
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

// The squadron batch added five systems that all carry per-hull or
// per-carrier state (payload budgets, the deck cycle, typed pods, routes,
// decoy patterns). Ruling #9 says nothing may hard-code two teams, and a
// rule that only matters at three is exactly the one that gets it wrong
// invisibly - so the whole table is swept rather than sampled.
test('the newest systems are per-hull and per-ship, at a full table', () => {
  const big = loadRules();
  big.rules = { ...big.rules, teamCount: 16, aiTeams: [] };
  big.world = { ...big.world, islandCount: 64 };
  let state = createInitialState(SEED, big);
  assert.equal(state.carriers.length, 16);

  // Every ship has its own screen setting, and every hull that carries
  // stores has a budget it is inside.
  for (const carrier of state.carriers) {
    assert.equal(carrier.decoyPattern, 0, `carrier ${carrier.id} started off-pattern`);
    assert.equal(carrier.decoySpread, 1000);
    assert.deepEqual(carrier.route, [], `carrier ${carrier.id} started with a course`);
  }
  for (const unit of state.units) {
    assert.deepEqual(unit.route, [], `unit ${unit.id} started with a course`);
    assert.equal(unit.deckTicks, 0);
    if (unit.payloadMaxGrams <= 0) continue;
    assert.ok(payloadGramsOf(unit, state.weapons) <= unit.payloadMaxGrams,
      `unit ${unit.id} of team ${unit.team} sailed over its budget`);
  }

  // And a change to one seat's screen is a change to that seat only.
  state = apply(state, {
    type: 'set_decoy_pattern', carrierId: 7, pattern: 2, spread: 600,
  });
  for (const carrier of state.carriers) {
    const want = carrier.id === 7 ? 2 : 0;
    assert.equal(carrier.decoyPattern, want,
      `setting seat 7's screen moved seat ${carrier.id}'s`);
  }

  // A course laid for one seat's hull belongs to that hull alone.
  const mine = state.units.find((u) => u.team === 3 && u.kind === 0);
  state = apply(state, { type: 'launch_unit', carrierId: 3, kind: 0 });
  for (let i = 0; i < state.params.deckRangeTicks + state.params.launchTicks + 4; i++) {
    state = apply(state, { type: 'advance_tick' });
  }
  const away = state.units.find((u) => u.team === 3 && u.kind === 0 && u.state === 1);
  assert.notEqual(away, undefined, 'seat 3 never got a Manta off the deck');
  state = apply(state, {
    type: 'set_route', unitId: away.id, points: [away.x + 3000, away.y + 3000],
  });
  let withRoutes = 0;
  for (const unit of state.units) if (unit.route.length > 0) withRoutes += 1;
  assert.equal(withRoutes, 1, `${withRoutes} hulls took one seat's course`);
  assert.ok(mine !== undefined);
});
