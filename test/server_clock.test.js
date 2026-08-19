// The clock is the only thing in the project that reads wall time, so it is
// tested by driving `pump` with an explicit `now` rather than by sleeping.
// Nothing here is timing-sensitive and nothing here is flaky.

import test from 'node:test';
import assert from 'node:assert/strict';

import { CATCHUP_INTERVALS, createClock, pump, setClockSpeed } from '../server/clock.js';
import { SPEEDS, describeSpeed, isSpeed, stepSpeed } from '../shared/speeds.js';

const MS_PER_TICK = 50;

function counting(speed) {
  const seen = { ticks: 0 };
  const clock = createClock(MS_PER_TICK, () => { seen.ticks += 1; }, speed);
  clock.originMs = 0;
  return { clock: clock, seen: seen };
}

test('the speed ladder is the one both sides agree on', () => {
  assert.deepEqual(SPEEDS, [0, 1, 2, 4, 8, 16]);
  assert.equal(isSpeed(4), true);
  assert.equal(isSpeed(3), false);
  assert.equal(isSpeed(0), true, 'paused is a speed');
  assert.equal(describeSpeed(0), 'PAUSED');
  assert.equal(describeSpeed(8), 'x8');
});

test('stepping the ladder clamps at both ends', () => {
  assert.equal(stepSpeed(1, 1), 2);
  assert.equal(stepSpeed(1, -1), 0);
  assert.equal(stepSpeed(0, -1), 0, 'nothing slower than stopped');
  assert.equal(stepSpeed(16, 1), 16, 'nothing faster than the top rung');
  assert.equal(stepSpeed(99, 1), 1, 'an unknown speed falls back to normal');
});

test('at x1 one tick is issued per tick interval', () => {
  const { clock, seen } = counting(1);
  pump(clock, MS_PER_TICK);
  assert.equal(seen.ticks, 1);
  pump(clock, MS_PER_TICK * 3);
  assert.equal(seen.ticks, 3);
  pump(clock, MS_PER_TICK * 3 + 10);
  assert.equal(seen.ticks, 3, 'part of an interval is not a tick');
});

test('compression multiplies ticks per second, exactly', () => {
  for (const speed of [2, 4, 8, 16]) {
    const { clock, seen } = counting(speed);
    pump(clock, MS_PER_TICK); // one interval of wall time
    assert.equal(seen.ticks, speed, `x${speed} should issue ${speed} ticks per interval`);
  }
});

test('paused issues nothing, and unpausing owes nothing for the pause', () => {
  const { clock, seen } = counting(0);
  pump(clock, 10000);
  assert.equal(seen.ticks, 0);
  setClockSpeed(clock, 1);
  clock.originMs = 10000;
  pump(clock, 10000 + MS_PER_TICK);
  assert.equal(seen.ticks, 1, 'a pause must not bank ticks to catch up on');
});

test('a long stall is dropped rather than simulated', () => {
  const { clock, seen } = counting(1);
  pump(clock, 60 * 60 * 1000); // an hour asleep
  assert.equal(seen.ticks, CATCHUP_INTERVALS, 'the backlog must be abandoned, not run');
});

test('the catch-up cap scales with the speed', () => {
  const { clock, seen } = counting(8);
  pump(clock, 60 * 60 * 1000);
  assert.equal(seen.ticks, CATCHUP_INTERVALS * 8);
});

test('setClockSpeed refuses a speed off the ladder and rebases the origin', () => {
  const { clock } = counting(1);
  assert.equal(setClockSpeed(clock, 3), false);
  assert.equal(clock.speed, 1);
  assert.equal(setClockSpeed(clock, 8), true);
  assert.equal(clock.speed, 8);
  assert.equal(clock.ticksIssued, 0, 'the tick count must rebase with the origin');
});

test('a clock built with a nonsense speed falls back to normal', () => {
  assert.equal(createClock(MS_PER_TICK, () => {}, 7).speed, 1);
  assert.equal(createClock(MS_PER_TICK, () => {}).speed, 1);
});
