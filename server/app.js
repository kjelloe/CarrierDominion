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

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

function createApp(options) {
  const rules = options.rules;
  const seed = options.seed;
  const app = {
    rules: rules,
    seed: seed,
    speed: isSpeed(options.speed) ? options.speed : 1,
    game: createGame(seed, rules),
    seats: [],
    startedAtMs: Date.now(),
    httpServer: 0,
    wss: 0,
    clock: 0,
  };

  function send(socket, message) {
    if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(message));
  }

  function seatFor(socket) {
    for (const seat of app.seats) if (seat.socket === socket) return seat;
    return { socket: socket, team: -1 };
  }

  // One human per team; anyone after that watches team 0's view.
  function claimTeam() {
    const taken = [];
    for (const seat of app.seats) taken.push(seat.team);
    for (let t = 0; t < rules.rules.teamCount; t++) {
      if (!taken.includes(t)) return t;
    }
    return -1;
  }

  function playerSeats() {
    let count = 0;
    for (const seat of app.seats) if (seat.team !== -1) count += 1;
    return count;
  }

  function viewFor(seat, snapshot) {
    return snapshot.views[seat.team === -1 ? 0 : seat.team];
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
      speed: app.clock === 0 ? app.speed : app.clock.speed,
      uptimeS: Math.floor((Date.now() - app.startedAtMs) / 1000),
      rssMb: Math.round(process.memoryUsage().rss / 1048576),
    };
  };

  app.httpServer = createServer((req, res) => {
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

  app.wss.on('connection', (socket) => {
    const seat = { socket: socket, team: claimTeam(), vote: NO_VOTE };
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
    });
    // A seat arriving mid-vote resets it: everybody at the table has to agree,
    // and this one has not been asked.
    if (openProposal(app.seats) !== NO_VOTE) {
      clearVotes(app.seats);
      broadcastVote();
    }
    const snapshot = latestSnapshot(app.game);
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
      if (index >= 0) app.seats.splice(index, 1);
      // Somebody leaving can complete a vote the rest had already agreed on.
      settleVote();
    };
    socket.on('close', drop);
    socket.on('error', drop);
  });

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

  app.clock = createClock(rules.rules.msPerTick, () => broadcast(stepGame(app.game)), app.speed);

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
    for (const seat of app.seats.slice()) seat.socket.terminate();
    return new Promise((resolve) => {
      app.wss.close(() => app.httpServer.close(() => resolve(true)));
    });
  };

  return app;
}

export { createApp, ROOT };
