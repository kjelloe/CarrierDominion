// A rough sea reaches the small craft (owner's ruling 2026-08-26, Q1b).
//
// The weather was render-only apart from radar. This is the second effect
// wired to the simulation: a heavy sea slows anything punching through it,
// and lifts a pilot off the wavetops. Two things this file is really here to
// hold down - that the slowing applies AFLOAT only, and that the flight floor
// binds the aircraft rather than the stick.

import test from 'node:test';
import assert from 'node:assert/strict';

import { bareRules } from './helpers/rules.mjs';
import { createInitialState } from '../engine/state.js';
import { targetAltitudeFor } from '../engine/flight.js';
import {
  flightFloorMetresFor,
  seaSpeedPermilFor,
  seaStatePermil,
  weatherAt,
} from '../shared/weather.js';
import { KIND_MANTA, KIND_WALRUS, ORDER_MOVE, UNIT_ACTIVE } from '../engine/units.js';
import { stepWalrus } from '../engine/drive.js';

const SEED = 20260818;
const CALM = { windPermil: 0 };
const GALE = { windPermil: 1000 };

test('a heavy sea slows a surface craft, and never past the floor', () => {
  assert.equal(seaSpeedPermilFor(CALM, 650), 1000, 'glassy water cost speed');
  assert.equal(seaSpeedPermilFor(GALE, 650), 650, 'a gale broke the floor');
  // Halfway out is halfway down, and the floor is a rule not a constant.
  assert.equal(seaSpeedPermilFor({ windPermil: 500 }, 600), 800);
  assert.equal(seaSpeedPermilFor(GALE, 1000), 1000, 'a floor of 1000 must cost nothing');
});

test('the sea state is the wind, and every figure stays in range', () => {
  for (let tick = 0; tick < 120000; tick += 97) {
    const weather = weatherAt(SEED, tick);
    const sea = seaStatePermil(weather);
    assert.ok(sea >= 0 && sea <= 1000, `sea state ${sea} out of range at ${tick}`);
    const speed = seaSpeedPermilFor(weather, 650);
    assert.ok(speed >= 650 && speed <= 1000, `speed multiplier ${speed} at ${tick}`);
    assert.ok(Number.isInteger(speed), 'the multiplier is not an integer');
  }
});

test('the flight floor rises with the sea, between its two rules', () => {
  assert.equal(flightFloorMetresFor(CALM, 12, 90), 12, 'calm water raised the floor');
  assert.equal(flightFloorMetresFor(GALE, 12, 90), 90, 'a gale did not raise the floor');
  for (let tick = 0; tick < 120000; tick += 97) {
    const metres = flightFloorMetresFor(weatherAt(SEED, tick), 12, 90);
    assert.ok(metres >= 12 && metres <= 90, `floor ${metres} m out of range at ${tick}`);
    assert.ok(Number.isInteger(metres), 'the floor is not an integer');
  }
  // A storm figure at or below the calm one is a no-op, not an inversion.
  assert.equal(flightFloorMetresFor(GALE, 40, 12), 40);
});

// --- the two mistakes this rule could make ---------------------------------

test('a Walrus ashore is not slowed by the sea', () => {
  // Classifying by the wrong axis is a whole failure class in the review
  // skill. A heavy sea has no opinion about a vehicle climbing a hillside,
  // and the amphibian is the one hull that can be in either place.
  const rules = bareRules();
  const state = createInitialState(SEED, rules);
  const params = state.params;
  assert.ok(params.seaStateSlowPermil > 0 && params.seaStateSlowPermil < 1000,
    'the rule must actually cost something for this test to mean anything');

  // targetSpeedFor is not exported, so drive the real thing: the same hull,
  // the same gale, once afloat and once ashore.
  const afloat = walrusOnWater(state);
  const ashore = walrusOnLand(state);
  const gale = seaSpeedPermilFor(GALE, params.seaStateSlowPermil);

  for (let i = 0; i < 200; i++) stepWalrus(afloat, state.islands, params.sizeUnits, gale);
  for (let i = 0; i < 200; i++) stepWalrus(ashore, state.islands, params.sizeUnits, gale);

  // Exactly the sea-limited speed, not merely "slower": `< maxSpeed` would
  // also pass for a boat that was stuck against a hillside, which is the
  // reading that would make this test worthless.
  const wanted = Math.floor(afloat.maxSpeed * gale / 1000);
  assert.equal(afloat.speed, wanted,
    `the boat made ${afloat.speed} in a gale; the rule says ${wanted}`
    + ` (top speed ${afloat.maxSpeed}, multiplier ${gale})`);
  assert.ok(afloat.speed > 0, 'the gale stopped the boat dead - that is not the rule');
  assert.equal(ashore.speed, ashore.landSpeed,
    `the gale slowed a vehicle on dry land to ${ashore.speed} of ${ashore.landSpeed}`);
});

test('the flight floor binds the aircraft, not the stick', () => {
  // If the floor only applied to a diving PILOT, the rule would constrain the
  // human and leave the machine untouched - and the machine is the one the
  // human is measuring themselves against.
  const rules = bareRules();
  const state = createInitialState(SEED, rules);
  const manta = state.units.find((u) => u.kind === KIND_MANTA);
  manta.state = UNIT_ACTIVE;
  manta.x = 2000 * 256;
  manta.y = 2000 * 256;

  const floor = 90 * 256;
  // Nobody flying it, and it is under the floor: the floor still lifts it.
  manta.control = -1;
  manta.z = 5 * 256;
  const autoWants = targetAltitudeFor(manta, state.islands, state.params.sizeUnits, floor);
  assert.ok(autoWants >= floor,
    `the autopilot wanted ${autoWants} under a floor of ${floor}`);

  // And a pilot on full forward stick gets the floor, not the wavetops.
  manta.control = 0;
  manta.climb = -1;
  const pilotWants = targetAltitudeFor(manta, state.islands, state.params.sizeUnits, floor);
  assert.equal(pilotWants, floor, 'full forward stick went under the storm floor');
});

test('the sea reaches the simulation only through the rules', () => {
  // The weather is derived, so the ONLY way it can touch a war is through a
  // number in data/rules.json. Set both rules to nothing and the war must be
  // exactly the war we had before the weather existed.
  const rules = bareRules();
  const state = createInitialState(SEED, rules);
  assert.notEqual(state.params.seaStateSlowPermil, undefined, 'the rule never arrived');
  assert.notEqual(state.params.flightFloorCalm, undefined, 'the calm floor never arrived');
  assert.notEqual(state.params.flightFloorStorm, undefined, 'the storm floor never arrived');
  assert.ok(state.params.flightFloorStorm > state.params.flightFloorCalm,
    'the storm floor must be above the calm one or the rule does nothing');
});

// --- helpers ---------------------------------------------------------------

function walrusOnWater(state) {
  const hull = makeWalrus(state);
  hull.x = 2000 * 256;
  hull.y = 2000 * 256;
  return hull;
}

function walrusOnLand(state) {
  const hull = makeWalrus(state);
  // Stand it on the highest ground we can find, so it is unambiguously
  // ashore and has somewhere flat enough to drive.
  let best = null;
  for (const island of state.islands) {
    if (best === null || island.radius > best.radius) best = island;
  }
  hull.x = best.x;
  hull.y = best.y;
  return hull;
}

function makeWalrus(state) {
  const source = state.units.find((u) => u.kind === KIND_WALRUS);
  assert.notEqual(source, undefined, 'no Walrus in the war to copy');
  const hull = { ...source };
  hull.state = UNIT_ACTIVE;
  hull.control = -1;
  hull.order = ORDER_MOVE;
  hull.speed = 0;
  hull.avoidTicks = 0;
  hull.blocked = 0;
  hull.targetX = hull.x;
  hull.targetY = hull.y;
  return hull;
}
