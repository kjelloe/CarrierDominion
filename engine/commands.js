// engine/commands.js - the complete command vocabulary.
//
// A command is a plain object with a string `type` and integer fields only.
// The command log IS the replay: seed + ordered commands reproduce a war
// exactly, so nothing here may carry a float, a timestamp, or a reference.

const CMD_ADVANCE_TICK = 'advance_tick';
const CMD_SET_THROTTLE = 'set_throttle';
const CMD_SET_RUDDER = 'set_rudder';
const CMD_SET_HEADING = 'set_heading';
const CMD_LAUNCH_UNIT = 'launch_unit';
const CMD_RECALL_UNIT = 'recall_unit';
const CMD_ORDER_UNIT_MOVE = 'order_unit_move';
const CMD_TAKE_CONTROL = 'take_control';
const CMD_RELEASE_CONTROL = 'release_control';
const CMD_SET_UNIT_HELM = 'set_unit_helm';
const CMD_DEPLOY_POD = 'deploy_pod';
const CMD_DEPLOY_VIRUS = 'deploy_virus';
const CMD_SET_STOCKPILE = 'set_stockpile';
const CMD_SET_SUPPLY_RUN = 'set_supply_run';
const CMD_FIRE_UNIT = 'fire_unit';
const CMD_SET_REPAIR_PRIORITY = 'set_repair_priority';
const CMD_SELECT_WEAPON = 'select_weapon';
const CMD_ORDER_UNIT_ATTACK = 'order_unit_attack';
const CMD_SET_CARRIER_AIM = 'set_carrier_aim';
const CMD_FIRE_FLARES = 'fire_flares';
const CMD_SET_AI = 'set_ai';
const CMD_SET_ISLAND_ROLE = 'set_island_role';
const CMD_BUILD_ON_ISLAND = 'build_on_island';
// Round-three rulings (2026-08-23): the original's course autopilot, the
// Escort order, and the quartermaster's production bias.
const CMD_SET_COURSE = 'set_course';
const CMD_ORDER_UNIT_ESCORT = 'order_unit_escort';
const CMD_SET_SUPPLY_BIAS = 'set_supply_bias';
// Striking the colours (manual coverage review, item 10): the original's
// SURRENDER option. The ship is scuttled by her own commander; victory
// resolution does the rest by its ordinary rules.
const CMD_SURRENDER = 'surrender';
// Land a Manta on a friendly island runway (manual coverage review, item 2).
const CMD_ORDER_UNIT_LAND = 'order_unit_land';

const THROTTLE_MIN = 0;
const THROTTLE_MAX = 100;
// The carrier's astern gear: the bottom quarter of the scale, as 1988 had it.
const THROTTLE_ASTERN = -25;
const HEADING_MANUAL = -1;

// Commands that name a hull do it through `carrierId`; commands that name an
// aircraft or a vehicle do it through `unitId`. server/authority.js relies on
// exactly one of the two being present.
const UNIT_COMMANDS = [
  CMD_RECALL_UNIT,
  CMD_ORDER_UNIT_MOVE,
  CMD_TAKE_CONTROL,
  CMD_RELEASE_CONTROL,
  CMD_SET_UNIT_HELM,
  CMD_DEPLOY_POD,
  CMD_DEPLOY_VIRUS,
  CMD_FIRE_UNIT,
  CMD_SELECT_WEAPON,
  CMD_ORDER_UNIT_ATTACK,
  CMD_ORDER_UNIT_ESCORT,
  CMD_ORDER_UNIT_LAND,
];

function isInt(value) {
  return typeof value === 'number' && Number.isInteger(value);
}

// Returns an empty string when the command is well formed, otherwise a short
// reason. Malformed commands are dropped by the reducer, never thrown on: they
// arrive from the network and a bad one must not stop the war.
function validateCommand(command) {
  if (command === undefined || command === null) return 'missing command';
  if (typeof command.type !== 'string') return 'missing type';
  const type = command.type;

  if (type === CMD_ADVANCE_TICK) return '';

  if (type === CMD_SET_THROTTLE) {
    if (!isInt(command.carrierId)) return 'carrierId must be an integer';
    if (!isInt(command.throttle)) return 'throttle must be an integer';
    // The SHIP has a reverse gear (manual coverage review, item 4): the
    // original's speed scale gave its bottom quarter to astern, and so does
    // ours - -25 is a quarter of the scale, and a quarter of 178 knots is
    // near enough the original's 22 astern. Units stay 0..100: a Manta has
    // no reverse and a Walrus that needs one turns around.
    if (command.throttle < THROTTLE_ASTERN || command.throttle > THROTTLE_MAX) return 'throttle out of range';
    return '';
  }
  if (type === CMD_SET_RUDDER) {
    if (!isInt(command.carrierId)) return 'carrierId must be an integer';
    if (!isInt(command.rudder)) return 'rudder must be an integer';
    if (command.rudder < -1 || command.rudder > 1) return 'rudder out of range';
    return '';
  }
  if (type === CMD_SET_HEADING) {
    if (!isInt(command.carrierId)) return 'carrierId must be an integer';
    if (!isInt(command.heading)) return 'heading must be an integer';
    if (command.heading < 0 || command.heading > 65535) return 'heading out of range';
    return '';
  }
  if (type === CMD_LAUNCH_UNIT) {
    if (!isInt(command.carrierId)) return 'carrierId must be an integer';
    if (!isInt(command.kind)) return 'kind must be an integer';
    if (command.kind < 0 || command.kind > 2) return 'no such unit kind';
    return '';
  }
  if (type === CMD_SET_STOCKPILE) {
    if (!isInt(command.carrierId)) return 'carrierId must be an integer';
    if (!isInt(command.islandId)) return 'islandId must be an integer';
    return '';
  }
  if (type === CMD_SET_REPAIR_PRIORITY) {
    if (!isInt(command.carrierId)) return 'carrierId must be an integer';
    if (!isInt(command.section)) return 'section must be an integer';
    if (command.section < 0 || command.section > 6) return 'no such section';
    if (!isInt(command.priority)) return 'priority must be an integer';
    if (command.priority < 0 || command.priority > 2) return 'priority out of range';
    return '';
  }
  if (type === CMD_SET_ISLAND_ROLE) {
    if (!isInt(command.carrierId)) return 'carrierId must be an integer';
    if (!isInt(command.islandId)) return 'islandId must be an integer';
    if (!isInt(command.role)) return 'role must be an integer';
    if (command.role < 0 || command.role > 2) return 'no such island role';
    return '';
  }
  if (type === CMD_BUILD_ON_ISLAND) {
    if (!isInt(command.carrierId)) return 'carrierId must be an integer';
    if (!isInt(command.islandId)) return 'islandId must be an integer';
    if (!isInt(command.what)) return 'what must be an integer';
    if (command.what < 0 || command.what > 6) return 'no such building';
    return '';
  }
  if (type === CMD_SET_COURSE) {
    if (!isInt(command.carrierId)) return 'carrierId must be an integer';
    if (!isInt(command.x) || !isInt(command.y)) return 'destination must be integer coordinates';
    // (-1, -1) clears the course; anything else must be on the map.
    if ((command.x < 0 || command.y < 0) && !(command.x === -1 && command.y === -1)) {
      return 'destination off the map';
    }
    return '';
  }
  if (type === CMD_SET_SUPPLY_BIAS) {
    if (!isInt(command.carrierId)) return 'carrierId must be an integer';
    if (!isInt(command.item)) return 'item must be an integer';
    if (command.item < 0 || command.item > 2) return 'no such item category';
    if (!isInt(command.level)) return 'level must be an integer';
    if (command.level < 0 || command.level > 2) return 'level out of range';
    return '';
  }
  if (type === CMD_SURRENDER) {
    if (!isInt(command.carrierId)) return 'carrierId must be an integer';
    return '';
  }
  if (type === CMD_ORDER_UNIT_ESCORT) {
    if (!isInt(command.unitId)) return 'unitId must be an integer';
    return '';
  }
  if (type === CMD_ORDER_UNIT_LAND) {
    if (!isInt(command.unitId)) return 'unitId must be an integer';
    if (!isInt(command.islandId)) return 'islandId must be an integer';
    return '';
  }
  if (type === CMD_SET_AI) {
    if (!isInt(command.team)) return 'team must be an integer';
    if (!isInt(command.active)) return 'active must be 0 or 1';
    if (command.active < 0 || command.active > 1) return 'active must be 0 or 1';
    return '';
  }
  if (type === CMD_FIRE_FLARES) {
    if (!isInt(command.carrierId)) return 'carrierId must be an integer';
    return '';
  }
  if (type === CMD_SET_SUPPLY_RUN) {
    if (!isInt(command.carrierId)) return 'carrierId must be an integer';
    if (!isInt(command.active)) return 'active must be 0 or 1';
    if (command.active < 0 || command.active > 1) return 'active must be 0 or 1';
    return '';
  }
  if (type === CMD_DEPLOY_POD || type === CMD_DEPLOY_VIRUS) {
    if (!isInt(command.unitId)) return 'unitId must be an integer';
    if (!isInt(command.islandId)) return 'islandId must be an integer';
    return '';
  }
  if (
    type === CMD_RECALL_UNIT
    || type === CMD_TAKE_CONTROL
    || type === CMD_RELEASE_CONTROL
    || type === CMD_FIRE_UNIT
  ) {
    if (!isInt(command.unitId)) return 'unitId must be an integer';
    return '';
  }
  if (type === CMD_SELECT_WEAPON) {
    if (!isInt(command.unitId)) return 'unitId must be an integer';
    if (!isInt(command.weapon)) return 'weapon must be an integer';
    if (command.weapon < 0) return 'no such weapon';
    return '';
  }
  if (type === CMD_ORDER_UNIT_ATTACK) {
    if (!isInt(command.unitId)) return 'unitId must be an integer';
    if (!isInt(command.targetKind)) return 'targetKind must be an integer';
    if (command.targetKind < 0 || command.targetKind > 1) return 'no such target kind';
    if (!isInt(command.targetId)) return 'targetId must be an integer';
    return '';
  }
  if (type === CMD_SET_CARRIER_AIM) {
    if (!isInt(command.carrierId)) return 'carrierId must be an integer';
    if (!isInt(command.targetKind)) return 'targetKind must be an integer';
    // -1 clears the pointer and hands the mount back to its own judgement.
    if (command.targetKind < -1 || command.targetKind > 1) return 'no such target kind';
    if (!isInt(command.targetId)) return 'targetId must be an integer';
    return '';
  }
  if (type === CMD_ORDER_UNIT_MOVE) {
    if (!isInt(command.unitId)) return 'unitId must be an integer';
    if (!isInt(command.x) || !isInt(command.y)) return 'target must be integer coordinates';
    if (command.x < 0 || command.y < 0) return 'target off the map';
    return '';
  }
  if (type === CMD_SET_UNIT_HELM) {
    if (!isInt(command.unitId)) return 'unitId must be an integer';
    if (!isInt(command.throttle)) return 'throttle must be an integer';
    if (command.throttle < THROTTLE_MIN || command.throttle > THROTTLE_MAX) return 'throttle out of range';
    if (!isInt(command.rudder)) return 'rudder must be an integer';
    if (command.rudder < -1 || command.rudder > 1) return 'rudder out of range';
    // Optional so a command log recorded before pitch existed still replays:
    // an absent climb is a level hand on the stick.
    if (command.climb !== undefined) {
      if (!isInt(command.climb)) return 'climb must be an integer';
      if (command.climb < -1 || command.climb > 1) return 'climb out of range';
    }
    return '';
  }
  return 'unknown command type';
}

export {
  THROTTLE_ASTERN,
  CMD_ADVANCE_TICK,
  CMD_SET_THROTTLE,
  CMD_SET_RUDDER,
  CMD_SET_HEADING,
  CMD_LAUNCH_UNIT,
  CMD_RECALL_UNIT,
  CMD_ORDER_UNIT_MOVE,
  CMD_TAKE_CONTROL,
  CMD_RELEASE_CONTROL,
  CMD_SET_UNIT_HELM,
  CMD_DEPLOY_POD,
  CMD_SET_STOCKPILE,
  CMD_SET_SUPPLY_RUN,
  CMD_DEPLOY_VIRUS,
  CMD_FIRE_UNIT,
  CMD_SET_REPAIR_PRIORITY,
  CMD_SELECT_WEAPON,
  CMD_ORDER_UNIT_ATTACK,
  CMD_SET_CARRIER_AIM,
  CMD_FIRE_FLARES,
  CMD_SET_AI,
  CMD_SET_ISLAND_ROLE,
  CMD_BUILD_ON_ISLAND,
  CMD_SET_COURSE,
  CMD_ORDER_UNIT_ESCORT,
  CMD_SET_SUPPLY_BIAS,
  CMD_SURRENDER,
  CMD_ORDER_UNIT_LAND,
  UNIT_COMMANDS,
  THROTTLE_MIN,
  THROTTLE_MAX,
  HEADING_MANUAL,
  validateCommand,
};
