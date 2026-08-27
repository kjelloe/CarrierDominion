// test/fixtures/run_m0a.mjs - runs the M0-A script and returns the trace.
// Shared by the pinning test and the repin tool so the two can never diverge.

import { createGame, enqueueCommand, stepGame } from '../../engine/game.js';
import { loadRules } from '../../server/rules.js';
import { M0A_SEED, M0A_TICKS, commandsForTick } from './m0a_script.mjs';
import { behaviorHash } from '../../shared/statehash.js';

function runM0A() {
  const rules = loadRules();
  const game = createGame(M0A_SEED, rules);
  const steps = [];
  for (let tick = 1; tick <= M0A_TICKS; tick++) {
    for (const command of commandsForTick(tick)) enqueueCommand(game, command);
    const snapshot = stepGame(game);
    const codes = [];
    for (const event of game.state.events) codes.push(event.code);
    // Two hashes per tick, on purpose. `hash` is the whole state including
    // the ruleset stamp - what a LAN peer must match. `behaviour` drops the
    // stamp, so the repin tool can tell "somebody added a knob to a JSON
    // file" apart from "the war unfolds differently now" without anybody
    // hand-rolling the comparison. (It was hand-rolled twice before this
    // line existed, both times by someone who had forgotten behaviorHash was
    // already written and tested.)
    steps.push({
      tick: snapshot.tick,
      hash: snapshot.stateHash,
      behaviour: behaviorHash(game.state),
      events: codes,
    });
  }
  return { seed: M0A_SEED, ticks: M0A_TICKS, rulesHash: game.state.rulesHash, steps: steps };
}

export { runM0A };
