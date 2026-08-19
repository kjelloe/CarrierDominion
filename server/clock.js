// server/clock.js - the wall-clock tick source.
//
// The ONLY place in the project that reads a clock. The engine is driven by
// advance_tick commands and has no idea time exists; this module decides when
// to issue them. Drift is corrected against a fixed origin so the rate holds
// over hours, and a stalled loop catches up in bounded steps rather than
// running a thousand ticks in one blocking burst.
//
// TIME COMPRESSION lives here and nowhere else. A war at x16 is the same war
// as at x1 - same ticks, same commands, same hashes - just delivered faster.
// Nothing in engine/ knows the difference, which is exactly why compression is
// safe to hand to the player.

import { SPEEDS, isSpeed, stepSpeed } from '../shared/speeds.js';

const CATCHUP_INTERVALS = 5; // how far behind the pump will ever try to make up

function createClock(msPerTick, onTick, speed = 1) {
  return {
    msPerTick: msPerTick,
    onTick: onTick,
    speed: isSpeed(speed) ? speed : 1,
    timer: 0,
    originMs: 0,
    ticksIssued: 0,
    running: false,
  };
}

function pump(clock, nowMs) {
  if (clock.speed === 0) {
    // Paused: hold the origin against the clock so unpausing does not
    // immediately owe a burst of ticks for the time spent stopped.
    clock.originMs = nowMs;
    clock.ticksIssued = 0;
    return 0;
  }
  const elapsed = nowMs - clock.originMs;
  const due = Math.floor((elapsed * clock.speed) / clock.msPerTick);
  const cap = CATCHUP_INTERVALS * clock.speed;
  let behind = due - clock.ticksIssued;
  if (behind > cap) {
    // Give up on the backlog rather than freeze: a laptop that slept for an
    // hour must not try to simulate the hour.
    clock.ticksIssued = due - cap;
    behind = cap;
  }
  for (let i = 0; i < behind; i++) {
    clock.ticksIssued += 1;
    clock.onTick();
  }
  return behind;
}

// Changing speed rebases the origin, so the new rate applies from now rather
// than retroactively to the whole run.
function setClockSpeed(clock, multiplier) {
  if (!isSpeed(multiplier)) return false;
  clock.speed = multiplier;
  clock.originMs = Date.now();
  clock.ticksIssued = 0;
  return true;
}

function startClock(clock) {
  if (clock.running) return false;
  clock.running = true;
  clock.originMs = Date.now();
  clock.ticksIssued = 0;
  clock.timer = setInterval(() => pump(clock, Date.now()), clock.msPerTick);
  return true;
}

function stopClock(clock) {
  if (!clock.running) return false;
  clearInterval(clock.timer);
  clock.timer = 0;
  clock.running = false;
  return true;
}

export {
  SPEEDS,
  CATCHUP_INTERVALS,
  isSpeed,
  stepSpeed,
  createClock,
  startClock,
  stopClock,
  setClockSpeed,
  pump,
};
