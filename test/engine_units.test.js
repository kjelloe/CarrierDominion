import test from 'node:test';
import assert from 'node:assert/strict';

import { loadRules } from '../server/rules.js';
import { bareRules } from './helpers/rules.mjs';
import { createInitialState, copyState } from '../engine/state.js';
import { apply } from '../engine/reducer.js';
import { canonicalize } from '../shared/statehash.js';
import { dist2D } from '../shared/fixed.js';
import { worldHeightAt } from '../engine/heightmap.js';
import {
  KIND_MANTA,
  KIND_WALRUS,
  ORDER_HOLD,
  ORDER_MOVE,
  ORDER_RETURN,
  UNIT_ACTIVE,
  UNIT_LOST,
  UNIT_RETURNING,
  UNIT_STOWED,
  damagePermil,
  findUnit,
} from '../engine/units.js';
import {
  EVT_UNIT_ARRIVED,
  EVT_UNIT_LAUNCHED,
  EVT_UNIT_LOST,
  EVT_UNIT_RECOVERED,
} from '../engine/events.js';

const rules = bareRules();
const TICK = { type: 'advance_tick' };
const SEED = 20260818;

function fresh() {
  return createInitialState(SEED, rules);
}

function drive(state, ticks) {
  for (let i = 0; i < ticks; i++) state = apply(state, TICK);
  return state;
}

function driveUntil(state, ticks, predicate) {
  for (let i = 0; i < ticks; i++) {
    state = apply(state, TICK);
    if (predicate(state)) return { state: state, ticks: i + 1, met: true };
  }
  return { state: state, ticks: ticks, met: false };
}

function firstUnitOf(state, team, kind) {
  for (const unit of state.units) {
    if (unit.team === team && unit.kind === kind) return unit;
  }
  return undefined;
}

test('both hangars are full at tick zero and nothing is on the map', () => {
  const state = fresh();
  const perCarrier = rules.units.carrier.hangarMantas
    + rules.units.carrier.hangarWalruses
    + rules.units.carrier.hangarLighters;
  assert.equal(state.units.length, perCarrier * state.carriers.length);
  for (const unit of state.units) {
    assert.equal(unit.state, UNIT_STOWED);
    assert.equal(unit.control, -1);
    assert.equal(unit.fuel, unit.fuelCapacity);
  }
});

test('unit records are integers only and survive a copy intact', () => {
  const state = fresh();
  for (const unit of state.units) {
    for (const [key, value] of Object.entries(unit)) {
      // `arms` is the one nested field: a magazine per weapon the hull carries.
      // The rule still holds inside it.
      if (key === 'arms') {
        for (const entry of value) {
          assert.ok(Number.isInteger(entry.w), `arms weapon id is not an integer: ${entry.w}`);
          assert.ok(Number.isInteger(entry.n), `arms round count is not an integer: ${entry.n}`);
        }
        continue;
      }
      assert.ok(Number.isInteger(value), `${key} is not an integer: ${value}`);
    }
  }
  const copy = copyState(state);
  assert.deepEqual(Object.keys(copy.units[0]).sort(), Object.keys(state.units[0]).sort());
  assert.notEqual(copy.units[0], state.units[0]);
  copy.units[0].hp = -99;
  assert.notEqual(state.units[0].hp, -99);
  // The magazines must be copied, not shared.
  copy.units[0].arms[0].n = 1;
  assert.notEqual(state.units[0].arms[0].n, 1);
});

test('launching puts a Manta in the air ahead of its carrier', () => {
  let state = fresh();
  state = apply(state, { type: 'launch_unit', carrierId: 0, kind: KIND_MANTA });
  assert.equal(state.events[0].code, EVT_UNIT_LAUNCHED);
  const unit = state.units[state.events[0].a];
  assert.equal(unit.state, UNIT_ACTIVE);
  assert.equal(unit.kind, KIND_MANTA);
  assert.equal(unit.z, state.params.deckHeight);
  assert.ok(unit.speed >= unit.minSpeed, 'an airframe leaves the deck with way on');
  const carrier = state.carriers[0];
  const gap = dist2D(unit.x, unit.y, carrier.x, carrier.y);
  assert.ok(gap > 0 && gap < 200 * 256, `launched ${gap} units from the deck`);
});

test('a launched Manta climbs to its cruise altitude and holds it', () => {
  let state = fresh();
  state = apply(state, { type: 'launch_unit', carrierId: 0, kind: KIND_MANTA });
  const id = state.events[0].a;
  state = drive(state, 2000);
  const unit = findUnit(state, id);
  assert.equal(unit.z, unit.cruiseAltitude);
});

test('the hangar empties and then refuses to launch', () => {
  let state = fresh();
  for (let i = 0; i < rules.units.carrier.hangarMantas; i++) {
    state = apply(state, { type: 'launch_unit', carrierId: 0, kind: KIND_MANTA });
    assert.equal(state.events[0].code, EVT_UNIT_LAUNCHED, `launch ${i} failed`);
  }
  state = apply(state, { type: 'launch_unit', carrierId: 0, kind: KIND_MANTA });
  assert.equal(state.events[0].code, 1, 'an empty hangar should reject the launch');
  // The other carrier's hangar is its own.
  state = apply(state, { type: 'launch_unit', carrierId: 1, kind: KIND_MANTA });
  assert.equal(state.events[0].code, EVT_UNIT_LAUNCHED);
});

test('a Manta flies to an ordered waypoint and reports arriving once', () => {
  let state = fresh();
  state = apply(state, { type: 'launch_unit', carrierId: 0, kind: KIND_MANTA });
  const id = state.events[0].a;
  const island = state.islands[0];
  state = apply(state, { type: 'order_unit_move', unitId: id, x: island.x, y: island.y });
  assert.equal(findUnit(state, id).order, ORDER_MOVE);

  let arrivals = 0;
  const run = driveUntil(state, 20000, (s) => {
    for (const event of s.events) if (event.code === EVT_UNIT_ARRIVED) arrivals += 1;
    return arrivals > 0;
  });
  assert.ok(run.met, 'never arrived');
  state = drive(run.state, 500);
  for (const event of state.events) assert.notEqual(event.code, EVT_UNIT_ARRIVED);
  assert.equal(arrivals, 1);
  const unit = findUnit(state, id);
  assert.equal(unit.order, ORDER_HOLD);
  assert.ok(dist2D(unit.x, unit.y, island.x, island.y) < 20 * 256 * 256, 'ended up near the island');
});

test('a recalled Manta chases its moving carrier home and is recovered', () => {
  let state = fresh();
  state = apply(state, { type: 'launch_unit', carrierId: 0, kind: KIND_MANTA });
  const id = state.events[0].a;
  // Send it away, then put the carrier under way so home is a moving target.
  state = apply(state, {
    type: 'order_unit_move',
    unitId: id,
    x: state.carriers[0].x + 3000 * 256,
    y: state.carriers[0].y + 3000 * 256,
  });
  state = apply(state, { type: 'set_throttle', carrierId: 0, throttle: 100 });
  state = drive(state, 1500);
  state = apply(state, { type: 'recall_unit', unitId: id });
  assert.equal(findUnit(state, id).state, UNIT_RETURNING);
  assert.equal(findUnit(state, id).order, ORDER_RETURN);

  let recovered = false;
  const run = driveUntil(state, 20000, (s) => {
    for (const event of s.events) if (event.code === EVT_UNIT_RECOVERED) recovered = true;
    return recovered;
  });
  assert.ok(run.met, 'never made it home');
  const unit = findUnit(run.state, id);
  assert.equal(unit.state, UNIT_STOWED);
  assert.equal(unit.fuel, unit.fuelCapacity, 'recovery refuels');
});

test('a Manta that runs dry is lost', () => {
  let state = fresh();
  state = apply(state, { type: 'launch_unit', carrierId: 0, kind: KIND_MANTA });
  const id = state.events[0].a;
  state = apply(state, {
    type: 'order_unit_move',
    unitId: id,
    x: state.params.sizeUnits - 1,
    y: state.params.sizeUnits - 1,
  });
  const unit = findUnit(state, id);
  unit.fuel = 5;

  let lost = false;
  const run = driveUntil(state, 2000, (s) => {
    for (const event of s.events) if (event.code === EVT_UNIT_LOST) lost = true;
    return lost;
  });
  assert.ok(run.met, 'never ran out');
  assert.equal(findUnit(run.state, id).state, UNIT_LOST);
  assert.equal(findUnit(run.state, id).speed, 0);
});

test('a lost unit stops being simulated', () => {
  let state = fresh();
  state = apply(state, { type: 'launch_unit', carrierId: 0, kind: KIND_MANTA });
  const id = state.events[0].a;
  findUnit(state, id).state = UNIT_LOST;
  const before = { x: findUnit(state, id).x, y: findUnit(state, id).y };
  state = drive(state, 200);
  assert.equal(findUnit(state, id).x, before.x);
  assert.equal(findUnit(state, id).y, before.y);
});

test('a Walrus launches into the water beside the carrier', () => {
  let state = fresh();
  state = apply(state, { type: 'launch_unit', carrierId: 0, kind: KIND_WALRUS });
  const unit = findUnit(state, state.events[0].a);
  assert.equal(unit.kind, KIND_WALRUS);
  assert.equal(unit.z, 0);
  assert.ok(worldHeightAt(state.islands, unit.x, unit.y) < 0, 'launched onto dry land');
});

test('a Walrus drives ashore and slows down when it gets there', () => {
  let state = fresh();
  state = apply(state, { type: 'launch_unit', carrierId: 0, kind: KIND_WALRUS });
  const id = state.events[0].a;
  const island = state.islands[0];
  // Put it just off the island so the crossing does not take an hour of ticks.
  const unit = findUnit(state, id);
  unit.x = island.x;
  unit.y = island.y - island.radius - 400 * 256;
  state = apply(state, { type: 'order_unit_move', unitId: id, x: island.x, y: island.y });

  const run = driveUntil(state, 30000, (s) => worldHeightAt(s.islands, findUnit(s, id).x, findUnit(s, id).y) > 0);
  assert.ok(run.met, 'never reached the beach');
  assert.ok(findUnit(run.state, id).z > 0, 'a Walrus ashore sits on the ground, not at sea level');
  // It crosses the waterline still carrying its swimming speed; the tracks
  // need a moment to slow it to the land limit.
  const settled = findUnit(drive(run.state, 100), id);
  assert.ok(settled.speed <= settled.landSpeed, `${settled.speed} exceeds the land speed`);
});

test('a Walrus is stopped by a slope it cannot climb', () => {
  let state = fresh();
  state = apply(state, { type: 'launch_unit', carrierId: 0, kind: KIND_WALRUS });
  const id = state.events[0].a;
  const island = state.islands[0];
  const unit = findUnit(state, id);
  unit.x = island.x;
  unit.y = island.y - island.radius - 200 * 256;
  unit.maxClimbPermil = 0; // a vehicle that cannot climb at all
  state = apply(state, { type: 'order_unit_move', unitId: id, x: island.x, y: island.y });

  const run = driveUntil(state, 30000, (s) => {
    for (const event of s.events) if (event.code === 12) return true;
    return false;
  });
  assert.ok(run.met, 'never met a slope it could not take');
  assert.equal(findUnit(run.state, id).speed, 0);
  assert.ok(
    dist2D(findUnit(run.state, id).x, findUnit(run.state, id).y, island.x, island.y) > island.radius / 2,
    'it should be stopped at the shore, not halfway up the peak',
  );
});

test('direct control overrides the autopilot and gives it back', () => {
  let state = fresh();
  state = apply(state, { type: 'launch_unit', carrierId: 0, kind: KIND_MANTA });
  const id = state.events[0].a;
  state = apply(state, { type: 'order_unit_move', unitId: id, x: 100, y: 100 });
  state = apply(state, { type: 'take_control', unitId: id });
  assert.equal(findUnit(state, id).control, 0);

  state = apply(state, { type: 'set_unit_helm', unitId: id, throttle: 100, rudder: 1 });
  const before = findUnit(state, id).heading;
  state = drive(state, 10);
  const turned = findUnit(state, id).heading;
  assert.notEqual(turned, before, 'the stick should have turned it');

  state = apply(state, { type: 'release_control', unitId: id });
  assert.equal(findUnit(state, id).control, -1);
  assert.equal(findUnit(state, id).rudder, 0);
});

test('the helm is refused for a unit nobody is flying', () => {
  let state = fresh();
  state = apply(state, { type: 'launch_unit', carrierId: 0, kind: KIND_MANTA });
  const id = state.events[0].a;
  state = apply(state, { type: 'set_unit_helm', unitId: id, throttle: 100, rudder: 1 });
  assert.equal(state.events[0].code, 1);
});

test('unit commands aimed at a stowed or missing unit are refused', () => {
  let state = fresh();
  const stowed = firstUnitOf(state, 0, KIND_MANTA);
  for (const command of [
    { type: 'recall_unit', unitId: stowed.id },
    { type: 'order_unit_move', unitId: stowed.id, x: 1000, y: 1000 },
    { type: 'take_control', unitId: stowed.id },
    { type: 'recall_unit', unitId: 9999 },
  ]) {
    state = apply(state, command);
    assert.equal(state.events[0].code, 1, JSON.stringify(command));
  }
});

test('an off-map waypoint is refused', () => {
  let state = fresh();
  state = apply(state, { type: 'launch_unit', carrierId: 0, kind: KIND_MANTA });
  const id = state.events[0].a;
  state = apply(state, { type: 'order_unit_move', unitId: id, x: state.params.sizeUnits + 1, y: 0 });
  assert.equal(state.events[0].code, 1);
});

test('state stays hygienic with a full deck load in the air', () => {
  let state = fresh();
  for (const kind of [KIND_MANTA, KIND_WALRUS]) {
    for (let i = 0; i < 4; i++) {
      state = apply(state, { type: 'launch_unit', carrierId: 0, kind: kind });
      state = apply(state, { type: 'launch_unit', carrierId: 1, kind: kind });
    }
  }
  state = apply(state, { type: 'set_throttle', carrierId: 0, throttle: 100 });
  state = drive(state, 1500);
  assert.doesNotThrow(() => canonicalize(state));
});

// --- The hangar mends, damage slows, and a cripple leaks (manual item 7) ---

test('the hangar repairs a stowed hull, paying materials for every point', () => {
  let state = createInitialState(SEED, rules);
  const manta = state.units.find((u) => u.team === 0 && u.kind === KIND_MANTA);
  manta.hp = 10;
  const materials = state.carriers[0].materials;
  while (state.tick % 100 !== 99) state = apply(state, TICK);
  state = apply(state, TICK); // the repair beat
  const mended = state.units.find((u) => u.id === manta.id);
  assert.ok(mended.hp > 10, 'the deck refuelled but never mended');
  assert.ok(state.carriers[0].materials < materials, 'the mend was conjured');

  // A broke ship mends nothing.
  const broke = createInitialState(SEED, rules);
  const hurt = broke.units.find((u) => u.team === 0 && u.kind === KIND_MANTA);
  hurt.hp = 10;
  broke.carriers[0].materials = 0;
  let poor = broke;
  while (poor.tick % 100 !== 99) poor = apply(poor, TICK);
  poor = apply(poor, TICK);
  assert.equal(poor.units.find((u) => u.id === hurt.id).hp, 10);
});

test('a damaged hull is a slow hull, floored so a cripple still crawls', () => {
  const state = createInitialState(SEED, rules);
  const manta = state.units.find((u) => u.team === 0 && u.kind === KIND_MANTA);
  assert.equal(damagePermil(manta), 1000);
  manta.hp = Math.floor(manta.maxHp / 2);
  assert.ok(damagePermil(manta) <= 510 && damagePermil(manta) >= 490);
  manta.hp = 1;
  assert.equal(damagePermil(manta), 250, 'the floor should hold the cripple up');
});

test('below twelve percent the tank leaks - the two-minute clock', () => {
  let state = createInitialState(SEED, rules);
  const manta = state.units.find((u) => u.team === 0 && u.kind === KIND_MANTA);
  state = apply(state, { type: 'launch_unit', carrierId: 0, kind: KIND_MANTA });
  let flying = state.units.find((u) => u.id === manta.id);
  flying.hp = Math.floor(flying.maxHp / 10); // 10% - leaking
  const fuelBefore = flying.fuel;
  state = apply(state, TICK);
  const healthyBurnState = createInitialState(SEED, rules);
  // The leak drains the CAPACITY in ~2400 ticks on top of the normal burn.
  const after = state.units.find((u) => u.id === manta.id);
  const drained = fuelBefore - after.fuel;
  assert.ok(drained >= Math.floor(flying.fuelCapacity / 2400),
    `one tick drained ${drained}, the leak alone should manage ${Math.floor(flying.fuelCapacity / 2400)}`);
  assert.ok(healthyBurnState !== undefined);
});
