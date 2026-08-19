// The i18n gate. Catalogues drift the moment one of them is edited alone, so
// the test does three things no reviewer reliably does: compares key sets,
// compares the {placeholders} inside each string, and checks that every key
// the client actually asks for exists.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { LANGS, DEFAULT_LANG, pickLang, createTranslator, fill } from '../client/i18n.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const I18N_DIR = join(HERE, '..', 'data', 'i18n');
const CLIENT_DIR = join(HERE, '..', 'client');

function catalogFor(lang) {
  return JSON.parse(readFileSync(join(I18N_DIR, `${lang}.json`), 'utf8'));
}

function placeholdersIn(text) {
  return (String(text).match(/\{[a-zA-Z]+\}/g) ?? []).sort();
}

function clientSources(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...clientSources(path));
    else if (entry.name.endsWith('.js') && !path.includes('vendor')) out.push(path);
  }
  return out;
}

const catalogs = {};
for (const lang of LANGS) catalogs[lang] = catalogFor(lang);

test('every declared language has a catalogue on disk', () => {
  const files = readdirSync(I18N_DIR).filter((n) => n.endsWith('.json')).sort();
  assert.deepEqual(files, LANGS.map((l) => `${l}.json`).sort());
});

test('the catalogues have identical key sets', () => {
  const reference = Object.keys(catalogs[DEFAULT_LANG]).sort();
  for (const lang of LANGS) {
    const keys = Object.keys(catalogs[lang]).sort();
    const missing = reference.filter((k) => !keys.includes(k));
    const extra = keys.filter((k) => !reference.includes(k));
    assert.deepEqual(missing, [], `${lang}.json is missing keys`);
    assert.deepEqual(extra, [], `${lang}.json has keys ${DEFAULT_LANG}.json does not`);
  }
});

test('no translation is blank, and every value is a string', () => {
  for (const lang of LANGS) {
    for (const [key, value] of Object.entries(catalogs[lang])) {
      assert.equal(typeof value, 'string', `${lang}.${key} is not a string`);
      assert.notEqual(value.trim(), '', `${lang}.${key} is blank`);
    }
  }
});

test('a translated string keeps the placeholders of the original', () => {
  for (const key of Object.keys(catalogs[DEFAULT_LANG])) {
    const wanted = placeholdersIn(catalogs[DEFAULT_LANG][key]);
    for (const lang of LANGS) {
      assert.deepEqual(
        placeholdersIn(catalogs[lang][key]),
        wanted,
        `${lang}.${key} does not take the same placeholders as ${DEFAULT_LANG}.${key}`,
      );
    }
  }
});

test('every key the client asks for exists in every catalogue', () => {
  const used = new Set();
  for (const file of clientSources(CLIENT_DIR)) {
    const source = readFileSync(file, 'utf8');
    for (const match of source.matchAll(/\bt\(\s*'([a-zA-Z]+\.[a-zA-Z]+)'/g)) used.add(match[1]);
    for (const match of source.matchAll(/'((?:hud|unit|war|help|status|seat|transport|hangar|islands|gpu)\.[a-zA-Z]+)'/g)) {
      used.add(match[1]);
    }
  }
  assert.ok(used.size > 20, `only found ${used.size} keys in the client - has the scan broken?`);
  for (const lang of LANGS) {
    for (const key of used) {
      assert.notEqual(catalogs[lang][key], undefined, `${lang}.json is missing ${key}`);
    }
  }
});

test('the HUD row labels all have keys', () => {
  const rows = readFileSync(join(CLIENT_DIR, 'hud.js'), 'utf8');
  const block = rows.slice(rows.indexOf('HUD_ROWS = ['), rows.indexOf('];'));
  const names = [...block.matchAll(/'([a-z]+)'/g)].map((m) => m[1]);
  assert.ok(names.length > 10);
  for (const lang of LANGS) {
    for (const name of names) {
      assert.notEqual(catalogs[lang][`hud.${name}`], undefined, `${lang}.json lacks hud.${name}`);
    }
  }
});

test('language selection prefers the request, then the browser, then English', () => {
  assert.equal(pickLang('no', 'en-GB'), 'no');
  assert.equal(pickLang('klingon', 'nb-NO'), 'no', 'nb is Norwegian');
  assert.equal(pickLang(undefined, 'nn-NO'), 'no', 'nn is Norwegian');
  assert.equal(pickLang(undefined, 'no'), 'no');
  assert.equal(pickLang(undefined, 'de-DE'), 'en');
  assert.equal(pickLang(undefined, undefined), 'en');
});

test('a missing key falls back to English and then to itself', () => {
  const t = createTranslator({ 'a.b': 'norsk' }, { 'a.b': 'english', 'c.d': 'only english' });
  assert.equal(t('a.b'), 'norsk');
  assert.equal(t('c.d'), 'only english');
  assert.equal(t('e.f'), 'e.f', 'an unknown key should read as the key, not as blank');
});

test('placeholders are filled, and unknown ones are left alone', () => {
  assert.equal(fill('{a} of {b}', { a: 3, b: 8 }), '3 of 8');
  assert.equal(fill('{a} and {a}', { a: 'x' }), 'x and x');
  assert.equal(fill('{missing}', { other: 1 }), '{missing}');
  assert.equal(fill('nothing', undefined), 'nothing');
});

test('Norwegian is actually translated, not a copy of English', () => {
  let same = 0;
  let total = 0;
  for (const key of Object.keys(catalogs.en)) {
    if (key === 'lang' || key === 'langName') continue;
    total += 1;
    if (catalogs.en[key] === catalogs.no[key]) same += 1;
  }
  // Proper nouns and abbreviations legitimately match; most strings must not.
  assert.ok(same < total / 3, `${same} of ${total} Norwegian strings are identical to English`);
});
