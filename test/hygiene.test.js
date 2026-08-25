// Source hygiene: the small things that are individually trivial and
// collectively the fossil record of half-landed refactors.
//
// Written after the 2026-08-26 review, which found ten imported names that
// nothing used any more - most of them left behind when the AI stopped
// calling `launchUnit` directly and started riding the deck cycle. None of
// them was a bug. All of them were a lie about what the file does.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const FOLDERS = ['engine', 'shared', 'server', 'client', 'client/panels', 'client/render'];

function sources() {
  const out = [];
  for (const folder of FOLDERS) {
    for (const name of readdirSync(join(ROOT, folder))) {
      if (!name.endsWith('.js')) continue;
      out.push({
        path: `${folder}/${name}`,
        text: readFileSync(join(ROOT, folder, name), 'utf8'),
      });
    }
  }
  return out;
}

test('nothing imports a name it never uses', () => {
  const dead = [];
  for (const file of sources()) {
    // The body is the file with its own import statements removed, so an
    // import does not count as a use of itself.
    const body = file.text.replace(/^import[\s\S]*?from\s+'[^']*';\s*$/gm, '');
    for (const statement of file.text.matchAll(/import\s*\{([^}]*)\}\s*from/g)) {
      for (const raw of statement[1].split(',')) {
        const name = raw.trim().split(/\s+as\s+/).pop().trim();
        if (name === '') continue;
        const used = body.match(new RegExp(`\\b${name}\\b`, 'g'));
        if (used === null) dead.push(`${file.path}: ${name}`);
      }
    }
  }
  assert.deepEqual(dead, [], `imported and never used:\n  ${dead.join('\n  ')}`);
});

test('no source file has a merge marker or a stray debugger', () => {
  const bad = [];
  for (const file of sources()) {
    if (/^<{7}|^={7}$|^>{7}/m.test(file.text)) bad.push(`${file.path}: merge marker`);
    if (/\bdebugger\b/.test(file.text)) bad.push(`${file.path}: debugger`);
    // console.log below the client is a stray print, not a feature: the
    // server has its own writer and the engine must stay silent.
    if (file.path.startsWith('engine/') || file.path.startsWith('shared/')) {
      if (/\bconsole\.(log|warn|error)\s*\(/.test(file.text)) {
        bad.push(`${file.path}: console output from the portable half`);
      }
    }
  }
  assert.deepEqual(bad, [], bad.join('\n  '));
});
