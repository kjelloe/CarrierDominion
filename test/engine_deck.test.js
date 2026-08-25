// The deck cycle (ruled 2026-08-25, "full cycle incl. the lift"): launching
// is an operation, not a keystroke.
//
//   IN HANGER -> ON FLIGHT DECK -> LAUNCHING -> away
//   DOCKING   -> IN DOCK
//
// The lift is the MIDSHIP section, so wrecking it strands the air group
// below decks - which is why the original listed LIFT on its repair screen.

import test from 'node:test';
import assert from 'node:assert/strict';

import { loadRules, withoutAi, instantDeck } from './helpers/rules.mjs';
import { createInitialState } from '../engine/state.js';
import { apply } from '../engine/reducer.js';
import { deckProgressPermil } from '../engine/deck.js';
import {
  KIND_MANTA,
  UNIT_ACTIVE,
  UNIT_DOCKING,
  UNIT_LAUNCHING,
  UNIT_ON_DECK,
  UNIT_STOWED,
} from '../engine/units.js';
import { SECTION_MIDSHIP } from '../engine/damage.js';

const SEED = 20260818;
const TICK = { type: 'advance_tick' };

function fresh() {
  return createInitialState(SEED, withoutAi(loadRules()));
}

function drive(state, ticks) {
  let next = state;
  for (let i = 0; i < ticks; i++) next = apply(next, TICK);
  return next;
}

function mantaOf(state) {
  return state.units.find((u) => u.team === 0 && u.kind === KIND_MANTA);
}

test('a Manta rides the lift, ranges on deck, and only then goes away', () => {
  let state = fresh();
  const id = mantaOf(state).id;
  const at = () => state.units.find((u) => u.id === id);

  state = apply(state, { type: 'launch_unit', carrierId: 0, kind: KIND_MANTA });
  assert.equal(at().state, UNIT_ON_DECK, 'the order did not start the cycle');
  assert.equal(at().deckTicks, 0);

  state = drive(state, state.params.deckRangeTicks);
  assert.equal(at().state, UNIT_LAUNCHING, 'she never reached the ramp');

  state = drive(state, state.params.launchTicks);
  assert.equal(at().state, UNIT_ACTIVE, 'she never left the ramp');

  // And the launched event arrives when she is AWAY, not when the order was
  // given: a signals log that says otherwise is telling the war a lie.
  const away = state.events.find((e) => e.code === 8);
  assert.notEqual(away, undefined, 'no launch was announced');
});

test('the progress bar fills across each leg', () => {
  let state = fresh();
  const id = mantaOf(state).id;
  state = apply(state, { type: 'launch_unit', carrierId: 0, kind: KIND_MANTA });
  const start = deckProgressPermil(state.units.find((u) => u.id === id), state.params);
  assert.equal(start, 0);

  state = drive(state, Math.floor(state.params.deckRangeTicks / 2));
  const half = deckProgressPermil(state.units.find((u) => u.id === id), state.params);
  assert.ok(half > 300 && half < 700, `half way through the lift read ${half} permil`);
});

test('ABORT sends her below from anywhere in the cycle', () => {
  let state = fresh();
  const id = mantaOf(state).id;
  const at = () => state.units.find((u) => u.id === id);

  state = apply(state, { type: 'launch_unit', carrierId: 0, kind: KIND_MANTA });
  state = drive(state, 10);
  state = apply(state, { type: 'abort_deck', unitId: id });
  assert.equal(at().state, UNIT_STOWED, 'ABORT left her on the roof');
  assert.equal(at().deckTicks, 0, 'the clock kept running after the abort');

  // On the ramp too.
  state = apply(state, { type: 'launch_unit', carrierId: 0, kind: KIND_MANTA });
  state = drive(state, state.params.deckRangeTicks);
  assert.equal(at().state, UNIT_LAUNCHING);
  state = apply(state, { type: 'abort_deck', unitId: id });
  assert.equal(at().state, UNIT_STOWED);

  // But a craft already away is a recall, not an abort.
  state = apply(state, { type: 'launch_unit', carrierId: 0, kind: KIND_MANTA });
  state = drive(state, state.params.deckRangeTicks + state.params.launchTicks);
  assert.equal(at().state, UNIT_ACTIVE);
  const before = at().state;
  state = apply(state, { type: 'abort_deck', unitId: id });
  assert.equal(at().state, before, 'ABORT reached out and grabbed a flying Manta');
});

test('a wrecked lift strands the air group below decks', () => {
  let state = fresh();
  const carrier = state.carriers[0];
  carrier.sections[SECTION_MIDSHIP].hp = 0;
  const id = mantaOf(state).id;

  state = apply(state, { type: 'launch_unit', carrierId: 0, kind: KIND_MANTA });
  assert.equal(state.units.find((u) => u.id === id).state, UNIT_STOWED,
    'a wrecked hangar still put a Manta on the roof');
});

test('the lift stopping mid-cycle holds her on deck rather than losing her', () => {
  let state = fresh();
  const id = mantaOf(state).id;
  const at = () => state.units.find((u) => u.id === id);
  state = apply(state, { type: 'launch_unit', carrierId: 0, kind: KIND_MANTA });
  state = drive(state, 5);
  state.carriers[0].sections[SECTION_MIDSHIP].hp = 0;
  // And no materials, or the yard mends the lift while we are watching -
  // which it should, and does, and is a different test.
  state.carriers[0].materials = 0;
  const held = at().deckTicks;
  state = drive(state, 40);
  assert.equal(at().state, UNIT_ON_DECK, 'a stopped lift lost the aircraft');
  assert.equal(at().deckTicks, held, 'a stopped lift kept counting');
});

test('coming aboard is an approach, and drifting out of it means going round again', () => {
  let state = fresh();
  const id = mantaOf(state).id;
  const at = () => state.units.find((u) => u.id === id);
  state = apply(state, { type: 'launch_unit', carrierId: 0, kind: KIND_MANTA });
  state = drive(state, state.params.deckRangeTicks + state.params.launchTicks);
  assert.equal(at().state, UNIT_ACTIVE);

  state = apply(state, { type: 'recall_unit', unitId: id });
  const carrier = state.carriers[0];
  at().x = carrier.x;
  at().y = carrier.y;
  state = drive(state, 1);
  assert.equal(at().state, UNIT_DOCKING, 'she snapped aboard instead of flying an approach');

  // Out of the envelope and the approach is abandoned.
  at().x = carrier.x + state.params.recoverRange * 4;
  state = drive(state, 1);
  assert.notEqual(at().state, UNIT_DOCKING, 'she docked from outside the envelope');

  // Back in, and she completes.
  at().x = carrier.x;
  at().y = carrier.y;
  state = drive(state, state.params.dockTicks + 4);
  assert.equal(at().state, UNIT_STOWED, 'she never came aboard');
});

test('with the cycle configured off, launch means launched in the same command', () => {
  let state = createInitialState(SEED, instantDeck(withoutAi(loadRules())));
  const id = mantaOf(state).id;
  state = apply(state, { type: 'launch_unit', carrierId: 0, kind: KIND_MANTA });
  assert.equal(state.units.find((u) => u.id === id).state, UNIT_ACTIVE,
    'a zero-length cycle still cost a tick');
  assert.notEqual(state.events.find((e) => e.code === 8), undefined);
});
