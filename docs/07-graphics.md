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

**Landed checks** (`debugging/probes/weather.mjs`): a full squall must rain, a
clear noon must not; the ship must HAVE a surface that can get wet (an empty
wettables list would pass a naive "is it wet" check by doing nothing); a
soaked deck's roughness must fall below 0.4 and a dry one stay above 0.7; and
a gale must raise spray. Verified by disabling the rain threshold and watching
all four name themselves.

## 4. Low (deferred) — the real mobile pass

When it is time: `powerPreference: 'low-power'`, resolution scaling below
devicePixelRatio 1 on small screens, no shadows (already), a static
single-draw sea (already), merged island geometry into one draw call, the
grid sea capped by distance, and touch controls — which are an interface
question and therefore a separate ruling.

## 5. How tiers are chosen

Unchanged: auto-detected from the GPU string (`client/diagnostics.js`),
overridable with `?graphics=` or the `G` key, remembered in localStorage.
`suggestGraphicsLevel` already maps RTX-class and Apple-M-class renderers to
`high`, Iris/Xe to `medium`, and UHD/SwiftShader to `low`.
