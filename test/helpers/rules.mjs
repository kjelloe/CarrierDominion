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

// A war with no machine seats AND no home islands: the blank ocean many
// engine tests build their scenarios on. The home island (ruled 2026-08-25)
// is the DEFAULT game; tests that hand-craft island ownership start bare.
function bareRules() {
  const rules = withoutAi(loadRules());
  rules.rules = { ...rules.rules, homeIslandStart: 0 };
  return rules;
}

export { bareRules };
