// Where the decoy screen sits (docs/10 gap 5, built 2026-08-26). The 1988
// original gave the defence drones a whole screen, because WHERE the bait
// rides decides what it baits: a ring round the hull is not the same thing
// as an arc between you and what you are steaming at.

import test from 'node:test';
import assert from 'node:assert/strict';

import { bareRules } from './helpers/rules.mjs';
import { createInitialState } from '../engine/state.js';
import { apply } from '../engine/reducer.js';
import {
  PATTERN_AHEAD,
  PATTERN_ASTERN,
  PATTERN_FLANKS,
  PATTERN_RING,
  SPREAD_TIGHT,
  SPREAD_WIDE,
  patternBearing,
} from '../engine/fleet.js';
import { angleDelta, dist2D } from '../shared/fixed.js';
import { KIND_DECOY } from '../engine/units.js';

const SEED = 20260818;
const TICK = { type: 'advance_tick' };

function fresh() {
  return createInitialState(SEED, bareRules());
}

function screenOut(state) {
  let next = apply(state, { type: 'deploy_decoys', carrierId: 0 });
  next = apply(next, TICK);
  return next;
}

function decoysOf(state) {
  return state.units.filter((u) => u.team === 0 && u.kind === KIND_DECOY
    && u.state === 1);
}

test('the screen defaults to the ring it has always flown', () => {
  const state = fresh();
  assert.equal(state.carriers[0].decoyPattern, PATTERN_RING);
  assert.equal(state.carriers[0].decoySpread, 1000);
});

test('each pattern puts the bait where it says it does', () => {
  // How many sit in the forward half. RING has one dead ahead; AHEAD has all
  // four; ASTERN none; FLANKS straddles each beam, so one of each pair falls
  // forward of it and one aft - which is what "on the beams" means.
  for (const [pattern, ahead] of [
    [PATTERN_RING, 1], [PATTERN_AHEAD, 4], [PATTERN_ASTERN, 0], [PATTERN_FLANKS, 2],
  ]) {
    let state = fresh();
    state = apply(state, {
      type: 'set_decoy_pattern', carrierId: 0, pattern: pattern, spread: 1000,
    });
    state = screenOut(state);
    const carrier = state.carriers[0];
    const decoys = decoysOf(state);
    assert.equal(decoys.length, 4, `pattern ${pattern} put ${decoys.length} decoys out`);

    let forward = 0;
    for (const decoy of decoys) {
      const bam = Math.atan2(decoy.y - carrier.y, decoy.x - carrier.x)
        * (65536 / (Math.PI * 2));
      const off = angleDelta(carrier.heading, ((Math.round(bam) % 65536) + 65536) % 65536);
      if (off > -16384 && off < 16384) forward = forward + 1;
    }
    assert.equal(forward, ahead,
      `pattern ${pattern} put ${forward} decoys forward, not ${ahead}`);
  }
});

test('tight rides closer than wide, and the picture is the setting', () => {
  const spans = {};
  for (const spread of [SPREAD_TIGHT, SPREAD_WIDE]) {
    let state = fresh();
    state = apply(state, {
      type: 'set_decoy_pattern', carrierId: 0, pattern: PATTERN_RING, spread: spread,
    });
    state = screenOut(state);
    const carrier = state.carriers[0];
    let sum = 0;
    for (const decoy of decoysOf(state)) {
      sum = sum + dist2D(carrier.x, carrier.y, decoy.x, decoy.y);
    }
    spans[spread] = sum;
  }
  assert.ok(spans[SPREAD_TIGHT] < spans[SPREAD_WIDE],
    `tight (${spans[SPREAD_TIGHT]}) is not closer in than wide (${spans[SPREAD_WIDE]})`);
});

test('the screen can be moved while it is out - that is the manoeuvre', () => {
  let state = fresh();
  state = screenOut(state);
  const before = decoysOf(state).map((d) => `${d.x},${d.y}`).join('|');
  state = apply(state, {
    type: 'set_decoy_pattern', carrierId: 0, pattern: PATTERN_ASTERN, spread: SPREAD_WIDE,
  });
  state = apply(state, TICK);
  const after = decoysOf(state).map((d) => `${d.x},${d.y}`).join('|');
  assert.notEqual(before, after, 'the bait stayed where it was');
  assert.equal(decoysOf(state).length, 4, 'moving the screen lost a drone');
});

test('a pattern that does not exist is refused', () => {
  let state = fresh();
  state = apply(state, {
    type: 'set_decoy_pattern', carrierId: 0, pattern: 9, spread: 1000,
  });
  assert.equal(state.carriers[0].decoyPattern, PATTERN_RING);
  state = apply(state, {
    type: 'set_decoy_pattern', carrierId: 0, pattern: PATTERN_AHEAD, spread: 99999,
  });
  assert.equal(state.carriers[0].decoyPattern, PATTERN_RING, 'an absurd spread got through');
});

test('the bearings are ship-relative and inside one turn', () => {
  for (let pattern = 0; pattern < 4; pattern++) {
    for (let slot = 0; slot < 4; slot++) {
      const bam = patternBearing(pattern, slot);
      assert.ok(Number.isInteger(bam), `pattern ${pattern} slot ${slot} is not an integer`);
      assert.ok(bam >= 0 && bam < 65536, `pattern ${pattern} slot ${slot} is off the compass`);
    }
  }
});
