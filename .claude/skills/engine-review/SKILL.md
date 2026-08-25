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
  replay fold. Check the whole chain, not the first link. When an option
  REPLACES older ones (`startShape` for `actionStart` + `homeIslandStart`),
  the fold must still read the old keys or every save and replay made
  before it silently changes shape.

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

- **A per-actor placement rule with no view of the other actors.** The
  spawn nudge moved each carrier toward the middle on its own, which was
  invisible while it only closed 30% of the way; asked to close 55% it
  walked both ships onto the same point (611 m apart, one sunk in ten
  seconds). A placement rule that runs per actor must be re-read the moment
  its magnitude changes, and usually wants to run over the whole fleet in
  lockstep instead.
- **A veto that ends the search instead of skipping a candidate.** The same
  nudge stopped for good at the first blocked step, so one island in the
  straight line read as a wall and every carrier halted a third of the way
  in while the water past it was open to the middle. Ask whether a refused
  option should end the loop or just be skipped - for a placement (as
  opposed to a voyage) it is nearly always skipped.
- **A guard applied to one caller and not its sibling.** The 2026-08-23
  review gave the DEVELOPED start a clearance walk so no carrier spawns
  inside a hostile battery. The DEFAULT start does the same thing - hands
  out islands and arms them - and never got it: three four-island seeds in
  four executed a carrier in under a minute. When a fix lands in one
  branch, grep for every other branch that does the same kind of work.

- **A probe that selects the UI by position.** `rows.nth(1)`, or "the first
  settable row", is correct until a row is inserted above it - and then the
  probe silently drives a different control and reports the feature it was
  watching as broken. Three probes had drifted this way (the war room's
  ladder row went in at the top; a HUD line moved to the instrument panel; a
  throttle scale grew an astern half). Select by NAME, and read chosen values
  BACK rather than hardcoding them - defaults move too.
- **The thing no gate opens is the thing that breaks.** `client/panels/
  island.js` used `islandName` without importing it, so the island board
  threw for every player who clicked one of their own islands - for days.
  The smoke gate fails on any console error and would have caught it
  instantly, but nothing in the gate ever opened that panel. When a panel or
  screen is added, add one line to the smoke gate that opens it.

- **A priority list that orders the ATTEMPTS, again.** The supply boat
  loaded fuel, then ordnance, then materials, and filled its whole hold with
  whichever came first. The note above `chassisWanted` records the identical
  lesson being learned once already for parts - and nobody generalised it,
  so materials had it too: a carrier sat at 87 of 1,000 hull with ZERO
  materials beside a depot holding 61,571. When a fixed order is found
  filling a bounded container, ask whether ANY of its other items have the
  same problem, not just the one in front of you.
- **A shopping list that never learned the newest store.** Third time for
  this one: fuel and ordnance from the start, chassis after seed 900913,
  materials never at all. When a new commodity is added, grep every place
  that decides "do I need supplies".
- **An operation that restarts its own clock.** `beginDocking` was called
  every tick while the craft sat in the recovery envelope, so the approach
  never finished - aircraft flew an endless final, ran dry, and were rebuilt
  at chassis cost. A state entered from a per-tick check needs a guard that
  the state is not already entered.
- **A timed operation that every test and probe was written before.** The
  deck cycle put five seconds between "launch" and "airborne" and broke the
  smoke gate, the chips probe and a dozen scenario tests - none of them
  wrong, all of them written when launching was instant. When an action
  grows a duration, grep for everything that presses the button and then
  asserts.

- **A rule that counts its own subject.** `planFor` asked "what should this
  island be" while counting that island's current role in the answer: a
  RESOURCE island made the plan want a FACTORY, and a FACTORY island made it
  want a RESOURCE. One island flipped every three ticks for a whole war,
  nothing was ever built on it, no team raised a plant, and both fleets ran
  dry by tick 300,000 with full holds of ore. The fix is in the question:
  what should this be **given the rest** of the estate. Whenever a decision
  about X reads a tally that includes X, ask whether it should.

  This one is doubly worth remembering because the OLD code was safe by
  accident - it only ever planned an island with no role, so the loop could
  not close. Removing an "only when unset" guard can expose an oscillation
  that was always latent in the rule underneath it.

- **A rule that lives only in prose.** Three of them were found in one
  afternoon: "style is data" (a standing constraint since 2026-08-19), the
  Luau-portable subset (a rule since day one, eleven violations), and "the
  numbers the docs quote are the numbers in the data". Each is now a test.
  When a document says "never" or "always", ask what would fail if it
  stopped being true - and if the answer is "nothing", that is the finding.
- **A view checked field by field.** The fog tests named the fields they
  cared about, so a field added to the own view and forgotten on the contact
  view said nothing. Check the SHAPE: same keys both sides, and brand the
  enemy's numbers with sentinels that must not appear in your view. It found
  fourteen drifted fields the moment it was written.
- **A new command type that never went through the save.** The command log
  IS the save format, so every command has to survive a JSON round trip and
  replay to the same hash. Six had never been tried, one of them the first
  to carry an array.

### And two habits, not classes

- **Check who is driving.** In the headless sim and battery, team 0 is the
  EMPTY PLAYER SEAT (`aiTeams: [1]`). "Team 0 dies without scratching team
  1" is a stationary unmanned ship, not an AI defect. Half a session went
  into that reading before the seat was checked.
- **Run the probes before believing them.** They are not in `npm run gate`
  (they open browsers and take minutes), so they rot. `npm run probes` runs
  the lot; sweep it after any UI change, and read a failure as "either the
  feature or the probe" until you have looked.
- **A symptom fix that makes the metric WORSE is the tell.** Pushing spawns
  apart in worldgen moved two seeds of five and made one war end faster.
  That was the signal to stop and look for the real cause (a battery, not a
  distance). Revert, do not tune.

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
