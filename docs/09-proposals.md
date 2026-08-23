# 09 — Proposals: the Base island, the Hammerhead, and the defence drones

Design and spec only (owner directive 2026-08-24: "design and spec 3, 5, 6
so we can discuss them before implementing"). Three systems from the Amiga
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
