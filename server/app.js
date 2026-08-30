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
import { randomBytes } from 'node:crypto';
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
  isHost,
  lobbyView,
  say,
  setName,
  setOption,
  setReady,
} from './lobby.js';
import { createHolder, expired, holdSeat, isHeld, reclaim, release } from './reconnect.js';
import { admit, banAddress, createDoorman } from './doorman.js';
import { resumeGame, saveGame, saveLogOnly, writeSave } from './save.js';
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
  let speed = isSpeed(options.speed) ? options.speed : 1;
  if (options.resume !== undefined && options.resume !== 0) {
    const problem = { reason: '' };
    resumedGame = resumeGame(options.resume, rules, problem);
    if (resumedGame === -1) resumeProblem = problem.reason;
    else {
      seed = options.resume.seed;
      // The war comes back at the speed its table chose, not at the process
      // environment's default.
      const saved = options.resume.options;
      if (saved !== 0 && saved !== undefined && isSpeed(saved.speed)) speed = saved.speed;
    }
  }

  const app = {
    rules: rules,
    seed: seed,
    speed: speed,
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
    // Why the clock stopped, if it did. '' while all is well; /healthz
    // reports it so a watching operator sees a halt rather than a silence.
    halted: '',
    startedAtMs: Date.now(),
    httpServer: 0,
    wss: 0,
    clock: 0,
    // The playtest watchdog, when it is asked for: reads the state every tick
    // and never writes it, so it cannot change a war it is watching.
    watch: options.watch === true ? createWatch({ stuckAfter: options.stuckAfter }) : 0,
    // Seats held for players who dropped, and the tokens they come back with.
    // Where the server's own diagnostics go. Default stderr; a test that
    // DELIBERATELY breaks the engine passes a collector instead, so a passing
    // suite stops printing `Error:` and a stack trace. That noise is not free:
    // it was read as a test failure on 2026-08-31 and cost a round trip, which
    // is exactly the "a probe that cries wolf gets ignored" lesson arriving
    // from the other direction.
    logFn: options.logFn ?? ((text) => process.stderr.write(text)),
    doorman: createDoorman(options.nowFn ?? (() => Date.now())),
    holder: createHolder(
      options.nowFn ?? (() => Date.now()),
      // A seat token is what lets somebody take a held carrier back, so it
      // should not be guessable (review R-012). Math.random is not a random
      // number generator in the sense this needs - it is seeded from the
      // process and predictable from a few outputs. On a LAN behind a join
      // code the exposure is small, which is why this waited; it is also one
      // line, which is why it should not have waited.
      options.tokenFn ?? (() => randomBytes(12).toString('base64url')),
    ),
    // A war room whenever the server is asked for one - INCLUDING after a
    // resume (review R-004). It used to be built only when `resumedGame ===
    // -1`, so a resumed war had `app.lobby === 0` and `reopenRoom` answered
    // "there is no war room" for the rest of the process's life. Since
    // RESUME=auto is the service setting (server/index.js), that was the
    // hosted box's state after every restart: a table could finish the war
    // they were in and then had no way to start another without someone
    // restarting the server by hand, which is the exact opposite of the
    // docs/03 promise that one join code hands friends a whole evening.
    lobby: options.lobby === true
      ? createLobby(options.bootId ?? `${seed}-${Date.now()}`, {
        seed: seed,
        islands: rules.world.islandCount,
        enemy: (rules.rules.aiTeams ?? []).length > 0 ? 1 : 0,
        speed: isSpeed(options.speed) ? options.speed : 1,
      })
      : 0,
    // Observers on or off (ruling 2026-08-23): a room decides at its own
    // table; a lobbyless server takes the boot option, on by default.
    observersDefault: options.observers === 0 ? 0 : 1,
  };

  // A resumed war is already under way, so its room opens in `running` - not
  // in `lobby`, which is what `inLobby()` reads to decide whether the clock
  // should tick. Getting this wrong would be worse than the bug it fixes: the
  // resumed war would sit in a war room and never advance a tick.
  //
  // The room also inherits the options the war was actually started with, so
  // when the table takes the room back after finishing it, the dials read
  // what they were playing rather than the server's defaults.
  if (resumedGame !== -1 && app.lobby !== 0) {
    app.lobby.status = 'running';
    if (app.savedOptions !== 0 && app.savedOptions !== undefined) {
      const saved = app.savedOptions;
      const keys = Object.keys(app.lobby.options);
      for (let i = 0; i < keys.length; i++) {
        if (saved[keys[i]] !== undefined) app.lobby.options[keys[i]] = saved[keys[i]];
      }
    }
  }

  function inLobby() {
    return app.lobby !== 0 && app.lobby.status === 'lobby';
  }

  function observersAllowed() {
    if (app.lobby !== 0) return app.lobby.options.observers === 1;
    return app.observersDefault === 1;
  }

  // Write the war to disk: seed + command log + the options it sailed under.
  // Nothing to save while the room is still arguing about what to fight.
  app.saveNow = function saveNow() {
    if (app.savePath === 0 || inLobby()) return 0;
    // `saveGame` is inside the try as well as the write. It walks the state,
    // and the state is exactly what may be broken when this matters most -
    // the halt path calls saveNow precisely because something threw. An
    // autosave that throws on the way out took the shutdown with it.
    try {
      writeSave(app.savePath, saveGame(app.game, app.seed, app.savedOptions));
    } catch (error) {
      app.logFn(`autosave failed: ${error.message}\n`);
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
    // The table's size is the ROOM's choice while the room is open, and the
    // running war's afterwards - never the base ruleset's, which only knows
    // about two.
    const tableSize = inLobby()
      ? (app.lobby.options.teams ?? rules.rules.teamCount)
      : app.game.state.teams.length;
    for (let t = 0; t < tableSize; t++) {
      if (!taken.includes(t) && !isHeld(app.holder, t)) return t;
    }
    return -1;
  }

  // The room's join code, if the socket brought one. Same parser as the token
  // below and for the same reason: `indexOf('code=')` would also match
  // `?joincode=` and `?xcode=` (review R-012).
  function codeFrom(req) {
    try {
      const url = new URL(String(req.url ?? ''), 'http://carrier.invalid');
      return url.searchParams.get('code') ?? '';
    } catch (error) {
      return '';
    }
  }

  // The token in the socket's URL, if it brought one back.
  //
  // Parsed rather than searched for. `indexOf('token=')` also matches
  // `?xtoken=` and `?not-a-token=`, so a parameter that merely ENDED in the
  // right letters was read as a seat token (review R-012). The base is a
  // throwaway - only the query matters.
  function tokenFrom(req) {
    try {
      const url = new URL(String(req.url ?? ''), 'http://carrier.invalid');
      return url.searchParams.get('token') ?? '';
    } catch (error) {
      return '';
    }
  }

  // A seat handed to the machine when its grace window runs out, so the other
  // side is fighting somebody rather than an anchored ship.
  // The machine takes the wheel when the grace window runs out - but the HOLD
  // IS KEPT (owner's ruling 2026-08-27, review R-006). It used to be released
  // here, which deleted the record, so `reclaim` could never find the token
  // again and a commander back from a long walk was handed `claimTeam()`'s
  // lowest free seat: a different carrier, their name discarded, and the AI
  // still flying their ship.
  //
  // Keeping the record means the token still names the seat. The AI is a
  // caretaker, not a claimant: it holds the carrier until its commander comes
  // back for it, and only a NEW player taking the team retires the hold.
  function sweepHeldSeats() {
    for (const record of expired(app.holder)) {
      if (record.aiTaken === 1) continue;
      record.aiTaken = 1;
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

  // The table is told, rather than left watching a frozen tick counter.
  function broadcastHalt() {
    for (const seat of app.seats) {
      send(seat.socket, { type: 'halted', reason: app.halted });
    }
  }

  // The war room's code, for the host and for the process itself. Deliberately
  // NOT part of app.health() - see hasJoinCode there.
  app.joinCode = function joinCodeNow() {
    return app.lobby === 0 ? '' : app.lobby.code;
  };

  app.health = function health() {
    const snapshot = latestSnapshot(app.game);
    return {
      ok: app.halted === '',
      halted: app.halted,
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
      // NOT the code itself. /healthz is reachable from the internet by the
      // shared-box monitoring contract (ops/DEPLOY.md), and a room's code has
      // no business on an endpoint built for a monitor. A monitor only ever
      // needed to know that a room is WAITING, which is what this says.
      //
      // Be honest about what this buys: the code is a LABEL, not a lock. The
      // server never verifies one and the client never sends one, so nothing
      // gates a seat (docs/03; pinned by test/server_ws.test.js "a stranger
      // with no token and no code is given a carrier"). Keeping the code off a
      // public endpoint is defence in depth, not the door.
      //
      // The code is not merely stripped on the way out, it is not in the
      // object at all: a field that must not be published cannot live in the
      // thing that gets published, or the next endpoint to serve this object
      // leaks it again. Ask app.joinCode() for the code - the boot log already
      // prints it, and that is where the host reads it.
      hasJoinCode: app.lobby === 0 ? 0 : 1,
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
      app.logFn(`static error: ${error.message}\n`);
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

    // The door (owner rulings, 2026-08-31): a war IN PROGRESS needs the room's
    // join code, and a kicked address waits a minute. An open LOBBY is
    // deliberately still open - strangers wandering in before the table sails
    // is how a drop-in game works, and the kick is the answer to the ones who
    // should not stay. A returning commander's token beats both, or the
    // ruling that they get their ship back would not survive.
    const refusal = admit(app.doorman, {
      address: req.socket === undefined ? '' : req.socket.remoteAddress,
      hasToken: returning === -1 ? 0 : 1,
      roomCode: app.lobby === 0 ? '' : app.lobby.code,
      started: app.lobby !== 0 && app.lobby.status !== 'lobby' ? 1 : 0,
      code: codeFrom(req),
    });
    if (refusal !== '') {
      send(socket, { type: 'rejected', reason: refusal });
      socket.close();
      return;
    }

    const claimed = returning === -1 ? claimTeam() : returning.team;
    // No seat and no observers allowed: the door is closed, and it says so.
    if (returning === -1 && claimed === -1 && !observersAllowed()) {
      send(socket, { type: 'rejected', reason: 'the table does not take observers' });
      socket.close();
      return;
    }
    // A newcomer sitting down at a seat the AI was minding retires that hold:
    // the absent commander's token stops opening it, because somebody is
    // actually flying it now.
    if (returning === -1 && claimed !== -1) release(app.holder, claimed);
    // The address is kept on the SEAT. Reaching into `socket._socket` for it
    // later works today and is one ws upgrade away from being undefined, which
    // would silently turn every kick into a kick with no ban.
    const address = req.socket === undefined ? '' : req.socket.remoteAddress;
    const seat = returning === -1
      ? { socket: socket, team: claimed, vote: NO_VOTE, token: app.holder.tokenFn(), address: address }
      : {
        socket: socket,
        team: returning.team,
        vote: NO_VOTE,
        token: returning.token,
        name: returning.name,
        address: address,
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
      // Kick is handled BEFORE the lobby dispatch and outside it, because
      // handleLobby refuses everything once the war has started - and a
      // stranger who needs removing is most likely to need it mid-war, not
      // while the table is still choosing islands.
      if (message !== null && typeof message === 'object' && message.type === 'kick') {
        handleKick(socket, message);
        return;
      }
      if (message !== null && typeof message === 'object' && isLobbyMessage(message.type)) {
        handleLobby(socket, message);
        return;
      }
      if (message !== null && typeof message === 'object' && message.type === 'lobby_reopen') {
        const problem = reopenRoom(seatFor(socket));
        if (problem !== '') send(socket, { type: 'rejected', reason: problem });
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
      //
      // Unless they were KICKED, in which case holding the seat open for their
      // return is the opposite of what the host asked for. The seat is freed
      // at once, and if a war is running the machine takes the carrier - a
      // held seat would have waited out the grace window before the AI got it,
      // leaving a hull nobody was flying in the meantime.
      if (seat.team !== -1 && seat.kicked !== 1) {
        holdSeat(app.holder, seat);
      } else if (seat.team !== -1 && !inLobby()) {
        enqueueCommand(app.game, { type: 'set_ai', team: seat.team, active: 1 });
      }
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
    // Each war gets a fresh watchdog: findings from the last war are the last
    // war's report, not this one's.
    if (app.watch !== 0) app.watch = createWatch({ stuckAfter: options.stuckAfter });
    // The room knows who is human: with the enemy switch on, every seat
    // without a person gets the machine. That list is part of the saved
    // options, so a resumed or replayed war seats the same brains.
    const humans = [];
    for (const seat of app.seats) if (seat.team !== -1) humans.push(seat.team);
    const machine = [];
    if (app.lobby.options.enemy === 1) {
      for (let t = 0; t < app.lobby.options.teams; t++) {
        if (!humans.includes(t)) machine.push(t);
      }
    }
    const chosen = applyLobby(rules, { ...app.lobby.options, aiTeams: machine });
    app.seed = app.lobby.options.seed;
    app.game = createGame(app.seed, chosen);
    // The choices ride with every save: resume rebuilds the ruleset from
    // data/*.json plus exactly these, the same path a fresh war takes.
    app.savedOptions = {
      seed: app.lobby.options.seed,
      islands: app.lobby.options.islands,
      enemy: app.lobby.options.enemy,
      teams: app.lobby.options.teams,
      ending: app.lobby.options.ending,
      speed: app.lobby.options.speed,
      start: app.lobby.options.start,
      network: app.lobby.options.network,
      aiTeams: machine,
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

  // The table gets its room back when the war ends: the host reopens it, the
  // finished war is saved one last time and then left behind, and the same
  // join code keeps working - one code hands friends a whole evening, not one
  // war. Reopening a war still in progress is refused: abandoning is a
  // different decision from finishing.
  function reopenRoom(seat) {
    if (app.lobby === 0) return 'there is no war room';
    if (app.lobby.status === 'lobby') return '';
    if (app.game.state.phase === 0) return 'the war is not over';
    if (!isHost(app.seats, seat)) return 'only the host reopens the room';
    app.saveNow();
    app.lobby.status = 'lobby';
    clearVotes(app.seats);
    for (const other of app.seats) {
      if (other.team === -1) continue;
      if (other.name === undefined) other.name = `Commander ${other.team + 1}`;
      other.ready = 0;
    }
    for (const other of app.seats) {
      send(other.socket, {
        type: 'welcome',
        team: other.team,
        seed: app.seed,
        tickHz: rules.rules.tickHz,
        rulesHash: app.game.state.rulesHash,
        spectator: other.team === -1,
        speed: app.clock.speed,
        speedLocked: playerSeats() > 1 ? 1 : 0,
        lobby: 1,
        token: other.token,
        resumed: 0,
      });
    }
    broadcastLobby();
    broadcastVote();
    return '';
  }

  // The host removes somebody from the table (owner ruling, 2026-08-31). The
  // open lobby is the deliberate half of the access rules; this is the other
  // half, and without it "anyone may join" has no remedy.
  //
  // Works in the room AND during the war. Frees the seat, hands the carrier to
  // the machine if a war is running, and shuts the address out for a minute so
  // the kick is not undone by a reconnect two seconds later.
  function handleKick(socket, message) {
    const seat = seatFor(socket);
    if (seat === undefined) return;
    if (app.lobby === 0) {
      send(socket, { type: 'rejected', reason: 'there is no table to kick from' });
      return;
    }
    if (!isHost(app.seats, seat)) {
      send(socket, { type: 'rejected', reason: 'only the host removes people' });
      return;
    }
    const team = Number(message.team);
    if (!Number.isInteger(team)) {
      send(socket, { type: 'rejected', reason: 'no such seat' });
      return;
    }
    if (team === seat.team) {
      send(socket, { type: 'rejected', reason: 'you cannot remove yourself' });
      return;
    }
    const target = app.seats.find((other) => other.team === team && other !== seat);
    if (target === undefined) {
      send(socket, { type: 'rejected', reason: 'nobody is sitting there' });
      return;
    }
    // The ban is on the ADDRESS, which is the only handle a socket gives us.
    // On a LAN that is one machine; behind one public NAT it may be more than
    // the person kicked, which is a real cost and the reason the window is a
    // minute rather than an evening.
    banAddress(app.doorman, target.address);
    target.kicked = 1;
    send(target.socket, { type: 'kicked', reason: 'the host removed you from this table' });
    // Close AFTER the message, and let the ordinary drop handler do the rest:
    // it releases the seat, hands the team to the AI if a war is running, and
    // tells the room. Duplicating that here is how the two paths drift.
    try { target.socket.close(); } catch (error) { /* already gone */ }
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
    // Once halted, stay halted. `stopClock` clears the interval but `pump`
    // will still issue the ticks that were already DUE in the call that
    // faulted - measured: one injected fault halted four times in a row,
    // each one re-running the failing tick and re-writing the save. The
    // callback has to refuse on its own account.
    if (app.halted !== '') return;
    if (inLobby()) return;
    // The engine THROWS on purpose - `shared/fixed.js` raises RangeError from
    // assertExact, isqrt, divFixed and mulDiv, and the hashing walk raises on
    // a dirty state. Those are the exact faults the watchdog exists to catch,
    // and an unhandled one inside a setInterval kills the process: the
    // SIGINT/SIGTERM shutdown never runs, so the final save never happens and
    // the last thirty seconds of the command log go with it. One arithmetic
    // edge on the 64-island map would have ended the evening for every seat
    // (review R-005).
    //
    // So: stop the clock, save the state as it was BEFORE the failed tick -
    // `apply` copies before it mutates, so app.game.state is still the last
    // good one - and record why, for /healthz. Do not try to keep ticking; a
    // war that has thrown once will throw again, faster than anyone can read
    // the log.
    try {
      sweepHeldSeats();
      const startedMs = app.watch === 0 ? 0 : performance.now();
      const snapshot = stepGame(app.game);
      if (app.watch !== 0) watchTick(app.watch, app.game.state, performance.now() - startedMs);
      broadcast(snapshot);
      maybeAutosave();
    } catch (error) {
      app.halted = `tick ${app.game.state.tick}: ${error.message}`;
      stopClock(app.clock);
      let wrote = app.saveNow();
      // If the ordinary save fails, the STATE is what broke - `saveGame`
      // hashes it - and the command log is still perfectly good. Write the
      // log beside the save so the evening is recoverable by hand. It is not
      // auto-resumable: an empty hash cannot be verified, and resume refusing
      // a mismatch is a guard worth keeping.
      let rescue = '';
      if (wrote === 0 && app.savePath !== 0) {
        rescue = `${app.savePath}.halted`;
        try {
          writeSave(rescue, saveLogOnly(app.game, app.seed, app.savedOptions));
          wrote = 2;
        } catch (again) {
          rescue = `could not be written (${again.message})`;
        }
      }
      const fate = wrote === 1 ? 'saved'
        : (wrote === 2 ? `NOT saved; the command log is in ${rescue}` : 'NOT saved');
      app.logFn(`HALTED at ${app.halted}\n${error.stack ?? ''}\n`
        + `the war is ${fate}; seats stay connected\n`);
      broadcastHalt();
    }
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
