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

## What an island is for

The command centre makes it yours. What it is FOR is then the owner's decision,
and the role is settled once anything is built on it.

| Role | Produces | May build |
|---|---|---|
| Resource | materials, a little fuel | warehouses |
| Factory | fuel, ordnance, **replacement hulls** — per factory built | up to 3 factories, 2 warehouses |
| Defence | nothing at all | up to 4 turrets |

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
30,000 ticks, it **patrols**: one scout over the islands you hold, in rotation,
least-defended first, and only while its bunker is above half. The quiet gate
matters: without it the first patrol flew the moment anybody owned an island,
and autonomous strike cycles sank somebody by tick 11,000 — the entire economy
game deleted by eagerness. Patrols are for re-finding a lost war, not for
opening-move rushes.
