// What the running server reads off disk, pinned - because the deploy is an
// ALLOWLIST and an allowlist is the one kind of list that fails by omission.
//
// `ops/ssh-deploy.sh` syncs exactly `client/ engine/ shared/ server/ data/`
// plus the two package files, and nothing else. That is deliberate: an exclude
// list fails OPEN, and a real deploy on this box once pushed ~28 MB of
// internal notes to a public host that way. The cost of an allowlist is the
// opposite failure - add a sixth runtime directory and the deploy silently
// ships a game that cannot start, or worse, starts and cannot find its data.
//
// The ops script is in a PRIVATE repo and a batch worker does not even have
// it, so this cannot read the allowlist and compare. What it can do is pin the
// thing the allowlist has to match: the set of top-level directories the
// server actually reads at runtime. Add one and this fails, naming the file
// that has to change.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// Everything ops/ssh-deploy.sh puts on the box, minus data/autosave.json.
const SHIPPED = ['client', 'engine', 'shared', 'server', 'data'];

test('the server serves only directories the deploy ships', () => {
  const source = readFileSync(join(ROOT, 'server', 'app.js'), 'utf8');
  // The static table is written as `{ prefix: '/x/', dir: join(ROOT, 'x') }`.
  const served = new Set();
  for (const match of source.matchAll(/dir:\s*join\(ROOT,\s*'([^']+)'\)/g)) {
    served.add(match[1]);
  }
  assert.ok(served.size > 0, 'no static directories found - has serveStatic been rewritten?');
  for (const dir of served) {
    assert.ok(SHIPPED.includes(dir),
      `server/app.js serves "${dir}/", which ops/ssh-deploy.sh does not ship.`
      + ' Add it to the rsync allowlist (and to SHIPPED here) or stop serving it.');
  }
});

test('the ruleset loader reads only from a directory the deploy ships', () => {
  const source = readFileSync(join(ROOT, 'server', 'rules.js'), 'utf8');
  for (const match of source.matchAll(/join\(HERE,\s*'\.\.',\s*'([^']+)'\)/g)) {
    assert.ok(SHIPPED.includes(match[1]),
      `server/rules.js reads "${match[1]}/", which ops/ssh-deploy.sh does not ship.`);
  }
});

test('the client imports only from directories the deploy ships', () => {
  // The browser fetches these by URL, so a client import of `../tools/x.js`
  // is a 404 on the box even though it resolves perfectly on the dev machine,
  // where the whole repo is present. That asymmetry is exactly what makes an
  // allowlist deploy worth a test.
  const files = ['main.js', 'transport.js', 'localsave.js', 'graphics.js', 'hud.js'];
  for (const name of files) {
    let source;
    try {
      source = readFileSync(join(ROOT, 'client', name), 'utf8');
    } catch (error) {
      continue; // a file that has been renamed is not this test's business
    }
    for (const match of source.matchAll(/from\s+'\.\.\/([a-z0-9_]+)\//g)) {
      assert.ok(SHIPPED.includes(match[1]),
        `client/${name} imports from "${match[1]}/", which the deploy does not ship`);
    }
  }
});

test('every shipped directory actually exists', () => {
  // A stale entry is the other half of the same problem: the allowlist would
  // name something that is not there, which rsync passes over in silence.
  // Reading a real file out of each is the only proof that matters.
  const proof = {
    client: 'main.js', engine: 'reducer.js', shared: 'view.js',
    server: 'app.js', data: 'rules.json',
  };
  for (const dir of SHIPPED) {
    const body = readFileSync(join(ROOT, dir, proof[dir]), 'utf8');
    assert.ok(body.length > 0, `${dir}/${proof[dir]} is empty`);
  }
});
