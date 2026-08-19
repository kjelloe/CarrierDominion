// shared/statehash.js - canonical serialization + FNV-1a 64 hash of a state.
//
// THE cross-language verification primitive: a Luau port must produce the same
// canonical string and therefore the same hash. The canonical form also
// ENFORCES state hygiene, which is why it is a string walk rather than a
// hand-written byte layout - a stray float or null fails loudly here instead of
// drifting silently at run 400.
//
// State value rules (enforced below):
// - numbers must be integers        (floats drift across languages)
// - null/undefined are forbidden    (JSON null becomes nil in Lua and vanishes)
// - strings must be printable ASCII (byte parity with Lua string.byte)
// - only plain objects, arrays, strings, integers, booleans

function canonical(value, out, path) {
  const kind = typeof value;
  if (kind === 'number') {
    if (!Number.isInteger(value)) throw new Error(`non-integer number at ${path}: ${value}`);
    out.push(String(value));
  } else if (kind === 'string') {
    for (let i = 0; i < value.length; i++) {
      const c = value.charCodeAt(i);
      if (c < 32 || c > 126) throw new Error(`non-printable-ASCII char at ${path}: "${value}"`);
    }
    out.push('"' + value + '"');
  } else if (kind === 'boolean') {
    out.push(value ? 'true' : 'false');
  } else if (Array.isArray(value)) {
    out.push('[');
    for (let i = 0; i < value.length; i++) {
      if (i > 0) out.push(',');
      canonical(value[i], out, `${path}[${i}]`);
    }
    out.push(']');
  } else if (kind === 'object' && value !== null) {
    const keys = Object.keys(value).sort(); // lexicographic = Lua table.sort default
    out.push('{');
    for (let i = 0; i < keys.length; i++) {
      if (i > 0) out.push(',');
      out.push('"' + keys[i] + '":');
      canonical(value[keys[i]], out, `${path}.${keys[i]}`);
    }
    out.push('}');
  } else {
    throw new Error(`forbidden value at ${path}: ${String(value)}`);
  }
}

function canonicalize(state) {
  const out = [];
  canonical(state, out, '$');
  return out.join('');
}

// FNV-1a 64: offset basis 0xcbf29ce484222325, prime 0x100000001b3.
// Held as four 16-bit limbs so every product stays exact in a double, which
// makes the arithmetic identical in JS and Luau (no BigInt, no int64).
const FNV_OFFSET_0 = 0x2325;
const FNV_OFFSET_1 = 0x8422;
const FNV_OFFSET_2 = 0x9ce4;
const FNV_OFFSET_3 = 0xcbf2;

function fnv1a64(text) {
  let h0 = FNV_OFFSET_0;
  let h1 = FNV_OFFSET_1;
  let h2 = FNV_OFFSET_2;
  let h3 = FNV_OFFSET_3;
  for (let i = 0; i < text.length; i++) {
    h0 = (h0 ^ text.charCodeAt(i)) >>> 0;
    // multiply by the prime; its only non-zero limbs are p0 = 0x01b3 and p2 = 0x0100
    const c0 = h0 * 0x01b3;
    let c1 = h1 * 0x01b3;
    let c2 = h2 * 0x01b3 + h0 * 0x0100;
    let c3 = h3 * 0x01b3 + h1 * 0x0100;
    h0 = c0 % 65536;
    c1 = c1 + Math.floor(c0 / 65536);
    h1 = c1 % 65536;
    c2 = c2 + Math.floor(c1 / 65536);
    h2 = c2 % 65536;
    c3 = c3 + Math.floor(c2 / 65536);
    h3 = c3 % 65536;
  }
  return hex4(h3) + hex4(h2) + hex4(h1) + hex4(h0);
}

function hex4(limb) {
  return limb.toString(16).padStart(4, '0');
}

function hashState(state) {
  return fnv1a64(canonicalize(state));
}

// The trajectory hash with the ruleset stamp removed. When a golden hash moves,
// compare this: unchanged means a data/*.json knob was added or renamed and
// behaviour is byte-identical (safe to re-pin); changed means real behaviour
// moved and needs a witness.
function behaviorHash(state) {
  if (state.rulesHash === undefined) return hashState(state);
  const copy = {};
  const keys = Object.keys(state);
  for (let i = 0; i < keys.length; i++) {
    if (keys[i] !== 'rulesHash') copy[keys[i]] = state[keys[i]];
  }
  return hashState(copy);
}

export { canonicalize, hashState, behaviorHash, fnv1a64 };
