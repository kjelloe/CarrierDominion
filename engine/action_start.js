// engine/action_start.js - the original's Action Game (ruling 2026-08-23).
//
// 1988 shipped two starts: the Strategy Game (everything from zero - our
// default) and the Action Game, where the war is already underway and you are
// minutes from contact. This builds that second start, deterministically, at
// tick zero, from nothing but the assembled state - so it lives inside
// createInitialState, is covered by the rules hash (the flag is a rule), and
// replays like everything else.
//
// The developed war, as ruled: each team gets its nearest share of the
// archipelago - a stocked FACTORY island (the stockpile), a RESOURCE island,
// and DEFENCE islands with guns up - supply runs on, and the carriers nudged
// toward the middle as far as open water allows. The rest stays neutral:
// there is still a race, it just starts at speed.
//
// Order matters (third review, 2026-08-23): allocation for EVERY team runs
// before any carrier moves, round-robin so a table bigger than the
// archipelago shorts every seat equally instead of the last seats entirely -
// and the nudge refuses to stop anywhere a hostile action-start battery
// already reaches. The first shape of this file nudged then developed, one
// team at a time, and seed 31337's team 14 started 2,289 m from a rival
// missile battery and was sunk by tick 7,137 without a decision being made.

import { dist2D, mulDiv } from '../shared/fixed.js';
import { atan2B, mulCos, mulSin } from '../shared/trig.js';
import { worldHeightAt } from './heightmap.js';
import { UNIT_STOWED } from './units.js';
import { raiseTurret, ROLE_DEFENCE, ROLE_FACTORY, ROLE_RESOURCE } from './island.js';
import { applySectionEffects } from './damage.js';
import { KIND_MANTA } from './units.js';
import { clearTurretsOn } from './turret.js';

// The five ways a war can open (ruled 2026-08-25). One ladder, because they
// are one decision: how far along is this war when you sit down?
const START_HOME = 0;      // a developed home island each - the default
const START_NONE = 1;      // nothing but the ship, the old from-zero race
const START_DEVELOPED = 2; // about a third each, a third neutral
const START_LATE = 3;      // the whole archipelago held, built and refitted
const START_NOSE = 4;      // the late war, begun in each other's faces

// How much of the crossing the developed start skips: each carrier moves
// this far toward the map centre, stopping early wherever open water runs
// out.
const CLOSER_PERMIL = 300;

// A spawn must not sit inside a gun envelope it never chose to enter: the
// margin past the longest turret weapon's reach, in metres.
const HOSTILE_GUN_MARGIN_METRES = 1200;

function nearestUnowned(state, x, y) {
  let best = -1;
  let bestDistance = 2147483647;
  for (let i = 0; i < state.islands.length; i++) {
    const island = state.islands[i];
    if (island.owner !== -1) continue;
    const distance = dist2D(x, y, island.x, island.y);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = island;
    }
  }
  return best;
}

// Deep water at the point and around it, the same test the spawn suite runs:
// a nudged carrier with a shoal one lookahead off the bow grounds on its
// first order, which would be a poor way to start an Action Game.
function openWaterAt(state, carrier, x, y) {
  if (worldHeightAt(state.islands, x, y) >= -carrier.draught) return false;
  for (let a = 0; a < 8; a++) {
    const bam = mulDiv(a, 65536, 8);
    const px = x + mulCos(carrier.lookahead * 2, bam);
    const py = y + mulSin(carrier.lookahead * 2, bam);
    if (worldHeightAt(state.islands, px, py) >= -carrier.draught) return false;
  }
  return true;
}

// The longest reach of any weapon a turret carries, so the clearance rule
// reads the actual loadout rather than hard-coding today's missile figure.
function longestTurretReach(state) {
  let reach = 0;
  for (let t = 0; t < state.turrets.length; t++) {
    const arms = state.turrets[t].arms;
    for (let a = 0; a < arms.length; a++) {
      const weapon = state.weapons[arms[a].w];
      if (weapon !== undefined && weapon.range > reach) reach = weapon.range;
    }
  }
  return reach;
}

function insideHostileGuns(state, team, x, y, clearance) {
  for (let t = 0; t < state.turrets.length; t++) {
    const turret = state.turrets[t];
    if (turret.team === team) continue;
    if (dist2D(x, y, turret.x, turret.y) < clearance) return true;
  }
  return false;
}

function stockIsland(island, fuel, materials, ordnance, chassis) {
  island.stockFuel = fuel;
  island.stockMaterials = materials;
  island.stockOrdnance = ordnance;
  island.stockChassis = chassis;
}

function developIsland(state, team, island, round) {
  clearTurretsOn(state, island.id);
  island.turrets = 0;
  island.owner = team.id;
  island.nodeHp = state.params.commandCentreHp;
  if (round === 0) {
    // The plant, stocked and nominated: the supply chain breathes from
    // tick one.
    island.role = ROLE_FACTORY;
    island.factories = 2;
    island.warehouses = 1;
    stockIsland(island, 20000, 3000, 2000, 24);
    team.stockpileIsland = island.id;
  } else if (round === 1) {
    island.role = ROLE_RESOURCE;
    stockIsland(island, 500, 2000, 0, 0);
  } else {
    island.role = ROLE_DEFENCE;
    for (let g = 0; g < 2; g++) raiseTurret(state, island);
    island.turrets = 2;
  }
}

function carrierOf(state, teamId) {
  for (let c = 0; c < state.carriers.length; c++) {
    if (state.carriers[c].team === teamId) return state.carriers[c];
  }
  return -1;
}

// The home island (proposal 3a, ruled 2026-08-25): the original's Base.
// In the STRATEGY game each team starts on one developed island - a plant,
// a runway, two guns, a modest stock, the depot nomination, supply running.
// The opening race is for the SECOND island, not the first pod. The Action
// Game skips this: its round-0 estate IS the home.
function developHomeIsland(state, team, carrier) {
  const island = nearestUnowned(state, carrier.x, carrier.y);
  if (island === -1) return;
  // The token silo goes with the previous (non-)tenancy, like any capture.
  clearTurretsOn(state, island.id);
  island.turrets = 0;
  island.owner = team.id;
  island.nodeHp = state.params.commandCentreHp;
  island.role = ROLE_FACTORY;
  island.factories = 1;
  island.runway = 1;
  stockIsland(island, 8000, 1500, 800, 12);
  for (let g = 0; g < 2; g++) raiseTurret(state, island);
  island.turrets = 2;
  team.stockpileIsland = island.id;
  carrier.supplyRun = 1;
}

function prepareHomeIslands(state) {
  for (let t = 0; t < state.teams.length; t++) {
    const carrier = carrierOf(state, state.teams[t].id);
    if (carrier === -1) continue;
    developHomeIsland(state, state.teams[t], carrier);
  }
  // The home islands were just armed, and on a crowded sea somebody's spawn
  // is now inside somebody else's shore battery. Measured on a four-island
  // map: three seeds in four put a carrier within the 3,500 m envelope of
  // the enemy's home battery, and it was sunk inside a minute WITHOUT
  // scratching the enemy ship - a war decided by where worldgen happened to
  // drop the hulls. The developed start has walked its spawns clear of
  // hostile guns since the 2026-08-23 review; the default opening never
  // did, which is the older and worse version of the same bug.
  const clearance = longestTurretReach(state)
    + HOSTILE_GUN_MARGIN_METRES * state.params.unitsPerMetre;
  for (let c = 0; c < state.carriers.length; c++) {
    const carrier = state.carriers[c];
    backOffGuns(state, carrier, clearance);
    stowedFollow(state, carrier);
  }
  return state;
}

// How much sea two hulls are owed at the start. Without it the fleet nudge
// walks every carrier onto the same point: a late war put two ships 611 m
// apart on seed 900913 and the AI sank one in ten seconds - a knife fight,
// not an endgame.
const SPAWN_SEPARATION_METRES = 4000;

function tooCloseToAnother(state, carrier, x, y, separation) {
  for (let c = 0; c < state.carriers.length; c++) {
    const other = state.carriers[c];
    if (other.id === carrier.id) continue;
    if (dist2D(x, y, other.x, other.y) < separation) return true;
  }
  return false;
}

// The fleet closes on the middle together, a tenth of the way per round, so
// that every carrier is checked against where the others have ALSO moved to.
// A step is refused if it would put a ship aground, inside a rival battery's
// envelope, or in another ship's lap; refusing does NOT end that ship's
// march, because this is a placement and not a voyage. One rock in the
// straight line used to read as a wall - a 32-island late war stopped every
// carrier at a third of the way in when the water past the rock was open all
// the way to the middle - so a blocked step is skipped and the furthest
// reachable one wins.
//
// The separation invariant holds throughout: every accepted position is
// clear of every other ship AT THE MOMENT IT IS TAKEN, and nothing moves
// except by an accepted step.
function closeTheDistance(state, permilTotal, clearance) {
  const centre = mulDiv(state.params.sizeUnits, 1, 2);
  const separation = SPAWN_SEPARATION_METRES * state.params.unitsPerMetre;
  const anchors = [];
  for (let c = 0; c < state.carriers.length; c++) {
    anchors[c] = { x: state.carriers[c].x, y: state.carriers[c].y };
  }
  for (let step = 1; step <= 10; step++) {
    const permil = mulDiv(permilTotal, step, 10);
    for (let c = 0; c < state.carriers.length; c++) {
      const carrier = state.carriers[c];
      const x = anchors[c].x + mulDiv(centre - anchors[c].x, permil, 1000);
      const y = anchors[c].y + mulDiv(centre - anchors[c].y, permil, 1000);
      if (!openWaterAt(state, carrier, x, y)) continue;
      if (insideHostileGuns(state, carrier.team, x, y, clearance)) continue;
      if (tooCloseToAnother(state, carrier, x, y, separation)) continue;
      carrier.x = x;
      carrier.y = y;
    }
  }
  for (let c = 0; c < state.carriers.length; c++) {
    backOffGuns(state, state.carriers[c], clearance);
    stowedFollow(state, state.carriers[c]);
  }
}

// A gun raised beside a spawn - by the sharing-out, or by an enemy home
// island that happens to be the nearest rock to your corner. Step away from
// the nearest battery until out of its envelope.
//
// Straight away from the gun is often straight into a beach, and stopping
// dead there leaves the ship under the guns it was trying to leave, so the
// step is fanned either side and the first bearing with water under it wins
// - out to three quarters astern of the retreat, because a ship in a bay
// gets out of it sideways. Only straight back INTO the muzzle is refused.
// Failing every bearing means the pond has no answer, and the ship stays
// where worldgen put it.
const RETREAT_FAN = [0, 8192, -8192, 16384, -16384, 24576, -24576];

function backOffGuns(state, carrier, clearance) {
  const stepUnits = 400 * state.params.unitsPerMetre;
  for (let retreat = 0; retreat < 40; retreat++) {
    if (!insideHostileGuns(state, carrier.team, carrier.x, carrier.y, clearance)) break;
    let threat = -1;
    let threatDistance = 2147483647;
    for (let g = 0; g < state.turrets.length; g++) {
      const turret = state.turrets[g];
      if (turret.team === carrier.team) continue;
      const distance = dist2D(carrier.x, carrier.y, turret.x, turret.y);
      if (distance < threatDistance) {
        threatDistance = distance;
        threat = turret;
      }
    }
    if (threat === -1) break;
    const away = threatDistance <= 0
      ? 0
      : atan2B(carrier.y - threat.y, carrier.x - threat.x);
    // Two passes over the fan. The first wants proper sea room. The second
    // settles for water deeper than the ship draws AND deeper than where it
    // is standing, because a crowded archipelago can leave a spawn in four
    // fathoms with a shoal inside every lookahead ring - and staying at the
    // muzzle to keep a clearance rule is the wrong trade.
    let moved = 0;
    const here = worldHeightAt(state.islands, carrier.x, carrier.y);
    for (let pass = 0; pass < 2 && moved === 0; pass++) {
      for (let f = 0; f < RETREAT_FAN.length; f++) {
        const bam = away + RETREAT_FAN[f];
        const x = carrier.x + mulCos(stepUnits, bam);
        const y = carrier.y + mulSin(stepUnits, bam);
        if (pass === 0) {
          if (!openWaterAt(state, carrier, x, y)) continue;
        } else {
          const there = worldHeightAt(state.islands, x, y);
          if (there >= -carrier.draught || there >= here) continue;
        }
        carrier.x = x;
        carrier.y = y;
        moved = 1;
        break;
      }
    }
    if (moved === 0) break;
  }
}

// The hangar moved with the ship: stowed hulls sit wherever it now is.
function stowedFollow(state, carrier) {
  for (let u = 0; u < state.units.length; u++) {
    const unit = state.units[u];
    if (unit.carrierId !== carrier.id || unit.state !== UNIT_STOWED) continue;
    unit.x = carrier.x;
    unit.y = carrier.y;
    unit.targetX = carrier.x;
    unit.targetY = carrier.y;
  }
}

function prepareActionStart(state) {
  // A third each and a third neutral, as ruled - which for N teams means
  // one share in (teams + 1), ROUNDED rather than floored so eight islands
  // between two sides reads as three and three rather than two and two.
  const slices = state.teams.length + 1;
  const rounded = Math.floor((state.islands.length * 2 + slices) / (2 * slices));
  const share = Math.max(2, rounded);

  // Every team's estate first, ROUND-ROBIN: one island per team per round,
  // nearest to that team's spawn. Sequential whole-share grabs let early
  // seats empty the archipelago before late seats chose at all, and a
  // table of sixteen on a small map gave seats 0..n islands and the rest
  // nothing. Short every seat equally instead.
  for (let round = 0; round < share; round++) {
    for (let t = 0; t < state.teams.length; t++) {
      const carrier = carrierOf(state, state.teams[t].id);
      if (carrier === -1) continue;
      const island = nearestUnowned(state, carrier.x, carrier.y);
      if (island === -1) continue;
      developIsland(state, state.teams[t], island, round);
    }
  }

  // Now the nudge, against the finished map.
  const clearance = longestTurretReach(state)
    + HOSTILE_GUN_MARGIN_METRES * state.params.unitsPerMetre;
  closeTheDistance(state, CLOSER_PERMIL, clearance);
  for (let c = 0; c < state.carriers.length; c++) state.carriers[c].supplyRun = 1;
  return state;
}

// The late war: every island somebody's, every island built out, every
// refit fitted. For testing an endgame with human hands on it - the state a
// four-hour war arrives at, without the four hours.
//
// Handing out the whole archipelago collides with the island victory: two
// thirds ends the war, and an even split of four islands is two thirds of
// nothing else. Capping the share was the first answer and it was a lie -
// the menu promised "the whole archipelago held" and dealt one rock each.
// The honest answer is that a late war is a different war: everyone already
// holds their third, so holding your third cannot be the win. The bar moves
// to nearly the whole sea, and the only way to reach it is to take what the
// other side has built. Derived from startShape, so a replay recomputes it.
const LATE_VICTORY_PERMIL = 900;

function lateShare(state) {
  const teams = state.teams.length;
  let needed = mulDiv(state.islands.length, state.params.victoryIslandPermil, 1000);
  if (needed < 1) needed = 1;
  const even = Math.floor(state.islands.length / teams);
  // The guard stays, for the degenerate maps no menu offers: even at the
  // raised bar, two islands over two teams would still start won.
  const capped = needed - 1;
  if (capped < 1) return 0;
  return even < capped ? even : capped;
}

// What the island at round N of the sharing-out becomes. The first is the
// plant and the depot, the second feeds it, the third defends - and then
// the pattern repeats, so a big estate is a mix rather than a monoculture.
function lateRole(round) {
  if (round === 0) return ROLE_FACTORY;
  const step = round % 3;
  if (step === 1) return ROLE_RESOURCE;
  if (step === 2) return ROLE_DEFENCE;
  return ROLE_FACTORY;
}

function developLateIsland(state, team, island, round) {
  clearTurretsOn(state, island.id);
  island.turrets = 0;
  island.owner = team.id;
  island.nodeHp = state.params.commandCentreHp;
  island.role = lateRole(round);
  if (island.role === ROLE_FACTORY) {
    island.factories = 3;
    island.warehouses = 2;
    stockIsland(island, 30000, 6000, 4000, 40);
    if (round === 0) team.stockpileIsland = island.id;
  } else if (island.role === ROLE_RESOURCE) {
    island.warehouses = 2;
    island.runway = 1;
    stockIsland(island, 12000, 9000, 500, 6);
  } else {
    island.runway = 1;
    for (let g = 0; g < 3; g++) raiseTurret(state, island);
    island.turrets = 3;
    stockIsland(island, 6000, 2000, 1500, 2);
  }
}

// Every refit fitted, every store full: the ship a commander would have
// after a long and successful war.
function refitCarrier(state, carrier) {
  carrier.upSpeed = 1;
  carrier.maxSpeedBase = carrier.maxSpeedUpgraded;
  carrier.upPd = 1;
  carrier.upRadar = 1;
  carrier.radarBase = carrier.radarUpgraded;
  carrier.upComm = 1;
  for (let i = 0; i < state.units.length; i++) {
    const unit = state.units[i];
    if (unit.carrierId !== carrier.id || unit.kind !== KIND_MANTA) continue;
    unit.commPod = 1;
    break;
  }
  applySectionEffects(carrier);
  carrier.fuel = carrier.fuelCapacity;
  carrier.ordnance = carrier.ordnanceCapacity;
  carrier.materials = carrier.materialsCapacity;
  carrier.chassis = state.economy.chassisPerHull * 2;
  carrier.hammerRounds = carrier.hammerMax;
  carrier.supplyRun = 1;
}

// Half the crossing, not a third: a late war exists to put a human in the
// endgame, and a twenty-minute sail to first contact is the thing it is
// meant to skip.
const LATE_CLOSER_PERMIL = 550;

// How much sea a nose-to-nose fleet is owed. Four kilometres is contact
// from the first tick - inside radar, inside the aircraft leash, one turn
// from a gun fight - without being the knife fight that killed a ship in
// ten seconds at 611 m.
const NOSE_SEPARATION_METRES = 4000;

// The meeting ground is looked for at the middle of the map and then in
// rings outward, eight bearings a ring, taking the first that is open water
// clear of every battery with room for the whole fleet. Deterministic by
// construction: no search order depends on anything but the map.
const MEETING_RINGS = 12;
const MEETING_BEARINGS = 8;

// Everyone round one patch of water: seat 0 due east of it, the rest evenly
// round the circle, so a two-carrier war is bow to bow and a sixteen-carrier
// one is a ring brawl. The circle grows until the closest pair has its sea
// room, then keeps growing while anybody is aground or under guns - and if
// no size works, the fleet is left where the late war put it, which is a
// longer war rather than a broken one.
function gatherAtMeetingGround(state, clearance) {
  const separation = NOSE_SEPARATION_METRES * state.params.unitsPerMetre;
  const centre = mulDiv(state.params.sizeUnits, 1, 2);
  const teams = state.carriers.length;
  if (teams < 2) return;
  // Two hulls sit either side of the middle, so half the separation each;
  // more hulls need a wider circle to keep neighbours that far apart.
  const step = mulDiv(separation, 1, 2);
  // Radius OUTERMOST: the tightest circle that works anywhere on the chart
  // beats a loose one at the middle. The other way round, a two-carrier war
  // took a 28 km ring at the map centre and called it nose to nose.
  for (let grow = 0; grow < 8; grow++) {
    const radius = step + step * grow;
    for (let ring = 0; ring < MEETING_RINGS; ring++) {
      const offset = step * ring;
      for (let b = 0; b < MEETING_BEARINGS; b++) {
        const bam = mulDiv(b, 65536, MEETING_BEARINGS);
        const groundX = centre + mulCos(offset, bam);
        const groundY = centre + mulSin(offset, bam);
        if (tryMeetingGround(state, groundX, groundY, radius, separation, clearance)) return;
        if (offset === 0) break; // the centre itself is one place, not eight
      }
    }
  }
}

// Can the whole fleet stand round this point at this radius? All or nothing:
// the positions are only written back once every one of them passes.
function tryMeetingGround(state, groundX, groundY, radius, separation, clearance) {
  const places = [];
  for (let c = 0; c < state.carriers.length; c++) {
    const carrier = state.carriers[c];
    const bam = mulDiv(c, 65536, state.carriers.length);
    const x = groundX + mulCos(radius, bam);
    const y = groundY + mulSin(radius, bam);
    if (!openWaterAt(state, carrier, x, y)) return false;
    if (insideHostileGuns(state, carrier.team, x, y, clearance)) return false;
    for (let p = 0; p < places.length; p++) {
      if (dist2D(x, y, places[p].x, places[p].y) < separation) return false;
    }
    places.push({ x: x, y: y });
  }
  for (let c = 0; c < state.carriers.length; c++) {
    const carrier = state.carriers[c];
    carrier.x = places[c].x;
    carrier.y = places[c].y;
    stowedFollow(state, carrier);
  }
  return true;
}

// Nose to nose (ruled 2026-08-25, owner): the late war's archipelago and
// the late war's ship, but the fleet begins in each other's faces instead of
// 10-20 km apart. Marching further in does not get there - a late sea is
// wall-to-wall gun envelopes and islands, which is what leaves the ordinary
// late war at arm's length - so this shape does not march at all. It picks
// ONE meeting ground and puts everybody round it.
function prepareNoseToNose(state) {
  prepareLateWar(state);
  const clearance = longestTurretReach(state)
    + HOSTILE_GUN_MARGIN_METRES * state.params.unitsPerMetre;
  gatherAtMeetingGround(state, clearance);
  return state;
}

function prepareLateWar(state) {
  state.params.victoryIslandPermil = LATE_VICTORY_PERMIL;
  const share = lateShare(state);
  for (let round = 0; round < share; round++) {
    for (let t = 0; t < state.teams.length; t++) {
      const carrier = carrierOf(state, state.teams[t].id);
      if (carrier === -1) continue;
      const island = nearestUnowned(state, carrier.x, carrier.y);
      if (island === -1) continue;
      developLateIsland(state, state.teams[t], island, round);
    }
  }
  for (let t = 0; t < state.teams.length; t++) {
    const carrier = carrierOf(state, state.teams[t].id);
    if (carrier !== -1) refitCarrier(state, carrier);
  }
  const clearance = longestTurretReach(state)
    + HOSTILE_GUN_MARGIN_METRES * state.params.unitsPerMetre;
  closeTheDistance(state, LATE_CLOSER_PERMIL, clearance);
  return state;
}

export {
  CLOSER_PERMIL,
  START_HOME,
  START_NONE,
  START_DEVELOPED,
  START_LATE,
  START_NOSE,
  prepareActionStart,
  prepareHomeIslands,
  prepareLateWar,
  prepareNoseToNose,
};
