# 08 — Ports plan: the Luau twin, and the true mobile Low tier

Planning only (ruling 2026-08-23): neither is being built yet. This is what
each needs, what it costs, and what must stay true in the meantime, so a
plan can be made after the first human-coherent version passes playtesting.

## A. The Luau / Roblox twin (ruling D3, standing since day one)

### Why it stays cheap

The engine has been written in the Lua-portable subset from the first commit:
no `class`/`this`, no `Map`/`Set`, no exceptions, no async, no `null` in
state, plain functions over plain objects and arrays, acyclic imports,
integer-only arithmetic with every product inside 2^53 (Luau numbers are IEEE
doubles, same as JS). The port of `engine/` + `shared/` is therefore a
**transcription, not a rewrite**: syntax substitution plus a handful of
mechanical patterns.

### What must be transcribed

| Layer | Modules | Notes |
|---|---|---|
| `shared/` | fixed, prng, trig, trig_table, noise, statehash, view, speeds, options | trig_table is generated data — regenerate or copy the numbers verbatim |
| `engine/` | ~34 modules, reducer down to contacts | mechanical; the tick order comment IS the spec |
| pins | M0-A fixture + golden world hash | the twin must reproduce both, byte for byte — that is the whole acceptance test |

### The mechanical translation rules

- `const f = (a) => …` / `function f()` → `local function f()`; module
  exports → returned table; imports → `require`.
- `a.length` → `#a`; 0-based loops → 1-based with care at every index — the
  single largest source of transcription bugs; port the *helpers* first
  (`fixed.js` names most index math already).
- `Math.floor` → `math.floor`; `%` on negatives differs — `floorMod` exists
  for exactly this reason; audit every bare `%`.
- Bit ops: statehash's FNV limbs and the BAM wraps use `& 0xffff` etc. —
  Luau has `bit32`, capped at 32 bits, which is why the hash was built in
  16-bit limbs from day one.
- String handling in statehash (char codes) → `string.byte`; the canonical
  walk's key sort must match JS sort order (plain ASCII keys — it does).

### What does NOT port

`server/` (Roblox has its own networking) and `client/` (its own renderer).
The Roblox shape: the engine runs on the Roblox **server**; RemoteEvents
carry commands up and fog-filtered views down — the same transport contract
as `client/transport.js`, so the doctrine ("the client never sees state")
survives intact. A Roblox client renders views with Parts/Meshes; the
instrument panel becomes SurfaceGuis.

### Acceptance and effort

1. Transcribe `shared/fixed` + `prng` + `trig`; port their tests (node tests
   read as specs). ~1 day.
2. Transcribe the engine module by module, running the M0-A fixture after
   each — the fixture localises a transcription slip to the tick it moves.
   ~1–2 weeks of methodical work.
3. Golden world hash equal ⇒ worldgen is right. M0-A equal ⇒ the war is.
4. Roblox transport + minimal renderer: separate project, sized after 1–3.

**Standing rule until then:** every engine slice keeps the subset. The cost
of the twin is a function of discipline already paid; do not start paying it
again.

## B. The true mobile Low tier (docs/07 §4)

### What Low already is

No shadows, single-draw sea, no antialias, pixel ratio 1, 12 km draw
distance, 40-vertex terrain grid. That runs on weak desktops; a PHONE needs
the items below.

### The work list

1. **Touch controls** — the blocker, and an interface ruling of its own:
   - the icon columns and clickable helm already cover most actions (they
     were built mouse-first, which is touch-first);
   - missing: throttle/rudder without keys (the helm scale and arrows work,
     but need bigger hit targets), pitch for a flown Manta (on-screen
     up/down beside the sight), camera drag, pinch for scope range;
   - the panel's 196 px strip needs a scale factor on small screens.
2. **Renderer budget**: `powerPreference: 'low-power'`; resolution scaling
   below DPR 1 on small screens; merge the island meshes into one draw;
   cap the ocean grid's line count by distance; halve the draw distance.
3. **Layout**: HUD/panels at phone widths — the instruments stack, the
   columns collapse into a drawer.
4. **Networking**: ws already fine on mobile; solo mode carries the engine
   at 20 Hz comfortably on any recent phone (integer math, no allocation in
   the hot path).
5. **Verification**: a probe profile at 390×844, plus a real-device pass —
   SwiftShader says nothing about phone GPUs.

### Order

Touch ruling → layout → renderer budget → device pass. Nothing here blocks
or is blocked by the Luau twin; they share only the discipline that the
engine stays out of it entirely.
