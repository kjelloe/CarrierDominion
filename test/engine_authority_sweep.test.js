// Every command in the vocabulary, through the authority gate. The point is
// not the six lines below - it is the last assertion: a command added
// without a probe here fails this test, so no future command can quietly
// reach the reducer without somebody deciding who is allowed to send it.

import test from 'node:test';
import assert from 'node:assert/strict';

import * as commands from '../engine/commands.js';
import { checkAuthority } from '../engine/authority.js';
import { createInitialState } from '../engine/state.js';
import { loadRules } from '../server/rules.js';

const state = createInitialState(1, loadRules());

// One well-formed example of each command, by type.
const PROBES = {
  advance_tick: { type: 'advance_tick' },
  set_throttle: { type: 'set_throttle', carrierId: 0, throttle: 50 },
  set_rudder: { type: 'set_rudder', carrierId: 0, rudder: 1 },
  set_heading: { type: 'set_heading', carrierId: 0, heading: 0 },
  set_course: { type: 'set_course', carrierId: 0, x: 100, y: 100 },
  launch_unit: { type: 'launch_unit', carrierId: 0, kind: 0 },
  recall_unit: { type: 'recall_unit', unitId: 0 },
  order_unit_move: { type: 'order_unit_move', unitId: 0, x: 100, y: 100 },
  order_unit_attack: { type: 'order_unit_attack', unitId: 0, targetKind: 0, targetId: 1 },
  order_unit_escort: { type: 'order_unit_escort', unitId: 0 },
  order_unit_land: { type: 'order_unit_land', unitId: 0, islandId: 0 },
  take_control: { type: 'take_control', unitId: 0 },
  release_control: { type: 'release_control', unitId: 0 },
  set_unit_helm: { type: 'set_unit_helm', unitId: 0, throttle: 50, rudder: 0 },
  select_weapon: { type: 'select_weapon', unitId: 0, weapon: 0 },
  fire_unit: { type: 'fire_unit', unitId: 0 },
  deploy_pod: { type: 'deploy_pod', unitId: 0, islandId: 0 },
  deploy_virus: { type: 'deploy_virus', unitId: 0, islandId: 0 },
  set_stockpile: { type: 'set_stockpile', carrierId: 0, islandId: 0 },
  set_supply_run: { type: 'set_supply_run', carrierId: 0, active: 1 },
  set_supply_bias: { type: 'set_supply_bias', carrierId: 0, item: 0, level: 1 },
  set_repair_priority: { type: 'set_repair_priority', carrierId: 0, section: 0, priority: 1 },
  set_carrier_aim: { type: 'set_carrier_aim', carrierId: 0, targetKind: 1, targetId: 1 },
  fire_flares: { type: 'fire_flares', carrierId: 0 },
  set_island_role: { type: 'set_island_role', carrierId: 0, islandId: 0, role: 0 },
  build_on_island: { type: 'build_on_island', carrierId: 0, islandId: 0, what: 0 },
  set_ai: { type: 'set_ai', team: 0, active: 1 },
  surrender: { type: 'surrender', carrierId: 0 },
  set_loadout_preset: { type: 'set_loadout_preset', carrierId: 0, preset: 1 },
  set_station: { type: 'set_station', unitId: 0, station: 0, rounds: 10 },
  set_device: { type: 'set_device', unitId: 0, device: 0, fitted: 1 },
  set_pod_role: { type: 'set_pod_role', unitId: 0, role: 1 },
  fire_hammerhead: { type: 'fire_hammerhead', carrierId: 0, x: 100, y: 100 },
  deploy_decoys: { type: 'deploy_decoys', carrierId: 0 },
  dock_decoys: { type: 'dock_decoys', carrierId: 0 },
};

// set_ai is the seat-management command the SERVER issues on a drop; it
// names a team rather than a hull and is not a player's to send.
const SERVER_OWNED = ['advance_tick', 'set_ai'];

test('every command a seat may send is refused to the seat next door', () => {
  for (const [type, probe] of Object.entries(PROBES)) {
    if (SERVER_OWNED.includes(type)) continue;
    assert.equal(checkAuthority(state, 0, probe), '', `team 0 cannot send its own ${type}`);
    const foreign = checkAuthority(state, 1, probe);
    assert.notEqual(foreign, '', `team 1 was allowed to send team 0's ${type}`);
    assert.match(foreign, /another team/, `${type} was refused for the wrong reason: ${foreign}`);
  }
});

test('spectators send nothing at all', () => {
  for (const [type, probe] of Object.entries(PROBES)) {
    if (type === 'advance_tick') continue;
    assert.match(checkAuthority(state, -1, probe), /spectators/, `a spectator sent ${type}`);
  }
});

test('the vocabulary and this sweep cannot drift apart', () => {
  const vocabulary = [];
  for (const [name, value] of Object.entries(commands)) {
    if (name.startsWith('CMD_')) vocabulary.push(value);
  }
  for (const type of vocabulary) {
    assert.notEqual(PROBES[type], undefined,
      `"${type}" is in the vocabulary with no authority probe - add one here`);
  }
  for (const type of Object.keys(PROBES)) {
    assert.ok(vocabulary.includes(type), `"${type}" is probed but no longer a command`);
  }
});
