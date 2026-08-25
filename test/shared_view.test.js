import test from 'node:test';
import assert from 'node:assert/strict';

import { loadRules } from '../server/rules.js';
import { createInitialState } from '../engine/state.js';
import { apply } from '../engine/reducer.js';
import { createSnapshot } from '../engine/snapshot.js';
import { buildView } from '../shared/view.js';
import { canonicalize } from '../shared/statehash.js';
import { EVT_THROTTLE_SET } from '../engine/events.js';

const rules = loadRules();
const SEED = 20260818;

test('a view carries only the viewing team own hulls when out of radar range', () => {
  const state = createInitialState(SEED, rules);
  const view = buildView(state, 0);
  assert.equal(view.carriers.length, 1);
  assert.equal(view.carriers[0].team, 0);
  assert.equal(view.team, 0);
});

test('an enemy inside radar range appears, but only as a contact', () => {
  const state = createInitialState(SEED, rules);
  state.carriers[1].x = state.carriers[0].x + 1000;
  state.carriers[1].y = state.carriers[0].y;
  const view = buildView(state, 0);
  assert.equal(view.carriers.length, 2);
  const contact = view.carriers.find((c) => c.team === 1);
  assert.equal(contact.contact, 1);
  assert.equal(contact.hull, -1);
  assert.equal(contact.fuel, -1);
  assert.equal(contact.throttle, 0);
  assert.equal(contact.x, state.carriers[1].x, 'position and heading are what radar gives you');
  assert.equal(contact.heading, state.carriers[1].heading);
});

test('a contact disappears again once it slips outside the radar horizon', () => {
  const state = createInitialState(SEED, rules);
  const radar = state.carriers[0].radar;
  state.carriers[1].x = state.carriers[0].x + radar - 10;
  state.carriers[1].y = state.carriers[0].y;
  assert.equal(buildView(state, 0).carriers.length, 2);
  state.carriers[1].x = state.carriers[0].x + radar + 10;
  assert.equal(buildView(state, 0).carriers.length, 1);
});

test('a view never carries another team resources', () => {
  const state = createInitialState(SEED, rules);
  state.teams[1].fuel = 999999;
  const view = buildView(state, 0);
  assert.equal(view.resources.id, 0);
  assert.equal(JSON.stringify(view).includes('999999'), false);
});

test('a view never carries a raw state key', () => {
  const state = createInitialState(SEED, rules);
  const view = buildView(state, 0);
  assert.equal(view.rng, undefined, 'the PRNG state would let a client predict every roll');
  assert.equal(view.rulesHash, undefined);
  assert.equal(view.teams, undefined);
});

test('events reach only the team they concern', () => {
  let state = createInitialState(SEED, rules);
  state = apply(state, { type: 'set_throttle', carrierId: 1, throttle: 70 });
  const own = buildView(state, 1);
  const other = buildView(state, 0);
  assert.equal(own.events.length, 1);
  assert.equal(own.events[0].code, EVT_THROTTLE_SET);
  assert.equal(other.events.length, 0);
});

test('a snapshot carries one view per team plus the hash, and no state', () => {
  const state = createInitialState(SEED, rules);
  const snapshot = createSnapshot(state);
  assert.equal(snapshot.views.length, state.teams.length);
  assert.match(snapshot.stateHash, /^[0-9a-f]{16}$/);
  assert.equal(snapshot.state, undefined);
  assert.equal(snapshot.tick, 0);
});

test('views are hygienic enough to hash and to send as JSON', () => {
  const state = createInitialState(SEED, rules);
  const view = buildView(state, 0);
  assert.doesNotThrow(() => canonicalize(view));
  assert.deepEqual(JSON.parse(JSON.stringify(view)), view);
});

test('score and AI-seat events route by the team in slot a, not the payload in b', () => {
  const state = createInitialState(SEED, rules);
  state.events = [
    { code: 29, a: 1, b: 25, c: 1 }, // team 1 scored 25 for a kill
    { code: 38, a: 0, b: 1, c: 0 }, // team 0's seat went to the machine
  ];
  const view0 = buildView(state, 0);
  const view1 = buildView(state, 1);
  assert.ok(!view0.events.some((e) => e.code === 29), 'team 0 heard team 1 scoring');
  assert.ok(view1.events.some((e) => e.code === 29), 'team 1 never heard its own score');
  assert.ok(view0.events.some((e) => e.code === 38), 'team 0 never heard its seat change hands');
  assert.ok(!view1.events.some((e) => e.code === 38), 'team 1 heard about a seat not its own');
});

test('a conversion and a sinking are chart-level news for everybody', () => {
  const state = createInitialState(SEED, rules);
  state.events = [
    { code: 36, a: 3, b: 1, c: 0 }, // island 3 converted to team 1
    { code: 21, a: 0, b: 0, c: 0 }, // team 0's carrier went down
  ];
  for (const team of [0, 1]) {
    const view = buildView(state, team);
    assert.ok(view.events.some((e) => e.code === 36), `team ${team} did not hear the conversion`);
    assert.ok(view.events.some((e) => e.code === 21), `team ${team} did not hear the sinking`);
  }
});

test('buildView for a seatless team is still the fogless-nothing chart', () => {
  const state = createInitialState(SEED, rules);
  state.units[0].state = 1;
  state.islands[0].owner = 0;
  state.islands[0].stockMaterials = 4321;
  const view = buildView(state, -1);
  assert.equal(view.carriers.length, 0);
  assert.equal(view.units.length, 0);
  assert.equal(view.islands[0].stockMaterials, -1);
  assert.equal(JSON.stringify(view).includes('4321'), false);
});

test('the referee sees the whole war - which is why the table must consent', async () => {
  const { refereeView } = await import('../shared/view.js');
  const state = createInitialState(SEED, rules);
  state.units[0].state = 1;
  state.islands[0].owner = 0;
  state.islands[0].stockMaterials = 4321;
  state.teams[1].score = 77;

  const view = refereeView(state);
  assert.equal(view.team, -1);
  assert.equal(view.carriers.length, state.carriers.length, 'a referee missing hulls');
  assert.ok(view.carriers.every((c) => c.fuel >= 0), 'a referee shown contacts, not ships');
  assert.equal(view.units.length, 1);
  assert.equal(view.islands[0].stockMaterials, 4321, 'the referee could not see a stockpile');
  assert.deepEqual(view.scores.map((s) => s.score), [0, 77], 'the live scoreboard is the point');
  assert.doesNotThrow(() => canonicalize(view));
});

test('a snapshot carries the referee view for the observers the table allows', async () => {
  const { createSnapshot } = await import('../engine/snapshot.js');
  const state = createInitialState(SEED, rules);
  const snapshot = createSnapshot(state);
  assert.equal(snapshot.views.length, state.teams.length);
  assert.equal(snapshot.spectator.team, -1);
  assert.equal(snapshot.spectator.carriers.length, state.carriers.length);
});

test('ghosts reach only the team that remembers them, and only when stale', () => {
  const state = createInitialState(SEED, rules);
  state.tick = 100;
  state.contacts = [
    { team: 0, kind: 1, id: 1, unitKind: -1, x: 5000, y: 6000, heading: 0, tick: 40 },
    { team: 1, kind: 0, id: 3, unitKind: 0, x: 7000, y: 8000, heading: 0, tick: 90 },
    // Fresh this tick: the hull is on radar and reaches the view live, so the
    // ghost channel must NOT carry it too.
    { team: 0, kind: 1, id: 0, unitKind: -1, x: 1, y: 2, heading: 0, tick: 100 },
  ];
  const view0 = buildView(state, 0);
  assert.equal(view0.contacts.length, 1);
  assert.equal(view0.contacts[0].id, 1);
  assert.equal(view0.contacts[0].tick, 40);
  assert.equal(view0.contacts[0].team, undefined, 'a ghost record leaked whose memory it is');
  const view1 = buildView(state, 1);
  assert.equal(view1.contacts.length, 1);
  assert.equal(view1.contacts[0].unitKind, 0);
  // The spectator remembers nothing.
  assert.equal(buildView(state, -1).contacts.length, 0);
});

test('the scoreboard is fog while the war runs and a result once it ends', () => {
  const state = createInitialState(SEED, rules);
  state.teams[0].score = 120;
  state.teams[1].score = 340;
  assert.deepEqual(buildView(state, 0).scores, [], 'the enemy score leaked mid-war');
  state.phase = 1;
  state.winner = 1;
  state.winReason = 2;
  const over = buildView(state, 0);
  assert.deepEqual(over.scores, [{ id: 0, score: 120 }, { id: 1, score: 340 }]);
});

// --- The fog, checked as a PROPERTY rather than field by field -------------
//
// The tests above name the fields they care about, which is how a leak gets
// in: add something to the own view, forget the contact view, and nothing
// says so. These two check the shape instead, so a field added to one side
// and not the other fails here on the day it is written.

test('an enemy hull carries exactly the same keys as one of your own', () => {
  const state = createInitialState(SEED, rules);
  state.carriers[1].x = state.carriers[0].x + 1000;
  state.carriers[1].y = state.carriers[0].y;
  const unit = state.units.find((u) => u.team === 1);
  unit.state = 1; // UNIT_ACTIVE
  unit.x = state.carriers[0].x + 1000;
  unit.y = state.carriers[0].y;

  const view = buildView(state, 0);
  const mine = view.carriers.find((c) => c.team === 0);
  const theirs = view.carriers.find((c) => c.team === 1);
  assert.notEqual(theirs, undefined, 'the enemy should be on the scope for this test');
  assert.deepEqual(Object.keys(theirs).sort(), Object.keys(mine).sort(),
    'the contact view and the own view have drifted apart - a field added to'
    + ' one and not the other is either a leak or a hole');

  const myUnit = view.units.find((u) => u.team === 0);
  const theirUnit = view.units.find((u) => u.team === 1);
  if (myUnit !== undefined && theirUnit !== undefined) {
    assert.deepEqual(Object.keys(theirUnit).sort(), Object.keys(myUnit).sort(),
      'the unit contact view and the own unit view have drifted apart');
  }
});

test('nothing but position, heading and kind survives the fog', () => {
  // Every number on the enemy's records is given a value that appears
  // nowhere else in the war. Anything of theirs that reaches your view but
  // is not something radar honestly gives you shows up as one of these.
  const state = createInitialState(SEED, rules);
  const RADAR_GIVES = ['id', 'team', 'kind', 'x', 'y', 'z', 'heading', 'contact', 'unitKind'];
  const sentinels = [];
  let next = 700001;

  const brand = (record) => {
    for (const key of Object.keys(record)) {
      if (RADAR_GIVES.includes(key)) continue;
      if (typeof record[key] !== 'number') continue;
      record[key] = next;
      sentinels.push(next);
      next += 1;
    }
  };
  state.carriers[1].x = state.carriers[0].x + 1000;
  state.carriers[1].y = state.carriers[0].y;
  brand(state.carriers[1]);
  // Branding overwrote the position; put it back where radar can see it.
  state.carriers[1].x = state.carriers[0].x + 1000;
  state.carriers[1].y = state.carriers[0].y;
  state.carriers[1].hull = 900;
  state.carriers[1].maxHull = 1000;

  const text = JSON.stringify(buildView(state, 0));
  const leaked = sentinels.filter((value) => text.includes(String(value)));
  assert.deepEqual(leaked, [],
    `${leaked.length} enemy field(s) reached the other side's view`);
});

test('an island reads the same shape whoever holds it, and to the referee', async () => {
  const { refereeView } = await import('../shared/view.js');
  const state = createInitialState(SEED, rules);
  state.islands[0].owner = 0;
  state.islands[1].owner = 1;
  const view = buildView(state, 0);
  const mine = view.islands.find((i) => i.owner === 0);
  const theirs = view.islands.find((i) => i.owner === 1);
  assert.deepEqual(Object.keys(theirs).sort(), Object.keys(mine).sort(),
    'an island you hold and one you do not have different shapes');

  // The referee view is a THIRD island shape, and it has been wrong before:
  // the fog guard was copied into it with a variable that did not exist there.
  const referee = refereeView(state);
  assert.deepEqual(Object.keys(referee.islands[0]).sort(), Object.keys(mine).sort(),
    'the referee island view has drifted from the seat view');
  assert.deepEqual(
    Object.keys(referee.carriers[0]).sort(),
    Object.keys(view.carriers.find((c) => c.team === 0)).sort(),
    'the referee carrier view has drifted from the seat view',
  );
});
