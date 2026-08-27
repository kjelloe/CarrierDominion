# Playtest script — 2026-08-25

Everything below changed since your round-four session. The **A steps** are
the ones I cannot judge for you and that would spoil the game if they are
wrong; **B** is confirmation that built things behave; **C** is polish and
can wait for a rainy evening.

Budget: **A is about an hour and a half**, B another 30, C as long as you
like. A6 and A7 are the new ones and the ones I most want read.

For each step: what to do, what I expect, and *what I need back from you* —
a sentence is plenty. "Fine" is a useful answer. So is "hated it".

```bash
./run.sh          # then http://127.0.0.1:8135
```

Keys you will need: `W/S` throttle (the ship goes astern below zero), `A/D`
rudder, `1/2/3` launch Manta / Walrus / Viewing Drone, `N` next hull,
`T` take the controls, `F` fire, `Y` decoy screen, `I` signals log,
`Q` quartermaster, **`J` the squadron console**, `Z` damage board,
`C` camera, `?` the legend.
The tab row above the horizon is HELM / WEAPON / BIRDSEYE / CHART, plus
DRONE while an eye is up.

---

## A1 — The opening now starts developed *(5 min)*

Start a solo war from the menu (leave the defaults; **the war starts** should
read **a home island each** — it is the first rung of a four-rung ladder,
new since your last session: *a home island each* / *with nothing but the
ship* / *developed — a third each* / *late — the whole archipelago held*).

1. Before touching anything, open the **CHART** tab.
2. Find your island — it is the one with your colour, a runway mark and the
   depot star.
3. Press `Q` and look at the stores.

**Expect:** you begin owning one developed island (plant, runway, two guns,
some stock) with the supply run already going, and a lighter already at sea.
The race is for your *second* island, not your first.

**Tell me:** does starting from a base feel better or worse than the old
from-zero opening? This is reversible — click **the war starts** once for
*with nothing but the ship*, which is exactly the old opening.

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

## A5 — The late war and nose to nose *(20 min)*

The last two rungs of **the war starts** are the ones built for you: the
whole archipelago already held and developed, every refit already fitted.
No four-hour build-up. *Late* puts the enemy's nearest island about 10 km
off; *nose to nose* is the same war with the fleets already touching.

1. From the menu set **islands** to 16 and **the war starts** to *late — the
   whole archipelago held*. Begin.
2. Press `Q` before anything else: all four upgrade rows should read as
   fitted, stores full, the Hammerhead rail loaded.
3. Open **CHART**. You hold half the sea; there is no neutral ground and the
   frontier runs down the middle.
4. Now fight it. Take an island off them — bombard the command centre, or
   pod it — and see whether an endgame with everything switched on is
   actually enjoyable or just busy.
5. Then restart on the last rung, **nose to nose** — the same late war, but
   the fleet begins on one patch of water 4 km apart, enemy ship on the
   scope from the first tick. Two carriers are bow to bow; a bigger table is
   a ring brawl.

**Expect:** the war you would reach after four hours, from the first tick —
and on the last rung, that war already in contact.

**Tell me:** is 4 km the right "nose to nose", or should it be closer? (At
611 m the AI sank a ship in ten seconds, so there is a floor somewhere.)
90% and the late war's 10–20 km are settled — this is the only number still
open on the ladder.

---

## A6 — The squadron console *(15 min — new, and the point of the batch)*

You asked for the original's Manta and Walrus screens. Press **`J`**.

1. **BOARD.** Every hull of that kind, numbered, with what it is doing. The
   bar is fuel — or the deck clock, when one is running.
2. **OUTFIT.** This is the fitting screen. Every store now has a WEIGHT and
   every hull a budget: a full Manta fit is *exactly* 750 kg, so the loadout
   you have always launched with is the brim. Press `−` on the laser a few
   times and watch the budget fall; the rounds go back into the hold.
3. Switch to **WALRUS**. She carries 1,400 kg of guns and mines in a 2,000 kg
   hull, the ACCB pod is 400 and the virus bomb 300 — so **she takes one or
   the other, never both.** Try to FIT the bomb with everything aboard: it
   refuses. Land the mines and it goes on.
4. The pod is **typed** now — POD: RESOURCE / FACTORY / DEFENCE. Click it to
   cycle. Whatever is in the rack is the role the island wakes up in, and the
   island board can still change its mind afterwards.
5. **DECK.** Press LAUNCH and watch: *in the hangar → on the flight deck →
   launching → away*, about five seconds. Press it again and hit **ABORT**
   halfway. The lift is the midship section — wreck it (Z) and nothing goes
   up at all.

**Tell me:** (a) is the weight budget a good decision or an annoying one?
(b) Is five seconds the right length for a launch, or should the deck be
quicker? (c) Is the console in the right place at `J`, or should it be a tab
on the top row beside CHART?

---

## A7 — Plotting a course *(5 min)*

Open **CHART**. Press **PROG**, then tap three or four spots — each becomes a
numbered leg, dashed while you are laying it. Press **LAY COURSE**.

With nothing selected the course goes to the ship. Select a Manta or Walrus
first (`N`) and it goes to that hull instead. **CLEAR** throws away a course
you are still laying; press it again and it cancels the standing one.

**Expect:** the hull runs the legs in order and only reports "arrived" at the
last one. Up to eight legs.

**Tell me:** is eight enough? And is PROG-then-LAY the right shape, or would
you rather each tap sent immediately?

---

## A8 — The last three consoles *(10 min — new)*

1. **GUNNERY.** Tab to **WEAPON**. The right-hand instrument box is now the
   gun's: a dial with your hull bow-up and the gun line on it, a **temp**
   gauge, and `LASER OPERATIVE` / `MOUNT OPERATIVE`. Hold `F` down and watch
   temp climb — the laser stops when it cooks, and now you can see it coming.
   Designate a target off the beam and the gun line swings out to it.
2. **RESOURCES.** Tab to **CHART**, press **RESOURCES**. The archipelago by
   role, yours against theirs, your depot, and what your islands hold.
3. **SCREEN.** `J`, then the **SCREEN** page. Deploy, then try **AHEAD** and
   **FLANKS** and watch the plan. You can move the screen while it is out.

**Tell me:** is the gunnery dial worth its space, or would you rather have
the ship's condition there even at the gun? And do the drone patterns change
anything you can feel, or is RING always right?

---

## A9 — The decoy screen and its price *(5 min)*

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

## A10 — The console, and the keys you already know *(10 min — new)*

The six panels are now one overlay with a tab strip: SQUADRON, STORES,
DAMAGE, ISLAND, CHART, SIGNALS. Your keys are unchanged - `J` `Q` `Z` `I`
each bring up their own tab - with one difference worth feeling: they are a
**radio** now, so pressing the same key twice closes the console rather than
putting it back how it was.

- Walk all six tabs and tell me whether one overlay is better than six. This
  is the change I am least sure of.
- **The chart** takes the whole screen on its tab, with only the tab strip
  floating over it. Does the strip get in the way of the map?
- **ISLAND** is dimmed until you have clicked one of your islands. Click one,
  go to another tab, come back - it should still be showing that island.
- Anything that used to be one keypress and is now two is a defect. Tell me.

## C1b — The weather and the day *(10 min — new)*

`?style=modern&graphics=high` only; everywhere else the sun stays where it
always was. A day is thirty minutes at 1×, so at 1× you will see one dawn in
a sitting — **use time compression** to run the sky, or freeze it with
`?weather=<tick>` to inspect one mood.

For seed 20260818 the moods sit at: dawn `?weather=9600`, high noon `15420`,
grey overcast `53040`, full storm `46500`, night `0`.

What I want your eye on:

- **The storm.** Grey-dark-blue, or has it gone brown? It took three passes
  to stop a low sun tinting a squall peach, and my test for it now allows a
  few counts of warmth because there is island terrain in the measured band.
- **The night.** You should be able to fight in it. If any moment is too
  dark to steer by, that is a bug, not a mood.
- **The swell** should run *with* the wind. Sail across it and then into it
  and tell me whether the ship looks like it is in the same sea both times.
- **Lightning** only in a storm, and as a stroke — if it reads as a lamp
  switching on and off, the flash is too long.
- **The horizon.** Cloud, haze and sea have to agree at the sea line. Any
  bright strip there is the thing I chased longest.

And the parts that are not scenery. **A storm shortens radar** - watch the
ring on the scope, which now draws what the set actually reaches rather than
its fair-weather figure. **A heavy sea slows the boats**: the Walrus and the
lighter lose up to a third afloat, and the Walrus gets it all back the moment
it is ashore. **A gale lifts you off the wavetops** - full forward stick in a
Manta will not take you as low as it does in calm water. The scope's bottom
line names the sea state and the radar loss, so all of it should be legible
without guessing.

I want to know whether those read as weather or as faults. And separately:
**fuel now bites.** A full bunker is about an hour of hard steaming against
wars of 25 to 70 minutes, where before you could steam flat out for a whole
war and finish with a fifth left. Tell me whether you ever had to think about
it, and whether thinking about it was interesting or just annoying.

## C2 — The shop window

Reload to the menu and just watch the diorama for a few seconds — island
assault, distant surf and gunfire. The war room has it too.

## C3 — A second seat

`./run.sh --lan`, join from a phone or a second machine, and try the new war
room rows: **the war starts** and **the network**. Set the first to *with
nothing but the ship* and turn the second off for a war in the older,
simpler shape.

## C4 — Watch a war back

`/?mode=replay` replays your last autosave through the same reducer.

---

## What I most want to know

1. **Does the leash (A2) make the carrier matter, or just make flying
   annoying?** It is the single biggest change and the easiest to soften.
2. **Is the early game still fun now that islands bite (A4)?**
3. **Is the Hammerhead worth its console (A3), or is it a toy?**
5. **Does the fitting screen (A6) make outfitting a decision worth making?**
   The weight numbers are the original's, and every one of them is a line in
   a data file.
4. **Is the late war (A5) the late-game test bench you asked for?** The
   90%-of-the-islands bar and how close the carriers start are both one
   number each.

Everything in A is tuned by one or two numbers. Say the word and I move
them.
