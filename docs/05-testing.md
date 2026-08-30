# 05 — How it is checked

No test framework. `node --test`, `node:assert/strict`, and files that read like
prose. A test whose name is a sentence about the game (`a splash round has to
strike something`) is worth more than one called `test_shots_3`, because the
name is what somebody reads at 2 a.m. when it goes red.

## The gate

```
npm test      the unit and integration suite (five hundred-odd tests), node --test
npm run smoke a real Chromium boots the client and plays a little
npm run gate  both, in that order
npm run probes every probe in debugging/probes, one after another (~50-85 min)
```

Nothing lands unless the gate is green. The one thing to know about the order:
`npm test` can pass on a client that does not start, which is why the smoke gate
exists and why it is part of `gate` rather than optional.

The same gate runs in CI (`.github/workflows/gate.yml`, ruling 2026-08-23):
tests, then Playwright + smoke, then the five-seed battery, on every push to
`dev_night`, `dev` and `main`. CI is a second opinion, not a substitute — the
gate still runs locally before every commit.

### Tests that guard a RULE rather than a behaviour

These files exist to keep promises the documents make but nothing enforced,
each added after the promise had already been broken once:

| File | What it will not let you do |
|---|---|
| `engine_subset.test.js` | Use `class`, `this`, `Map`, `Set`, exceptions, `async` or any array METHOD anywhere in `engine/` or `shared/` — the Luau-portable subset (docs/01). It reads the sources. Three files throw on purpose and are named exemptions; nothing else is. |
| `engine_cosmetic.test.js` | Let the art style or the clock speed reach the ruleset from either fold, or ship a menu value that produces a war the canonical walk rejects. "Style is data" (ruling #13) had been a standing constraint with nothing behind it. |
| `data_rules.test.js` | Move a number the documents quote without moving the document, or leave a ruleset key that nothing reads — the sweep found `startFuel` and `startOrdnance` sitting there looking live (deleted 2026-08-26). Inert keys are declared, with the reason. It also refuses two ruleset files sharing a key NAME, because the dead-key check matches bare names and could not tell `rules.startMaterials` from the live `units.carrier.startMaterials` — which is exactly how that one hid. And it pins the endurance RATIO, not just the two numbers, so raising capacity and burn together cannot slip past. |
| `engine_authority_sweep.test.js` | Add a command without a probe saying who may issue it. |
| `engine_weather_seam.test.js` | Ask the weather about anything except the war's own seed and tick. It reads every `weatherAt(` call in `engine/` and fails on any that is not exactly `weatherAt(state.seed, state.tick)` — the moment one takes a value a client can influence, the sky stops being derived and every seat sees a different war. It also holds the client's `?weather=` override out of `engine/`, `shared/` and `server/`, and asserts the golden pin still carries a behaviour hash per step. |
| `shared_savefile.test.js` | Break the save format both sides now share: a save that does not replay into the war it came from, a resumed game that loses its command log (so the SECOND save is a war starting mid-air), a hash mismatch that limps back instead of refusing, or a field that does not survive JSON — which is how a save travels, to disk and to localStorage alike. |
| `engine_seastate.test.js` | Slow a Walrus that is ashore (a heavy sea has no opinion about a hillside), or let the storm flight floor bind the pilot's stick rather than the aircraft — a limit that binds only the human is one the human reads as the game cheating. |

Two more guard the fog rather than a rule: `shared_view.test.js` asserts an
enemy record carries exactly the same KEYS as one of your own — a field on
one side and not the other is either a leak or a hole — and brands every
number on an enemy's records with a sentinel that must not appear in the
other side's view.

## The pinned fixture

`test/fixtures/m0a.json` holds the state hash after each of 300 scripted ticks
from a fixed seed. Any change that moves the war fails at **the tick it moved**,
which turns "something is different" into "the third tick after the launch
order" — usually enough to know the cause without a debugger.

Re-pinning is `npm run repin`, and `tools/repin_m0a.mjs` **refuses** if the
event stream drifted. A hash change with the same events is bookkeeping — a
field added, a value widened. A hash change with different events means the war
plays differently, and that is not something to wave through by running a tool.
That distinction is also why there are two narrower hashes: `trajectoryHash()`
(state minus events) in `engine/snapshot.js`, and `behaviorHash()` (state
minus the ruleset stamp) in `shared/statehash.js`.

**`behaviorHash` is now wired to the job it was written for** (2026-08-27).
Every pinned step carries two hashes, and the repin tool reports them
separately:

```
hash drift:      first at tick 1: 822ace53… -> d339fcde…
behaviour drift: none - the ruleset stamp moved, the war did not
event drift:     none
```

That top line moves whenever ANY key in `data/*.json` is added, renamed or
deleted, because `state.rulesHash` hashes the whole ruleset on purpose — two
LAN peers must be able to prove they hold the same rules. So a pin move is
not, by itself, evidence that the war changed. Before this the tool could not
say which had happened and the answer got hand-rolled in a scratch script,
twice, by someone who had forgotten `behaviorHash` was already written and
tested. A function with tests and no callers is not finished.

## The hashing walk is also a linter

Canonicalising the state throws on a float, a `null`, or a non-printable string,
naming the path. So every test that hashes a state is also asserting the state
is clean — which is how a stray `-0` or a `NaN` gets caught on the tick it is
created rather than three days later on somebody else's machine.

## Headless wars

`npm run sim` runs an AI-vs-AI war to its end with no browser and no clock. It
is the measuring instrument for everything that only shows up over hours:

- the logistics deadlock (two wars stopped dead when the last lighter died),
- the factory that could not be fed,
- the pacing numbers in these documents — with search and resupply both
  working, the five battery seeds resolve between ticks 33,252 and 172,941.

If a change makes the AI stupider or the economy tighter, the sim says so in a
minute and no unit test would have.

`npm run battery` is the sim times five: fixed seeds (20260818, 31337, 424242,
777001, 900913), each war run to its end under the playtest watchdog, failing
loudly on a war that does not resolve or trips a finding. A report with
endpoints, winners, worst quiet stretches and wall time lands in
`reports/sweeps/`. On its first run it caught seed 424242 stalled for 60,586
ticks — both air groups annihilated and the replacement chassis never sailing,
because the boat's hold filled entirely with fuel every trip. One seed is a
measurement; five is a distribution.

It earned itself again on 2026-08-25. A slice that gave the new equipment a
resupply path turned seed 900913 into a 64,000-tick stare across five
kilometres, and the chase from that one failure found **three** defects, none
of them the one first suspected: equipment eating the parts an airframe was
waiting for; the AI's supply list asking only for fuel and shells, so a ship
with a full bunker and an annihilated air group never fetched the chassis
piled up at its depot; and `planFor` fortifying a team that had no mine at
all, because the home island hands everyone a plant at tick one and the
fortress rule keyed off that. Four of the five seeds now resolve FASTER than
before the chase started - 777001 fell from 116,320 ticks to 25,235.

## Playtesting

`PLAYTEST.md` is the owner's script, with a hand-written self-contained copy
at `PLAYTEST.html` for reading on a tablet beside the machine. Rewritten
2026-08-30 into two parts: **six ranked questions** — the things a test run
cannot answer and a player can — followed by **one complete war walked step by
step**, in the order a game uses its systems rather than the order they were
built.

The ranking is the point. Everything in the second half is checkable by a
probe eventually; the six questions are not, and they are what a playtest is
actually for.

## Probes

`debugging/probes/*.mjs` drive a real Chromium through Playwright, do something,
and screenshot it.

**A failure is retried once** (ruled 2026-08-27) and reported as
`ok (2nd try - FLAKY)`. Thirty-one browser launches back to back exhaust a
loaded machine, and two probes were failing on that alone while passing
perfectly on their own — which cost the sweep most of its authority, because a
sweep you have to re-run by hand to believe is one you stop reading. The retry
is **not** there to make the sweep look green: every probe that only passes on
the second attempt is listed by name under a FLAKY heading at the end, every
run, because flakiness is a defect to fix rather than a pass to bank. The exit
code counts only probes that failed **twice**.

**The sweep is not a quick check any more.** It was ~13 minutes when it was
28 probes; a measured full run on 2026-08-27 took 5,128 seconds. `weather` is
the heaviest single probe by a wide margin - seven page loads of the High
tier, which is exactly the software-rasterised path that makes everything
slow - and it sorts last, so it runs when the machine is at its most loaded.
Use `npm run probes -- <name>` while working and keep the full sweep for
before a hand-over.

Run a probe at the cheapest graphics tier that still tests what it is for.
`second_war` ran at `graphics=medium`, which headless Chromium rasterises in
software, and the resulting jank was nearly written up as a defect in the LAN
room: the same round trip without a browser takes 2 ms. A headless browser
doing software rendering is not a clock. They catch what unit tests structurally cannot: the compass
rose that was mirrored, the panel row that was replaced under the pointer, the
smoke gate reading a HUD cell that no longer existed.

Socket tests have one rule of their own, learned twice: a wait that scans the
whole inbox is satisfied by stale messages from an earlier phase of the same
test — an evening of two wars produces two `welcome` messages, and the second
wait happily matches the first. Waits across a phase boundary use the inbox
cursor (`mark()` / `nextAfter()` in `server_ws.test.js`).

The lobby bug is the clearest case for having them at all — every socket test
passed, because socket tests write raw JSON and the bug was in how the *client*
wrapped its messages. Two real browsers found it immediately.

Current probes (the list is generated from the directory - three probes went
stale here before anyone noticed):

`ai_trace`, `chart_and_chips`, `combat_shot`, `consoles`, `damage_board`,
`flavour_pack`, `graphics_shots`, `gunsight`, `hammer_drone`, `island_board`,
`late_war`, `lobby`, `playtest_round1`, `playtest_round2`, `playtest_round3`,
`playtest_round4`, `rejoin`, `replay_view`, `scope_zoom`, `second_war`,
`splash_shot`, `squadron`, `start_menu`, `strategic_probe`, `style_shots`,
`touch_controls`, `turret_shot`, `war_over`, `war_trace`, `watch_run`,
`weather`.

`graphics_shots` asserts the phase-2 pixel contract machine-checkably (docs/07 §3): mirror water, a blue
zenith measured looking UP - the chase camera only ever sees the Preetham
horizon band - and non-flat near water. `war_over` photographs states a live war takes hours to reach -
the ending screen, a scope full of ghosts - by pausing the solo war and
swapping in a doctored view through the `__debugView` hook. `weather` is the
newest of the measuring kind (2026-08-26): it finds five moods by CONDITION
rather than by hardcoded tick, freezes each with `?weather=<tick>`, and reads
the average colour of a sky band and a sea band out of the frame buffer in
the same JS turn as the render. A shader that silently does nothing still
takes a beautiful screenshot; the assertion that would catch the whole
weather path being switched off is the dullest one - that all five moods
render DIFFERENT skies.

### What the watchdog trips on

`server/watch.js` watches a running war for things the engine promises and
reports them rather than crashing. Beyond the position, health and stock
invariants it has always had, the squadron batch added three:

- **a hull over its payload budget** — the fitting screen refuses it and
  rearming clamps to it, so a hull carrying more than it can lift means one
  of those two has a hole;
- **a craft stuck in the deck cycle** — the cycle is about a hundred ticks,
  so ten thousand means the clock is not running. This is a stall the stall
  DETECTOR cannot see, because the war around it is busy;
- **a course leg off the chart** — legs are validated on the way in, and
  this is the tripwire for one that arrived another way.

## The playtest watchdog

`server/watch.js`, served at `/watch`. It reads state and never writes it, and
the first test in `server_watch.test.js` proves exactly that by hashing a war
watched and unwatched.

It looks for the shapes that mean the simulation has gone somewhere it should
not be:

| Finding | What it means |
|---|---|
| off the map | integration or pathfinding has run away |
| under the sea / on dry land | the height model and the movement model disagree |
| negative store, hull above max, magazine overfull | arithmetic somewhere is not clamped |
| island stock above its cap | a path that adds stock stopped respecting the cap |
| more built than the slots allow | a build check is not holding |
| the war has stopped happening | the shape every deadlock so far has had |
| tick slower than real time | the only way a LAN war falls behind |

One finding per **kind**, with the first tick and a count — a session that trips
the same bug four hundred times should report it once.

`STUCK_TICKS = 60_000` is fifty minutes of game time. It started at 20,000 and
fired on every ordinary steaming leg, which is how a watchdog gets ignored: one
island takes about 37,000 ticks to take and a map crossing takes 20,000, so a
war can legitimately be quiet for a long while. That number was tuned on the
8-island map, so the default **scales with the ocean** — sqrt(islandCount/8),
the same law that grows the sea — while an explicit `stuckAfter` stays the
caller's word (third review: a 64-island crossing would have tripped the
unscaled alarm every time).

It has already earned itself: on its first full run it found `payForBuild`
double-spending when the build site *was* the stockpile island, from tick
13,401.

## Landing a change

1. Write the test first, as a sentence about the game.
2. `npm test`, then `npm run smoke`.
3. If the state shape moved: `npm run repin`, and read what it says about events
   before you accept it.
4. A `dev-log.md` entry — what changed and *why*, not what the diff shows.
5. Commit on `dev_night`. `main` and `dev` belong to the owner.
