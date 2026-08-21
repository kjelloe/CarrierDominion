# Carrier Dominion

Real-time strategic carrier warfare on a procedural archipelago: take an
aircraft carrier across an ocean, seize islands with the aircraft and vehicles
it carries, and out-build the enemy carrier doing the same. A re-imagining of
the 1988 classic, not a port.

Design of record: [`plan-version1.md`](plan-version1.md). What is actually
built, in detail: [`docs/`](docs/00-index.md). Putting it on a box:
[`DEPLOYING.md`](DEPLOYING.md).

## Running it

```bash
./run.sh              # http://127.0.0.1:8135 - opens a war room with a join code
LOBBY=0 ./run.sh      # skip the room and sail on data/rules.json
WATCH=0 ./run.sh      # without the playtest watchdog (on by default)
./run.sh --lan        # also reachable from other machines on the LAN
PORT=9000 SEED=42 ./run.sh
RESUME=1 ./run.sh     # pick the saved war back up exactly where it stood
RESUME=auto ./run.sh  # resume if the save still replays, fresh war if not
SAVE=0 ./run.sh       # without the 30-second autosave (data/autosave.json)
```

| URL | What it does |
|---|---|
| `/?mode=solo` | the engine runs **in the browser tab** - no server simulation |
| `/?mode=lan` | the authoritative Node server simulates, the tab renders |
| `/` (no query) | the start menu: choose the war, then sail |
| `/?graphics=low\|medium\|high` | override the auto-detected graphics tier |
| `/?style=retro\|modern\|hybrid` | art direction (default `retro`) - cosmetic only, same war, same hash |
| `/healthz` | tick, state hash, seats, status, join code, rss - for monitoring |
| `/watch` | the playtest watchdog's findings, if it is running |

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
| `B` | virus bomb: take an enemy island whole, works and guns included |
| `F` | fire - down the nose when you are flying, at what is in range when you are not |
| `E` | decoy flares: break the lock on every seeker near the ship |
| `V` | next weapon: laser / cluster / napalm / missile, or cannon / mines |
| `L` `K` | supply run on or off / make the nearest island your depot |
| `Z` | the damage control board - click a section to set its repair priority |
| `C` | chase camera / strategic pull-back |
| `,` `.` | time compression down / up (`space` pauses; in LAN it takes a vote) |
| `G` | cycle the graphics tier |
| `[` `]` | scope range, 1 km to 32 km |
| `M` | sound on / off |
| `H` | hide this key list |
| click sea | send the selected unit there |
| click enemy | attack it with the selected unit, or hand it to the ship's laser |
| click island | the island board: what it is for, and what to build on it |

## Testing

```bash
npm test        # node --test, no test framework, no browser
npm run smoke   # Playwright: the real client in a real Chromium
npm run gate    # both - what a slice must pass before it closes
npm run sim     # headless sim probe: trajectory + tick rate
npm run battery # the sim across five seeds, under the watchdog
npm run repin   # re-pin the M0-A fixture (refuses on event drift)
npm run trig    # regenerate the committed trig tables
```

## Shape of the code

```
engine/    the simulation. apply(state, command) -> state. Pure, integer-only,
           no I/O, no clock, no floats. Written in a Lua-portable JS subset.
shared/    fixed-point maths, PRNG, trig tables, state hashing, view filtering.
server/    http + ws + the tick clock, the war room, seat grace, the watchdog.
           The ONLY place that reads a clock.
client/    three.js renderer, instruments, panels, input, sound, transports.
           Floats live here and nowhere else.
data/      every tunable number, as JSON. Never a constant in engine code.
test/      node --test suite, the pinned fixture, headless drivers, smoke gate.
tools/     generators and the re-pin tool.
debugging/ probes that drive a real browser, and the screenshots they take.
docs/      what is built, and why it is built that way.
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

A pod gives you the island **bare** — whatever the last owner built is cleared.
A virus bomb (`B`) takes twice as long and only works on an island somebody
holds, but you get it **intact**: factories, warehouses, stores, and the turrets
that were shooting at you.

## The economy

Nothing is conjured. Resource islands mine materials; factory islands convert
them into fuel, ordnance and replacement hulls; the cargo network ships a share
of every island's stock to your stockpile island; a lighter ferries it out to
the ship. Lose the island that was making your fuel and you lose the fuel it had
not shipped yet.

An island's **role** is your decision once you own it — Resource, Factory or
Defence — and worldgen's terrain is a bonus when the role suits the ground, not
the thing that decides output. Three factories eat 90 materials per accrual,
which is one good mine; a plant you cannot feed just sits there. Rates and costs
are in `data/economy.json`.

Repairs are part of the same chain: materials land in the ship's yard stores and
are spent at a fixed rate on the seven damage sections, in the priority you set
on the damage board (`Z`).

The chain reaches the flight deck too: recovery refuels from the ship's own
bunker, rearming draws the ordnance store, a replacement pod costs materials, a
virus bomb costs ordnance, and a rebuilt hull comes off the line empty and is
fitted out from stores. Nothing a unit takes aboard is conjured.

## Winning

Four ways, resolved in this order: nobody left afloat (a draw), last carrier
afloat, the point cap if the host set one, two thirds of the islands, and the
time cap if the host set one — highest score, level is a draw.

Team 1 is played by an AI that does everything you do: picks islands, puts a
Walrus ashore, decides what each island is for and what to build on it, flies
strikes, withdraws when it is badly hurt, and fires flares at incoming seekers.
It runs inside the reducer on a 3-tick cadence, so it is part of the
deterministic war and every replay and every headless sim covers it. It is
perfectly capable of winning.

Turn it off, or give it both seats, with `aiTeams` in `data/rules.json`.

## Status

Milestone 0 (engine scaffold) and Milestone 1 are complete: units and direct
control, the 1988 weapon sets, seven-section damage with armour and automatic
repair, replacement hulls, island roles and buildable works, defence turrets,
ACCB and virus capture, the full supply chain, three levels of targeting,
scoring and four end conditions, an instrument panel with a radar scope and a
damage schematic, LAN play with a war room, chat, seat grace with AI takeover, a
speed vote, sound, and a playtest watchdog.

A full pre-playtest review (2026-08-20) then hardened the build: guided rounds
chase the right entity, overheat cannot be cheated away, event fog routes
correctly, provisioning closed the last "conjured goods" holes, shots and
flight respect terrain, the post-war world decides nothing new, the cargo
network conserves goods, and spectators see a chart instead of one side's war.

Since then: **the chart remembers** — an enemy that leaves your radar leaves a
ghost on the scope, kept until you scan the spot and find it gone, and the AI
reads the same chart: break contact and expect one aircraft to come looking at
where you were. And the war ends on a proper **war-over screen** (result,
reason, the scoreboard the fog hid, RETURN TO PORT / KEEP WATCHING).

Not yet built: a richer observer mode, and the Luau/Roblox twin.

See [`docs/`](docs/00-index.md) for how it all works, [`dev-log.md`](dev-log.md)
for what changed and why, and `dev-questions.md` for what needs an owner ruling.
