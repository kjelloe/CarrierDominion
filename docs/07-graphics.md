# 07 — Graphics tiers

Three named tiers with real hardware targets, for **terrain, sea, models and
lighting only** (owner ruling 2026-08-22). Never the interface — the bezelled
instruments are the game's 1988 identity and render identically on a phone and
a 5070 — and never the simulation: presets are pure client data, and a player
on Low and a player on High are in the same war with the same state hash.

| Tier | Target | Status |
|---|---|---|
| **Low** | mobile and integrated GPUs | placeholder today; the real mobile pass is **deferred** (see §4) |
| **Medium** | what we have now | the reference look — pinned, must not drift |
| **High** | RTX 4070 / RTX 5070 class desktops | being built, in phases (§2, §3) |

## 1. The two axes, and the contract between them

**Style** (`client/styles.js`) is art direction — retro / modern / hybrid —
and an owner ruling (#13): retro is the game's look. **Tier**
(`client/graphics.js`) is fidelity. The contract:

- A tier never changes the art. High-tier retro is *sharper 1988* — finer
  terrain, better shadows, full pixel ratio — with the hard horizon, the
  banded palette, the grid sea and the flat shading intact. The physical sky
  and mirror water of §3 apply to the `modern` and `hybrid` styles only.
- A style never changes the cost class. Retro at Low must run on the phone.
- Neither ever touches `engine/` or `shared/`. `client_pure.test.js` asserts
  every preset is complete and ordered by cost; the state hash asserts the
  rest.

## 2. Phase 1 — landed with this spec

What a 4070 can be given without new dependencies:

| Knob | Low | Medium | High |
|---|---|---|---|
| terrain grid (verts/side per island) | 40 | 72 | 144 |
| ocean mesh segments | 1 | 64 | 256 |
| ocean shader (shader styles) | off | swell + ripple tint | + `oceanDetail`: analytic-normal ripple field, fresnel toward the sky, sun glint |
| shadows | off | 1024 PCF-soft | 4096 PCF-soft |
| pixel ratio cap | 1 | 1.5 | 2 |
| antialias | off | on | on |
| draw distance | 12 km | 20 km | 30 km |
| model detail (`modelDetail`, landed 2026-08-23) | off | off | on |

The **models pass**: at High every hull carries its working clutter —
carrier catwalks, lifeboats, point-defence mounts, stern crane, radar dish
and deck lights; Manta intakes, underwing rails with rounds, nose probe;
Walrus mudguards, whip antenna, hatch, spade; lighter's second crate tier,
bollards, stack, fenders; turret sandbag rings and the battery's tracking
dish. In **every style**, retro included — sharper 1988 is still 1988: same
silhouettes, same materials, flat shading intact. The `graphics_shots` probe
counts the carrier's parts at Medium vs High and asserts retro High equals
modern High.

The `oceanDetail` water is our own shader, not an addon: the vertex
displacement (the swell) is **identical to Medium** — only the fragment gains
a normal field computed analytically from finer wave octaves, a fresnel term
that leans the far water toward the style's sky colour, and a specular glint
down the scene's fixed sun direction. Medium's pixels must not change; that
is checked by eye against `debugging/shots/graphics-*.png` (the
`graphics_shots` probe).

## 3. Phase 2 — the full High water and sky (landed 2026-08-23)

Built to the look of the reference scene in
`../llm-test-bench/examples/suntest/qwen38/` (SPEC.md there is the debugging
diary; these are its lessons translated to OUR constraints).

**As built:** `Sky.js` and `Water.js` (r162, verbatim + provenance header)
live in `client/vendor/`; the water normals are generated
(`client/render/waternormals.js` — 26 integer-frequency sines, max slope
0.55, fixed seed); `style.physicalSky` / `style.mirrorWater` are set by
modern AND hybrid (the remaster's charter is "modern sky and sea"), never
retro; the tier gate is `preset.physicalEffects`, High only. The sky renders
through PMREM into `scene.environment` exactly once per scene build (the sun
is fixed), ACES runs at a fixed exposure 0.32 (the ~49° sun's point on the
lesson-3 curve), and all three suns — ocean glint, mirror water, sky — share
one exported `SUN_DIRECTION`. The `graphics_shots` probe asserts the pixel
checks machine-checkably; one measurement lesson of our own joined the list
below as #7.

**Our constraints, which changed the plan:**

- **No CDN at runtime.** Three.js is vendored (r162); the `Sky` and `Water`
  addons must be vendored beside it (`client/vendor/`), not import-mapped
  from jsDelivr. They are plain ESM files importing `three` — the importmap
  resolves that to our vendored build.
- **No external textures.** The reference scene's `waternormals.jpg` is not
  even on jsDelivr; we go straight to its fallback: a **tileable procedural
  normal map** — a sum of ~26 sines with *integer* frequencies over [0,1)²
  (integer frequencies tile perfectly), slopes normalised to max ≈ 0.55,
  standard tangent-space encoding. Deterministic from a fixed seed, so every
  client generates the same texture.
- **Retro is exempt.** The Preetham sky and mirror water go behind
  `style.physicalSky` / `style.mirrorWater` flags that only `modern` (and
  maybe `hybrid`) set — at High tier only.

**The lessons worth importing verbatim** (each cost the reference scene real
debugging time):

1. **r160+ `Water` is mirror-based**: `onBeforeRender` renders the whole
   scene from a reflected camera into a 512² target. Reflections are free,
   but it is a second full scene render — High-tier only, and our scene is a
   32 km archipelago, so the reflection camera's far plane needs the same
   draw-distance discipline as the main one.
2. **`scene.fog` must exist before `new Water(...)`** — the `fog: true`
   option is captured at construction. Our retro style runs fogless; the
   Water path only exists on styles with fog, so construct accordingly.
3. **ACES exposure must DECREASE as the sun rises.** The counterintuitive
   one: high exposure desaturates the day sky toward white; ~0.5 at the
   horizon, ~0.3 at high sun kept it blue. Raising `rayleigh` makes it
   *brighter*, not bluer — exposure is the lever, keep rayleigh at 2.0.
   (We have a fixed sun today; if the sun ever moves, this curve comes too.)
4. **PMREM (sky-as-IBL) is expensive** — regenerate behind a dirty flag at
   most once per frame, and dispose the old render target. With a fixed sun
   we can go further: generate once at scene build.
5. **`mergeVertices` before `computeVertexNormals`** for smooth shading on
   non-indexed geometry — relevant if High-tier models ever get the
   displaced-icosahedron treatment for rocks/props.
6. Their headless verification approach is ours already (probes +
   pixel-level assertions); their specific checks worth stealing: zenith
   blueness (mean B−R over a top patch) and water variance (a flat sea means
   a broken pipeline).
7. *(Ours, found landing this.)* **The chase camera never sees the zenith.**
   Its frame top is the horizon band, which a Preetham sky keeps hazy-white
   by design — measured there, a perfectly blue sky reads B−R ≈ 5 and fails.
   The probe points the camera straight up for the zenith grab, then lets
   the game's render loop restore the view before the screenshot.

**Landed checks** (`debugging/probes/graphics_shots.mjs`): modern+High has a
`MirrorShader` sea, zenith B−R ≥ +20 looking up, water variance ≥ 2; retro
at High has NO MirrorShader and a night zenith (B−R < 20). Plus the phase-1
clause: no tier may change a style's ocean material class. Models pass
(higher-detail hulls at High) still rides after, as its own slice.

## 3b. Phase 3 — weather and the day (landed 2026-08-26)

Owner's ask: a more lifelike ocean with wind-aligned waves; weather that
tells a story, from a few near-white clouds through grey overcast to a
grey-dark-blue storm with lightning; a sun that crosses and casts shadows,
with **no complete darkness**; High tier / modern style only.

**The sky is a pure function of the war.** `shared/weather.js` answers
`weatherAt(seed, tick)` — sun bearing and elevation, day, wind bearing and
strength, cloud, storm, and this tick's lightning — in integers, per-mil, out
of nothing but the seed and the tick. It is stored **nowhere**. That single
property buys everything else:

- every client in a LAN game and every replay of every war sees the same sky
  at the same moment, with not one byte crossing the wire;
- the state hash cannot carry the weather, so a squall can never desync a
  war or move a golden pin;
- and because it is cheap and pure, the **engine** may read it too, which is
  what makes weather a rule rather than a screensaver.

It lives in the Luau-portable subset (docs/01) and `test/engine_subset.test.js`
enforces that, because the engine reads it.

A day is **30 minutes** at 1× (36,000 ticks); fronts run on a ~20-minute
period under a much slower swing, so a war has a *mood* that fronts move
through rather than a sequence of unrelated squalls. Time compression speeds
the sky up with everything else — it is the same clock.

**What is wired to the simulation: one thing.** Heavy weather is sea clutter
and rain in the beam, so it **shortens the radar picture**, floored by
`radarStormPermil` (700 — a set keeps 70% of its reach in the worst storm).
It shortens the picture; it does not blind you. Every sensor in the war goes
through `sensorReach()` in `engine/contacts.js`, the AI's `spotted()`
included, so the AI never sees further than the player through the same rain.

Everything else — colour, cloud, swell, lightning, exposure — is cosmetic and
gated on High + modern, exactly like phases 1 and 2.

**The renderer**, three files:

- `client/render/skystate.js` turns the integers into light: sun vector,
  light and fog colour, sun/hemi intensity, exposure, turbidity, fog reach.
  Phase 2's lesson 3 pays off here at last — exposure *decreases* as the sun
  rises, and now the sun actually moves, so the curve is real rather than
  collapsed to one number.
- `client/render/weathersky.js` draws the cloud deck and the near-field
  swell. The deck is a **sky shell**, not a plane: each fragment projects its
  view ray onto a virtual deck 2.2 km up and samples fBm noise there. A flat
  plane was the first attempt and it is wrong — from a chase camera the plane
  is past the far plane at every angle that matters. The swell is four
  Gerstner components (139/71/37/17 m), all aligned to the wind, on a 1500 m
  patch that rides under the eye and fades at its rim.
- `client/render/scene.js` applies it per frame, re-baking the PMREM
  environment only when the sun has actually moved (`ENV_REBAKE_COSINE`), and
  tints the mirror water — ripple scale and distortion with the wind, water
  colour and sun glitter with the sky.

**Lessons this phase, on top of §3's seven:**

8. **A flat cloud plane cannot work for a chase camera.** Project the view
   ray onto a virtual deck from a sky shell instead — and write the shader
   for an eye that may be *above* the deck too, or the strategic view gets a
   brown dome overhead.
9. **The horizon must agree with itself.** Sky, cloud, fog and sea all meet
   at the sea line; any one of them fading to nothing there opens a bright
   strip exactly where the eye rests. The cloud's horizon fade now ends in
   the *fog colour* rather than in transparency.
10. **A storm has no lit side.** Applying the sun's warmth first and the
    storm's grey second — at any sane weight — leaves a squall at dawn
    reading brown. The storm has to take the colour, and take it hard: the
    haze, the cloud's lit face, the water colour and the sun glitter all go
    grey-blue together, or the sea stays the warmest thing in the frame.
11. **Remove your own debug scaffolding before you measure.** A leftover
    experiment that replaced the cloud material before every measurement cost
    most of a debugging session chasing a shader that was fine.

**Landed checks** (`debugging/probes/weather.mjs`): five moods are found by
*condition* (not by hardcoded tick), photographed, and **measured** — the
average colour of a sky band and a sea band, read in the same JS turn as the
render (lesson 7). The storm sky must be darker than noon by ≥ 20 luma and
must not be warm; night must be much darker than day but must **never** fall
below a steerable floor; dawn must be warm; and all five must render
*different* skies, which is the assertion that would catch the whole weather
path being switched off.

## 3c. Phase 3b — a sea that is a spectrum, and cloud that has shape (2026-08-27)

Owner, after seeing it run: the ocean should look alive like the reference
scene, the cloud should look realistic, and the modern tier "had the same
uniform ocean waves". All three were fair.

**The sea was four waves, and now it is a spectrum.** The first swell ran four
Gerstner components all within a few degrees of the wind. That is corduroy:
parallel ridges of one size, marching. It is now twelve components, and the
part that matters is not the count but the **directional spread** — long swell
runs with the wind because it was raised somewhere else by a wind that has
been blowing a while, and short chop fans out to either side. So the spread
grows with frequency: the 210 m swell sits within ~7° of the wind, the 4.5 m
chop as much as 80° off it. Crossing wave trains are what make water look
alive rather than combed. Wavelengths are geometric and jittered so no two
share a factor, and amplitude follows wavelength^0.75 so the long waves carry
the shape and the short ones only texture it.

The reference scene reached the same conclusion from the other end — its
normal map is 26 waves in mixed directions. Ours is that idea in geometry.

Two more things the sea needed:

- **Ripple in the fragment.** At 256 segments across 1500 m the vertices are
  six metres apart, so everything shorter than a six-metre wave — which is all
  of the glitter — has to live in the normal, or the water between crests is a
  mirror-smooth facet that reads as plastic.
- **Whitecaps on the WAVE, not the ripple.** Keying foam to the perturbed
  normal made every centimetre of chop a breaking crest and turned a gale
  white — brighter than the same sea at noon. Real whitecaps are sparse, on
  the steep faces of the big waves only.

**Cloud was a smear, and now it has shape.** A four-octave value fBm at one
low frequency looks exactly like what it is: airbrushed blobs. Three changes,
which are the three things any convincing procedural cloud does — **domain
warping** (sampling the noise at a position displaced by other noise, which is
what turns blobs into curling, torn, wind-sheared forms and is much the
biggest of the three), more octaves at a frequency where they are visible, and
**light from a direction**: sampling density a short step toward the sun gives
the bright rim where the deck thins into the light, for one extra sample.

**Three defects found on the way, all of them ours:**

1. **The swell and the mirror sea had drifted apart.** The mirror was being
   tinted by the weather while the patch kept a hardcoded blue, so the seam
   where the patch fades out showed as a tone step in the middle of the
   picture. One `seaColourFor()` now feeds both. Anything that colours the sea
   has to colour all of it.
2. **The cloud shell was being reflected from the wrong place.** The mirror
   water renders the scene from a mirrored camera, and the shell RIDES THE EYE
   — so what it put on the water was not a reflection but a smear that moved
   with the ship, showing as pale mottled patches that grew with cover. It is
   excluded from that pass now, by wrapping `onBeforeRender` rather than
   editing the vendored file.
3. **Excluding it then made the storm sea brighter than noon**, because the
   water was left reflecting the bright Preetham dome — and at the grazing
   angles that fill most of the frame the reflection is ALL of the colour;
   `waterColor` has no say there whatsoever. The fix is to darken the dome
   itself in heavy weather via **rayleigh**, which lesson 3 already told us is
   the brightness lever. That is right anyway: the sky behind the cloud should
   be dark, not bright with dark cloud pasted over it.

**Lesson 12, and it is the one worth carrying:** *three.js interpolates
colours in LINEAR space.* Colour management converts every
`new THREE.Color(hex)` into the linear working space, and a bright warm colour
is far brighter there than its hex suggests — so a linear blend keeps its
warmth long after the weight "looks" nearly complete. A dawn peach lerped 94%
of the way to a cold slate still came out `#5a4e51`, a warm brown, which is
why a squall kept reading brown however hard the weight was pushed. **Three
rounds of raising the number by eye achieved nothing; printing the uniform
found it immediately.** The fix is a curve, not a bigger number —
`stormWeight()` raises storm to the 0.45 power, so 0.9 pulls at 0.95 and the
last few per cent, which are the ones that change the hue, actually arrive.

## 3d. Phase 3c — the weather you stand in (2026-08-29)

Owner reversed the Q2b "not now": rain, spray, a wet deck, sunbeams and a
more convincing sea. High tier + modern only, as ever, and every figure comes
from `shared/weather.js`.

**Rain** (`client/render/weatherfx.js`) is one instanced draw of 11,000
streaks in a **64 m box riding the eye** — small on purpose. The first attempt
used a 220 m cube and looked emptier than a light shower, because volume grows
as the cube of the span while the eye only ever sees the near few metres.
Beyond the box the fog and the grey sky do the work, which is what distance
does to real rain anyway. Every drop is placed in the vertex shader from a
per-drop seed and one `mod()` of the clock, so nothing is written back and
nothing is updated per frame. It slants with the same wind that raised the
sea — a vertical downpour beside a running swell is the tell that two systems
are not talking to each other — and it is the STORM's, not the cloud's: an
overcast that is not a squall stays dry, which is what makes the squall mean
something.

**A wet deck** needed a material change. Lambert has no specular term, so a
wet deck under it can only be a darker deck, which is the less convincing
half. Where the tier already pays for a physical sky there is a PMREM
environment map in the scene, so at High + modern the deck is a
`MeshStandardMaterial` whose roughness is pulled from 0.96 to 0.14 as it
soaks, and whose colour darkens by 40%. Both halves matter: darkening alone
reads as a cloud passing over, gloss alone reads as fresh paint. Wetness
follows the rain **up in about four seconds and back down over the better
part of a minute**, because a deck dries slower than a squall passes.

**Spray** is the same instancing trick, positioned at the bow rather than the
eye, and it needs the sea AND the ship: a stopped hull in a gale smokes a
little, a hull at speed on glass barely wets its paint, and the two together
throw water. A carrier at speed in a heavy sea with a dry bow looks like a
model on glass.

**Sunbeams** are screen-space, on one triangle drawn last, and this is a
deliberate trade. Real crepuscular rays want the scene rendered to a target
and radially blurred — an `EffectComposer`, two more render targets and a
rewrite of the render loop, which is a great deal of machinery and risk for
an effect that is mostly believed rather than examined. These sample nothing:
they draw wedges radiating from wherever the sun projects, and let cloud
cover, the sun's elevation and the storm decide the strength. They need a
**gap** in the cloud — a clear sky has nothing to shape them and the middle of
a squall has no sun reaching the water.

*The honest limitation, recorded because it will be noticed:* the shafts are
not occluded by islands or by the ship. A hull between you and the sun does
not cut them. Fixing that needs the depth buffer, and therefore the pass this
avoids.

**The sea got the one thing it was still missing: light THROUGH the wave.**
Subsurface scatter is what separates water from a shiny surface — on the far
side of a crest from the sun the light comes through and the wave glows from
inside, greener and brighter than any reflection. It needs a raised piece of
water, the sun roughly behind it and the eye roughly facing it, all at once,
which is exactly when a real swell lights up. Troughs darken with the same
term, so the sea stops being one tone with ripples drawn on it.

**Lessons 13 and 14:**

13. **A particle volume is a CUBE.** Doubling the box for "more coverage"
    divides the apparent density by eight. Shrink the box and let the fog own
    the distance.
14. **A raw `ShaderMaterial` does not get three.js fog for free.** Setting
    `fog: true` without declaring `fogColor` and friends makes
    `refreshFogUniforms` reach for a uniform that is not there — on every
    draw, as a page error per frame.

And one that is not a lesson so much as a scar: **backticks inside a template
literal end the template.** A comment reading "that `mod` is the whole
animation" turned the shader into a syntax error, and the browser reported it
as `Unexpected identifier 'mod'` — a JS error, in a file whose JS was fine.

**Reviewing the batch found four things it had left out**, and the first is
the one worth remembering:

1. **The reflection exclusion list still named only the cloud.** The mirror
   water renders the scene from a mirrored camera, so anything positioned at
   the main camera — or drawn in screen space — is nonsense from there. Phase
   3b had already learned this and excluded the cloud shell; phase 3c added
   three more eye-riding effects and did not add them to the list. The beams
   were the worst: a screen-space triangle with depth testing off and the last
   render order, painting over the whole reflection texture. **A hand-kept
   list of exclusions is only correct until the next feature**, so the probe
   now asserts the RULE — nothing that rides the eye may be drawn during the
   reflection pass, and everything must be visible again afterwards.
2. **The spray puffs were hard-edged rectangles.** The fragment shader read
   `gl_PointCoord`, which means nothing in a triangle shader, and then never
   used the value — so there was no soft falloff at all. The quad's own
   coordinates are what it needed.
3. **Four `THREE.Color` allocations per frame** in the update paths, hoisted
   to module constants. Not a leak; just garbage for the collector to walk
   during a render loop.
4. `ownX`/`ownZ` were used before being declared on `view3d`. Harmless in
   order of execution, and now initialised where every other field is.

**Landed checks** (`debugging/probes/weather.mjs`): nothing that rides the eye
reaches the water's reflection, and nothing is left hidden afterwards; a full
squall must rain, a clear noon must not; the ship must HAVE a surface that can get wet (an empty
wettables list would pass a naive "is it wet" check by doing nothing); a
soaked deck's roughness must fall below 0.4 and a dry one stay above 0.7; and
a gale must raise spray. Verified by disabling the rain threshold and watching
all four name themselves.

## 4. Low — the mobile pass (first slice, 2026-08-30)

The plan said: `powerPreference: 'low-power'`, resolution scaling below
devicePixelRatio 1 on small screens, no shadows (already), a static
single-draw sea (already), merged island geometry into one draw call, the
grid sea capped by distance, and touch controls.

**What was actually wrong was the LAYOUT, not the renderer.** The interface
grew a great deal in a week — a top bar of screens, a camera bar, a tier chip,
wrapping action columns, a 196px instrument panel — all designed on a desktop.
Measured on an 844×390 phone in landscape, it was a mess: the coarse-pointer
button sizing plus the wrapping added for desktop overflow fanned each column
into five or six, sprawled across the whole window, sitting on top of the
camera tabs and each other, with **eleven buttons entirely off screen** and
the panel taking **half the height**.

What landed:

- **A phone gets one column a side, and it SCROLLS.** Wrapping is a desktop
  answer; on a coarse pointer it sprawls. The honest trade is the same
  controls reachable by dragging, not a smaller unreadable desktop.
- **The panel is 124px below 520px of height**, down from 196 — 30–34% of the
  screen instead of ~50%. Its height is now ONE number: `--panel-h` in CSS,
  read back by `instruments.js`, where it had been written out as 196 in the
  JS and 216 in five CSS rules.
- **The helm's layout scales with it**, and so does the hit test — the same
  table feeds both, so a shrunken helm still answers the finger where it
  looks. At 124px the nominal rudder row sat 32 pixels below the bottom edge:
  drawn, and unreachable.
- **The columns start below the top row's REAL height** (`--bar-clear`,
  published by the client after layout). On a narrow phone that row wraps to
  two lines, and a hardcoded 56px put the columns underneath it.
- **`powerPreference: 'low-power'`** for every tier that is not paying for
  fidelity, and **resolution scaling to 0.75** below 480 CSS pixels on the
  short side. A phone at device ratio 3 asks for nine times the fragments on
  the hardware least able to pay.

**Merging island geometry is NOT indicated, and the plan was wrong to assume
it.** Measured: 79 draw calls at 8 islands, 82 at 32, and **57 at 64** — they
do not scale, because frustum culling means a bigger map shows proportionally
less of itself. Triangles go 21k → 30k. There is no draw-call problem to
solve, and doing the merge would have been optimising on a guess three weeks
old.

**What cannot be judged from here, and is not claimed:** frame rate. Headless
Chromium rasterises in software, which docs/07's own lesson says is not a
clock. Pausing the war barely moved the frame time (35ms → 46ms at 8 islands),
which rules the ENGINE out as the dominant cost but says nothing useful about
a real GPU. Real devices judge that — which is the standing ruling from
2026-08-23 and still the right one.

**Landed checks** (`debugging/probes/mobile.mjs`): at three landscape phone
sizes, nothing escapes the window, nothing is out of a finger's reach,
**nothing overlaps anything else**, the panel stays under 38% of the height,
and the rotate gate is down in landscape and up in portrait. The overlap check
is the important one — reach alone called the sprawling layout fine.

**Reviewing that slice found three more, all of them mine and two of them
ironic in a pass about making the game cheaper:**

- **`panelHeight()` called `getComputedStyle` five times a frame.** Reading
  computed style forces the browser to resolve layout; doing it from the draw
  path and the hit test, every frame, is precisely the cost this pass exists
  to remove. Cached, and cleared by the resize handler.
- **`syncBarHeight()` measured the top row every frame** with
  `getBoundingClientRect` — another layout flush. The row's height can only
  change when its contents do or when the window does, so it runs on those
  two events instead.
- **Rotating is not a reload.** The pixel ratio and the panel height are both
  chosen from the window's shape, and both were decided once at construction
  — so a phone turned from portrait to landscape kept the wrong ones for the
  rest of the session. `resize()` re-chooses them now, and the probe asserts
  it by shrinking and growing the window.

**And the menu had never been measured, only the war.** On a 390px-tall phone
the splash title card — 42px with 20px of letter-spacing — came down across
the first two option rows: "CARRIER DOMINION" written through "seed" and
"islands". Nothing was off screen and nothing was out of reach, so the
existing checks called it fine; **overlap** is what catches it, which is the
same lesson the sprawling columns taught a day earlier and which I had only
applied to the war screen. The card shrinks below 620px of height and stands
aside entirely below 460px, the menu tightens and scrolls, and the probe now
walks the menu as well as the bridge.

**The grid sea, capped by distance (2026-08-30).** The last renderer item from
the plan, and the one place the mobile plan was right about the renderer.

The 1988 grid was built over the whole ocean, so it grew with the square of
the map: 42,024 vertices at 8 islands, 168,920 at 32, **337,560 at 64** — a
megabyte of line geometry, and the largest single thing in the scene. The
shader has always faded it out between 2500 m and 8000 m, so at 64 islands
about three per cent of it was ever inside the fade; the rest was uploaded
once and then discarded a vertex at a time, every frame.

It is now **one patch, 16.8 km across, that slides along under the eye**:
**12,768 vertices whatever the island count** — a 3× cut at 8 islands and a
26× cut at 64. Two things make it work rather than merely make it smaller:

- **The patch moves in whole cells.** `Math.round(camera.x / step) * step`. A
  grid that slid smoothly with the camera would be nailed to the ship, and a
  grid nailed to the ship is the one thing this mesh must never be — its only
  job is to give the eye something stationary to measure motion against. In
  whole cells, every line stays on one world lattice: the patch is somewhere
  else, the grid is not.
- **`frustumCulled = false`.** A mesh centred on the camera cannot be culled
  against a bounding sphere computed for where it was built, or the sea blinks
  out. `debugging/probes/sea_grid.mjs` asserts both, plus the claim that
  matters most — 8 islands and 32 islands must build the *same* count, not
  merely fewer.

A map smaller than the patch (the menu diorama, at 6 km) still gets the whole
sea in one static mesh, because a patch would be bigger than the map it was
meant to save. And `resetWorld` rebuilds the held reference, for the same
reason the ocean's reflection hook has to be put back: a new war brings a new
grid, and the frame would otherwise go on sliding the one that left with the
old graph.

A caution for whoever writes the next check here: `offsetParent` is null for
ANY `position: fixed` element, visible or not, so both of the rotate-gate
assertions were vacuous until they were rewritten against computed display.

## 5. How tiers are chosen

Unchanged: auto-detected from the GPU string (`client/diagnostics.js`),
overridable with `?graphics=` or the `G` key, remembered in localStorage.
`suggestGraphicsLevel` already maps RTX-class and Apple-M-class renderers to
`high`, Iris/Xe to `medium`, and UHD/SwiftShader to `low`.
