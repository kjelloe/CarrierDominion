// test/headless/sim_m0.mjs - the Milestone 0 headless sim driver.
//
// Not a unit test: a probe you run when you want to know how the war behaves
// or how fast it runs. Prints the trajectory summary and a tick-rate figure.
// On WSL the tick rate is a correctness signal (it must be well above 20 Hz),
// never a performance number to quote.
//
//   node test/headless/sim_m0.mjs [ticks] [seed]

import { createGame, enqueueCommand, stepGame } from '../../engine/game.js';
import { loadRules } from '../../server/rules.js';
import { hashState } from '../../engine/snapshot.js';
import { dist2D } from '../../shared/fixed.js';
import { knotsFrom } from '../../client/hud.js';

const TICKS = Number(process.argv[2] ?? 6000);
const SEED = Number(process.argv[3] ?? 20260818);

const rules = loadRules();
const game = createGame(SEED, rules);
const start = game.state.carriers.map((c) => ({ x: c.x, y: c.y }));

enqueueCommand(game, { type: 'set_throttle', carrierId: 0, throttle: 100 });
enqueueCommand(game, { type: 'set_heading', carrierId: 0, heading: 8192 });
enqueueCommand(game, { type: 'set_throttle', carrierId: 1, throttle: 70 });
enqueueCommand(game, { type: 'set_heading', carrierId: 1, heading: 41000 });

const events = {};
const beganMs = Date.now();
for (let tick = 0; tick < TICKS; tick++) {
  stepGame(game);
  for (const event of game.state.events) {
    events[event.code] = (events[event.code] ?? 0) + 1;
  }
}
const elapsedMs = Math.max(1, Date.now() - beganMs);

const state = game.state;
const unitsPerMetre = state.params.unitsPerMetre;

process.stdout.write(`seed ${SEED}, ${TICKS} ticks in ${elapsedMs} ms `);
process.stdout.write(`(${Math.round((TICKS * 1000) / elapsedMs)} ticks/s, real time needs 20)\n`);
process.stdout.write(`state hash ${hashState(state)}  rules ${state.rulesHash}\n`);
process.stdout.write(`islands ${state.islands.length}\n`);

for (const carrier of state.carriers) {
  const travelledM = dist2D(start[carrier.id].x, start[carrier.id].y, carrier.x, carrier.y) / unitsPerMetre;
  process.stdout.write(
    `carrier ${carrier.id} team ${carrier.team}: `
    + `${Math.round(travelledM)} m travelled, `
    + `${knotsFrom(carrier.speed, unitsPerMetre, state.params.tickHz)} kn, `
    + `fuel ${Math.round((carrier.fuel * 100) / carrier.fuelCapacity)}%`
    + `${carrier.grounded === 1 ? ', AGROUND' : ''}\n`,
  );
}

const codes = Object.keys(events).sort();
process.stdout.write(`events: ${codes.length === 0 ? 'none' : codes.map((c) => `${c}x${events[c]}`).join(' ')}\n`);
