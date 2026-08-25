// server/lobby.js - the room before the war.
//
// Adapted from multiciv's lobby (../multiciv/server/lobby.js), cut down to the
// shape this game actually has. Multiciv's server hosts MANY games and needs a
// registry keyed by game id; a Carrier Dominion server hosts ONE war, so what
// is left is the part that matters: the host owns the options, everyone sees
// them live, seats carry names, and nobody sails until the table is ready.
//
// Kept from multiciv because they earn their place:
//
//   join code   five Crockford characters, derived from the boot id, so a host
//               can read it down a phone instead of dictating a URL
//   host seat   the first player to sit down owns the options; if they leave,
//               the seat passes rather than the lobby dying with them
//   ready       every player says so before the war starts, which is the same
//               unanimity rule the clock vote already uses
//
// Deliberately socket-free and rules-free: a seat is any object with a team, a
// name and a ready flag, and the options are a plain record that is folded into
// a ruleset at the end. That is what makes the whole thing testable in Node.

// Crockford base32 without the letters that get misheard.
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

const OPTION_VALUES = {
  islands: [4, 8, 16, 32, 48, 64],
  teams: [2, 3, 4, 8, 16],
  enemy: [1, 0],
  ending: [0, 1, 2],
  speed: [1, 2, 4, 8, 16],
  // 0 the Strategy Game (from zero), 1 the Action Game (minutes from contact).
  game: [0, 1],
  // Observers welcome (1, the referee view) or the door closed (0).
  observers: [1, 0],
  // The home island, and the resource network as geography (ruled
  // 2026-08-25). 1 is the game as built; 0 is the older, simpler shape.
  home: [1, 0],
  network: [1, 0],
};

function fnv32(text) {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) {
    hash = hash ^ text.charCodeAt(i);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash;
}

// Five characters from a boot id. Deterministic for a given id, which is what
// lets a test assert on it and a host write it on a whiteboard.
function joinCode(bootId) {
  let hash = fnv32(String(bootId));
  let code = '';
  for (let i = 0; i < 5; i++) {
    code = CROCKFORD.charAt(hash % 32) + code;
    hash = Math.floor(hash / 32);
  }
  return code;
}

// How much of the conversation the room remembers. A lobby is not a chat
// client; this is enough to see what was agreed while you were connecting.
const CHAT_KEPT = 24;
const CHAT_MAX = 160;

function createLobby(bootId, defaults) {
  return {
    code: joinCode(bootId),
    status: 'lobby',
    chat: [],
    options: {
      seed: defaults.seed,
      islands: defaults.islands,
      teams: 2,
      enemy: defaults.enemy,
      ending: 0,
      speed: defaults.speed,
      game: 0,
      observers: 1,
      home: 1,
      network: 1,
    },
  };
}

function isPlayer(seat) {
  return seat.team !== -1;
}

function players(seats) {
  const out = [];
  for (let i = 0; i < seats.length; i++) {
    if (isPlayer(seats[i])) out.push(seats[i]);
  }
  return out;
}

// The host is the longest-seated player. Not a stored flag: a flag would have
// to be maintained on every disconnect, and this cannot go stale.
function hostSeat(seats) {
  const list = players(seats);
  return list.length === 0 ? -1 : list[0];
}

function isHost(seats, seat) {
  return hostSeat(seats) === seat;
}

function setName(seat, name) {
  if (typeof name !== 'string') return 'a name must be text';
  const trimmed = name.slice(0, 24).replace(/[^ -~]/g, '').trim();
  seat.name = trimmed === '' ? seat.name : trimmed;
  return '';
}

function setReady(seat, ready) {
  if (!isPlayer(seat)) return 'spectators do not sail';
  seat.ready = ready === true || ready === 1 ? 1 : 0;
  return '';
}

// Only the host changes the war everybody is about to fight. A value not on the
// ladder is refused rather than clamped: a silent clamp is how a host ends up
// playing a different game from the one they set.
function setOption(lobby, seats, seat, key, value) {
  if (!isHost(seats, seat)) return 'only the host sets the war';
  if (key === 'seed') {
    if (!Number.isInteger(value) || value < 0) return 'a seed is a whole number';
    lobby.options.seed = value;
    return '';
  }
  const ladder = OPTION_VALUES[key];
  if (ladder === undefined) return 'no such option';
  if (!ladder.includes(value)) return 'not a value that option takes';
  lobby.options[key] = value;
  // Changing the war unreadies the room: everybody agreed to something else.
  for (const other of players(seats)) other.ready = 0;
  return '';
}

// One line of conversation. Trimmed to something printable and short, because
// the room's text goes to every other client and the same rule that keeps the
// state hash honest - printable ASCII, bounded length - is a good rule for
// anything a stranger can type.
function say(lobby, seats, seat, text) {
  if (typeof text !== 'string') return 'a message must be text';
  const clean = text.slice(0, CHAT_MAX).replace(/[^ -~]/g, '').trim();
  if (clean === '') return 'nothing to say';
  lobby.chat.push({
    team: seat.team,
    name: seat.name === undefined ? '' : seat.name,
    text: clean,
  });
  while (lobby.chat.length > CHAT_KEPT) lobby.chat.shift();
  return '';
}

// Everybody seated has said yes. One player alone is unanimous by definition,
// which is the same rule the clock vote uses and needs no special case.
function allReady(seats) {
  const list = players(seats);
  if (list.length === 0) return false;
  for (let i = 0; i < list.length; i++) {
    if (list[i].ready !== 1) return false;
  }
  return true;
}

function canStart(lobby, seats, seat) {
  if (lobby.status !== 'lobby') return 'the war has already started';
  if (!isHost(seats, seat)) return 'only the host starts the war';
  if (!allReady(seats)) return 'not everybody is ready';
  return '';
}

// What the room looks like to everybody in it.
function lobbyView(lobby, seats) {
  const host = hostSeat(seats);
  const roster = [];
  for (const seat of seats) {
    roster.push({
      team: seat.team,
      name: seat.name === undefined ? '' : seat.name,
      ready: seat.ready === 1 ? 1 : 0,
      host: seat === host ? 1 : 0,
    });
  }
  return {
    code: lobby.code,
    status: lobby.status,
    options: {
      seed: lobby.options.seed,
      islands: lobby.options.islands,
      teams: lobby.options.teams,
      enemy: lobby.options.enemy,
      ending: lobby.options.ending,
      speed: lobby.options.speed,
      game: lobby.options.game,
      observers: lobby.options.observers,
      home: lobby.options.home,
      network: lobby.options.network,
    },
    seats: roster,
    ready: allReady(seats) ? 1 : 0,
    chat: lobby.chat.map((line) => ({ team: line.team, name: line.name, text: line.text })),
  };
}

// Fold the room's choices into a ruleset. Moved to shared/options.js so the
// resume path and the client's replay viewer fold identically; this name
// stays for the server's callers.
import { applyLobbyOptions } from '../shared/options.js';

function applyLobby(rules, options) {
  return applyLobbyOptions(rules, options);
}

export {
  CHAT_KEPT,
  CHAT_MAX,
  OPTION_VALUES,
  fnv32,
  joinCode,
  createLobby,
  players,
  hostSeat,
  isHost,
  setName,
  setReady,
  setOption,
  say,
  allReady,
  canStart,
  lobbyView,
  applyLobby,
};
