# 02 — The war as built

Every number here is in `data/*.json`. None of them is in engine code.

## The fleet

| Hull | Speed | Carries |
|---|---|---|
| Carrier | 8 knots flat out | 4 Mantas, 4 Walruses, 2 lighters, and every store |
| Manta | 243 kn | laser / cluster bomb / napalm / heat-seeking missile |
| Walrus | 36 km/h afloat, 48 ashore | cannon / mines, plus an ACCB pod and a virus bomb |
| Lighter | 36 km/h | nothing — it is the logistics boat, and protecting it is the point |

The carrier is deliberately slow (owner ruling): time compression is the answer
to the waiting, not a faster ship.

## The home island

The Strategy game starts each team on **one developed base** (proposal 3a,
ruled 2026-08-25 — the original's Base island): its nearest island comes
owned, role Factory with one plant, a runway, two turrets, a modest stock,
the depot nomination, and the supply run already running — the two lighters
sailing at tick 1 are the first thing a new war does. The opening race is
for the **second** island, not the first pod. The Action Game keeps its own
round-robin estates; `homeIslandStart: 0` gives the old bare ocean (the
engine tests build on it via `bareRules()`).

Measured consequence (five-seed battery): AI-vs-AI wars now resolve between
ticks 35,006 and 116,271 (was 33k–231k) — economies that start alive fight
sooner and settle faster; early lulls grow (both sides build before
contact) but stay under the watchdog's scaled window.

## Taking an island

Two ways, and they answer different questions.

| Payload | Works on | You get | Time | Costs the ship |
|---|---|---|---|---|
| **ACCB pod** (`P`) | any island that is not yours | the island **bare** — the previous owner's works are cleared | 1200 ticks | 80 materials per replacement |
| **Virus bomb** (`B`) | one somebody else **holds** | the island **intact** — factories, warehouses, stores, and the turrets that were shooting at you | 2400 ticks | 120 ordnance, every one |

Both are deployed by a Walrus within 60 m of the command node. A Walrus sails
with a pod as standard complement but **buys every virus bomb** — both are
issued at the ramp, only when missing, and only when the store can pay. A pod
being built is displaced by an enemy pod, which restarts the clock for the
newcomer. A second bomb on a conversion your side already has running is
**refused**, not spent — it would only reset your own clock. A conversion is
abandoned on **any** change of owner — recapture, a rival's pod, anyone — the
bomb remembers whose command centre it went in against, and a different owner
is a different command centre.

**The third way** (second source review, item 1): destroy the command
centre. An owned island's centre stands at the node with
`commandCentreHp` (400) of Neutron Shielding; enemy fire that reaches the
node — a strafing run down the boresight, a cluster or napalm blast —
chews it down, and when it falls **the island is nobody's**: works and
guns go with it (CRASH: "the missile launchers blow up") and the bare
rock takes an ACCB like any other. Bombardment is an alternative to a
landing, not just its escort. A neutral island has only a marker mast:
nothing to shoot. The centre's death is chart-level news, like a capture.

## What an island is for

The command centre makes it yours. What it is FOR is then the owner's decision,
and the role is settled once anything is built on it.

| Role | Produces | May build |
|---|---|---|
| Resource | materials, a little fuel | warehouses |
| Factory | fuel, ordnance, **replacement hulls** — per factory built | up to 3 factories, 2 warehouses |
| Defence | nothing at all | up to 4 turrets — a gun shot away frees its slot |

Worldgen's `kind` no longer decides output; it is a **terrain bonus** when the
role suits the ground, so resource-rich rock rewards a mine and a natural
fortress rewards guns.

**The ratio to remember:** three factories eat 90 materials per accrual, which
is one resource-rich mine or two plain ones. Building a plant you cannot feed is
the mistake the AI made until it was taught otherwise.

A site is paid for from the island's own materials first, then the team's
stockpile island — the network that empties a site is the same one that supplies
it. (Paying from the island alone deadlocked: the cargo network ships a share of
every island's stock to the stockpile each accrual, so a factory island could
never save up for its own factory.)

## The supply chain

Ruling #3, and the spine of the whole game: **nothing is conjured.**

```
resource island  mines materials
factory island   converts materials -> fuel, ordnance, chassis
cargo network    ships a share of every island's stock to the stockpile island
lighter          ferries fuel, ordnance, materials and chassis to the carrier
carrier          burns fuel, feeds its magazines, repairs itself, rebuilds hulls
```

Goods have a **location**. Losing the island that was making your fuel costs you
the fuel it had not shipped yet; losing the stockpile strands everything
upstream of it. The network ships each accrual's share only as far as the depot
has **room** — a full depot leaves goods where they are, so stock piling up at
the mine is the visible signal that the depot needs a warehouse.

**Site the stockpile at the factory.** The network ships everything toward the
depot, and a factory refines only what is piled on its own ground — a depot at
the mine starves the plant on its own eight-a-beat trickle while sixty a beat
sit under the digger. The AI learned this the measured way: both its carriers
drifted to zero fuel with materials at capacity until it was taught to put the
depot at the plant.

The same rule reaches the flight deck: **everything a unit takes aboard comes
out of the ship's stores.** Recovery refuels from the bunker (a short bunker
buys a partial tank, like a partial rearm), a rebuilt hull comes off the line
empty and is fuelled and armed from stores — the chassis pays for the airframe,
not the war load — and an empty tank stays on the deck. The ship sails with a
finite materials issue (400), like its bunker and its ordnance. The lighter
bunkers its own tank at the **depot**, not from the carrier: its tank is a
fifth of the ship's, and a network that drinks the bunker it exists to fill is
not a network.

A side that loses every lighter would be unable to receive the parts to build a
lighter — parts arrive in a lighter. So a depot holding the parts **launches one
itself** (fuelled from the depot's own stock) and it sails out to the ship. That
is not an exception to the ruling; it is what a supply network is for.

## The telemetry leash

Mantas and Walruses are **drones**, flown over a link from the carrier
(manual coverage review, item 1 — the original's deepest control principle).
Past `telemetryFadeMetres` (20 km) the picture degrades and the cockpit says
so; past `telemetryLossMetres` (26 km) the link is gone and the craft
**self-destructs** rather than fall into enemy hands. It is what forces the
carrier itself to sail into danger: the air group is a hand, not a longer
arm. The lighter is exempt — the original's transfer drone was
semi-submersible and autonomous, and so is ours — and a craft whose carrier
has SUNK has no signal source at all. The AI obeys the same leash: it
recalls a drone past the fade line and declines errands beyond it. On the
8-island sea the map is smaller than the leash, so nothing changes there;
the leash is what shapes the 32- and 64-island oceans. `telemetryLossMetres:
0` switches it off. (The original's Long-Range Communication Pod — one
aircraft freed of the leash — is a natural future refit; noted, not built.)

## Island runways

Resource and Defence islands can build a **runway** (`build_on_island` kind
6 — the original's Command Centres built them on exactly those islands).
With a Manta selected, a click on a friendly runway island is an
**approach**, not a board: the aircraft slows to minimum flying speed
inside 2 km — without the slowdown its turning circle exceeds the capture
ring and it orbits the airfield until the tank is dry, which was measured —
and the strip catches it inside 500 m of the node. Down, it refuels from
the island's **own fuel stock** (goods have a location; this fuel never
touched the carrier's bunker), and any new order is a relaunch. While
parked the island's Command Centre holds it: **no telemetry to lose**,
which is what makes island-hopping the answer to the leash — exactly the
original's range game. A parked Manta is a target like any other, and an
airfield captured with aircraft on it captures the aircraft.

## The Hammerhead and the Viewing Drone

The carrier's heavy surface arm (proposal 5, ruled 2026-08-25,
player-only). `3` sends a **Viewing Drone** up — an aerostat, two aboard,
that climbs to 600 m and drifts down over two minutes; by the kind rule it
is AIR, so lasers and seekers can take the eye out, and it is exempt from
the telemetry leash because it does not ride the relay, it *is* one. While
it is up the **DRONE tab** stands on the camera row: straight down from
the aerostat, north up, crosshair cursor, the console reading rounds and
endurance — and **a click is the trigger**: a Hammerhead at the point,
refused if the mark is outside the drone's 4 km picture or the missile's
8 km reach, sixty damage in a sixty-metre blast, forty ordnance a round,
four rounds aboard, a hundred ticks on the rail between launches. The AI
does not use it — a human toy first, as ruled.

## The helm has an autopilot

The original's map + PROG + A, collapsed to one click: with nothing selected,
a click on open water lays a **course** for the ship. The autopilot steers for
the mark every tick; the **throttle stays yours**. Any hand on the rudder or
the heading drops the course — the helm is one authority — and so does
running aground: the autopilot has no answer to a shoal, so it disengages and
says so rather than holding the wheel against the rocks. Arrival takes the
way off and hands back the wheel. The mark rides on the scope as a hollow
diamond.

## The quartermaster

The light version of the original's Stores mode (ruling 2026-08-23). `Q`
opens it: every island you hold with its stock and role, which one is the
depot (click a row to move it), and the **production bias** — Low / Medium /
High per factory output category. Each factory run's three outputs are
reweighted by the bias, normalised so all-Medium is exactly the unbias plant;
Low starves an output entirely, and all-Low idles the plant **without eating
materials** — an order to make nothing is an order to stop, not to waste.

Deliberate deviation from 1988, by ruling: fuel stays ONE good with automatic
issue — no carrier/aircraft/AAV pools, no manual transfer screen. The
scarcity is identical; the menu work is not.

## The refit yard

Three carrier upgrades (ruling 2026-08-23): **speed**, **point defence**, and
**radar range**. Each is manufactured like any other build — `build_on_island`
kinds 3/4/5 at a factory island that has a plant, paid from that island's
materials — and fitted to the ship when the yard finishes. Once each — and once each
means once **ordered**, not once fitted: while one yard builds your speed
refit, every other yard refuses the same order (third review — the
fitted-only check let an impatient double-click pay for two engines). The
UPGRADES rows in the quartermaster show FITTED / BUILDING / needs-plant /
the cost.

The AI buys the same refits (ruling 2026-08-23): a finished plant with twice
the price in materials on the ground lays one down — speed first, since
where the ship can be is the AI's whole game — and never at the cost of the
chassis line. Measured: seed 900913's AI-vs-AI draw became a decisive war
once both commanders could refit.

A refit raises the system's **base**, not its current value: damage still
degrades an upgraded engine room or radar from the upgraded figure, exactly
as it degraded the original. The fuller tech tree is a noted later
consideration, not a design.

## Weapons

The 1988 sets, as data in `data/weapons.json`. Three behaviours, all data rather
than special cases:

- **splash** damages everything inside the blast, not only what it struck
  (cluster bomb, napalm, mines). A splash round has to *strike*: fuzing on its
  own 120 m blast made a napalm canister go off 120 m short of everything.
- **trigger** is a mine — it does not fly, it waits, and it goes off for anyone
  who is not the side that laid it. Autopilots never lay them; laying one is a
  deliberate act, like deploying the pod.
- **heat** puts a laser out of action under sustained fire until it has cooled
  to a ready line. Burst discipline is the skill.

Engagement classes go by **KIND, not altitude**: a Walrus gun cannot elevate
onto a Manta whether that Manta is at cruise or sitting on the deck. That is
what makes a lone Walrus ashore worth escorting.

A shot is an entity with a life, not a line-of-fire test: it flies, it can miss,
and it can be outrun. `life = range / speed`, so a round that misses runs out of
flight rather than being deleted by a special case. Hit tests are against the
**segment travelled this tick** — a missile covers 15 m per tick and a Manta is
12 m across, so an endpoint test would tunnel straight through.

A **piloted** Manta also answers the stick vertically: climb toward the
800 m ceiling, dive toward the 12 m wavetops, hold what you have — and the
same contour rule out-votes a pilot diving at a hillside.

**The ground is in the fight.** A round that flies into a hillside stops there —
splash rounds throw their blast from the point of impact — so an island is
something to shoot *around*, and a ridge is worth keeping between you and a
missile. The tallest summits (420 m) out-top a Manta's 400 m cruise, and the
autopilot flies the contour over them: at least 30 m clear of the ground here
and 1400 m ahead, at cruise wherever cruise is higher. No crash mechanic — it
pops over the summit and settles back.

## Who pulls the trigger

The line is the cockpit, not the airframe:

- a Manta **with somebody in it** fires when that somebody says so (`F`);
- an **unattended** one defends itself and presses the attack it was sent on;
- a ship's laser and a Walrus cannon never wait — nobody asks a close-in mount
  for permission.

Autopilot orders are the original's set, minus Patrol (covered by Move plus
self-defence): **Move**, **Attack**, **Return**, and now **Escort** — the
unit takes station on its own moving carrier and fights what comes, breaking
off for the deck by itself below a third of a tank.

Targeting has three levels, all of which the 1988 original had:

1. **Attack orders** — designate an enemy; the autopilot closes and engages. The
   order chases a moving target and ends when the target does.
2. **Boresight aiming** — under direct control the round goes down the nose. A
   gun always fires (aiming is your problem, and a miss is a legitimate
   outcome); a missile needs a lock inside a 22° seeker cone, and the seeker
   takes the target nearest the **nose**, not the nearest target.
3. **Pointer mode** — click a contact and the ship's laser prefers it while it
   lives and is in reach.

The engine still picks for a hull nobody has an opinion about. That is what
makes an unattended Manta defend itself.

## Ordnance, and why it is scarce

Rearming is a withdrawal from the carrier's ordnance store: 25 per Manta
missile, 1 per gun round. **Partial rearms are normal** — you take what there
is, and a ship with an empty store sends its aircraft back up as they are. The
ready magazine for point defence is fed from the same store at a fixed rate,
because a ship does not teleport shells to the mounts.

A burst of flares costs 24 from that same store, and every virus bomb costs 120,
so defending yourself, arming yourself and subverting islands all compete for
one pile.

## Damage

The carrier has **seven geometric sections**, as the original's damage screen
did: bow, midship, stern, port, starboard, topside, engine. Where a round lands
is resolved in the ship's own frame — height first (anything above the deck hits
the island and the mast), then the beam, then how far forward — so **which way
you turn matters in both axes**.

Two consequences follow from a section's health, and the split is what makes
geometry work:

1. **Systems**, on the sections that carry one:

   | Section | What it costs you |
   |---|---|
   | engine | top speed, down to a 25% floor — a wrecked engine room still limps |
   | stern | rudder response, floor 30% |
   | topside | detection range, floor 15%; at zero you are blind |
   | midship | binary — a wrecked hangar deck is a closed one |
   | bow | point defence slows as the mount is chewed up, then stops |

2. **Armour**, on *every* section including the bare plating of the sides: a hit
   on a wrecked section does up to half as much again to the hull. Without it
   port and starboard would be decoration. The armour reading is taken **before**
   the section absorbs the hit — the plating that was there when the round
   arrived is what stopped it.

`maxSpeed`, `turnRate` and `radar` are **derived** onto the carrier record from
untouched base values whenever damage or repair moves, so the helm, the fog
filter and the AI keep reading them directly and know nothing about sections.

Repairs are not instant on delivery. Materials land in the ship's **own yard
stores** and `engine/repair.js` spends them at a fixed rate, working the damage
board in the priority the player set — high, then medium, then low, worst first
inside each tier — sections before plating.

Lost hulls come back: a factory island makes chassis, the boat brings them, and
the hangar assembles one into its **own unit record**. The lighter is rebuilt
first, and while there is no boat at all it is the only thing the yard will
build. When hulls are down, **the yard's shopping list rides first**: the boat
loads the missing chassis before anything else, because a depot with abundant
fuel otherwise fills the entire hold with fuel every run and the parts never
sail — measured: both AI air groups once sat annihilated for 60,000 ticks with
full warehouses of parts ashore.

## Flares

The answer to the lock warning, and the reason the warning is worth having. A
burst blinds every hostile heat-seeker within 900 m: the seeker is broken, not
the missile destroyed, so it flies on blind on the heading it was holding. It
costs ordnance, the launchers take 240 ticks to reload, and the burst is local —
a salvo still on its way in is untouched.

## How a war ends

Five routes, resolved in this order, which is part of the contract:

1. **Annihilation** — nobody afloat. A draw, because two air groups can and do
   finish each other on the same tick, and without this the war never ends.
2. **Last carrier afloat.**
3. **Point cap**, if the host set one. Two sides past it on the same tick is a
   draw; there is no honest way to break it.
4. **Islands** — two thirds of them, floored at one, because two thirds of a
   one-island map rounds down to a threshold of nothing and a tiny test map
   declared a winner on tick zero.
5. **Time cap**, if the host set one: highest score, and a level score is a draw.

Points: islands pay on the hundred-tick beat, a kill pays the shooter, sinking a
carrier pays well, and a unit lost to an empty tank pays nobody — rewarding that
would make waiting a tactic.

After the whistle nothing new is decided: no gun chooses, no pod completes, no
point scores. The final score is final. Rounds already in the air still fly —
and still hit — because they were decided when they left the rail.

## The Action Game

The original shipped two starts and so do we (ruling 2026-08-23): the
**Strategy Game** — everything from zero, the default — and the **Action
Game**, the developed war, minutes from contact. `engine/action_start.js`
runs at the end of `createInitialState` when the `actionStart` rule is 1:
each team gets its nearest share of the archipelago — a stocked factory
island nominated as the stockpile, a resource island, the rest defence
islands with two guns up — supply runs start on, and each carrier is nudged
up to 30% of the way toward the map centre. The rest of the archipelago
stays neutral: there is still a race, it just starts at speed.

Order matters (third review): **every team's estate is allocated first,
round-robin** — one island per team per round, so a crowded table shorts
late rounds rather than late seats — and only then do the carriers move.
The nudge refuses to stop in water a rival action-start battery already
reaches (longest turret weapon plus a 1,200 m margin), and a seat whose
spawn ended up inside an envelope anyway backs straight away from the
nearest gun until clear. The first shape of this start sank seed 31337's
team 14 at tick 7,137 without a decision being made; the suite now asserts
no carrier spawns in reach on any battery seed at the full table.

It is a **rule**, not a script: the flag is in `data/rules.json`, folded by
the lobby's GAME option, covered by the rules hash, and the prepared start is
deterministic from the seed — so an Action war saves, resumes and replays
like any other.

Table size is a lobby option too: **2 to 16 carriers, free for all** (one
team each, ruling 2026-08-23). Up to four teams start in the corners, pinned
by the golden hashes; a bigger table sits around a ring inset from the
edges — and a blocked ring seat steps directly OFF the island in its way,
clamped to the chart. The maps scaled up with it: the islands option now
runs to **64 — the 1988 original's own count** — a ~58 km sea at unchanged
density. Generation is tested (five seeds, 64 islands, 16 carriers: every
island placed, every carrier afloat, ~4,100 ticks/s headless); how such a
war FEELS still awaits a live table.

And **a table is never larger than its archipelago** (third review): fold
four islands with sixteen carriers and the island count rises to the team
count. The clamp lives in `shared/options.js` and the start menu alike, so
it is part of the rules hash and every path — lobby, resume, replay —
agrees on the war it produces.

## The AI

Three modules, all inside the reducer on a 3-tick cadence, so the AI is part of
the deterministic war and every replay and every headless sim covers it.

| Module | Asks |
|---|---|
| `ai_carrier.js` | which island next, and am I aground |
| `ai_strike.js` | is there something to kill right now, and am I too hurt to stay |
| `ai_estate.js` | what should this island be, what should I build on it, and where does the stockpile belong (at the factory — see the supply chain) |

It reads the same state a player does but is written to look only at what its
own hulls could see — the same sensor rule the fog filter uses, and the same
**chart memory**: when it holds a ghost of your carrier and nothing live, it
sends **one scout** to the remembered spot. The search is self-terminating by
the ghost mechanics themselves — the scout's radar either re-acquires you
(live target, and the strike takes over) or scans the spot clean, which
disproves the ghost, and with nothing left to look for the scout comes home.
No search timer, no patrol state.

Three behaviours worth knowing when you play against it: it **withdraws** below
half its hull rather than trading to the death, it **fires flares** only when
something locked on is close enough for the burst to catch — and after you
break contact, **expect one aircraft to come looking at where you were**.

When it knows nothing at all — no sighting, no ghost — and the silence has run
30,000 ticks, it **patrols**: one scout swept past the islands you hold, in
rotation, least-defended first, and only while its bunker is above half. The
scout stands **four kilometres off** the node on its homeward side — its radar
out-reaches a missile battery, so it sweeps the anchorage without entering the
guns' reach. The quiet gate
matters: without it the first patrol flew the moment anybody owned an island,
and autonomous strike cycles sank somebody by tick 11,000 — the entire economy
game deleted by eagerness. Patrols are for re-finding a lost war, not for
opening-move rushes.
