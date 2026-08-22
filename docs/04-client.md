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

`client/graphics.js` is the separate axis: a quality level, cycled with `G`, for
machines that cannot carry the full draw.

## The panel

`client/render/instruments.js` draws the 1988 console: three bezelled
instruments across a 196-pixel strip.

| Instrument | Shows |
|---|---|
| HELM | heading compass, throttle, rudder, speed |
| SCOPE | the PPI radar |
| SHIP | hull, fuel, ordnance, materials, and the damage schematic |

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
menu — map, islands, opponents, caps, style, language), and `warover.js` — the
full-screen result when the war ends: who won, how, the scoreboard the fog hid,
the islands, the war's own running time, and the choices: on LAN, **BACK TO THE
WAR ROOM** (the table fights again on the same join code), then RETURN TO PORT
and KEEP WATCHING (the world winds down behind it; it does not freeze). It
shows once per war, on the tick the phase flips.

Rows are **built once and updated in place**. Rebuilding them every frame
replaced elements under the pointer, so a click landed on a node that had
already been discarded and nothing happened — twice, in two different panels,
before the rule was written down.

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
