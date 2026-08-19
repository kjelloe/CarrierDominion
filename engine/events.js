// engine/events.js - the per-tick event list.
//
// Events live in state (so they are hashed, replayed, and asserted on) and are
// therefore integers only: a code plus three payload slots whose meaning is
// documented per code. Presentation turns them into text; the engine never
// formats a string.

const EVT_COMMAND_REJECTED = 1; // a = 0, b = 0, c = 0
const EVT_THROTTLE_SET = 2; // a = carrierId, b = throttle
const EVT_RUDDER_SET = 3; // a = carrierId, b = rudder
const EVT_HEADING_SET = 4; // a = carrierId, b = heading
const EVT_CARRIER_GROUNDED = 5; // a = carrierId, b = islandId
const EVT_FUEL_EMPTY = 6; // a = carrierId
const EVT_FUEL_RESTORED = 7; // a = carrierId
const EVT_UNIT_LAUNCHED = 8; // a = unitId, b = team, c = kind
const EVT_UNIT_RECOVERED = 9; // a = unitId, b = team
const EVT_UNIT_LOST = 10; // a = unitId, b = team
const EVT_UNIT_ARRIVED = 11; // a = unitId, b = team
const EVT_UNIT_BLOCKED = 12; // a = unitId, b = team - a Walrus met a slope
const EVT_UNIT_ORDERED = 13; // a = unitId, b = order
const EVT_UNIT_CONTROL = 14; // a = unitId, b = 1 taken / 0 released
const EVT_POD_DEPLOYED = 15; // a = islandId, b = team, c = unitId
const EVT_POD_LOST = 16; // a = islandId, b = the team whose pod was displaced
const EVT_ISLAND_CAPTURED = 17; // a = islandId, b = new owner team
const EVT_WAR_OVER = 18; // a = winning team, b = why (engine/victory.js)
const EVT_RESUPPLIED = 19; // a = carrierId, b = team, c = islandId
const EVT_CARRIER_DAMAGED = 20; // a = carrierId, b = team, c = hull points lost
const EVT_CARRIER_SUNK = 21; // a = carrierId, b = team
const EVT_STOCKPILE_SET = 22; // a = islandId, b = team
const EVT_SUPPLY_LOADED = 23; // a = unitId, b = team, c = fuel aboard
const EVT_SUPPLY_DELIVERED = 24; // a = unitId, b = team
const EVT_SUPPLY_RUN = 25; // a = carrierId, b = team, c = 1 on / 0 off

function makeEvent(code, a, b, c) {
  return { code: code, a: a, b: b, c: c };
}

function pushEvent(events, code, a, b, c) {
  events.push(makeEvent(code, a, b, c));
  return events;
}

export {
  EVT_COMMAND_REJECTED,
  EVT_THROTTLE_SET,
  EVT_RUDDER_SET,
  EVT_HEADING_SET,
  EVT_CARRIER_GROUNDED,
  EVT_FUEL_EMPTY,
  EVT_FUEL_RESTORED,
  EVT_UNIT_LAUNCHED,
  EVT_UNIT_RECOVERED,
  EVT_UNIT_LOST,
  EVT_UNIT_ARRIVED,
  EVT_UNIT_BLOCKED,
  EVT_UNIT_ORDERED,
  EVT_UNIT_CONTROL,
  EVT_POD_DEPLOYED,
  EVT_POD_LOST,
  EVT_ISLAND_CAPTURED,
  EVT_WAR_OVER,
  EVT_RESUPPLIED,
  EVT_CARRIER_DAMAGED,
  EVT_CARRIER_SUNK,
  EVT_STOCKPILE_SET,
  EVT_SUPPLY_LOADED,
  EVT_SUPPLY_DELIVERED,
  EVT_SUPPLY_RUN,
  makeEvent,
  pushEvent,
};
