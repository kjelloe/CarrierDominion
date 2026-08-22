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

## Verifying and landing

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
