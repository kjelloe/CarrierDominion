// The seam between the weather and the war (rulings of 2026-08-26).
//
// The weather is a pure function of (seed, tick) that the ENGINE is allowed to
// read - that is what makes it a rule rather than a screensaver, and it is
// also the one thing that could quietly break determinism. Two clients in one
// LAN war agree about the sky only for as long as nobody teaches the engine to
// ask the weather about anything except the war's own seed and its own tick.
//
// The client has a `?weather=<tick>` debug override that freezes the sky for
// screenshots. It rewrites the client's copy of the VIEW and nothing else. If
// a value like that ever reached the reducer the whole design would come
// apart silently - every player would see a different war and the hashes would
// diverge with no obvious culprit. These tests are the tripwire.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadRules, bareRules } from './helpers/rules.mjs';
import { createInitialState } from '../engine/state.js';
import { apply } from '../engine/reducer.js';
import { hashState } from '../shared/statehash.js';
import { buildView } from '../shared/view.js';
import { weatherAt } from '../shared/weather.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const SEED = 20260818;

test('the engine only ever asks the weather about its own seed and tick', () => {
  // Every call in engine/ must read (state.seed, state.tick) and nothing
  // else. A call taking a parameter, a field, or a command's payload would
  // make the sky an input rather than a derivation.
  const allowed = [
    'weatherAt(state.seed, state.tick)',
  ];
  const offenders = [];
  for (const name of readdirSync(join(ROOT, 'engine'))) {
    if (!name.endsWith('.js')) continue;
    const text = readFileSync(join(ROOT, 'engine', name), 'utf8');
    let at = text.indexOf('weatherAt(');
    while (at !== -1) {
      const end = text.indexOf(')', at);
      const call = text.slice(at, end + 1);
      if (!allowed.includes(call)) offenders.push(`engine/${name}: ${call}`);
      at = text.indexOf('weatherAt(', at + 1);
    }
  }
  assert.deepEqual(offenders, [],
    `the engine asked the weather about something other than its own war: ${offenders.join('; ')}.`
    + ' The sky must stay a pure function of (seed, tick) or a LAN war cannot agree about it.');
});

test('nothing below the client reads a weather override', () => {
  // The debug freeze lives in client/main.js and may live nowhere else.
  for (const folder of ['engine', 'shared', 'server']) {
    for (const name of readdirSync(join(ROOT, folder))) {
      if (!name.endsWith('.js')) continue;
      const text = readFileSync(join(ROOT, folder, name), 'utf8');
      assert.equal(text.includes('weatherTick'), false,
        `${folder}/${name} reads a weather override; only the client may`);
    }
  }
});

test('a war hashes the same however the sky is going', () => {
  // Two wars from the same seed, stepped the same way, must agree tick for
  // tick - through dawn, storm and night alike. If the weather ever became
  // an input this is where it would show.
  const a = createInitialState(SEED, loadRules());
  const b = createInitialState(SEED, loadRules());
  let left = a;
  let right = b;
  for (let i = 0; i < 200; i++) {
    left = apply(left, { type: 'advance_tick' });
    right = apply(right, { type: 'advance_tick' });
  }
  assert.equal(hashState(left), hashState(right));
});

test('the view hands out the sky the war is actually having', () => {
  // The client draws from view.weather, so it must be the same answer the
  // engine used for radar and the sea this very tick - not last tick's, and
  // not a fresh roll.
  const state = createInitialState(SEED, bareRules());
  for (const tick of [0, 137, 46500]) {
    const at = { ...state, tick: tick };
    const view = buildView(at, 0);
    assert.deepEqual(view.weather, weatherAt(at.seed, at.tick),
      `the view disagreed with the engine about the sky at tick ${tick}`);
  }
});

test('the golden pin can always answer "did the war change"', () => {
  // tools/repin_m0a.mjs reports behaviour drift separately from hash drift,
  // which it can only do if every pinned step carries the behaviour hash.
  // A pin without it reports "unknown", and a pin that reports unknown is a
  // pin somebody will re-cut by hand and get wrong.
  const pin = JSON.parse(readFileSync(join(ROOT, 'test', 'fixtures', 'm0a.json'), 'utf8'));
  assert.ok(pin.steps.length > 0, 'the pin has no steps');
  const missing = [];
  for (const step of pin.steps) {
    if (step.behaviour === undefined) missing.push(step.tick);
  }
  assert.deepEqual(missing, [],
    `${missing.length} pinned ticks carry no behaviour hash - re-run npm run repin`);
});
