# Carrier Dominion

Real-time strategic carrier warfare on a procedural archipelago: take an
aircraft carrier across an ocean, seize islands with the aircraft and vehicles
it carries, and out-build the enemy carrier doing the same. A re-imagining of
the 1988 classic, not a port.

Design of record: [`plan-version1.md`](plan-version1.md).

## Running it

```bash
./run.sh              # http://127.0.0.1:8135
./run.sh --lan        # also reachable from other machines on the LAN
PORT=9000 SEED=42 ./run.sh
```

| URL | What it does |
|---|---|
| `/?mode=solo` | the engine runs **in the browser tab** - no server simulation |
| `/?mode=lan` | the authoritative Node server simulates, the tab renders |
| `/?graphics=low\|medium\|high` | override the auto-detected graphics tier |
| `/?style=retro\|modern\|hybrid` | art direction (default `retro`) - cosmetic only, same war, same hash |
| `/healthz` | tick, state hash, seats, rss - for monitoring |

Controls:

| Key | |
|---|---|
| `W` `S` | throttle up / down (the carrier, or the unit you are flying) |
| `A` `D` | rudder |
| `X` | all stop |
| `1` `2` | launch a Manta / a Walrus |
| `N` | select the next unit that is out |
| `T` | take the controls of the selected unit (again to hand back) |
| `R` | recall the selected unit to the carrier |
| `P` | deploy the ACCB pod at the command node you are standing on |
| `F` | fire - down the nose when you are flying, at what is in range when you are not |
| `V` | next weapon: laser / cluster / napalm / missile, or cannon / mines |
| `L` `K` | supply run on or off / make the nearest island your depot |
| `Z` | the damage control board - click a section to set its repair priority |
| `C` | chase camera / strategic pull-back |
| `,` `.` | time compression down / up (`space` pauses; in LAN it takes a vote) |
| `G` | cycle the graphics tier |
| click sea | send the selected unit there |
| click enemy | attack it with the selected unit, or hand it to the ship's laser |
| click island | the island board: what it is for, and what to build on it |

## Testing

```bash
npm test        # node --test, no test framework, no browser
npm run smoke   # Playwright: the real client in a real Chromium
npm run gate    # both - what a slice must pass before it closes
npm run sim     # headless sim probe: trajectory + tick rate
npm run repin   # re-pin the M0-A fixture (refuses on event drift)
npm run trig    # regenerate the committed trig tables
```

## Shape of the code

```
engine/    the simulation. apply(state, command) -> state. Pure, integer-only,
           no I/O, no clock, no floats. Written in a Lua-portable JS subset.
shared/    fixed-point maths, PRNG, trig tables, state hashing, view filtering.
server/    http + ws + the tick clock. The ONLY place that reads a clock.
client/    three.js renderer, HUD, input, transports. Floats live here.
data/      every tunable number, as JSON. Never a constant in engine code.
test/      node --test suite, the pinned fixture, headless drivers, smoke gate.
tools/     generators and the re-pin tool.
```

Three rules hold the whole thing up:

1. **Determinism.** Same seed plus the same command log is the same war, on
   every machine. Integers everywhere in `engine/` and `shared/`; the PRNG state
   lives inside the game state; `Math.random`, `Date`, and floats are banned
   below the client.
2. **The client never sees state.** Everything that leaves the engine goes
   through `shared/view.js` and is filtered per team - in solo play too, where
   there is nobody to cheat, so the two paths cannot drift apart.
3. **The hash is the tripwire.** `test/fixtures/m0a.json` pins the state hash
   after each of 300 scripted ticks. If a change moves the war, the suite says
   at which tick.

## How you take an island

Steam to it. Launch a Walrus (`2`) and click a point ashore to send it. Drive it
to the command node — the mast on the hill — and press `P` within 60 m of it.
The ACCB pod builds over a minute; the ring around the node fills, then the mast
turns your colour. An enemy Walrus deploying its own pod while yours is still
building displaces it and starts again.

## The economy

Islands pay every 100 ticks, by kind: resource islands in fuel and materials,
factories in materials and ordnance, radar and airfield islands in nothing —
their value is sight and reach. Lie a carrier within 900 m of an island you own
and it refuels from the stores and repairs its hull. Rates are in
`data/economy.json`.

## Winning

Hold two thirds of the islands (5 of 8), or be the last carrier afloat. Team 1
is played by an AI that does the same thing you do — steams to the nearest
island it does not hold, puts a Walrus ashore, plants a pod — and it is
perfectly capable of winning the race. It runs inside the reducer on a 3-tick
cadence, so it is part of the deterministic war and every replay covers it.

Turn it off, or give it both seats, with `aiTeams` in `data/rules.json`.

## Status

Milestone 0 (engine scaffold) is complete. Milestone 1 has units and direct
control, islands and ACCB capture, an enemy carrier AI, the island economy, and
a win condition.
Not yet built: weapons, damage, buildable structures, real fog of war, and a
HUD that is more than a debug overlay. See [`dev-log.md`](dev-log.md), and
[`dev-questions.md`](dev-questions.md) for what needs an owner ruling.
