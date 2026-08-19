// server/index.js - process entry point. Reads the environment, starts the app.
//
//   PORT=8132   HOST=127.0.0.1   SEED=20260818
//
// Loopback by default: the deployment doctrine puts nginx in front and binds
// the game to localhost only. Set HOST=0.0.0.0 to play across the LAN.

import { createApp } from './app.js';
import { loadRules } from './rules.js';

const PORT = Number(process.env.PORT ?? 8132);
const HOST = process.env.HOST ?? '127.0.0.1';
const SEED = Number(process.env.SEED ?? 20260818);

const app = createApp({ seed: SEED, rules: loadRules() });

app.listen(PORT, HOST).then(() => {
  process.stdout.write(`Carrier Dominion on http://${HOST}:${PORT}  seed ${SEED}\n`);
  if (HOST === '127.0.0.1') {
    process.stdout.write('LAN play: restart with HOST=0.0.0.0 to accept other machines.\n');
  }
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    app.close().then(() => process.exit(0));
  });
}
