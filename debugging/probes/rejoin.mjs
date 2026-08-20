// debugging/probes/rejoin.mjs
//
// A player drops out of a war in progress and comes back to their own carrier.
// Driven through the real client, because the token lives in sessionStorage and
// the reconnect lives in the transport - neither of which a socket test sees.
//
//   node debugging/probes/rejoin.mjs

import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

import { createApp } from '../../server/app.js';
import { loadRules } from '../../server/rules.js';

const HERE = dirname(fileURLToPath(import.meta.url));

const app = createApp({ seed: 20260818, rules: loadRules() });
const address = await app.listen(0, '127.0.0.1');
const url = `http://127.0.0.1:${address.port}/?mode=lan`;
const browser = await chromium.launch();
// One context, so the two visits share a tab's session storage the way a
// reload does - which is exactly the case being tested.
const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
const page = await context.newPage();
page.on('pageerror', (error) => console.log('PAGEERROR', error.message));

await page.goto(url, { waitUntil: 'load' });
await page.waitForFunction(() => Number(document.getElementById('hud-tick')?.textContent) > 20);

// Take the helm, so there is something recognisably THIS player's to come back
// to rather than a fresh ship.
for (let i = 0; i < 6; i += 1) await page.keyboard.press('w');
await page.waitForTimeout(1500);

const before = await page.evaluate(() => {
  const view = window.__lastView;
  const own = view.carriers.find((c) => c.team === view.team && c.contact === 0);
  return {
    team: view.team,
    throttle: own.throttle,
    token: window.sessionStorage.getItem('carrier-dominion-seat'),
    seats: 1,
  };
});

// Somebody else takes a seat while the first player is away, and must not be
// given the one being held.
const stranger = await context.newPage();
await stranger.goto(`${url}&team=1`, { waitUntil: 'load' });

// The drop: reload the tab, which is what a refresh, a sleep or a flaky wifi
// looks like from the server's side.
await page.reload({ waitUntil: 'load' });
await page.waitForFunction(() => Number(document.getElementById('hud-tick')?.textContent) > 20);
await page.waitForTimeout(800);

const after = await page.evaluate(() => {
  const view = window.__lastView;
  const own = view.carriers.find((c) => c.team === view.team && c.contact === 0);
  return {
    team: view.team,
    throttle: own.throttle,
    token: window.sessionStorage.getItem('carrier-dominion-seat'),
  };
});

const aiSeats = app.game.state.ai.map((b) => b.team);
console.log(`before: team ${before.team}, throttle ${before.throttle}%`);
console.log(`after : team ${after.team}, throttle ${after.throttle}%`);
console.log(`token kept: ${before.token === after.token}, AI seats now ${JSON.stringify(aiSeats)}`);

if (before.team !== after.team || after.throttle !== before.throttle || aiSeats.includes(before.team)) {
  console.log('FAIL: the player did not come back to their own war');
  process.exitCode = 1;
}

await browser.close();
await app.close();
