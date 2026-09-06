# 09 — Proposals: the Base island, the Hammerhead, and the defence drones

**All three were ruled in and built on 2026-08-25** — see docs/06 for the
decisions and docs/02 for what the systems became. This document is kept as
written: it is the reasoning the rulings answered, and the open questions
here are the ones the answers settled.

Design and spec only when written (owner directive 2026-08-24: "design and
spec 3, 5, 6 so we can discuss them before implementing"). Three systems from the Amiga
manual, each specced against OUR engine's constraints, with the open
questions that need a ruling before a line of code is written.

---

## Proposal 3 — The Base island and network topology

### What the original had

You *started* on a developed home island: Command Centre, runway, defences,
producing at a quarter rate. The resource network was a **link graph rooted
at the Base**: geography decided which islands could link; an island cut
off from the Base stockpiled locally and stopped building/repairing;
**losing the Base froze the whole network**. The Stockpile island was a
separate, movable designation that required a live link to the Base.

### What we have

A star-to-stockpile abstraction: every island ships a share of its stock
toward the depot each accrual, distance-free and topology-free. No home
island in the Strategy start (the Action Game gives a developed estate by
ruling). It works, it is simple, and it loses two of the original's
strategic textures: **geography as supply terrain** (cuttable lines,
chokepoints worth holding) and **the Base as a jugular** (one island whose
loss is a catastrophe, and which both sides know it).

### Proposed design

Two independent pieces — they can be ruled separately:

**3a. The home island.** In the Strategy start, each team's nearest island
begins owned, role FACTORY with one plant, a runway, two turrets, a modest
stock, and the stockpile nomination — a small Action-start `developIsland`
call, per team, nothing else. Cost: ~1 slice. It changes the opening (no
more racing for the first pod; the race is for the SECOND island) and gives
the leash + runway systems a home anchor from tick zero.

**3b. Link topology.** Islands link when within `networkLinkMetres` (a new
world rule, ~12 km — geography by distance, the honest stand-in for the
original's "volcanic ridges"). The cargo network ships a share along the
LINK GRAPH toward the depot (breadth-first from each island, precomputed
per capture/loss, stored as each island's `networkNext` hop id — integer,
hashed, deterministic). An island with no path to the depot stockpiles and
its builds pause (the original's rule; ours would pause `stepBuild` and
`refine` for it). No Base-freeze initially: the DEPOT is the root, and
losing it already strands the network — one jugular is enough until played.
Cost: ~2 slices (graph + tests + quartermaster/BIRDSEYE link display), plus
AI awareness (capture toward connectivity) at ~1 more.

### Open questions for the ruling

1. Home island in Strategy: yes/no — it softens the opening; the current
   from-zero race is also a real (and tested) game.
2. Link topology: worth the complexity, or is distance-free shipping one of
   our good simplifications? (It has survived three playtests unremarked.)
3. If topology comes: root at the DEPOT (proposed) or a fixed BASE island
   with the original's freeze rule?
4. Display: links on the BIRDSEYE and the scope chart, or quartermaster
   only?

---

## Proposal 5 — The Hammerhead (SSM + Viewing Drone)

### What the original had

The carrier's offensive arm beyond the laser: launch a **Viewing Drone**
(slow aerial camera that drifts down and self-destructs), and while it is
up, aim **surface-to-surface missiles** by crosshair on its picture —
multiple launches per drone, limited stocks of both, factory-replenished.
Flew at carrier height: useless against aircraft, decisive against island
defences and shipping.

### Proposed design

- **Data**: `hammerhead` weapon (guided 0, surface-only, range ~8,000 m,
  damage ~laser×6, magazine from stores, `ordnancePerRound` steep) and
  `viewingDrone` as a carrier store item (`droneCount`, factory-buildable
  like flares/chassis — the network ships them).
- **Engine**: `launch_viewing_drone` (carrierId) spawns a DRONE entity —
  simplest honest shape: a new unit KIND with no orders, fixed slow climb
  then drift-down over ~90 s, then gone; it is a team SENSOR while up
  (contacts.js already takes any hull as a sensor, so the drone's eye is
  fog, not code). `fire_hammerhead` (carrierId, x, y) valid only while a
  drone is up and the mark is inside the drone's view radius; spawns an
  unguided fast surface shot at the mark (shots.js splash round).
- **Client**: a fourth camera mode while a drone is up — **DRONE**, the tab
  appearing only then: top-down from the drone, crosshair cursor, click =
  `fire_hammerhead`. This is the original's remote-view screen and the
  reason the feature is worth having: it FEELS like operating a weapon
  system.
- **AI**: none initially — a human toy first (the original's AI never used
  it well either). Ruling can add it later.
- **Cost**: ~2 slices (engine + tests; drone camera + probe).

### Open questions

1. Drone endurance and view radius: 90 s / 4 km proposed — the knobs that
   decide whether it is a siege tool or a snoop.
2. Should the drone be shootable (the original's could drift into flak)?
   Proposed: yes, PD and lasers can take it — it is a unit.
3. Magazine economics: how scarce? Proposed: 4 missiles + 2 drones aboard
   at start, factory-buildable after.
4. *(From the second source review, dev-questions §30.)* Period accounts
   describe the ENEMY carrier firing Hammerheads at the player — the
   missile-lock warning, decoys and evasive helm were the defensive game.
   If the Hammerhead is ruled in, does the AI get it too? (Our flares and
   PD already model the defence; an AI Hammerhead would give them a
   second customer.)

---

## Proposal 6 — Passive Defence Drones

### What the original had

Four inflatable decoys stationed around the carrier, individually
positionable, with a pattern library; they seduced heat-seekers and
low-level attacks, detonated on contact, cost the carrier top speed while
deployed, and were factory-replaceable.

### Proposed design

- **Data**: `decoyDrone` carrier store (4 aboard, 4 spare), station radius
  min/max, speed penalty permil (~250 — the original's "reduced top
  speed"), drone hp (small).
- **Engine**: drones as small surface units of a new kind, stationed at
  four fixed offsets around the ship (N/E/S/W of heading at ~600 m),
  following like the escort does. While ≥1 is deployed:
  `carrier.maxSpeed` scaled by the penalty (same mechanism as the speed
  refit, opposite sign). Seduction: a guided shot targeting the carrier
  re-homes onto the nearest deployed drone inside its seeker cone —
  exactly the flare rule, standing instead of momentary. Contact or hit
  detonates the drone (splash, hurts the attacker if close).
  `deploy_drones` / `dock_drones` commands (all four at once — the
  original's per-drone dragging and pattern library is menu-depth we
  ruled against everywhere else; the quartermaster-light precedent).
- **Client**: one action button (Y DRONES?) toggling deploy/dock, drones
  drawn as small bright floats; scope shows them as own contacts.
- **Cost**: ~2 slices.

### Open questions

1. Standing seduction vs the flare (momentary): does the drone make flares
   redundant? Proposed: flares break LOCKED shots instantly; drones only
   catch shots that pass NEAR them — complementary, but this is the
   balance question to discuss.
2. Fixed formation (proposed) vs the original's draggable patterns — is
   one button enough fidelity for you?
3. The speed penalty is the interesting cost (drones docked = fast ship,
   drones out = safe ship). 25% proposed. Feel-tunable.

---

## Suggested order, if all three are ruled in

5 (Hammerhead) first — self-contained, the most FELT feature; then 6
(drones) — small and mostly reuses escort/flare machinery; then 3b
(topology) last, because it re-teaches the AI and re-balances the economy,
and 3a (home island) can ride with it or land alone any time.

---

# Follow-ups worth planning next (2026-09-06)

Written after the first full battery matrix and the pre-deploy review. This is
the standing list: what is decided, what is waiting on a ruling, and what is
merely known. It is not a promise of order — the owner sets that — but nothing
here is forgotten.

## A. Waiting on a ruling (nothing moves until these are answered)

| # | Question | Recommendation |
|---|---|---|
| §39.1 | **The default config deadlocks 6% of wars** — both carriers at `fuel 0/0`, recoverable only with enough territory. Should running dry be recoverable, fatal, or left? | A fuel trickle from any owned island **plus** a long stop-loss so a truly dead war still ends |
| §39.2 | **The island victory condition never fires above 8 islands** (zero island wins in 80 wars at 16/32/64). Scale the threshold, add a points/time ending, or cap the offered map size? | Scale it (a margin rather than an absolute fraction), with the room's existing point/time caps as the escape hatch. Do not ship 64×16 while it has produced no ending in twenty attempts |
| §37.2 | A websocket **heartbeat**. There is none; `proxy_read_timeout 7d` covers the symptom, not a half-open socket | Build it, but after the playtest |
| §37.3 | The `solo` tag in `games.json` — new vocabulary in that index | Keep, or drop if it looks out of place |
| §38.1 | Is the **remote address** the right handle for a ban? One machine on a LAN; possibly a household behind one NAT | Leave it — the one-minute window bounds the cost |
| §38.2 | Should a kicked player be **told**, or silently dropped? | Told (built that way) |

## B. Decided, not yet done

- **The deploy itself** — `ops/DEPLOY.md` steps 3–8. DNS, the port row and the
  hostname are done; the pre-deploy script review is done. Do **not** deploy
  `gamesindex/games.json` until the game answers, or the index prober pushes a
  DOWN alert within ~11 minutes.
- **A mobile playtest** on a real device. Frame rate cannot be measured here at
  all — headless renders in software (ruling 2026-08-23).
- **PLAYTEST A5** — the one open *number* in docs/02: whether a 4 km
  action-start spawn is lethal to a human as it is to a stationary AI.

## C. Known and deliberately not built

Recorded so they are choices rather than oversights:

- The **2×2 quad camera view** (docs/10 gap 3) — a renderer question, not a
  console one.
- The **inset route map while piloting** (docs/10 gap 4) — the chart draws the
  course instead.
- **Sunbeams are screen-space**, so islands and the hull do not occlude them
  (docs/07) — a recorded trade against building a post-processing pass.
- The **Luau/Roblox twin** and the **true mobile Low tier** (docs/08) —
  planning only until this version passes playtesting.

## D. Worth measuring next on the batch PC

The matrix answered its question and raised sharper ones:

- **Re-run 8×2 with more seeds** once §39.1 is ruled on: 6% needs a few hundred
  wars to move confidently, and the sweep now records *which* watchdog finding
  fired (`findingKinds`), so the next run is diagnosable from the CSV alone.
- **Bisect the island count** between 8 and 16, where resolution falls from 94%
  to 80%. That is where a scaled victory threshold should be aimed.
- **The start ladder** (`start` 0–4) has never been swept. Every war measured
  so far starts at `start: 0`; a developed or late start may resolve where a
  cold one cannot, which would change what §39.2 is really about.
