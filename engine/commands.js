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

const THROTTLE_MIN = 0;
const THROTTLE_MAX = 100;
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
    if (command.throttle < THROTTLE_MIN || command.throttle > THROTTLE_MAX) return 'throttle out of range';
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
    if (command.kind < 0 || command.kind > 1) return 'no such unit kind';
    return '';
  }
  if (type === CMD_DEPLOY_POD) {
    if (!isInt(command.unitId)) return 'unitId must be an integer';
    if (!isInt(command.islandId)) return 'islandId must be an integer';
    return '';
  }
  if (type === CMD_RECALL_UNIT || type === CMD_TAKE_CONTROL || type === CMD_RELEASE_CONTROL) {
    if (!isInt(command.unitId)) return 'unitId must be an integer';
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
    return '';
  }
  return 'unknown command type';
}

export {
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
  UNIT_COMMANDS,
  THROTTLE_MIN,
  THROTTLE_MAX,
  HEADING_MANUAL,
  validateCommand,
};
