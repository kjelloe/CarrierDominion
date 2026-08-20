import test from 'node:test';
import assert from 'node:assert/strict';

import { loadRules } from '../server/rules.js';
import { createInitialState } from '../engine/state.js';
import { apply } from '../engine/reducer.js';
import { createSnapshot } from '../engine/snapshot.js';
import { buildView } from '../shared/view.js';
import { canonicalize } from '../shared/statehash.js';
import { EVT_THROTTLE_SET } from '../engine/events.js';

const rules = loadRules();
const SEED = 20260818;

test('a view carries only the viewing team own hulls when out of radar range', () => {
  const state = createInitialState(SEED, rules);
  const view = buildView(state, 0);
  assert.equal(view.carriers.length, 1);
  assert.equal(view.carriers[0].team, 0);
  assert.equal(view.team, 0);
});

test('an enemy inside radar range appears, but only as a contact', () => {
  const state = createInitialState(SEED, rules);
  state.carriers[1].x = state.carriers[0].x + 1000;
  state.carriers[1].y = state.carriers[0].y;
  const view = buildView(state, 0);
  assert.equal(view.carriers.length, 2);
  const contact = view.carriers.find((c) => c.team === 1);
  assert.equal(contact.contact, 1);
  assert.equal(contact.hull, -1);
  assert.equal(contact.fuel, -1);
  assert.equal(contact.throttle, 0);
  assert.equal(contact.x, state.carriers[1].x, 'position and heading are what radar gives you');
  assert.equal(contact.heading, state.carriers[1].heading);
});

test('a contact disappears again once it slips outside the radar horizon', () => {
  const state = createInitialState(SEED, rules);
  const radar = state.carriers[0].radar;
  state.carriers[1].x = state.carriers[0].x + radar - 10;
  state.carriers[1].y = state.carriers[0].y;
  assert.equal(buildView(state, 0).carriers.length, 2);
  state.carriers[1].x = state.carriers[0].x + radar + 10;
  assert.equal(buildView(state, 0).carriers.length, 1);
});

test('a view never carries another team resources', () => {
  const state = createInitialState(SEED, rules);
  state.teams[1].fuel = 999999;
  const view = buildView(state, 0);
  assert.equal(view.resources.id, 0);
  assert.equal(JSON.stringify(view).includes('999999'), false);
});

test('a view never carries a raw state key', () => {
  const state = createInitialState(SEED, rules);
  const view = buildView(state, 0);
  assert.equal(view.rng, undefined, 'the PRNG state would let a client predict every roll');
  assert.equal(view.rulesHash, undefined);
  assert.equal(view.teams, undefined);
});

test('events reach only the team they concern', () => {
  let state = createInitialState(SEED, rules);
  state = apply(state, { type: 'set_throttle', carrierId: 1, throttle: 70 });
  const own = buildView(state, 1);
  const other = buildView(state, 0);
  assert.equal(own.events.length, 1);
  assert.equal(own.events[0].code, EVT_THROTTLE_SET);
  assert.equal(other.events.length, 0);
});

test('a snapshot carries one view per team plus the hash, and no state', () => {
  const state = createInitialState(SEED, rules);
  const snapshot = createSnapshot(state);
  assert.equal(snapshot.views.length, state.teams.length);
  assert.match(snapshot.stateHash, /^[0-9a-f]{16}$/);
  assert.equal(snapshot.state, undefined);
  assert.equal(snapshot.tick, 0);
});

test('views are hygienic enough to hash and to send as JSON', () => {
  const state = createInitialState(SEED, rules);
  const view = buildView(state, 0);
  assert.doesNotThrow(() => canonicalize(view));
  assert.deepEqual(JSON.parse(JSON.stringify(view)), view);
});

test('score and AI-seat events route by the team in slot a, not the payload in b', () => {
  const state = createInitialState(SEED, rules);
  state.events = [
    { code: 29, a: 1, b: 25, c: 1 }, // team 1 scored 25 for a kill
    { code: 38, a: 0, b: 1, c: 0 }, // team 0's seat went to the machine
  ];
  const view0 = buildView(state, 0);
  const view1 = buildView(state, 1);
  assert.ok(!view0.events.some((e) => e.code === 29), 'team 0 heard team 1 scoring');
  assert.ok(view1.events.some((e) => e.code === 29), 'team 1 never heard its own score');
  assert.ok(view0.events.some((e) => e.code === 38), 'team 0 never heard its seat change hands');
  assert.ok(!view1.events.some((e) => e.code === 38), 'team 1 heard about a seat not its own');
});

test('a conversion and a sinking are chart-level news for everybody', () => {
  const state = createInitialState(SEED, rules);
  state.events = [
    { code: 36, a: 3, b: 1, c: 0 }, // island 3 converted to team 1
    { code: 21, a: 0, b: 0, c: 0 }, // team 0's carrier went down
  ];
  for (const team of [0, 1]) {
    const view = buildView(state, team);
    assert.ok(view.events.some((e) => e.code === 36), `team ${team} did not hear the conversion`);
    assert.ok(view.events.some((e) => e.code === 21), `team ${team} did not hear the sinking`);
  }
});
