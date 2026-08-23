// shared/names.js - island names, derived, never stored.
//
// The 1988 original named every island, and a name is what makes "enemy pod
// on TIMOR" mean something at a glance where "island 23" does not. Names are
// a pure function of the island's own seed and id, so every client and the
// server agree without a byte of state - the map does not change, and
// neither does what you call its places.
//
// Two small tables, 288 combinations. Collisions are possible on a big map
// and acceptable: the original reused flavours too, and the id keeps every
// derived name stable even when two islands share one.

const FIRST = [
  'ARBOR', 'BASK', 'CINDER', 'DELTA', 'EBB', 'FALLOW', 'GRANITE', 'HALE',
  'ISK', 'JETTY', 'KELP', 'LOAM', 'MIRE', 'NARROW', 'OMBER', 'PALE',
  'QUARL', 'REEF', 'SALT', 'THORN', 'UMBRA', 'VARDO', 'WRACK', 'YARROW',
];
const SECOND = [
  'HOLM', 'NESS', 'SKERRY', 'POINT', 'SOUND', 'KEY',
  'ROCK', 'HAVEN', 'WATCH', 'GATE', 'SPIT', 'CAY',
];

function islandName(island) {
  const seed = island.seed < 0 ? -island.seed : island.seed;
  const mixed = seed + island.id * 7;
  const first = FIRST[mixed % FIRST.length];
  const rest = (mixed - (mixed % FIRST.length)) / FIRST.length;
  const second = SECOND[rest % SECOND.length];
  return first + ' ' + second;
}

export { islandName };
