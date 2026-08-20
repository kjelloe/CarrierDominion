# Carrier Dominion — Plan, Version 1

*Written 2026-08-18. Maps the GDD onto the proven retrograde house
stack. Companion documents: the GDD
(`../retrogradegames/carrierdominion/carrier_dominion_GDD.md`), the
1988 interface reference
(`../retrogradegames/carrierdominion/sourcedata/carrier_command_video_notes.md`),
Fireline's tech-stack doc (`../firepower/techstack-and-development.md`),
and multiciv's stack overview (`../multiciv/game-stack-overview.md`).*

---

## 1. Ruled decisions (2026-08-18, project owner)

| # | Decision | Ruling |
|---|---|---|
| D1 | Tech stack | **House stack.** Plain JavaScript (ESM), no build step, no TypeScript, no framework. Zero runtime dependencies in `engine/` and `shared/`. Server = Node HTTP + `ws`. Client = vanilla ES modules + three.js via importmap (the one client dependency). Tests via `node --test`. The GDD's §17 stack table (Vite, TypeScript, cannon-es/Rapier) is **superseded**. |
| D2 | Determinism | **Fully deterministic engine**, including the Manta flight model and Walrus drive model. Integer fixed-point math only, seeded PRNG in state, no floats/clock/I-O in `engine/` or `shared/`. Same seed + same command log = same war, on every platform. |
| D3 | Luau portability | **Yes.** Engine written in the Lua-portable JS subset (multiciv rules): no `class`/`this`, no `Map`/`Set`, no exceptions, no async, no `null` in state, plain functions over plain objects/arrays, module soft-cap ~300 lines, acyclic imports, index math through named helpers. A Roblox twin stays mechanically portable. |
| D4 | Workflow | **Plan doc first** (this file), owner reviews and answers the question queue (§8); then coding starts in named slices with tests-first, Fireline-style. |

Q1–Q10 were answered 2026-08-18 (dev-prompts.md, prompt 2); the
resolutions are folded into the sections below and the queue in §8 is
marked resolved. Owner does all git; slices land on a **`dev_night`**
branch the owner provides.

Note on ESM vs the global CommonJS preference: the engine is shared
verbatim between browser and Node, so ESM is the "when needed" case —
same reasoning as both siblings.

---

## 2. Architecture

```
            data/*.json   (rulesets — every tunable number lives here, never in code)
                 │
   ┌─────────────┴──────────────┐
   │  engine/  (pure JS reducer │←— byte-shaped twin (future) —→ luau/
   │  apply(state, cmd) → state)│
   └─────────────┬──────────────┘
        shared/  (prng, trig tables, fixed-point helpers, statehash)
                 │
  ┌──────────┬───┴──────────┬───────────────┐
  browser    Node ws server  headless        (future: Roblox client)
  client     (server/)       sim drivers
  (client/)                  (test/, debugging/, tools/)
```

**Transports (Q1):** the client talks to the war through one transport
interface with two drivers — a **local driver** that runs the engine
in-browser for solo play (no server process at all), and a **ws
driver** for LAN/multiplayer against the Node server. Both feed the
client the same fog-filtered view objects; the view-filtering code is
shared (`shared/` or a pure module used by both drivers), so solo and
LAN render identically. Cheat-proofing only matters on the ws path,
which stays fully authoritative.

Directory layout (mirrors Fireline):

```
engine/      reducer + subsystems (one module per subsystem)
shared/      prng.js, fixed.js, trig.js, statehash.js, canonical.js
server/      HTTP static + ws, command pump, fog-filtered per-team views
client/      index.html, importmap, three.js renderer, HUD; pure tested
             "model" modules feeding a thin DOM/three layer
data/        rulesets: units.json, islands.json, weapons.json, economy.json
test/        node --test suite + headless sim drivers
tools/       sweeps, repin, asset bakes
debugging/   sim campaign scripts, one-off probes (kept forever)
specs/       design of record (rulings)
reports/     autonomy-loop morning reports
ops/         REAL hosting details + secrets — gitignored, local-only
dev-log.md   slice history
dev-prompts.md  owner decisions, verbatim — gitignored (sibling practice)
```

`.gitignore` (already in place, before any GitHub remote exists)
follows the sibling pattern: `ops/`, `dev-prompts.md` and other
user-local files, runtime output, regenerated artifacts.

### 2.1 Non-negotiables (inherited doctrine)

- Fog-filtered views everywhere; the client renderer never sees the
  full state. On the ws path the server is authoritative; on the solo
  local driver the same filtering module sits between engine and
  renderer. The enemy AI carrier is just another seat.
- Anything gameplay-relevant must be headlessly testable.
- No file/network I/O in `engine/` or `shared/`.
- Paired hash functions (engine + test copy) changed together;
  a pinned command fixture with intermediate hashes from Milestone 0.
- `copyState` deep-copies every nested mutable array on day one.
- Every tunable number in `data/*.json`, never in engine code.

### 2.2 Fixed-point conventions (proposed — see Q2)

3D extends Fireline's 2D conventions:

- **Position**: int32 per axis, **256 units = 1 world metre**. A 20 km
  map = 5.12M units — safe in int32, and products stay under 2^53 for
  the Luau twin (doubles). Multiplication discipline: no product of two
  raw positions; scale down through `fixed.js` helpers (`fmul`, `fdiv`,
  `idiv`).
- **Altitude**: same scale, `z >= 0`; ocean surface is z = 0 in engine
  state (rendered waves are client-side cosmetics).
- **Angles**: 16-bit binary angles (0..65535 = full circle). Heading,
  pitch, roll each one BAM value. `shared/trig.js` provides integer
  `sinB`/`cosB` from a generated, committed lookup table (scaled
  ±32768) — identical bytes in the Luau twin. `isqrt` for ranges.
- **Velocity**: units per tick. Tick = **50 ms (20 Hz)** per the GDD.
- **Flight model** (sim-lite): thrust/drag/turn-rate as data-driven
  integer coefficients per airframe; no stall, simplified fuel burn.
  Feel is tuned via `data/units.json` + debug sliders, never code edits.
- Rendering may use floats freely — the client interpolates engine
  states at 60 fps; floats never flow back into the engine. The only
  client→engine path is commands (input intents).

### 2.3 State sketch (illustrative, not final)

```
state = {
  tick, seed, prng,                  -- prng state lives IN state
  params,                            -- ruleset snapshot at game start
  teams: [{ id, resources: {fuel, materials, ordnance} }],
  carriers: [{ id, team, pos, heading, speed, hull, sections,
               hangar, weapons, upgrades }],
  units: [{ id, team, kind,          -- 'manta' | 'walrus'
            pos, vel, heading, pitch, hp, fuel,
            loadout, orders,         -- ai orders: patrol/escort/strike/...
            control }],              -- seat id when directly piloted
  islands: [{ id, kind, owner, heightmapRef, structures,
              commandNode, captureProgress }],
  projectiles: [...], events: [...],
  vision: { perTeam reveal bookkeeping for fog filtering }
}
```

Island heightmaps are generated deterministically from the seed at
game start (layered value noise through the seeded PRNG — integer
output) and referenced, not duplicated, in state; the client rebuilds
meshes from the same generator output.

**Scale budget (Q2):** every worldgen and per-tick cost is designed
against a **32-island map** even though the slice ships 8 — island
data lazily meshed client-side, per-tick systems iterating live
entities only (never all terrain), vision bookkeeping O(units), not
O(map). The int32 coordinate space (256 units/m) holds oceans far
larger than any planned map.

### 2.5 Client graphics presets (Q3)

Three tiers, multiciv-style: **Low** (mobile/iGPU: static-texture
ocean, no shadows, no post), **Medium** (default: shader ocean,
carrier+island shadows), **High** (discrete GPU, RTX-class/8 GB:
full ocean shader with reflections, higher shadow resolution,
bloom + optional scanline post pass). Tier resolved as in multiciv's
`client/diagnostics.js`: GPU-string auto-detect with a user override
persisted in settings. Presets are pure client concern — engine state
and hashes are identical across tiers.

### 2.4 GDD systems → engine modules

| GDD section | Module(s) |
|---|---|
| §5 archipelago generation | `engine/worldgen.js` (+ `engine/heightmap.js`) |
| §6 carrier | `engine/carrier.js` (movement, fuel, repair, upgrades) |
| §7 units | `engine/flight.js`, `engine/drive.js`, `engine/hangar.js` |
| §8 island capture/structures | `engine/islands.js`, `engine/capture.js` — **ACCB-pod mechanic (Q9)**: a Walrus carries a pod, deploys it at the command node, pod activates over N ticks → island captured. Virus bomb (soft capture of enemy centres, infrastructure preserved) is a preserved design goal, post-slice. |
| §9 resources/logistics | `engine/economy.js` |
| §10 combat | `engine/weapons.js`, `engine/projectiles.js`, `engine/damage.js` |
| §11 fog of war | `engine/vision.js` + `server/views.js` (filtering) |
| §12 enemy AI | `engine/ai_carrier.js` (FSM), `engine/ai_units.js`, `engine/ai_defense.js` |
| §14 HUD | client-side model modules (`client/models/*.js`) |

The AI carrier runs **inside the reducer** on a slower cadence (every
3rd tick, as the GDD's tick sketch suggests) so sims and replays cover
it — the AI is part of the deterministic war, exactly as Fireline's
AI regency is.

---

## 3. Milestone 0 — engine scaffold (slices)

Goal unchanged from GDD: a carrier drives across a procedural ocean
with one island visible. Each slice = tests first, suite green, dev-log
entry.

| Slice | Content |
|---|---|
| S0.1 | Repo scaffold: layout above, `package.json` (deps: `ws`; dev: `@playwright/test`), `node --test` wiring, importmap client stub, `/healthz`. |
| S0.2 | `shared/`: prng (xorshift32), fixed.js, trig tables + generator tool, canonical serialization, statehash. Cross-checked fixtures pinned. |
| S0.3 | Reducer skeleton: `apply(state, cmd)`, `copyState`, tick command, event list, paired hash functions, the pinned fixture (Carrier Dominion's "1A"). |
| S0.4 | Worldgen v0: seeded island placement (Poisson-disc via PRNG), one island heightmap, deterministic across runs — golden hash test. |
| S0.5 | Carrier entity + helm: speed/heading commands, fuel burn, movement integration in fixed point. Headless test drives it 1000 ticks. |
| S0.6 | Transports: the transport interface + **local driver** (engine in-browser, solo) AND the Node ws server (static + ws, command pump, snapshot broadcast) behind the same interface. Per-team view filtering as a shared pure module from day one (fog itself comes later, the *shape* is per-team now). |
| S0.7 | Client v0: three.js scene, ocean plane (float vertex shader, cosmetic), island mesh from engine heightmap, carrier box, follow camera + strategic pull-back, WASD → helm commands through the transport. Graphics preset skeleton (Low/Medium/High + GPU auto-detect) with at least ocean quality switched by it. |
| S0.8 | Gates: `client_smoke.mjs` (Playwright: page errors, join, ticks) + dev console overlay (fps, tick, hash, seed). |

**M0 deliverable:** browser shows the carrier moving on the ocean near
one procedural island, driven end-to-end through ws + reducer, with the
fixture, golden worldgen hash, and smoke gate green.

**Status 2026-08-19: S0.1–S0.8 all landed on `dev_night`.** 100 tests
green, smoke gate green, `run.sh` starts the game. Three deviations from
this plan (whole-state hashing instead of an explicit field list;
three.js r162 vendored rather than `^0.165`; no heightmap stored in
state at all) are recorded in `dev-log.md` and put to the owner in
`dev-questions.md`.

## 4. Milestone 1 — vertical slice (condensed; detailed plan after M0)

**Status 2026-08-20: Milestone 1 is complete on `dev_night`** — 351 tests
plus the smoke gate green, and an AI-vs-AI war that resolves end to end
(tick 229,498, won by sinking).

Landed since the 08-19 note, each as its own slice and commit: ordnance
logistics (#17), the Manta trigger rule (#18), seven geometric damage
sections with armour, repair priorities and replacement hulls (#19), the
1988 weapon sets, targeting at all three levels with laser overheat,
island roles and buildable works, defence turrets, the virus bomb, point
and time caps, the Walrus speed rise, the LAN speed vote, the start
menu, the bezelled instrument panel with a PPI scope and damage
schematic, the war room with chat, seat grace with AI takeover, sound,
decoy flares, and the playtest watchdog.

Carried into Milestone 2: fog of war with a **memory** — detection is
radar-range only by ruling, and there are no remembered contacts yet;
`ai_strike.js` is the module to audit when that changes. The Luau twin
(D3) remains unstarted by design; the engine is written to stay portable
to it, and nothing has been added that breaks the subset.

What is built, and why, is in [`docs/`](docs/00-index.md). What changed,
in order, is in `dev-log.md`.


GDD week themes become slice groups: units & direct control (chase
camera first, cockpit later — Q7) → island system & ACCB capture (Q9;
slice buildables: turrets + command node + resource extractor — Q8)
→ economy → enemy carrier FSM → HUD → fog & polish.
The sim campaign tooling (AI-vs-AI headless wars, 5-seed gate, sweep
battery) is built alongside the enemy AI group, not after — it is the
playtester. Target: winnable war on seed `RETROGRADE-001`, 8 islands,
2 Mantas + 2 Walruses, all five island types, win/lose screens.

## 5. Testing & tooling plan

- `node --test`, zero test-framework deps; suite runs double before any
  slice closes.
- Pinned command fixture with per-step hashes + repin tool that aborts
  on event drift (Fireline pattern, adopted verbatim).
- Headless sim drivers from M1 onward; 5-seed gate for slices, sweep
  batteries for balance. Mirror/factionswap fairness instruments once
  carrier-vs-carrier exists.
- Playwright smoke + UI acceptance for the client; WSL = correctness
  only, never perf numbers.
- i18n: key-identical `en`/`no` catalogs enforced by test from day one
  (Q5 — ruled cheap enough via the Fireline pattern).

## 6. Deviations from the GDD (recorded)

1. §17 stack table superseded (D1): no Vite, no TypeScript, no physics
   library — collision is engine arithmetic (sphere/capsule vs
   heightmap and bounding shapes), which a WASM physics lib could never
   keep deterministic-and-portable anyway.
2. §18.2's `requestAnimationFrame`-driven physics moves server-side:
   the authoritative 20 Hz loop runs in Node; the browser only renders
   and interpolates.
3. "Multiplayer-ready from day one" (§2.4) holds via the transport
   abstraction: solo runs the same engine + fog filtering in-browser
   (Q1), LAN runs it behind the authoritative ws server; Milestone 3
   is lobby/reconnect work, not an architecture change.
4. §8 capture sequence: the GDD's hold-60-seconds is replaced by the
   original's ACCB-pod deploy (Q9); the virus-bomb soft capture is a
   preserved design goal, post-slice.

## 7. Definition of done, M0

All S0.x merged; fixture + worldgen golden hashes pinned; smoke gate
green; `run.sh` starts the game at `http://localhost:<port>`; dev-log
current; no open red anywhere.

---

## 8. Questions queue — RESOLVED 2026-08-18 (dev-prompts.md prompt 2)

| # | Question (short) | Ruling |
|---|---|---|
| Q1 | Solo transport | Solo = engine in-browser (local driver); Node ws server for LAN/multi. One transport interface (§2, Transports). |
| Q2 | Fixed-point scale / map size | Scale accepted; design budgets for 32-island maps, slice starts at 8 (§2.3 scale budget). |
| Q3 | Graphics (answered as presets) | Low/Medium/High client presets, multiciv-style GPU auto-detect + override (§2.5). three.js version pin as proposed (`^0.165`, vendored) — no counter-ruling. |
| Q4 | Port/deploy | Unanswered → proposal stands: claim at first deploy per the dos-and-don'ts doc; `ops/README.md` carries the checklist. |
| Q5 | i18n | Both `en`/`no` from day one (cheap via key-identical catalogs). |
| Q6 | Git | Owner does all git; slices land on a `dev_night` branch the owner provides when ready. |
| Q7 | Camera | Chase first, cockpit later. |
| Q8 | Slice buildables | Turrets + command node + resource extractor only; more later. |
| Q9 | Capture mechanic | Original ACCB-pod deploy; virus-bomb soft capture preserved as a design goal, post-slice. |
| Q10 | Naming | "Carrier Dominion" / `CarrierDominion` confirmed. |

---

*Version 1 — rulings folded in. Next: slice S0.1 (repo scaffold) on the
`dev_night` branch once the owner has run `git init` and created it.*
