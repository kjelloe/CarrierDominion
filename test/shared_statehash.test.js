import test from 'node:test';
import assert from 'node:assert/strict';

import { behaviorHash, canonicalize, fnv1a64, hashState } from '../shared/statehash.js';

test('key order does not change the canonical form', () => {
  const a = { tick: 1, seed: 2, teams: [{ id: 0, fuel: 5 }] };
  const b = { teams: [{ fuel: 5, id: 0 }], seed: 2, tick: 1 };
  assert.equal(canonicalize(a), canonicalize(b));
  assert.equal(hashState(a), hashState(b));
});

test('array order does change it', () => {
  assert.notEqual(canonicalize([1, 2]), canonicalize([2, 1]));
});

test('a float anywhere in state is rejected with its path', () => {
  assert.throws(
    () => canonicalize({ carriers: [{ id: 0, x: 1.5 }] }),
    /non-integer number at \$\.carriers\[0\]\.x/,
  );
});

test('null and undefined are rejected', () => {
  assert.throws(() => canonicalize({ a: null }), /forbidden value at \$\.a/);
  assert.throws(() => canonicalize({ a: undefined }), /forbidden value at \$\.a/);
});

test('non-printable and non-ASCII strings are rejected', () => {
  assert.throws(() => canonicalize({ name: 'stoørre' }), /non-printable-ASCII/);
  assert.throws(() => canonicalize({ name: 'line\nbreak' }), /non-printable-ASCII/);
  assert.doesNotThrow(() => canonicalize({ name: 'Manta-1 (ready)' }));
});

test('negative zero canonicalises as zero', () => {
  assert.equal(canonicalize({ v: -0 }), canonicalize({ v: 0 }));
});

test('the hash is 16 lowercase hex digits and is stable', () => {
  const h = hashState({ tick: 0, seed: 1 });
  assert.match(h, /^[0-9a-f]{16}$/);
  assert.equal(h, hashState({ seed: 1, tick: 0 }));
});

test('one changed integer moves the hash', () => {
  const a = hashState({ tick: 100, x: 1000 });
  const b = hashState({ tick: 100, x: 1001 });
  assert.notEqual(a, b);
});

test('FNV-1a 64 matches the published vectors', () => {
  assert.equal(fnv1a64(''), 'cbf29ce484222325');
  assert.equal(fnv1a64('a'), 'af63dc4c8601ec8c');
  assert.equal(fnv1a64('foobar'), '85944171f73967e8');
});

test('behaviorHash ignores only the ruleset stamp', () => {
  const a = { tick: 5, rulesHash: 'aaaaaaaaaaaaaaaa', x: 1 };
  const b = { tick: 5, rulesHash: 'bbbbbbbbbbbbbbbb', x: 1 };
  const c = { tick: 5, rulesHash: 'aaaaaaaaaaaaaaaa', x: 2 };
  assert.equal(behaviorHash(a), behaviorHash(b));
  assert.notEqual(hashState(a), hashState(b));
  assert.notEqual(behaviorHash(a), behaviorHash(c));
});
