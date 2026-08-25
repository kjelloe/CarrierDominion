// engine/authority.js - who is allowed to order what.
//
// The ws transport is the untrusted path: a client sends command objects, and
// nothing but this module stands between a modified client and the enemy's
// helm. Solo play routes through the same check so the two paths cannot drift,
// which is why this lives in engine/ rather than server/ - the browser loads
// exactly the same file.

import { CMD_ADVANCE_TICK, CMD_SET_ROUTE, UNIT_COMMANDS, validateCommand } from './commands.js';

function carrierTeam(state, carrierId) {
  for (let i = 0; i < state.carriers.length; i++) {
    if (state.carriers[i].id === carrierId) return state.carriers[i].team;
  }
  return -1;
}

// A scan, not Array.includes: engine/ stays inside the Luau-portable subset
// (docs/01).
function isUnitCommand(type) {
  for (let i = 0; i < UNIT_COMMANDS.length; i++) {
    if (UNIT_COMMANDS[i] === type) return true;
  }
  return false;
}

function unitTeam(state, unitId) {
  for (let i = 0; i < state.units.length; i++) {
    if (state.units[i].id === unitId) return state.units[i].team;
  }
  return -1;
}

// Returns '' when the seat may issue this command, otherwise the reason.
function checkAuthority(state, team, command) {
  const problem = validateCommand(command);
  if (problem !== '') return problem;
  if (command.type === CMD_ADVANCE_TICK) return 'advance_tick is server-owned';
  if (team < 0) return 'spectators may not issue commands';

  // A route belongs to a unit OR to the ship (ruled 2026-08-25), so it is
  // the one command whose subject is not fixed by its type.
  if (command.type === CMD_SET_ROUTE && command.unitId !== undefined) {
    const owner = unitTeam(state, command.unitId);
    if (owner === -1) return 'no such unit';
    if (owner !== team) return 'that unit belongs to another team';
    return '';
  }

  if (isUnitCommand(command.type)) {
    const owner = unitTeam(state, command.unitId);
    if (owner === -1) return 'no such unit';
    if (owner !== team) return 'that unit belongs to another team';
    return '';
  }

  if (command.carrierId === undefined) return 'command has no subject';
  const owner = carrierTeam(state, command.carrierId);
  if (owner === -1) return 'no such carrier';
  if (owner !== team) return 'that hull belongs to another team';
  return '';
}

export { checkAuthority, carrierTeam, unitTeam };
