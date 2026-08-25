---
name: engine-review
description: How to review the Carrier Dominion engine against its docs and rulings — the method and failure classes that found ten real issues before the first playtest. Use when asked to review, audit, or look for omissions/bugs/flaws.
---

# Reviewing the engine

The method that worked (2026-08-20, dev-log "The review, and what it found"):
read **every engine module end to end against the documents**, not a sample.
The docs make promises; the review's job is to find the ones the code does not
keep. Report first, ranked worst-first with `file:line`; fix only when asked —
findings usually come back with new rulings attached.

## The reading order

1. `engine/reducer.js` — the tick order and the command table. Check every
   claim in docs/01 against it.
2. Each system module against its docs/02 section: weapons, shots, damage,
   capture, virus, island, economy, supply, repair, targeting, flight, drive,
   turret, flare, score, victory.
3. `shared/view.js` — the fog filter, field by field, for BOTH directions:
   what leaks out, and what fails to arrive.
4. `server/` against docs/03. Then `data/*.json` against every number the
   docs quote.
5. `docs/06-rulings.md` last, as the checklist: is every ruling actually
   enforced, or merely described?

## The failure classes that were actually found here

Look for these shapes first — every one produced a real bug:

- **Id collision across entity lists.** Units, turrets and shots have separate
  id sequences that all start at zero. Any lookup keyed by `(kind, id)` that
  falls through to the wrong list homes on the wrong entity. Check every
  `find by id` for a complete kind switch.
- **Per-hull state cooled by per-selection rules.** State that lives on the
  hull (heat, cooldown) but is updated using the *selected* weapon's rules can
  be laundered by switching selection. Ask: whose rules update this field, and
  can the player change whose?
- **Event payload slot routing.** Events carry `(code, a, b, c)` and the fog
  filter routes by slot conventions. Every new event code must be checked
  against the routing rules in `shared/view.js` — codes that carry the team in
  `a` (scored, AI seat) were misrouted for weeks by the `b` convention. Also
  ask: which events are chart-level common knowledge, and is the list complete
  (capture, conversion, sinking, war over)?
- **Conjured goods.** Ruling #3: nothing is conjured. grep for assignments of
  the form `x.fuel = x.fuelCapacity`, `createArms(` outside initial state, and
  any `= 1` on a payload flag — each is a withdrawal that must name its store.
  A comment claiming "from the carrier's stores" is not a deduction.
- **Described but not enforced.** "Nothing new is decided after the war ends"
  was true only of the AI; every other step ran on. For each contract sentence
  in the docs, find the guard that enforces it or flag it.
- **The world that is not there.** Terrain existed for hulls but not for shots
  or flight — missiles flew through mountains and peaks out-topped cruise.
  Ask of every mover: what does it collide with, and what SHOULD it?
- **Conservation.** Any transfer that debits one side and caps the other
  destroys the difference. Check every cap for where the excess goes, and give
  the watchdog a tripwire for the invariant.
- **Classification by the wrong axis.** The kind/altitude rule ("a Manta is
  air even parked on the deck") had one module classifying by `z`. When a rule
  has a stated axis, grep for the other axis.
- **Edges the current config cannot reach.** Two-team wars cannot produce a
  third-team handover, so the virus rule was wrong invisibly. Ruling #9 says
  nothing may hard-code two teams — test the N>2 shape even though v1 ships 2.
- **Counters with no decrement.** `island.turrets` only ever rose; the sweep
  removed the gun from the world but not from the books, so shot-away slots
  never reopened and the chart lied. For every counter, find the code path
  that brings it DOWN — and note it may take a new CONSUMER of the counter
  (the patrol) to make the staleness visible.
- **Observers that assume presence from tick zero.** The watchdog's stall
  detector baselined `lastEventTick` at 0, so a RESUMED war read its first
  quiet moment as a 200,000-tick silence. Anything that measures elapsed
  anything must baseline on first sight, not on epoch.
- **One surface, many listeners.** A window-level pointerdown treated EVERY
  click as a click on the sea - buttons included - so tapping LAUNCH also
  laid a course to the water behind the button, silently, for weeks, on
  desktop too. For each global listener ask: which element is this really
  for, and does it check? (Found by the first emulated phone, 2026-08-23.)
- **Thresholds tuned on the small map.** Fixed tick budgets (watchdog stall
  windows, patrol gates, AI patience) were tuned when a crossing was 20k
  ticks; a 64-island ocean makes a legitimate crossing several times that.
  When the map scales, grep for every constant with 'TICKS' in its name and
  ask what it means at the new size.
- **Config the new option forgot.** A new lobby option must reach ALL of:
  OPTION_VALUES, the start menu's OPTIONS, applyLobbyOptions (or be
  explicitly server-side like observers), savedOptions on resume, and the
  replay fold. Check the whole chain, not the first link.

- **A predicate that reads bookkeeping the feature does not maintain.**
  `onNetwork()` asked `island.networkHops >= 0`, which is meaningless when
  topology is switched off — so every hand-owned island in a test read as
  "cut off". A predicate must answer from something true in BOTH modes:
  with the feature off it now asks only "does somebody own this".
- **Guard order inside a loop.** A new `continue` for "cut off from the
  chain" was placed ABOVE the existing "lose the island, lose the site"
  branch, so a build on rock that went neutral was skipped before it was
  cleared and sat there for the rest of the war. When adding a skip to a
  loop, read every branch it now jumps in front of.
- **A counter with an owner.** `island.turrets` means "the OWNER'S works",
  and `anythingBuilt()` reads it to decide whether a role is still
  changeable. Counting a neutral map feature into it froze every role
  choice on the board. Before incrementing a counter, ask whose question it
  answers.
- **Enum values that meet in one switch.** `FLIGHT_LANDING` was given 4,
  which is `DRIVE_BLOCKED`, and fleet.js compares flight and drive outcomes
  in one chain: every landing read as "blocked" and orbited forever.
- **A default that grabs the player's attention.** Auto-selecting the first
  afloat hull was harmless while nothing was afloat at war start; the home
  island put a supply lighter on the water at tick 1 and the same line
  turned click-to-sail into click-to-move-the-boat. When a start condition
  changes, re-read every "if nothing is chosen yet" default.

- **Priority that orders the ATTEMPTS but not the CLAIM.** Equipment was
  "tried last" but cost a third of a hull, so it was tried whenever a hull
  was unaffordable and ate every trickle - no airframe was ever rebuilt
  again. When a cheap thing and a dear thing draw on one pool, the cheap
  one must be blocked while the dear one waits, not merely sequenced after
  it.
- **A shopping list written before the shop had everything.** The AI called
  its supply boat for fuel and ordnance because those were the only stores
  that existed when the list was written; chassis arrived later and nothing
  added them, so a carrier with a full bunker and no aircraft sat still
  while parts piled up at its own depot. When a new store is added, grep
  every place that decides "do I need supplies".
- **A precondition that a new default made universally true.** planFor's
  fortress rule keyed off "the team holds a plant", which was rare until
  the home island handed every team one at tick zero - then it fired on
  every team's second island and starved them of mines. After changing a
  start condition, grep for the predicates that were rare and are now
  always true.

## Verifying and landing

- **Measure the FLOW, not the feature.** Seed 900913's stall was blamed on
  the decoy screen, then on the equipment price; both were wrong, and both
  cost a rewrite. Printing the chassis flow on both sides - depot stock,
  carrier stock, boats afloat, lost hulls by kind - found it in one run.
  When a war stalls, instrument the economy's plumbing before touching the
  thing that changed most recently.
- Measure economy/pacing claims with the headless sim, not by eye: a quick
  probe script printing ownership/stores/fuel every 50k ticks found the
  fuel-economy collapse in one run. Quote tick numbers.
- Fixes land as slices per `.claude/skills/slice/SKILL.md` — grouped by theme
  (bugs / ruling-consistency / contracts), each with tests named as sentences,
  and a dev-log entry that records what was found and *deliberately not*
  fixed, so the next review starts where this one ended.
- Expect tightening the rules to break the AI or the tests in honest ways
  (the grounding-vs-repair interaction, the AI's starved factory). Those are
  findings too: fix the plan (AI) or isolate the test, and write down which.
