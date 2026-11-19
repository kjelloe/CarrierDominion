// server/resume_worker.js - replays a save that carries no usable state, off
// the main thread, so the port is open and /healthz says "resuming" while it
// runs (2026-11-19). The hosted war's replay took about four hours, all of it
// with the port shut and nginx answering 502. The replay itself is the same
// one `resumeGame` runs; only the thread differs.

import { parentPort, workerData } from 'node:worker_threads';

import { replayWar } from './save.js';

const problem = { reason: '' };
const state = replayWar(workerData.saved, workerData.rules, problem);
parentPort.postMessage(state === -1 ? { reason: problem.reason } : { state: state });
