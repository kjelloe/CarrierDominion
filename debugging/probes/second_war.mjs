// debugging/probes/second_war.mjs
//
// One join code, one evening, two wars. The host fights a 16-island war to
// its end (the probe ends it by decree), takes BACK TO THE WAR ROOM from the
// ending screen, turns the dial to 32 islands, and sails again - same page,
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

// War one: sixteen islands.
await page.locator('.start-row.island-act').first().click();
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

// War two: thirty-two islands, same code, same page.
await page.locator('.start-row.island-act').first().click();
await page.locator('#start-begin').first().click();
await page.waitForTimeout(400);
await page.locator('#start-begin').nth(1).click();
await page.waitForFunction(
  () => Number(document.getElementById('hud-tick')?.textContent) > 5
    && (window.__lastView?.islands.length ?? 0) === 32,
  undefined,
  { timeout: 20000 },
);
const warTwo = await page.evaluate(() => ({
  islands: window.__lastView.islands.length,
  // The renderer must hold exactly the new war's islands - stale meshes from
  // war one would leave 16 cached under ids the new 32 reuse.
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

const ok = warOne === 16
  && reopened.title === firstCode && reopened.waroverGone
  && warTwo.islands === 32 && warTwo.phase === 0 && warTwo.menuGone
  && meshesSettled === 32;
if (!ok) {
  console.log('FAIL: one evening did not hold two wars cleanly');
  process.exitCode = 1;
}

await browser.close();
await app.close();
console.log('two wars on one join code, photographed');
