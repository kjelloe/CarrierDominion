// server/app.js - the authoritative LAN server, as a startable object.
//
// Node http for the static client and /healthz, ws for the war, in front of
// the tables in server/room.js: the shared room, and the private rooms
// `?room=new` opens beside it.
//
// Solo play does not come through here at all - client/transport.js runs the
// same engine in the browser. This process exists for LAN and multiplayer.
//
// Split from index.js so tests can start a server on an ephemeral port, drive
// it, and shut it down without spawning a process.

import { createServer } from 'node:http';
import { randomBytes, randomInt } from 'node:crypto';
import { join, resolve } from 'node:path';
import { WebSocketServer } from 'ws';

import { serveStatic } from './static.js';
import { joinCode } from './lobby.js';
import { findHold } from './reconnect.js';
import { HEARTBEAT_MS, MAX_PAYLOAD, originAllowed } from './guard.js';
import { serveNative } from './native.js';
import { watchReport } from './watch.js';
import { ABANDON_MS, PROTOCOL, ROOT, createRoom, paramFrom } from './room.js';

// Private rooms on demand (C13): beyond this many, `?room=new` is refused.
// The shared room is not counted; it always exists.
const MAX_ROOMS = 4;

// The process: one HTTP server and one socket server in front of the shared
// room - the `app` every caller already knows, with its war, seats and clock -
// and up to MAX_ROOMS private rooms beside it. A socket is routed by its URL:
// `?room=new` opens a private room, a private room's `?code=` or a token one
// of them is holding leads back into it, and everything else is the shared
// room, exactly as before there were rooms.
function createApp(options) {
  const app = createRoom(options);
  app.rooms = [];
  app.maxRooms = options.maxRooms ?? MAX_ROOMS;
  const roomHealth = app.health;
  app.health = function health() {
    return { ...roomHealth(), rooms: app.rooms.length };
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
    serveNative(req, res, app.native).then((handled) => handled || serveStatic(req, res, [
      { prefix: '/data/', dir: join(ROOT, 'data') },
      { prefix: '/engine/', dir: join(ROOT, 'engine') },
      { prefix: '/shared/', dir: join(ROOT, 'shared') },
      { prefix: '/client/', dir: join(ROOT, 'client') },
      { prefix: '/', dir: join(ROOT, 'client') },
    ], recordShut)).then((handled) => {
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

  app.wss = new WebSocketServer({
    server: app.httpServer,
    maxPayload: MAX_PAYLOAD,
    // Refused at the upgrade, before a seat or a token is looked at: another
    // website's page has no business driving a visitor's browser into the war.
    verifyClient: (info, done) => {
      if (originAllowed(info.req.headers.origin, info.req.headers.host)) done(true);
      else done(false, 403, 'origin not allowed');
    },
  });

  // The save is the seed plus every order: replayed, it shows the whole war
  // through the fog. Under the default SAVE=data/autosave.json it sits in
  // the served /data/ folder, so while the war is being fought it, its .tmp
  // and its .halted are refused; ?mode=replay opens once the war is over or
  // the room has been reopened. (RetroMultiCiv's R1 was the same leak.)
  function recordShut(filePath) {
    if (app.savePath === 0 || !app.warInProgress()) return false;
    return resolve(filePath).startsWith(resolve(app.savePath));
  }

  app.wss.on('connection', (socket, req) => {
    const room = routeFor(socket, req);
    if (room !== -1) room.accept(socket, req);
  });

  function refuse(socket, reason) {
    if (socket.readyState === socket.OPEN) socket.send(JSON.stringify({ type: 'rejected', reason: reason }));
    socket.close();
  }

  // The room this socket belongs in, or -1 when it has already been dealt
  // with: turned away, or seated in a room opened for it.
  function routeFor(socket, req) {
    if (paramFrom(req, 'room') === 'new') {
      if (paramFrom(req, 'spectate') === '1') {
        refuse(socket, 'a new room needs a player');
        return -1;
      }
      if (app.rooms.length >= app.maxRooms) {
        refuse(socket, 'no free table');
        return -1;
      }
      return openRoom(socket, req);
    }
    const code = paramFrom(req, 'code');
    const token = paramFrom(req, 'token');
    for (const room of app.rooms) {
      if (code !== '' && room.joinCode() === code) return room;
      if (token !== '' && findHold(room.holder, token) !== -1) return room;
    }
    return app;
  }

  function codeTaken(code) {
    if (app.joinCode() === code) return true;
    return app.rooms.some((room) => room.joinCode() === code);
  }

  // A fresh table for the socket that asked, which it seats: its own code,
  // its own seed, observers off, the machine in every empty seat, never
  // written to disk. A socket the room's own door turns away (a stale
  // protocol) takes the room with it.
  function openRoom(socket, req) {
    let bootId = '';
    do {
      bootId = `room-${randomBytes(6).toString('hex')}`;
    } while (codeTaken(joinCode(bootId)));
    const code = joinCode(bootId);
    const room = createRoom({
      seed: randomInt(1, 2147483647),
      rules: options.rules,
      lobby: true,
      bootId: bootId,
      privateRoom: true,
      abandonMs: app.abandonMs,
      logFn: app.logFn,
      noteFn: (text) => app.noteFn(`room ${code}: ${text}`),
      nowFn: options.nowFn,
      tokenFn: options.tokenFn,
    });
    room.accept(socket, req);
    if (room.seats.length === 0) {
      room.stop();
      return -1;
    }
    room.start();
    app.rooms.push(room);
    app.noteFn(`room ${code} opened - ${app.rooms.length} of ${app.maxRooms} private rooms\n`);
    return -1;
  }

  // Once a sweep: the shared room reopens an abandoned war on its own; a
  // private room nobody has sat in for the window is closed.
  function sweepRooms() {
    app.checkAbandoned();
    for (const room of app.rooms.slice()) {
      if (room.checkAbandoned() !== 'reap') continue;
      room.stop();
      app.rooms.splice(app.rooms.indexOf(room), 1);
      app.noteFn(`room ${room.joinCode()} closed, abandoned - ${app.rooms.length} of ${app.maxRooms} private rooms\n`);
    }
  }

  app.listen = function listen(port, host) {
    return new Promise((resolve) => {
      app.httpServer.listen(port, host, () => {
        app.start();
        app.heartbeat = setInterval(beat, options.heartbeatMs ?? HEARTBEAT_MS);
        app.sweeper = setInterval(sweepRooms, options.sweepMs ?? HEARTBEAT_MS);
        resolve(app.httpServer.address());
      });
    });
  };

  // A half-open connection - a laptop lid shut on the wifi - used to hold its
  // seat, and keep the AI off that carrier, until the OS gave up on the TCP
  // connection, which can be hours. A socket that missed the previous ping is
  // terminated; `close` then holds the seat for the grace window as usual.
  function beat() {
    for (const socket of app.wss.clients) {
      if (socket.alive === 0) {
        socket.terminate();
        continue;
      }
      socket.alive = 0;
      socket.ping();
    }
  }

  app.close = function close() {
    clearInterval(app.heartbeat);
    clearInterval(app.sweeper);
    for (const room of app.rooms) room.stop();
    app.stop();
    return new Promise((resolve) => {
      app.wss.close(() => app.httpServer.close(() => resolve(true)));
    });
  };

  return app;
}

// A count from the environment, or undefined for the default. `Number('')` is
// 0, so a variable cleared in a unit file used to mean "reopen a resumed war
// on the first sweep" instead of "the default". `warn` hears about a value
// that is set but is not a whole number.
function wholeNumberFrom(text, warn) {
  if (text === undefined || text.trim() === '') return undefined;
  const value = Number(text);
  if (Number.isInteger(value) && value >= 0) return value;
  warn(text);
  return undefined;
}

export { ABANDON_MS, MAX_ROOMS, createApp, PROTOCOL, ROOT, wholeNumberFrom };
