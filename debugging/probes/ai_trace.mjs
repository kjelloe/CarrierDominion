// Trace one AI brain over a long war: what it is doing and how fast.
import { loadRules } from '../../server/rules.js';
import { createInitialState } from '../../engine/state.js';
import { apply } from '../../engine/reducer.js';
import { islandsHeldBy } from '../../engine/victory.js';

const rules = loadRules();
let state = createInitialState(20260818, rules);
const MODE = ['SEEK', 'INVADE', 'WAIT'];
let last = '';
for (let i = 0; i < 400000; i++) {
  state = apply(state, { type: 'advance_tick' });
  const b = state.ai[0];
  const w = b.walrusId === -1 ? undefined : state.units.find((u) => u.id === b.walrusId);
  const line = `${MODE[b.mode]} island=${b.targetIsland} walrus=${b.walrusId}`
    + ` wstate=${w ? w.state : '-'} pod=${w ? w.pod : '-'} held=${islandsHeldBy(state, 1)}`;
  if (line !== last) {
    console.log(String(state.tick).padStart(7), line);
    last = line;
  }
  if (i % 50000 === 0 && i > 0) {
    const c = state.carriers[1];
    console.log(`  .. tick ${state.tick} carrier at ${(c.x/256)|0},${(c.y/256)|0} thr=${c.throttle} spd=${c.speed} fuel=${c.fuel} grounded=${c.grounded}`);
  }
}
console.log('final held', islandsHeldBy(state, 1), 'phase', state.phase);
