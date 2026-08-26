// The sky, as a function of the war (owner's ask, 2026-08-26).
//
// The property that makes this design work is that weather is a PURE
// FUNCTION of (seed, tick) and is stored nowhere: every client in a LAN
// game and every replay sees the same sky at the same moment, the state
// hash never carries it, and the engine may still read it - which it does,
// for radar.

import test from 'node:test';
import assert from 'node:assert/strict';

import { loadRules, bareRules } from './helpers/rules.mjs';
import { createInitialState } from '../engine/state.js';
import { apply } from '../engine/reducer.js';
import { hashState } from '../engine/snapshot.js';
import { buildView } from '../shared/view.js';
import { DAY_TICKS, radarPermilFor, weatherAt } from '../shared/weather.js';
import { sensorReach } from '../engine/contacts.js';

const SEED = 20260818;

test('the same seed and tick always give the same sky', () => {
  for (const tick of [0, 1, 999, 36000, 123456]) {
    const a = weatherAt(SEED, tick);
    const b = weatherAt(SEED, tick);
    assert.deepEqual(a, b);
  }
  // And a different war has different weather.
  const here = weatherAt(1, 30000);
  const there = weatherAt(2, 30000);
  assert.notDeepEqual(here, there, 'two seeds produced the same sky');
});

test('every figure the sky reports is an integer inside its range', () => {
  for (let tick = 0; tick < DAY_TICKS * 3; tick += 137) {
    const w = weatherAt(SEED, tick);
    for (const [key, value] of Object.entries(w)) {
      assert.ok(Number.isInteger(value), `${key} is not an integer at tick ${tick}`);
    }
    assert.ok(w.sunBam >= 0 && w.sunBam < 65536, 'the sun left the compass');
    assert.ok(w.windBam >= 0 && w.windBam < 65536, 'the wind left the compass');
    for (const key of ['dayPermil', 'windPermil', 'cloudPermil', 'stormPermil', 'flashPermil']) {
      assert.ok(w[key] >= 0 && w[key] <= 1000, `${key} out of range at tick ${tick}`);
    }
  }
});

test('the sun crosses, and it is never completely dark', () => {
  let high = -10000;
  let low = 10000;
  let darkest = 10000;
  for (let tick = 0; tick < DAY_TICKS; tick += 60) {
    const w = weatherAt(SEED, tick);
    if (w.sunHeightPermil > high) high = w.sunHeightPermil;
    if (w.sunHeightPermil < low) low = w.sunHeightPermil;
    if (w.dayPermil < darkest) darkest = w.dayPermil;
  }
  assert.ok(high > 700, `the sun only reached ${high} - it should climb`);
  assert.ok(low < 0, `the sun never set (lowest ${low})`);
  // The owner's ask, in one assertion: no complete darkness.
  assert.ok(darkest > 100, `midnight fell to ${darkest} - it must stay lit`);
});

test('the weather drifts rather than flickers', () => {
  // A front is twenty minutes; nothing may lurch from one tick to the next.
  let worst = 0;
  let previous = weatherAt(SEED, 0);
  for (let tick = 1; tick < 120000; tick += 1) {
    const now = weatherAt(SEED, tick);
    const step = Math.abs(now.cloudPermil - previous.cloudPermil);
    if (step > worst) worst = step;
    previous = now;
  }
  assert.ok(worst <= 2, `cloud jumped ${worst} per-mil in one tick`);
});

test('lightning only strikes in a storm, and it is a stroke not a lamp', () => {
  let inStorm = 0;
  let inCalm = 0;
  let longest = 0;
  let run = 0;
  for (let tick = 0; tick < 200000; tick += 1) {
    const w = weatherAt(SEED, tick);
    if (w.flashPermil > 0) {
      run += 1;
      if (run > longest) longest = run;
      if (w.stormPermil > 0) inStorm += 1;
      else inCalm += 1;
    } else {
      run = 0;
    }
  }
  assert.equal(inCalm, 0, 'lightning out of a clear sky');
  assert.ok(inStorm > 0, 'no lightning in 200,000 ticks of weather');
  assert.ok(longest <= 10, `a flash lasted ${longest} ticks - that is a lamp`);
});

// --- the one wired effect ---------------------------------------------------

test('a storm shortens the radar picture, and never below its floor', () => {
  const clear = { stormPermil: 0 };
  const worst = { stormPermil: 1000 };
  assert.equal(radarPermilFor(clear, 700), 1000, 'clear weather cost range');
  assert.equal(radarPermilFor(worst, 700), 700, 'the worst storm broke the floor');
  // And the floor is a rule, not a constant in the code.
  assert.equal(radarPermilFor(worst, 500), 500);
});

test('every sensor in the war reaches the same shortened distance', () => {
  const rules = bareRules();
  const state = createInitialState(SEED, rules);
  const carrier = state.carriers[0];
  const base = carrier.radar;

  // Find a tick inside a storm for this seed, then compare.
  let stormTick = -1;
  for (let tick = 0; tick < 200000; tick += 100) {
    if (weatherAt(state.seed, tick).stormPermil > 800) {
      stormTick = tick;
      break;
    }
  }
  assert.notEqual(stormTick, -1, 'this seed never storms - pick another');

  const calm = { ...state, tick: 0 };
  const rough = { ...state, tick: stormTick };
  assert.equal(sensorReach(calm, carrier), base, 'a calm sea cost the set range');
  assert.ok(sensorReach(rough, carrier) < base, 'the storm cost the set nothing');
  assert.ok(sensorReach(rough, carrier) >= Math.floor(base * 700 / 1000) - 1,
    'the storm took more than the floor allows');
});

test('the sky is in the view, and it is the same sky for both sides', () => {
  const state = createInitialState(SEED, loadRules());
  const mine = buildView(state, 0);
  const theirs = buildView(state, 1);
  assert.notEqual(mine.weather, undefined, 'the view carries no weather');
  assert.deepEqual(mine.weather, theirs.weather,
    'two seats in one war saw different weather');
  assert.deepEqual(mine.weather, weatherAt(state.seed, state.tick));
});

test('the weather is nowhere in the state, so it cannot move the hash', () => {
  // The whole design rests on this: the sky is derived, never stored. If it
  // ever creeps into a record, the canonical walk will find it here.
  const state = createInitialState(SEED, loadRules());
  const text = JSON.stringify(state);
  for (const key of ['weather', 'cloudPermil', 'stormPermil', 'windBam', 'flashPermil']) {
    assert.equal(text.includes(key), false, `the state carries ${key}`);
  }
  // And ticking does not make the hash depend on anything but the reducer:
  // two states built the same way hash the same, weather and all.
  const twin = createInitialState(SEED, loadRules());
  let a = state;
  let b = twin;
  for (let i = 0; i < 40; i++) {
    a = apply(a, { type: 'advance_tick' });
    b = apply(b, { type: 'advance_tick' });
  }
  assert.equal(hashState(a), hashState(b));
});
