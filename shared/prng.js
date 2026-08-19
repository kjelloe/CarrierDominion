// shared/prng.js - deterministic PRNG. The state is an integer that lives
// inside the game state, so every roll is reproducible from the state alone.
// Never call Math.random() anywhere in engine/ or shared/.
//
// Luau port: `(x ^ (x << n)) >>> 0` becomes `bit32.bxor(x, bit32.lshift(x, n))`
// (bit32 already truncates to 32 bits, so the >>> 0 disappears).

// 0 is a fixed point of xorshift; fold any seed onto [1, 2^32).
function seedRng(seed) {
  const s = Math.floor(Math.abs(seed)) % 4294967296;
  return s === 0 ? 2463534242 : s;
}

function nextRng(rngState) {
  let x = rngState;
  x = (x ^ (x << 13)) >>> 0;
  x = (x ^ (x >>> 17)) >>> 0;
  x = (x ^ (x << 5)) >>> 0;
  return x;
}

// Integer in [0, maxExclusive). Caller stores rngState back into the state.
function rollRange(rngState, maxExclusive) {
  if (maxExclusive < 1) throw new RangeError(`rollRange needs a positive bound: ${maxExclusive}`);
  const next = nextRng(rngState);
  return { rngState: next, value: next % maxExclusive };
}

// Integer in [lo, hi], both inclusive.
function rollBetween(rngState, lo, hi) {
  if (hi < lo) throw new RangeError(`rollBetween bounds inverted: ${lo}..${hi}`);
  const rolled = rollRange(rngState, hi - lo + 1);
  return { rngState: rolled.rngState, value: lo + rolled.value };
}

// (a * b) mod 2^32 with every intermediate inside 2^53, so JS and Luau agree.
function mul32(a, b) {
  const aHi = Math.floor(a / 65536) % 65536;
  const aLo = a % 65536;
  return (((aHi * b) % 65536) * 65536 + aLo * b) % 4294967296;
}

// Independent stream from one root seed: used so that adding a subsystem that
// rolls does not shift every other subsystem's numbers.
function deriveSeed(rootSeed, streamIndex) {
  let v = (seedRng(rootSeed) + mul32(streamIndex % 4294967296, 2654435761)) % 4294967296;
  v = (v ^ (v >>> 16)) >>> 0;
  v = mul32(v, 2246822507);
  v = (v ^ (v >>> 13)) >>> 0;
  return seedRng(v);
}

export { seedRng, nextRng, rollRange, rollBetween, deriveSeed, mul32 };
