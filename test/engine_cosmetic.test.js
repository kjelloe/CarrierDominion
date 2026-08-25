// "Style is data; nothing cosmetic may touch the simulation - two players on
// different styles see the same state hash" (docs/06, standing constraints,
// from ruling #13).
//
// That has been a standing constraint since 2026-08-19 and, until now, one
// with nothing enforcing it. It is exactly the sort of rule that holds until
// somebody reaches for a rules field to carry a colour.

import test from 'node:test';
import assert from 'node:assert/strict';

import { loadRules } from '../server/rules.js';
import { createInitialState } from '../engine/state.js';
import { hashState } from '../engine/snapshot.js';
import { applyLobbyOptions } from '../shared/options.js';
import { applyChoices, defaultChoices, OPTIONS } from '../client/panels/start.js';

const SEED = 20260818;

test('the art style never reaches the ruleset, from either path', () => {
  // The start menu's own fold. It RETURNS the style rather than applying it,
  // and the ruleset it produces must be identical whichever look was chosen.
  const hashes = new Set();
  const styleRow = OPTIONS.find((option) => option.key === 'style');
  assert.notEqual(styleRow, undefined, 'the look row has gone - has this test?');
  for (const style of styleRow.values) {
    const rules = loadRules();
    const choices = { ...defaultChoices(), style: style };
    const spare = applyChoices(rules, choices);
    assert.equal(spare.style, style, 'the fold stopped handing the style back');
    hashes.add(hashState(createInitialState(SEED, rules)));
  }
  assert.equal(hashes.size, 1,
    'two looks produced two different wars - something cosmetic reached the rules');
});

test('the clock speed never reaches the ruleset either', () => {
  // Same argument, same fold: how fast the table agreed to run is not part
  // of the war the reducer plays.
  const hashes = new Set();
  for (const speed of [1, 2, 8]) {
    const rules = loadRules();
    const spare = applyChoices(rules, { ...defaultChoices(), speed: speed });
    assert.equal(spare.speed, speed);
    hashes.add(hashState(createInitialState(SEED, rules)));
  }
  assert.equal(hashes.size, 1, 'the clock speed changed the war');
});

test('the war-room fold is deaf to anything it does not own', () => {
  // applyLobby takes an options object off the wire. A key it has no rule
  // for must change nothing at all - not the world, and not the rules hash.
  const plain = applyLobbyOptions(loadRules(), { islands: 8, teams: 2 });
  const noisy = applyLobbyOptions(loadRules(), {
    islands: 8,
    teams: 2,
    style: 2,
    graphics: 'high',
    language: 'no',
    nonsense: 41,
  });
  assert.equal(
    hashState(createInitialState(SEED, noisy)),
    hashState(createInitialState(SEED, plain)),
    'a cosmetic or unknown option changed the war',
  );
});

test('every option the menu offers produces a war that can be hashed', () => {
  // A sweep rather than a sample: each row, each of its values, folded on
  // its own. A row that writes something the canonical walk rejects - a
  // float, a null, a string in a numeric field - fails here rather than in
  // somebody's first LAN game.
  for (const option of OPTIONS) {
    for (const value of option.values) {
      const rules = loadRules();
      const choices = { ...defaultChoices() };
      choices[option.key] = value;
      applyChoices(rules, choices);
      assert.doesNotThrow(
        () => hashState(createInitialState(SEED, rules)),
        `${option.key} = ${value} produced a war that will not hash`,
      );
    }
  }
});
