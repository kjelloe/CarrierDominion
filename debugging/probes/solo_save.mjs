// debugging/probes/solo_save.mjs
//
// A solo war survives the tab (owner's ask, 2026-08-30). In solo the engine
// runs in the browser, so closing the page, reloading it, or changing the
// graphics tier used to be the end of the war. It is written to localStorage
// now - in the ordinary save format, so the hash check refuses one the rules
// have moved underneath - and offered back on the menu.
//
//   node debugging/probes/solo_save.mjs

import { chromium } from 'playwright';
import { createApp } from '../../server/app.js';
import { loadRules } from '../../server/rules.js';
const app = createApp({ seed: 20260818, rules: loadRules() });
const a = await app.listen(0, '127.0.0.1');
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1200, height: 700 } });
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
page.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLE', m.text().slice(0, 200)); });

// Sail a war, do something to it, let it autosave.
await page.goto(`http://127.0.0.1:${a.port}/?mode=solo&graphics=low`, { waitUntil: 'load' });
await page.waitForFunction(() => Number(document.getElementById('hud-tick')?.textContent) > 40);
await page.keyboard.press('w'); await page.keyboard.press('w');
await page.waitForTimeout(1200);
const before = await page.evaluate(() => ({
  tick: window.__lastView.tick,
  throttle: window.__lastView.carriers.find((c) => c.team === window.__lastView.team).throttle,
}));
// Force the save the way a tab-hide would.
await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
await page.waitForTimeout(300);
const stored = await page.evaluate(() => {
  const raw = window.localStorage.getItem('cd_solo_autosave');
  if (raw === null) return null;
  const r = JSON.parse(raw);
  return { tick: r.save.tick, log: r.save.commandLog.length, hash: r.save.stateHash.slice(0, 8) };
});
console.log('saved:', JSON.stringify(stored), '| war was at tick', before.tick, 'throttle', before.throttle);

// Come back to the bare page: the menu should offer it.
await page.goto(`http://127.0.0.1:${a.port}/`, { waitUntil: 'load' });
await page.waitForTimeout(900);
const offered = await page.evaluate(() => {
  const row = document.querySelector('.start-resume');
  return row === null ? null : row.textContent.replace(/\s+/g, ' ').trim();
});
console.log('menu offers:', JSON.stringify(offered));

// Take it.
await page.goto(`http://127.0.0.1:${a.port}/?mode=solo&graphics=low&resume=local`, { waitUntil: 'load' });
await page.waitForFunction(() => window.__lastView !== undefined, undefined, { timeout: 40000 });
await page.waitForTimeout(800);
const after = await page.evaluate(() => ({
  tick: window.__lastView.tick,
  throttle: window.__lastView.carriers.find((c) => c.team === window.__lastView.team).throttle,
  status: document.getElementById('hud-status')?.textContent ?? '',
}));
console.log('resumed at tick', after.tick, 'throttle', after.throttle);

const problems = [];
if (stored === null) {
  // Nothing was written, so every check after this one would be measuring a
  // war that does not exist. Say so plainly and stop rather than throwing a
  // TypeError three lines later, which is what the first version did.
  console.log('the war was never written down - nothing else here can be judged');
  console.log('FAIL: a solo war is not surviving the tab');
  await b.close();
  await app.close();
  process.exit(1);
}
if (stored.tick <= 0) problems.push('the save holds a war at tick 0');
if (stored.log <= 0) problems.push('the save holds no command log, which IS the save');
if (offered === null) problems.push('the menu did not offer the saved war back');
else if (!/RESUME/i.test(offered)) problems.push(`the offer reads "${offered}"`);
if (after.throttle !== before.throttle) {
  problems.push(`the helm came back at ${after.throttle}, not ${before.throttle}`);
}
if (after.tick < stored.tick) problems.push('the resumed war is older than the save');

// And changing the graphics tier must carry the war too - that is the whole
// reason this exists: the tier chip beside PAUSE reloads the page.
await page.goto(`http://127.0.0.1:${a.port}/?mode=solo&style=modern&graphics=medium`, { waitUntil: 'load' });
await page.waitForFunction(() => Number(document.getElementById('hud-tick')?.textContent) > 30);
await page.keyboard.press('w');
await page.waitForTimeout(900);
const wasThrottle = await page.evaluate(
  () => window.__lastView.carriers.find((c) => c.team === window.__lastView.team).throttle,
);
await page.click('#tier-chip');
await page.waitForTimeout(3500);
await page.waitForFunction(() => window.__lastView !== undefined, undefined, { timeout: 40000 });
await page.waitForTimeout(600);
const tiered = await page.evaluate(() => ({
  chip: document.getElementById('tier-chip').textContent,
  throttle: window.__lastView.carriers.find((c) => c.team === window.__lastView.team).throttle,
}));
console.log(`tier change: now "${tiered.chip}", helm ${tiered.throttle} (was ${wasThrottle})`);
if (tiered.throttle !== wasThrottle) {
  problems.push('changing the graphics tier threw the solo war away');
}
if (!/High/i.test(tiered.chip)) problems.push(`the tier did not change: "${tiered.chip}"`);

if (problems.length > 0) {
  for (const p of problems) console.log(p);
  console.log('FAIL: a solo war is not surviving the tab');
  process.exitCode = 1;
} else {
  console.log('a solo war saved, offered, resumed, and carried across a tier change');
}
await b.close(); await app.close();
