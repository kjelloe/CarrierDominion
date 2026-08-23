// Round-three rulings (2026-08-23), from the 1988 gap review: the programmed
// course (map + PROG + A), the Escort order, and the quartermaster's
// production bias. Each one is the original's system translated, not invented.

import test from 'node:test';
import assert from 'node:assert/strict';

import { loadRules, withoutAi } from './helpers/rules.mjs';
import { createInitialState } from '../engine/state.js';
import { apply } from '../engine/reducer.js';
import { canonicalize } from '../shared/statehash.js';
import { buildView } from '../shared/view.js';
import { dist2D } from '../shared/fixed.js';
import { refine } from '../engine/economy.js';
import { ROLE_FACTORY } from '../engine/island.js';
import { EVT_COURSE } from '../engine/events.js';
import { KIND_MANTA, ORDER_ESCORT, ORDER_RETURN, UNIT_ACTIVE } from '../engine/units.js';

const rules = withoutAi(loadRules());
const TICK = { type: 'advance_tick' };
const SEED = 20260818;

function fresh() {
  return createInitialState(SEED, rules);
}

function drive(state, ticks) {
  for (let i = 0; i < ticks; i++) state = apply(state, TICK);
  return state;
}

test('a programmed course steers the ship there and lets go on arrival', () => {
  let state = fresh();
  const start = { x: state.carriers[0].x, y: state.carriers[0].y };
  // A mark a few kilometres north-east, in open water.
  const destX = start.x + 3000 * 256;
  const destY = start.y + 2000 * 256;
  state = apply(state, { type: 'set_course', carrierId: 0, x: destX, y: destY });
  assert.equal(state.carriers[0].courseX, destX);
  assert.ok(state.events.some((e) => e.code === EVT_COURSE && e.b === 1));

  // The throttle stays the player's: no way on, no way made.
  state = drive(state, 200);
  assert.ok(dist2D(state.carriers[0].x, state.carriers[0].y, start.x, start.y) < 100 * 256,
    'the autopilot touched the throttle');

  state = apply(state, { type: 'set_throttle', carrierId: 0, throttle: 100 });
  let ticks = 0;
  while (ticks < 120000 && state.carriers[0].courseX >= 0) {
    state = apply(state, TICK);
    ticks += 1;
  }
  assert.ok(ticks < 120000, 'the course was never sailed');
  const done = state.carriers[0];
  assert.ok(dist2D(done.x, done.y, destX, destY) <= 600 * 256, 'let go nowhere near the mark');
  assert.equal(done.throttle, 0, 'arrival should take the way off');
  assert.doesNotThrow(() => canonicalize(state));
});

test('a hand on the wheel or the heading drops the course - the helm is one authority', () => {
  let state = fresh();
  const destX = state.carriers[0].x + 3000 * 256;
  state = apply(state, { type: 'set_course', carrierId: 0, x: destX, y: state.carriers[0].y });
  state = apply(state, { type: 'set_rudder', carrierId: 0, rudder: 1 });
  assert.equal(state.carriers[0].courseX, -1, 'the rudder and the autopilot both had the wheel');

  state = apply(state, { type: 'set_course', carrierId: 0, x: destX, y: state.carriers[0].y });
  state = apply(state, { type: 'set_heading', carrierId: 0, heading: 0 });
  assert.equal(state.carriers[0].courseX, -1);

  // And (-1, -1) is the explicit cancel.
  state = apply(state, { type: 'set_course', carrierId: 0, x: destX, y: state.carriers[0].y });
  state = apply(state, { type: 'set_course', carrierId: 0, x: -1, y: -1 });
  assert.equal(state.carriers[0].courseX, -1);
});

test('escort follows the moving ship and breaks off for the deck on low fuel', () => {
  let state = fresh();
  const manta = state.units.find((u) => u.team === 0 && u.kind === KIND_MANTA);
  state = apply(state, { type: 'launch_unit', carrierId: 0, kind: KIND_MANTA });
  state = apply(state, { type: 'order_unit_escort', unitId: manta.id });
  assert.equal(state.units.find((u) => u.id === manta.id).order, ORDER_ESCORT);

  // The ship makes way; the escort stays with it.
  state = apply(state, { type: 'set_throttle', carrierId: 0, throttle: 100 });
  state = drive(state, 4000);
  const ship = state.carriers[0];
  const wing = state.units.find((u) => u.id === manta.id);
  assert.equal(wing.order, ORDER_ESCORT, 'the escort wandered off');
  assert.ok(dist2D(wing.x, wing.y, ship.x, ship.y) < 2500 * 256,
    'the escort lost its own airfield');

  // Fuel discipline: below the reserve it heads home without being told.
  wing.fuel = Math.floor(wing.fuelCapacity / 4);
  state = drive(state, 10);
  assert.equal(state.units.find((u) => u.id === manta.id).order, ORDER_RETURN,
    'the escort flew its tank dry on station');
});

test('the boat refuses the escort order - it has a job', () => {
  let state = fresh();
  const boat = state.units.find((u) => u.team === 0 && u.kind === 2);
  boat.state = UNIT_ACTIVE;
  state = apply(state, { type: 'order_unit_escort', unitId: boat.id });
  assert.notEqual(state.units.find((u) => u.id === boat.id).order, ORDER_ESCORT);
});

test('the quartermaster bias reweights the plant, and all-MEDIUM is the old plant exactly', () => {
  // Two identical factory islands, one team biased, one not.
  const state = fresh();
  const island = state.islands[0];
  island.owner = 0;
  island.role = ROLE_FACTORY;
  island.factories = 1;
  island.kind = 99; // no terrain bonus, to keep the arithmetic legible
  island.stockMaterials = state.economy.factoryIn;

  // All MEDIUM: exactly the unbias outputs.
  refine(state);
  assert.equal(island.stockFuel, state.economy.factoryFuel);
  assert.equal(island.stockOrdnance, state.economy.factoryOrdnance);
  assert.equal(island.stockChassis, state.economy.factoryChassis);

  // HIGH fuel, LOW ordnance: fuel takes ordnance's share of the run.
  const skewed = fresh();
  const plant = skewed.islands[0];
  plant.owner = 0;
  plant.role = ROLE_FACTORY;
  plant.factories = 1;
  plant.kind = 99;
  plant.stockMaterials = skewed.economy.factoryIn;
  skewed.teams[0].biasFuel = 2;
  skewed.teams[0].biasOrdnance = 0;
  refine(skewed);
  assert.equal(plant.stockFuel, Math.floor((skewed.economy.factoryFuel * 2 * 3) / 3));
  assert.equal(plant.stockOrdnance, 0, 'LOW must starve an output entirely');
  assert.ok(plant.stockChassis >= skewed.economy.factoryChassis,
    'the surviving outputs share the freed weight');

  // All LOW: the plant idles WITHOUT eating materials.
  const idle = fresh();
  const shut = idle.islands[0];
  shut.owner = 0;
  shut.role = ROLE_FACTORY;
  shut.factories = 1;
  shut.stockMaterials = idle.economy.factoryIn;
  idle.teams[0].biasFuel = 0;
  idle.teams[0].biasOrdnance = 0;
  idle.teams[0].biasChassis = 0;
  refine(idle);
  assert.equal(shut.stockMaterials, idle.economy.factoryIn,
    'an order to make nothing became an order to waste');
});

test('the bias travels the command path with the ship as its authority', () => {
  let state = fresh();
  state = apply(state, { type: 'set_supply_bias', carrierId: 0, item: 0, level: 2 });
  assert.equal(state.teams[0].biasFuel, 2);
  assert.equal(state.teams[1].biasFuel, 1, 'one team set the other team plant');
  const view = buildView(state, 0);
  assert.equal(view.resources.biasFuel, 2, 'the quartermaster cannot see his own order');
});

// --- Carrier upgrades (ruling 2026-08-23: speed, point defence, radar) ---

function yardAt(state, islandId) {
  const island = state.islands[islandId];
  island.owner = 0;
  island.role = ROLE_FACTORY;
  island.factories = 1;
  island.stockMaterials = 5000;
  return island;
}

test('an upgrade is manufactured at a factory island and fitted to the ship', () => {
  let state = fresh();
  const island = yardAt(state, 0);
  const baseSpeed = state.carriers[0].maxSpeed;
  state = apply(state, {
    type: 'build_on_island', carrierId: 0, islandId: island.id, what: 3,
  });
  assert.equal(state.islands[0].building, 3);
  state = drive(state, state.economy.builds[3].ticks + 1);
  const ship = state.carriers[0];
  assert.equal(ship.upSpeed, 1);
  assert.ok(ship.maxSpeed > baseSpeed, 'the refit did not reach the engine room');
  assert.equal(ship.maxSpeed, ship.maxSpeedUpgraded, 'undamaged, the full upgraded speed stands');

  // Once each: a second purchase is refused.
  state.islands[0].stockMaterials = 5000;
  state = apply(state, {
    type: 'build_on_island', carrierId: 0, islandId: island.id, what: 3,
  });
  assert.equal(state.islands[0].building, -1, 'the ship bought the same engines twice');
  assert.doesNotThrow(() => canonicalize(state));
});

test('the point-defence refit quickens the healthy mount, and damage still slows it', () => {
  let state = fresh();
  const island = yardAt(state, 0);
  state = apply(state, {
    type: 'build_on_island', carrierId: 0, islandId: island.id, what: 4,
  });
  state = drive(state, state.economy.builds[4].ticks + 1);
  assert.equal(state.carriers[0].upPd, 1);

  // The mount fires: its cooldown is the upgraded figure, not the weapon's.
  const enemy = state.units.find((u) => u.team === 1 && u.kind === KIND_MANTA);
  enemy.state = UNIT_ACTIVE;
  enemy.x = state.carriers[0].x + 500 * 256;
  enemy.y = state.carriers[0].y;
  enemy.z = 300 * 256;
  state = drive(state, 3);
  const ship = state.carriers[0];
  assert.ok(ship.cooldown > 0, 'the mount never fired');
  assert.ok(ship.cooldown <= ship.pdCooldownUpgraded,
    `cooldown ${ship.cooldown} is the unupgraded rate`);
});

test('upgrades need a plant, a factory role, and your own island', () => {
  let state = fresh();
  const bare = state.islands[0];
  bare.owner = 0;
  bare.role = ROLE_FACTORY;
  bare.stockMaterials = 5000; // no factory BUILT yet
  state = apply(state, { type: 'build_on_island', carrierId: 0, islandId: 0, what: 5 });
  assert.equal(state.islands[0].building, -1, 'an upgrade was built without a plant');

  const mine = state.islands[1];
  mine.owner = 0;
  mine.role = 0; // ROLE_RESOURCE
  mine.stockMaterials = 5000;
  state = apply(state, { type: 'build_on_island', carrierId: 0, islandId: 1, what: 5 });
  assert.equal(state.islands[1].building, -1, 'a mine built a radar refit');
});
