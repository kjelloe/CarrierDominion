// A course with more than one leg (ruled 2026-08-25): the 1988 map's PROG,
// for a unit or for the ship. Arrival at a mark is not arrival at a
// destination - the hull takes the next leg and says nothing until the last.

import test from 'node:test';
import assert from 'node:assert/strict';

import { bareRules } from './helpers/rules.mjs';
import { createInitialState } from '../engine/state.js';
import { apply } from '../engine/reducer.js';
import { ROUTE_MAX } from '../engine/route.js';
import { KIND_MANTA, ORDER_MOVE, UNIT_ACTIVE } from '../engine/units.js';

const SEED = 20260818;
const TICK = { type: 'advance_tick' };

function fresh() {
  return createInitialState(SEED, bareRules());
}

function drive(state, ticks) {
  let next = state;
  for (let i = 0; i < ticks; i++) next = apply(next, TICK);
  return next;
}

function airborne(state) {
  let next = apply(state, { type: 'launch_unit', carrierId: 0, kind: KIND_MANTA });
  const unit = next.units.find((u) => u.team === 0 && u.kind === KIND_MANTA
    && u.state === UNIT_ACTIVE);
  return { state: next, id: unit.id };
}

test('a laid course steers for its first leg', () => {
  const start = fresh();
  const { state, id } = airborne(start);
  const metre = state.params.unitsPerMetre;
  const at = state.units.find((u) => u.id === id);
  const legs = [at.x + 3000 * metre, at.y, at.x + 3000 * metre, at.y + 3000 * metre];
  const next = apply(state, { type: 'set_route', unitId: id, points: legs });
  const flying = next.units.find((u) => u.id === id);
  assert.equal(flying.route.length, 2);
  assert.equal(flying.routeAt, 0);
  assert.equal(flying.targetX, legs[0]);
  assert.equal(flying.targetY, legs[1]);
  assert.equal(flying.order, ORDER_MOVE);
});

test('reaching a mark takes the next leg, and only the last one is an arrival', () => {
  const start = fresh();
  let { state, id } = airborne(start);
  const metre = state.params.unitsPerMetre;
  const at = state.units.find((u) => u.id === id);
  // Two short legs, so both are flown inside the tick budget.
  const one = { x: at.x + 900 * metre, y: at.y };
  const two = { x: at.x + 900 * metre, y: at.y + 900 * metre };
  state = apply(state, {
    type: 'set_route', unitId: id, points: [one.x, one.y, two.x, two.y],
  });

  let sawArrival = 0;
  let reachedSecondLeg = 0;
  for (let i = 0; i < 4000; i++) {
    state = apply(state, TICK);
    const unit = state.units.find((u) => u.id === id);
    if (unit.routeAt === 1 || (unit.route.length === 0 && reachedSecondLeg === 0)) {
      if (unit.targetX === two.x && unit.targetY === two.y) reachedSecondLeg = 1;
    }
    for (const event of state.events) {
      if (event.code === 11 && event.a === id) sawArrival = sawArrival + 1;
    }
    if (sawArrival > 0) break;
  }
  assert.equal(reachedSecondLeg, 1, 'she never took the second leg');
  assert.equal(sawArrival, 1, 'arriving was announced at a mark, not at the destination');
  const done = state.units.find((u) => u.id === id);
  assert.equal(done.route.length, 0, 'a sailed course was not cleared');
});

test('an empty course is CLEAR', () => {
  const start = fresh();
  let { state, id } = airborne(start);
  const at = state.units.find((u) => u.id === id);
  state = apply(state, {
    type: 'set_route', unitId: id, points: [at.x + 5000, at.y, at.x + 6000, at.y],
  });
  assert.equal(state.units.find((u) => u.id === id).route.length, 2);
  state = apply(state, { type: 'set_route', unitId: id, points: [] });
  assert.equal(state.units.find((u) => u.id === id).route.length, 0);
});

test('the ship runs its legs too, and only lets go at the end', () => {
  let state = fresh();
  const carrier = state.carriers[0];
  const metre = state.params.unitsPerMetre;
  const one = { x: carrier.x + 600 * metre, y: carrier.y };
  const two = { x: carrier.x + 1200 * metre, y: carrier.y };
  state = apply(state, {
    type: 'set_route', carrierId: 0, points: [one.x, one.y, two.x, two.y],
  });
  state = apply(state, { type: 'set_throttle', carrierId: 0, throttle: 100 });
  assert.equal(state.carriers[0].courseX, one.x);

  let tookSecond = 0;
  for (let i = 0; i < 60000; i++) {
    state = apply(state, TICK);
    const ship = state.carriers[0];
    if (ship.courseX === two.x && ship.courseY === two.y) tookSecond = 1;
    if (ship.courseX < 0 && tookSecond === 1) break;
  }
  assert.equal(tookSecond, 1, 'the ship never took the second leg');
  assert.equal(state.carriers[0].courseX, -1, 'the autopilot never let go');
  assert.equal(state.carriers[0].route.length, 0);
});

test('a course is capped, and a malformed one is refused', () => {
  const start = fresh();
  let { state, id } = airborne(start);
  const points = [];
  for (let i = 0; i < ROUTE_MAX + 4; i++) points.push(1000 + i, 1000 + i);
  // Validation refuses more than eight legs outright rather than truncating
  // silently: a command that does something other than what it says is worse
  // than one that is refused.
  const tooMany = apply(state, { type: 'set_route', unitId: id, points: points });
  assert.equal(tooMany.units.find((u) => u.id === id).route.length, 0);

  const odd = apply(state, { type: 'set_route', unitId: id, points: [10, 20, 30] });
  assert.equal(odd.units.find((u) => u.id === id).route.length, 0);

  // And a course belongs to a unit or a ship, never to both at once.
  const both = apply(state, { type: 'set_route', unitId: id, carrierId: 0, points: [10, 20] });
  assert.equal(both.units.find((u) => u.id === id).route.length, 0);
});

test('a course is a plan, so it is not on the enemy chart', async () => {
  const { buildView } = await import('../shared/view.js');
  const start = fresh();
  let { state, id } = airborne(start);
  const at = state.units.find((u) => u.id === id);
  state = apply(state, {
    type: 'set_route', unitId: id, points: [at.x + 4000, at.y + 4000],
  });
  const mine = buildView(state, 0);
  const theirs = buildView(state, 1);
  assert.equal(mine.units.find((u) => u.id === id).route.length, 1);
  const seen = theirs.units.find((u) => u.id === id);
  if (seen !== undefined) {
    assert.equal(seen.route.length, 0, 'the enemy can read our course off their chart');
  }
});
