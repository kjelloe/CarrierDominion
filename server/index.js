// server/index.js - process entry point. Reads the environment, starts the app.
//
//   PORT=8135   HOST=127.0.0.1   SEED=20260818   SPEED=1   LOBBY=1   WATCH=1
//
// Loopback by default: the deployment doctrine puts nginx in front and binds
// the game to localhost only. Set HOST=0.0.0.0 to play across the LAN.
//
// LOBBY=1 (the default here) holds the war in a room until the host starts it.
// LOBBY=0 sails immediately with whatever data/rules.json says, which is what
// every test and probe wants and what a headless sim host would run.
//
// WATCH=1 (also the default) runs the playtest watchdog: it reads the state
// every tick looking for values that should be impossible, and serves what it
// found at /watch. It never writes state, so it cannot change the war.

import { createApp } from './app.js';
import { loadRules } from './rules.js';

const PORT = Number(process.env.PORT ?? 8135);
const HOST = process.env.HOST ?? '127.0.0.1';
const SEED = Number(process.env.SEED ?? 20260818);
const SPEED = Number(process.env.SPEED ?? 1);
const LOBBY = (process.env.LOBBY ?? '1') !== '0';
const WATCH = (process.env.WATCH ?? '1') !== '0';

const app = createApp({
  seed: SEED,
  rules: loadRules(),
  speed: SPEED,
  lobby: LOBBY,
  watch: WATCH,
  bootId: `${SEED}-${PORT}-${Date.now()}`,
});

app.listen(PORT, HOST).then(() => {
  process.stdout.write(`Carrier Dominion on http://${HOST}:${PORT}  seed ${SEED}  speed x${SPEED}\n`);
  if (LOBBY) {
    process.stdout.write(`War room open - join code ${app.lobby.code}\n`);
  }
  if (WATCH) {
    process.stdout.write(`Watchdog on - findings at http://${HOST}:${PORT}/watch\n`);
  }
  if (HOST === '127.0.0.1') {
    process.stdout.write('LAN play: restart with HOST=0.0.0.0 to accept other machines.\n');
  }
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    app.close().then(() => process.exit(0));
  });
}
