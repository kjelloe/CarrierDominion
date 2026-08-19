import test from 'node:test';
import assert from 'node:assert/strict';

import { loadRules } from '../server/rules.js';
import { createInitialState, copyState } from '../engine/state.js';
import { apply } from '../engine/reducer.js';
import { canonicalize } from '../shared/statehash.js';
import { hashState } from '../engine/snapshot.js';
import { EVT_COMMAND_REJECTED, EVT_THROTTLE_SET } from '../engine/events.js';
import { CMD_ADVANCE_TICK } from '../engine/commands.js';

const rules = loadRules();
const TICK = { type: CMD_ADVANCE_TICK };

function freshState() {
  return createInitialState(20260818, rules);
}

test('the initial state passes the canonical hygiene walk', () => {
  assert.doesNotThrow(() => canonicalize(freshState()));
});

test('apply never mutates its input', () => {
  const before = freshState();
  const snapshotOfInput = canonicalize(before);
  apply(before, { type: 'set_throttle', carrierId: 0, throttle: 100 });
  apply(before, TICK);
  assert.equal(canonicalize(before), snapshotOfInput);
});

test('copyState shares no mutable structure with its source', () => {
  const original = freshState();
  const copy = copyState(original);
  assert.notEqual(copy.carriers, original.carriers);
  assert.notEqual(copy.islands, original.islands);
  assert.notEqual(copy.teams, original.teams);
  assert.notEqual(copy.events, original.events);
  assert.notEqual(copy.params, original.params);
  for (let i = 0; i < original.carriers.length; i++) {
    assert.notEqual(copy.carriers[i], original.carriers[i]);
  }
  for (let i = 0; i < original.islands.length; i++) {
    assert.notEqual(copy.islands[i], original.islands[i]);
  }
  copy.carriers[0].x = -12345;
  copy.islands[0].owner = 9;
  copy.teams[0].fuel = 0;
  assert.notEqual(original.carriers[0].x, -12345);
  assert.notEqual(original.islands[0].owner, 9);
  assert.notEqual(original.teams[0].fuel, 0);
});

test('copyState keys match the live state exactly', () => {
  const original = freshState();
  const copy = copyState(original);
  assert.deepEqual(Object.keys(copy).sort(), Object.keys(original).sort());
  assert.deepEqual(
    Object.keys(copy.carriers[0]).sort(),
    Object.keys(original.carriers[0]).sort(),
  );
  assert.deepEqual(Object.keys(copy.islands[0]).sort(), Object.keys(original.islands[0]).sort());
});

test('advance_tick moves exactly one tick', () => {
  let state = freshState();
  assert.equal(state.tick, 0);
  state = apply(state, TICK);
  assert.equal(state.tick, 1);
  state = apply(state, TICK);
  assert.equal(state.tick, 2);
});

test('the same command sequence gives the same hash twice', () => {
  const script = [
    { type: 'set_throttle', carrierId: 0, throttle: 80 },
    TICK, TICK,
    { type: 'set_rudder', carrierId: 0, rudder: 1 },
    TICK, TICK, TICK,
  ];
  let a = freshState();
  let b = freshState();
  for (const command of script) {
    a = apply(a, command);
    b = apply(b, command);
  }
  assert.equal(hashState(a), hashState(b));
});

test('a good command reports its event; a bad one is rejected, not thrown', () => {
  let state = freshState();
  state = apply(state, { type: 'set_throttle', carrierId: 0, throttle: 55 });
  assert.equal(state.events.length, 1);
  assert.equal(state.events[0].code, EVT_THROTTLE_SET);
  assert.equal(state.carriers[0].throttle, 55);

  const bad = [
    { type: 'set_throttle', carrierId: 0, throttle: 101 },
    { type: 'set_throttle', carrierId: 0, throttle: 1.5 },
    { type: 'set_throttle', carrierId: 99, throttle: 10 },
    { type: 'set_rudder', carrierId: 0, rudder: 7 },
    { type: 'set_heading', carrierId: 0, heading: 70000 },
    { type: 'nonsense' },
    {},
  ];
  for (const command of bad) {
    const before = state.carriers[0].throttle;
    state = apply(state, command);
    assert.equal(state.events[0].code, EVT_COMMAND_REJECTED, JSON.stringify(command));
    assert.equal(state.carriers[0].throttle, before);
  }
});

test('the event list belongs to the command that caused it', () => {
  let state = freshState();
  state = apply(state, { type: 'set_throttle', carrierId: 0, throttle: 10 });
  assert.equal(state.events.length, 1);
  state = apply(state, TICK);
  assert.equal(state.events.length, 0, 'a quiet tick reports nothing');
});

test('rudder and heading hold are one authority', () => {
  let state = freshState();
  state = apply(state, { type: 'set_heading', carrierId: 0, heading: 16384 });
  assert.equal(state.carriers[0].headingHold, 16384);
  assert.equal(state.carriers[0].rudder, 0);
  state = apply(state, { type: 'set_rudder', carrierId: 0, rudder: -1 });
  assert.equal(state.carriers[0].rudder, -1);
  assert.equal(state.carriers[0].headingHold, -1);
});
