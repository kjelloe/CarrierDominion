# The battery lane

Long simulation runs happen on a second machine, because the question that
matters here shards across every core for hours and a laptop is the wrong
place for it.

**Git is the transport.** The dev machine commits a TASK and pushes; the worker
pulls, runs it, commits a RESPONSE and pushes back. Nothing is peer-to-peer, so
the worker can sit anywhere that can reach the remote. Ported from the sibling
(`shadowmandate/batch/`), which arrived at this after a LAN agent-mail hub that
had to be on the same network.

```
batch/tasks/0002-matrix.json      queued by the dev machine
batch/responses/0002-matrix.json  status, commit, era, row count
batch/responses/0002-matrix.csv   one row per war
```

A task with no response is pending. That is the whole protocol.

## Why this game needs one

`npm run battery` is five fixed seeds in **eight seconds**. It answers *does the
war still work*. It cannot answer *how does the war behave*, and on 2026-08-30
it demonstrated why: all five seeds end `winner=0 by sinking`, which reads like
a side bias in a game where both sides are the same AI. Forty-eight fresh seeds
came back **25/22**. Five seeds cannot tell a coincidence from a rule.

The expensive question is the **configuration matrix**. The lobby offers 4–64
islands and 2–16 teams, and `docs/06-rulings.md` #9 says nothing may hard-code
two teams — but almost everything ever measured here has been an 8-island,
2-team war. Measured cost per war:

| configuration | cost per war | note |
|---|---|---|
| 8 islands, 2 teams | ~15 core-seconds | the default; what the battery runs |
| 32 islands, 4 teams | ~655 core-seconds | **44× more**, and 14 of 16 never resolved |

A war that does not resolve runs the full 900,000-tick cap, which is 12.5 hours
of war at ×1 — so the expensive cells are expensive *because* they are the ones
going wrong. That is the batch PC's work.

## Dev machine

```bash
node tools/batch.mjs queue seeds 300          # 300 seeds at the default war
node tools/batch.mjs queue matrix 20 32 4     # 20 seeds, 32 islands, 4 teams
node tools/batch.mjs status                   # the board
git add batch/tasks && git commit -m "batch: queue the matrix" && git push
```

## Worker

```bash
git pull
node tools/batch.mjs run          # or --dry to see what it would do
git add batch/responses && git commit -m "batch: results" && git push
```

Then read them:

```bash
node tools/batch.mjs status
# resolved rate and win split for one cell:
awk -F, 'NR>1 && !/^#/ {n++; r+=$5; w[$6]++} END {print n" wars, "r" resolved"; for (t in w) print "  team "t": "w[t]}' \
  batch/responses/0002-matrix.csv
```

A single surprising row reproduces on its own, without the sweep:

```bash
node tools/sweep.mjs --seed 900913 --islands 32 --teams 4
```

## The two hashes

Every CSV header carries both, and they answer different questions:

- **`era`** — the hash of the RAW ruleset. *Are these two sweeps running the
  same rules?* It does not move when the sweep's arguments do. This is what the
  response records and what `status` compares.
- **`configHash`** — the hash of the FOLDED ruleset. *Are these two sweeps
  running the same war?* It moves with islands and teams, because those go
  through `applyLobbyOptions` and become part of the rules.

This game has a better era than a version string: `state.rulesHash` is computed
from the data the war actually runs on, so it cannot be forgotten the way a
hand-bumped number can.

## What the runner refuses to do

Every one of these is inherited from the sibling, where each was earned:

- **It will not serve on a red suite.** Results from a broken build are worse
  than no results, because they look like data. A red suite writes a FAILED
  response for every pending task rather than staying silent. (Verified here by
  breaking a test on purpose.)
- **It names the commit and the era in every result.** A stale worker produced
  confusing verdicts for a day before anyone checked what it was running.
- **It flags an era mismatch rather than correcting it.** A sweep that ran under
  a different ruleset than it was queued for is not wrong — it answers a
  different question, and reading it as the old one is the stale-baseline
  hazard the discipline exists for.
- **It refuses empty output.** A shard that dies silently would otherwise merge
  into a cheerful "0 rows".
- **It writes nothing private.** These files are tracked, so the runner records
  no hostname and no user, and scrubs absolute paths out of any captured error.
  `ops` stays gitignored for everything that genuinely is machine-specific.

And one specific to this game:

- **Every war goes through `applyLobbyOptions`,** never a hand-poked ruleset.
  Setting `aiTeams` to four teams while `teamCount` stays at two gives teams 2
  and 3 an AI plan and no carrier; every war then fails to resolve for a reason
  belonging to the harness. That mistake was made here first, and it looked
  exactly like a finding. `tools/sweep.mjs` agrees with `npm run battery` to the
  tick on a shared seed — that is the check that caught it.

## It leaves two cores

`shards = cores - 2`. A worker that pins every core makes the machine unusable
for whoever is sitting at it, and this PC is shared with the sibling project.

## Contention

**Check `status` in BOTH repos before queueing anything large** — both workers
shard to nearly every core. There is no claim step in the protocol: two workers
pulling the same pending task would both run it and race to push. That is fine
to fix if it ever matters (a `claim` file would do it), but with one machine it
is complexity for nothing.

## First run on a fresh worker

```bash
git clone <remote> CarrierDominion
cd CarrierDominion
npm ci --omit=dev     # `ws` is the only runtime dependency; playwright is
                      # dev-only and drives the BROWSER gates, which are not
                      # part of `npm test`
node tools/batch.mjs status
node tools/batch.mjs run
git add batch/responses && git commit -m "batch: results" && git push
```

**Node 22+ note.** `npm test` runs `node --test test/*.test.js`, with the shell
expanding the glob. It used to say `node --test test/`, which works on Node 20
and **fails outright on Node 24** — the directory is read as a glob pattern,
matches nothing, and Node tries to load `test/` as a module. The batch PC (Node
24) hit that the first time it ran, and because the runner refuses to serve on
a red suite, all eight tasks would have come back FAILED. Fixed 2026-08-30.

The worker checks out the same repo as the dev machine. It will **not** have
`ops/`, `dev-questions.md`, `dev-prompts.md`, `reviews/` or `reports/` — those
are gitignored and local. Nothing in the lane needs them.

Note `npm ci --omit=dev` is enough to `run`, because the suite the runner gates
on (`npm test`) is the node test runner only. If you want the browser gates too,
that is `npm ci` plus `npx playwright install chromium`.
