// server/clock.js - the wall-clock tick source.
//
// The ONLY place in the project that reads a clock. The engine is driven by
// advance_tick commands and has no idea time exists; this module decides when
// to issue them. Drift is corrected against a fixed origin so 20 Hz stays 20 Hz
// over hours, and a stalled loop catches up in bounded steps rather than
// running a thousand ticks in one blocking burst.

const MAX_CATCHUP_TICKS = 5;

function createClock(msPerTick, onTick) {
  return {
    msPerTick: msPerTick,
    onTick: onTick,
    timer: 0,
    originMs: 0,
    ticksIssued: 0,
    running: false,
  };
}

function pump(clock) {
  const elapsed = Date.now() - clock.originMs;
  const due = Math.floor(elapsed / clock.msPerTick);
  let behind = due - clock.ticksIssued;
  if (behind > MAX_CATCHUP_TICKS) {
    // Give up on the backlog rather than freeze: a laptop that slept for an
    // hour must not try to simulate the hour.
    clock.ticksIssued = due - MAX_CATCHUP_TICKS;
    behind = MAX_CATCHUP_TICKS;
  }
  for (let i = 0; i < behind; i++) {
    clock.ticksIssued += 1;
    clock.onTick();
  }
}

function startClock(clock) {
  if (clock.running) return false;
  clock.running = true;
  clock.originMs = Date.now();
  clock.ticksIssued = 0;
  clock.timer = setInterval(() => pump(clock), clock.msPerTick);
  return true;
}

function stopClock(clock) {
  if (!clock.running) return false;
  clearInterval(clock.timer);
  clock.timer = 0;
  clock.running = false;
  return true;
}

export { createClock, startClock, stopClock, MAX_CATCHUP_TICKS };
