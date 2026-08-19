// test/fixtures/run_m0a.mjs - runs the M0-A script and returns the trace.
// Shared by the pinning test and the repin tool so the two can never diverge.

import { createGame, enqueueCommand, stepGame } from '../../engine/game.js';
import { loadRules } from '../../server/rules.js';
import { M0A_SEED, M0A_TICKS, commandsForTick } from './m0a_script.mjs';

function runM0A() {
  const rules = loadRules();
  const game = createGame(M0A_SEED, rules);
  const steps = [];
  for (let tick = 1; tick <= M0A_TICKS; tick++) {
    for (const command of commandsForTick(tick)) enqueueCommand(game, command);
    const snapshot = stepGame(game);
    const codes = [];
    for (const event of game.state.events) codes.push(event.code);
    steps.push({ tick: snapshot.tick, hash: snapshot.stateHash, events: codes });
  }
  return { seed: M0A_SEED, ticks: M0A_TICKS, rulesHash: game.state.rulesHash, steps: steps };
}

export { runM0A };
