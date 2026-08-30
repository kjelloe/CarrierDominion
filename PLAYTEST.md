# Playtest script

*Rewritten 2026-08-30. An HTML copy sits beside this file as `PLAYTEST.html` —
same content, easier to read on a tablet or a phone.*

Two parts. **Part one is what I most need to know** — six questions, worth more
than everything else here put together. **Part two is a scenario**: one
complete war, start to finish, that walks every system in the order a real
game uses them. If you only have twenty minutes, do part one.

Nothing here needs preparation beyond `./run.sh` and a browser.

---

## Part one — the six questions

Ranked. If your time runs out, it runs out at the bottom.

### 1. Does the Walrus feel dead?

Launch one (`2`), wait for it to leave the deck, select it (`N`), and try to
drive it.

It **will not** answer the throttle: a selected craft sits until you either
click the sea to send it somewhere or press `T` to take the stick. That is the
design — the throttle is the carrier's helm unless you are flying something.

You reported it as broken, and I believe the reason was that the **PILOT**
button was cut off the bottom of the button column, so nothing on screen told
you the option existed. That is fixed, and PILOT now lights up when a craft is
selected and unflown.

**So: does it read as obvious now?** If it still feels dead, my diagnosis was
wrong, and the answer is to put the craft's state on the panel in words —
*on autopilot* versus *you have the stick*.

### 2. Does fuel biting make you think, or just make you wait?

A full bunker is about an hour of hard steaming; wars run 25–70 minutes. The
ship warns at 25% and again at 10%.

Before this change you could steam flat out for an entire war and finish with
a fifth left — which made the whole fuel supply chain decorative. But there is
a bad version of this where fuel is simply a tax on going anywhere. **If it is
a tax, say so and I will put it back**; it is one number.

### 3. One tabbed console, or six panels?

`J` `Q` `Z` `I` each open the console at their own screen; the tabs along the
top left do the same with a mouse. The change I am least sure of.

The keys are a **radio** now: pressing the same key twice closes the console
rather than putting it back how it was. Tell me if that fights your hands.

### 4. Which of the three stick inputs do you actually use?

While flying a Manta you can pitch with the **arrow keys**, the **CLIMB/DIVE**
buttons, or by **holding the right mouse button over the view and dragging**.
If you only ever reach for one, the other two are clutter and should go.

### 5. Is the weather overdone?

Specifically the sea lighting up from inside when the sun is behind a crest.
That is the effect that makes water look like water, and it is the easiest of
the five to have overcooked. Rain, spray, the wet deck and the sunbeams are
the others.

**This needs `Modern · High`** — see *Before you start*, below.

### 6. Does anything read as the game cheating?

A storm shortens radar, a rough sea slows the boats, a gale lifts you off the
wavetops. All three are meant to be reasons to change your mind, not taxes. If
any of them feels like the game taking something away without telling you,
that is a defect in how it is said, and I want to know.

---

## Before you start

**Check the tier chip in the top row.** It reads something like `1988 · Low` or
`Modern · High`.

- If it is **amber**, the look you have chosen is asking for more than the
  graphics tier pays for — and you are seeing **none** of the weather, the
  mirror sea or the swell. Click it to change tier.
- Weather needs **High**, whichever look you use. That was your own ruling.
- Clicking it reloads the page, but a solo war is saved first and resumed on
  the way back in, so it is safe mid-war.

**Two links worth keeping**, once the game is on the host:

```
https://<host>/?mode=solo&style=retro&graphics=high&islands=16&teams=2&start=0
https://<host>/?mode=solo&style=modern&graphics=high&islands=16&teams=2&start=0
```

Sharper 1988, and everything the RTX tier pays for. Same war either way — the
look never touches the simulation.

**Your war saves itself.** Close the tab and the menu offers it back. If you
ever see *"this war is no longer being saved"*, tell me — that is the
browser's storage quota and I want the number where it bit.

---

## Part two — one complete war, step by step

Start at the menu with **8 islands**, an **AI commander**, **a home island
each**, and the look you want to judge. Then work down this list. Each step
says what to do and what should happen; anything else is a finding.

### A. The bridge

1. **Take the helm.** `W` to build speed, `A`/`D` to steer, `X` for all stop.
   The compass, throttle, speed and fuel all live in the HELM box, bottom
   left. The throttle bar is clickable — the original was mouse-first.
2. **Look around.** `C` cycles chase → gunsight → birdseye; the camera tabs
   along the top do the same. `O` looks astern.
3. **Lay a course.** Click open water with nothing selected and the ship sails
   there on its own; the `A` chip lights while the autopilot has it.
4. **Open the chart** (CHART tab). Click **PROG**, tap three or four points,
   then **LAY COURSE**. The button says whose course it is laying — `PROG SHIP`
   with nothing selected. **CLEAR COURSE** throws it away.
5. **RESOURCES** on the chart colours the islands by role and shows what is
   stockpiled where.

### B. The air group

6. **Launch a Manta** (`1`). Watch the deck cycle — hangar, lift, ramp, away.
   It takes about five seconds and it is meant to be a procedure, not a
   keypress.
7. **Select and fly it.** `N` to select, `T` to take the stick. The panel
   becomes the craft's. Pitch with the arrows, the CLIMB/DIVE buttons, or a
   right-drag on the view (question 4).
8. **WEAPON view.** The weapon selector moves to the bottom centre. Pick a
   weapon and press `F` — or click the weapon chip. You should be looking out
   of the aircraft, not at it.
9. **Attack something.** Click an enemy contact to order an attack; with
   nothing selected, a click sends the ship's own laser.
10. **Bring it home.** `R` recalls. Watch it dock — the deck cycle in reverse.

### C. Taking an island

11. **Launch a Walrus** (`2`) and send it to a neutral island by clicking the
    shore.
12. **Deploy the ACCB pod** (`P`) next to the island's command node. That is
    the capture.
13. **Open the island board** by clicking an island you hold. Set its **role**
    — resource, factory or defence — and build on it.
14. **The virus bomb** (`B`) takes an *enemy* island intact instead of
    levelling it. Worth doing once to see the difference.
15. **Island runways** can be built on resource and defence islands. Land a
    Manta on one and watch it refuel from the island's own stock.

### D. Keeping the war supplied

16. **The quartermaster** (`Q`): island stocks, the depot, the production
    bias, and the refit rows. Buy a refit and watch it build at a factory
    island.
17. **`K`** makes the nearest island your depot; **`L`** calls a supply run.
    The lighter sails out with fuel, ordnance and parts.
18. **The squadron console** (`J`): the board, the **OUTFIT** screen (every
    store has a weight and every hull a budget), the **DECK**, and **SCREEN**
    for the decoy pattern.
19. **The damage board** (`Z`): seven sections, and repair priorities you set
    yourself.

### E. Being shot at

20. **Flares** (`E`) break a missile lock. **`Y`** puts the decoy screen out —
    four inflatable decoys around the ship, at the cost of a quarter of your
    speed.
21. **The Hammerhead**: `3` launches the Viewing Drone, and in DRONE view a
    click fires a missile at what you are looking at.
22. **Take damage on purpose** — sail into a defended island's envelope — and
    watch the damage board and the repair system work.

### F. The weather

23. **Run the clock up** (`.` for faster) and watch a front come through. A
    day is thirty minutes at 1×.
24. In a squall: **rain**, a **wet deck** that darkens and shines and takes a
    minute to dry, **spray at the bow** when you are driving into a sea, and
    the scope's bottom line naming the sea state and what the rain is costing
    your radar.
25. **Face the sun through a gap in the cloud** for the shafts. Not in clear
    sky, not in a downpour — neither has anything to shape them. *Known
    limit:* they are not blocked by islands or by your own hull.

### G. Finishing it

26. **Win it.** Hold two thirds of the islands, or sink the enemy carrier.
27. **The ending screen** shows the scoreboard the fog was hiding, the
    islands, and how long the war ran.
28. **`ESC` twice** surrenders, if you would rather see that ending.

---

## Also worth a look

- **A second seat.** `./run.sh --lan`, join from a phone or another machine.
  The war room takes the same join code all evening.
- **Watch a war back.** `?mode=replay` replays the autosaved war through the
  same engine.
- **A phone.** Landscape only — portrait is gated. One scrolling column of
  buttons a side. The 1988 sea's grid no longer grows with the map — it is one
  patch that follows the camera, so a 32-island war costs the same as an
  8-island one instead of four times as much. **I still have no way to measure
  frame rate here**, so if it is sluggish, tell me *what you were doing* and
  *how many islands*.
- **The shop window.** Sit on the menu and watch the diorama.

---

## How to report

What helps most, in order:

1. **What you were doing** when it happened — the step number above is ideal.
2. **A screenshot.** `debugging/shots/` is where mine go.
3. **The seed and the tick**, if the DBG strip is open (`DBG`, top left).
4. **Whether it happened twice.** Intermittent and consistent are different
   bugs, and I will chase them differently.

For anything that feels wrong rather than broken — pacing, difficulty, a
control that fights you — say it in your own words. Those have been the most
valuable reports so far.
