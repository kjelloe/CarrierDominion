// shared/options.js - fold a room's choices into a ruleset.
//
// Lives in shared/ because THREE things must fold options identically: the
// server starting a lobby war, the server resuming a save, and the client
// replaying one. A war is seed plus rules, and nothing else.

function applyLobbyOptions(rules, options) {
  const world = { ...rules.world, islandCount: options.islands };
  const base = {
    ...rules.rules,
    aiTeams: options.enemy === 1 ? [1] : [],
    pointCap: options.ending === 1 ? 4000 : 0,
    timeCapTicks: options.ending === 2 ? 24000 : 0,
  };
  return { ...rules, world: world, rules: base };
}

export { applyLobbyOptions };
