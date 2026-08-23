// shared/options.js - fold a room's choices into a ruleset.
//
// Lives in shared/ because THREE things must fold options identically: the
// server starting a lobby war, the server resuming a save, and the client
// replaying one. A war is seed plus rules, and nothing else.

function applyLobbyOptions(rules, options) {
  const world = { ...rules.world, islandCount: options.islands };
  const teams = Number.isInteger(options.teams) && options.teams >= 2 && options.teams <= 16
    ? options.teams
    : rules.rules.teamCount;
  // The room knows who is human; it passes the machine seats explicitly.
  // Without that knowledge (solo, old saves), enemy=1 means "team 1 is AI".
  const machine = Array.isArray(options.aiTeams)
    ? options.aiTeams
    : (options.enemy === 1 ? [1] : []);
  const base = {
    ...rules.rules,
    teamCount: teams,
    aiTeams: machine,
    pointCap: options.ending === 1 ? 4000 : 0,
    timeCapTicks: options.ending === 2 ? 24000 : 0,
    // The Action Game: the war pre-developed at tick zero (0 = strategy).
    actionStart: options.game === 1 ? 1 : 0,
  };
  return { ...rules, world: world, rules: base };
}

export { applyLobbyOptions };
