// shared/speeds.js - the time-compression ladder.
//
// Shared vocabulary rather than a server detail: the browser needs the same
// list to offer the same rungs, and the solo transport compresses time itself
// without a server in the loop at all.
//
// Compression never touches the simulation. A war at x16 runs the same ticks
// in the same order with the same hashes as a war at x1; only the wall clock
// delivering them differs. That is why it is safe to hand to a player.

const SPEEDS = [0, 1, 2, 4, 8, 16]; // 0 is paused

function isSpeed(multiplier) {
  // A scan, not Array.includes: shared/ is read by the engine's portable
  // half as well as by the client (docs/01).
  for (let i = 0; i < SPEEDS.length; i++) {
    if (SPEEDS[i] === multiplier) return true;
  }
  return false;
}

// The next rung up or down from where you are, clamped at both ends.
function stepSpeed(current, direction) {
  let index = -1;
  for (let i = 0; i < SPEEDS.length; i++) {
    if (SPEEDS[i] === current) index = i;
  }
  if (index === -1) return 1;
  const next = index + direction;
  if (next < 0) return SPEEDS[0];
  if (next >= SPEEDS.length) return SPEEDS[SPEEDS.length - 1];
  return SPEEDS[next];
}

function describeSpeed(multiplier) {
  return multiplier === 0 ? 'PAUSED' : `x${multiplier}`;
}

export { SPEEDS, isSpeed, stepSpeed, describeSpeed };
