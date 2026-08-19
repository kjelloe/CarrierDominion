// test/fixtures/m0a_script.mjs - the M0-A pinned command script.
//
// This is Carrier Dominion's "1A": a fixed seed and a fixed list of commands at
// fixed ticks. m0a.json stores the resulting hash after every tick, so any
// change to the reducer, the trig table, worldgen, or the fixed-point helpers
// shows up as a diff at the exact tick it first bites.
//
// Changing this script invalidates the pin. Re-pin with `npm run repin`, and
// only after understanding WHY the trajectory moved.

const M0A_SEED = 20260818;
const M0A_TICKS = 300;

// tick -> commands enqueued before that tick is advanced.
const M0A_COMMANDS = [
  { tick: 1, command: { type: 'set_throttle', carrierId: 0, throttle: 100 } },
  { tick: 1, command: { type: 'set_throttle', carrierId: 1, throttle: 60 } },
  { tick: 20, command: { type: 'set_rudder', carrierId: 0, rudder: 1 } },
  { tick: 60, command: { type: 'set_rudder', carrierId: 0, rudder: 0 } },
  { tick: 60, command: { type: 'set_heading', carrierId: 1, heading: 16384 } },
  { tick: 120, command: { type: 'set_throttle', carrierId: 0, throttle: 40 } },
  { tick: 150, command: { type: 'set_heading', carrierId: 0, heading: 49152 } },
  { tick: 200, command: { type: 'set_rudder', carrierId: 1, rudder: -1 } },
  { tick: 240, command: { type: 'set_throttle', carrierId: 1, throttle: 0 } },
  { tick: 260, command: { type: 'set_throttle', carrierId: 0, throttle: 100 } },
];

function commandsForTick(tick) {
  const out = [];
  for (const entry of M0A_COMMANDS) {
    if (entry.tick === tick) out.push(entry.command);
  }
  return out;
}

export { M0A_SEED, M0A_TICKS, M0A_COMMANDS, commandsForTick };
