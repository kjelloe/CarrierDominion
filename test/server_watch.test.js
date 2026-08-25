// The playtest watchdog. It reads state and never writes it, so the first thing
// to prove is that watching a war does not change it.

import test from 'node:test';
import assert from 'node:assert/strict';

import { loadRules } from '../server/rules.js';
import { createInitialState } from '../engine/state.js';
import { apply } from '../engine/reducer.js';
import { hashState } from '../shared/statehash.js';
import { createApp } from '../server/app.js';
import { createWatch, note, watchReport, watchTick } from '../server/watch.js';

const rules = loadRules();
const SEED = 20260818;
const TICK = { type: 'advance_tick' };

function fresh() {
  return createInitialState(SEED, rules);
}

function kinds(watch) {
  return watch.findings.map((f) => f.kind);
}

test('watching a war does not change it', () => {
  let state = fresh();
  const watch = createWatch();
  const before = hashState(state);
  watchTick(watch, state, 1);
  assert.equal(hashState(state), before, 'the watchdog wrote to the state it was watching');

  // And a hundred ticks of a real war look the same watched or not.
  let watched = fresh();
  let plain = fresh();
  for (let i = 0; i < 100; i++) {
    watched = apply(watched, TICK);
    plain = apply(plain, TICK);
    watchTick(watch, watched, 1);
  }
  assert.equal(hashState(watched), hashState(plain));
});

test('the stall window scales with the ocean, unless the caller said otherwise', () => {
  // 60,000 ticks was tuned on the 8-island map; a 64-island crossing is
  // legitimately longer than that, so the default window grows with
  // sqrt(islandCount/8) - the same law that grows the sea.
  const big = { ...rules, world: { ...rules.world, islandCount: 32 } };
  const watch = createWatch();
  watchTick(watch, createInitialState(SEED, big), 1);
  assert.equal(watch.stuckAfter, 120000, 'sqrt(32/8) should double the window');

  const base = createWatch();
  watchTick(base, fresh(), 1);
  assert.equal(base.stuckAfter, 60000, 'the 8-island window is the tuned one');

  const told = createWatch({ stuckAfter: 500 });
  watchTick(told, createInitialState(SEED, big), 1);
  assert.equal(told.stuckAfter, 500, 'an explicit window is the caller\'s word');
});

test('a healthy war trips nothing', () => {
  let state = fresh();
  const watch = createWatch();
  for (let i = 0; i < 400; i++) {
    state = apply(state, TICK);
    watchTick(watch, state, 1);
  }
  assert.deepEqual(kinds(watch), [], `a clean war reported ${JSON.stringify(kinds(watch))}`);
});

test('a hull off the map is noticed', () => {
  const state = fresh();
  const watch = createWatch();
  state.carriers[0].x = state.params.sizeUnits + 5000;
  watchTick(watch, state, 1);
  assert.ok(kinds(watch).includes('carrier off the map'));
});

test('impossible arithmetic is noticed', () => {
  const state = fresh();
  const watch = createWatch();
  state.carriers[0].hull = state.carriers[0].maxHull + 1;
  state.carriers[0].ordnance = -1;
  state.islands[0].stockFuel = -5;
  const manta = state.units.find((u) => u.kind === 0);
  manta.state = 1;
  manta.arms[0].n = 99999;
  watchTick(watch, state, 1);
  const found = kinds(watch);
  assert.ok(found.includes('hull above maximum'));
  assert.ok(found.includes('negative store'));
  assert.ok(found.includes('negative island stock'));
  assert.ok(found.includes('magazine overfull'));
});

test('a unit under the sea is noticed', () => {
  const state = fresh();
  const watch = createWatch();
  const manta = state.units.find((u) => u.kind === 0);
  manta.state = 1;
  manta.z = -400;
  watchTick(watch, state, 1);
  assert.ok(kinds(watch).includes('unit below the sea'));
});

test('the same fault four hundred times is one finding with a count', () => {
  const state = fresh();
  const watch = createWatch();
  state.carriers[0].x = -1;
  for (let i = 0; i < 400; i++) watchTick(watch, state, 1);
  const found = watch.findings.filter((f) => f.kind === 'carrier off the map');
  assert.equal(found.length, 1, 'the report would have been four hundred lines long');
  assert.equal(found[0].count, 400);
  assert.equal(found[0].tick, state.tick, 'the first tick it happened on was not kept');
});

test('a war where nothing happens for a long time is called stuck', () => {
  let state = fresh();
  const watch = createWatch({ stuckAfter: 50 });
  for (let i = 0; i < 60; i++) {
    state = apply(state, TICK);
    watchTick(watch, state, 1);
  }
  assert.ok(kinds(watch).includes('the war has stopped happening'));
});

test('a tick slower than the tick it simulates is noticed', () => {
  const state = fresh();
  const watch = createWatch();
  watchTick(watch, state, 500);
  assert.ok(kinds(watch).includes('tick slower than real time'));
  const report = watchReport(watch);
  assert.equal(report.ticks, 1);
  assert.equal(report.slowestMs, 500);
  assert.equal(report.findings[0].count, 1);
});

test('the report is a short list of facts', () => {
  const watch = createWatch();
  note(watch, 'something', 42, 'a detail');
  note(watch, 'something', 99, 'a later one');
  const report = watchReport(watch);
  assert.equal(report.findings.length, 1);
  assert.equal(report.findings[0].firstTick, 42, 'the report kept the last tick, not the first');
  assert.equal(report.findings[0].detail, 'a detail');
  assert.equal(report.findings[0].count, 2);
});

test('the server serves what the watchdog found', async () => {
  const app = createApp({ seed: SEED, rules: rules, watch: true });
  const address = await app.listen(0, '127.0.0.1');
  try {
    // POLL, do not sleep: a fixed 300 ms is enough on an idle machine and
    // not enough when the whole suite is running beside it - this test
    // flaked three times before the wait learned to wait for the FACT.
    let body = { ticks: 0, findings: [] };
    for (let attempt = 0; attempt < 100 && body.ticks === 0; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      body = await (await fetch(`http://127.0.0.1:${address.port}/watch`)).json();
    }
    assert.ok(body.ticks > 0, `the watchdog watched nothing in ${body.ticks} ticks`);
    // A finding here is NEWS - except one: "tick slower than real time" is
    // the watchdog correctly noticing that THIS MACHINE is busy, which under
    // a full parallel suite it certainly is. That is the watchdog working,
    // not the war misbehaving, and it is the reason this test flaked three
    // times before anyone read the message. Every other shape still fails.
    const real = body.findings.filter((f) => f.kind !== 'tick slower than real time');
    assert.deepEqual(real, [],
      `a live war reported ${JSON.stringify(real)} after ${body.ticks} ticks`);
    // healthz counts findings, so it carries the same machine-load caveat:
    // it may be 1 on a loaded box because the watchdog noticed the box. It
    // must never exceed what /watch actually reports.
    const health = await (await fetch(`http://127.0.0.1:${address.port}/healthz`)).json();
    assert.equal(health.watching, body.findings.length,
      'healthz and /watch disagree about what was found');
  } finally {
    await app.close();
  }
});

test('a server without the watchdog says so rather than pretending', async () => {
  const app = createApp({ seed: SEED, rules: rules });
  const address = await app.listen(0, '127.0.0.1');
  try {
    const body = await (await fetch(`http://127.0.0.1:${address.port}/watch`)).json();
    assert.equal(body.watching, false);
  } finally {
    await app.close();
  }
});

test('an island store above its cap is noticed', () => {
  const state = fresh();
  const watch = createWatch();
  state.islands[0].stockMaterials = 999999;
  watchTick(watch, state, 1);
  assert.ok(kinds(watch).includes('island stock above its cap'));
});

test('a resumed war is not called stuck on arrival', () => {
  const state = fresh();
  state.tick = 200000; // as if resumed from a long save
  const watch = createWatch({ stuckAfter: 50 });
  watchTick(watch, state, 1);
  assert.deepEqual(kinds(watch), [], 'the first quiet tick read as a 200,000-tick stall');

  // Silence counts from when watching began, and still trips honestly.
  for (let i = 0; i < 60; i++) {
    state.tick = state.tick + 1;
    watchTick(watch, state, 1);
  }
  assert.ok(kinds(watch).includes('the war has stopped happening'));
});

// The tripwires added with the squadron batch (2026-08-26). Each one is a
// thing the engine promises and the watchdog can see at a glance.
test('the watchdog sees a hull carrying more than it can lift', () => {
  const state = fresh();
  const walrus = state.units.find((u) => u.kind === 1);
  walrus.state = 1;
  // Every station brim-full AND both capture devices: over 2,000 kg, which
  // the fitting screen and rearming both refuse.
  for (const entry of walrus.arms) {
    const weapon = state.weapons[entry.w];
    entry.n = weapon.magazine;
  }
  walrus.pod = 1;
  walrus.virus = 1;
  const watch = createWatch({});
  watchTick(watch, state, 50);
  const found = watchReport(watch).findings
    .some((f) => f.kind === 'hull over its payload budget');
  assert.ok(found, 'an overloaded hull went unnoticed');
});

test('the watchdog sees a craft stuck on the lift', () => {
  const state = fresh();
  const manta = state.units.find((u) => u.kind === 0);
  manta.state = 5; // ON_DECK
  manta.deckTicks = 20000;
  const watch = createWatch({});
  watchTick(watch, state, 50);
  const found = watchReport(watch).findings
    .some((f) => f.kind === 'stuck in the deck cycle');
  assert.ok(found, 'a craft frozen on the lift went unnoticed');
});

test('the watchdog sees a course leg off the chart', () => {
  const state = fresh();
  const manta = state.units.find((u) => u.kind === 0);
  manta.state = 1;
  manta.route = [{ x: -500, y: 100 }];
  manta.routeAt = 0;
  const watch = createWatch({});
  watchTick(watch, state, 50);
  const found = watchReport(watch).findings
    .some((f) => f.kind === 'course leg off the map');
  assert.ok(found, 'a course into the margin went unnoticed');
});
