// The ruleset, checked against the two things that go stale about data:
// the numbers the docs quote, and keys nothing reads.
//
// Both were found by hand in the 2026-08-26 review. The numbers all agreed;
// the dead keys did not - `startFuel`, `startOrdnance` and `startMaterials`
// sat in data/rules.json looking live while the ship sailed with a brim-full
// bunker and hold. The owner ruled them out on 2026-08-26 and they are gone;
// what this file does is make sure the NEXT one gets noticed.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadRules } from '../server/rules.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

// Numbers the documents state outright. If one moves in the data, the doc
// that quotes it is wrong from that moment, and a reader trusts the doc.
const QUOTED = [
  ['telemetryFadeMetres', (r) => r.rules.telemetryFadeMetres, 20000, 'docs/02 the telemetry leash'],
  ['telemetryLossMetres', (r) => r.rules.telemetryLossMetres, 26000, 'docs/02 the telemetry leash'],
  ['neutralSiloRounds', (r) => r.rules.neutralSiloRounds, 6, 'docs/02 the islands have teeth'],
  ['commandCentreHp', (r) => r.rules.commandCentreHp, 400, 'docs/02 taking an island'],
  ['podMaterials', (r) => r.units.carrier.podMaterials, 80, 'docs/06 ruling on pod cost'],
  ['virusOrdnance', (r) => r.units.carrier.virusOrdnance, 120, 'docs/06 ruling on bomb cost'],
  ['victoryIslandPermil', (r) => r.rules.victoryIslandPermil, 667, 'docs/02 how a war ends'],
  ['networkLinkMetres', (r) => r.world.networkLinkMetres, 12000, 'docs/02 the link topology'],
  ['islandCountMax', (r) => r.world.islandCountMax, 64, 'docs/02 the table and the map'],
  ['manta payloadKg', (r) => r.units.manta.payloadKg, 750, 'docs/02 the payload budget'],
  ['walrus payloadKg', (r) => r.units.walrus.payloadKg, 2000, 'docs/02 the payload budget'],
  ['podKg', (r) => r.units.carrier.podKg, 400, 'docs/02 the payload budget'],
  ['virusKg', (r) => r.units.carrier.virusKg, 300, 'docs/02 the payload budget'],
  ['deckRangeTicks', (r) => r.rules.deckRangeTicks, 60, 'docs/02 the deck cycle'],
  ['launchTicks', (r) => r.rules.launchTicks, 40, 'docs/02 the deck cycle'],
  ['dockTicks', (r) => r.rules.dockTicks, 60, 'docs/02 the deck cycle'],
];

test('every number the documents quote is the number in the data', () => {
  const rules = loadRules();
  for (const [name, read, want, where] of QUOTED) {
    assert.equal(read(rules), want,
      `${name} is ${read(rules)} but ${where} says ${want} - move one or the other`);
  }
});

// Keys that are deliberately inert: they document an intent or a ceiling
// that the code does not consult. Each one is a decision, so each one is
// listed by hand rather than inferred.
const KNOWN_INERT = {
  'world.islandCountMax': 'the menu ladder is the real ceiling; this records it',
  'world.shorePlateauPermil': 'superseded by the coast warp, kept for the record',
  'world.islandKinds': 'the names behind the KIND_ constants, for readers',
};

// The dead-key check matches BARE key names against all the source, so it
// cannot tell `rules.startMaterials` from `units.carrier.startMaterials` -
// and that is exactly how a dead key hid for weeks: rules.startMaterials read
// as live because units.json has a live key of the same name. Any name that
// appears in more than one ruleset file has to be declared here with which
// file actually owns it, so the collision is a decision rather than an
// accident.
const SHARED_NAMES = {};

function everySource() {
  const out = [];
  const folders = ['engine', 'shared', 'server', 'client', 'client/panels',
    'client/render', 'tools'];
  for (const folder of folders) {
    for (const name of readdirSync(join(ROOT, folder))) {
      if (!name.endsWith('.js') && !name.endsWith('.mjs')) continue;
      out.push(readFileSync(join(ROOT, folder, name), 'utf8'));
    }
  }
  return out.join('\n');
}

test('no ruleset key is dead without being declared dead', () => {
  const code = everySource();
  const files = {
    rules: 'data/rules.json',
    world: 'data/world.json',
    economy: 'data/economy.json',
    units: 'data/units.json',
    weapons: 'data/weapons.json',
  };
  const surprises = [];
  for (const [label, path] of Object.entries(files)) {
    const walk = (node, prefix) => {
      for (const key of Object.keys(node)) {
        if (key === 'comment' || key === 'version') continue;
        const value = node[key];
        if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
          walk(value, `${prefix}${key}.`);
          continue;
        }
        if (code.includes(key)) continue;
        const full = `${label}.${key}`;
        if (KNOWN_INERT[full] !== undefined) continue;
        surprises.push(full);
      }
    };
    walk(JSON.parse(readFileSync(join(ROOT, path), 'utf8')), '');
  }
  assert.deepEqual(surprises, [],
    `ruleset keys nothing reads: ${surprises.join(', ')}.`
    + ' Wire them, delete them, or add them to KNOWN_INERT with the reason.');
});

test('no two ruleset files share a key name undeclared', () => {
  const files = {
    rules: 'data/rules.json',
    world: 'data/world.json',
    economy: 'data/economy.json',
    units: 'data/units.json',
    weapons: 'data/weapons.json',
  };
  const seen = {};
  for (const [label, path] of Object.entries(files)) {
    const walk = (node) => {
      for (const key of Object.keys(node)) {
        if (key === 'comment' || key === 'version') continue;
        const value = node[key];
        if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
          walk(value);
          continue;
        }
        if (seen[key] === undefined) seen[key] = [];
        if (!seen[key].includes(label)) seen[key].push(label);
      }
    };
    walk(JSON.parse(readFileSync(join(ROOT, path), 'utf8')));
  }
  const collisions = [];
  for (const key of Object.keys(seen)) {
    if (seen[key].length < 2) continue;
    if (SHARED_NAMES[key] !== undefined) continue;
    collisions.push(`${key} (${seen[key].join(', ')})`);
  }
  assert.deepEqual(collisions, [],
    `the same key name lives in two ruleset files: ${collisions.join('; ')}.`
    + ' The dead-key check matches bare names and cannot tell them apart, so'
    + ' one of them can die unnoticed. Rename one, or declare it in'
    + ' SHARED_NAMES with which file owns it.');
});

test('every key declared inert really is inert', () => {
  // The other direction: a key wired up later should lose its exemption,
  // otherwise the list rots into a lie about the code.
  const code = everySource();
  const stillRead = [];
  for (const full of Object.keys(KNOWN_INERT)) {
    const key = full.slice(full.indexOf('.') + 1);
    if (code.includes(key)) stillRead.push(full);
  }
  assert.deepEqual(stillRead, [],
    `these are declared inert but something reads them now: ${stillRead.join(', ')}`);
});
