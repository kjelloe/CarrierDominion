// engine/repair.js - the automatic repair system.
//
// The 1988 original did not repair a ship the instant a supply boat touched
// alongside: materials went into the ship's stores and the repair system worked
// through the damage board on its own, in the priority order the player set.
// This is that. The lighter's job ends at the store; the yard is the ship.
//
// Sections come before plating. A carrier that cannot move, see, or fly its
// aircraft is in worse trouble than one that is merely holed, and it is the
// sections the player has expressed an opinion about.

import { floorDiv, mulDiv } from '../shared/fixed.js';
import { EVT_HULL_REPLACED, EVT_REPAIRED, pushEvent } from './events.js';
import { repairSections, sectionsIntact } from './damage.js';
import { hangarOpen } from './damage.js';
import { KIND_LIGHTER, KIND_MANTA, KIND_WALRUS, UNIT_LOST, UNIT_STOWED } from './units.js';
import { createArms } from './weapons.js';

// Points of repair earned this tick, given the rate per 100 ticks. The
// accumulator lets the rate be a fraction of a point, exactly like fuel burn.
function repairDue(carrier) {
  const accum = carrier.repairAccum + carrier.repairRate;
  const due = floorDiv(accum, 100);
  carrier.repairAccum = accum - due * 100;
  return due;
}

function damaged(carrier) {
  return carrier.hull < carrier.maxHull || !sectionsIntact(carrier);
}

// One carrier's repairs for one tick. Returns the points actually put in.
function stepRepairCarrier(state, carrier) {
  if (carrier.hull <= 0) return 0;
  if (!damaged(carrier)) {
    carrier.repairAccum = 0;
    return 0;
  }
  const due = repairDue(carrier);
  if (due <= 0) return 0;

  const perPoint = state.economy.repairPerMaterial;
  const affordable = perPoint > 0 ? floorDiv(carrier.materials, perPoint) : due;
  const budget = affordable < due ? affordable : due;
  if (budget <= 0) return 0;

  const onSections = repairSections(carrier, budget);
  let spent = onSections;
  const missing = carrier.maxHull - carrier.hull;
  if (spent < budget && missing > 0) {
    const room = budget - spent;
    const onHull = room < missing ? room : missing;
    carrier.hull = carrier.hull + onHull;
    spent = spent + onHull;
  }
  if (spent <= 0) return 0;
  carrier.materials = carrier.materials - spent * perPoint;
  return spent;
}

// Reported once per hundred points rather than per tick: the event list is part
// of the state hash, and a repair event every tick would drown everything else.
function stepRepair(state) {
  for (let i = 0; i < state.carriers.length; i++) {
    const carrier = state.carriers[i];
    replaceHull(state, carrier);
    const done = stepRepairCarrier(state, carrier);
    if (done <= 0) continue;
    const before = carrier.repairReported;
    carrier.repairReported = before + done;
    if (floorDiv(carrier.repairReported, 100) > floorDiv(before, 100)) {
      pushEvent(state.events, EVT_REPAIRED, carrier.id, carrier.team, carrier.hull);
    }
  }
}

// A hull lost is not gone for good: a factory island makes replacement chassis,
// the boat brings them, and the hangar assembles one when there is a gap to
// fill. The unit record is REUSED - ids are stable for a whole war, and a Manta
// that comes back is the same Manta as far as everything else is concerned.
function replaceHull(state, carrier) {
  if (carrier.hull <= 0 || !hangarOpen(carrier)) return 0;
  const cost = state.economy.chassisPerHull;
  if (cost <= 0 || carrier.chassis < cost) return 0;
  // The lighter comes first, and while there is no boat at all it is the ONLY
  // thing the yard will build. Everything the ship needs - fuel, munitions,
  // materials, more parts - arrives in one, so a side that has lost every boat
  // cannot be resupplied, and would never receive the parts to fix that. A
  // reserve spent on an aircraft instead is a war lost to bookkeeping.
  if (assembleKind(state, carrier, KIND_LIGHTER, cost) === 1) return 1;
  if (!hasBoat(state, carrier)) return 0;
  if (assembleKind(state, carrier, KIND_MANTA, cost) === 1) return 1;
  return assembleKind(state, carrier, KIND_WALRUS, cost);
}

function hasBoat(state, carrier) {
  for (let i = 0; i < state.units.length; i++) {
    const unit = state.units[i];
    if (unit.carrierId !== carrier.id || unit.kind !== KIND_LIGHTER) continue;
    if (unit.state !== UNIT_LOST) return true;
  }
  return false;
}

function assembleKind(state, carrier, kind, cost) {
  for (let i = 0; i < state.units.length; i++) {
    const unit = state.units[i];
    if (unit.carrierId !== carrier.id || unit.kind !== kind || unit.state !== UNIT_LOST) continue;
    carrier.chassis = carrier.chassis - cost;
    unit.state = UNIT_STOWED;
    unit.hp = unit.maxHp;
    unit.fuel = unit.fuelCapacity;
    unit.fuelAccum = 0;
    unit.speed = 0;
    unit.throttle = 0;
    unit.rudder = 0;
    unit.blocked = 0;
    unit.control = -1;
    unit.order = 0;
    unit.orderTargetKind = -1;
    unit.orderTargetId = -1;
    unit.x = carrier.x;
    unit.y = carrier.y;
    unit.z = 0;
    unit.targetX = carrier.x;
    unit.targetY = carrier.y;
    unit.arms = createArms(state.loadouts[unit.kind], state.weapons);
    unit.weapon = unit.arms.length > 0 ? unit.arms[0].w : -1;
    unit.heat = 0;
    unit.heatAccum = 0;
    unit.overheated = 0;
    unit.cooldown = 0;
    if (unit.kind === KIND_WALRUS) unit.pod = 1;
    pushEvent(state.events, EVT_HULL_REPLACED, unit.id, unit.team, unit.kind);
    return 1;
  }
  return 0;
}

// Fraction of the ship that is whole, in per-mil, across hull and every
// section. The damage board's one-line summary.
function conditionPermil(carrier) {
  let have = carrier.hull;
  let total = carrier.maxHull;
  for (let i = 0; i < carrier.sections.length; i++) {
    have = have + carrier.sections[i].hp;
    total = total + carrier.sections[i].maxHp;
  }
  if (total <= 0) return 1000;
  return mulDiv(have, 1000, total);
}

export { stepRepair, stepRepairCarrier, repairDue, replaceHull, conditionPermil };
