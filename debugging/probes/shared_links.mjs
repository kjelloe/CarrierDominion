// debugging/probes/shared_links.mjs
//
// A LINK IS A WHOLE GAME (owner's ask, 2026-08-30): every row of the start
// menu is also a query parameter, so a host can send one address for the 1988
// look and another for a maxed-out modern one, and both open on exactly the
// intended war. This walks the two links the owner actually wants to send.
//
//   node debugging/probes/shared_links.mjs

import { chromium } from 'playwright';
import { createApp } from '../../server/app.js';
import { loadRules } from '../../server/rules.js';

const app = createApp({ seed: 20260818, rules: loadRules() });
const address = await app.listen(0, '127.0.0.1');
const browser = await chromium.launch();
const problems = [];

const LINKS = [
  ['the 1988 look', 'mode=solo&style=retro&graphics=high&islands=16&teams=2&start=0',
    { style: '1988', tier: 'High', islands: 16 }],
  ['maxed out modern', 'mode=solo&style=modern&graphics=high&islands=16&teams=2&start=0',
    { style: 'Modern', tier: 'High', islands: 16 }],
  ['a link with a typo in it', 'mode=solo&style=modern&graphics=high&islands=999',
    { style: 'Modern', tier: 'High', islands: 8 }],
];

for (const [name, query, want] of LINKS) {
  const page = await browser.newPage({ viewport: { width: 1200, height: 700 } });
  page.on('pageerror', (error) => problems.push(`[${name}] PAGEERROR ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') problems.push(`[${name}] CONSOLE ${message.text()}`);
  });
  await page.goto(`http://127.0.0.1:${address.port}/?${query}`, { waitUntil: 'load' });
  await page.waitForFunction(
    () => Number(document.getElementById('hud-tick')?.textContent) > 3,
    undefined,
    { timeout: 90000 },
  );
  await page.waitForTimeout(1900);
  const got = await page.evaluate(() => ({
    chip: document.getElementById('tier-chip').textContent,
    islands: window.__lastView.islands.length,
    status: document.getElementById('hud-status')?.textContent ?? '',
  }));
  console.log(`${name.padEnd(24)} ${got.chip.padEnd(18)} ${got.islands} islands`);
  if (!got.chip.includes(want.style)) {
    problems.push(`${name}: the look is "${got.chip}", not ${want.style}`);
  }
  if (!got.chip.includes(want.tier)) {
    problems.push(`${name}: the tier is "${got.chip}", not ${want.tier}`);
  }
  if (got.islands !== want.islands) {
    problems.push(`${name}: ${got.islands} islands, not ${want.islands}`);
  }
  // A refused value must SAY so. Two friends opening one link must get one
  // war, and a typo that silently changes the game is the worst outcome here.
  if (want.islands === 8 && !/does not offer|finnes ikke/i.test(got.status)) {
    problems.push(`${name}: an impossible setting was dropped in silence ("${got.status}")`);
  }
  await page.close();
}

await browser.close();
await app.close();

if (problems.length > 0) {
  for (const problem of problems) console.log(problem);
  console.log('FAIL: a shared link does not open the war it names');
  process.exitCode = 1;
} else {
  console.log('both links open exactly the war they name, and a bad one says so');
}
