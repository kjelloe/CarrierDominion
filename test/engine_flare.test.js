// Decoy flares: what turns the lock warning into a decision.

import test from 'node:test';
import assert from 'node:assert/strict';

import { loadRules, withoutAi } from './helpers/rules.mjs';
import { createInitialState } from '../engine/state.js';
import { apply } from '../engine/reducer.js';
import { canonicalize } from '../shared/statehash.js';
import { buildView } from '../shared/view.js';
import { checkFlares, fireFlares, lockedOn, shouldFlare } from '../engine/flare.js';
import { EVT_FLARES } from '../engine/events.js';

const rules = withoutAi(loadRules());
const TICK = { type: 'advance_tick' };
const SEED = 20260818;

function fresh() {
  return createInitialState(SEED, rules);
}

// A heat-seeker in the air with the ship's name on it, `metres` away.
function incoming(state, carrier, metres, overrides) {
  const shot = {
    id: state.nextShot,
    team: 1 - carrier.team,
    weapon: 3,
    x: carrier.x + metres * 256,
    y: carrier.y,
    z: 0,
    heading: 32768,
    climb: 0,
    speed: 3840,
    damage: 40,
    blast: 5632,
    life: 200,
    guided: 1,
    splash: 0,
    trigger: 0,
    turn: 900,
    targetKind: 1,
    targetId: carrier.id,
    ...overrides,
  };
  state.nextShot = state.nextShot + 1;
  state.shots.push(shot);
  return shot;
}

test('a ship sails with the launchers loaded', () => {
  const state = fresh();
  const carrier = state.carriers[0];
  assert.equal(carrier.flareCooldown, 0);
  assert.ok(carrier.flareCost > 0);
  assert.ok(carrier.flareRadius > 0);
  assert.equal(checkFlares(carrier), '');
});

test('a burst blinds every seeker inside it, and leaves the rest alone', () => {
  const state = fresh();
  const carrier = state.carriers[0];
  const near = incoming(state, carrier, 300);
  const far = incoming(state, carrier, 4000);
  // An unguided round is not fooled by a flare; there is nothing to fool.
  const dumb = incoming(state, carrier, 300, { guided: 0 });
  // Nor is your own.
  const mine = incoming(state, carrier, 300, { team: carrier.team });

  assert.equal(fireFlares(state, carrier), 1, 'the wrong number of seekers was blinded');
  assert.equal(near.guided, 0);
  assert.equal(near.targetId, -1);
  assert.equal(far.guided, 1, 'a burst reached a missile it had no business reaching');
  assert.equal(dumb.guided, 0);
  assert.equal(mine.guided, 1, 'the ship blinded its own missile');
});

test('a blinded missile flies on rather than vanishing', () => {
  let state = fresh();
  const carrier = state.carriers[0];
  const shot = incoming(state, carrier, 400, { heading: 32768 });
  const wasX = shot.x;
  fireFlares(state, carrier);
  state = apply(state, TICK);
  const after = state.shots.find((s) => s.id === shot.id);
  assert.notEqual(after, undefined, 'the missile evaporated');
  assert.equal(after.guided, 0);
  assert.ok(after.x < wasX, 'it stopped dead instead of flying on');
});

test('a burst costs ordnance and time', () => {
  const state = fresh();
  const carrier = state.carriers[0];
  const before = carrier.ordnance;
  fireFlares(state, carrier);
  assert.equal(carrier.ordnance, before - carrier.flareCost);
  assert.equal(carrier.flareCooldown, carrier.flareReload);
  assert.match(checkFlares(carrier), /reloading/);

  // And it is refused outright when there is nothing to burn.
  carrier.flareCooldown = 0;
  carrier.ordnance = carrier.flareCost - 1;
  assert.match(checkFlares(carrier), /no ordnance/);
});

test('the launchers reload on the tick, not by magic', () => {
  let state = fresh();
  state.carriers[0].flareCooldown = 3;
  state = apply(state, TICK);
  assert.equal(state.carriers[0].flareCooldown, 2);
  state = apply(state, TICK);
  state = apply(state, TICK);
  assert.equal(state.carriers[0].flareCooldown, 0);
  assert.equal(checkFlares(state.carriers[0]), '');
});

test('the command is refused when the launchers are not ready', () => {
  let state = fresh();
  state = apply(state, { type: 'fire_flares', carrierId: 0 });
  assert.ok(state.events.some((e) => e.code === EVT_FLARES));
  const spent = state.carriers[0].ordnance;

  state = apply(state, { type: 'fire_flares', carrierId: 0 });
  assert.equal(state.events[0].code, 1, 'a second burst went off during the reload');
  assert.equal(state.carriers[0].ordnance, spent, 'a refused burst still cost ordnance');
});

test('the AI fires when something is locked on and close, and not before', () => {
  const state = fresh();
  const carrier = state.carriers[0];
  assert.equal(shouldFlare(state, carrier), false, 'the ship fired at nothing');

  // Launched, but a long way out: the burst would be spent and reloaded before
  // the missile arrived.
  incoming(state, carrier, 5000);
  assert.equal(lockedOn(state, carrier), true);
  assert.equal(shouldFlare(state, carrier), false, 'the burst was wasted on a distant missile');

  incoming(state, carrier, 400);
  assert.equal(shouldFlare(state, carrier), true);
});

test('an AI carrier defends itself', () => {
  const both = { ...loadRules(), rules: { ...loadRules().rules, aiTeams: [0, 1] } };
  let state = createInitialState(SEED, both);
  const carrier = state.carriers[1];
  incoming(state, carrier, 300);
  // The AI runs on a cadence, so give it a few ticks to get to the decision.
  for (let tick = 0; tick < 8; tick++) state = apply(state, TICK);
  assert.ok(
    state.events.some((e) => e.code === EVT_FLARES) || state.carriers[1].flareCooldown > 0,
    'the AI watched a missile come in',
  );
});

test('flares reach the view and keep the state hygienic', () => {
  let state = fresh();
  const carrier = state.carriers[0];
  incoming(state, carrier, 300);
  state = apply(state, { type: 'fire_flares', carrierId: 0 });
  const view = buildView(state, 0);
  const own = view.carriers.find((c) => c.contact === 0);
  assert.equal(own.flareCooldown, own.flareReload);
  assert.ok(view.events.some((e) => e.code === EVT_FLARES));
  // An enemy learns nothing about your launchers.
  const contact = buildView(state, 1).carriers.find((c) => c.id === 0);
  if (contact !== undefined) assert.equal(contact.flareCooldown, -1);
  assert.doesNotThrow(() => canonicalize(state));
});
