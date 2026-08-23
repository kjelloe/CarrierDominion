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
