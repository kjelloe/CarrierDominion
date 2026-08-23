// server/watch.js - the playtest watchdog.
//
// A playtest finds things a test suite cannot, but only if somebody notices
// them. This watches the state every tick for the shapes that mean "the
// simulation has gone somewhere it should not be", and records the FIRST
// occurrence of each with the tick it happened on - so a session ends with a
// short list of facts rather than a feeling that something was odd.
//
// It is deliberately outside the engine: it reads state and never writes it, so
// nothing here can change a war or move a hash. If a check ever needs to change
// the state to be correct, that is an engine bug and belongs in the engine.
//
// What it looks for, and why each one is worth an alarm:
//
//   off the map      a hull outside the world box means integration or
//                    pathfinding has run away
//   under the sea    a floating hull below the waterline, or an aircraft below
//                    the ground, means the height model and the movement model
//                    disagree
//   impossible value a negative store, hull over its maximum, ammunition above
//                    a magazine - the arithmetic somewhere is not clamped
//   stuck            the war running for a long time with nothing at all
//                    happening, which is the shape every deadlock so far has had
//   slow tick        the reducer taking longer than the tick it is simulating,
//                    which is the only way a LAN war falls behind

import { isqrt, mulDiv } from '../shared/fixed.js';
import { worldHeightAt } from '../engine/heightmap.js';
import { stockCapOf } from '../engine/island.js';

// Sixty thousand ticks is fifty minutes of game time at x1. It sounds enormous
// until you remember the pacing: one island takes about 37,000 ticks to take,
// and a carrier crossing the map takes 20,000, so a war can legitimately have
// nothing happen in it for a long while. At 20,000 this fired on every ordinary
// steaming leg, which is how a watchdog gets ignored.
const STUCK_TICKS = 60000;

function createWatch(options) {
  return {
    findings: [],
    seen: {},
    // The last tick on which anything at all changed hands, was built, or died.
    lastEventTick: 0,
    slowestMs: 0,
    ticks: 0,
    totalMs: 0,
    stuckAfter: options !== undefined && options.stuckAfter > 0
      ? options.stuckAfter
      : STUCK_TICKS,
    // An explicit stuckAfter is the caller's word; only the default scales
    // with the map (see watchTick's first-sight branch).
    stuckConfigured: options !== undefined && options.stuckAfter > 0 ? 1 : 0,
  };
}

// One finding per KIND, with the first tick it happened on and what it was.
// A playtest that trips the same bug four hundred times should report it once.
function note(watch, kind, tick, detail) {
  if (watch.seen[kind] !== undefined) {
    watch.seen[kind].count = watch.seen[kind].count + 1;
    return watch.seen[kind];
  }
  const finding = { kind: kind, tick: tick, detail: detail, count: 1 };
  watch.seen[kind] = finding;
  watch.findings.push(finding);
  return finding;
}

function offMap(state, x, y) {
  return x < 0 || y < 0 || x > state.params.sizeUnits || y > state.params.sizeUnits;
}

function checkCarriers(watch, state) {
  for (const carrier of state.carriers) {
    if (offMap(state, carrier.x, carrier.y)) {
      note(watch, 'carrier off the map', state.tick, `carrier ${carrier.id} at ${carrier.x},${carrier.y}`);
    }
    if (carrier.hull > carrier.maxHull) {
      note(watch, 'hull above maximum', state.tick, `carrier ${carrier.id} at ${carrier.hull}`);
    }
    if (carrier.fuel < 0 || carrier.ordnance < 0 || carrier.materials < 0) {
      note(watch, 'negative store', state.tick, `carrier ${carrier.id}`);
    }
    // A ship that has run aground is allowed to be over shallow water; one that
    // is over dry LAND is not.
    if (carrier.hull > 0 && worldHeightAt(state.islands, carrier.x, carrier.y) > 0) {
      note(watch, 'ship on dry land', state.tick, `carrier ${carrier.id}`);
    }
  }
}

function checkUnits(watch, state) {
  for (const unit of state.units) {
    if (unit.state === 0 || unit.state === 3) continue;
    if (offMap(state, unit.x, unit.y)) {
      note(watch, 'unit off the map', state.tick, `unit ${unit.id} at ${unit.x},${unit.y}`);
    }
    if (unit.z < 0) note(watch, 'unit below the sea', state.tick, `unit ${unit.id} at z ${unit.z}`);
    if (unit.hp > unit.maxHp) {
      note(watch, 'unit above full health', state.tick, `unit ${unit.id} at ${unit.hp}`);
    }
    if (unit.fuel < 0) note(watch, 'negative fuel', state.tick, `unit ${unit.id}`);
    for (const entry of unit.arms) {
      const weapon = state.weapons[entry.w];
      if (weapon !== undefined && entry.n > weapon.magazine) {
        note(watch, 'magazine overfull', state.tick, `unit ${unit.id} weapon ${entry.w}`);
      }
      if (entry.n < 0) note(watch, 'negative ammunition', state.tick, `unit ${unit.id}`);
    }
    // A Manta at sea level under way is either landing or wrong; a Walrus on a
    // mountain is always wrong.
    if (unit.kind === 1 && unit.z > 0) {
      const ground = worldHeightAt(state.islands, unit.x, unit.y);
      if (unit.z > ground + 256) {
        note(watch, 'vehicle above the ground', state.tick, `unit ${unit.id}`);
      }
    }
  }
}

function checkIslands(watch, state) {
  for (const island of state.islands) {
    if (island.stockFuel < 0 || island.stockMaterials < 0
      || island.stockOrdnance < 0 || island.stockChassis < 0) {
      note(watch, 'negative island stock', state.tick, `island ${island.id}`);
    }
    if (island.owner < -1 || island.owner >= state.teams.length) {
      note(watch, 'island owned by nobody real', state.tick, `island ${island.id} owner ${island.owner}`);
    }
    if (island.factories > 3 || island.turrets > 4 || island.warehouses > 2) {
      note(watch, 'more built than the slots allow', state.tick, `island ${island.id}`);
    }
    // Every path that adds stock respects the cap; a store above it means one
    // stopped. The cargo network destroyed goods for days against a full depot
    // and nothing tripped - this is the tripwire that was missing.
    const cap = stockCapOf(island, state.economy);
    if (island.stockFuel > cap || island.stockMaterials > cap
      || island.stockOrdnance > cap || island.stockChassis > cap) {
      note(watch, 'island stock above its cap', state.tick, `island ${island.id}`);
    }
  }
}

function checkShots(watch, state) {
  for (const shot of state.shots) {
    if (shot.life < 0) note(watch, 'shot outliving its range', state.tick, `shot ${shot.id}`);
    if (offMap(state, shot.x, shot.y) && shot.trigger === 1) {
      note(watch, 'mine off the map', state.tick, `shot ${shot.id}`);
    }
  }
  if (state.shots.length > 400) {
    note(watch, 'shots piling up', state.tick, `${state.shots.length} in the air`);
  }
}

// Anything at all that counts as the war moving. A war with none of these for
// a long time is stuck, which is the shape every deadlock so far has had.
const PROGRESS = [10, 17, 18, 21, 26, 31, 32, 34, 36];

function checkProgress(watch, state) {
  for (const event of state.events) {
    if (PROGRESS.includes(event.code)) watch.lastEventTick = state.tick;
  }
  if (state.phase !== 0) return;
  if (state.tick - watch.lastEventTick < watch.stuckAfter) return;
  note(watch, 'the war has stopped happening', state.tick,
    `nothing since tick ${watch.lastEventTick}`);
  // Re-arm, so a session reports every stall rather than only the first.
  watch.lastEventTick = state.tick;
}

// One tick's worth of watching. `elapsedMs` is how long the reducer took, which
// is the number that decides whether a LAN war can keep up with its own clock.
function watchTick(watch, state, elapsedMs) {
  // Baseline on first sight: a RESUMED war arrives at tick 200,000 and a
  // watchdog that assumes it was present from tick zero calls the first quiet
  // moment a 200,000-tick stall. Silence only counts from when watching began.
  if (watch.ticks === 0) {
    watch.lastEventTick = state.tick;
    // The stall window was tuned on the 8-island, 20 km map, where one
    // crossing is ~20k ticks. The ocean scales with sqrt(islandCount/8)
    // (engine/worldgen.js; 8 is data/world.json's baseIslandCount), so a
    // legitimate quiet leg does too - a 64-island crossing would trip the
    // unscaled alarm every time. isqrt of the Q16 ratio gives a Q8 scale.
    if (watch.stuckConfigured === 0 && state.islands.length > 8) {
      const scaleQ8 = isqrt(mulDiv(state.islands.length, 65536, 8));
      watch.stuckAfter = mulDiv(watch.stuckAfter, scaleQ8, 256);
    }
  }
  watch.ticks = watch.ticks + 1;
  watch.totalMs = watch.totalMs + elapsedMs;
  if (elapsedMs > watch.slowestMs) watch.slowestMs = elapsedMs;
  const budgetMs = state.params.tickHz > 0 ? 1000 / state.params.tickHz : 50;
  if (elapsedMs > budgetMs) {
    note(watch, 'tick slower than real time', state.tick, `${Math.round(elapsedMs)} ms`);
  }
  checkCarriers(watch, state);
  checkUnits(watch, state);
  checkIslands(watch, state);
  checkShots(watch, state);
  checkProgress(watch, state);
  return watch;
}

// What a session looks like from the outside: the findings, and the numbers
// that say whether the machine kept up.
function watchReport(watch) {
  return {
    ticks: watch.ticks,
    averageMs: watch.ticks === 0 ? 0 : Math.round((watch.totalMs / watch.ticks) * 1000) / 1000,
    slowestMs: Math.round(watch.slowestMs * 1000) / 1000,
    findings: watch.findings.map((f) => ({
      kind: f.kind,
      firstTick: f.tick,
      detail: f.detail,
      count: f.count,
    })),
  };
}

export { STUCK_TICKS, createWatch, note, watchTick, watchReport };
