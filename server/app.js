// server/app.js - the authoritative LAN server, as a startable object.
//
// Node http for the static client and /healthz, ws for the war. The server
// owns the tick: clients send commands, the server checks them against the
// seat's authority, pumps them through the reducer, and broadcasts each seat
// its own fog-filtered view. No client ever receives state.
//
// Solo play does not come through here at all - client/transport.js runs the
// same engine in the browser. This process exists for LAN and multiplayer.
//
// Split from index.js so tests can start a server on an ephemeral port, drive
// it, and shut it down without spawning a process.

import { createServer } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';

import { createGame, enqueueCommand, stepGame, latestSnapshot } from '../engine/game.js';
import { checkAuthority } from '../engine/authority.js';
import { createClock, isSpeed, setClockSpeed, startClock, stopClock } from './clock.js';
import { serveStatic } from './static.js';
import {
  NO_VOTE,
  castVote,
  clearVotes,
  openProposal,
  tally,
  unanimous,
} from './vote.js';
import {
  applyLobby,
  canStart,
  createLobby,
  lobbyView,
  say,
  setName,
  setOption,
  setReady,
} from './lobby.js';
import { createHolder, expired, holdSeat, isHeld, reclaim, release } from './reconnect.js';
import { resumeGame, saveGame, writeSave } from './save.js';
import { createWatch, watchReport, watchTick } from './watch.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

// `lobby: true` holds the war in a lobby until the host starts it. Off by
// default so every existing caller - the tests, the probes, the smoke gate -
// still gets a war that is already running; server/index.js turns it on.
function createApp(options) {
  const rules = options.rules;
  let seed = options.seed;

  // A save on the table takes precedence over everything: a resumed war is
  // already running, so there is no lobby, and the seed comes from the save.
  // A save that does not replay to its own hash is REFUSED - the reason is
  // kept for /healthz and the log - and a fresh war starts instead, because
  // silently resuming a subtly different war is worse than admitting it.
  let resumedGame = -1;
  let resumeProblem = '';
  if (options.resume !== undefined && options.resume !== 0) {
    const problem = { reason: '' };
    resumedGame = resumeGame(options.resume, rules, problem);
    if (resumedGame === -1) resumeProblem = problem.reason;
    else seed = options.resume.seed;
  }

  const app = {
    rules: rules,
    seed: seed,
    speed: isSpeed(options.speed) ? options.speed : 1,
    game: resumedGame === -1 ? createGame(seed, rules) : resumedGame,
    resumed: resumedGame === -1 ? 0 : 1,
    resumeProblem: resumeProblem,
    // Where the war is written, and when it last was. 0 means never write.
    savePath: options.savePath ?? 0,
    lastSaveMs: 0,
    savedOptions: options.resume !== undefined && options.resume !== 0 && resumedGame !== -1
      ? options.resume.options
      : 0,
    seats: [],
    startedAtMs: Date.now(),
    httpServer: 0,
    wss: 0,
    clock: 0,
    // The playtest watchdog, when it is asked for: reads the state every tick
    // and never writes it, so it cannot change a war it is watching.
    watch: options.watch === true ? createWatch({ stuckAfter: options.stuckAfter }) : 0,
    // Seats held for players who dropped, and the tokens they come back with.
    holder: createHolder(
      options.nowFn ?? (() => Date.now()),
      options.tokenFn ?? (() => Math.random().toString(36).slice(2, 12)),
    ),
    lobby: options.lobby === true && resumedGame === -1
      ? createLobby(options.bootId ?? `${seed}-${Date.now()}`, {
        seed: seed,
        islands: rules.world.islandCount,
        enemy: (rules.rules.aiTeams ?? []).length > 0 ? 1 : 0,
        speed: isSpeed(options.speed) ? options.speed : 1,
      })
      : 0,
  };

  function inLobby() {
    return app.lobby !== 0 && app.lobby.status === 'lobby';
  }

  // Write the war to disk: seed + command log + the options it sailed under.
  // Nothing to save while the room is still arguing about what to fight.
  app.saveNow = function saveNow() {
    if (app.savePath === 0 || inLobby()) return 0;
    const wrote = saveGame(app.game, app.seed, app.savedOptions);
    try {
      writeSave(app.savePath, wrote);
    } catch (error) {
      process.stderr.write(`autosave failed: ${error.message}\n`);
      return 0;
    }
    return 1;
  };

  const AUTOSAVE_MS = 30000;
  const nowMs = options.nowFn ?? (() => Date.now());

  function maybeAutosave() {
    if (app.savePath === 0 || inLobby()) return;
    const now = nowMs();
    if (now - app.lastSaveMs < AUTOSAVE_MS) return;
    app.lastSaveMs = now;
    app.saveNow();
  }

  function send(socket, message) {
    if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(message));
  }

  function seatFor(socket) {
    for (const seat of app.seats) if (seat.socket === socket) return seat;
    return { socket: socket, team: -1 };
  }

  // One human per team; anyone after that watches team 0's view. A seat being
  // held for somebody who dropped is not free - handing it to a newcomer is how
  // a reconnecting player finds a stranger flying their carrier.
  function claimTeam() {
    const taken = [];
    for (const seat of app.seats) taken.push(seat.team);
    for (let t = 0; t < rules.rules.teamCount; t++) {
      if (!taken.includes(t) && !isHeld(app.holder, t)) return t;
    }
    return -1;
  }

  // The token in the socket's URL, if it brought one back.
  function tokenFrom(req) {
    const url = String(req.url ?? '');
    const at = url.indexOf('token=');
    if (at === -1) return '';
    return url.slice(at + 6).split('&')[0];
  }

  // A seat handed to the machine when its grace window runs out, so the other
  // side is fighting somebody rather than an anchored ship.
  function sweepHeldSeats() {
    for (const record of expired(app.holder)) {
      record.aiTaken = 1;
      release(app.holder, record.team);
      if (app.lobby === 0 || app.lobby.status !== 'lobby') {
        enqueueCommand(app.game, { type: 'set_ai', team: record.team, active: 1 });
      }
    }
  }

  function playerSeats() {
    let count = 0;
    for (const seat of app.seats) if (seat.team !== -1) count += 1;
    return count;
  }

  function viewFor(seat, snapshot) {
    // A seat watches its own war; anyone without a seat gets the chart view -
    // islands and common knowledge, nobody's hulls and nobody's stores.
    return seat.team === -1 ? snapshot.spectator : snapshot.views[seat.team];
  }

  function broadcast(snapshot) {
    for (const seat of app.seats) {
      send(seat.socket, {
        type: 'snapshot',
        tick: snapshot.tick,
        // A hash is not a fog leak - it reveals nothing about the state, and it
        // is the only way a client can notice it has desynced.
        stateHash: snapshot.stateHash,
        view: viewFor(seat, snapshot),
      });
    }
  }

  app.health = function health() {
    const snapshot = latestSnapshot(app.game);
    return {
      ok: true,
      game: 'carrier-dominion',
      tick: app.game.state.tick,
      seed: app.seed,
      stateHash: snapshot === -1 ? '' : snapshot.stateHash,
      rulesHash: app.game.state.rulesHash,
      seats: app.seats.length,
      watching: app.watch === 0 ? 0 : app.watch.findings.length,
      // A monitor watching only the tick would read a lobby as a hung server,
      // because a war that has not started does not tick. Say which it is.
      status: app.lobby === 0 ? 'running' : app.lobby.status,
      resumed: app.resumed,
      resumeProblem: app.resumeProblem,
      joinCode: app.lobby === 0 ? '' : app.lobby.code,
      speed: app.clock === 0 ? app.speed : app.clock.speed,
      uptimeS: Math.floor((Date.now() - app.startedAtMs) / 1000),
      rssMb: Math.round(process.memoryUsage().rss / 1048576),
    };
  };

  app.httpServer = createServer((req, res) => {
    // The watchdog's findings, for a playtest to read at the end - or during.
    if (req.url === '/watch') {
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(app.watch === 0 ? { watching: false } : watchReport(app.watch)));
      return;
    }
    if (req.url === '/healthz') {
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(app.health()));
      return;
    }
    // URL paths mirror the repository layout, so a relative import written for
    // Node ("../engine/game.js") resolves to the same file in the browser.
    serveStatic(req, res, [
      { prefix: '/data/', dir: join(ROOT, 'data') },
      { prefix: '/engine/', dir: join(ROOT, 'engine') },
      { prefix: '/shared/', dir: join(ROOT, 'shared') },
      { prefix: '/client/', dir: join(ROOT, 'client') },
      { prefix: '/', dir: join(ROOT, 'client') },
    ]).then((handled) => {
      if (!handled) {
        res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
        res.end('not found');
      }
    }).catch((error) => {
      process.stderr.write(`static error: ${error.message}\n`);
      if (!res.headersSent) res.writeHead(500);
      res.end('server error');
    });
  });

  app.wss = new WebSocketServer({ server: app.httpServer });

  app.wss.on('connection', (socket, req) => {
    sweepHeldSeats();
    // Somebody coming back gets their own seat, with their own name on it, and
    // takes the war back off the machine if it had been handed over.
    const returning = reclaim(app.holder, tokenFrom(req));
    const seat = returning === -1
      ? { socket: socket, team: claimTeam(), vote: NO_VOTE, token: app.holder.tokenFn() }
      : {
        socket: socket,
        team: returning.team,
        vote: NO_VOTE,
        token: returning.token,
        name: returning.name,
      };
    // A human at a seat takes it off the machine, whether they are coming back
    // to it or sitting down at it for the first time. Without this a player who
    // joins a war whose second seat is AI-held ends up sharing one carrier with
    // the AI, and both of them steer.
    if (seat.team !== -1) {
      enqueueCommand(app.game, { type: 'set_ai', team: seat.team, active: 0 });
    }
    app.seats.push(seat);
    send(socket, {
      type: 'welcome',
      team: seat.team,
      seed: app.seed,
      tickHz: rules.rules.tickHz,
      rulesHash: app.game.state.rulesHash,
      spectator: seat.team === -1,
      speed: app.clock.speed,
      speedLocked: playerSeats() > 1 ? 1 : 0,
      lobby: inLobby() ? 1 : 0,
      // Keep this: presenting it after a drop is what gets this seat back.
      token: seat.token,
      resumed: returning === -1 ? 0 : 1,
    });
    if (inLobby()) {
      if (seat.name === undefined) seat.name = `Commander ${seat.team + 1}`;
      seat.ready = 0;
      broadcastLobby();
    }
    // A seat arriving mid-vote resets it: everybody at the table has to agree,
    // and this one has not been asked.
    if (openProposal(app.seats) !== NO_VOTE) {
      clearVotes(app.seats);
      broadcastVote();
    }
    const snapshot = inLobby() ? -1 : latestSnapshot(app.game);
    if (snapshot !== -1) {
      send(socket, {
        type: 'snapshot',
        tick: snapshot.tick,
        stateHash: snapshot.stateHash,
        view: viewFor(seat, snapshot),
      });
    }

    socket.on('message', (raw) => {
      let message;
      try {
        message = JSON.parse(raw.toString());
      } catch {
        send(socket, { type: 'rejected', reason: 'malformed json' });
        return;
      }
      if (message !== null && typeof message === 'object' && isLobbyMessage(message.type)) {
        handleLobby(socket, message);
        return;
      }
      // Nothing else is answered until the war exists. A command aimed at a
      // war that has not started is a client bug, not a seat's business.
      if (inLobby()) {
        send(socket, { type: 'rejected', reason: 'the war has not started' });
        return;
      }
      if (message !== null && typeof message === 'object' && message.type === 'set_speed') {
        // Time compression is a table decision (owner ruling 2026-08-20): the
        // clock moves when every player agrees. Alone, that is you.
        const problem = castVote(app.seats, seatFor(socket), message.speed);
        if (problem !== '') {
          send(socket, { type: 'rejected', reason: problem });
          return;
        }
        settleVote();
        return;
      }
      if (message === null || typeof message !== 'object' || message.type !== 'command') {
        send(socket, { type: 'rejected', reason: 'unknown message type' });
        return;
      }
      const problem = checkAuthority(app.game.state, seatFor(socket).team, message.command);
      if (problem !== '') {
        send(socket, { type: 'rejected', reason: problem });
        return;
      }
      enqueueCommand(app.game, message.command);
    });

    const drop = () => {
      const index = app.seats.indexOf(seat);
      if (index < 0) return; // already dropped; a socket can fire both events
      app.seats.splice(index, 1);
      // Hold the seat rather than freeing it: a locked phone should not cost
      // somebody their carrier, and the war should not stop for them either.
      if (seat.team !== -1) holdSeat(app.holder, seat);
      // Somebody leaving can complete a vote the rest had already agreed on.
      settleVote();
      // And in the lobby it can pass the host seat, or make the room ready.
      if (inLobby()) broadcastLobby();
    };
    socket.on('close', drop);
    socket.on('error', drop);
  });

  const LOBBY_TYPES = ['lobby_name', 'lobby_ready', 'lobby_option', 'lobby_start', 'lobby_say'];

  function isLobbyMessage(type) {
    return LOBBY_TYPES.includes(type);
  }

  function broadcastLobby() {
    if (app.lobby === 0) return;
    const view = lobbyView(app.lobby, app.seats);
    for (const other of app.seats) send(other.socket, { type: 'lobby', lobby: view });
  }

  // The war the room agreed on. The lobby's choices are folded into the RULESET
  // and the game rebuilt from seed - the same path the solo start menu takes,
  // so a lobby war and a solo war are the same kind of object.
  function startWar() {
    const chosen = applyLobby(rules, app.lobby.options);
    app.seed = app.lobby.options.seed;
    app.game = createGame(app.seed, chosen);
    // The choices ride with every save: resume rebuilds the ruleset from
    // data/*.json plus exactly these, the same path a fresh war takes.
    app.savedOptions = {
      seed: app.lobby.options.seed,
      islands: app.lobby.options.islands,
      enemy: app.lobby.options.enemy,
      ending: app.lobby.options.ending,
      speed: app.lobby.options.speed,
    };
    app.lobby.status = 'running';
    setClockSpeed(app.clock, app.lobby.options.speed);
    broadcastLobby();
    for (const seat of app.seats) {
      send(seat.socket, {
        type: 'welcome',
        team: seat.team,
        seed: app.seed,
        tickHz: chosen.rules.tickHz,
        rulesHash: app.game.state.rulesHash,
        spectator: seat.team === -1,
        speed: app.clock.speed,
        speedLocked: playerSeats() > 1 ? 1 : 0,
        lobby: 0,
      });
    }
    broadcast(stepGame(app.game));
  }

  function handleLobby(socket, message) {
    if (app.lobby === 0 || app.lobby.status !== 'lobby') {
      send(socket, { type: 'rejected', reason: 'there is no lobby' });
      return;
    }
    const seat = seatFor(socket);
    let problem = '';
    if (message.type === 'lobby_name') problem = setName(seat, message.name);
    else if (message.type === 'lobby_say') problem = say(app.lobby, app.seats, seat, message.text);
    else if (message.type === 'lobby_ready') problem = setReady(seat, message.ready);
    else if (message.type === 'lobby_option') {
      problem = setOption(app.lobby, app.seats, seat, message.key, message.value);
    } else if (message.type === 'lobby_start') {
      problem = canStart(app.lobby, app.seats, seat);
      if (problem === '') {
        startWar();
        return;
      }
    }
    if (problem !== '') {
      send(socket, { type: 'rejected', reason: problem });
      return;
    }
    broadcastLobby();
  }

  // Tell the table where the vote stands, so a HUD can show "2 of 3 for x4".
  function broadcastVote() {
    const proposal = openProposal(app.seats);
    const count = tally(app.seats, proposal);
    for (const other of app.seats) {
      send(other.socket, {
        type: 'vote',
        speed: proposal,
        agreed: proposal === NO_VOTE ? 0 : count.agreed,
        players: count.players,
      });
    }
  }

  // Carry the vote if it is unanimous, otherwise just report where it stands.
  function settleVote() {
    const agreed = unanimous(app.seats);
    if (agreed === NO_VOTE) {
      broadcastVote();
      return;
    }
    if (!setClockSpeed(app.clock, agreed)) {
      clearVotes(app.seats);
      broadcastVote();
      return;
    }
    clearVotes(app.seats);
    for (const other of app.seats) send(other.socket, { type: 'speed', speed: app.clock.speed });
    broadcastVote();
  }

  // The clock does not run a war nobody has started. Without this the game
  // built at construction ticks away behind the lobby, seats receive snapshots
  // of a war they never agreed to, and pressing START looks like it worked
  // because there was already a war on screen.
  app.clock = createClock(rules.rules.msPerTick, () => {
    if (inLobby()) return;
    sweepHeldSeats();
    const startedMs = app.watch === 0 ? 0 : performance.now();
    const snapshot = stepGame(app.game);
    if (app.watch !== 0) watchTick(app.watch, app.game.state, performance.now() - startedMs);
    broadcast(snapshot);
    maybeAutosave();
  }, app.speed);

  app.listen = function listen(port, host) {
    return new Promise((resolve) => {
      app.httpServer.listen(port, host, () => {
        startClock(app.clock);
        resolve(app.httpServer.address());
      });
    });
  };

  app.close = function close() {
    stopClock(app.clock);
    // The last word on disk is the war as it stood when the process left.
    app.saveNow();
    for (const seat of app.seats.slice()) seat.socket.terminate();
    return new Promise((resolve) => {
      app.wss.close(() => app.httpServer.close(() => resolve(true)));
    });
  };

  return app;
}

export { createApp, ROOT };
