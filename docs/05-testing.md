# 05 — How it is checked

No test framework. `node --test`, `node:assert/strict`, and files that read like
prose. A test whose name is a sentence about the game (`a splash round has to
strike something`) is worth more than one called `test_shots_3`, because the
name is what somebody reads at 2 a.m. when it goes red.

## The gate

```
npm test      the unit and integration suite (418 tests and growing), node --test
npm run smoke a real Chromium boots the client and plays a little
npm run gate  both, in that order
```

Nothing lands unless the gate is green. The one thing to know about the order:
`npm test` can pass on a client that does not start, which is why the smoke gate
exists and why it is part of `gate` rather than optional.

The same gate runs in CI (`.github/workflows/gate.yml`, ruling 2026-08-23):
tests, then Playwright + smoke, then the five-seed battery, on every push to
`dev_night`, `dev` and `main`. CI is a second opinion, not a substitute — the
gate still runs locally before every commit.

## The pinned fixture

`test/fixtures/m0a.json` holds the state hash after each of 300 scripted ticks
from a fixed seed. Any change that moves the war fails at **the tick it moved**,
which turns "something is different" into "the third tick after the launch
order" — usually enough to know the cause without a debugger.

Re-pinning is `npm run repin`, and `tools/repin_m0a.mjs` **refuses** if the
event stream drifted. A hash change with the same events is bookkeeping — a
field added, a value widened. A hash change with different events means the war
plays differently, and that is not something to wave through by running a tool.
That distinction is also why `shared/statehash.js` offers `trajectoryHash()`
(state minus events) and `behaviorHash()` (state minus the ruleset stamp).

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

## Probes

`debugging/probes/*.mjs` drive a real Chromium through Playwright, do something,
and screenshot it. They catch what unit tests structurally cannot: the compass
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

Current probes: `ai_trace`, `combat_shot`, `damage_board`, `graphics_shots`, `gunsight`,
`island_board`, `lobby`, `rejoin`, `replay_view`, `scope_zoom`, `splash_shot`, `start_menu`, `touch_controls`,
`playtest_round1`, `playtest_round2`, `playtest_round3`, `second_war`, `strategic_probe`, `style_shots`, `turret_shot`,
`war_over`, `war_trace`, `watch_run`. `graphics_shots` also asserts the
phase-2 pixel contract machine-checkably (docs/07 §3): mirror water, a blue
zenith measured looking UP - the chase camera only ever sees the Preetham
horizon band - and non-flat near water. `war_over` photographs states a live war takes hours to reach -
the ending screen, a scope full of ghosts - by pausing the solo war and
swapping in a doctored view through the `__debugView` hook.

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
war can legitimately be quiet for a long while.

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
