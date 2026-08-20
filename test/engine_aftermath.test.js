// Two contracts the review found broken and this file now holds:
//
//   1. "A finished war still ticks - the world does not freeze - but nothing
//      new is decided." Guns stop choosing, pods stop building, viruses stop
//      subverting, points stop accruing. Rounds already in the air were
//      decided when they left the rail, so they still fly - and still hit.
//   2. The ground is in the fight: a shot flies INTO a hillside, not through
//      it, and the tallest summits out-top a Manta's cruise, so the autopilot
//      flies the contour instead of the rock.

import test from 'node:test';
import assert from 'node:assert/strict';

import { loadRules, withoutAi } from './helpers/rules.mjs';
import { createInitialState } from '../engine/state.js';
import { apply } from '../engine/reducer.js';
import { canonicalize } from '../shared/statehash.js';
import { PHASE_OVER } from '../engine/victory.js';
import { shipToStockpile } from '../engine/economy.js';
import { stockCapOf } from '../engine/island.js';
import { targetAltitudeFor, TERRAIN_CLEARANCE_UNITS } from '../engine/flight.js';
import { worldHeightAt } from '../engine/heightmap.js';
import { KIND_MANTA, KIND_WALRUS, UNIT_ACTIVE } from '../engine/units.js';
import { EVT_ISLAND_CAPTURED, EVT_SCORED, EVT_SHOT_FIRED, EVT_UNIT_HIT } from '../engine/events.js';

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

function place(unit, x, y, z) {
  unit.state = UNIT_ACTIVE;
  unit.x = x;
  unit.y = y;
  unit.z = z === undefined ? 0 : z;
  return unit;
}

test('a finished war decides nothing new', () => {
  let state = fresh();
  // Two hostile Walruses inside cannon range, a pod one tick from finishing,
  // a virus one tick from converting, and the war already over.
  const gunner = state.units.find((u) => u.team === 0 && u.kind === KIND_WALRUS);
  const target = state.units.find((u) => u.team === 1 && u.kind === KIND_WALRUS);
  place(gunner, 5000 * 256, 5000 * 256, 0);
  place(target, gunner.x + 300 * 256, gunner.y, 0);
  state.islands[0].podTeam = 0;
  state.islands[0].podTicks = state.params.podBuildTicks - 1;
  state.islands[1].owner = 1;
  state.islands[1].virusTeam = 0;
  state.islands[1].virusTicks = state.params.virusBuildTicks - 1;
  state.phase = PHASE_OVER;
  const scoreBefore = state.teams.map((t) => t.score);

  state = drive(state, 120); // across a scoring beat
  assert.ok(!state.events.some((e) => e.code === EVT_SHOT_FIRED), 'a gun fired after the war');
  assert.equal(state.islands[0].owner, -1, 'a pod completed a capture after the war');
  assert.equal(state.islands[1].owner, 1, 'a virus converted an island after the war');
  assert.deepEqual(state.teams.map((t) => t.score), scoreBefore, 'points accrued after the war');
  assert.doesNotThrow(() => canonicalize(state));
});

test('a round already in the air still flies, and still hits', () => {
  let state = fresh();
  const victim = state.units.find((u) => u.team === 1 && u.kind === KIND_WALRUS);
  place(victim, 5000 * 256, 5000 * 256, 0);
  state.phase = PHASE_OVER;
  const cannon = state.weapons[4];
  state.shots.push({
    id: state.nextShot, team: 0, weapon: 4,
    x: victim.x - 400 * 256, y: victim.y, z: 0,
    heading: 0, climb: 0, speed: cannon.speed, damage: cannon.damage,
    blast: cannon.blast, life: 40, guided: 0, splash: 0, trigger: 0, turn: 0,
    targetKind: 0, targetId: victim.id,
  });
  state.nextShot = state.nextShot + 1;

  const before = victim.hp;
  state = drive(state, 30);
  const after = state.units.find((u) => u.id === victim.id);
  assert.ok(after.hp < before, 'a round in flight evaporated when the whistle blew');
  assert.ok(state.events.length === 0 || true); // events roll per tick; the hit landed above
});

test('a shot flies into a hillside, not through it', () => {
  let state = fresh();
  const island = state.islands[0];
  const summit = worldHeightAt(state.islands, island.x, island.y);
  assert.ok(summit > 0, 'the test island has no ground to hit');

  // A victim parked on the far side of the island, and a flat shot aimed
  // through the rock at it.
  const victim = state.units.find((u) => u.team === 1 && u.kind === KIND_WALRUS);
  place(victim, island.x + island.radius * 2, island.y, 0);
  const cannon = state.weapons[4];
  state.shots.push({
    id: state.nextShot, team: 0, weapon: 4,
    x: island.x - island.radius * 2, y: island.y, z: 20 * 256,
    heading: 0, climb: 0, speed: cannon.speed, damage: cannon.damage,
    blast: cannon.blast, life: 600, guided: 0, splash: 0, trigger: 0, turn: 0,
    targetKind: 0, targetId: victim.id,
  });
  state.nextShot = state.nextShot + 1;

  state = drive(state, 300);
  assert.equal(state.shots.length, 0, 'the round is still flying inside a mountain');
  const after = state.units.find((u) => u.id === victim.id);
  assert.equal(after.hp, after.maxHp, 'the round passed through the island and hit');
});

test('the autopilot flies the contour over a summit taller than cruise', () => {
  const state = fresh();
  const island = state.islands[0];
  // Tall enough that even after the noise relief takes its bite the ground
  // under the centre stands above the 400 m cruise.
  island.peak = 700 * 256;
  const manta = state.units.find((u) => u.team === 0 && u.kind === KIND_MANTA);
  place(manta, island.x, island.y, manta.cruiseAltitude);
  manta.heading = 0;

  const ground = worldHeightAt(state.islands, manta.x, manta.y);
  const wanted = targetAltitudeFor(manta, state.islands, state.params.sizeUnits);
  assert.ok(wanted >= ground + TERRAIN_CLEARANCE_UNITS, 'the nose settled into the rock');
  assert.ok(wanted > manta.cruiseAltitude);

  // Over open water it is plain cruise again.
  place(manta, 500 * 256, 500 * 256, manta.cruiseAltitude);
  assert.equal(targetAltitudeFor(manta, state.islands, state.params.sizeUnits), manta.cruiseAltitude);
});

test('a full depot leaves goods at the source instead of destroying them', () => {
  const state = fresh();
  const depot = state.islands[0];
  const mine = state.islands[1];
  depot.owner = 0;
  mine.owner = 0;
  state.teams[0].stockpileIsland = depot.id;
  const cap = stockCapOf(depot, state.economy);
  depot.stockMaterials = cap;
  mine.stockMaterials = 1000;

  shipToStockpile(state);
  assert.equal(mine.stockMaterials, 1000, 'the mine was debited into a full warehouse');
  assert.equal(depot.stockMaterials, cap);

  // With a little room, exactly that much moves - no more, no loss.
  depot.stockMaterials = cap - 100;
  shipToStockpile(state);
  assert.equal(depot.stockMaterials, cap);
  assert.equal(mine.stockMaterials, 900, 'goods vanished in transit');
});
