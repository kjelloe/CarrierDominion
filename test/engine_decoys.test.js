// The passive defence drones (ruled 2026-08-25, one-button): four decoys on
// station around the ship, a standing bait for seekers hunting the carrier,
// paid for with a quarter of her top speed. Dock them to run.

import test from 'node:test';
import assert from 'node:assert/strict';

import { loadRules, bareRules } from './helpers/rules.mjs';
import { createInitialState } from '../engine/state.js';
import { apply } from '../engine/reducer.js';
import { canonicalize } from '../shared/statehash.js';
import { dist2D, mulDiv } from '../shared/fixed.js';
import { KIND_DECOY, UNIT_ACTIVE, UNIT_STOWED } from '../engine/units.js';

const rules = bareRules();
const TICK = { type: 'advance_tick' };
const SEED = 20260818;

function decoysOf(state, team) {
  return state.units.filter((u) => u.team === team && u.kind === KIND_DECOY);
}

test('deploy puts four on station in formation, and the ship pays in speed', () => {
  let state = createInitialState(SEED, rules);
  assert.equal(decoysOf(state, 0).length, 4);
  state = apply(state, { type: 'deploy_decoys', carrierId: 0 });
  state = apply(state, TICK);
  const ship = state.carriers[0];
  const out = decoysOf(state, 0).filter((u) => u.state === UNIT_ACTIVE);
  assert.equal(out.length, 4);
  for (const decoy of out) {
    const range = dist2D(decoy.x, decoy.y, ship.x, ship.y);
    assert.ok(Math.abs(range - state.params.decoyStation) <= 512,
      `a decoy stands ${range} out, not on station`);
  }
  assert.equal(ship.decoysOut, 1);

  // Flank speed is three quarters of itself while the screen is out.
  state = apply(state, { type: 'set_throttle', carrierId: 0, throttle: 100 });
  for (let i = 0; i < 800; i++) state = apply(state, TICK);
  const screened = mulDiv(state.carriers[0].maxSpeed, 750, 1000);
  assert.ok(state.carriers[0].speed <= screened,
    `made ${state.carriers[0].speed} with the screen out (cap ${screened})`);

  // Dock, and the ship runs free again.
  state = apply(state, { type: 'dock_decoys', carrierId: 0 });
  assert.equal(decoysOf(state, 0).filter((u) => u.state === UNIT_STOWED).length, 4);
  for (let i = 0; i < 1200; i++) state = apply(state, TICK);
  assert.ok(state.carriers[0].speed > screened, 'docking never lifted the penalty');
  assert.doesNotThrow(() => canonicalize(state));
});

test('a seeker hunting the carrier takes the bait that stands in its way', () => {
  let state = createInitialState(SEED, rules);
  state = apply(state, { type: 'deploy_decoys', carrierId: 0 });
  state = apply(state, TICK);
  const ship = state.carriers[0];
  const decoy = decoysOf(state, 0).find((u) => u.state === UNIT_ACTIVE);
  // A hostile guided round, locked on the ship, passing near the decoy.
  state.shots.push({
    id: state.nextShot, team: 1, weapon: 3,
    x: decoy.x + 200 * 256, y: decoy.y, z: 300 * 256,
    heading: 32768, climb: 0, speed: 1200, damage: 40, blast: 1536,
    life: 400, guided: 1, splash: 0, trigger: 0, turn: 800,
    targetKind: 1, targetId: ship.id,
  });
  state.nextShot += 1;
  state = apply(state, TICK);
  const round = state.shots.find((s) => s.team === 1);
  assert.notEqual(round, undefined);
  assert.equal(round.targetKind, 0, 'the seeker kept the ship');
  assert.equal(round.targetId, decoy.id, 'the bait was not taken');

  // The last decoy dying lifts the penalty on its own.
  for (const unit of decoysOf(state, 0)) {
    unit.hp = 0;
    unit.state = 3; // UNIT_LOST
  }
  state = apply(state, TICK);
  assert.equal(state.carriers[0].decoysOut, 0, 'a dead screen still slowed the ship');
});
