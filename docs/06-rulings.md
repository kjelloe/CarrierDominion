# 06 — The rulings

Every owner decision that shapes the game, in one place. The question queue
itself lives in an owner-local file that never enters the repo; this is the
public record of what was **decided**, so nobody re-litigates a settled
question or "fixes" something that is the way it is on purpose.

Where a ruling has a number it is the question's number in the owner's queue,
kept so the dev-log's references resolve.

## Foundations (2026-08-18)

| # | Ruling |
|---|---|
| D1 | **House stack.** Plain JS ESM, no build step, no TypeScript, no framework, no physics lib. Zero-dep `engine/`+`shared/`; Node http + `ws`; three.js via importmap is the only client dep; `node --test`. The GDD's stack table is superseded. |
| D2 | **Full determinism**, including flight and drive models: integer fixed-point, seeded PRNG in state, no floats/clock/IO below the client. |
| D3 | **Luau-portable engine subset** (multiciv rules), so a Roblox twin stays a transcription. |
| D4 | **Plan first.** plan-version1.md, then slices, tests first. Owner does the merging; slices land on `dev_night`. |

From the same session: solo play = engine in-browser behind a transport
abstraction; design for 32-island maps though the slice ships 8; graphics
presets Low/Medium/High with auto-detect; **en/no i18n from day one**; capture
by the original's ACCB pod, not hold-the-node; chase camera first.

## The war (2026-08-19)

| # | Ruling |
|---|---|
| 1 | **Time compression** is the answer to transit time — the carrier stays slow (8 kn). Do not "fix" the speed. |
| 2 | More islands means a **bigger ocean**, same density. |
| 3 | **Fuel is a real leash, carried, not conjured.** The whole logistics chain follows from this one. |
| 4 | Grounding: **slow, then halt, then damage.** Backing off is seamanship, never teleporting. |
| 5 | Solo pause + compression ladder; LAN compression **votable** (settled by #24.5). |
| 9 | **Two teams for v1** — but nothing may hard-code two. |
| 13 | **Retro (1988) is the look**, look-only scope, `modern`/`hybrid` stay as references behind `?style=`. |
| 15 | Win by islands (two thirds) or last carrier afloat (extended by #24.4). |
| 17 | **Ordnance must be reloaded** — rearming is a withdrawal from the ship's store; partial rearms are normal. |
| 18 | **A Manta fires when somebody pulls the trigger** — a player or the AI agent flying it. Close-in mounts never wait. |
| 19 | **1000 hull stands, plus damaged sections** — hit components and general hull, like the original. |

## Damage and targeting (2026-08-20, questions 22–23)

- Point defence is **automatic**.
- An autopilot unit **both** defends itself and presses the attack it was sent
  on. The line is the cockpit, not the airframe.
- The enemy carrier plays by **the same rules**.
- Repair priorities are **used when damaged**, feeding an automatic repair
  system that spends the ship's own materials.
- The carrier has **seven geometric sections** — Bow, Midship, Stern, Port,
  Starboard, Topside, Engine — on a 3D wireframe with player-assigned
  High/Medium/Low priorities. Walrus, Manta and lighter carry a single hull
  number. **Armour is read before the section absorbs the hit.**

## The batch that set the rest of v1 (2026-08-20, question 24)

1. **Island infrastructure**: the ACCB pod builds the Command Centre; the owner
   then makes the island **Resource**, **Factory** (up to three plants,
   producing fuel, munitions and replacement chassis) or **Defence** (turrets,
   no economic output).
2. **Targeting at all three levels** — attack orders, boresight aim, pointer
   mode — with **overheat and cooldown on the laser**.
3. **Fog stays radar-range only.** No contact memory, no stealth.
4. **Point cap and time cap** as optional end conditions.
5. **LAN time compression by unanimous vote.**
6. **Walrus speed up** to match the rest of the fleet.
7. Hostname **`carrierdominion.kjell.today`**, port 8135 (the ledger of record
   is game-ops).
8. **The original weapon sets.** Manta: laser / cluster bomb / napalm /
   missile. Walrus: cannon / ACCB / virus bomb / mines.

Follow-ups from the same day: the bezelled instrument panel with a radar scope
and damage schematic; game-start options in the UI; the virus bomb; scope range
controls; a LAN war room adapted from multiciv's; synthesised sound; decoy
flares; rejoin with seat grace; war-room chat; server-side playtest
diagnostics (`/watch`).

## The review rulings (2026-08-20)

After the full engine review, the owner ruled on the numbers it opened:

- **A pod costs 80 materials** (a construction device); **a virus bomb costs
  120 ordnance** (a munition). Both are issued at the ramp from the carrier's
  stores, only when missing and only when the store can pay; the carrier is
  replenished from the stockpile by the lighter. A Walrus sails with a pod as
  standard complement but buys every bomb.
- **A Manta climbs over summits automatically** — the autopilot flies the
  contour, no crash mechanic.
- **A gentle grounding costs one hull point per 100 ticks more than the
  repair rate** (9 against 8): a supplied ship on a reef bleeds materials
  fast and hull slowly, an unsupplied one grinds down.
- The review's minor findings were ruled **fix, not defer**: spectators get a
  chart view rather than team 0's, the virus bomb refuses to double-deploy and
  abandons on any change of owner, and the command log stops recording ticks.

## Amendments (2026-08-21)

- **24.3 amended: the chart remembers.** Detection stays radar-range only and
  there is still no stealth, but a contact that leaves your radar now leaves a
  ghost — last position, heading and time — kept until disproved by scanning
  the spot, never expired by a timer. (Owner asked for fog-with-memory
  explicitly; the original 24.3 said "no contact memory".)
- **The war ends on a screen**, not a HUD line: result, reason, the scoreboard
  the fog hid until it stopped mattering, RETURN TO PORT or KEEP WATCHING.
- **The AI reads the same chart** (follow-up of the same ruling): a lost
  contact draws one scout to the ghost; thirty thousand ticks of silence draw
  a rotating patrol over the islands you hold. The pacing consequence - the
  enemy comes looking - is the owner's to judge in the playtest.
- **Wars survive restarts**: the server autosaves seed + command log and
  resumes to the exact hash, or says why it will not (`RESUME=1` strict,
  `RESUME=auto` for the service).

## Playtest round one (2026-08-22)

The owner's first hands-on session ruled three things:

- **The key list lives behind a `?` button** — hidden until asked for. The
  instruments are the interface; the legend is the manual.
- **A third camera mode: the gunsight.** First person from the weapon mount,
  crosshair centred — `C` now cycles chase / gunsight / map.
- **A flown Manta answers the stick vertically**: arrow keys climb toward the
  ceiling (800 m) and dive toward the wavetops (12 m); a level stick holds
  altitude, and the no-crash terrain rule out-votes the stick either way.

- **One join code is an evening** (2026-08-22): when a LAN war ends, the
  host reopens the room from the ending screen and the table fights again on
  the same code.

- **Graphics tiers get real targets** (2026-08-22): Low = mobile and
  integrated GPUs (full mobile pass deferred), Medium = the current look,
  High = RTX 4070/5070 — for terrain, sea and models, **not the interface**.
  Spec and roadmap: `docs/07-graphics.md`.

## Playtest round two (2026-08-22)

- **The diagnostic strip hides behind a DBG button** upper-left, as the key
  list hides behind `?`. Status feedback survives as a transient toast.
- **The panel is mouse-first, like the original**: the throttle bar is the
  1988 "speed scale" (click to set), rudder arrows hold and centre up, and
  the legend's actions get clickable icon columns flanking the screen — each
  button showing and dispatching the key it mirrors.
- **Models must be recognisable at a glance** — more vertices, same retro
  flat-shaded language: bridge/mast/stripe on the carrier, a real delta with
  fins for the Manta, glacis/turret/wheels for the Walrus, a proper barge for
  the lighter.

## Playtest round three (2026-08-23)

- **Every on-screen button explains itself**: a tooltip after ~600 ms hover.
- **Weapons are a selector, not a cycle**: one button per weapon the selected
  hull carries, the chosen one lit, round counts visible. `V` still cycles.

From the 1988 gap review, ruled the same day:

- **Quartermaster, light**: the stockpile inventory and a Low/Med/High
  production bias per factory output category (`Q`). All-Medium is exactly
  the old plant; all-Low idles it without eating materials.
- **Course autopilot as click-to-sail**: nothing selected + a click on open
  water = the ship sails there. Any hand on the helm, or a grounding,
  disengages it. (The original's map + PROG + A.)
- **Escort only** from the missing order pair — Patrol is near-covered by
  Move plus self-defence.
- **Fuel stays one pool** — the 1988 carrier/aircraft/AAV split and its
  transfer screen are a deliberate deviation, documented in docs/02.

## The scale-up batch (2026-08-23)

Seven rulings in one message, all landed the same day unless marked:

- **Carrier upgrades, at the factory**: speed, point defence, and radar range
  — manufactured like any other build (`build_on_island` kinds 3/4/5, a
  factory island with a plant, your materials), fitted to the ship when the
  yard finishes, once each. **A fuller tech tree is a later consideration —
  noted, not designed.** Damage still degrades an upgraded system from its
  upgraded figure.
- **Replay viewer**: yes. `?mode=replay` walks the autosave through the same
  reducer at war speed — a replay is a seed plus the command log, so the
  viewer is a transport, not a format.
- **Graphics phase 2**: go ahead (landed — docs/07 §3).
- **CI**: added — `.github/workflows/gate.yml` runs tests, smoke and the
  battery on every push to `dev_night`/`dev`/`main`.
- **Action Game**: build it, for quick starts. Clarified: the **developed
  war** — each team starts with a stocked factory (the stockpile), a resource
  island, defence islands with guns up, supply runs on, carriers nudged
  toward the middle as far as open water allows. The rest stays neutral.
- **Up to 16 players in the lobby.** Clarified: **16 carriers, free for
  all** — one team each. Above four teams the start is a ring, not corners;
  the bigger maps this deserves are to be **generated and tested later**.
- **Observers**: richer mode (the referee's view), behind an on/off game
  config — the table's consent, on by default.
- **Deployment** (owner's): after playtesting produces a human-coherent play
  feel; then the friend who loved the original tests.
- **Luau/Roblox twin + mobile Low**: plan and document only (docs/08), for
  a planning pass after the human-first version.

## The showcase batch (2026-08-23, same day)

On the diorama and what rode with it — all landed:

- **The war room gets the diorama too**; the look row **previews live**
  (page colours and backdrop restyle on the spot, unless the URL dictated a
  style — the URL wins at BEGIN); a **proper title card** stands over the
  scrim (it yields in the war room, whose header carries the join code);
  and the menu plays **distant surf and gunfire**, synthesised like every
  other sound.
- **The models pass, at High, in all styles** — sharper 1988 is still 1988:
  working clutter on every hull, flat shading and silhouettes intact.
- **Maps to 64 islands** (the original's own count) for the 16-carrier
  table — clarified at 64 over 48/96. Generation is tested; the live feel
  of a 64-island war is still the table's to judge.
- **Basic touch controls**, with the explicit rider that **real devices
  must test what works** — and **portrait during a war is refused** (hard
  overlay): the bridge is too many buttons for a phone held upright, the
  human turns the device to landscape. The menu stays usable in portrait.

## Third-review rulings (2026-08-23, "fix all")

The three findings that needed a decision, decided with the fix order:

- **Post-war spending is refused.** After the whistle, `build_on_island`,
  pod and virus deploys, and the manual trigger are rejected at the
  reducer — a site started after the war can never finish, so taking the
  payment would burn stores on a decision that cannot land. The world still
  winds down; it does not take money at the door.
- **The AI buys refits.** A finished plant with twice the price on the
  ground lays one down, speed first, never at the chassis line's expense —
  solo play no longer hands the human a permanent edge.
- **A table is never larger than its archipelago.** The fold raises the
  island count to the team count; hashed, so every path agrees.

## Playtest round four (2026-08-24)

From an Action Game session — all landed the same day:

- **The interface says which console you are at**: camera tabs top centre —
  HELM / WEAPON / BIRDSEYE — clickable, the lit one is current; `C` cycles.
- **In WEAPON view the selector is the console**: the weapon chips move to
  the bottom centre at full size. This is also the answer to "could not
  find the carrier's gun" — LASER and its rounds stand under the crosshair.
- **The legend opens screen-centre**, readable, not in a corner.
- **Buttons are context-enabled**: asleep until their moment (PILOT until a
  hull is named, POD/VIRUS until it is a Walrus, CLIMB/DIVE until flying a
  Manta, LAUNCH until one is stowed) — and NEXT marks the hull it named
  with a spinning ring-and-pointer.
- **At the controls, the panel is the craft's**: FLIGHT/DRIVE instruments,
  the scope centred on the flown hull, its hull/altitude/magazine, weapon
  tally and bearing home. Supersedes round two's ship-always helm: the helm
  clicks drive what the panel shows.

## The manual coverage batch (2026-08-24)

From the Amiga-manual review (owner: "build 4, 9, 10, then 1, 2, 7; design
3, 5, 6 for discussion"):

- **4 — the astern gear**: the ship reverses to -25% (the bottom quarter of
  the scale, as 1988 had it); making sternway the STERN feels the bottom,
  which is also how a grounded ship backs off a reef. Units keep 0..100.
- **9 — the signals log**: the last sixteen fog-filtered reports with ages,
  behind `I`/MSG — the original's Messaging Computer.
- **10 — the flavour pack**: derived island names (`shared/names.js`, never
  stored), the location status line, rear view on `O`, direct hull select
  on `5`–`8`, and SURRENDER as a real command behind a double `ESC`.

Built the same day, from the same directive ("build 4, 9, 10, then 1, 2,
7; design 3, 5, 6"):

- **7 — the hangar mends, damage slows, a cripple leaks**: deck repair
  paying yard materials; unit speed and agility in direct proportion to
  repair state (floored at a quarter); the 12% fuel-leak death clock.
- **1 — the telemetry leash**: drones fade at 20 km, self-destruct at
  26 km; the lighter exempt; a sunk carrier is a dead signal source; the
  AI obeys the same leash. The comm-pod exception is a future refit.
- **2 — island runways**: Resource/Defence build kind 6; approach slows,
  strip catches inside 500 m; refuel from the island's own stock; any new
  order relaunches; parked = Command Centre control, no telemetry; a
  captured airfield captures what sits on it.
- **3, 5, 6 — designed here, ruled in the next day, and BUILT on
  2026-08-25**: the Base island and link topology, the Hammerhead with its
  Viewing Drone, and the passive defence drones. docs/09-proposals.md is kept
  for the reasoning, not as a queue. (This line said "designed, not built"
  for three days after they shipped — the hazard of writing a status into a
  ruling.)

## The proposals ruled (2026-08-25)

The docs/09 discussion and the remaining source-review items, decided:

- **Base island AND link topology (3a + 3b)**: each Strategy-game team
  starts on one developed home island; islands link by distance and goods
  flow along the link graph to the depot — a cut-off island stockpiles and
  stops building. Root at the depot (no Base-freeze rule for now).
- **Hammerhead + Viewing Drone, player-only first**: the DRONE camera tab
  while one is up; the AI learns it later if it earns its keep.
- **Passive defence drones, one-button version**: four decoys as a group,
  fixed formation, standing seduction, 25% top-speed cost while deployed.
- **Bat Caves AND neutral silos**: defence islands scramble interceptors,
  and every neutral island keeps a token missile silo — taking even a free
  island costs something.
- **The comm-pod as a fourth refit**: one Manta freed from the telemetry
  leash, built at a factory like the other refits, once.
- **The sea grid goes amber** — the instrument ink over the blue sea, as
  the Spectrum screenshots show.
- **Loadout presets** for launch (scout / bomber / interceptor ammo bias):
  the faithful-light middle of the fitting screen. Full fitting stays out.
- **Build order**: 3a home island → Hammerhead → defence drones → island
  teeth (Bat Caves + silos) → topology (3b) last, with presets, comm pod
  and the amber grid folded in along the way — the economy/AI rework lands
  with the most test coverage behind it.

**All of it built the same day** (docs/02 carries the systems). Two
measurements worth keeping: the home island and the island teeth moved
AI-vs-AI wars from 33k–231k ticks to 35,810–112,498, a narrower spread and
a slower early game; and link topology costs nothing at our island density
— a side that takes the nearest island keeps its chain whole — so it bites
only on overreach, which is what it was ruled in for.

## The post-review rulings (2026-08-25)

From the review of the twelve-slice run:

- **The new consumables come back through the existing spine**: Viewing
  Drones and defence decoys are rebuilt in the hangar from chassis, queued
  LAST after the lighter, Manta and Walrus so the anti-deadlock priority is
  untouched; Hammerhead rounds reload from the ship's ordnance store like
  the laser's magazine. Nothing conjured, no new screen — the faithful-light
  answer to the original's supply-priorities menu.
- **The AI learns both blind spots**: runways on fed Resource islands, and
  the decoy screen deployed when an enemy carrier is in contact.
- **The teeth are surfaced before they bite**: the island board names a
  silo or a bat cave, and the chart marks islands that carry guns.
- **The war room gains two rows**: the home island and link topology can
  each be switched off, so a table can play the older, simpler shapes.

All four built the same day. The battery then found three economy defects
in the chase that followed (equipment eating airframe parts; the AI's
supply list never asking for parts; `planFor` fortifying a team that had
no mine, because the home island made "holds a plant" true from tick one)
— and with those fixed, four of the five seeds resolve FASTER than before
the batch: 25k–165k ticks, where 777001 alone fell from 116,320 to 25,235.

## The start ladder (2026-08-25)

Owner's ask: an option to choose how far along the war is when you sit down
— *default (home island)*, *no island*, *developed war* with a third each and
a third neutral, and *late war* with everything taken, developed and
upgraded, "for late game testing for humans especially."

- **One ladder, not a pile of switches.** `actionStart` and
  `homeIslandStart` were independent booleans with combinations nobody had
  designed. They are now one rule, `startShape`, with four rungs (0 home,
  1 none, 2 developed, 3 late), one war-room row and one start-menu row.
  `shared/options.js` folds the old pair, so saves and replays made before
  the ladder still resolve to the rung they meant.
- **A late war is a different war.** Handing out the whole archipelago is
  already two thirds of it, which is the island victory — so a late war
  raises the bar to 90% of the sea. Everybody starts holding their third;
  the only way to win is to take what the other side built. Capping the
  share instead was tried first and rejected as a lie: the menu said "the
  whole archipelago held" and dealt one island each on a small map.
- **The late ship is a veteran's ship**: all four refits fitted, engines and
  mast at their upgraded figures, a comm pod on one Manta, full stores, a
  full Hammerhead rail, supply running.
- **Closing the distance is a fleet manoeuvre, not a per-ship one.** Both
  developed shapes walk their carriers in from the corners — the late one
  55% of the way, against 30% — and they walk together, each step checked
  against where the others have also moved, with 4 km of sea room owed
  between hulls. Without that they walked onto the same point: 611 m apart
  on seed 900913, one sunk in ten seconds. A blocked step is skipped rather
  than ending the march, because this is a placement and not a voyage.

### The owner's answers (same day)

- **90% is the right bar** for a late war. Kept as built.
- **10–20 km apart is fine** for the ordinary late war. Kept as built.
- **The start menu now opens on 8 islands**, not 4 — the ruleset's own
  default, and not a 14 km sea. The ladder still reads 4 first so the cycle
  runs small-to-large; the default is now stated rather than inherited from
  position.
- **A fifth rung: nose to nose** — "late game by close start". It reuses the
  late war entire and replaces only the placement: one meeting ground, the
  fleet on a circle round it, 4 km between neighbours. Marching further in
  could not have delivered it, because a late sea is wall-to-wall gun
  envelopes — the thing that leaves the ordinary late war at arm's length.

### And the defect it uncovered

The measurement that was supposed to confirm the late war instead found
something older: **the default home-island start could spawn a carrier
inside the enemy home island's battery.** Three four-island seeds in four
did it, and the ship was destroyed inside a minute without scratching the
enemy — the war decided by worldgen rather than by anybody's decision. It is
the same failure the third review found in the developed start on
2026-08-23; the default opening simply never got the clearance walk. It has
one now, shared by every shape, with a fanned retreat (straight back from a
gun is often straight into a beach) and a second pass that settles for water
merely deeper than the ship draws when a crowded archipelago offers nothing
better. Pinned by a test across five seeds, three island counts and all
three armed shapes.

A false lead is recorded with it, because it cost more than the fix: in the
headless battery **team 0 is the empty player seat** (`aiTeams: [1]`). Every
"team 0 dies without scratching team 1" reading was a stationary unmanned
ship, not an AI defect. Check who is actually driving before diagnosing a
one-sided war.

## The squadron batch (2026-08-25)

Owner, after reading 83 screenshots of a PC/DOS playthrough back against our
client: "we have to update the UI to have all the functionality of the
original, in particular managing, outfitting, launching, plotting course for,
recovering and piloting mantas and walruses." The gap analysis is docs/10.
Four questions, four rulings:

- **Outfitting: the full 1988 model.** A payload WEIGHT budget and a weight
  on every store, fitted and landed per hardpoint — not presets dressed up.
  The numbers are the original's where the original stated them: an
  air-to-air missile 60 kg, the ACCB pod 400. A brim-full Manta fit is
  exactly its 750 kg; a Walrus carries 1,400 kg of guns and mines in a
  2,000 kg hull, so it takes the pod OR the virus bomb and never both. It
  used to be handed both for free.
- **The deck cycle, lift included.** IN HANGER → ON FLIGHT DECK → LAUNCHING
  → away, and DOCKING → IN DOCK, with progress bars and a standing ABORT.
  The lift is the MIDSHIP section, so a wrecked hangar strands the air group
  exactly as the original's repair screen implied. Shuffling craft fore and
  aft on the deck is deliberately NOT carried over: a 1988 interface for a
  1988 problem, and not a decision.
- **Waypoints for units and the carrier**, numbered, with the route drawn on
  an inset map while piloting.
- **Typed ACCB pods**, and the role still changeable afterwards. The 1988
  stores list reads POD - RESOURCE / FACTORY / DEFENCE, so an island's
  purpose is chosen at the ship; the island board may still re-role it,
  which is the one liberty we keep over the original.

### What the battery found, again

The deck cycle stopped seed 20260818 resolving at all — 900,000 ticks, the
watchdog calling it dead from tick 254,633. The cause was not the deck: it
was **the supply boat loading by a fixed order instead of by shortfall.** A
carrier sat at 87 of 1,000 hull with ZERO materials while its own depot held
61,571 of them, because the hold filled with fuel every run for a ship
already 58,327 fuel to the good. It could not mend, so it retreated; it
retreated for the rest of the war. Two fixes, both general: the boat loads
EMPTIEST FIRST, and the AI's shopping list finally asks for materials when
the hull is damaged — the third time that list has been found short (fuel and
ordnance were there from the start, chassis were added after seed 900913,
materials were never there at all).

The same measurement caught the deck cycle restarting a docking craft's
clock every tick, so aircraft flew an endless final, ran dry and were rebuilt
at chassis cost. And typed pods froze the machine's estate: `planFor` was
only ever asked about an island with NO role, and after typed pods no island
has none, so no AI team ever built a factory again. The machine now types its
pod at the beach rather than at the ship - the estate at the beach is not the
estate the vehicle sailed from - and re-roles an island whose plan has
changed while nothing is built on it.

That last fix then exposed an oscillation that had always been latent:
`planFor` asked what an island should be while counting that island's own
role in the answer, so one island flipped RESOURCE/FACTORY every three ticks
for a whole war. It now asks what an island should be GIVEN THE REST of the
estate. The old code was safe only by accident - it planned an island once,
when it had no role, so the loop could not close.

## The last consoles (2026-08-26)

Owner: build the turret console's TEMP gauge and orientation diagram, the
drone placement, and the RESOURCES island counts. All three were the tail of
docs/10 gap 5; with them the 1988 interface review is closed apart from two
things left deliberately (the 2x2 quad camera view; craft selectors as icons
rather than numbered chips).

Two judgements inside the build, recorded because they are design and not
plumbing:

- **The gunnery dial reads the designated target, or the boresight.** Our
  laser does not traverse mechanically, so there is no mount bearing to
  draw and no slew to give a D-pad to. Reading the designation is what
  "where the gun is pointing" honestly means here, and it gives the same
  picture the original's diagram gave: a target abeam swings the line out.
- **The decoy screen gained a pattern and a spread**, changeable while it is
  out. The one-button deploy the owner ruled for is untouched; this is only
  where the bait sits. The 25% speed price is untouched too.

## The weather (2026-08-26)

Owner: a more lifelike ocean with waves like the reference scene, wind
aligned with the waves, larger and smaller seas so the weather tells a
story, clouds from few and near-white through many and grey to a full
grey-dark-blue storm with lightning, and a day-night cycle with the sun
crossing and casting shadows -- **no complete darkness** -- "purely render at
first", and only on the modern / High setting.

Four decisions came out of building it.

**The sky is derived, never stored.** `weatherAt(seed, tick)` is a pure
integer function. Nothing about the weather is in the state, so it cannot
desync a LAN war, cannot move a golden pin, and costs nothing on the wire --
and *because* it is pure and cheap, the engine may read it as freely as the
renderer, with no chance of the two disagreeing. Every alternative we
considered (weather in the state, weather on the wire, weather rolled by the
client) loses at least one of those.

**A day is thirty minutes at 1x**, fronts about every twenty. Chosen so a war
of ordinary length sees several dawns rather than one endless afternoon.
Time compression speeds the sky with everything else; it is the same clock.

**One effect is wired, and it is radar.** The owner's ask was render-only,
and asked for one effect to be wired now. Radar range is the right one: it
changes where you have to be, which is the decision the game is made of,
without ever taking the picture away from the player. The floor
(`radarStormPermil`, 700) matters more than the curve -- a storm must cost
reach, not sight. It measured well: seed 777001 went from a 192,000-tick
grind won on island count to a 26,000-tick sinking, worst lull 30,689 -> 8,769.
Everything else the weather does -- swell, cloud, lightning, the sun -- is
cosmetic and gated on High + modern, per #13.

**Night never goes fully dark.** The owner asked for it and it is also the
right rule: a game that cannot be played for eight minutes an hour is not
atmospheric, it is broken. The floor is in `shared/weather.js` (day never
below ~180 per-mil) and it is asserted twice -- once in the arithmetic, once
in the pixels (`debugging/probes/weather.mjs`).

## The eight answers of 2026-08-26

Asked with options and measured numbers; answered the same evening.

**Weather reaches the small craft, and nothing else (Q1b).** A rough sea
slows the Walrus and the lighter and lifts the Manta off the wavetops.
Gunnery was offered and declined: it compounds with the radar rule, which
already pulls fleets together, and a storm that makes your shots miss reads
as the game cheating unless the cockpit explains itself. Sea state gives a
reason to WAIT, which is the decision the radar rule does not add.

**No rain or spray yet (Q2b).** The look is good enough to playtest.

**Lightning blooms the scope (Q3b)** - a brief clutter return the player
learns to read past. It is drawn UNDER real contacts, so a strike can never
hide a real blip: the instrument gets weather, the player loses no
information, and the AI is not disadvantaged by a thing it cannot see.

**The squadron numbers stand (Q4a):** Manta 750 kg with a full four-station
fit at exactly 750, Walrus 2000 kg, a five-second deck cycle, eight
waypoints.

**One tabbed console (Q5b).** The six panels - chart, damage, island, log,
squadron, stores - fold into a single overlay with a tab strip. Each key
still opens its own tab, so nothing anyone has learned stops working. This
is closer to the 1988 screens and it stops the panel count growing forever.

**The dead keys go, and fuel is made to bite (Q6a + Q6b).** `startFuel`,
`startOrdnance` and `startMaterials` in `data/rules.json` were read by
nothing and are deleted. Separately - and measured first - fuel and ordnance
were shown never to bind: across three full AI-vs-AI wars the bunker never
fell below a fifth and the magazine never below 57%, while materials sat
near their 400 start against an 8,000 cap. Ruling #3 bought us a fuel supply
chain that was decorative, so fuel is being given a real cost as its own
measured slice.

**The oversized engine modules stay as they are (Q7a).** Splitting churns
the files the golden pins depend on for no behaviour change.

One thing the deletion taught us, worth keeping: **deleting a key nothing
reads still moves the golden pins**, because `state.rulesHash` hashes the
whole ruleset so two LAN peers can prove they are playing the same game.
That is the field working as intended, not a defect - but it means a pin
move is not by itself evidence that the war changed. Proven here by hashing
3,000 ticks with `rulesHash` blanked: identical, tick for tick.

### What building the eight taught us

Three things worth keeping, none of which were the point of any ruling:

- **The battery cannot choose every number.** Three of the five seeds do not
  move at any sea-state or fuel-burn setting; the other two swing chaotically
  (777001 reads 26k / 82k / 205k / 48k ticks across four sea-state values,
  not monotonic anywhere). When the instrument cannot separate two candidates,
  say so and choose on design grounds - do not spend an evening tuning against
  noise and call the result measured.
- **A pin move is not evidence the war changed.** `state.rulesHash` hashes the
  whole ruleset on purpose, so deleting a key nothing reads still moves both
  pins. Hash the trajectory with `rulesHash` blanked to tell the two apart.
- **When a measurement reads zero, suspect the meter.** A fuel sweep reported
  no refuellings at any burn rate, which read as a dead supply chain; the
  chain was fine and the detector's threshold was five per-mil against
  deliveries of four.

## The architect's review (2026-08-27)

Twelve findings from an outside review, all verified against the code before
being acted on; none were false. R-001 to R-009 built, R-006 on a ruling.

**A rejected command must change nothing.** `reject()` pushes the rejection
event and returns the state it was handed - it does not roll anything back -
so three orders that called `liftOff` before their last check lifted a parked
Manta off a runway and *then* refused the order. Ordering is the whole fix:
mutate only after nothing can still say no.

**Route legs are bounded like every other coordinate.** `set_route` was the
one order that would steer at a point outside the world, because the
validator has no state and therefore no `sizeUnits`, and nobody had put the
upper bound in the reducer. The watchdog noticed, once per tick, forever.

**What the guns can reach, the scope must show.** The fog listed unit states
by number and left out `UNIT_LANDED`, which `unitEngageable` explicitly
includes - "a runway is a place to refuel, not a sanctuary". The AI reads
state directly and could shoot enemy aircraft parked on a runway that the
player was never shown. The filter now asks `unitEngageable` rather than
repeating a list, so the two cannot drift apart again; the referee sees
everything that is not in a hangar, which is a wider set on purpose.

**A resumed war keeps its war room.** It was built only when nothing was
resumed, so with `RESUME=auto` - the service setting - the hosted box had no
room after any restart, and the table could finish their war but never start
another. The room now opens in `running` and inherits the options the war was
actually being played with.

**An engine fault stops the war, not the server** (ruled: seats stay
connected). The clock pump had no `try/catch`, and `shared/fixed.js` throws on
purpose, so one arithmetic edge would have killed the process - taking the
shutdown save with it. It now halts, saves, tells the table and reports on
`/healthz`. Two things that only appeared once it was measured: the callback
must refuse on its own account, because `stopClock` does not stop the ticks
already due (the first version halted four times); and when the STATE is what
broke, the ordinary save cannot be written at all, so the command log is
written beside it as `<save>.halted` - not auto-resumable, because an empty
hash cannot be verified and resume refusing a mismatch is a guard worth
keeping.

**A commander back late gets their ship back** (owner's ruling). The sweep
released the hold when the grace window ran out, so the token named nothing
and a late arrival was handed the lowest free seat - a different carrier,
their name discarded, the machine still flying theirs. The hold is kept now;
the AI is a caretaker, not a claimant. A seat it is merely minding still reads
as free to a NEWCOMER, or a war would leak a carrier every time somebody left
for good.

Also: the autosave test drives the clock instead of sleeping; the panel
publishes where it drew the scope so the weather probe stops re-deriving it
from copied layout constants; and the permission allow-list lost `git push *`,
`git fetch *`, `sed *`, `node *` and `cd *` - `git push *` permitted pushing
to `main`, which the working agreement forbids, and `git fetch *` is
prohibited outright.

**Not done, and why:** R-010 (documentation drift), R-011 (`set_route` is the
only order that refuses a landed Manta) and R-012 (crypto session tokens, a
stricter URL parser) were outside the batch asked for. All three are small and
still open.

## The first playtest at the controls (2026-08-28)

Six findings from the owner actually flying the thing. They are mostly one
finding wearing six hats: **the interface knew things it never said.**

- **Every key must also be a button.** Four were keyboard-only, including the
  decoy screen — a ruled feature whose button label had sat unused in both
  language files since it was specced. Now enforced by an audit that reads the
  key list out of the source, so the next one fails on the next probe run.
- **A button below the fold does not exist.** The right-hand column held 622px
  of controls in 448px of screen and cut FIRE, POD and VIRUS off the bottom.
  The columns wrap now. Hiding the sleeping ones was refused: the 2026-08-24
  ruling keeps them visible at a third opacity and that is how a player learns
  the ship.
- **Both bars go along the top**, screens on the left, ways of seeing beside
  them — and the console's tab strip is always on screen rather than living
  inside the thing it opens.
- **CHART belongs to the camera bar alone.** It was on both bars briefly; the
  console's copy opened the same map but left the camera bar lit on HELM. When
  two controls do one job, keep the one that leaves the interface honest.
- **A control must say what it will act on.** PROG routed to the selected
  craft and to the ship otherwise, which is correct, and said neither - so a
  player with nothing selected laid four waypoints, watched the carrier take
  them, and concluded that plotting a course for a Manta did not work. It
  reads PROG W4 or PROG SHIP now.
- **The stick answers the mouse too**: right-drag over the view while flying.

The Walrus that "just sat there" was not a bug in the engine - ordered moves
and piloting both work, measured. It was the same defect as the rest: the
PILOT button that would have explained it was one of the three cut off the
bottom of the column.

- Everybody in a war needs a carrier: a room refuses to sail while a seated
  commander's team falls outside the table (2026-08-28). Observers are not
  owed a hull and never block a start.

## Standing constraints that follow from the rulings

- Style is data; nothing cosmetic may touch the simulation — two players on
  different styles see the same state hash (from #13).
- Nothing is conjured, anywhere: goods have a location, and every issue —
  fuel, rounds, payloads, rebuilt hulls — is a withdrawal from a store that
  something filled (from #3 and #17).
- Nothing may hard-code two teams, and a rule that only matters at three
  teams still has to be right (from #9 — the virus `virusVictim` rule is the
  worked example).
- The weather is a pure function of (seed, tick), stored nowhere, and the
  only thing it changes in the simulation is radar reach (from the
  2026-08-26 ruling).
- After the war ends, **nothing new is decided** — enforced in the reducer,
  not just described.
