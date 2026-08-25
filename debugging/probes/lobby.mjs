// debugging/probes/lobby.mjs
//
// Two browsers in one war room: the host sets the war, both say ready, the host
// starts it, and both end up in the same war. Drives the real DOM, because the
// point of a lobby is that three people clicking at once still see one room.
//
//   node debugging/probes/lobby.mjs

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
  bootId: 'probe-boot',
});
const address = await app.listen(0, '127.0.0.1');
const browser = await chromium.launch();

async function seatAt(label) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('pageerror', (error) => console.log(`[${label}] PAGEERROR`, error.message));
  await page.goto(`http://127.0.0.1:${address.port}/?mode=lan`, { waitUntil: 'load' });
  await page.waitForSelector('#start-panel.open', { timeout: 20000 });
  return page;
}

const host = await seatAt('host');
const guest = await seatAt('guest');
await guest.waitForTimeout(600);

const seen = await host.evaluate(() => ({
  title: document.getElementById('start-title').textContent,
  rows: [...document.querySelectorAll('.start-row')].map((n) => n.textContent),
  clickable: document.querySelectorAll('.start-row.island-act').length,
}));
const guestView = await guest.evaluate(() => ({
  clickable: document.querySelectorAll('.start-row.island-act').length,
  note: document.getElementById('start-note').textContent,
}));

// The host changes the war; the guest must see it without touching anything.
//
// By NAME, not by position. This probe used to click "the first settable
// row" and assert the islands had changed - which was true until the war
// room gained rows above it (the start ladder went in at the top) and the
// click began cycling somebody else's option. It failed for two days
// looking exactly like a broken lobby, when the room was fine.
const islandRow = host.locator('.start-row.island-act', { hasText: 'islands' }).first();
await islandRow.click();
await guest.waitForTimeout(500);
// And read back what was chosen rather than assuming: the menu's default
// island count is a ruling that has already moved once.
const chosenIslands = Number((await islandRow.textContent()).replace(/[^0-9]/g, ''));
const guestSaw = await guest.evaluate(
  () => [...document.querySelectorAll('.start-row')].map((n) => n.textContent).join(' | '),
);

// A word between them, which is the other half of a room.
await host.fill('#lobby-say', `seed is fine, going ${chosenIslands} islands`);
await host.press('#lobby-say', 'Enter');
await guest.waitForTimeout(500);
const heard = await guest.evaluate(() => document.getElementById('lobby-log').textContent);

await host.screenshot({ path: join(SHOTS, 'lobby.png') });

// Both ready, then the host starts. The room closes and a war arrives.
await host.locator('#start-begin').first().click();
await guest.locator('#start-begin').first().click();
await host.waitForTimeout(500);
await host.locator('#start-begin').nth(1).click();

const started = await Promise.all([host, guest].map(async (page) => {
  await page.waitForFunction(
    () => Number(document.getElementById('hud-tick')?.textContent) > 5,
    undefined,
    { timeout: 20000 },
  ).catch(() => {});
  return page.evaluate(() => ({
    tick: Number(document.getElementById('hud-tick')?.textContent ?? 0),
    menuGone: !document.getElementById('start-panel').classList.contains('open'),
    islands: window.__lastView === undefined ? -1 : window.__lastView.islands.length,
    seat: document.getElementById('hud-seat')?.textContent,
    panelClass: document.getElementById('start-panel').className,
  }));
}));

console.log(`room: ${seen.title}`);
console.log(`the guest heard: ${JSON.stringify(heard)}`);
console.log(`host sees ${seen.clickable} settable rows, guest sees ${guestView.clickable}`);
const guestSawIt = new RegExp(`islands${chosenIslands}`).test(guestSaw.replace(/\s/g, ''));
console.log(`guest saw the host's change: ${guestSawIt}`);
console.log(`after start: ${JSON.stringify(started)}`);

// The host can set the war and the guest cannot - whatever the room happens
// to offer today. Pinning the exact number of rows is what went stale.
const ok = seen.clickable > 0 && guestView.clickable === 0 && guestSawIt
  && new RegExp(`${chosenIslands} islands`).test(heard)
  && started.every((s) => s.menuGone && s.tick > 5 && s.islands === chosenIslands);
if (!ok) {
  console.log('FAIL: the room did not become one war for both of them');
  process.exitCode = 1;
}

await browser.close();
await app.close();
