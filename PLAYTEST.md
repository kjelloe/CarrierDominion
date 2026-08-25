# Playtest script — 2026-08-25

Everything below changed since your round-four session. The **A steps** are
the ones I cannot judge for you and that would spoil the game if they are
wrong; **B** is confirmation that built things behave; **C** is polish and
can wait for a rainy evening.

Budget: **A is about 45 minutes**, B another 30, C as long as you like.

For each step: what to do, what I expect, and *what I need back from you* —
a sentence is plenty. "Fine" is a useful answer. So is "hated it".

```bash
./run.sh          # then http://127.0.0.1:8135
```

Keys you will need: `W/S` throttle (the ship goes astern below zero), `A/D`
rudder, `1/2/3` launch Manta / Walrus / Viewing Drone, `N` next hull,
`T` take the controls, `F` fire, `Y` decoy screen, `I` signals log,
`Q` quartermaster, `Z` damage board, `C` camera, `?` the legend.
The tab row above the horizon is HELM / WEAPON / BIRDSEYE / CHART, plus
DRONE while an eye is up.

---

## A1 — The opening now starts developed *(5 min)*

Start a solo war from the menu (leave the defaults; `the opening` should
read **a home island**).

1. Before touching anything, open the **CHART** tab.
2. Find your island — it is the one with your colour, a runway mark and the
   depot star.
3. Press `Q` and look at the stores.

**Expect:** you begin owning one developed island (plant, runway, two guns,
some stock) with the supply run already going, and a lighter already at sea.
The race is for your *second* island, not your first.

**Tell me:** does starting from a base feel better or worse than the old
from-zero opening? This is reversible — the war room and start menu both
have `the opening: from zero`.

---

## A2 — The leash, and the runway that answers it *(15 min — the big one)*

This is the deepest change: **your aircraft are drones on a link from the
ship.** Past 20 km the picture fades; past 26 km the aircraft is *gone*.

1. Launch a Manta (`1`), press `N` then `T` to fly it.
2. Fly directly away from the carrier and keep going.
3. Watch for the status line **"telemetry fading — the carrier is losing
   your picture, turn back"**.
4. Keep going anyway. It should self-destruct, and the signals log (`I`)
   should say so.
5. Now the answer: sail to an island you own, open its board (click it with
   nothing selected), and build a **runway** if it is a Resource or Defence
   island. When it finishes, select a Manta and **click that island** — that
   is an approach, not a board.
6. Watch it land, then check its fuel climbing on the panel. Give it any new
   order to relaunch.

**Expect:** the leash makes the carrier's position matter; runways let you
island-hop past it.

**Tell me:** (a) is 20/26 km the right leash — too tight, too loose? (b) Did
the fade warning arrive in time to react? (c) Did landing feel like landing,
or like teleporting? The comm-pod refit (quartermaster, `Q`) frees **one**
airframe from the leash entirely — try it if you have the materials.

---

## A3 — The Hammerhead and its eye *(10 min)*

The carrier's heavy arm. It is **blind without a drone up**.

1. With an enemy island or ship a few km away, press `3` (or the EYE button)
   to send up a Viewing Drone.
2. A **DRONE** tab appears on the tab row. Click it.
3. You are looking straight down from the aerostat, north up, with a
   crosshair. The console reads `HAMMERHEAD 4 · EYE 119s`.
4. **Click on something.** That is the trigger.
5. Fire two or three, then watch the console: the rail reloads slowly from
   your ordnance store; the eye drifts down and dies after ~2 minutes.

**Expect:** a siege weapon — deliberate, expensive, decisive against
emplacements, useless against aircraft.

**Tell me:** is the drone's two minutes enough to be useful? Are four rounds
too few or about right? Does clicking the picture *feel* like operating a
weapon system, or like a map click?

---

## A4 — The islands bite back *(10 min)*

Every neutral island now keeps a six-round missile silo, and any **Defence**
island scrambles interceptors.

1. Pick a neutral island on the CHART — armed ones wear a small warning spur.
2. Open its board: it should say **"a neutral missile silo — it will fire on
   anyone"**.
3. Send a Walrus at it (`2`, `N`, click the island) and watch what happens.
4. Try again after softening it: strafe the silo with a Manta first, or put
   a Hammerhead on it.

**Expect:** taking a free island now costs *something*, and suppressing
first is a real tactic rather than a flourish.

**Tell me:** is six rounds about right, or does it make the early game a
chore? This is one number (`neutralSiloRounds`) and I can change it in a
minute.

---

## A5 — The decoy screen and its price *(5 min)*

1. Press `Y`. Four decoys ride out around the ship, and the SCREEN button
   lights.
2. Open the throttle to full and watch your speed — you are capped at **75%**
   while they are out.
3. Get into a missile fight and watch whether seekers take the bait.
4. Press `Y` again to dock them and feel the speed come back.

**Expect:** a real trade — safety for speed — that you choose per situation.

**Tell me:** is 25% the right price? Do the decoys visibly earn it?

---

## B1 — The chart screen *(5 min)*

Open **CHART**. Drag to pan, wheel to zoom, FIT to reframe. Click open water
with nothing selected: the course lays and the **A** chip lights top-right.
Click **CLEAR COURSE** or the A chip to cancel. Press **NETWORK**.

**Expect:** named islands, owner colours, role letters, the depot starred,
and with NETWORK on, lines between islands that supply each other — plus a
red ring around any island of yours that has fallen off the chain.

**Tell me:** is the chart good enough to *plan* on? That was the goal.

---

## B2 — Refits, presets, and the quartermaster *(5 min)*

Press `Q`. The UPGRADES rows offer speed, point defence, radar and the comm
pod. Under the MANTA button on the right, the **LOADOUT** chip cycles
FULL / SCOUT / BOMBER / INTCPT.

**Expect:** a scout fit costs the ordnance store far less than a full one;
refits are built at a factory island and fitted when the yard finishes.

**Tell me:** are four presets useful, or would you rather just have FULL?

---

## B3 — The third way into an island *(5 min)*

Find an island somebody *owns* and shoot its **command centre** — the mast on
the hill — with a strafing Manta or a Hammerhead.

**Expect:** 400 points of shielding, then the island goes **neutral**, its
works and guns destroyed, ready for anyone's ACCB.

**Tell me:** does bombardment feel like a real third option beside the pod
and the virus bomb?

---

## B4 — The cockpit, the panel, and the small things *(10 min)*

While flying a Manta (`T`), check the panel says **FLIGHT** with the craft's
own compass, throttle, fuel, altitude and the bearing home. Hand back with
`T` and it becomes the ship's again.

Then: `I` for the signals log, the location line under the viewport, `O` for
rear view, `5`–`8` to name a hull directly, and **`S` below zero** to back
the ship astern (useful off a reef).

**Tell me:** anything here that reads wrong or feels missing.

---

## C1 — Looks

`G` cycles graphics tiers. On your 4070, try `?style=modern&graphics=high`
for the Preetham sky and mirror water, then `?style=retro&graphics=high` for
sharper 1988 with the amber grid. The start menu's **look** row previews live.

## C2 — The shop window

Reload to the menu and just watch the diorama for a few seconds — island
assault, distant surf and gunfire. The war room has it too.

## C3 — A second seat

`./run.sh --lan`, join from a phone or a second machine, and try the new war
room rows: **the opening** and **the network**. Turn both off for a war in
the older, simpler shape.

## C4 — Watch a war back

`/?mode=replay` replays your last autosave through the same reducer.

---

## What I most want to know

1. **Does the leash (A2) make the carrier matter, or just make flying
   annoying?** It is the single biggest change and the easiest to soften.
2. **Is the early game still fun now that islands bite (A4)?**
3. **Is the Hammerhead worth its console (A3), or is it a toy?**

Everything in A is tuned by one or two numbers. Say the word and I move
them.
