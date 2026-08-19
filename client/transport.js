// client/transport.js - one interface, two drivers.
//
// Everything above this file - renderer, HUD, input - is written against the
// transport interface and cannot tell solo from LAN apart:
//
//   connect(handlers)  handlers = { onWelcome, onSnapshot, onRejected, onClosed }
//   send(command)
//   close()
//
// The local driver runs the real engine in this tab and filters its own views
// through shared/view.js, so solo play is not a simplified mode - it is the
// same simulation with a shorter wire.

import { createGame, enqueueCommand, stepGame } from '../engine/game.js';
import { checkAuthority } from '../engine/authority.js';

function createLocalTransport(seed, rules, team) {
  const state = { game: 0, timer: 0, handlers: 0, team: team };
  return {
    kind: 'local',
    connect(handlers) {
      state.handlers = handlers;
      state.game = createGame(seed, rules);
      handlers.onWelcome({
        team: state.team,
        seed: seed,
        tickHz: rules.rules.tickHz,
        rulesHash: state.game.state.rulesHash,
        spectator: false,
      });
      state.timer = setInterval(() => {
        const snapshot = stepGame(state.game);
        handlers.onSnapshot({
          tick: snapshot.tick,
          stateHash: snapshot.stateHash,
          view: snapshot.views[state.team],
        });
      }, rules.rules.msPerTick);
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

function createWsTransport(url) {
  const state = { socket: 0, handlers: 0 };
  return {
    kind: 'ws',
    connect(handlers) {
      state.handlers = handlers;
      const socket = new WebSocket(url);
      state.socket = socket;
      socket.addEventListener('message', (event) => {
        let message;
        try {
          message = JSON.parse(event.data);
        } catch {
          return;
        }
        if (message.type === 'welcome') handlers.onWelcome(message);
        else if (message.type === 'snapshot') handlers.onSnapshot(message);
        else if (message.type === 'rejected') handlers.onRejected(message.reason);
      });
      socket.addEventListener('close', () => handlers.onClosed('disconnected'));
      socket.addEventListener('error', () => handlers.onClosed('connection error'));
    },
    send(command) {
      if (state.socket === 0 || state.socket.readyState !== WebSocket.OPEN) return;
      state.socket.send(JSON.stringify({ type: 'command', command: command }));
    },
    close() {
      if (state.socket !== 0) state.socket.close();
      state.socket = 0;
    },
  };
}

export { createLocalTransport, createWsTransport };
