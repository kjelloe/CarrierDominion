// server/rules.js - the Node side of ruleset loading.
//
// The engine never reads a file, so the app layer loads data/*.json and hands
// the parsed object in. The browser does the same job with fetch
// (client/rules.js); both produce the identical object, which is why the
// rulesHash stamped into state matches across transports.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(HERE, '..', 'data');

const RULE_FILES = ['rules', 'world', 'units', 'economy', 'weapons'];

function loadRules(dataDir = DATA_DIR) {
  const out = {};
  for (const name of RULE_FILES) {
    const path = join(dataDir, `${name}.json`);
    out[name] = JSON.parse(readFileSync(path, 'utf8'));
  }
  return out;
}

export { loadRules, DATA_DIR, RULE_FILES };
