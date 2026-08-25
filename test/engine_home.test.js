// The home island (proposal 3a, ruled 2026-08-25): the original's Base. The
// Strategy game starts each team on one developed island - a plant, a
// runway, two guns, a modest stock, the depot nomination, supply running -
// so the opening race is for the SECOND island, not the first pod.

import test from 'node:test';
import assert from 'node:assert/strict';

import { loadRules, withoutAi, bareRules } from './helpers/rules.mjs';
import { createInitialState } from '../engine/state.js';
import { apply } from '../engine/reducer.js';
import { canonicalize } from '../shared/statehash.js';
import { dist2D } from '../shared/fixed.js';
import { ROLE_FACTORY } from '../engine/island.js';

const SEED = 20260818;

test('each team starts on a developed base: plant, strip, guns, stock, depot', () => {
  const state = createInitialState(SEED, withoutAi(loadRules()));
  for (const team of state.teams) {
    const home = state.islands.find((island) => island.owner === team.id);
    assert.notEqual(home, undefined, `team ${team.id} has no home`);
    assert.equal(home.role, ROLE_FACTORY);
    assert.equal(home.factories, 1);
    assert.equal(home.runway, 1);
    assert.equal(home.turrets, 2);
    assert.ok(home.nodeHp > 0, 'a base without a command centre is a campsite');
    assert.ok(home.stockFuel > 0 && home.stockMaterials > 0);
    assert.equal(team.stockpileIsland, home.id);
    const carrier = state.carriers.find((c) => c.team === team.id);
    assert.equal(carrier.supplyRun, 1, 'the base supplies its ship from tick one');
    // The home is the NEAREST island - the base you anchor off, not a colony.
    for (const other of state.islands) {
      if (other.id === home.id) continue;
      assert.ok(
        dist2D(carrier.x, carrier.y, home.x, home.y)
          <= dist2D(carrier.x, carrier.y, other.x, other.y),
        `team ${team.id} home is not its nearest island`,
      );
    }
  }
  assert.doesNotThrow(() => canonicalize(state));
});

test('bare rules still give the blank ocean the engine tests build on', () => {
  const state = createInitialState(SEED, bareRules());
  assert.equal(state.islands.filter((island) => island.owner !== -1).length, 0);
});

test('the developed war is about a third each, and a third left neutral', () => {
  const rules = withoutAi(loadRules());
  rules.rules = { ...rules.rules, startShape: 2 };
  const state = createInitialState(SEED, rules);
  // One share in (teams + 1), rounded: three each on the eight-island sea,
  // two left neutral - and no extra home island on top (ruled 2026-08-25).
  for (const team of state.teams) {
    const held = state.islands.filter((island) => island.owner === team.id);
    assert.equal(held.length, 3, `team ${team.id} holds ${held.length}`);
  }
  assert.equal(state.islands.filter((island) => island.owner === -1).length, 2);
});

// A war decided by worldgen is not a war. Measured on a four-island sea:
// three seeds in four dropped a carrier inside the 3,500 m envelope of the
// enemy's brand-new home battery, and the ship was destroyed inside a minute
// without ever firing back.
test('no carrier starts under the enemy home battery', () => {
  for (const seed of [20260818, 900913, 777001, 31337, 424242]) {
    for (const islands of [4, 6, 8]) {
      for (const shape of [0, 2, 3, 4]) {
        const where = `seed ${seed}, ${islands} islands, shape ${shape}`;
        const rules = withoutAi(loadRules());
        rules.rules = { ...rules.rules, startShape: shape };
        rules.world = { ...rules.world, islandCount: islands };
        const state = createInitialState(seed, rules);
        // The reach the clearance rule is written against.
        let reach = 0;
        for (const turret of state.turrets) {
          for (const arm of turret.arms) {
            const weapon = state.weapons[arm.w];
            if (weapon !== undefined && weapon.range > reach) reach = weapon.range;
          }
        }
        for (const carrier of state.carriers) {
          assert.equal(carrier.grounded, 0, `${where}: carrier ${carrier.id} starts aground`);
          for (const turret of state.turrets) {
            if (turret.team === carrier.team) continue;
            const gap = dist2D(carrier.x, carrier.y, turret.x, turret.y);
            assert.ok(gap > reach,
              `${where}: carrier ${carrier.id} starts ${gap} from a hostile battery`);
          }
        }
      }
    }
  }
});

// --- The late war (ruled 2026-08-25): for testing an endgame by hand ---

function lateState(islands) {
  const rules = withoutAi(loadRules());
  rules.rules = { ...rules.rules, startShape: 3 };
  if (islands !== undefined) rules.world = { ...rules.world, islandCount: islands };
  return createInitialState(SEED, rules);
}

test('a late war hands out the archipelago, built and refitted', () => {
  const state = lateState();
  // "The whole archipelago held" means exactly that: an even division leaves
  // nothing neutral, and only an odd remainder may sit out.
  const neutral = state.islands.filter((island) => island.owner === -1);
  assert.ok(neutral.length < state.teams.length,
    `${neutral.length} islands left unclaimed in a LATE war`);

  for (const team of state.teams) {
    const held = state.islands.filter((island) => island.owner === team.id);
    assert.ok(held.length >= 3, `team ${team.id} holds only ${held.length}`);
    // Every island is somebody's concern: a role, a command centre, works.
    for (const island of held) {
      assert.ok(island.role >= 0, `island ${island.id} has no role`);
      assert.ok(island.nodeHp > 0, `island ${island.id} has no command centre`);
      assert.ok(island.factories + island.warehouses + island.turrets > 0,
        `island ${island.id} is undeveloped`);
    }
    // A plant, a mine and a garrison - not a monoculture.
    const roles = held.map((island) => island.role);
    assert.ok(roles.includes(1) && roles.includes(0) && roles.includes(2),
      `team ${team.id} got ${roles.join(',')} - a late war should have all three`);
    assert.notEqual(team.stockpileIsland, -1, 'a late war with no depot');
  }

  // And the ship a long war would have left you.
  for (const carrier of state.carriers) {
    assert.equal(carrier.upSpeed, 1);
    assert.equal(carrier.upPd, 1);
    assert.equal(carrier.upRadar, 1);
    assert.equal(carrier.upComm, 1);
    assert.equal(carrier.maxSpeed, carrier.maxSpeedUpgraded, 'the engines were not fitted');
    assert.equal(carrier.radar, carrier.radarUpgraded, 'the mast was not fitted');
    assert.equal(carrier.fuel, carrier.fuelCapacity);
    assert.equal(carrier.hammerRounds, carrier.hammerMax);
    assert.equal(carrier.supplyRun, 1);
  }
  const podded = state.units.filter((u) => u.commPod === 1);
  assert.equal(podded.length, state.carriers.length, 'one comm pod per ship, no more');
  assert.doesNotThrow(() => canonicalize(state));
});

test('a late war never wins itself before the first tick', () => {
  // Two thirds of the islands ends an ordinary war, and an even split of
  // EVERYTHING is past that line before anyone moves. A late war answers by
  // raising the bar rather than by dealing fewer islands: everybody already
  // holds their third, so holding a third cannot be the win.
  for (const count of [4, 8, 16, 32]) {
    let state = lateState(count);
    const share = Math.floor(count / state.teams.length);
    const needed = Math.floor(count * state.params.victoryIslandPermil / 1000);
    assert.ok(needed > share,
      `a ${count}-island late war starts with ${share} of ${needed} needed`);
    assert.equal(state.phase, 0, `a ${count}-island late war started already over`);
    state = apply(state, { type: 'advance_tick' });
    assert.equal(state.phase, 0, `a ${count}-island late war ended on tick one`);
  }
});

// Nose to nose (ruled 2026-08-25): the late war, begun in each other's
// faces. Marching further in cannot get there - a late sea is wall to wall
// gun envelopes - so the fleet is gathered round one patch of open water.
test('nose to nose starts the fleet in contact, not across the map', () => {
  for (const seed of [20260818, 900913, 777001, 31337]) {
    for (const [islands, teams] of [[8, 2], [16, 2], [16, 4], [32, 4]]) {
      const where = `seed ${seed}, ${islands} islands, ${teams} teams`;
      const rules = withoutAi(loadRules());
      rules.rules = { ...rules.rules, startShape: 4, teamCount: teams };
      rules.world = { ...rules.world, islandCount: islands };
      const state = createInitialState(seed, rules);
      const metre = state.params.unitsPerMetre;

      let closest = Infinity;
      for (let a = 0; a < state.carriers.length; a++) {
        assert.equal(state.carriers[a].grounded, 0, `${where}: carrier ${a} aground`);
        for (let b = a + 1; b < state.carriers.length; b++) {
          const gap = dist2D(state.carriers[a].x, state.carriers[a].y,
            state.carriers[b].x, state.carriers[b].y);
          if (gap < closest) closest = gap;
        }
      }
      // Contact from the first tick: the nearest rival inside radar, and
      // never nearer than the sea room a hull is owed - 611 m was a knife
      // fight that killed a ship in ten seconds.
      assert.ok(closest >= 4000 * metre - metre,
        `${where}: closest pair only ${Math.round(closest / metre)} m apart`);
      assert.ok(closest <= state.carriers[0].radar,
        `${where}: closest pair ${Math.round(closest / metre)} m apart,`
        + ` outside the ${Math.round(state.carriers[0].radar / metre)} m scope`);

      // It is still a LATE war underneath: everything held and refitted.
      assert.equal(state.islands.filter((i) => i.owner === -1).length < teams, true,
        `${where}: neutral ground in a late war`);
      for (const carrier of state.carriers) {
        assert.equal(carrier.upSpeed, 1, `${where}: unrefitted ship`);
        assert.equal(carrier.hammerRounds, carrier.hammerMax);
      }
      assert.equal(state.params.victoryIslandPermil, 900, `${where}: the bar did not rise`);
      assert.doesNotThrow(() => canonicalize(state));
    }
  }
});

test('the raised bar belongs to the late war and nothing else', () => {
  const rules = withoutAi(loadRules());
  for (const shape of [0, 1, 2]) {
    rules.rules = { ...rules.rules, startShape: shape };
    const state = createInitialState(SEED, rules);
    assert.equal(state.params.victoryIslandPermil, loadRules().rules.victoryIslandPermil,
      `start shape ${shape} moved the island victory`);
  }
});
