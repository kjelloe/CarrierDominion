# 04 — The client

Floats live here and nowhere else. Everything below `client/` is integers; the
renderer converts once, at the boundary, in `client/render/coords.js`.

## No build step

`client/index.html` loads ES modules directly and resolves `three` through an
importmap onto a vendored r162. There is no bundler, no transpiler, no
`node_modules` in the serving path. Editing a file and pressing reload is the
whole development loop, and `view-source` on the running game shows the code
that is running.

## Art direction, as data

`client/styles.js` holds three complete treatments of the same geometry —
`retro` (the default, 1988), `modern`, and `hybrid` (a remaster) — selected with
`?style=`. A style is a table of numbers: sky colour, fog scale, whether the sea
is a shader or a grid, flat versus smooth shading, palette steps, instrument
tint.

Nothing in a style reaches the simulation. **Two players on different styles see
the same war and the same state hash** — which is exactly the property that
makes it safe to keep three of them.

`client/graphics.js` is the separate axis: a quality level, cycled with `G` —
Low for phones and integrated GPUs, Medium as the pinned reference look, High
for RTX-4070-class desktops. Tiers touch terrain, sea, models and lighting,
never the interface and never the art: retro at High is sharper 1988, not a
different game. The full contract, the tier matrix and the High-water roadmap
are `docs/07-graphics.md`.

## The panel

`client/render/instruments.js` draws the 1988 console: three bezelled
instruments across a 196-pixel strip.

| Instrument | Shows |
|---|---|
| HELM | heading compass, throttle, rudder, speed |
| SCOPE | the PPI radar |
| SHIP | hull, fuel, ordnance, materials, and the damage schematic |

The panel is **clickable** (playtest ruling 2026-08-22, and faithful to the
original — the 1988 manual says "click directly on speed scale to set target
speed"): the throttle bar IS the speed scale, and two rudder arrows under it
act while held and CENTRE UP on release, exactly like the keys they mirror.
The hit-test and the drawing share one geometry table (`HELM` in
instruments.js), so the paint and the click cannot disagree.

**At the controls of a craft, the whole panel is the craft's** (playtest
ruling 2026-08-24, superseding round two's ship-always helm): FLIGHT or
DRIVE on the left — the craft's compass, throttle, speed, fuel — the scope
centred on the hull you are flying, and MANTA/WALRUS on the right with hull,
altitude (or the magazine), the selected weapon's tally, and the bearing
home. The helm clicks drive the craft too; hand back the controls (`T`) and
the panel is the ship's again.

The throttle scale runs **-25..100**: the leftmost fifth is the ship's
astern gear (the original's speed indicator gave its bottom quarter to
reverse), with a zero notch, ahead filling right and astern filling left in
red. A craft's helm clamps the astern zone away — a Manta has no reverse.

Under the viewport sits the **location status line** (manual coverage
review, item 10): position in km, bearing, and the NAMED island the subject
stands off — island names are derived in `shared/names.js` from each
island's own seed, never stored, so every client and the server agree
without a byte of state. The names also title the island board and the
quartermaster's rows, and give the **signals log** its places: `I` (or the
MSG button) opens the last sixteen reports with their ages — the original's
Messaging Computer, because a toast is history you missed and a log is
history you can read. `O` flips the **rear view** in chase and gunsight;
`5`–`8` select the Nth hull that is out, directly; and two `ESC` presses
inside three seconds **strike the colours** — the original's SURRENDER,
scuttling the ship through an ordinary command so victory resolves by its
ordinary rules.

Above the horizon sit the **camera tabs** (ruling 2026-08-24): HELM /
WEAPON / BIRDSEYE / **CHART**, top centre, clickable, the lit one is where
you are — the original's interface always said which console you were at.
`C` still cycles the three ways of seeing; the chart steps aside first.

**The CHART** (second source review — the original's map screen): named
islands with owner colours, role letters, runway and depot marks; your
hulls solid, contacts hollow, ghosts crossed out; the course diamond; drag
pans, the wheel zooms, FIT reframes. A click means what it means on the
world — open water is PROG (the course lays and the **A chip** lights; the
chip or CLEAR COURSE puts it out), an island is its board, a friendly
runway with a Manta named is an approach. The NETWORK button overlays the **link graph** — every pair of your islands
close enough to supply one another, with a warning ring around any that has
fallen off the chain. Everything comes from the fog-filtered view: the chart can never
know more than the seat does.

Three more 1988 constants from the same review: the **SCORE is always on
screen** (bottom right, above the panel — it was in every original
screenshot, and the point cap is an end condition), **PAUSE is a lit
button** beside the `?`, and the hulls that are out stand as **unit chips**
bottom left — M0, W1, a down-arrow when parked on a runway — one click to
name a hull, the same naming NEXT and `5`–`8` do. In WEAPON view the weapon selector moves to the bottom centre at
full size: the selector is the console there, which is also where the
carrier's laser stops being a secret — LASER and its rounds stand under the
crosshair, `F` fires it.

Flanking the screen, the **1988 icon columns**: ship and logistics on the
left (STOP, FLARES, SUPPLY, DEPOT, DAMAGE, CAMERA, SOUND), air and ground ops
on the right (MANTA, WALRUS, NEXT, PILOT, RECALL, FIRE, WEAPON, POD, VIRUS).
Each button carries the key it mirrors and DISPATCHES that key, so the two
input paths cannot drift — whatever `F` does, the button labelled F does.
Every button grows a **tooltip** after a deliberate 600 ms hover: the label
names it, the tooltip explains it. Between FIRE and POD sits the **weapon
selector** — one button per weapon the selected hull carries, radio-style,
with the live round count on each; `V` still cycles for the keyboard hand.

Under the MANTA launch button rides the **LOADOUT cycler** (ruled
2026-08-25): FULL / SCOUT / BOMBER / INTCPT — what the deck arms every next
launch with, and what the ordnance store pays for. A scout carries no bombs
and costs the store nothing for bombs it will never drop; presets are data
(`weapons.json mantaPresets`), the fitting screen's faithful-light middle.
And the retro sea grid is **amber** now — the instrument ink over the blue
sea, as every Spectrum screenshot draws it.

The buttons are **context-enabled** (ruling 2026-08-24): a button whose
moment has not come is visible but plainly asleep — PILOT sleeps until NEXT
has named a hull, POD and VIRUS until that hull is a Walrus, CLIMB and DIVE
until you are flying a Manta, LAUNCH until something of that kind is stowed.
And NEXT **shows** you what it named: a spinning ring-and-pointer marker
rides the selected hull (hidden while piloting, when the camera itself is
the answer). The legend behind `?` opens screen-centre, where it can be
read.

The diagnostic strip hides behind a **DBG** button upper-left, like the key
list behind `?` — the instruments are for playing, the strip is for
debugging. While it is hidden, status feedback (a refused command, "too far
from the node") surfaces as a transient toast above the panel instead of
vanishing into a closed panel.

The camera has three stops on `C`: the chase view, the **gunsight** — first
person from the mount, crosshair centred, the carrier's eye out past the bow
spike because from anywhere on the hull the ship's own bow towers through the
picture — and the strategic map.

The compass is **heading-up**, and the sine is *subtracted*: engine bearings grow
counter-clockwise from +X, and counter-clockwise on a screen is to the left, so
adding it mirrors the rose. It looked plausible until you turned.

`client/render/radar.js` is a proper PPI scope with its own range control
(`[` and `]`). When you widen the scope past what the ship can actually detect
it draws a ring at the real radar limit, so an empty sweep at long range reads
as "nothing detected there" rather than "nothing there". Remembered contacts —
the chart's ghosts — draw as faint hollow marks, deliberately unlike the solid
dots of live contacts: a scope that drew a memory like a sighting would be
lying about how much it knows.

`client/render/damageboard.js` is the seven-section schematic: a 3D wireframe of
the ship with each section shaded by health, and a click cycling that section's
repair priority between High, Medium and Low.

## The console

Six overlays with six keys became **one overlay with a tab strip** (ruled
2026-08-26, Q5b): SQUADRON, STORES, DAMAGE, ISLAND, CHART, SIGNALS. One thing
to open, one place to look, and a panel count that stops growing every time a
screen is added.

The panels themselves were not rewritten. Each still owns its element, its
`.open` class and its own toggle; `#console` only decides which one is open at
a time, routing every change through the panel's own toggle so the panel's
internal `open` flag can never drift from the class on its element. That is
also why every panel module and every probe reads exactly as it did before.

Three details that are the design rather than the plumbing:

- **The keys still work and still mean what they meant.** `J` shows the
  squadron tab, `Q` stores, `Z` damage, `I` signals. They are now a RADIO
  rather than six toggles, so pressing a key twice closes the console instead
  of returning it to where it was - which is a behaviour change the smoke gate
  had encoded and had to be told about.
- **The chart keeps the whole screen.** It is a full-screen map and always
  was; on its tab the console gives up its box and keeps only the tab strip.
  Folding a map into a 620px column would have obeyed the letter of the ruling
  and lost the thing the ruling was for.
- **The island tab needs a subject**, so it is dimmed until an island has been
  chosen off the sea or the chart. Closing it only hides it - the board
  remembers which island it was showing, because the console closes every tab
  before opening one and a close that forgets would wipe the subject on the
  way to displaying it.

## Panels

`client/panels/` holds the screens that are lists rather than instruments:
`damage.js`, `island.js`, `lobby.js` (the war room), `squadron.js` (the Manta
and Walrus consoles — see below), `start.js` (the game-start
menu — map, islands, opponents, caps, style, language), `stores.js` (the
quartermaster: island stocks, the depot, the production bias, and the
UPGRADES refit rows — click one to lay the ship's speed, point-defence or
radar refit down at the first factory island that can build it, with
FITTED / BUILDING / needs-plant / cost as its states), and `warover.js` — the
full-screen result when the war ends: who won, how, the scoreboard the fog hid,
the islands, the war's own running time, and the choices: on LAN, **BACK TO THE
WAR ROOM** (the table fights again on the same join code), then RETURN TO PORT
and KEEP WATCHING (the world winds down behind it; it does not freeze). It
shows once per war, on the tick the phase flips.

Rows are **built once and updated in place**. Rebuilding them every frame
replaced elements under the pointer, so a click landed on a node that had
already been discarded and nothing happened — twice, in two different panels,
before the rule was written down.

### The squadron console

`squadron.js`, on `J` (ruled 2026-08-25, from the 1988 screenshots in
docs/10). The original gave each craft type a console; we had the mechanics
and none of the console. Two kinds, a numbered 1–4 selector whose border
says the hull's state — solid aboard, dashed away, faded destroyed — and
three pages:

- **BOARD** — every hull, what it is doing, and a bar that shows the deck
  clock while one is running and fuel the rest of the time.
- **OUTFIT** — the fitting screen. Stores down the left with `+`/`−` per
  station; the craft down the right with its budget, its hardpoints, repair
  state and fuel. A Walrus also gets its capture devices and the type of pod
  in the rack.
- **DECK** — LAUNCH, ABORT and RECALL, each lit only when it applies, over
  the status and its progress bar.

The console never sets a state: every change goes out as a command and comes
back in a view, so what it draws is always what the reducer did.

### The gunnery console

In WEAPON view the right-hand instrument box stops being the ship's
condition and becomes the gun's (docs/10 gap 5, 2026-08-26): an orientation
dial with the hull in plan bow-up and the gun line swinging round it, a
**TEMP** gauge against the weapon's own heat ceiling, and two lines of plain
words — `LASER OPERATIVE` / `MOUNT OPERATIVE` — because a mount that has been
shot away should say so rather than simply never firing.

The dial reads the **designated target** when there is one and the boresight
otherwise. Our laser does not traverse mechanically, so that is what "where
the gun is pointing" honestly means; there is no slew D-pad because there is
no slew.

### The SCREEN page

The fourth page of the squadron console, and the ship's rather than a
craft's — so it hides the craft rows rather than implying there is a Manta 3
screen. Four patterns (RING / AHEAD / ASTERN / FLANKS), three spreads
(TIGHT / NORMAL / WIDE), the counts out / aboard / lost, and a plan drawn to
the chosen spread so the picture *is* the setting. The screen can be moved
while it is out; that is the manoeuvre.

### RESOURCES, on the chart

A second reading beside NETWORK: the archipelago by role — yours against
theirs — the neutral count, the depot by name, and the sum of what your own
islands hold. Drawn clear of both action columns and below the top bar,
because a reading under a row of buttons is a reading nobody reads.

### PROG and LAY, on the chart

The 1988 map's own pair. While **PROG** is lit a tap on the chart adds a
numbered leg — dashed while it is being laid, solid once it is sailed — and
**LAY COURSE** sends it to whatever is selected: a Manta, a Walrus, or the
ship when nothing is. **CLEAR** throws away a course being laid first, and
only then cancels the standing one.

## The shop window

Behind the start menu (a plain visit to `/`) **and behind the LAN war room**
(ruling 2026-08-23) plays a **diorama**: a staged island assault built from
the game's own builders — the same carrier, Manta, Walrus, turret and shot
meshes the war renders, over a real `engine/heightmap.js` island — so the
splash can never drift from what the game looks like.
`client/render/diorama.js`; both doors share the `#start-panel` root, so one
keeper (`openShowcase`/`closeShowcase` in main.js) serves both. The menu
thins to a scrim over it; the camera orbits low and close; tracers loop
between the battery and the ship.

Over it stands the **title card** — the game's name, letterspaced, above the
scrim and never in the way of a click. The solo menu's own small header
steps aside so the name is not said twice; in the war room the card yields
instead, because the roster is tall and its header already names the table
and carries the join code. Under it plays the **ambience** (ruling
2026-08-23): distant surf — looped noise through a lowpass with a slow
swell — and far-off guns, synthesised in `sound.js` like every other sound,
started on the first gesture because browsers allow it no earlier, stopped
with the diorama.

The menu's **look row previews live**: flipping it restyles the page colours
and restarts the diorama in the chosen style — unless the URL already
dictated a style, in which case the URL wins at BEGIN and a preview would be
a lie, so the hook is not wired.

Three rules keep it harmless: it owns its **own canvas and renderer** (a
canvas hands out its WebGL context once, and the war's `#view` needs its
own), it is torn down whole — canvas, renderer, RAF, hook — before the war's
renderer starts, and a splash that throws is caught and simply skipped: it
must never cost anyone the menu. It follows the page's style (`?style=`,
default retro) and a fixed modest cost below the war's own tiers, so the
menu never stutters on an integrated GPU. Probe: `splash_shot` (pixel
variance, the cast count, and that nothing survives BEGIN).

## Models

Low-poly on purpose — the retro ruling — but recognisable at a glance
(playtest ruling 2026-08-22): the carrier's island carries a bridge with a
window band, a mast with a radar bar, and a runway stripe; the Manta is a
delta with a proud fuselage, canopy, twin canted fins and a nozzle; the
Walrus has a sloped glacis, a turret with a barrel, and wheel drums on each
flank; the lighter is a barge — raked bow, gunwales, an open hold with
crates, a wheelhouse with windows and a stub crane. Every hull still points
down +x so one heading-to-yaw rule serves them all.

## Touch (basic pass — ruling 2026-08-23)

The mouse-first bridge is mostly touch-first already: every column button,
the helm's throttle scale and held rudder arrows, the weapon selector and
the panels answer pointer events, which fingers send too. The basic pass
added what fingers need on top: `touch-action` locked so the browser never
scrolls or pinches the bridge (the columns keep `pan-y` — they scroll on
short screens); bigger targets on coarse pointers; **held CLIMB/DIVE
buttons** under TAKE CONTROLS, because a phone has no arrow keys; and
`pointercancel` treated as release everywhere something is held.

**Portrait is refused during a war** (hard overlay, owner ruling): the
instrument strip plus two icon columns cannot share 400 px of width — the
rotate card stands until the device turns. The menu and the war room stay
usable in portrait.

Two findings the phone gave back, worth keeping: a centered flex column
that overflows scrolls in NEITHER direction (the columns centre with auto
margins now), and the window-level sea-click handler took every BUTTON tap
as a click on the water behind it — a desktop bug all along, caught by the
first emulated phone; clicks now only reach the sea from the view canvas.

**Still owed to a real device** (docs/08 §B): the feel of the targets, the
instrument strip's fixed 196 px (the SHIP panel's labels overprint their
values at phone width), tooltips (hover does not exist under a finger), and
camera drag / pinch scope range. Probe: `touch_controls` (emulated Pixel 7,
both orientations).

## Sound

`client/sound.js` synthesises everything with oscillators and envelopes. No
audio files: it is what the original machine did, it keeps the repo a repo, and
a sound becomes a few numbers you can tune by reading.

Voices are keyed by **engine event code**, and the event list on a view is
already fog-filtered — so you hear your own hulls fire and your own ship take a
hit, and you do not hear a battle over the horizon.

The exception is the missile-lock warning, which is a standing condition rather
than an event, and is the whole argument for having sound: a warning you can
*hear* is one you can act on while you are busy flying. It nearly leaked every
missile in the war, because the first version asked "is this a guided round
aimed at a carrier" without asking *whose*.

The audio context is created on the first key or click, because browsers refuse
to make noise before then.

## Keys

| | |
|---|---|
| `W` `S` `X` | throttle up / down / stop |
| `A` `D` | rudder (arrows too) |
| `↑` `↓` | climb / dive when flying |
| `1` `2` | launch a Manta / a Walrus |
| `N` `R` `T` | cycle selection / recall / take control |
| `F` `V` | fire / cycle weapon |
| `E` | flares |
| `P` `B` | deploy the ACCB pod / the virus bomb |
| `Z` | the console at the damage board |
| `[` `]` | scope range |
| `M` `K` `L` | sound / nominate depot / supply run |
| `Q` | the console at the quartermaster: island stocks, depot, bias |
| `J` | the console at the squadron: the board, the fitting screen, the deck |
| `I` | the console at signals |

The in-game list behind `?` names all four of those now. Until 2026-08-27 it
mentioned only `Z`, so the squadron console and the quartermaster — two of the
largest screens in the game — were reachable only by a player who had read
this file.
| `U` | escort: the selected unit takes station on the carrier |
| click sea, nothing selected | lay a course - the ship sails there itself |
| `C` | camera: chase / gunsight / map |
| `,` `.` `Space` | propose slower / faster / pause |
| `G` | graphics level |
| `H` / `?` | the key list, hidden until asked (playtest ruling) |
| `Tab` | chat |

## Language

`client/i18n.js`, English and Norwegian from day one, catalogues in
`data/i18n/`. They are deliberately **not** part of the hashed ruleset: they
contain non-ASCII text and the canonical state walk rejects that on purpose.
Language is presentation and cannot move a hash — a Norwegian player and an
English one are playing the same war down to the byte.

A missing key falls back to English and then to the key itself, so a gap
degrades to readable rather than blank. The test asserts both catalogues have
identical key sets, which is what actually keeps them in step.
