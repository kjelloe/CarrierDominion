import test from 'node:test';
import assert from 'node:assert/strict';

import { loadRules } from '../server/rules.js';
import { createInitialState } from '../engine/state.js';
import { createIslands, worldSizeMetres } from '../engine/worldgen.js';
import { SEABED_UNITS, islandHeightAt, skirtRadius, worldHeightAt } from '../engine/heightmap.js';
import { hashState } from '../engine/snapshot.js';

const rules = loadRules();

// Golden worldgen hash. Moving it means the map for every existing seed
// changed - re-pin only with a note in dev-log.md saying why.
// Re-pinned 2026-08-20 for the provisioning slice, for the minor-items slice,
// twice on 2026-08-21 (contact memory; lastContactTick), on 2026-08-22 for
// the pilot's vertical axis, three times on 2026-08-23 (course +
// quartermaster bias; the three carrier upgrades; actionStart joining
// data/rules.json as a first-class rule), and again on 2026-08-23 for
// islandCountMax 32 -> 64 in data/world.json - a documentation knob nothing
// reads, moving only the rules hash. Re-pinned 2026-08-24 for the hangar
// repair fields (unitRepairHp/unitRepairMaterials joining state.economy) -
// zero event drift, bookkeeping only - and again the same day for the
// telemetry leash rules (telemetryFade/LossMetres), also drift-free, and a
// third time for the runway works (island.runway, unit.landedIsland, the
// builds row), and a fourth for the command centre (island.nodeHp/nodeZ,
// commandCentreHp) - drift-free every time. Re-pinned 2026-08-25 for the
// HOME ISLAND (ruled: the Strategy game starts on a developed base) - the
// first FORCED repin: the event stream legitimately drifted, two code-8
// launches at tick 1, which are the two supply lighters sailing from the
// new home depots. That is the ruling working, not a bug. Re-pinned again
// the same day for the loadout presets (carrier.mantaPreset,
// state.presets, the weapons.json table) - drift-free, and once more for
// the Hammerhead (carrier battery fields, the weapon row, two Viewing
// Drones aboard every carrier) - drift-free, and for the decoy screen
// (four kind-4 hulls per carrier, decoysOut/decoyPenalty, the station
// params) - drift-free, and for the ISLAND TEETH (a token silo on every
// island, the Bat Cave's rebuild clock and stat row) - drift-free too: the
// silos are on the map at tick zero but the fixture's 300 ticks never bring
// anything into their reach. Re-pinned once more for the comm-pod refit
// (carrier.upComm, unit.commPod, the builds row) - drift-free. The
// MAP itself has not changed since
// the first pin: islands, nodes and start positions are byte-identical
// throughout (the ring-walk fix in the same slice touches only tables of
// more than four teams, which no pin covers).
const GOLDEN_SEED = 20260818;
const GOLDEN_WORLD_HASH = '183106dd33891bb0';

test('worldgen places the requested island count', () => {
  const generated = createIslands(GOLDEN_SEED, rules.world, rules.rules.unitsPerMetre);
  assert.equal(generated.islands.length, rules.world.islandCount);
  assert.ok(generated.attempts < rules.world.placementAttempts, 'placement should not exhaust');
});

test('worldgen is deterministic across runs', () => {
  const a = createIslands(4242, rules.world, rules.rules.unitsPerMetre);
  const b = createIslands(4242, rules.world, rules.rules.unitsPerMetre);
  assert.deepEqual(a.islands, b.islands);
  assert.equal(a.rngState, b.rngState);
});

test('different seeds give different archipelagos', () => {
  const a = createIslands(1, rules.world, rules.rules.unitsPerMetre);
  const b = createIslands(2, rules.world, rules.rules.unitsPerMetre);
  assert.notDeepEqual(a.islands, b.islands);
});

test('islands never overlap and stay inside the margin', () => {
  const unitsPerMetre = rules.rules.unitsPerMetre;
  const sizeUnits = rules.world.sizeMetres * unitsPerMetre;
  const margin = rules.world.edgeMarginMetres * unitsPerMetre;
  const minSpacing = rules.world.minSpacingMetres * unitsPerMetre;
  for (let seed = 1; seed <= 25; seed++) {
    const { islands } = createIslands(seed, rules.world, unitsPerMetre);
    assert.equal(islands.length, rules.world.islandCount, `seed ${seed} came up short`);
    for (let i = 0; i < islands.length; i++) {
      const a = islands[i];
      assert.ok(a.x >= margin && a.x <= sizeUnits - margin, `seed ${seed} island ${i} off-map`);
      assert.ok(a.y >= margin && a.y <= sizeUnits - margin, `seed ${seed} island ${i} off-map`);
      for (let j = i + 1; j < islands.length; j++) {
        const b = islands[j];
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        const need = a.radius + b.radius + minSpacing;
        assert.ok(dx * dx + dy * dy >= need * need, `seed ${seed}: islands ${i} and ${j} crowd`);
      }
    }
  }
});

test('every island record is integers only', () => {
  const { islands } = createIslands(GOLDEN_SEED, rules.world, rules.rules.unitsPerMetre);
  for (const island of islands) {
    for (const [key, value] of Object.entries(island)) {
      assert.ok(Number.isInteger(value), `${key} is not an integer: ${value}`);
    }
  }
});

test('island terrain rises above water inland and sinks to the open sea', () => {
  const { islands } = createIslands(GOLDEN_SEED, rules.world, rules.rules.unitsPerMetre);
  for (const island of islands) {
    assert.ok(islandHeightAt(island, island.x, island.y) > 0, `island ${island.id} centre is submerged`);
    // The coastline is warped, so "exactly one radius out" may be either land
    // or water. What must hold is that far enough out is always the flat
    // seabed, and that the whole island is below its own peak.
    const warpReach = Math.ceil((island.radius * island.warpPermil) / 1000);
    const clear = island.x + skirtRadius(island) + warpReach + 10;
    assert.equal(islandHeightAt(island, clear, island.y), SEABED_UNITS, 'open sea is the flat floor');
    for (let a = 0; a < 8; a++) {
      const angle = (a / 8) * Math.PI * 2;
      const x = island.x + Math.round(Math.cos(angle) * island.radius * 0.9);
      const y = island.y + Math.round(Math.sin(angle) * island.radius * 0.9);
      assert.ok(islandHeightAt(island, x, y) <= island.peak, 'nothing may exceed the peak');
    }
  }
});

test('the warped coastline is not a circle', () => {
  const { islands } = createIslands(GOLDEN_SEED, rules.world, rules.rules.unitsPerMetre);
  for (const island of islands) {
    // Walk out along eight bearings and record where each crosses sea level.
    const shorelines = [];
    for (let a = 0; a < 8; a++) {
      const angle = (a / 8) * Math.PI * 2;
      let last = 0;
      for (let step = 1; step <= 60; step++) {
        const distance = (island.radius * 1.4 * step) / 60;
        const x = island.x + Math.round(Math.cos(angle) * distance);
        const y = island.y + Math.round(Math.sin(angle) * distance);
        if (islandHeightAt(island, x, y) > 0) last = distance;
      }
      shorelines.push(last);
    }
    const spread = Math.max(...shorelines) - Math.min(...shorelines);
    assert.ok(
      spread > island.radius * 0.08,
      `island ${island.id} coastline varies by only ${Math.round(spread / 256)} m`,
    );
  }
});

test('terrain sampling is a pure function of position', () => {
  const { islands } = createIslands(GOLDEN_SEED, rules.world, rules.rules.unitsPerMetre);
  const island = islands[0];
  for (let i = 0; i < 200; i++) {
    const x = island.x + i * 137;
    const y = island.y - i * 91;
    assert.equal(worldHeightAt(islands, x, y), worldHeightAt(islands, x, y));
    assert.ok(Number.isInteger(worldHeightAt(islands, x, y)));
  }
});

test('carriers start in open water with room to get under way', () => {
  for (let seed = 1; seed <= 25; seed++) {
    const state = createInitialState(seed, rules);
    for (const carrier of state.carriers) {
      const depth = worldHeightAt(state.islands, carrier.x, carrier.y);
      assert.ok(depth < -carrier.draught, `seed ${seed} carrier ${carrier.id} spawned aground`);
      // And in every direction it might first steam: a spawn with a shoal one
      // ship length off the bow is a spawn that grounds on its first order.
      for (let a = 0; a < 16; a++) {
        const angle = (a / 16) * Math.PI * 2;
        const x = carrier.x + Math.round(Math.cos(angle) * carrier.lookahead * 2);
        const y = carrier.y + Math.round(Math.sin(angle) * carrier.lookahead * 2);
        assert.ok(
          worldHeightAt(state.islands, x, y) < -carrier.draught,
          `seed ${seed} carrier ${carrier.id} has a shoal on bearing ${Math.round((a / 16) * 360)}`,
        );
      }
    }
  }
});

test('the golden world hash has not moved', () => {
  const state = createInitialState(GOLDEN_SEED, rules);
  assert.equal(hashState(state), GOLDEN_WORLD_HASH);
});

test('the ocean grows with the island count, at constant density', () => {
  const base = rules.world;
  assert.equal(worldSizeMetres(base), base.sizeMetres, 'the base count must not be rescaled');
  // Four times the islands is twice the side: the same islands-per-square-km.
  const quadrupled = worldSizeMetres({ ...base, islandCount: base.baseIslandCount * 4 });
  assert.equal(quadrupled, base.sizeMetres * 2);
  const quartered = worldSizeMetres({ ...base, islandCount: base.baseIslandCount / 2 });
  assert.ok(quartered < base.sizeMetres && quartered > base.sizeMetres / 2);
});

test('a 32-island map still places every island', () => {
  const big = { ...rules.world, islandCount: 32 };
  for (let seed = 1; seed <= 5; seed++) {
    const generated = createIslands(seed, big, rules.rules.unitsPerMetre);
    assert.equal(generated.islands.length, 32, `seed ${seed} came up short`);
    assert.ok(generated.attempts < big.placementAttempts, `seed ${seed} exhausted its attempts`);
  }
});

test('a scaled map is internally consistent: state, worldgen and spawns agree', () => {
  const scaledRules = { ...rules, world: { ...rules.world, islandCount: 20 } };
  const state = createInitialState(7, scaledRules);
  const expected = worldSizeMetres(scaledRules.world) * scaledRules.rules.unitsPerMetre;
  assert.equal(state.params.sizeUnits, expected);
  assert.equal(state.islands.length, 20);
  for (const island of state.islands) {
    assert.ok(island.x > 0 && island.x < expected, 'island placed outside the scaled ocean');
    assert.ok(island.y > 0 && island.y < expected);
  }
  for (const carrier of state.carriers) {
    assert.ok(carrier.x > 0 && carrier.x < expected, 'carrier spawned outside the scaled ocean');
    assert.ok(worldHeightAt(state.islands, carrier.x, carrier.y) < -carrier.draught);
  }
});
