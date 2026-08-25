// engine/payload.js - what a hull can carry, and what it is carrying.
//
// The 1988 fitting screen's constraint (ruled 2026-08-25, "full 1988 model"):
// a craft has a PAYLOAD WEIGHT budget and every store has a weight, so what
// goes under the wing is a decision with a cost rather than a preset.
//
//   Manta   750 kg - a full fit of all four stations is EXACTLY that
//   Walrus 2000 kg - guns and mines are 1400, the ACCB pod 400, the virus
//                    bomb 300, so a vehicle takes one capture device or the
//                    other and never both
//
// Weights are in GRAMS on the record because the engine has no floats and a
// laser round weighs less than a kilogram. Divide by 1,000 for the display;
// nothing below the client ever does.
//
// Weight is a CAPACITY rule, not a flight model: a light Manta is not faster
// here, exactly as in the original. If that ever changes it belongs in
// engine/flight.js, not in this file.

const GRAMS_PER_KG = 1000;

// What this hull is carrying now, in grams.
function payloadGramsOf(unit, weapons) {
  let total = 0;
  for (let i = 0; i < unit.arms.length; i++) {
    const entry = unit.arms[i];
    const weapon = weapons[entry.w];
    if (weapon === undefined) continue;
    total = total + entry.n * weapon.weightGrams;
  }
  // The capture devices are payload too - that is the whole point of them
  // weighing anything.
  if (unit.pod === 1) total = total + unit.podGrams;
  if (unit.virus === 1) total = total + unit.virusGrams;
  return total;
}

// Room left, in grams. Never negative: an overloaded hull reads as full
// rather than as a hull owed weight back.
function payloadRoomGrams(unit, weapons) {
  const room = unit.payloadMaxGrams - payloadGramsOf(unit, weapons);
  return room < 0 ? 0 : room;
}

// How many more rounds of this station the budget allows, given what the
// hull already carries. A weightless store (a ship or island mount, which is
// bolted to something that does not fly) is limited only by its magazine.
function roundsThatFit(unit, weapons, station) {
  const entry = unit.arms[station];
  if (entry === undefined) return 0;
  const weapon = weapons[entry.w];
  if (weapon === undefined) return 0;
  const headroom = weapon.magazine - entry.n;
  if (headroom <= 0) return 0;
  if (weapon.weightGrams <= 0) return headroom;
  const room = payloadRoomGrams(unit, weapons);
  const fits = Math.floor(room / weapon.weightGrams);
  return fits < headroom ? fits : headroom;
}

// Would fitting this device leave the hull inside its budget? Used by the
// hangar when it issues a pod or a virus bomb: the store may be full and the
// materials there, and the answer still be no.
function deviceFits(unit, weapons, grams) {
  return payloadRoomGrams(unit, weapons) >= grams;
}

// The whole magazine of every station, in grams - what a brim-full fit
// weighs, for a screen that wants to say "750 of 750".
function payloadFullGramsOf(unit, weapons) {
  let total = 0;
  for (let i = 0; i < unit.arms.length; i++) {
    const entry = unit.arms[i];
    const weapon = weapons[entry.w];
    if (weapon === undefined) continue;
    total = total + weapon.magazine * weapon.weightGrams;
  }
  return total;
}

export {
  GRAMS_PER_KG,
  payloadGramsOf,
  payloadRoomGrams,
  payloadFullGramsOf,
  roundsThatFit,
  deviceFits,
};
