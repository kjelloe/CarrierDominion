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
The HELM box drives the ship even while a unit is being flown — it is the
ship's helm. The hit-test and the drawing share one geometry table (`HELM` in
instruments.js), so the paint and the click cannot disagree.

Flanking the screen, the **1988 icon columns**: ship and logistics on the
left (STOP, FLARES, SUPPLY, DEPOT, DAMAGE, CAMERA, SOUND), air and ground ops
on the right (MANTA, WALRUS, NEXT, PILOT, RECALL, FIRE, WEAPON, POD, VIRUS).
Each button carries the key it mirrors and DISPATCHES that key, so the two
input paths cannot drift — whatever `F` does, the button labelled F does.
Every button grows a **tooltip** after a deliberate 600 ms hover: the label
names it, the tooltip explains it. Between FIRE and POD sits the **weapon
selector** — one button per weapon the selected hull carries, radio-style,
with the live round count on each; `V` still cycles for the keyboard hand.

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

## Panels

`client/panels/` holds the screens that are lists rather than instruments:
`damage.js`, `island.js`, `lobby.js` (the war room), `start.js` (the game-start
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
| `Z` | damage board |
| `[` `]` | scope range |
| `M` `K` `L` | sound / nominate depot / supply run |
| `Q` | the quartermaster: island stocks, the depot, production bias |
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
