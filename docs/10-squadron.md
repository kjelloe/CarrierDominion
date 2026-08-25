# 10 — The squadron console

**Status: built, 2026-08-25.** This document was written as a gap analysis
against the original and is kept as one — the "what we do not have" reading
is now history, and each gap closes with a note saying how. The owner's
rulings on the four open questions are in docs/06.

Source: 83 screenshots of a PC/DOS playthrough
(`../retrogradegames/carrierdominion/screenshots/`, 2026-08-25), read against
`amiga_manual.md` and our own client.

The finding in one line: **we have almost every mechanic and almost none of
the console.** A Manta can be launched, flown, armed, landed and lost — but
the player never sees a hangar, never chooses what hangs under a wing, never
watches a craft ride the lift up, and cannot draw a route for it.

---

## How the original organises the screen

Three fixed regions, and the trick is that two of them are context-switched
together.

```
┌─────┬───────────────────────────────────┬─────┐
│ WHO │                                   │WHICH│   left  : which console
│  am │          the viewport             │ page│   right : which page of it
│  I  │                                   │     │   bottom: instruments and
├─────┴───────────────────────────────────┴─────┤            controls for
│  bottom bar — ENTIRELY context switched       │            whatever the
└───────────────────────────────────────────────┘            left column says
```

**Left column — which console.** Carrier · Carrier weapons · Walrus squadron
· Manta squadron · Save. The selected icon turns blue.

**Right column — which page of that console.** It *changes with the left
column*. On the carrier: supply, map, repair, stores, messages. On a
squadron: supply, map, **outfitting**, **deck/dock**, drones.

**Bottom bar — the instruments.** On the carrier: radar scope, camera icons,
POSITION/BEARING/ISLAND, DEPTH/FUEL/SPEED, speed chevrons. On a squadron:
**craft selectors 1–4**, that craft's weapon icons, ALT/FUEL/SPEED, signal
strength, return-to-ship. On a map page: PROG/CLEAR, a D-pad, zoom, REPORT,
TIME WARP.

We already have the equivalent of the left column (camera tabs, ruled
2026-08-24) and of the right column (Q/Z/I/CHART panels). **What we have no
equivalent of is a squadron console at all.**

---

## Gap 1 — Outfitting *(the biggest, and the one with no counterpart)*

> **Closed.** `engine/payload.js` + the OUTFIT page of the squadron console.
> Weight budget, per-station fitting, typed pods, repair state and fuel, all
> against the original's own numbers where it stated them.

The original devotes a whole page per craft:

```
MANTA 1                          WALRUS 1
AIR DEFENCE FIGHTER              AMPHIBIOUS ASSAULT VEHICLE
PAYLOAD WEIGHT                   PAYLOAD WEIGHT
  MAXIMUM  750KG                   MAXIMUM  2000KG
  CURRENT    0KG                   CURRENT     0KG
REPAIR STATE 100%                REPAIR STATE 100%
[UNDERSIDE VIEW — 3 hardpoints]  [SIDE VIEW — 2 hardpoints]

PAYLOADS   ▲ ✕ ▼                 PAYLOADS   ▲ ✕ ▼
QUANTITY 32   WEIGHT 60KG        QUANTITY 4   WEIGHT 1600KG
SINGLE MISSILE MOUNTING          AVATAR HEAVY-DUTY CHEMICAL LASER
ASSASSIN AIR-AIR MISSILE                        [+] [−]
              [+] [−]
REFUEL ⌃⌄     FUEL SUPPLY ▓▓▓░   REFUEL ⌃⌄     FUEL SUPPLY ▓▓▓░
```

Every part of that is a decision the player makes and we currently make for
them:

| The original | Us today |
|---|---|
| Browse the whole stores catalogue per hardpoint (▲/▼) | — |
| Fit and remove one item at a time (+/−) | — |
| A **weight** budget, 750 kg air / 2000 kg ground | ordnance cost only |
| A named role per craft ("AIR DEFENCE FIGHTER") | — |
| Hardpoints drawn on a plan of the craft | — |
| Repair state per craft | in the engine, not on a screen |
| Refuel this craft, against a visible ship supply | automatic |
| **Typed ACCB pods** — POD-RESOURCE / POD-FACTORY / POD-DEFENCE | one generic pod; role chosen after capture |

We have four fixed stations per Manta (laser / cluster / napalm / missile)
and a `mantaPreset` that fills them to per-mil levels — FULL / SCOUT /
BOMBER / INTCPT. That is the same *shape* as hardpoints, one step short of
the same *control*: the stations exist, the player just cannot address them
individually, and nothing has a weight.

## Gap 2 — Launching is a procedure, not a keystroke

> **Closed.** `engine/deck.js`. The lift is the MIDSHIP section, so a wrecked
> hangar strands the air group exactly as the original's LIFT did. The one
> thing deliberately not carried over is shuffling craft fore and aft on the
> deck: a 1988 interface for a 1988 problem, and not a decision.

The original moves a craft through the ship:

```
IN HANGER  →  ON FLIGHT DECK  →  LAUNCHING  →  airborne
```

…with a progress bar per craft, four deck buttons (move fore, move aft,
**lift up**, **lift down**) and a standing **ABORT**. The LIFT is a
repairable system on the damage board — lose it and the deck cycle stops.

Recovery is the mirror, and stricter:

```
DOCKING  →  INSIDE DOCKING CONE  →  IN DOCK
```

We launch on `1`/`2` in one tick and recover by flying near the ship.

## Gap 3 — The squadron board

> **Closed** (the board and the numbered selector; the 2x2 quad camera view
> is not built — four live feeds is a renderer question, not a console one).

Always visible in the bottom bar of a squadron console:

```
MANTA FIGHTERS:
1 ●●●●●●········ ON FLIGHT DECK
2 ●●●●●●●●●●●●●● IN HANGER
3 ●●●●●●●●●●●●●● IN HANGER
4 ●●●●●●●●●●●●●● IN HANGER
```

Plus a 2×2 quad view — four camera feeds at once, one per craft, each
captioned with its status. We show a hangar count in the HUD and unit chips;
there is no board and no quad view.

## Gap 4 — Course programming

> **Closed.** `engine/route.js` and PROG / LAY COURSE on the chart. Eight
> legs, numbered, for a unit or the ship; reaching a mark takes the next leg
> silently and only the last is an arrival. The inset route map while
> piloting is not built - the chart draws the course instead.

`PROG` / `CLEAR` on the map, with **numbered waypoints** dropped by a D-pad
cursor, per craft; while piloting, an inset map in the corner of the
viewport draws the programmed route and the craft's place on it. Status
lines report *"Walrus 2 has reached its destination"* and *"Walrus 3 course
set"*.

We have single-target click-to-move for units, and a one-leg course
autopilot for the carrier.

## Gap 5 — Smaller things

> **Closed**, 2026-08-26, except the 2×2 quad camera view and the craft
> selectors as *icon* buttons (ours are numbered chips, which is the same
> control in our idiom).

- **Craft selectors 1–4** — *built* as the numbered chips at the top of the
  squadron console, alongside `N` and the direct keys `5`–`8`.
- **Turret console** — *built*. In WEAPON view the right-hand instrument box
  becomes GUNNERY: the orientation dial (hull in plan bow-up, the gun line
  swinging around it, the bearing under it), a **TEMP** gauge against the
  weapon's own heat ceiling, and `LASER OPERATIVE` / `MOUNT OPERATIVE` in
  plain words. Our laser does not slew mechanically — it fires at what it is
  pointed at — so the dial reads the DESIGNATED target when there is one and
  the boresight otherwise, which is what "where the gun is pointing" honestly
  means here. No D-pad, for the same reason: there is no traverse to drive.
- **Defence-drone placement** — *built*, as the SCREEN page of the squadron
  console. Four patterns (RING / AHEAD / ASTERN / FLANKS), three spreads
  (TIGHT / NORMAL / WIDE), the counts out / aboard / lost, and a plan of the
  ship with the drones drawn where they will actually be. The screen can be
  moved while it is out — that is the manoeuvre. Deploying is still the
  one-button version the owner ruled for; this is only where the bait sits.
- **RESOURCES map mode** — *built*, a second button on the chart beside
  NETWORK. The archipelago by role, yours against theirs, the neutral count,
  the depot by name, and the sum of what your own islands hold. The supply
  lines were already the NETWORK overlay. MILESTONE has no counterpart here:
  the original's campaign had one and our war does not.

## Deliberate deviations — NOT gaps

- **Separate AIRCRAFT FUEL and AAV FUEL pools** with SUPPLY TRANSFER / FUEL
  TRANSFER. One pool is a documented owner ruling (2026-08-23).
- **Damage by system** (ENGINES, RADAR, LIFT, …) rather than by geometric
  section. Seven geometric sections with system effects is a ruling
  (2026-08-19).
- Repair priorities High/Med/Low we already match exactly.

## What the original got right that we already have

Worth recording, because it is most of the list: the telemetry leash
(*"Walrus 2 telemetry signal weak"*), the Hammerhead fired by clicking a
viewing-drone picture, island runways, the resource network drawn on the
map, repair priorities, time compression, the messages log, named islands
and a POSITION/BEARING/ISLAND readout, ACCB and virus capture.
