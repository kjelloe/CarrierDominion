// Ruleset variants for tests.
//
// Most mechanics tests want a war where nothing moves except what the test
// moves. The default ruleset gives team 1 to the AI, which is right for the
// game and wrong for a test that uses the second carrier as a control group.

import { loadRules } from '../../server/rules.js';

function withoutAi(rules) {
  return { ...rules, rules: { ...rules.rules, aiTeams: [] } };
}

function bothAi(rules) {
  return { ...rules, rules: { ...rules.rules, aiTeams: [0, 1] } };
}

export { loadRules, withoutAi, bothAi };

// The DECK CYCLE, off. Launching is an operation that takes about five
// seconds of ticks (ruled 2026-08-25, engine/deck.js), which is right for
// the game and wrong for a test about pods or the leash: it would put a
// hundred ticks of drift between "launch" and the thing being measured.
// Scenario tests get the craft on the water at once; engine/deck.js has its
// own tests, and integration_capture plays the cycle for real.
function instantDeck(rules) {
  return {
    ...rules,
    rules: { ...rules.rules, deckRangeTicks: 0, launchTicks: 0, dockTicks: 0 },
  };
}

// The BLANK ocean: no machine seats, no home islands, no map teeth, no link
// topology and no deck choreography - the world the scenario tests build on,
// where an island is owned the moment a test says so. The real game has all
// five; each has its own tests. (Topology off means every owned island is
// one hop from its depot, which is exactly the distance-free star we shipped
// before.)
function bareRules() {
  const rules = instantDeck(withoutAi(loadRules()));
  rules.rules = { ...rules.rules, startShape: 1, neutralSiloRounds: 0 };
  rules.world = { ...rules.world, networkLinkMetres: 0 };
  return rules;
}

export { bareRules, instantDeck };
