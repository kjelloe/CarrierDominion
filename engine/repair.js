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
import { EVT_REPAIRED, pushEvent } from './events.js';
import { repairSections, sectionsIntact } from './damage.js';

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
    const done = stepRepairCarrier(state, carrier);
    if (done <= 0) continue;
    const before = carrier.repairReported;
    carrier.repairReported = before + done;
    if (floorDiv(carrier.repairReported, 100) > floorDiv(before, 100)) {
      pushEvent(state.events, EVT_REPAIRED, carrier.id, carrier.team, carrier.hull);
    }
  }
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

export { stepRepair, stepRepairCarrier, repairDue, conditionPermil };
