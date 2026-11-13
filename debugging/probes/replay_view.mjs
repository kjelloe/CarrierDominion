// debugging/probes/replay_view.mjs
//
// The replay viewer: a short war is autosaved, then watched back through the
// same reducer in a browser tab - input ignored, clock stopping at the end of
// the record.
//
//   node debugging/probes/replay_view.mjs

import { chromium } from 'playwright';

import { createApp } from '../../server/app.js';
import { loadRules } from '../../server/rules.js';
import { enqueueCommand } from '../../engine/game.js';
import { readSave } from '../../server/save.js';

const app = createApp({ seed: 20260818, rules: loadRules(), savePath: 'data/autosave.json' });
const address = await app.listen(0, '127.0.0.1');

// A little war with a visible order in it, saved.
await new Promise((resolve) => setTimeout(resolve, 1200));
enqueueCommand(app.game, { type: 'set_throttle', carrierId: 0, throttle: 70 });
await new Promise((resolve) => setTimeout(resolve, 1200));
app.saveNow();

const browser = await chromium.launch();
let failed = false;

// While the war is being fought its record would show it through the fog,
// so the server refuses it and the viewer says why.
const early = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await early.goto(`http://127.0.0.1:${address.port}/?mode=replay&graphics=low`, { waitUntil: 'load' });
try {
  await early.waitForFunction(
    () => (document.getElementById('hud-status')?.textContent ?? '').includes('still being fought'),
    undefined,
    { timeout: 15000 },
  );
} catch {
  console.log('FAIL: a war in progress was offered for replay');
  failed = true;
}
await early.close();

// The war ends with the process; a room reopened on the same save serves it.
await app.close();
const savedTick = readSave('data/autosave.json').tick;
const room = createApp({
  seed: 20260818, rules: loadRules(), lobby: true, bootId: 'replay-view', savePath: 'data/autosave.json',
});
const roomAddress = await room.listen(0, '127.0.0.1');

const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (error) => console.log('PAGEERROR', error.message));
await page.goto(`http://127.0.0.1:${roomAddress.port}/?mode=replay&graphics=low`, {
  waitUntil: 'load',
});

// The record plays to its end and says so; the replayed helm order shows.
await page.waitForFunction(
  () => (document.getElementById('hud-status')?.textContent ?? '').includes('end of record'),
  undefined,
  { timeout: 30000 },
);
const facts = await page.evaluate(() => ({
  seat: document.getElementById('hud-seat')?.textContent,
  tick: Number(document.getElementById('hud-tick')?.textContent),
  throttle: window.__lastView.carriers.find((c) => c.contact === 0).throttle,
}));
console.log(JSON.stringify(facts));
if (!/REPLAY/.test(String(facts.seat))) { console.log('FAIL: no replay banner'); failed = true; }
if (facts.tick !== savedTick) {
  console.log(`FAIL: record ends at ${savedTick}, viewer stopped at ${facts.tick}`);
  failed = true;
}
if (facts.throttle !== 70) {
  console.log(`FAIL: the replayed helm order read ${facts.throttle}, not 70`);
  failed = true;
}

await browser.close();
await room.close();
if (failed) process.exitCode = 1;
else console.log('the saved war played back, order for order, to its final tick');
