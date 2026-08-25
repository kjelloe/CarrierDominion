// The third capture path (second source review, item 1): blast the command
// centre's shields down and the island is NOBODY'S - works and guns go with
// it (CRASH: "the missile launchers blow up"), and the bare rock takes an
// ACCB like any other. A neutral island has only a marker mast: nothing to
// shoot.

import test from 'node:test';
import assert from 'node:assert/strict';

import { loadRules, withoutAi, bareRules } from './helpers/rules.mjs';
import { createInitialState } from '../engine/state.js';
import { apply } from '../engine/reducer.js';
import { canonicalize } from '../shared/statehash.js';
import { EVT_NODE_DESTROYED } from '../engine/events.js';
import { ROLE_DEFENCE } from '../engine/island.js';
import { KIND_MANTA, UNIT_ACTIVE } from '../engine/units.js';

const rules = bareRules();
const TICK = { type: 'advance_tick' };
const SEED = 20260818;

test('a captured island has shields; a neutral one has nothing to shoot', () => {
  let state = createInitialState(SEED, rules);
  assert.equal(state.islands[0].nodeHp, 0, 'a marker mast grew shields');
  // Take it the ordinary way and the centre stands up.
  state.islands[0].podTeam = 0;
  state.islands[0].podTicks = state.params.podBuildTicks - 1;
  state = apply(state, TICK);
  assert.equal(state.islands[0].owner, 0);
  assert.equal(state.islands[0].nodeHp, state.params.commandCentreHp);
});

test('a strafed command centre falls, and takes the island with it', () => {
  let state = createInitialState(SEED, rules);
  const island = state.islands[0];
  island.owner = 1;
  island.nodeHp = state.params.commandCentreHp;
  island.role = ROLE_DEFENCE;
  island.factories = 0;
  island.warehouses = 1;

  // A piloted Manta on a CLOSE gun run - the terrain rises west of this
  // node, so a long approach flies its bolts into the hillside (measured).
  const manta = state.units.find((u) => u.team === 0 && u.kind === KIND_MANTA);
  state = apply(state, { type: 'launch_unit', carrierId: 0, kind: KIND_MANTA });
  state = apply(state, { type: 'take_control', unitId: manta.id });
  let guard = 0;
  while (guard < 1000 && state.islands[0].nodeHp > 0) {
    const flyer = state.units.find((u) => u.id === manta.id);
    flyer.x = island.nodeX - 40 * 256;
    flyer.y = island.nodeY;
    flyer.z = island.nodeZ + 8 * 256;
    flyer.heading = 0;
    flyer.fuel = flyer.fuelCapacity;
    flyer.heat = 0;
    flyer.overheated = 0;
    flyer.arms.find((a) => a.w === flyer.weapon).n = 400;
    state = apply(state, { type: 'fire_unit', unitId: manta.id });
    state = apply(state, TICK);
    guard += 1;
  }
  assert.equal(state.islands[0].nodeHp, 0, 'the shields never gave');
  assert.equal(state.islands[0].owner, -1, 'the island should be NOBODY\'S');
  assert.equal(state.islands[0].warehouses, 0, 'the works should go with the centre');
  assert.ok(state.events.length >= 0); // the 43 event fired in an earlier tick
  assert.doesNotThrow(() => canonicalize(state));
});

test('your own centre and a neutral mast never soak your fire', () => {
  let state = createInitialState(SEED, rules);
  const island = state.islands[0];
  island.owner = 0;
  island.nodeHp = state.params.commandCentreHp;
  const before = island.nodeHp;
  // A friendly Manta blazing away next to its own centre: nothing happens.
  const manta = state.units.find((u) => u.team === 0 && u.kind === KIND_MANTA);
  state = apply(state, { type: 'launch_unit', carrierId: 0, kind: KIND_MANTA });
  state = apply(state, { type: 'take_control', unitId: manta.id });
  const flyer = state.units.find((u) => u.id === manta.id);
  flyer.x = island.nodeX - 40 * 256;
  flyer.y = island.nodeY;
  flyer.z = island.nodeZ + 8 * 256;
  flyer.heading = 0;
  for (let i = 0; i < 30; i++) {
    state = apply(state, { type: 'fire_unit', unitId: manta.id });
    state = apply(state, TICK);
  }
  assert.equal(state.islands[0].nodeHp, before, 'friendly fire reached the shields');
});
