// engine/contacts.js - what a team REMEMBERS seeing.
//
// Detection stays radar-range only (ruling 24.3); this adds the memory the
// original's chart had (owner ruling 2026-08-21). When an enemy hull leaves
// your radar you keep a ghost: where it was, which way it was pointing, and
// when. The ghost lives until it is DISPROVED - your own sensors cover the
// remembered spot and the hull is not there - or until the hull is seen again
// and the memory is refreshed. There is no timer: a chart mark does not fade
// because you looked away, it fades because you looked back.
//
// Memory lives in STATE, per team, because a replay must remember exactly what
// the war remembered - and because the fog filter is pure per-tick and cannot
// hold anything. Each team's ghosts reach only that team's view.
//
// The record: { team, kind, id, unitKind, x, y, heading, tick }
//   team      whose memory this is
//   kind      1 a carrier, 0 a unit - the TARGET_* codes, deliberately
//   unitKind  the hull kind for units, -1 for carriers
//   tick      when it was last actually seen

import { distSq2D, mulDiv } from '../shared/fixed.js';
import { radarPermilFor, weatherAt } from '../shared/weather.js';
import { UNIT_ACTIVE, UNIT_RETURNING, unitEngageable } from './units.js';

const CONTACT_UNIT = 0;
const CONTACT_CARRIER = 1;

// How far a set actually reaches THIS TICK. Weather is the one thing that
// changes it (ruled 2026-08-26, "wire one effect now"): heavy weather is sea
// clutter and rain in the beam, so a storm shortens the picture. It does not
// blind you - the floor is a rule, and it is high on purpose.
//
// Every sensor in the engine goes through here, so the fog, the ghosts and
// the machine's own eyes all agree about how far anyone can see. The weather
// itself is a pure function of (seed, tick) and is stored nowhere.
function sensorReach(state, sensor) {
  if (sensor.radar <= 0) return 0;
  const weather = weatherAt(state.seed, state.tick);
  const permil = radarPermilFor(weather, state.params.radarStormPermil);
  return mulDiv(sensor.radar, permil, 1000);
}

// The one sensor rule: every hull a team owns is a radar, carriers furthest.
// A sunk carrier senses nothing - its mast is underwater - which the fog
// filter now also respects by routing through here.
function covered(state, team, x, y) {
  for (let i = 0; i < state.carriers.length; i++) {
    const sensor = state.carriers[i];
    if (sensor.team !== team || sensor.hull <= 0) continue;
    const reach = sensorReach(state, sensor);
    if (distSq2D(sensor.x, sensor.y, x, y) <= reach * reach) return true;
  }
  for (let i = 0; i < state.units.length; i++) {
    const sensor = state.units[i];
    if (sensor.team !== team) continue;
    if (sensor.state !== UNIT_ACTIVE && sensor.state !== UNIT_RETURNING) continue;
    const reach = sensorReach(state, sensor);
    if (distSq2D(sensor.x, sensor.y, x, y) <= reach * reach) return true;
  }
  return false;
}

// A ghost is disproved only when its spot is WELL inside a sensor's sweep. A
// hull that sails over the horizon was last seen essentially at the rim -
// still-covered ground - and without this margin every naturally-departing
// contact would be disproved on the very next tick, which is the whole
// feature quietly deleting itself. 400 m of rim is ambiguous on purpose.
const DISPROVE_MARGIN_UNITS = 400 * 256;

// Like covered(), but each sensor's reach is pulled in by the margin.
function coveredWell(state, team, x, y) {
  for (let i = 0; i < state.carriers.length; i++) {
    const sensor = state.carriers[i];
    if (sensor.team !== team || sensor.hull <= 0) continue;
    const reach = sensorReach(state, sensor) - DISPROVE_MARGIN_UNITS;
    if (reach > 0 && distSq2D(sensor.x, sensor.y, x, y) <= reach * reach) return true;
  }
  for (let i = 0; i < state.units.length; i++) {
    const sensor = state.units[i];
    if (sensor.team !== team) continue;
    if (sensor.state !== UNIT_ACTIVE && sensor.state !== UNIT_RETURNING) continue;
    const reach = sensorReach(state, sensor) - DISPROVE_MARGIN_UNITS;
    if (reach > 0 && distSq2D(sensor.x, sensor.y, x, y) <= reach * reach) return true;
  }
  return false;
}

function copyContact(contact) {
  return {
    team: contact.team,
    kind: contact.kind,
    id: contact.id,
    unitKind: contact.unitKind,
    x: contact.x,
    y: contact.y,
    heading: contact.heading,
    tick: contact.tick,
  };
}

function copyContacts(contacts) {
  const out = [];
  for (let i = 0; i < contacts.length; i++) out.push(copyContact(contacts[i]));
  return out;
}

function remembered(contacts, team, kind, id) {
  for (let i = 0; i < contacts.length; i++) {
    const contact = contacts[i];
    if (contact.team === team && contact.kind === kind && contact.id === id) return contact;
  }
  return -1;
}

// Fresh sighting, or the surviving ghost, or nothing. Shared by both entity
// walks below so the keep-or-disprove rule is written once.
function resolve(state, old, team, kind, id, unitKind, x, y, heading, seen, out) {
  if (seen) {
    out.push({
      team: team, kind: kind, id: id, unitKind: unitKind,
      x: x, y: y, heading: heading, tick: state.tick,
    });
    return;
  }
  const ghost = remembered(old, team, kind, id);
  if (ghost === -1) return;
  // Looked back - properly, not just brushing the spot with the rim - and it
  // is not there: the memory is disproved and dropped.
  if (coveredWell(state, team, ghost.x, ghost.y)) return;
  out.push(ghost);
}

// Rebuilt every tick, in entity-list order per team, so the array's order is
// deterministic and never depends on when something was first seen.
function stepContacts(state) {
  const old = state.contacts;
  const out = [];
  for (let t = 0; t < state.teams.length; t++) {
    const team = state.teams[t].id;
    for (let i = 0; i < state.carriers.length; i++) {
      const carrier = state.carriers[i];
      if (carrier.team === team) continue;
      const seen = carrier.hull > 0 && covered(state, team, carrier.x, carrier.y);
      resolve(state, old, team, CONTACT_CARRIER, carrier.id, -1,
        carrier.x, carrier.y, carrier.heading, seen, out);
    }
    for (let i = 0; i < state.units.length; i++) {
      const unit = state.units[i];
      if (unit.team === team) continue;
      const seen = unitEngageable(unit) && covered(state, team, unit.x, unit.y);
      resolve(state, old, team, CONTACT_UNIT, unit.id, unit.kind,
        unit.x, unit.y, unit.heading, seen, out);
    }
  }
  state.contacts = out;
  return state;
}

// The GHOSTS for one team: remembered marks only, never a live sighting - a
// hull currently on radar reaches the view through the normal channels, and a
// scope that drew it twice would be lying about how much it knows.
function ghostsFor(state, team) {
  const out = [];
  for (let i = 0; i < state.contacts.length; i++) {
    const contact = state.contacts[i];
    if (contact.team !== team || contact.tick >= state.tick) continue;
    out.push({
      kind: contact.kind,
      id: contact.id,
      unitKind: contact.unitKind,
      x: contact.x,
      y: contact.y,
      heading: contact.heading,
      tick: contact.tick,
    });
  }
  return out;
}

export {
  CONTACT_UNIT,
  CONTACT_CARRIER,
  DISPROVE_MARGIN_UNITS,
  covered,
  coveredWell,
  sensorReach,
  copyContacts,
  remembered,
  stepContacts,
  ghostsFor,
};
