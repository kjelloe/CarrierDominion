# Carrier Dominion — documentation

What is actually built, as of 2026-08-25. These describe the code that exists;
they are not a plan. For the plan and the rulings behind it see
[`../plan-version1.md`](../plan-version1.md); for what changed and why, in
order, see [`../dev-log.md`](../dev-log.md).

| Document | What it covers |
|---|---|
| [01-simulation.md](01-simulation.md) | The engine contract: determinism, the tick order, state shape, hashing, commands |
| [02-systems.md](02-systems.md) | The war as built: combat, damage, islands, the economy, supply, capture |
| [03-multiplayer.md](03-multiplayer.md) | Transports, fog, the war room, seat grace, the clock vote |
| [04-client.md](04-client.md) | Renderer, instruments, panels, sound, art direction |
| [05-testing.md](05-testing.md) | The gate, the fixture, the probes, and the playtest watchdog |
| [06-rulings.md](06-rulings.md) | The design of record: every owner ruling, dated, in one place |
| [07-graphics.md](07-graphics.md) | The three graphics tiers: targets, the style×tier contract, and the High-tier roadmap |
| [08-ports-plan.md](08-ports-plan.md) | Planning only: the Luau/Roblox twin and the true mobile Low tier — what each needs, for after the human-first pass |
| [09-proposals.md](09-proposals.md) | The three proposals as they were specced for discussion — **all ruled in and built** on 2026-08-25; kept for the reasoning and the open questions their answers settled |
| [10-squadron.md](10-squadron.md) | The 1988 squadron interface: the gap analysis against 83 screenshots of the original, and the four rulings that closed it — outfitting by weight, the full deck cycle, waypoints, typed pods |

## The three rules everything else hangs off

1. **Determinism.** Same seed plus the same command log is the same war, on
   every machine. Integers everywhere in `engine/` and `shared/`; the PRNG state
   lives inside the game state; `Math.random`, `Date` and floats are banned
   below the client.
2. **The client never sees state.** Everything leaving the engine goes through
   `shared/view.js`, filtered per team — in solo play too, where there is nobody
   to cheat, so the two paths cannot drift apart.
3. **The hash is the tripwire.** `test/fixtures/m0a.json` pins the state hash
   after each of 300 scripted ticks. A change that moves the war says so, at the
   tick it moved.

## Where things live

```
engine/    the simulation. apply(state, command) -> state. Pure, integer-only,
           no I/O, no clock, no floats. Written in a Lua-portable JS subset.
shared/    fixed-point maths, PRNG, trig tables, state hashing, view filtering,
           the speed ladder. Used verbatim by both the browser and the server.
server/    http + ws + the tick clock, the war room, seat grace, the watchdog.
           The ONLY place that reads a wall clock.
client/    three.js renderer, instruments, panels, input, sound, transports.
           Floats live here and nowhere else.
data/      every tunable number, as JSON. Never a constant in engine code.
test/      node --test suite, the pinned fixture, headless drivers, smoke gate.
tools/     generators and the re-pin tool.
debugging/ probes that drive a real browser, and the screenshots they take.
```
