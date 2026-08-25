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
  // A table never larger than its archipelago (third review, 2026-08-23):
  // four islands with sixteen carriers hands most seats a war with nothing
  // in it. The clamp lives in the FOLD, so it is part of the rules hash and
  // every path - lobby, resume, replay - agrees on the war it produces.
  if (Number.isInteger(world.islandCount) && world.islandCount < teams) {
    world.islandCount = teams;
  }
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
    // The war room may play the older, simpler shapes (ruled 2026-08-25):
    // a from-zero opening with no home island, and the distance-free
    // network. Absent means ON - old saves and old replays predate the
    // switches and were played with both.
    homeIslandStart: options.home === 0 ? 0 : 1,
  };
  if (options.network === 0) world.networkLinkMetres = 0;
  return { ...rules, world: world, rules: base };
}

export { applyLobbyOptions };
