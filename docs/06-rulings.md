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

## Standing constraints that follow from the rulings

- Style is data; nothing cosmetic may touch the simulation — two players on
  different styles see the same state hash (from #13).
- Nothing is conjured, anywhere: goods have a location, and every issue —
  fuel, rounds, payloads, rebuilt hulls — is a withdrawal from a store that
  something filled (from #3 and #17).
- Nothing may hard-code two teams, and a rule that only matters at three
  teams still has to be right (from #9 — the virus `virusVictim` rule is the
  worked example).
- After the war ends, **nothing new is decided** — enforced in the reducer,
  not just described.
