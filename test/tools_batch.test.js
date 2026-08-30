// The battery lane's one piece of pure logic, and the one that must not fail
// quietly: `scrub`. The batch responses are TRACKED files in a repo built to
// be published, and the leak risk is not the data - it is the errors, because
// a node stack trace is full of absolute paths and usernames.
//
// Importing tools/batch.mjs must also not run the CLI. The sibling learned
// that the hard way: without the invoked-directly guard, importing the module
// hit the usage branch, called process.exit, and killed the test process after
// its first test - which looks like a suite that simply stopped caring.

import test from 'node:test';
import assert from 'node:assert/strict';

import { KINDS, scrub } from '../tools/batch.mjs';

test('importing the batch lane does not run its CLI', () => {
  // Reaching this line at all is the assertion: a process.exit in the module
  // body would have taken the runner down before the first check.
  assert.ok(typeof scrub === 'function');
  assert.deepEqual(Object.keys(KINDS).sort(), ['matrix', 'seeds']);
});

test('scrub takes the repo path out of an error', () => {
  const root = '/home/somebody/GIT/CarrierDominion';
  const raw = `Error: ENOENT, open '${root}/data/rules.json'`;
  const out = scrub(raw, root);
  assert.equal(out.includes(root), false, 'the repo path survived');
  assert.ok(out.includes('<repo>'), 'and nothing replaced it');
});

test('scrub takes a home directory out of an error, repo or not', () => {
  // The stack will also name paths OUTSIDE the repo - node internals, npm
  // caches, a temp dir under the user's home. Those carry the username too.
  const out = scrub("at Module._load (/home/kjelloe/.nvm/versions/node/lib/x.js:1:1)", '/nowhere');
  assert.equal(out.includes('kjelloe'), false, `the username survived: ${out}`);
  assert.ok(out.includes('~'), 'the path was not replaced at all');

  const mac = scrub('/Users/someone/Library/Caches/thing', '/nowhere');
  assert.equal(mac.includes('someone'), false, 'a macOS home leaked the username');
});

test('scrub is bounded, because an error is not a log file', () => {
  const out = scrub('x'.repeat(5000), '/nowhere');
  assert.ok(out.length <= 600, `scrub returned ${out.length} characters`);
});

test('scrub survives nothing at all', () => {
  // The failure paths call it on `r.stderr`, which is '' for a process that
  // died without saying anything - the exact case that matters most.
  assert.equal(scrub(''), '');
  assert.equal(scrub(undefined), '');
  assert.equal(scrub(null), '');
});

test('every job kind can describe itself and build its arguments', () => {
  // A kind that cannot describe itself prints `undefined` on the status board,
  // and a kind whose args are wrong runs the wrong war and says nothing.
  for (const [name, spec] of Object.entries(KINDS)) {
    const task = { count: 7, islands: 32, teams: 4 };
    assert.equal(typeof spec.describe(task), 'string', `${name} cannot describe itself`);
    assert.ok(spec.describe(task).length > 0, `${name} describes itself as nothing`);
    const args = spec.args(task);
    assert.ok(Array.isArray(args), `${name} did not return an argument list`);
    assert.equal(args.includes('--count'), true, `${name} does not pass a count`);
    assert.equal(args[args.indexOf('--count') + 1], '7', `${name} passed the wrong count`);
  }
  // And matrix must actually carry the cell, or every row is the default war
  // wearing a different filename.
  const m = KINDS.matrix.args({ count: 7, islands: 32, teams: 4 });
  assert.equal(m[m.indexOf('--islands') + 1], '32');
  assert.equal(m[m.indexOf('--teams') + 1], '4');
});
