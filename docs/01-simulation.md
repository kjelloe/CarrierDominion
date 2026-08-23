# 01 — The simulation

`engine/` is one function with a very short signature and a very long list of
things it is not allowed to do:

```js
apply(state, command) -> state
```

Pure. The input state is never mutated. The same `(state, command)` pair always
returns the same next state, on any machine, in any browser, in any order of
execution. Nothing in `engine/` or `shared/` reads a clock, a file, a socket, or
`Math.random`.

## What that buys

A war is **a seed plus an ordered command log**. That is the whole recording
format: no snapshots, no deltas, no serialisation format to keep in step with
the code. It is also why LAN play needs no lockstep negotiation — the server
runs the reducer and ships filtered views, and a client that wants to check
itself compares one 16-character hash.

## Fixed point, and why there are no floats

`shared/fixed.js` holds the arithmetic. The conventions:

| Quantity | Representation |
|---|---|
| Position, length | int32, **256 units = 1 metre** |
| Altitude | same scale; 0 is the waterline, positive is up |
| Velocity | units per tick, 20 ticks = 1 second |
| Angle | 16-bit BAM: 0..65535, 0 = +X, growing counter-clockwise |
| Fractions | per-mil integers (`permil`), never a ratio |

Every division goes through a helper that normalises **negative zero** away.
`Math.floor(-0 / n)` produces `-0`, which survives arithmetic, compares equal to
`0` with `===`, and is distinguishable from `0` by `Object.is` and by some JSON
round-trips. One of those leaking into the state hash is a desync that only
appears on one machine.

Products are asserted to stay inside 2^53 so the same code runs unchanged on
Luau, whose numbers are also IEEE doubles.

## The Luau-portable subset

The engine is written so a Roblox twin stays mechanically portable
(`plan-version1.md` D3): no `class`, no `this`, no `Map`/`Set`, no exceptions,
no `async`, no `null` or `undefined` in state — **absence is `-1`** — plain
functions over plain objects and arrays, acyclic imports, and a module soft cap
of about 300 lines.

## The tick order is the contract

`advanceTick` in `engine/reducer.js`. The order is part of every hash, so it is
documented here as well as there:

```
stepAi          the AI decides first, so its orders take effect THIS tick
stepCarriers    hulls move
stepUnits       aircraft and vehicles move
stepFlares      launchers cool
stepWeapons     everything shoots from where it now is, and shots fly
stepCapture     ACCB pods build
stepVirus       virus bombs subvert
stepBuild       island construction advances
stepEconomy     production and the cargo network, every 100 ticks
stepSupply      the logistics boat works
stepRepair      the yard spends the ship's own materials
stepScore       island points accrue, every 100 ticks
checkVictory    is the war over
```

Two orderings that were chosen rather than fallen into:

- **Weapons after movement.** A shot is fired from the position the shooter
  reached this tick, and a hull that just closed to weapon range gets to use it.
- **Weapons before capture.** A Walrus killed on the beach cannot also plant its
  pod on the tick it died.

A finished war still ticks — the world does not freeze — but nothing new is
decided, and that clause is enforced: after `PHASE_OVER` no gun chooses a
target, no pod completes, no virus converts, no site finishes, no accrual lands
and no point scores. Hulls still move, boats still deliver, the yard still
mends, and a round already in the air still flies — it was decided when it left
the rail — and still hits.

## State shape

One plain object, all integers, no absent values. The top level:

| Key | What it is |
|---|---|
| `tick`, `seed`, `rng` | the clock and the PRNG state, both inside the state |
| `phase`, `winner`, `winReason` | how and whether the war ended |
| `rulesHash` | the ruleset this war was built from, hashed |
| `params` | the ruleset, flattened to integers in engine units |
| `weapons`, `loadouts` | weapon records by id, and which ids each hull carries |
| `economy` | production rates, build costs, network share |
| `teams` | id, stockpile island, score, the quartermaster's production bias |
| `carriers` | hulls, stores, sections, magazines, derived capability |
| `units` | Mantas, Walruses, lighters — every one exists from tick zero |
| `islands` | terrain seed, ownership, role, works, stock |
| `turrets` | island batteries |
| `shots` | rounds in the air, and mines waiting |
| `ai` | one brain per AI-held seat |
| `events` | what happened this tick, as integer codes |

`engine/state.js` owns construction and the deep copy. The rule that stops the
aliasing bug every sibling project has lost a day to: **a new entity kind is not
done until it has a line in both `createInitialState` and `copyState`.**

### Units exist from tick zero

Every airframe and vehicle is in `state.units` from the first tick, `STOWED`.
Launching is a state change, not a spawn. Ids are stable for a whole war, replays
and the fog filter get simpler, and a destroyed Manta is a distinguishable
record rather than a missing one — which is what lets a factory island rebuild
*that* Manta later.

### Stats are copied onto records

A unit carries its own max speed, turn rate, fuel burn and so on, copied from
the ruleset at build time. The per-tick code never reaches for the ruleset, and
the tunables end up inside the state hash automatically.

The exception is weapons: a Manta's missile stats are the same for every Manta,
so they live once in `state.weapons` and a hull carries only what differs —
which magazine has how many rounds, how long until the next shot, how hot.

## Hashing

`shared/statehash.js` canonicalises the **whole** state and hashes the string
with FNV-1a 64, in four 16-bit limbs so the arithmetic stays exact.

Chosen over Fireline's hand-maintained field list because a new field cannot be
forgotten by the hash, and because the canonical walk doubles as the hygiene
assertion: it throws on a float, a `null`, or a non-printable string, naming the
path to the offender.

`trajectoryHash()` (state minus events) and `behaviorHash()` (state minus the
ruleset stamp) exist for telling apart "the war changed" from "the bookkeeping
changed".

## Commands

`engine/commands.js` is the complete vocabulary. A command is a plain object
with a string `type` and integer fields only — no floats, no timestamps, no
references, because the command log is the replay. The log records commands
with the tick each applied on, and never the ticks between them: a replay
reconstructs the advances by ticking until the stamps match, so the log grows
with player activity, not with time.

Validation returns an empty string or a short reason; malformed commands are
dropped by the reducer rather than thrown on, because they arrive from a network
and a bad one must not stop the war.

`engine/authority.js` is the second gate: it says whether a *seat* may issue a
given command, which is what stops one player steering another's carrier.
`advance_tick` is server-owned and refused from a client outright.

## Randomness

One seeded xorshift32 in `shared/prng.js`, its state inside the game state.
Worldgen consumes it; the war does not. There is no other source of chance in
the engine — the AI, combat and the economy are all deterministic functions of
the state.
