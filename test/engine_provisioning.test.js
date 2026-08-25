// Ruling #3, applied to the hangar: nothing a unit takes aboard is conjured.
// Fuel comes out of the ship's bunker, rounds out of the ordnance store, a pod
// out of materials, a virus bomb out of ordnance - and a store too short to pay
// issues nothing.

import test from 'node:test';
import assert from 'node:assert/strict';

import { loadRules } from '../server/rules.js';
import { createInitialState } from '../engine/state.js';
import { apply } from '../engine/reducer.js';
import { recoverUnit, provisionWalrus, readyToLaunch } from '../engine/hangar.js';
import { replaceHull } from '../engine/repair.js';
import { payloadGramsOf } from '../engine/payload.js';
import { dispatchBoat, loadFromDepot } from '../engine/supply.js';
import { roundsOf } from '../engine/weapons.js';
import {
  KIND_LIGHTER,
  KIND_MANTA,
  KIND_WALRUS,
  UNIT_ACTIVE,
  UNIT_LOST,
  UNIT_STOWED,
} from '../engine/units.js';

const rules = loadRules();
const SEED = 20260818;

function fresh() {
  return createInitialState(SEED, rules);
}

test('recovery refuels from the bunker, and a short bunker fills what it can', () => {
  const state = fresh();
  const carrier = state.carriers[0];
  const manta = state.units.find((u) => u.team === 0 && u.kind === KIND_MANTA);
  manta.state = UNIT_ACTIVE;
  manta.fuel = 1000;

  const bunkerBefore = carrier.fuel;
  recoverUnit(manta, carrier, state.weapons);
  assert.equal(manta.fuel, manta.fuelCapacity);
  assert.equal(carrier.fuel, bunkerBefore - (manta.fuelCapacity - 1000),
    'the aviation fuel came from nowhere');

  // A nearly dry ship issues what it has, and no more.
  const second = state.units.find((u) => u.team === 0 && u.kind === KIND_MANTA && u.id !== manta.id);
  second.state = UNIT_ACTIVE;
  second.fuel = 0;
  carrier.fuel = 300;
  recoverUnit(second, carrier, state.weapons);
  assert.equal(second.fuel, 300);
  assert.equal(carrier.fuel, 0);
});

// Since the fitting screen (ruled 2026-08-25) a Walrus is not only limited
// by what the stores hold but by what it can LIFT: guns and mines are
// 1,400 kg of its 2,000, the pod is 400 and the bomb 300, so it goes ashore
// with one capture device or the other and never both.
test('a Walrus sails with a pod, and the bomb waits for weight it has not got', () => {
  const state = fresh();
  const carrier = state.carriers[0];
  const walrus = state.units.find((u) => u.team === 0 && u.kind === KIND_WALRUS);
  assert.equal(walrus.pod, 1, 'pods are standard complement');
  assert.equal(walrus.virus, 0, 'a virus bomb should not be free shipyard equipment');

  const ordnanceBefore = carrier.ordnance;
  provisionWalrus(walrus, carrier, state.weapons);
  assert.equal(walrus.virus, 0, 'a full hull took a bomb it cannot lift');
  assert.equal(carrier.ordnance, ordnanceBefore, 'and was charged for it');

  // Land the mines and the weight is there.
  walrus.arms[1].n = 0;
  provisionWalrus(walrus, carrier, state.weapons);
  assert.equal(walrus.virus, 1);
  assert.equal(carrier.ordnance, ordnanceBefore - carrier.virusOrdnance);
  assert.ok(payloadGramsOf(walrus, state.weapons) <= walrus.payloadMaxGrams,
    'the hull is over its own budget');

  // Already carrying it: nothing more is charged.
  provisionWalrus(walrus, carrier, state.weapons);
  assert.equal(carrier.ordnance, ordnanceBefore - carrier.virusOrdnance);
});

test('a spent pod is replaced for materials, and an empty store issues nothing', () => {
  const state = fresh();
  const carrier = state.carriers[0];
  const walrus = state.units.find((u) => u.team === 0 && u.kind === KIND_WALRUS);
  walrus.state = UNIT_ACTIVE;
  walrus.pod = 0;
  walrus.virus = 0;
  carrier.materials = 0;
  carrier.ordnance = 0;

  recoverUnit(walrus, carrier, state.weapons);
  assert.equal(walrus.pod, 0, 'a pod was issued from an empty store');
  assert.equal(walrus.virus, 0, 'a virus bomb was issued from an empty store');

  // Weight is a separate refusal from an empty store, and this test is about
  // the store: land the mines so both devices fit, and the only question
  // left is whether the hold can pay.
  walrus.arms[1].n = 0;
  carrier.materials = carrier.podMaterials;
  carrier.ordnance = carrier.virusOrdnance;
  provisionWalrus(walrus, carrier, state.weapons);
  assert.equal(walrus.pod, 1);
  assert.equal(walrus.virus, 1);
  assert.equal(carrier.materials, 0);
  assert.equal(carrier.ordnance, 0);
});

test('a rebuilt hull is paid for in full: chassis, fuel, and every round aboard', () => {
  const state = fresh();
  const carrier = state.carriers[0];
  const manta = state.units.find((u) => u.team === 0 && u.kind === KIND_MANTA);
  manta.state = UNIT_LOST;
  manta.hp = 0;
  manta.fuel = 0;
  carrier.chassis = state.economy.chassisPerHull;

  const ordnanceBefore = carrier.ordnance;
  const bunkerBefore = carrier.fuel;
  assert.equal(replaceHull(state, carrier), 1);
  assert.equal(manta.state, UNIT_STOWED);
  assert.ok(carrier.ordnance < ordnanceBefore, 'the magazines were conjured');
  assert.ok(carrier.fuel < bunkerBefore, 'the tank was conjured');
  assert.ok(roundsOf(manta, 3) > 0, 'a paid-for rebuild should carry missiles');

  // And a broke ship rebuilds a hull that flies EMPTY rather than not at all.
  const second = state.units.find(
    (u) => u.team === 0 && u.kind === KIND_MANTA && u.id !== manta.id,
  );
  second.state = UNIT_LOST;
  second.hp = 0;
  carrier.chassis = state.economy.chassisPerHull;
  carrier.ordnance = 0;
  assert.equal(replaceHull(state, carrier), 1);
  assert.equal(roundsOf(second, 3), 0);
});

test('a dispatched boat bunkers from the depot, and a dry depot launches nothing', () => {
  const state = fresh();
  const carrier = state.carriers[0];
  const depot = state.islands[0];
  depot.owner = 0;
  depot.stockChassis = state.economy.chassisPerHull;
  depot.stockFuel = 5000;
  for (const unit of state.units) {
    if (unit.carrierId === carrier.id && unit.kind === KIND_LIGHTER) {
      unit.state = UNIT_LOST;
      unit.hp = 0;
    }
  }

  const boat = dispatchBoat(state, carrier, depot);
  assert.notEqual(boat, -1);
  assert.equal(boat.fuel, 5000, 'the boat took more fuel than the depot held');
  assert.equal(depot.stockFuel, 0);

  // Sink it again: no fuel ashore, no boat.
  boat.state = UNIT_LOST;
  boat.hp = 0;
  depot.stockChassis = state.economy.chassisPerHull;
  assert.equal(dispatchBoat(state, carrier, depot), -1);
});

test('an empty tank stays on the deck', () => {
  const state = fresh();
  const carrier = state.carriers[0];
  for (const unit of state.units) {
    if (unit.carrierId === carrier.id && unit.kind === KIND_MANTA) unit.fuel = 0;
  }
  assert.equal(readyToLaunch(state, carrier.id, KIND_MANTA), -1);
  const next = apply(state, { type: 'launch_unit', carrierId: carrier.id, kind: KIND_MANTA });
  assert.ok(next.units.every((u) => u.kind !== KIND_MANTA || u.state === UNIT_STOWED));
});

test('the yard shopping list rides first: parts beat fuel onto a boat when hulls are down', () => {
  const state = fresh();
  const carrier = state.carriers[0];
  const boat = state.units.find((u) => u.carrierId === carrier.id && u.kind === KIND_LIGHTER);
  boat.state = UNIT_ACTIVE;
  const manta = state.units.find((u) => u.carrierId === carrier.id && u.kind === KIND_MANTA);
  manta.state = UNIT_LOST;
  manta.hp = 0;

  const depot = state.islands[0];
  depot.owner = 0;
  // Fuel abundant enough to fill the whole hold on its own; twelve parts on
  // the quay. Without the priority the parts never sail.
  depot.stockFuel = boat.cargoCap * 2;
  depot.stockChassis = state.economy.chassisPerHull;

  while (loadFromDepot(state, boat, depot) > 0) { /* work the quay dry or full */ }
  assert.equal(boat.cargoChassis, state.economy.chassisPerHull,
    'the hold filled with fuel and the parts stayed ashore');
  assert.ok(boat.cargoFuel > 0, 'the priority starved the fuel entirely');

  // With nothing lost, parts are back to travelling last, in the spare room.
  const second = fresh();
  const boat2 = second.units.find((u) => u.kind === KIND_LIGHTER);
  boat2.state = UNIT_ACTIVE;
  const depot2 = second.islands[0];
  depot2.owner = 0;
  depot2.stockFuel = boat2.cargoCap * 2;
  depot2.stockChassis = second.economy.chassisPerHull;
  while (loadFromDepot(second, boat2, depot2) > 0) { /* again */ }
  assert.equal(boat2.cargoChassis, 0, 'parts hogged a hold no yard was waiting for');
});
