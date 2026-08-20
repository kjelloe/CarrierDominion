// The sound layer, without a browser: what is checked here is the decision to
// make a noise, not the noise. A fake audio context records what was asked for.

import test from 'node:test';
import assert from 'node:assert/strict';

import { VOICES, createSound, playEvents, playWarning, toggleMute } from '../client/sound.js';

// Enough of a WebAudio context to record every tone the module builds.
function fakeContext() {
  const played = [];
  return {
    played: played,
    currentTime: 0,
    createOscillator() {
      const osc = {
        type: '',
        frequency: { setValueAtTime() {}, exponentialRampToValueAtTime() {} },
        connect() {},
        start() { played.push(osc); },
        stop() {},
      };
      return osc;
    },
    createGain() {
      return {
        gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} },
        connect() {},
      };
    },
    destination: {},
  };
}

function awake() {
  const sound = createSound();
  sound.ctx = fakeContext();
  return sound;
}

test('a voice exists for the events worth hearing, and only for those', () => {
  // Firing, being hit, losing a hull, taking an island, and the end of the war.
  for (const code of [10, 17, 18, 21, 26, 27, 36]) {
    assert.notEqual(VOICES[code], undefined, `event ${code} has no voice`);
  }
  // Bookkeeping the player cannot act on stays silent.
  for (const code of [1, 2, 3, 4, 13, 29]) {
    assert.equal(VOICES[code], undefined, `event ${code} should be silent`);
  }
});

test('events become sound, and unknown events do not', () => {
  const sound = awake();
  playEvents(sound, [{ code: 17, a: 0, b: 0, c: 0 }, { code: 999, a: 0, b: 0, c: 0 }], 1000);
  assert.equal(sound.ctx.played.length, 1);
});

test('gunfire is throttled, because a hundred clicks a second is not sound', () => {
  const sound = awake();
  const volley = [];
  for (let i = 0; i < 20; i++) volley.push({ code: 26, a: i, b: 0, c: 0 });
  playEvents(sound, volley, 1000);
  assert.equal(sound.ctx.played.length, 1, 'every round in a volley was played');
  // A little later, one more gets through.
  playEvents(sound, volley, 1200);
  assert.equal(sound.ctx.played.length, 2);
});

test('muting stops everything, and unmuting brings it back', () => {
  const sound = awake();
  assert.equal(toggleMute(sound), true);
  playEvents(sound, [{ code: 21, a: 0, b: 0, c: 0 }], 1000);
  assert.equal(sound.ctx.played.length, 0);
  assert.equal(toggleMute(sound), false);
  playEvents(sound, [{ code: 21, a: 0, b: 0, c: 0 }], 2000);
  assert.equal(sound.ctx.played.length, 1);
});

test('a lock warning sounds while the missile is in the air, and not after', () => {
  const sound = awake();
  const locked = { shots: [{ warn: 1 }], events: [] };
  const clear = { shots: [{ warn: 0 }], events: [] };

  // Two tones, both scheduled at once on the audio clock.
  assert.equal(playWarning(sound, locked, 1000), true);
  assert.equal(sound.ctx.played.length, 2);
  // Still locked a moment later, but not yet time for the next pair.
  assert.equal(playWarning(sound, locked, 1100), true);
  assert.equal(sound.ctx.played.length, 2, 'the warning ran together into a drone');
  // Long enough after, it repeats.
  assert.equal(playWarning(sound, locked, 2000), true);
  assert.equal(sound.ctx.played.length, 4);

  assert.equal(playWarning(sound, clear, 4000), false, 'the warning outlived the missile');
});

test('nothing is played before the audio context exists', () => {
  const sound = createSound();
  assert.doesNotThrow(() => playEvents(sound, [{ code: 21, a: 0, b: 0, c: 0 }], 1000));
  assert.doesNotThrow(() => playWarning(sound, { shots: [{ warn: 1 }] }, 1000));
  assert.equal(sound.ctx, undefined);
});
