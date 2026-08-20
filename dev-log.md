# Development log

Newest first. One entry per slice: what landed, what it cost, what moved a
golden hash and why.

---

## 2026-08-20 — Writing down what was built, before the playtest

No code changed; no hash moved. Milestone 1 closed with the reasoning behind it
scattered across 984 lines of this log and nowhere else, which is fine for the
person who wrote it and useless to anyone else — including the same person in
three weeks.

### `docs/`, five numbered files

Mirrors multiciv's convention. They describe **what exists**, not what is
planned — the plan is `plan-version1.md` and the chronology is this file.

| | |
|---|---|
| `00-index.md` | the three rules, and where everything lives |
| `01-simulation.md` | the engine contract, fixed point, the tick order, state shape, hashing |
| `02-systems.md` | the war as built: weapons, damage, islands, supply, capture, scoring, the AI |
| `03-multiplayer.md` | transports, the clock, fog, the war room, seat grace, the speed vote |
| `04-client.md` | no build step, art as data, the instrument panel, panels, sound, keys, i18n |
| `05-testing.md` | the gate, the fixture, the probes, the watchdog, how to land a change |

The bias throughout is towards recording the decisions that look wrong until
explained: why the compass subtracts its sine, why a splash round has to strike,
why the AI takeover is a command rather than a server-side poke, why armour is
read before the section absorbs the hit, why `STUCK_TICKS` is 60,000. Those are
the lines that will stop the next person re-introducing a bug that has already
been fixed once.

### The README was lying in three places

It still said islands paid by *kind*, that a carrier refuelled by lying within
900 m of one, and that weapons, damage, buildable structures and a real HUD were
"not yet built". All four have been false for days. Rewritten, plus the virus
bomb, the roles, the repair chain, and the four end conditions.

`plan-version1.md` now records Milestone 1 as complete and names what is carried
into Milestone 2: fog with a memory, and the Luau twin.

### A skill for the procedure

`.claude/skills/slice/SKILL.md` — the house rules, the gate order, the repin
refusal, the dev-log entry, the commit style, and the branch discipline, in one
place instead of being re-derived from context every session. It exists mostly
so the two rules that cost a day each — a new entity kind needs a line in
`copyState`, and `npm test` can pass on a client that will not start — are
written where they will be read *before* the mistake rather than after.

---

## 2026-08-20 — Coming back to your own war, a room that talks, and a watchdog

351 tests + smoke gate green. Three things asked for before a playtest, and one
of them found a bug in its first three seconds.

### A dropped player keeps their carrier

Adapted from multiciv's seat-grace. A seat is now HELD rather than freed: the
same player, presenting the token they were issued, gets their own seat back
with their own name on it, and a stranger cannot be handed a seat somebody is
coming back to. After ninety seconds the seat is released and **the AI takes the
war over**, because a dropped player's carrier sitting at anchor for the rest of
the war is worse for their opponent than losing to a machine.

The takeover is a COMMAND (`set_ai`), not something the server does to the state
behind the reducer's back: the command log is the replay, so a war where the AI
took over at tick 40,000 has to replay as one where it did.

A late player is still let back in if nobody took the seat. The grace window
exists to stop a race, not to punish somebody whose train went into a tunnel.

**One thing the probe found:** a human joining a war whose second seat was
AI-held ended up sharing one carrier with the AI, both steering. A human at a
seat now takes it off the machine, whether they are returning to it or sitting
down for the first time.

### The room talks

Chat in the war room, bounded and stripped to printable ASCII before it goes
anywhere near another client - the same rule that keeps the state hash honest is
a good rule for anything a stranger can type. The input lives outside the
rebuilt body, so typing into it survives the room changing under you, which it
does every time anybody readies, joins or leaves.

### The watchdog

`server/watch.js`, on by default for the server binary, findings at `/watch`. It
reads the state every tick and never writes it - watching a war cannot change
it, and there is a test that says so by hashing a watched war against an
unwatched one.

It looks for the shapes that mean the simulation has gone somewhere it should
not be: a hull off the map or under the sea, a negative store, a magazine
holding more than it can, more built than the slots allow, the war going quiet
for an implausibly long time, a tick slower than the tick it simulates. One
finding per KIND with the first tick and a count, because a playtest that trips
the same bug four hundred times should report it once.

**It earned itself on the first run.** A build paid for from "the island's own
stock, then the depot" spent the same materials TWICE when the site was itself
the stockpile island, leaving island stock negative from tick 13,401 onward.
Nothing in 339 tests had caught it; a full AI-vs-AI war under the watchdog
caught it in three seconds.

Its one remaining finding is real rather than a false alarm, and is for the
playtest to judge: **the endgame has a 60,000-tick lull** - nothing happened
between ticks 331,050 and 391,050 of a war that ended at 396,491.

---

## 2026-08-20 — Decoy flares

327 tests + smoke gate green. A warning you cannot act on is only bad news
delivered early; flares are what turn the missile-lock alarm into a decision.

`E` fires a burst. Every hostile heat-seeker within 900 m loses its lock and
**flies on blind** on whatever heading it was holding - it is not deleted, which
is both more honest and means a badly timed burst can still leave a round
arriving by luck. Three things make the timing a decision rather than a button:

- a burst is **24 ordnance** out of the same store that feeds the guns and
  rearms the aircraft, so defending yourself and arming yourself compete;
- the launchers take **240 ticks** to reload, so it is a moment you pick;
- the burst is **local**, so a salvo still on its way in is untouched.

The AI plays by the same rule and fires when something is locked on *and* close
enough for the burst to reach it. Firing at the moment of launch wastes it: the
missile is thirty seconds out and the launchers will not have reloaded when it
arrives.

The panel gained a launcher bar that fills as they reload, because what you need
to know in the half second after a warning is whether you may fire yet. The four
ship bars are now two columns: stacked, the fourth pushed the weapon line out
through the bottom of its own bezel.

---

## 2026-08-20 — A war room for LAN play

317 tests + smoke gate green. Adapted from multiciv's lobby
(`../multiciv/server/lobby.js`), cut down to the shape this game has: that
server hosts MANY games and needs a registry keyed by game id, while a Carrier
Dominion server hosts ONE war. What was worth keeping:

- **A join code** - five Crockford characters from the boot id, so a host reads
  it down a phone instead of dictating a URL.
- **A host seat** - the longest-seated player, computed rather than stored, so
  it cannot go stale and the room does not die when the host leaves.
- **Ready before sailing** - and one player alone is unanimous by definition,
  which is the same rule the clock vote already uses.

Changing the war unreadies the room: everybody had agreed to something else. A
value off the ladder is refused rather than clamped, because a silent clamp is
how a host ends up playing a different game from the one they set. The room
folds into a **ruleset** at the end, which is the same path the solo start menu
takes - a war is seed plus rules and nothing else.

`LOBBY=1` is the default for `server/index.js`; `createApp` still defaults to a
war that is already running, so every test, probe and the smoke gate are
untouched.

### Two bugs, and only one of them had a test that could have caught it

**The clock ran the whole time the lobby was open.** The game is built at
construction, and the clock pumped it regardless - so seats received snapshots
of a war nobody had agreed to, and pressing START looked like it had worked
because there was already a war on screen. The clock now declines to run a war
nobody has started.

**Lobby messages were being wrapped as game commands.** The client transport had
one send path, `send(command)`, which wraps everything as `{type:'command'}`.
The server answered every lobby click with "the war has not started" - correctly.
The socket tests could not catch this because they write raw JSON to the wire;
it took two real browsers in a probe. The transport now has a `sendMessage` that
puts a message on the wire as it is, and the lobby uses it.

---

## 2026-08-20 — Sound, and the missile-lock warning

302 tests + smoke gate green. No audio files: every sound is an oscillator and
an envelope, which is what a 1988 machine did and what keeps the repo a repo
rather than a media library. A sound is a few numbers - pitch, shape, length -
so it can be tuned by reading rather than by re-exporting a file.

Sound follows the **view's event list**, which is already fog-filtered: you hear
your own hulls firing and your own ship being hit, and nothing over the horizon.
Gunfire is throttled to one tone per 90 ms, because a hundred overlapping clicks
a second is noise rather than sound. `M` mutes.

**The missile-lock warning is the reason to have sound at all.** It is not an
event, it is a standing condition: a guided round is in the air with your ship's
name on it, and it repeats while that is true. The gunsight goes red and pulses
with it, so it is visible as well as audible.

That needed one new thing in the view, and it is a fog decision rather than a
sound one: a round aimed at YOUR ship is on your scope whether or not anything
of yours can see it, because the ship's own warning receiver is what sees it.
The first version of that check asked only "is it guided at a carrier", which
would have shown every side every missile in the war. It now checks whose
carrier - and a test covers both directions.

`client/sound.js` touches no DOM at all: the two-tone warning is scheduled on
the AUDIO clock rather than with a timer, which is sample-accurate and is why
the whole module can be tested in Node with a fake context.

---

## 2026-08-20 — The 1988 instrument panel

295 tests + smoke gate green. The HUD was a table of labelled numbers; it is now
a panel of instruments across the bottom of the screen, drawn on one 2D canvas.

**The rule the whole panel is built on:** an instrument says ONE thing, in a
shape you can read without stopping to parse it. A bar a third full, a schematic
with a red section, a compass point off the bow. The figures are still there for
when you want the exact number - they are not what you read the situation from.

- **Helm** (left): a heading-up compass rose, and bars for throttle, speed and
  fuel.
- **Scope** (centre): a plan-position indicator, north up, with range rings and
  a sweep. It is fed the **fog-filtered view** like everything else, so it
  cannot show a contact your hulls have not detected - there is no separate
  "radar truth". Its range is the ship's own radar, so it shrinks when the mast
  is shot away: the instrument tells the truth about the sensor.
- **Ship** (right): the damage schematic in plan - the always-on version of the
  `Z` board, no priorities and no numbers, just where the ship is hurt - beside
  bars for hull, ordnance and materials, and what the selected hull is holding.

Instrument colours are part of the art direction (`client/styles.js`), so the
panel changes with `?style=` along with everything else.

What is left of the old overlay is the DIAGNOSTIC strip: tick, hash, seed, fps,
graphics tier. That is the developer's view of a deterministic engine, and it is
a different audience from the ship's own instruments.

**One thing this broke and how it was caught:** the smoke gate proved the helm
answered by reading `#hud-throttle`, a cell that no longer exists. It now reads
the throttle out of the VIEW - a gate that fails when the panel is redesigned is
testing the wrong thing.

**One bug a screenshot caught:** the compass rose was mirrored. Engine bearings
grow counter-clockwise from east and counter-clockwise on screen is to the left,
so the sine has to be subtracted, not added. Facing east, north belongs at nine
o'clock; it was at three, and nothing but looking at it would have said so.

---

## 2026-08-20 — The virus bomb

295 tests + smoke gate green. The last 1988 payload, and the one that makes
taking an island a choice rather than a procedure.

| Payload | What it takes | What you get |
|---|---|---|
| ACCB pod | any island that is not yours | the island, **bare** - the previous owner's works are cleared |
| Virus bomb | an island somebody else **holds** | the island **intact** - factories, warehouses, stores, and the guns that were shooting at you |

The bomb takes twice as long as the pod (2400 ticks against 1200), which is the
whole trade: a longer wait, deeper inside somebody else's defended island, for a
prize that is already built. A conversion is abandoned if the island changes
hands under it - a virus needs a command centre to subvert, and the one it was
working on is gone.

The AI uses it the way you would: only when there is something on the island to
inherit. A bare rock gets the pod.

`B` deploys it. The Walrus sails with one of each and the hangar restocks both.

---

## 2026-08-20 — The clock is a table decision

286 tests + smoke gate green. Time compression in a shared war now moves when
**every player agrees**, and not before (ruling #24.5).

`server/vote.js` is deliberately pure and socket-free - a seat is any object
with a `team` and a `vote` - so the whole rule is testable without a network.
Three things fall out of it rather than being written into it:

- **A vote of one is unanimous by definition**, so a solo player still runs the
  clock as they like with no special case for it.
- **Spectators do not vote**, and do not block one either. They are watching
  somebody else's war.
- **Pausing is a speed like any other**, so stopping the clock takes the same
  agreement as speeding it up.

A seat arriving mid-vote resets it: everybody at the table has to agree, and
the newcomer has not been asked. A seat leaving settles it, because their
departure can complete a vote the rest had already reached.

The table is told where a vote stands (`2/3 for x4`), so nobody is left
wondering whether their key press did anything. Which is what the old message
did wrong: it said "refused", when the honest word was "proposed".

---

## 2026-08-20 — Defence islands, and the deadlock they exposed

276 tests + smoke gate green. Turrets were a number on a report; now they are
guns on the ground.

### A turret is a hull that cannot move

That is the whole design. It has a position, health, a magazine and a mount that
overheats, so it goes through the same firing, aiming and damage machinery as
everything else - no special case anywhere. They sit on a ring around the
command node, **alternating laser and missile**, so a defence island is
dangerous at both ranges: the missiles make a carrier plan around it, the lasers
make the approach cost something.

Turrets belong to the ISLAND. Take it and the previous owner's guns go with the
rest of their works: the reason to storm a defence island is to stop it
shooting, not to acquire it.

### The ratio that has to be legible

One mine could not feed a three-factory plant, so the AI built a plant and then
starved it. Two changes: a mine yields 60 materials (a resource-rich one 96,
against the 90 that three factories eat), and the AI only builds its third
factory when materials are actually piling up. The rule to remember is now
written into `data/economy.json`: **three factories need one rich mine, or two
plain ones.**

### The deadlock

An AI-vs-AI war ran to a permanent stop: both carriers afloat, both immobile at
zero fuel, neither able to win. Both sides had lost every lighter - and **the
parts to build a lighter arrive in a lighter**. No amount of reserve aboard
fixes that; a reserve runs out once, and it also silently resurrected the first
loss of the war for free.

The answer is that boats are not only built at sea. A depot holding the parts
launches one and it sails out to the ship. That is not an exception to ruling #3
- the fuel is still carried, by a boat, from the stockpile - it is what a supply
network is for. With it, a side that loses its whole logistics train recovers if
it still holds the industry, and the war resolves again: tick 396,491, won by
sinking.

---

## 2026-08-20 — Islands become something: roles, works, and replacement hulls

267 tests + smoke gate green. The largest untouched system in the game, and the
one that makes taking an island worth doing (ruling #24.1).

### What an island is FOR is now a decision

The ACCB pod builds the command centre; the command centre makes the island
yours; and then the owner picks one of three roles:

| Role | What it does | What it may build |
|---|---|---|
| Resource | mines materials into the network | warehouses |
| Factory | converts materials into fuel, munitions and **replacement hulls** | up to 3 factories, warehouses |
| Defence | nothing economic at all | up to 4 turrets |

The role can be changed until concrete is poured, and not after. Worldgen's
`kind` is no longer what an island produces - it is a **terrain bonus** when the
role suits the ground, so resource-rich rock rewards a mine and a natural
fortress rewards guns. Losing an island loses the works: the command centre is
what you took it for, but the previous owner's factories are theirs.

Factory throughput is **per factory built**, so three slots are three times the
plant rather than a label, and a factory island with nothing on it is a
building site.

### Replacement hulls close the loop

A factory makes chassis; the lighter carries them as a fourth good; the hangar
assembles one when there is a gap to fill. The unit RECORD is reused - ids are
stable for a whole war, so a Manta that comes back is the same Manta - and a
wrecked hangar deck cannot assemble anything. Losing an air group is no longer
permanent, provided you hold the industry to replace it.

### The AI develops its estate

`engine/ai_estate.js`. Without it the enemy takes islands, develops none, and
drifts out of fuel three hours in.

Two things it taught us, both fixed:

- **Sites could never be paid for.** A build came out of the island's own
  materials, but the cargo network ships a share of every island's stock to the
  stockpile every accrual - so a factory island could never accumulate the price
  of its own factory. The network that empties a site now also supplies it: the
  island's stock first, then the depot's.
- **Terrain-first planning starved a side.** If a team's islands all happened to
  be resource-rich, every one became a mine, no factory was ever planned, and
  the carrier ran on the trickle of crude a mine makes. The plant now comes
  second whatever the ground: a factory on poor ground beats no factory.

With both fixed the AI runs 2 mines and a 3-factory plant, and its fuel curve
turns back upward instead of sliding to zero.

### The board

Click an island you hold: role, works, stock, what is under construction, and
the choices open to you, priced. Same pattern as the damage board - rows built
once, not per frame, because a row rebuilt under the pointer cannot be clicked.

---

## 2026-08-20 — Targeting: the player is back in the loop

252 tests + smoke gate green. The original put the player in the targeting loop
at three levels, and all three are now here (ruling #21 a, b, c).

**Attack orders.** `order_unit_attack` designates an enemy unit or carrier; the
autopilot closes and engages it. The order *chases* - it re-aims at the target
every tick, because a target that is moving is the normal case - and it ENDS
when the target does, rather than sending an aircraft on to an empty patch of
sea. An order on something already dead is refused, so a stale click does
nothing.

**Boresight aiming.** Under direct control the round goes down the nose. A gun
always fires - aiming is the player's problem and a miss is a legitimate
outcome - while a missile needs a lock inside a 22-degree seeker cone, exactly
as a heat-seeker should. The seeker takes the target nearest the NOSE, not the
nearest target, so pointing the aircraft is the skill.

**Pointer mode.** `set_carrier_aim` gives the ship's laser a target the player
clicked; it prefers that while it lives and is in reach, and falls back to its
own judgement when it dies or is cleared. Clicking with a unit selected is an
attack order; clicking with nothing selected hands the contact to the ship's
laser.

`engine/targeting.js` holds all three, and the precedence is one function:
pilot's aim, then the attack order, then whatever the mount would have chosen.
The engine still picks for a hull nobody has an opinion about - that is what
makes an unattended Manta defend itself.

Client: an amber gunsight appears when you take the controls and turns red when
something is in the cone; `V` cycles the loadout; clicking an enemy attacks or
points the ship's laser.

---

## 2026-08-20 — The 1988 weapon sets

242 tests + smoke gate green. One weapon per hull kind is gone; each hull now
carries what the original gave it, and choosing between them is a decision.

| Hull | Loadout |
|---|---|
| Manta | laser / bouncing cluster bomb / napalm / heat-seeking missile |
| Walrus | cannon / mines (the ACCB pod is already its own thing) |
| Carrier | the 360-degree chemical laser |

Weapon records live once in `state.weapons`, indexed by weapon id, with
`state.loadouts` saying which ids each kind carries in cycle order. A hull keeps
only what differs between two identical airframes: which weapon is selected,
rounds of each, cooldown, and how hot the mount is. `V` cycles; the AI picks
missiles for a ship strike and falls back to the gun when the rails are empty.

Three behaviours are new, and all three are data rather than special cases:

- **splash** damages everything inside the blast, not only what it struck -
  cluster bombs and napalm.
- **trigger** is a mine: it does not fly, it waits, and it goes off for anyone
  who is not the side that laid it.
- **heat** puts the lasers - the Manta's and the ship's - out of action under
  sustained fire until they have cooled to a ready line. Burst discipline is
  the skill, exactly as the original had it.

`weapons.js` was past the size cap, so flight and damage moved to `shots.js`:
one module stops at the trigger, the other starts there.

### Three bugs worth recording

- **`guided` fell out of the weapon record** in the rewrite, so every missile
  flew straight at where its target had been and missed a moving Manta. The
  duel test caught it; nothing else would have until an AI-vs-AI war quietly
  got worse.
- **Autopilots seeded the beach with mines.** A mine's "target" is wherever the
  layer is standing, so auto-fire laid one every cooldown until the magazine was
  empty. Laying a mine is now a deliberate act, like deploying the pod.
- **Splash rounds detonated a full blast radius short.** The blast doubled as
  the proximity fuze, so a 120 m napalm canister went off 120 m out and missed
  everything behind the first target. A splash round now has to strike; the
  blast is what it damages, not what sets it off.

---

## 2026-08-20 — The damage board, as the original had it (rulings #21-#23)

226 tests + smoke gate green. Four answers came back; three changed the build.

### Point defence stays automatic; the autopilot defends itself

The line is not the airframe, it is the cockpit. A Manta with somebody in it
fires when that somebody says so; an unattended one defends itself AND presses
home the attack it was sent on. A ship's point defence and a Walrus gun never
wait — nobody asks a close-in mount for permission. One function says it:
`needsTrigger(unit)` is true only when `unit.control !== -1`.

### Seven geometric sections

The five functional ones are gone. Now, as the 1988 damage screen had them:
**bow, midship, stern, port, starboard, topside, engine**. An impact is resolved
in the ship's own frame — height first (anything above the deck hits the island
and the mast), then the beam, then how far forward — so **which way you turn
matters in both axes**, not just fore and aft.

Two consequences follow from a section's health, and the split is what makes
seven geometric sections work where five functional ones did:

1. **Systems**, on the sections that carry one — bow the point-defence mount,
   midship the hangar deck, stern the steering gear, topside the mast and
   sensors, engine the machinery. Exactly as the original named consequences for
   the engine and the weapon sections and left the rest as structure.
2. **Armour**, on *every* section including the bare plating of the sides: a
   hit on a wrecked section does up to half as much again to the hull. That is
   what makes presenting your good side worth doing, and it needs no new system
   to say it. Port and starboard would otherwise have been decoration.

### The automatic repair system

The original did not repair a ship the instant a boat touched alongside, and
neither do we any more. Materials now land in the **ship's own yard stores**;
`engine/repair.js` spends them at 8 points per 100 ticks, working through the
board in the priority the player set — **high, then medium, then low, worst
first inside each tier** — sections before plating. The lighter's job ends at
the store. New command `set_repair_priority`. `repairPerMinute`, which had sat
unused in `data/units.json` since Milestone 0, is gone: the rate is now
`repairPointsPer100Ticks`, in the same per-100-ticks form as fuel burn and
magazine reloading, so all three accumulate the same way.

### The board itself

`Z` opens it: a slowly turning **3D wireframe** of the ship, one box per
section, coloured green/amber/red by damage, with the list underneath showing
percentage and priority. Click a box on the model or a row in the list to cycle
LOW → MED → HIGH. A section on LOW is dimmed on the model, so the priorities
read off the ship and not only the list.

It is `Mesh` with `wireframe: true` rather than `LineSegments` for a reason:
it draws as wire and still raycasts as a solid, so a section can simply be
clicked.

**One bug the probe caught, and it would have bitten a real player.** The list
rows were rebuilt from scratch every frame, so the element under the pointer was
replaced sixty times a second and a click landed on a node that had already been
thrown away. Rows are now built once and only their text rewritten.

**Effect on the war:** faster and still decisive — AI-vs-AI resolves at tick
180,203, won by sinking.

---

## 2026-08-19 — Rulings #17, #18, #19: supply, the trigger, and damaged sections

227 tests + smoke gate green. Three rulings, three slices, in that order.

### #17 Ordnance is carried, not conjured

Rearming was free, so air power was unlimited and a carrier that emptied its
600-round magazine was defenceless for the rest of the war — which is literally
what decided the measured war.

Now the carrier holds an ordnance store (6000, full at start). Rearming a hull
is a withdrawal: 25 per Manta missile, 1 per gun round, and **partial rearms are
normal** — you take what there is. Point defence is fed from the same store at
40 rounds per 100 ticks, because a ship does not teleport shells to the mounts.
The lighter now carries ordnance alongside fuel and materials, in priority
order: fuel moves the ship, ordnance keeps it dangerous, materials put it back
together. The AI calls a run on whichever of fuel or ordnance is emptier.

The withdrawal threshold went from a third of the hull to half. Measured, not
guessed: with point defence reloading, both sides still died together at a
third, because a four-Manta wave carries 640 damage against 1000 hull.

### #18 A Manta fires for its pilot

Auto-fire was blanket. It is now the rule only for hulls that defend themselves
without being asked — a ship's point defence, a Walrus gun. A Manta shoots for
whoever is flying it: the player (`F`), or the AI agent that launched it, which
pulls the trigger in `manageStrike`.

Cooling down had to be split from choosing to shoot. They were the same branch,
so a trigger-fired Manta that was never fired would never have become ready
again. New command `fire_unit`, routed through the existing ownership check.

Target *selection* stays in the engine — nearest enemy in range this weapon can
engage — because that is not the decision the ruling was about.

### #19 Damaged sections

`engine/damage.js`. Five sections laid out along the ship, stern to bow:
engines, hangar, bridge, radar, guns. Where a round lands decides which one
takes it — the impact is projected onto the ship's own axis and read off in
fifths of her length — so **the aspect you present to an enemy is a real
decision**.

A hit costs the general hull its full damage and the section a 60% share, so
"mechanically wrecked but afloat" and "nearly sunk but still fighting" are
different states and the player can tell them apart.

| Section | What it costs you |
|---|---|
| engines | top speed, down to a 25% floor — a wrecked engine room still limps |
| bridge | rudder response, floor 30% |
| radar | detection range, floor 15%; at zero you are blind |
| hangar | binary: a wrecked hangar deck is a closed one, nothing launches or lands |
| guns | point defence slows as the mount is chewed up, then stops |

`maxSpeed`, `turnRate` and `radar` are **derived** onto the carrier record from
untouched base values whenever damage or repair moves, so the helm, the fog
filter and the AI keep reading them directly and know nothing about sections.

Materials landed by the lighter now repair the worst-damaged section first and
the plating second — a ship that cannot move, see, or fly its aircraft is in
worse trouble than one with dents. The HUD gained a damage row
(`eng OUT hgr 71 brg 93 rdr OUT gun 36`); an enemy contact reports `[]`, because
what is broken aboard an enemy ship is exactly what you would most like to know.

**Effect on the war:** decisive and faster. AI-vs-AI now resolves at tick
165,348 (was 233,987), won by sinking, with the loser's sections knocked out
before its hull ran out.

---

## 2026-08-19 — Weapons and damage (M1)

210 tests + smoke gate green. The last big hole in Milestone 1: hulls could be
sunk by running aground, and by nothing else.

### The shape of it

`data/weapons.json` gives each hull kind one weapon. The stats live once in
`state.weapons`, indexed by unit KIND, and a hull carries only `ammo` and
`cooldown` — two integers instead of eleven copied fields, which keeps the
state hash small and the records readable.

A shot is an entity with a life, not an instant line-of-fire test: it flies, it
can miss, and it can be outrun. `life = range / speed`, so a round that misses
runs out of flight instead of being deleted by a special case. Guided rounds
(the Manta's missiles) re-aim within a turn rate each tick; when their target
dies they fly on straight rather than vanishing.

Hit tests are against the **segment travelled this tick**, never the endpoint.
A missile covers 15 m per tick and a Manta is 12 m across, so an endpoint test
would let shots tunnel through their targets — the whole reason for
`segmentDistSq`, which is integer-only and keeps its parameter as a
numerator/denominator pair rather than a fraction.

Classes are by KIND, not altitude: a Walrus gun cannot elevate onto a Manta
whether that Manta is at 400 m or sitting on the deck. That is what makes a
lone Walrus ashore worth escorting.

Tick order gained one step: `stepUnits → stepWeapons → stepCapture`. After
movement, so a hull that just closed to range gets to use it; before capture,
so a Walrus killed on the beach cannot also plant its pod on the tick it died.

### The AI now fights

`engine/ai_strike.js` (split out to keep both AI modules under the size cap):
find the nearest **spotted** enemy carrier — same sensor rule the fog filter
uses, so the AI learns nothing a player would not — launch two Mantas, and vector
them at it. It never manoeuvres the carrier to attack; the carrier is the
airfield.

### Three things the first AI-vs-AI run after weapons taught us

- **The war stopped ending.** Both carriers sank, often on the same tick, and
  `checkVictory` had no case for "nobody afloat" — so it ran 900,000 ticks and
  declared nothing. `WIN_DRAW` now ends it honestly.
- **Trading to the death was the only tactic.** Added `withdraw`: below a third
  of its hull the AI turns directly away, recalls the air group, and calls for
  supply — the lighter brings materials, and materials are hull repair. With
  that in, the war resolves again at tick ~234,000, won by sinking.
- **A carrier that empties its magazine is defenceless forever.** Point defence
  is 600 rounds and nothing refills it. The war above was decided by exactly
  that. Ordnance is already produced by factories and stockpiled on islands, so
  ferrying it is the obvious next slice — recorded as question #17.

### And one from the probe

`combat_shot.mjs` ran on a pocket map and won the war on tick zero holding no
islands: two thirds of a one-island map rounds down to a threshold of nothing.
`checkVictory` now floors the requirement at one island.

---

## 2026-08-19 — Art direction as data, and the port claim (rulings #13, #6)

198 tests + smoke gate green. Nothing here touches the simulation: two players
on different styles see the same war and the same state hash.

**Ruling, same day:** retro is the game's look and is now the default; the
other two stay switchable. Scope is **look only** — no instrument rebuild, no
sea state, no weather, until asked. The carrier stays slow (8 kn) because time
compression, not speed, is the answer to the waiting.

### Three styles, switchable, not described

Ruling #13 asked for options and samples. `client/styles.js` holds them as
data — `retro` (1988), `modern` (the look so far), `hybrid` (a remaster) —
each a flat record of sky, fog scale, ocean treatment, shading, palette steps,
light intensities and HUD colour/font tokens. `?style=retro|modern|hybrid`
picks one; `applyStyleToDocument` pushes the instrument colours into CSS vars
so the HUD matches the scene. `client/render/world.js` and `scene.js` take the
style as an argument rather than reading a global.

`debugging/probes/style_shots.mjs` renders three shots per style (open sea,
closing with land, strategic) into `debugging/shots/styles/`. Passing a style
name re-shoots just that one while a look is being tuned.

### Three real rendering bugs the samples exposed

- **The sea was moire, not water.** A 100 m ripple seen from 7 km crosses
  several waves per pixel; the whole ocean turned into banding. Both the swell
  and the ripple now fade out with camera distance, and the ripple's wavelength
  went from ~100 m to ~450 m. Detail below a pixel is noise, not detail.
- **The retro grid only existed in the distance** — the one place it does
  nothing. `GridHelper` draws lines that span the whole map, so the ones beside
  the ship have an endpoint far behind the camera, and line clipping drops the
  whole segment. The grid is now built by hand, cut at every crossing, ~40k
  vertices once, and fades out at range so the far cells do not pile into a
  slab of blue along the horizon. This is what makes the 1988 option look like
  1988; without it, "retro" was just a dark sea.
- **The client sized the world from `rules.world.sizeMetres`** — the *base*
  size, not the scaled size from ruling #2. With more islands than the base
  count, the ocean plane and grid would have stopped short of the map's far
  corners. Now `worldSizeMetres(rules.world)`, the same function the engine
  uses. Latent at 8 islands; a visible hole at 16.

`window.__scene3d` now exposes the scene graph for render probes. That is how
the grid bug was diagnosed — reasoning about it produced four wrong theories in
a row, and one `page.evaluate` produced the answer.

### Port: 8135, not 8132

8132 is boombrawl's and 8133 is Sunset Runner's. Carrier Dominion claims
**8135**, recorded in the ledger of record — `game-ops/RetroMultiCiv/
multi-game-hosting.md` — with 8134 deliberately left free and labelled as such
so the next game takes it rather than skipping to 8136. `server/index.js` and
`run.sh` default to 8135; `PORT=` still overrides. `CarrierDominion/ops` is now
a symlink into the private `game-ops` repo, so the port row and deploy notes
live with the other games' rather than in a gitignored island of their own.

---

## 2026-08-19 — Milestone 1: the economy loop closes

Islands now pay for the ship, and the ship takes islands. 149 tests green.

`data/economy.json` gives each island kind an income row — resource islands pay
fuel and materials, factories pay materials and ordnance, radar and airfield
islands pay nothing because their value is sight and reach. A carrier lying
within 900 m of an island its team owns draws fuel from the stores and patches
its hull.

Two decisions worth recording:

- **Income accrues in a lump every 100 ticks**, not as a fraction every tick.
  With integer resources the two are identical, and the lump needs no per-team
  accumulator in state: one less field to forget in `copyState`, and a hash
  that does not churn on 19 ticks out of 20.
- **The carrier carries its own `maxHull`**, like every other stat. The repair
  cap could have come from the ruleset, but then the reducer would need the
  ruleset, and the whole point of snapshotting stats onto records is that
  `apply` never reaches outside the state it was given.

The tests caught the thing that always catches economy tests: a carrier burns
fuel while it sits there, and the idle-burn window is exactly the accrual
window, so every resupply figure has to account for it. `IDLE_BURN` is spelled
out at the top of `test/engine_economy.test.js` for the next person.

---

## 2026-08-19 — Milestone 1: an enemy, and a way to win

It is a game now: the other carrier plays, and somebody wins. 139 tests green,
smoke gate green.

### The AI carrier

`engine/ai_carrier.js` is a three-state machine — SEEK an island, INVADE it
with a Walrus, WAIT for the pod — running **inside the reducer** on the 3-tick
cadence, exactly as `plan-version1.md` §2.4 called for. That placement is the
whole point: the AI is part of the deterministic war, so every replay, every
golden hash, and every headless sim covers it. There is no separate AI process
to desync.

`engine/victory.js` ends the war two ways: hold two-thirds of the islands, or
be the last carrier afloat. The second is unreachable until weapons exist, but
wiring it now means the end-of-war path has tests from the start.

### The bug that justified the trace probe

The first AI took an island, turned for the next one, **ran aground on the
island it had just captured, and sat there for three hours of game time** with
the throttle at 40%. The brain kept steering at the target; the hull kept
refusing to move; nothing in the state machine could see the contradiction.

`debugging/probes/ai_trace.mjs` prints a line whenever the brain's situation
changes, and the fault was obvious in ten lines of output — a carrier at a
fixed position, throttle up, speed zero, grounded, forever.

The fix is `backOff`: aground, the carrier commits to a course straight out to
sea for 6000 ticks before the brain gets the helm back. The commitment has to
be that long because a carrier needs over a thousand ticks just to come about,
and a shorter escape puts it back on the same shelf on the next leg. It is the
same shape as the Walrus's contour-following: **the pattern that keeps
appearing is "when blocked, commit to an escape for long enough to matter".**

After the fix the AI takes all five islands it needs and wins at tick 361,000.

### Measurements

| | |
|---|---|
| AI takes its first island | tick 74,438 |
| AI vs AI, war decided | tick 338,375 (4.7 h of game time) |
| Headless tick rate, AI active | ~2,400 ticks/s (120x real time) |

The tick rate is down from 20,000/s because the AI's carrier now steams near
islands, where terrain sampling stops early-outing. Still ample, but the sweep
batteries planned for balance work will feel it — a memoised terrain sample is
the obvious lever when they do.

---

## 2026-08-19 — Milestone 1, first two groups: units, and taking an island

The game is now playable end to end: steam to an island, put a Walrus in the
water, drive it up the beach to the command node, deploy an ACCB pod, hold
while it builds, own the island. `test/integration_capture.test.js` does
exactly that through commands only - no reaching into state - and is the single
most valuable test in the suite.

127 tests green, smoke gate green.

### S1.1 Units: Manta and Walrus

Every airframe and vehicle exists from tick zero, STOWED in a hangar. Launching
is a state change, not a spawn: ids are stable for a whole war, a lost Manta is
a record rather than a missing one, and the fog filter has one less special
case.

- `engine/units.js` - records, life cycle, orders, fuel.
- `engine/flight.js` - Manta. Sim-lite: thrust, turn rate, a separate altitude
  axis, no stall. Runs dry over the sea and it is gone.
- `engine/drive.js` - Walrus. Swims, crawls ashore at a lower speed, refuses
  slopes past its climb limit.
- `engine/hangar.js` - launch geometry, recovery, refuel and re-arm.
- `engine/fleet.js` - one tick per unit. A returning unit re-aims at its
  carrier EVERY tick, because the carrier it is chasing is under way.

Two bugs worth remembering, both in the Walrus:

1. **Slope measured per-step deadlocked it.** Integer terrain rises by at least
   one unit, so at speed 3 a one-unit step reads as a 333-per-mil cliff: stop,
   accelerate, re-block, forever. Slope is now measured over a FIXED 2 m probe.
2. **A blocked Walrus never got anywhere**, because the autopilot kept steering
   into the same rock. It now looks 45 degrees either way, commits to the
   gentler side for 80 ticks, and follows the contour until the way up opens.
   Not path-finding - a driver, and a deterministic one.

### S1.2 Direct control

`take_control` / `release_control` / `set_unit_helm`, with the chase camera
following whatever the player is actually flying. The helm keys drive the
piloted unit when there is one and the carrier's own helm otherwise, so there
is one set of controls rather than two modes to learn.

### S1.3 Islands and the ACCB pod (ruling Q9)

A command node per island, placed at worldgen by scanning a fixed ring of
candidates for somewhere ashore, flat, and not on the summit - putting it on
the peak looks right and makes some islands impossible to capture.

A Walrus carries one pod, deploys it within 60 m of the node, and the pod
builds over 1200 ticks (a minute). An enemy pod deploying displaces one that is
still building and restarts the clock - the peaceful race; combat will provide
the louder answer later.

### Terrain: two changes that were really gameplay changes

- **A skirt of shallow water** around every island (to 1.6 radii). Without it
  the seabed was a 200 m cliff at the shoreline, which reads fine but means a
  Walrus meets an unclimbable wall at the beach and a carrier can anchor with
  its bow touching the sand. The skirt is what makes "keep the ship off the
  shallows" a real constraint - and it immediately found that the seed's
  spawn had a shoal 200 m off the bow, so `startPositions` now clears the
  shelf, not just the shore.
- **A warped coastline.** The distance from the island centre is displaced by a
  coarse noise field before the falloff is applied, which costs one noise
  sample and turns a bullseye dome into something with bays and headlands.

### Two rendering bugs the screenshots caught

- **Islands were invisible from above and unlit from the side.** Engine north
  maps to three.js -z, which flips the handedness of the terrain grid, so the
  naive triangle winding faced the seabed. Winding decides both which side is
  culled and which way `computeVertexNormals` points.
- **The strategic view showed an empty ocean** - same cause. Worth noting that
  neither bug could fail a headless test; both were found by looking at the
  smoke gate's screenshots, which is the argument for taking them.

### What this told us about pacing

The integration test reports its timings: a 7.6 km crossing takes **20,561
ticks (17 minutes)**, the Walrus run ashore another **15,518 (13 minutes)**,
the pod **1,200 (1 minute)**. Taking one island is half an hour of real time at
1x. That is the strongest evidence yet for time compression - it is question 1
in `dev-questions.md` and now has numbers behind it.

---

## 2026-08-19 — Milestone 0 complete (S0.1 … S0.8)

A carrier drives across a procedural ocean past procedural islands, in a
browser, driven end to end through both transports. 100 tests green plus the
browser smoke gate.

### S0.1 Repo scaffold

`package.json` (one runtime dependency: `ws`), `run.sh`, `README.md`, the
directory layout from the plan, `node --test` wiring, `/healthz`.

three.js is **vendored, not npm'd**: `client/vendor/three.module.min.js` is
r162, copied from multiciv, reached through an importmap. The client therefore
has zero install-time dependencies.

### S0.2 shared/

- `fixed.js` — 256 units = 1 m, 16-bit BAM angles, `floorDiv`/`truncDiv`,
  `mulDiv` with an exact-range assertion, `isqrt`, `turnToward`, `stepToward`.
  Every division normalises negative zero away at the source: `-0` compares
  equal to `0` but is not the same value everywhere, and it leaks in through
  `Math.floor(-0/n)`.
- `prng.js` — xorshift32 with the state in game state, `deriveSeed` for
  independent streams so adding a subsystem that rolls does not shift every
  other subsystem's numbers.
- `trig.js` + `trig_table.js` (generated by `tools/gen_trig.mjs`) — a committed
  1025-entry quadrant sine table plus a 257-entry arctangent table, integer
  linear interpolation between entries. Worst observed error vs `Math.sin`:
  well inside the 8/65536 tolerance the test pins.
- `statehash.js` — canonical string + FNV-1a **64** in 16-bit limbs. The FNV
  vectors for `""`, `"a"`, `"foobar"` are asserted, so the limb arithmetic is
  checked against the published algorithm rather than against itself.
- `noise.js` — integer value noise and fbm, shared by collision and mesher.
- `view.js` — per-team fog filtering, the only thing a client ever receives.

### S0.3 Reducer

`apply(state, command) -> state`, pure; `copyState` deep-copies every nested
array and object; commands validated and **dropped, never thrown on** (they
arrive from the network); events are integers in state so they are hashed and
replayed.

`test/fixtures/m0a.json` pins the state hash after each of 300 scripted ticks.
`tools/repin_m0a.mjs` refuses to re-pin when the **event stream** moved rather
than just the numbers — that is the signal that behaviour changed and wants an
explanation here first.

### S0.4 Worldgen

Dart-throwing with a minimum-separation reject. Terrain is a **pure function**
of the island's dozen integers — radial falloff times fbm — so no heightmap
grid is stored in state, the state hash stays small, and the client mesher and
the server's collision cannot disagree about where the beach is.

Golden world hash for seed 20260818: `94fca572b0e7ebf2`.

### S0.5 Carrier and helm

Turn, accelerate, translate, test the seabed, burn fuel — in that order,
and the order is part of the hash.

Grounding took two attempts. The first version tested only the next position;
at one unit per tick a hull creeps into a shoal and re-reports grounding every
tick. The fix tests a point 250 m ahead of the bow, so a ship held against a
shore stays grounded, reports **once**, and clears only when steered away.

### S0.6 Transports

One interface, two drivers. `createLocalTransport` runs the real engine in the
browser tab; `createWsTransport` talks to the authoritative server. Both feed
the renderer the same fog-filtered view object, and both run the same
`engine/authority.js` check — solo play has nobody to cheat, but running the
check there means a bug in a command path cannot hide until the LAN game finds
it.

`engine/authority.js` sits in `engine/` rather than `server/` precisely because
the browser loads the same file.

### S0.7 Client

three.js scene, shader ocean (medium/high) or flat ocean (low), island meshes
sampled from `engine/heightmap.js`, placeholder carrier, chase camera and a
strategic pull-back, WASD helm through the transport, and the three graphics
presets with multiciv's GPU auto-detect and a persisted override.

Two rendering bugs found and fixed by looking at the smoke screenshots:

- **Heading was mirrored.** Flipping engine north onto three.js `-z` also flips
  the sense of rotation, and the two negations cancel — so yaw is the heading
  unnegated. The first version negated it and every ship sailed backwards.
- **Everything was a silhouette.** The directional light aimed at the scene
  origin, which is the map's south-west *corner*, not its middle. It now aims
  at the map centre, with a weak fill from the opposite quarter.

### S0.8 Gates

`test/client_smoke.mjs` starts a real server on an ephemeral port, loads the
real client in Chromium, fails on **any** console error, page exception, or
failed request, drives the helm through the keyboard and asserts the engine
answered, checks the WebGL context is alive, and screenshots both transports to
`debugging/shots/`. It skips (exit 0) where Playwright browsers are absent.

`test/headless/sim_m0.mjs` runs the war headless: 6000 ticks in ~300 ms, about
1000x real time, which is the number that matters for future AI-vs-AI sweeps.

### Deviations from plan-version1.md

1. **Hashing.** The plan inherited Fireline's hand-maintained field list. I used
   multiciv's whole-state canonical walk instead: a new field cannot be
   forgotten by the hash, and the walk doubles as the hygiene assertion.
   `trajectoryHash` and `behaviorHash` cover the cases the field list was for.
2. **three.js r162**, vendored from multiciv, rather than `^0.165` from npm.
3. **No heightmap in state.** The plan's state sketch had a `heightmapRef`;
   terrain turned out to need no storage at all.

Both are recorded in `dev-questions.md` for the owner to confirm or reverse.
