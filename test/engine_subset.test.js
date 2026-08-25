// The Luau-portable subset, enforced (docs/01, plan-version1.md D3).
//
// The engine is written so a Roblox twin stays mechanically portable: no
// class, no `this`, no Map or Set, no exceptions, no async, and no array
// METHODS - a Lua table has none of them. That has been a rule since the
// first day and, until now, a rule nobody checked. Two violations had to be
// found by eye: a `.filter` in engine/batcave.js on 2026-08-25, and eleven
// more on 2026-08-26 including a comparator sort in the AI and `.includes`
// in the reducer itself.
//
// This test reads the source. It is deliberately crude - strip the comments
// and strings, then look for shapes - because a crude check that runs on
// every commit beats a careful one that runs when somebody remembers.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

// shared/statehash.js canonicalises the state for hashing, and its two array
// calls are the deliberate port points: `Object.keys().sort()` is Lua's
// `table.sort` default order, and `join('')` is `table.concat`. Both are
// named in the file. Nothing else is exempt.
const ALLOWED = {
  'shared/statehash.js': ['sort', 'join'],
};

const THROWS_ON_PURPOSE = [
  'shared/statehash.js', 'shared/fixed.js', 'shared/prng.js',
];

const ARRAY_METHODS = [
  'map', 'filter', 'forEach', 'reduce', 'reduceRight', 'find', 'findIndex',
  'some', 'every', 'includes', 'sort', 'indexOf', 'lastIndexOf', 'slice',
  'concat', 'flat', 'flatMap', 'fill', 'reverse', 'shift', 'unshift', 'splice',
];

// Comments and string literals are prose, not code: a comment saying "this
// file" must not read as the keyword `this`.
function stripProse(source) {
  let out = '';
  let i = 0;
  while (i < source.length) {
    const two = source.slice(i, i + 2);
    if (two === '//') {
      while (i < source.length && source[i] !== '\n') i += 1;
      continue;
    }
    if (two === '/*') {
      i += 2;
      while (i < source.length && source.slice(i, i + 2) !== '*/') i += 1;
      i += 2;
      continue;
    }
    const ch = source[i];
    if (ch === "'" || ch === '"' || ch === '`') {
      const quote = ch;
      i += 1;
      while (i < source.length && source[i] !== quote) {
        if (source[i] === '\\') i += 1;
        i += 1;
      }
      i += 1;
      out += '""';
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
}

function sourcesUnder(folder) {
  const out = [];
  for (const name of readdirSync(join(ROOT, folder))) {
    if (!name.endsWith('.js')) continue;
    const path = `${folder}/${name}`;
    out.push({ path: path, code: stripProse(readFileSync(join(ROOT, path), 'utf8')) });
  }
  return out;
}

function portableSources() {
  return [...sourcesUnder('engine'), ...sourcesUnder('shared')];
}

test('the portable half uses no array methods a Lua table has not got', () => {
  for (const file of portableSources()) {
    const allowed = ALLOWED[file.path] ?? [];
    for (const method of ARRAY_METHODS) {
      if (allowed.includes(method)) continue;
      // `x.method(` where x is an identifier, a closing bracket or a paren -
      // which is what an array call looks like and what a bare word does not.
      const pattern = new RegExp(`[\\w\\]\\)]\\s*\\.${method}\\s*\\(`);
      const line = file.code.split('\n').findIndex((text) => pattern.test(text));
      assert.equal(line, -1,
        `${file.path}:${line + 1} uses .${method}() - the engine stays in the`
        + ' Luau-portable subset (docs/01). Write the loop out.');
    }
  }
});

test('the portable half has no class, no this, and no exceptions', () => {
  const shapes = [
    { name: 'class', pattern: /\bclass\s+\w/ },
    { name: 'this', pattern: /\bthis\b/ },
    { name: 'new Map', pattern: /new\s+Map\s*\(/ },
    { name: 'new Set', pattern: /new\s+Set\s*\(/ },
    { name: 'try/catch', pattern: /\btry\s*\{/ },
    { name: 'throw', pattern: /\bthrow\s+/ },
    { name: 'async', pattern: /\basync\b/ },
    { name: 'await', pattern: /\bawait\b/ },
  ];
  for (const file of portableSources()) {
    for (const shape of shapes) {
      // Three places throw ON PURPOSE, and all three are assertions about
      // the arithmetic rather than about the game: the hash canonicaliser
      // rejects a dirty state, shared/fixed.js rejects a product that has
      // left exact-integer range, and the PRNG rejects an empty range. A
      // hosted twin wants to report those too - they are programming errors,
      // not situations.
      if (shape.name === 'throw' && THROWS_ON_PURPOSE.includes(file.path)) continue;
      const line = file.code.split('\n').findIndex((text) => shape.pattern.test(text));
      assert.equal(line, -1,
        `${file.path}:${line + 1} uses ${shape.name} - the engine stays in the`
        + ' Luau-portable subset (docs/01).');
    }
  }
});

// docs/01 gives a soft cap of about 300 lines per module. Six are past it by
// half again or more (reducer 857, state 640, units 632, view 621,
// action_start 550, weapons 504) and splitting them is a slice of its own -
// queued for the owner rather than done in a review. What this test defends
// is the ceiling not moving further: no module may pass 900 lines, which is
// the point at which the Luau port stops being a transcription job.
test('no module in the portable half has run away entirely', () => {
  const RUNAWAY = 900;
  const over = [];
  for (const file of portableSources()) {
    const lines = readFileSync(join(ROOT, file.path), 'utf8').split('\n').length;
    if (lines > RUNAWAY) over.push(`${file.path} (${lines})`);
  }
  assert.deepEqual(over, [], `modules past ${RUNAWAY} lines: ${over.join(', ')}`);
});
