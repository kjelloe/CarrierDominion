// debugging/probes/war_trace.mjs
//
// Run an AI-vs-AI war and report what the two sides are actually doing every
// so often: hulls, islands, air groups, ammunition, kills. The question it
// exists to answer is why a war stops resolving.
//
//   node debugging/probes/war_trace.mjs [ticks]

import { createInitialState } from '../../engine/state.js';
import { apply } from '../../engine/reducer.js';
import { CMD_ADVANCE_TICK } from '../../engine/commands.js';
import { loadRules } from '../../server/rules.js';

const TICKS = Number(process.argv[2] ?? 400000);
const REPORT_EVERY = 20000;

const rules = loadRules();
rules.rules = { ...rules.rules, aiTeams: [0, 1] };

let state = createInitialState(20260818, rules);
const kills = [0, 0];
let fired = 0;

for (let tick = 0; tick < TICKS && state.phase === 0; tick++) {
  state = apply(state, { type: CMD_ADVANCE_TICK });
  for (const event of state.events) {
    if (event.code === 26) fired += 1;
    if (event.code === 10) kills[1 - event.b] += 1;
  }
  if (state.tick % REPORT_EVERY !== 0) continue;
  const held = [0, 1].map((t) => state.islands.filter((i) => i.owner === t).length);
  const air = [0, 1].map(
    (t) => state.units.filter((u) => u.team === t && (u.state === 1 || u.state === 2)).length,
  );
  const lost = [0, 1].map((t) => [0, 1, 2]
    .map((k) => state.units.filter((u) => u.team === t && u.kind === k && u.state === 3).length)
    .join('/'));
  const hull = state.carriers.map((c) => c.hull);
  const fuel = state.carriers.map((c) => Math.round((c.fuel * 100) / c.fuelCapacity));
  const ammo = state.carriers.map((c) => (c.arms[0] === undefined ? 0 : c.arms[0].n));
  const strike = state.ai.map((b) => b.strikeCarrier);
  const works = [0, 1].map((t) => {
    const own = state.islands.filter((i) => i.owner === t);
    return `${own.filter((i) => i.role === 0).length}R/${own.filter((i) => i.role === 1).length}F`
      + `/${own.filter((i) => i.role === 2).length}D:${own.reduce((n, i) => n + i.factories, 0)}f`;
  });
  process.stdout.write(
    `t=${state.tick} islands=${held} hull=${hull} fuel%=${fuel} air=${air} lost=${lost}`
    + ` ammo=${ammo} fired=${fired} kills=${kills} works=${works}\n`,
  );
}

process.stdout.write(
  `end tick=${state.tick} phase=${state.phase} winner=${state.winner} reason=${state.winReason}\n`,
);
