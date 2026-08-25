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

// The BLANK ocean: no machine seats, no home islands, no map teeth, and no
// link topology - the world the scenario tests build on, where an island is
// owned the moment a test says so. The real game has all four; each has its
// own tests. (Topology off means every owned island is one hop from its
// depot, which is exactly the distance-free star we shipped before.)
function bareRules() {
  const rules = withoutAi(loadRules());
  rules.rules = { ...rules.rules, startShape: 1, neutralSiloRounds: 0 };
  rules.world = { ...rules.world, networkLinkMetres: 0 };
  return rules;
}

export { bareRules };
