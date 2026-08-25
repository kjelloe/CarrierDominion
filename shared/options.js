// shared/options.js - fold a room's choices into a ruleset.
//
// Lives in shared/ because THREE things must fold options identically: the
// server starting a lobby war, the server resuming a save, and the client
// replaying one. A war is seed plus rules, and nothing else.

// The ladder, or what the two older switches meant before it existed.
function startShapeOf(options) {
  if (Number.isInteger(options.start) && options.start >= 0 && options.start <= 3) {
    return options.start;
  }
  if (options.game === 1) return 2; // the old Action Game
  if (options.home === 0) return 1; // the old from-zero opening
  return 0;
}

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
    // How far along the war starts (ruled 2026-08-25): 0 a home island
    // each, 1 nothing at all, 2 a developed war, 3 a late one. Saves and
    // replays recorded before the ladder carry the two switches it
    // replaced, so those are still read - a war must replay as it was
    // played, and the command log is the save format.
    startShape: startShapeOf(options),
  };
  if (options.network === 0) world.networkLinkMetres = 0;
  return { ...rules, world: world, rules: base };
}

export { applyLobbyOptions };
