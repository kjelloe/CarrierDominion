// The fitting screen's constraint (ruled 2026-08-25, "the full 1988 model"):
// a hull has a PAYLOAD WEIGHT budget and every store has a weight, so what
// goes under the wing is a decision rather than a preset. The numbers are
// the original's where the original stated them - the ACCB pod is 400 kg,
// an air-to-air missile 60.

import test from 'node:test';
import assert from 'node:assert/strict';

import { loadRules, withoutAi } from './helpers/rules.mjs';
import { createInitialState } from '../engine/state.js';
import { apply } from '../engine/reducer.js';
import {
  payloadGramsOf,
  payloadFullGramsOf,
  payloadRoomGrams,
  roundsThatFit,
} from '../engine/payload.js';
import { KIND_MANTA, KIND_WALRUS, UNIT_ACTIVE } from '../engine/units.js';

const SEED = 20260818;

function fresh() {
  return createInitialState(SEED, withoutAi(loadRules()));
}

function hullOf(state, kind) {
  return state.units.find((unit) => unit.team === 0 && unit.kind === kind);
}

function kg(state, unit) {
  return payloadGramsOf(unit, state.weapons) / 1000;
}

test('a full Manta fit is exactly its budget - the brim, not an overload', () => {
  const state = fresh();
  const manta = hullOf(state, KIND_MANTA);
  assert.equal(manta.payloadMaxGrams, 750 * 1000, 'the Manta budget moved');
  assert.equal(payloadFullGramsOf(manta, state.weapons), manta.payloadMaxGrams,
    'a brim-full Manta no longer weighs exactly what it may carry');
  assert.equal(kg(state, manta), 750);
  assert.equal(payloadRoomGrams(manta, state.weapons), 0);
  assert.equal(roundsThatFit(manta, state.weapons, 3), 0, 'a full hull took another missile');
});

test('a Walrus carries one capture device, never both', () => {
  const state = fresh();
  const walrus = hullOf(state, KIND_WALRUS);
  assert.equal(walrus.payloadMaxGrams, 2000 * 1000);
  assert.equal(walrus.pod, 1);
  assert.equal(walrus.virus, 0);
  // Guns and mines 1,400 + the pod 400 = 1,800 of 2,000. The bomb is 300.
  assert.equal(kg(state, walrus), 1800);
  assert.ok(walrus.virusGrams > payloadRoomGrams(walrus, state.weapons),
    'the bomb fits after all, so nothing is being chosen between');
});

test('the fitting screen moves stores both ways, and the hold is paid back', () => {
  let state = fresh();
  const walrus = hullOf(state, KIND_WALRUS);
  const ordnanceBefore = state.carriers[0].ordnance;
  const mine = state.weapons[walrus.arms[1].w];

  state = apply(state, { type: 'set_station', unitId: walrus.id, station: 1, rounds: 0 });
  let now = state.units.find((u) => u.id === walrus.id);
  assert.equal(now.arms[1].n, 0, 'the mines did not come off');
  assert.equal(state.carriers[0].ordnance,
    ordnanceBefore + 4 * mine.ordnancePerRound,
    'landed stores were thrown overboard rather than returned to the hold');

  state = apply(state, { type: 'set_station', unitId: walrus.id, station: 1, rounds: 4 });
  now = state.units.find((u) => u.id === walrus.id);
  assert.equal(now.arms[1].n, 4);
  assert.equal(state.carriers[0].ordnance, ordnanceBefore, 'refitting was not charged');
});

test('the budget, not the magazine, is what stops a fit', () => {
  let state = fresh();
  const walrus = hullOf(state, KIND_WALRUS);
  // Land the mines, take the bomb instead: 1,360 + 300 = 1,660, so there is
  // room for some mines back but not all four (4 x 110 = 440 > 340).
  state = apply(state, { type: 'set_station', unitId: walrus.id, station: 1, rounds: 0 });
  state = apply(state, { type: 'set_device', unitId: walrus.id, device: 1, fitted: 1 });
  state = apply(state, { type: 'set_station', unitId: walrus.id, station: 1, rounds: 4 });
  const now = state.units.find((u) => u.id === walrus.id);
  assert.equal(now.virus, 1);
  assert.equal(now.arms[1].n, 3, 'the hull lifted a fourth mine it has no weight for');
  assert.ok(payloadGramsOf(now, state.weapons) <= now.payloadMaxGrams);
});

test('outfitting happens in the hangar, not over the sea', () => {
  let state = fresh();
  const manta = hullOf(state, KIND_MANTA);
  manta.state = UNIT_ACTIVE;
  manta.arms[3].n = 0;
  state = apply(state, { type: 'set_station', unitId: manta.id, station: 3, rounds: 4 });
  const now = state.units.find((u) => u.id === manta.id);
  assert.equal(now.arms[3].n, 0, 'a Manta over the sea grew a missile');
});

test('a station that does not exist is refused, not created', () => {
  let state = fresh();
  const manta = hullOf(state, KIND_MANTA);
  const before = manta.arms.length;
  state = apply(state, { type: 'set_station', unitId: manta.id, station: 9, rounds: 1 });
  const now = state.units.find((u) => u.id === manta.id);
  assert.equal(now.arms.length, before);
});

test('every hull that carries stores has a budget it can actually meet', () => {
  const state = fresh();
  for (const unit of state.units) {
    if (unit.arms.length === 0) continue;
    const full = payloadFullGramsOf(unit, state.weapons);
    if (full === 0) continue; // ship and island mounts weigh nothing
    assert.ok(unit.payloadMaxGrams > 0,
      `unit kind ${unit.kind} carries weighted stores with no budget`);
    assert.ok(payloadGramsOf(unit, state.weapons) <= unit.payloadMaxGrams,
      `unit kind ${unit.kind} leaves the shipyard over its own budget`);
  }
});
