// debugging/probes/second_war.mjs
//
// One join code, one evening, two wars. The host fights a 16-island war to
// its end (the probe ends it by decree), takes BACK TO THE WAR ROOM from the
// ending screen, turns the island dial up again, and sails again - same page,
// same code, and the world on screen must be the SECOND war's archipelago,
// not the first's meshes wearing new ids.
//
//   node debugging/probes/second_war.mjs

import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

import { createApp } from '../../server/app.js';
import { loadRules } from '../../server/rules.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const SHOTS = join(HERE, '..', 'shots');
mkdirSync(SHOTS, { recursive: true });

const app = createApp({
  seed: 20260818,
  rules: loadRules(),
  lobby: true,
  bootId: 'probe-evening',
});
const address = await app.listen(0, '127.0.0.1');
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (error) => console.log('PAGEERROR', error.message));

await page.goto(`http://127.0.0.1:${address.port}/?mode=lan&graphics=medium`, {
  waitUntil: 'load',
});
await page.waitForSelector('#start-panel.open', { timeout: 20000 });
const firstCode = await page.evaluate(() => document.getElementById('start-title').textContent);

// War one: one click up the islands ladder.
//
// BY NAME. Clicking "the first settable row" was islands until the war room
// gained rows above it, after which this probe dialled somebody else's
// option and timed out waiting for an island count that was never coming.
const islandRow = page.locator('.start-row.island-act', { hasText: 'islands' }).first();
await islandRow.click();
await page.locator('#start-begin').first().click();
await page.waitForTimeout(400);
await page.locator('#start-begin').nth(1).click();
await page.waitForFunction(
  () => Number(document.getElementById('hud-tick')?.textContent) > 5,
  undefined,
  { timeout: 20000 },
);
const warOne = await page.evaluate(() => window.__lastView.islands.length);

// The war ends by decree, and the ending screen offers the room back.
app.game.state.phase = 1;
app.game.state.winner = 0;
app.game.state.winReason = 2;
await page.waitForSelector('#warover-panel.open', { timeout: 20000 });
const roomButton = await page.evaluate(
  () => document.getElementById('warover-room').textContent,
);
await page.screenshot({ path: join(SHOTS, 'war-over-lan.png') });

await page.click('#warover-room');
await page.waitForSelector('#start-panel.open', { timeout: 20000 });
const reopened = await page.evaluate(() => ({
  title: document.getElementById('start-title').textContent,
  waroverGone: !document.getElementById('warover-panel').classList.contains('open'),
}));

// War two: one more click up the ladder, same code, same page. Read the
// count back rather than naming it - the room's default has moved before.
await page.locator('.start-row.island-act', { hasText: 'islands' }).first().click();
const wantedTwo = Number((await page.locator('.start-row.island-act', { hasText: 'islands' })
  .first().textContent()).replace(/[^0-9]/g, ''));
await page.locator('#start-begin').first().click();
await page.waitForTimeout(400);
await page.locator('#start-begin').nth(1).click();
await page.waitForFunction(
  (want) => Number(document.getElementById('hud-tick')?.textContent) > 5
    && (window.__lastView?.islands.length ?? 0) === want,
  wantedTwo,
  { timeout: 20000 },
);
const warTwo = await page.evaluate(() => ({
  islands: window.__lastView.islands.length,
  // The renderer must hold exactly the new war's islands - stale meshes from
  // war one would leave the old count cached under ids the new one reuses.
  meshes: Object.keys(window.__scene3d.islands).length,
  phase: window.__lastView.phase,
  menuGone: !document.getElementById('start-panel').classList.contains('open'),
}));
await page.waitForTimeout(1000);
const meshesSettled = await page.evaluate(() => Object.keys(window.__scene3d.islands).length);
await page.screenshot({ path: join(SHOTS, 'second-war.png') });

console.log(`room "${firstCode}", war one ${warOne} islands`);
console.log(`ending offered "${roomButton}"; reopened as "${reopened.title}"`);
console.log(`war two: ${JSON.stringify(warTwo)}, meshes settled at ${meshesSettled}`);

// The point is that ONE evening holds TWO wars: a second, differently
// sized archipelago on the same page and the same join code, with no mesh
// left over from the first. The sizes themselves are whatever the ladder
// offers, which is why they are read back rather than named.
const ok = warOne > 0 && warTwo.islands === wantedTwo && warTwo.islands !== warOne
  && reopened.title === firstCode && reopened.waroverGone
  && warTwo.phase === 0 && warTwo.menuGone
  && meshesSettled === wantedTwo;
if (!ok) {
  console.log('FAIL: one evening did not hold two wars cleanly');
  process.exitCode = 1;
}

await browser.close();
await app.close();
console.log('two wars on one join code, photographed');
