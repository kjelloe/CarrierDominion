// engine/game.js - the headless pump that turns a queue of commands into ticks.
//
// Queue order is authoritative and is the thing replays depend on: the queued
// client commands resolve FIFO, then (later) the AI, then exactly one
// server-owned advance_tick. Networking only ever calls enqueueCommand and
// reads snapshots; it never touches state.
//
// Written without classes so the Luau twin is a direct transcription.

import { createInitialState } from './state.js';
import { apply } from './reducer.js';
import { CMD_ADVANCE_TICK, validateCommand } from './commands.js';
import { createSnapshot } from './snapshot.js';

const DEFAULT_SNAPSHOT_CAPACITY = 30;

function createGame(seed, rules, options) {
  const opts = options === undefined ? {} : options;
  return {
    state: createInitialState(seed, rules),
    queue: [],
    nextSequence: 0,
    snapshots: [],
    commandLog: [],
    snapshotCapacity: opts.snapshotCapacity === undefined
      ? DEFAULT_SNAPSHOT_CAPACITY
      : opts.snapshotCapacity,
    recordCommands: opts.recordCommands === false ? 0 : 1,
  };
}

function enqueueCommand(game, command) {
  if (command !== undefined && command !== null && command.type === CMD_ADVANCE_TICK) {
    return { accepted: 0, reason: 'advance_tick is server-owned', sequence: -1 };
  }
  const problem = validateCommand(command);
  if (problem !== '') return { accepted: 0, reason: problem, sequence: -1 };
  const sequence = game.nextSequence;
  game.nextSequence = sequence + 1;
  game.queue.push({ sequence: sequence, command: command });
  return { accepted: 1, reason: '', sequence: sequence };
}

function recordCommand(game, command) {
  if (game.recordCommands === 0) return;
  const entry = { tick: game.state.tick };
  const keys = Object.keys(command);
  for (let i = 0; i < keys.length; i++) entry[keys[i]] = command[keys[i]];
  game.commandLog.push(entry);
}

function runCommand(game, command, events) {
  recordCommand(game, command);
  game.state = apply(game.state, command);
  for (let i = 0; i < game.state.events.length; i++) events.push(game.state.events[i]);
}

function stepGame(game) {
  // Copy and clear first so anything enqueued from a callback waits for the
  // next tick instead of sneaking into this one.
  const queued = game.queue;
  game.queue = [];
  const events = [];

  for (let i = 0; i < queued.length; i++) runCommand(game, queued[i].command, events);
  runCommand(game, { type: CMD_ADVANCE_TICK }, events);
  game.state.events = events;

  const snapshot = createSnapshot(game.state);
  game.snapshots.push(snapshot);
  while (game.snapshots.length > game.snapshotCapacity) game.snapshots.shift();
  return snapshot;
}

function latestSnapshot(game) {
  if (game.snapshots.length === 0) return -1;
  return game.snapshots[game.snapshots.length - 1];
}

export { createGame, enqueueCommand, stepGame, latestSnapshot };
