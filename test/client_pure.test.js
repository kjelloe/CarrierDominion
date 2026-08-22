// The client's pure modules - tier resolution, unit conversion, HUD
// formatting - are tested headless. Only the three.js layer needs a browser,
// and that is what the Playwright smoke gate is for.

import test from 'node:test';
import assert from 'node:assert/strict';

import { suggestGraphicsLevel, describeGpu } from '../client/diagnostics.js';
import { presetFor, presetNames, resolveGraphics, readOverride, writeOverride } from '../client/graphics.js';
import { headingToYaw, yawToHeading, forwardFromHeading, toMetres, toUnits } from '../client/render/coords.js';
import { degreesFrom, describeSupply, knotsFrom } from '../client/hud.js';
import { checkAuthority } from '../engine/authority.js';
import { createInitialState } from '../engine/state.js';
import { loadRules } from '../server/rules.js';

const rules = loadRules();

function fakeStorage() {
  const store = {};
  return {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = v; },
    removeItem: (k) => { delete store[k]; },
  };
}

test('graphics tiers follow the GPU string', () => {
  assert.equal(suggestGraphicsLevel({ webgl2: true, renderer: 'NVIDIA GeForce RTX 4070' }), 'high');
  assert.equal(suggestGraphicsLevel({ webgl2: true, renderer: 'Apple M2 Pro' }), 'high');
  assert.equal(suggestGraphicsLevel({ webgl2: true, renderer: 'Intel Iris Xe Graphics' }), 'medium');
  assert.equal(suggestGraphicsLevel({ webgl2: true, renderer: 'Intel UHD Graphics 617' }), 'low');
  assert.equal(suggestGraphicsLevel({ webgl2: true, renderer: 'SwiftShader' }), 'low');
  assert.equal(suggestGraphicsLevel({ webgl1: true, renderer: 'ancient thing' }), 'low');
  assert.equal(suggestGraphicsLevel({ renderer: '' }), 'low');
  assert.equal(suggestGraphicsLevel(undefined), 'low');
});

test('describeGpu explains a refusal instead of just saying no', () => {
  assert.match(describeGpu({ webgl2: false, webgl1: false, why: 'driver blocklisted' }), /blocklisted/);
  assert.match(describeGpu({ webgl2: true, renderer: 'RTX 4070' }), /WebGL2/);
});

test('an override beats the auto-detected tier', () => {
  assert.deepEqual(resolveGraphics('low', 'high'), { level: 'high', source: 'override' });
  assert.deepEqual(resolveGraphics('low', ''), { level: 'low', source: 'auto' });
  assert.deepEqual(resolveGraphics('nonsense', 'nonsense'), { level: 'medium', source: 'default' });
});

test('an override round-trips through storage and can be cleared', () => {
  const storage = fakeStorage();
  assert.equal(readOverride(storage), '');
  writeOverride(storage, 'high');
  assert.equal(readOverride(storage), 'high');
  writeOverride(storage, '');
  assert.equal(readOverride(storage), '');
});

test('every preset is complete and ordered by cost', () => {
  let previousGrid = 0;
  for (const name of presetNames()) {
    const preset = presetFor(name);
    for (const key of [
      'label', 'terrainGrid', 'oceanSegments', 'oceanDetail', 'shadows',
      'shadowMapSize', 'pixelRatioCap', 'antialias', 'fogDensity', 'drawDistanceMetres',
    ]) {
      assert.notEqual(preset[key], undefined, `${name} preset is missing ${key}`);
    }
    assert.ok(preset.terrainGrid > previousGrid, `${name} should be finer than the tier below`);
    previousGrid = preset.terrainGrid;
  }
  // The detailed water is the High tier's own (docs/07): Medium is the pinned
  // reference look and must not drift.
  assert.equal(presetFor('low').oceanDetail, false);
  assert.equal(presetFor('medium').oceanDetail, false);
  assert.equal(presetFor('high').oceanDetail, true);
});

test('engine units and scene metres convert both ways', () => {
  assert.equal(toMetres(256), 1);
  assert.equal(toUnits(1), 256);
  assert.equal(toUnits(toMetres(123456)), 123456);
});

test('a heading becomes the yaw that points the mesh the same way', () => {
  const east = forwardFromHeading(0);
  assert.ok(Math.abs(east.x - 1) < 1e-9 && Math.abs(east.z) < 1e-9, 'heading 0 is +x (east)');
  const north = forwardFromHeading(16384);
  assert.ok(Math.abs(north.x) < 1e-9 && Math.abs(north.z + 1) < 1e-9, 'heading 16384 is -z (north)');
  const west = forwardFromHeading(32768);
  assert.ok(Math.abs(west.x + 1) < 1e-9, 'heading 32768 is -x (west)');
  for (const bam of [0, 1, 4096, 16384, 40000, 65535]) {
    assert.equal(yawToHeading(headingToYaw(bam)), bam);
  }
});

test('the HUD converts engine speed into knots', () => {
  // 53 units/tick at 256 units/m and 20 Hz = 4.14 m/s = 8.05 knots.
  assert.ok(Math.abs(knotsFrom(53, 256, 20) - 8.0) < 0.2, knotsFrom(53, 256, 20));
  assert.equal(knotsFrom(0, 256, 20), 0);
  assert.equal(degreesFrom(0), 0);
  assert.equal(degreesFrom(16384), 90);
  assert.equal(degreesFrom(32768), 180);
});

test('authority is the same rule in solo and on the wire', () => {
  const state = createInitialState(1, rules);
  assert.equal(checkAuthority(state, 0, { type: 'set_throttle', carrierId: 0, throttle: 50 }), '');
  assert.match(checkAuthority(state, 0, { type: 'set_throttle', carrierId: 1, throttle: 50 }), /another team/);
  assert.match(checkAuthority(state, -1, { type: 'set_throttle', carrierId: 0, throttle: 50 }), /spectators/);
  assert.match(checkAuthority(state, 0, { type: 'advance_tick' }), /server-owned/);
  assert.match(checkAuthority(state, 0, { type: 'set_throttle', carrierId: 7, throttle: 50 }), /no such carrier/);
  assert.match(checkAuthority(state, 0, { type: 'set_throttle', carrierId: 0, throttle: 900 }), /out of range/);
});

test('authority covers the logistics commands too', () => {
  const state = createInitialState(1, rules);
  assert.equal(checkAuthority(state, 0, { type: 'set_supply_run', carrierId: 0, active: 1 }), '');
  assert.match(
    checkAuthority(state, 0, { type: 'set_supply_run', carrierId: 1, active: 1 }),
    /another team/,
  );
  assert.equal(checkAuthority(state, 0, { type: 'set_stockpile', carrierId: 0, islandId: 2 }), '');
  assert.match(
    checkAuthority(state, 0, { type: 'set_stockpile', carrierId: 1, islandId: 2 }),
    /another team/,
  );
  assert.equal(checkAuthority(state, 0, { type: 'launch_unit', carrierId: 0, kind: 2 }), '');
  assert.match(
    checkAuthority(state, 0, { type: 'launch_unit', carrierId: 0, kind: 3 }),
    /no such unit kind/,
  );
  assert.match(
    checkAuthority(state, 0, { type: 'set_supply_run', carrierId: 0, active: 7 }),
    /active must be/,
  );
});

test('the supply readout says what is happening', () => {
  const t = (key, vars) => (vars === undefined ? key : `${key}:${JSON.stringify(vars)}`);
  const idle = describeSupply(t, {
    team: 0,
    carriers: [{ team: 0, contact: 0, supplyRun: 0 }],
    units: [],
    resources: { stockpileIsland: -1 },
  });
  assert.match(idle, /supply\.off/);
  assert.match(idle, /supply\.noDepot/);

  const running = describeSupply(t, {
    team: 0,
    carriers: [{ team: 0, contact: 0, supplyRun: 1 }],
    units: [{
      kind: 2, team: 0, state: 1,
      cargoFuel: 5000, cargoMaterials: 0, cargoOrdnance: 0, cargoCap: 10000,
    }],
    resources: { stockpileIsland: 3 },
  });
  assert.match(running, /supply\.on/);
  assert.match(running, /supply\.depot/);
  assert.match(running, /"percent":50/);
});

test('the war-over screen says who, how, and what it cost', async () => {
  const { outcomeModel } = await import('../client/panels/warover.js');
  const t = (key, vars) => `${key}${vars === undefined ? '' : ' ' + JSON.stringify(vars)}`;
  const view = {
    team: 0,
    winner: 0,
    winReason: 2,
    tick: 229482,
    params: { tickHz: 20 },
    scores: [{ id: 0, score: 1240 }, { id: 1, score: 830 }],
    islands: [{ owner: 0 }, { owner: 0 }, { owner: 1 }, { owner: -1 }],
  };
  const won = outcomeModel(view, t);
  assert.equal(won.title, 'war.won');
  assert.equal(won.reason, 'war.byCarrier');
  assert.equal(won.scores.length, 2);
  assert.match(won.scores[0], /scoreYou.*1240/);
  assert.match(won.scores[1], /scoreTheirs.*"team":2.*830/);
  assert.match(won.islands, /"held":2,"total":4/);
  assert.match(won.length, /"hours":3,"minutes":11/);

  const lost = outcomeModel({ ...view, winner: 1 }, t);
  assert.equal(lost.title, 'war.lost');
  const draw = outcomeModel({ ...view, winner: -1, winReason: 3 }, t);
  assert.equal(draw.title, 'warover.drawTitle');
  assert.equal(draw.reason, 'war.draw');
});
