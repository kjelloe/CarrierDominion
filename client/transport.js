// client/transport.js - one interface, two drivers.
//
// Everything above this file - renderer, HUD, input - is written against the
// transport interface and cannot tell solo from LAN apart:
//
//   connect(handlers)  handlers = { onWelcome, onSnapshot, onRejected, onClosed }
//   send(command)
//   setSpeed(multiplier)
//   close()
//
// The local driver runs the real engine in this tab and filters its own views
// through shared/view.js, so solo play is not a simplified mode - it is the
// same simulation with a shorter wire.

import { createGame, enqueueCommand, stepGame } from '../engine/game.js';
import { createInitialState } from '../engine/state.js';
import { apply } from '../engine/reducer.js';
import { checkAuthority } from '../engine/authority.js';
import { buildView } from '../shared/view.js';
import { isSpeed } from '../shared/speeds.js';
import { applyLobbyOptions } from '../shared/options.js';

// `resumed` is a game object replayed from a solo autosave (client/
// localsave.js), or 0 for a fresh war. The transport does not know or care
// which - it pumps whatever it is given, and a resumed war keeps its command
// log so it goes on saving itself from where it left off.
function createLocalTransport(seed, rules, team, speed, resumed) {
  const state = { game: 0, timer: 0, handlers: 0, team: team, speed: isSpeed(speed) ? speed : 1 };
  return {
    kind: 'local',
    // The war itself, for the tab's own autosave. Only the local transport
    // has one: in a LAN game the server owns the war and saves it.
    localGame() {
      return state.game;
    },
    connect(handlers) {
      state.handlers = handlers;
      state.game = resumed === undefined || resumed === 0
        ? createGame(seed, rules)
        : resumed;
      handlers.onWelcome({
        team: state.team,
        seed: seed,
        tickHz: rules.rules.tickHz,
        rulesHash: state.game.state.rulesHash,
        spectator: false,
        speed: state.speed,
        speedLocked: 0,
      });
      // Compression is delivered as more ticks per interval, not a shorter
      // interval: the browser cannot be relied on for a 3 ms timer, and the
      // ticks themselves must stay identical to a x1 run.
      state.timer = setInterval(() => {
        let snapshot = -1;
        for (let i = 0; i < state.speed; i++) snapshot = stepGame(state.game);
        if (snapshot === -1) return;
        handlers.onSnapshot({
          tick: snapshot.tick,
          stateHash: snapshot.stateHash,
          view: snapshot.views[state.team],
        });
      }, rules.rules.msPerTick);
    },
    setSpeed(multiplier) {
      if (!isSpeed(multiplier)) return;
      state.speed = multiplier;
      state.handlers.onSpeed(multiplier);
    },
    send(command) {
      // Solo play has nobody to cheat, but it runs the same authority check so
      // a bug in a command path cannot hide until the LAN game finds it.
      const problem = checkAuthority(state.game.state, state.team, command);
      if (problem !== '') {
        state.handlers.onRejected(problem);
        return;
      }
      enqueueCommand(state.game, command);
    },
    close() {
      if (state.timer !== 0) clearInterval(state.timer);
      state.timer = 0;
      if (state.handlers !== 0) state.handlers.onClosed('closed');
    },
  };
}

// The replay driver: a war IS its seed plus its command log (docs/01), so a
// save file plays back through the same reducer, tick for tick, command for
// command. Input is ignored - you are watching a war, not fighting one - and
// the clock stops at the tick the record ends. No state hash per tick: the
// hash exists to catch divergence between two machines, and a replay has one.
function createReplayTransport(save, rules, team) {
  const chosen = save.options !== 0 && save.options !== undefined
    ? applyLobbyOptions(rules, save.options)
    : rules;
  const state = {
    war: 0, cursor: 0, timer: 0, handlers: 0,
    team: team, speed: isSpeed(1) ? 1 : 1, done: false,
  };

  function stepOnce() {
    while (state.cursor < save.commandLog.length
      && save.commandLog[state.cursor].tick === state.war.tick) {
      state.war = apply(state.war, save.commandLog[state.cursor]);
      state.cursor += 1;
    }
    state.war = apply(state.war, { type: 'advance_tick' });
  }

  return {
    kind: 'replay',
    connect(handlers) {
      state.handlers = handlers;
      state.war = createInitialState(save.seed, chosen);
      handlers.onWelcome({
        team: state.team,
        seed: save.seed,
        tickHz: chosen.rules.tickHz,
        rulesHash: state.war.rulesHash,
        spectator: false,
        speed: state.speed,
        speedLocked: 0,
        replay: 1,
      });
      state.timer = setInterval(() => {
        if (state.done) return;
        for (let i = 0; i < state.speed && state.war.tick < save.tick; i++) stepOnce();
        handlers.onSnapshot({
          tick: state.war.tick,
          stateHash: '',
          view: buildView(state.war, state.team),
        });
        if (state.war.tick >= save.tick && !state.done) {
          state.done = true;
          handlers.onClosed('replay finished');
        }
      }, chosen.rules.msPerTick);
    },
    setSpeed(multiplier) {
      if (!isSpeed(multiplier) || multiplier === 0) return;
      state.speed = multiplier;
      state.handlers.onSpeed(multiplier);
    },
    send() { /* a replay takes no orders */ },
    sendMessage() { /* nor any messages */ },
    close() {
      if (state.timer !== 0) clearInterval(state.timer);
      state.timer = 0;
    },
  };
}

// Reconnect policy, mirroring multiciv's: doubling from a short base, capped,
// and only so many times before the client stops pretending.
const MAX_RETRIES = 6;
const RETRY_BASE_MS = 800;
const RETRY_CAP_MS = 8000;

function createWsTransport(url) {
  const state = { socket: 0, handlers: 0, attempts: 0, closing: false };
  const transport = {
    kind: 'ws',
    connect(handlers) {
      state.handlers = handlers;
      // The seat token, kept for this TAB only: two tabs on one machine are two
      // players, and sessionStorage is what says so. Presenting it on a
      // reconnect is what gets the same carrier back.
      let token = '';
      try {
        token = window.sessionStorage.getItem('carrier-dominion-seat') ?? '';
      } catch {
        token = '';
      }
      const socket = new WebSocket(token === '' ? url : `${url}/?token=${token}`);
      state.socket = socket;
      socket.addEventListener('open', () => { state.attempts = 0; });
      socket.addEventListener('message', (event) => {
        let message;
        try {
          message = JSON.parse(event.data);
        } catch {
          return;
        }
        if (message.type === 'welcome') {
          if (typeof message.token === 'string' && message.token !== '') {
            try {
              window.sessionStorage.setItem('carrier-dominion-seat', message.token);
            } catch {
              // A browser with storage switched off simply cannot resume, which
              // is a worse experience rather than a broken one.
            }
          }
          handlers.onWelcome(message);
        }
        else if (message.type === 'snapshot') handlers.onSnapshot(message);
        else if (message.type === 'speed') handlers.onSpeed(message.speed);
        else if (message.type === 'vote') handlers.onVote(message);
        else if (message.type === 'lobby') handlers.onLobby(message.lobby);
        else if (message.type === 'rejected') handlers.onRejected(message.reason);
      });
      // A dropped socket is retried with a backoff before it is called dead:
      // the server is holding the seat for a grace window, and most drops are a
      // sleeping laptop rather than a server that has gone away.
      socket.addEventListener('close', () => {
        if (state.closing) return;
        handlers.onClosed('disconnected');
        retry(handlers);
      });
      socket.addEventListener('error', () => handlers.onClosed('connection error'));
    },
    send(command) {
      if (state.socket === 0 || state.socket.readyState !== WebSocket.OPEN) return;
      state.socket.send(JSON.stringify({ type: 'command', command: command }));
    },
    // Lobby traffic is not a game command and must not be wrapped as one: the
    // war does not exist yet, so there is no reducer to hand it to. Sending a
    // lobby message down the command path is answered, correctly, with "the
    // war has not started" - which is exactly the bug the lobby probe found.
    sendMessage(message) {
      if (state.socket === 0 || state.socket.readyState !== WebSocket.OPEN) return;
      state.socket.send(JSON.stringify(message));
    },
    // The server decides: alone in the war it obliges, sharing it refuses
    // until the voting slice exists.
    setSpeed(multiplier) {
      if (state.socket === 0 || state.socket.readyState !== WebSocket.OPEN) return;
      state.socket.send(JSON.stringify({ type: 'set_speed', speed: multiplier }));
    },
    close() {
      state.closing = true;
      if (state.socket !== 0) state.socket.close();
      state.socket = 0;
    },
  };

  // Doubling, capped, and only so many times: a server that is really gone
  // should stop being retried rather than being retried forever.
  function retry(handlers) {
    if (state.attempts >= MAX_RETRIES) {
      handlers.onClosed('closed');
      return;
    }
    state.attempts += 1;
    const wait = Math.min(RETRY_CAP_MS, RETRY_BASE_MS * (2 ** (state.attempts - 1)));
    window.setTimeout(() => transport.connect(handlers), wait);
  }

  return transport;
}

export { createLocalTransport, createReplayTransport, createWsTransport, MAX_RETRIES, RETRY_BASE_MS, RETRY_CAP_MS };
