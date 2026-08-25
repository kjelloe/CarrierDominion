---
name: slice
description: How to land a change in Carrier Dominion — the house rules, the gate, the fixture, the dev-log entry, and the commit. Use whenever writing or changing code in this repo.
---

# Landing a slice

A **slice** is one self-contained change that leaves the repo green and the
dev-log honest. This is the procedure.

## Before writing anything

- Read the relevant `docs/0*.md`. They describe what is built, not what is
  planned, and they record *why* several odd-looking decisions are the way they
  are. Contradicting one is either a bug or a doc update — never silently the
  former.
- If a decision needs the owner, it goes in `dev-questions.md` (gitignored,
  owner-local) with a number, and you carry on with everything that does not
  depend on the answer.

## The rules that are not negotiable

1. **Determinism.** Nothing in `engine/` or `shared/` may read a clock, a file,
   a socket, or `Math.random`. No floats — integers only, via
   `shared/fixed.js`. 256 units = 1 metre; angles are 16-bit BAM; fractions are
   per-mil. The PRNG state lives inside the game state.
2. **The client never sees state.** Everything leaving the engine goes through
   `shared/view.js`, filtered per team — in solo play too.
3. **Absence is `-1`.** No `null`, no `undefined`, ever, in state.
4. **Luau-portable subset.** No `class`, no `this`, no `Map`/`Set`, no
   exceptions, no `async` in `engine/` or `shared/`. Plain functions over plain
   objects and arrays. Acyclic imports. Module soft cap ~300 lines — if it is
   bigger, it is two modules.
5. **Numbers live in `data/*.json`.** A tunable constant in engine code is a
   bug. Behavioural constants (thresholds a rule is *made of*) may stay in the
   module, named and commented.
6. **A new entity kind is not done** until it has a line in **both**
   `createInitialState` and `copyState` in `engine/state.js`. This is the
   aliasing bug every sibling project has lost a day to. A new **field** on an
   existing kind needs: the creator (for islands that is `engine/worldgen.js`,
   not state.js), the copier, and a decision about `shared/view.js` — and it
   moves BOTH pins (see below).
7. **Stats are copied onto records** at build time; per-tick code never reaches
   for the ruleset.
8. **New command fields are OPTIONAL in validation.** The command log is the
   replay AND the save format: a required new field makes every log recorded
   before it exist fail validation on replay, which turns every old autosave
   into a refused resume. Absent means "the old behaviour" (see `climb` on
   `set_unit_helm`).
9. **Cosmetic client work is exempt from determinism** (floats and wall
   clocks are fine above the line) but bound by two contracts of its own:
   the style×tier contract in docs/07 (a tier never changes the art, a style
   never changes the cost class, retro stays 1988), and one-context-per-
   canvas — never put a second renderer on a canvas the war uses (the
   diorama owns its own canvas for exactly this reason). Its tests are
   probes with PIXEL assertions, not just "no console errors" — and measure
   what the camera actually sees: the zenith check reads horizon-white until
   the probe looks up (docs/07 lesson 7).

10. **Derived state is recomputed where it can CHANGE, not on a timer.**
    The resource network depends on island positions (fixed) plus ownership
    and the depot, so a dirty flag raised at those few sites beats both a
    per-tick recompute (too expensive at sixteen teams) and an accrual-beat
    one (stale for up to 100 ticks). Find the small set of writers first.
11. **A family test that is a RANGE will rot.** The three refits were
    `what >= 3 && what <= 5` until the runway took 6 and the comm pod took
    7; `isRefit()` now names the four. Ranges over ids are a promise that
    ids stay adjacent, and they never do.

## Order of work

1. **Write the test first**, and name it as a sentence about the game:
   `a splash round has to strike something`, not `test_shots_3`. `node --test`
   and `node:assert/strict` only — there is no test framework and there will not
   be one.
2. Implement. New system → new module in `engine/`, wired into `advanceTick` at
   a deliberate point. The tick order is part of every hash; if you change it,
   say why in the dev-log.
3. `npm test` — all of it, not just your file.
4. `npm run smoke` — a real Chromium boots the client. `npm test` can pass on a
   client that does not start.
5. If the state shape moved: `npm run repin`. It **refuses on event drift** —
   a hash change with the same events is bookkeeping; a hash change with
   different events means the war plays differently, and that needs
   understanding, not a tool. There are **two pins**: the M0-A fixture and
   `GOLDEN_WORLD_HASH` in `test/engine_worldgen.test.js` — a state-shape
   change moves both; update the golden hash by hand with a comment saying
   why, and say whether the MAP itself changed (usually it did not).
6. If it touches the UI, write or run a probe in `debugging/probes/` and look at
   the screenshot. Unit tests structurally cannot see a mirrored compass or a
   panel row rebuilt under the pointer.

## The dev-log entry

`dev-log.md`, newest first, one entry per slice. Write **what changed and why**,
including what you got wrong on the way — the log's value is the reasoning, not
the diff. Note anything that moved a golden hash and the reason.

Update `docs/` in the same slice when behaviour described there changes.

## The commit

Style: a short declarative sentence, lower-case after the first word, no
prefixes, no ticket numbers, no emoji. Look at `git log` and match it.

```
Decoy flares: the answer to the lock warning
Ordnance is carried, not conjured
healthz says whether a war room is a war room
```

**Branch discipline:** commit and push on `dev_night` only. `main` and `dev`
belong to the owner, who merges after playtesting. Never push, pull, fetch,
merge, rebase, reset, or `checkout .` on anything else.

`ops/` is a symlink into the private `game-ops` repo. It holds real hosting
details and is gitignored here. **Never commit in `game-ops`** — that repo is
the owner's. Port claims go in `../game-ops/RetroMultiCiv/multi-game-hosting.md`;
this game holds **8135**.

## Measuring, not guessing

`npm run sim` runs an AI-vs-AI war headless to its end. It is the instrument for
anything that only appears over hours — deadlocks, an economy that cannot feed
itself, pacing. Two logistics deadlocks and one unfeedable factory plant were
found this way and by nothing else. Quote the tick numbers in the dev-log.

`/watch` is the live version during a playtest: `server/watch.js` reads state
every tick and reports out-of-bounds shapes with the first tick each appeared
on. It found `payForBuild` double-spending on its first full run.
