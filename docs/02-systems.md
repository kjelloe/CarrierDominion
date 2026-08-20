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

| Payload | Works on | You get | Cost |
|---|---|---|---|
| **ACCB pod** (`P`) | any island that is not yours | the island **bare** — the previous owner's works are cleared | 1200 ticks |
| **Virus bomb** (`B`) | one somebody else **holds** | the island **intact** — factories, warehouses, stores, and the turrets that were shooting at you | 2400 ticks |

Both are deployed by a Walrus within 60 m of the command node. A pod being built
is displaced by an enemy pod, which restarts the clock for the newcomer. A
conversion is abandoned if the island changes hands under it — a virus needs a
command centre to subvert, and the one it was working on is gone.

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
upstream of it.

A side that loses every lighter would be unable to receive the parts to build a
lighter — parts arrive in a lighter. So a depot holding the parts **launches one
itself** and it sails out to the ship. That is not an exception to the ruling;
it is what a supply network is for.

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

A burst of flares costs 24 from that same store, so defending yourself and
arming yourself compete for one pile.

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
build.

## Flares

The answer to the lock warning, and the reason the warning is worth having. A
burst blinds every hostile heat-seeker within 900 m: the seeker is broken, not
the missile destroyed, so it flies on blind on the heading it was holding. It
costs ordnance, the launchers take 240 ticks to reload, and the burst is local —
a salvo still on its way in is untouched.

## How a war ends

Four routes, resolved in this order, which is part of the contract:

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

## The AI

Three modules, all inside the reducer on a 3-tick cadence, so the AI is part of
the deterministic war and every replay and every headless sim covers it.

| Module | Asks |
|---|---|
| `ai_carrier.js` | which island next, and am I aground |
| `ai_strike.js` | is there something to kill right now, and am I too hurt to stay |
| `ai_estate.js` | what should this island be, and what should I build on it |

It reads the same state a player does but is written to look only at what its
own hulls could see — the same sensor rule the fog filter uses. When real fog of
war grows a memory, `ai_strike.js` is the module to audit against it.

Two behaviours worth knowing when you play against it: it **withdraws** below
half its hull rather than trading to the death, and it **fires flares** only
when something locked on is close enough for the burst to catch.
