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
  for all** — one team each; empty seats become AI), AI opponents, **how far
  along the war is** (one ladder of five: a home island each, nothing but the
  ship, developed, late, or nose to nose — ruled 2026-08-25, see docs/02), the link
  topology, the point cap, the time cap, and whether the table takes
  observers.
  `applyLobby(rules, options)` folds the choices into a ruleset, which is then
  hashed into `state.rulesHash` — so the settings a war was played under are part
  of its identity and a replay cannot silently use different ones.
- **Chat**: `CHAT_KEPT = 24` lines of scrollback, `CHAT_MAX = 160` characters
  each, both before and during a war.
- **The join code is a LABEL, not a LOCK.** Nothing verifies it: the server
  never checks a code and the client never sends one. It exists so friends can
  confirm they are in the same room. **There is no access control at all** — a
  socket with no token and no code is handed the lowest free team, and a full
  table gets a spectator seat if the room allows watchers. On a LAN that is the
  design and the network is the boundary; on a public host it means the first
  person to open the URL commands a carrier. Pinned by
  `test/server_ws.test.js` ("a stranger with no token and no code is given a
  carrier") so that changing it is a decision rather than an accident. The room
  also broadcasts the code to every seat including spectators, so a
  watch-only table hands it out too.
- **The room comes back.** When the war ends, the host takes BACK TO THE WAR
  ROOM from the ending screen: the finished war is saved one last time, the
  table unreadies, and the SAME join code holds — one code names an evening,
  not one war. Each new war gets a fresh watchdog, and the
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

## Who may sail

Two rules the room enforces before a war starts, both learned the hard way:

- **Everybody playing needs a carrier.** The table's size is a room option and
  the seats fill independently, so three commanders in a two-carrier room was
  a legal state - and the third seat would have been handed a snapshot view
  that does not exist. The room refuses and says which way to fix it: turn the
  table up, or somebody stands down. Observers are not owed a hull and never
  block a start.
- **A resumed war still has its room.** It used to be built only when nothing
  was resumed, so with `RESUME=auto` - the service setting - a restart left
  the table able to finish their war and unable to start another. The room now
  comes back in `running`, holding the options the war was actually played
  with, and reopens to the same join code when the war ends.

## A solo war survives the tab

In solo the engine runs in the BROWSER, so closing the page, reloading it, or
changing the graphics tier used to be the end of the war. Since 2026-08-30 a
solo war writes itself to `localStorage` under `cd_solo_autosave` — every
thirty seconds, on `pagehide`, and whenever the tab is hidden (which is the
case `pagehide` misses on a phone).

**The record is the ordinary save format.** `shared/savefile.js` holds the
format and the replay; `server/save.js` keeps the disk and the lobby options.
So a solo save and a server save are the same object, the same hash check
guards both, and a save the rules have moved underneath is refused rather than
limping back as a subtly different war.

Coming back to the bare page, the start menu offers it — `tick 4,210 · 6 min
ago`, with RESUME and DISCARD — and `?resume=local` boots straight into it.
Resuming skips the menu and takes the war's own start choices back with it,
because the rules must be rebuilt exactly as they were or the replay hash will
not match.

It is also why the tier chip is no longer dangerous: changing tier still
reloads the page, but the war is written down first and asked for back on the
way in. The double-click guard that briefly protected it is gone — that was
the right answer to a war that could be lost, and the better answer was to
stop losing it.

## A link can be a whole game

Every row of the start menu is also a query parameter, so one address is one
war: `islands`, `teams`, `enemy`, `ending`, `start`, `network`, `speed`,
`style`, plus `graphics` for the tier and `seed`.

With the menu shown, a link's settings become its starting position, so the
recipient sees what they were sent and can change their mind. With the menu
skipped (`?mode=solo`), they ARE the game — before this, `?mode=solo&islands=16`
was silently ignored and a carefully written link handed over the defaults.

A value the menu does not offer is **refused, not clamped**, and said out
loud. In a game whose whole contract is that the same seed gives the same war,
a typo that quietly changes the settings is the one failure that must never be
silent.

Two links worth keeping, once the host is up:

```
https://<host>/?mode=solo&style=retro&graphics=high&islands=16&teams=2&start=0
https://<host>/?mode=solo&style=modern&graphics=high&islands=16&teams=2&start=0
```

The first is sharper 1988; the second is everything the RTX-class tier pays
for — the Preetham sky, the mirror sea, the twelve-component swell, the
weather, rain and sunbeams. Both are the same war, and they will play
identically: the look and the tier are client data and never touch the state
hash (ruling #13).

## A war that faults does not take the server with it

The engine throws on purpose - `shared/fixed.js` raises on a bad multiply, the
hashing walk raises on a dirty state - and those throws used to reach an
unguarded `setInterval`, killing the process and with it the shutdown save.
Now the clock stops, the table is told, `/healthz` reports `ok: false` with
the reason, and the war is written down. If the STATE is what broke, the
ordinary save cannot be written at all (it hashes the state), so the command
log goes to `<save>.halted` instead: recoverable by hand, deliberately not
auto-resumable, because an empty hash cannot be verified.
