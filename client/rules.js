// client/rules.js - the browser half of ruleset loading.
// Mirrors server/rules.js: same files, same object shape, same rulesHash.

const RULE_FILES = ['rules', 'world', 'units', 'economy', 'weapons'];

async function fetchRules(base = '/data') {
  const out = {};
  for (const name of RULE_FILES) {
    const response = await fetch(`${base}/${name}.json`);
    if (!response.ok) throw new Error(`cannot load ${name}.json: ${response.status}`);
    out[name] = await response.json();
  }
  return out;
}

export { fetchRules, RULE_FILES };
