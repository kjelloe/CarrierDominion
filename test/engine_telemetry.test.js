// The telemetry leash (manual coverage review, item 1): Mantas and Walruses
// are DRONES flown over a link from the carrier. Past FADE the picture
// degrades; at LOSS the link is gone and the craft self-destructs. The
// lighter is autonomous and exempt. It is the original's deepest control
// principle: the carrier must come TO the fight.

import test from 'node:test';
import assert from 'node:assert/strict';

import { loadRules, withoutAi } from './helpers/rules.mjs';
import { createInitialState } from '../engine/state.js';
import { apply } from '../engine/reducer.js';
import { canonicalize } from '../shared/statehash.js';
import { buildView } from '../shared/view.js';
import { EVT_TELEMETRY_LOST } from '../engine/events.js';
import { KIND_LIGHTER, KIND_MANTA, ORDER_RETURN, UNIT_ACTIVE, UNIT_LOST } from '../engine/units.js';

// On the 8-island sea the map is SMALLER than the leash - a drone cannot
// get 26 km from the ship without leaving the chart. The leash is a big-map
// mechanic, so the tests sail the 32-island ocean.
function bigRules() {
  const rules = withoutAi(loadRules());
  rules.world = { ...rules.world, islandCount: 32 };
  return rules;
}
const rules = bigRules();
const TICK = { type: 'advance_tick' };
const SEED = 20260818;

function launchManta(state) {
  const manta = state.units.find((u) => u.team === 0 && u.kind === KIND_MANTA);
  const next = apply(state, { type: 'launch_unit', carrierId: 0, kind: KIND_MANTA });
  return { state: next, id: manta.id };
}

test('past the loss line the link dies and the craft dies with it', () => {
  let { state, id } = launchManta(createInitialState(SEED, rules));
  const unit = state.units.find((u) => u.id === id);
  const ship = state.carriers[0];
  unit.x = ship.x + state.params.telemetryLoss + 300000; // well past - one tick of flight cannot re-enter
  unit.y = ship.y;
  state = apply(state, TICK);
  const gone = state.units.find((u) => u.id === id);
  assert.equal(gone.state, UNIT_LOST, 'the link outlived the leash');
  assert.ok(state.events.some((e) => e.code === EVT_TELEMETRY_LOST && e.a === id));
  assert.doesNotThrow(() => canonicalize(state));
});

test('between fade and loss the picture degrades - the view says so', () => {
  let { state, id } = launchManta(createInitialState(SEED, rules));
  const unit = state.units.find((u) => u.id === id);
  const ship = state.carriers[0];
  unit.x = ship.x + state.params.telemetryFade + 300000; // fading, still short of loss
  unit.y = ship.y;
  state = apply(state, TICK);
  const seen = buildView(state, 0).units.find((u) => u.id === id);
  assert.equal(seen.state, UNIT_ACTIVE, 'fading is a warning, not a sentence');
  assert.equal(seen.telemetry, 1, 'the cockpit should know the picture is going');
});

test('the lighter is autonomous: no leash on the boat', () => {
  let state = createInitialState(SEED, rules);
  const boat = state.units.find((u) => u.team === 0 && u.kind === KIND_LIGHTER);
  boat.state = UNIT_ACTIVE;
  boat.x = state.carriers[0].x + state.params.telemetryLoss * 2;
  state = apply(state, TICK);
  assert.notEqual(state.units.find((u) => u.id === boat.id).state, UNIT_LOST,
    'the transfer drone is semi-submersible and autonomous, as 1988 built it');
});

test('a sunk carrier is a dead signal source - its drones follow it down', () => {
  let { state, id } = launchManta(createInitialState(SEED, rules));
  state.carriers[0].hull = 0;
  state = apply(state, TICK);
  assert.equal(state.units.find((u) => u.id === id).state, UNIT_LOST,
    'a drone with no carrier kept flying on nothing');
});

test('the machine obeys the leash: a drone past fade is brought home', () => {
  const withAi = loadRules();
  withAi.world = { ...withAi.world, islandCount: 32 };
  withAi.rules = { ...withAi.rules, aiTeams: [0, 1] };
  let state = createInitialState(SEED, withAi);
  state = apply(state, { type: 'launch_unit', carrierId: 0, kind: KIND_MANTA });
  const unit = state.units.find((u) => u.team === 0 && u.state === UNIT_ACTIVE);
  unit.x = state.carriers[0].x + state.params.telemetryFade + 2000;
  unit.y = state.carriers[0].y;
  unit.fuel = unit.fuelCapacity; // rule out the fuel reserve as the reason
  for (let i = 0; i <= state.params.aiCadenceTicks; i++) state = apply(state, TICK);
  const leashed = state.units.find((u) => u.id === unit.id);
  assert.equal(leashed.order, ORDER_RETURN, 'the machine flew its drone off the leash');
});

test('the comm pod frees ONE airframe from the leash, and only one', () => {
  // The refit is built like any other, at a factory island with a plant.
  const big = bigRules();
  let state = createInitialState(SEED, big);
  const yard = state.islands[0];
  yard.owner = 0;
  yard.role = 1; // ROLE_FACTORY
  yard.factories = 1;
  yard.stockMaterials = 9000;
  state = apply(state, { type: 'build_on_island', carrierId: 0, islandId: 0, what: 7 });
  assert.equal(state.islands[0].building, 7, 'the yard refused the pod');
  for (let i = 0; i <= state.economy.builds[7].ticks; i++) state = apply(state, TICK);
  assert.equal(state.carriers[0].upComm, 1, 'the pod never came aboard');

  const podded = state.units.filter((u) => u.team === 0 && u.commPod === 1);
  assert.equal(podded.length, 1, 'the pod was fitted to more than one airframe');
  assert.equal(podded[0].kind, KIND_MANTA);

  // Both fly out past the loss line: the podded one lives, the other does not.
  const plain = state.units.find(
    (u) => u.team === 0 && u.kind === KIND_MANTA && u.commPod !== 1,
  );
  for (const flyer of [podded[0], plain]) {
    state = apply(state, { type: 'launch_unit', carrierId: 0, kind: KIND_MANTA });
    const out = state.units.find((u) => u.id === flyer.id);
    out.state = UNIT_ACTIVE;
    out.x = state.carriers[0].x + state.params.telemetryLoss + 300000;
    out.y = state.carriers[0].y;
  }
  state = apply(state, TICK);
  assert.notEqual(state.units.find((u) => u.id === podded[0].id).state, UNIT_LOST,
    'the comm pod did not hold the link');
  assert.equal(state.units.find((u) => u.id === plain.id).state, UNIT_LOST,
    'an unpodded Manta kept flying past the loss line');
});
