# 03 — Playing together

## Two transports, one game

`client/transport.js` exposes the same two functions either way, so nothing
above it knows which it has:

| Transport | Where the engine runs | Used for |
|---|---|---|
| `local` | in the browser tab | solo, replays, probes, most of the smoke gate |
| `ws` | on the server | LAN, and anything with more than one human |

Solo play is **not** a special case with the fog turned off. The local transport
runs the same reducer and pushes the result through `shared/view.js` for the
seat you are sitting in, so a bug in the filter shows up in solo play too.

- `send(command)` wraps a game command as `{type:'command', …}`.
- `sendMessage(message)` writes a raw object.

Both exist because collapsing them cost an evening: war-room clicks went out
wrapped as game commands and the server answered *"the war has not started"*.
The socket tests could not catch it — they write raw JSON — and two real
browsers found it in a minute.

The **replay viewer** (ruling 2026-08-23) is a third face of the local
transport, not a format: `?mode=replay` fetches `/data/autosave.json`, folds
the saved lobby options into the same ruleset, and walks the command log
through the same reducer at war speed, building the view each tick. When the
log runs out it closes with *"replay finished"*. Commands typed at a replay
are ignored — history does not take the wheel.

## The server is the only thing with a clock

`server/clock.js` is the one place in the codebase that reads wall time. It
pumps `advance_tick` into the reducer at `msPerTick / speed`, and will make up
at most `CATCHUP_INTERVALS = 5` intervals after a stall: a laptop that slept
through lunch resumes the war, it does not fast-forward through it.

The clock callback returns early while a lobby is open. Without that, the war
ran behind the war-room screen and START "appeared to work" because there was
already a phantom war in progress.

## What a client receives

Only `shared/view.js` output, per team, every tick:

- **Own hulls** in full — fuel, hull, sections, magazines, orders.
- **Enemy hulls** only inside your own detection range, and then only as a
  contact: position, heading, kind. Not fuel, not damage, not what it is
  carrying.
- **Islands** always — they are on the chart. Ownership and works are visible;
  another side's stockpile is not.
- **Ghosts** — the chart's memory (`engine/contacts.js`): a mark for every
  enemy hull this team HAS seen and no longer does — position, heading and
  when, nothing live. Kept until disproved by scanning the spot properly (the
  rim of the sweep is deliberately ambiguous), never expired by a timer. The
  memory lives in state, per team, so replays remember exactly what the war
  remembered; only your own team's ghosts reach your view.
- **The scoreboard**, empty while the war runs — the enemy score is fog like
  everything else of theirs — and everybody's final score once it ends.
- **Events** are filtered too, so an explosion you could not have seen does not
  arrive as a sound cue.

Detection is radar range only (owner ruling): there is no separate visual
sense. A ship with a wrecked topside goes blind, which is the single most
expensive damage state in the game — though the chart keeps its ghosts.

## The war room

`server/lobby.js`, adapted from multiciv's lobby rather than reinvented.

- **Join code**: five Crockford characters derived from the server's boot id, so
  it is stable for the life of the process and has no ambiguous letters to read
  out across a room.
- **Host**: the longest-seated player. Computed, never stored — so there is no
  "host left and nobody is in charge" state to repair.
- **Ready**: every player must be ready before START is offered; the host presses
  it.
- **Options**: map size, island count, the table size (**2–16 carriers, free
  for all** — one team each; empty seats become AI), AI opponents, the game
  type (**Strategy** from zero, or the **Action Game**'s developed war), the
  point cap, the time cap, and whether the table takes observers.
  `applyLobby(rules, options)` folds the choices into a ruleset, which is then
  hashed into `state.rulesHash` — so the settings a war was played under are part
  of its identity and a replay cannot silently use different ones.
- **Chat**: `CHAT_KEPT = 24` lines of scrollback, `CHAT_MAX = 160` characters
  each, both before and during a war.
- **The room comes back.** When the war ends, the host takes BACK TO THE WAR
  ROOM from the ending screen: the finished war is saved one last time, the
  table unreadies, and the SAME join code holds — one code hands friends a
  whole evening, not one war. Each new war gets a fresh watchdog, and the
  client rebuilds its world from the new war's first snapshot (the room may
  have chosen a different archipelago). Reopening a war still in progress is
  refused: abandoning is a different decision from finishing.

## Seats, dropping, and coming back

`server/reconnect.js`. A seat is a team plus a socket plus a token in the
client's `sessionStorage`.

When a socket drops the seat is **held** for `GRACE_MS = 90_000` and the team is
handed to the AI by enqueueing `set_ai` — a **command**, not a server-side poke
at the state. That is the rule that keeps replays honest: a war is its seed plus
its command log, so an AI takeover has to be in the log or the recording is a
lie.

Reconnecting inside the grace window returns the same team and issues
`set_ai … active: 0`. A player who was late back is still let in if the seat has
not been claimed by anyone else, because being marooned for two minutes should
not cost a war.

The client reconnects on its own with backoff: `MAX_RETRIES = 6`, starting at
800 ms and capping at 8 s.

## Voting on the clock

`server/vote.js`. Time compression is a shared decision, by owner ruling:
**unanimity among human players**. AI seats do not vote and do not block.

Any player proposes a speed; the proposal is open until everyone has answered;
one refusal ends it. Votes are cleared when the roster changes, because a vote
cast by somebody who has since left is not consent.

The speed ladder is `shared/speeds.js` — the same rungs everywhere so a client
cannot propose a rate the server has no name for.

## Observers

One human per team; whether anyone else may watch is **the table's choice**
(ruling 2026-08-23): an *observers* switch in the war room, on by default,
`observers: 0` on a lobbyless server. Door closed, a seatless connection is
turned away with a reason. Door open, observers get **the referee's view** —
every hull with its owner's own detail, every stockpile, the live scoreboard.
That is a free intelligence channel for *everyone at once*, which is exactly
why it needs the table's consent: an earlier build handed spectators team 0's
view, which was a free channel for one side and consented to by nobody. With
no ship to chase, the observer's camera defaults to the strategic pull-back.

## Saving and resuming

There is no save format to design, so none was designed: a war IS its seed
plus its ordered command log (docs/01), and that is what `data/autosave.json`
holds — plus the lobby options it sailed under, the tick it had reached, and
the state hash it had. The server writes it every thirty seconds and on
shutdown; `RESUME=1` replays the log through the same reducer and **refuses**
if the result does not hash to what was saved — a save made under different
rules or different code does not limp back as a subtly different war.

Seats do not survive the restart (tokens are per-process); players rejoin and
claim their teams again. The AI keeps any seat the log says it holds, because
`set_ai` is a command and commands are the save.

## What is deliberately not here

- **No lockstep.** The server simulates and ships views; clients do not simulate
  ahead. The hash exists to *detect* divergence, not to reconcile it.
- **No rollback or prediction.** At 20 Hz with a carrier that does 8 knots, LAN
  latency is not visible.
- **No matchmaking, no accounts, no lobby server.** It is a LAN game with a join
  code, hosted at `carrierdominion.kjell.today` on port 8135 when it is up.
