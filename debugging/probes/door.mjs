// debugging/probes/door.mjs
//
// The door, in a real browser (owner rulings 2026-08-31, docs/06 "The door").
//
// The server side is covered by server_doorman.test.js and server_ws.test.js.
// This is the half those cannot reach: **is the kick a button a host can
// actually find and press?** It was built onto the roster row and never opened
// in a browser - which is this repo's own recorded failure class, "the thing no
// gate opens is the thing that breaks", and the same shape as the PILOT button
// the owner reported missing in playtest round five.
//
//   node debugging/probes/door.mjs

import { chromium } from 'playwright';

import { createApp } from '../../server/app.js';
import { loadRules } from '../../server/rules.js';

const app = createApp({ seed: 20260818, rules: loadRules(), lobby: true, bootId: 'door-probe' });
const address = await app.listen(0, '127.0.0.1');
const browser = await chromium.launch();
let failures = 0;

function check(ok, what) {
  if (ok !== true) failures += 1;
  console.log(`${ok === true ? '  ok  ' : ' FAIL '} ${what}`);
}

async function seatAt(label, query) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('pageerror', (error) => console.log(`[${label}] PAGEERROR`, error.message));
  await page.goto(`http://127.0.0.1:${address.port}/?mode=lan${query ?? ''}`, { waitUntil: 'load' });
  await page.waitForSelector('#start-panel.open', { timeout: 20000 });
  return page;
}

const host = await seatAt('host');
const guest = await seatAt('guest');
await guest.waitForTimeout(800);

// --- the control exists, and only for the host ------------------------------
const rowText = async (page) => page.evaluate(
  () => [...document.querySelectorAll('#start-body .start-row')].map(
    (n) => n.textContent.replace(/\s+/g, ' ').trim(),
  ),
);

const hostRows = await rowText(host);
const guestRows = await rowText(guest);
const removable = hostRows.filter((t) => /REMOVE/i.test(t));
check(removable.length === 1,
  `the host sees exactly one REMOVE (saw ${removable.length}: ${removable.join(' | ') || 'none'})`);
check(hostRows.filter((t) => /HOST/i.test(t) && /REMOVE/i.test(t)).length === 0,
  'the host cannot remove themselves');
check(guestRows.every((t) => !/REMOVE/i.test(t)),
  'a guest is not offered REMOVE at all');

// --- pressing it actually removes them --------------------------------------
const seatsBefore = app.seats.length;
await host.locator('#start-body .start-row', { hasText: /REMOVE/i }).first().click();
await host.waitForTimeout(900);

check(app.seats.length === seatsBefore - 1,
  `the seat was given up (${seatsBefore} -> ${app.seats.length})`);
check(app.doorman.bans.length === 1,
  `the address was shut out (${app.doorman.bans.length} ban(s) recorded)`);

// The kicked page must SAY so rather than sitting on a dead socket retrying.
// VISIBLE, not merely present. The HUD is hidden behind the war room
// (`body.menu #hud { display: none }`), so reading its textContent proves the
// string exists and nothing about whether a human can see it - the same
// vacuous assertion `offsetParent` produced in the mobile pass.
const guestSaid = await guest.evaluate(() => {
  const shown = (node) => {
    for (let n = node; n !== null && n !== document.body; n = n.parentElement) {
      const style = getComputedStyle(n);
      if (style.display === 'none' || style.visibility === 'hidden') return false;
    }
    return true;
  };
  let text = '';
  for (const node of document.querySelectorAll('#hud-status, #start-note, #start-title, #start-body')) {
    if (shown(node)) text += ' ' + (node.textContent ?? '');
  }
  return text.replace(/\s+/g, ' ').trim();
});
check(/remov/i.test(guestSaid),
  `the kicked player can SEE they were removed (visible text: "${guestSaid.slice(0, 90)}")`);

// --- and cannot walk straight back in ---------------------------------------
const back = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const seen = [];
back.on('console', (m) => seen.push(m.text()));
await back.goto(`http://127.0.0.1:${address.port}/?mode=lan`, { waitUntil: 'load' });
await back.waitForTimeout(1200);
check(app.seats.length === seatsBefore - 1,
  `a kicked address is refused a new seat (${app.seats.length} seated)`);

await browser.close();
await app.close();
console.log(failures === 0 ? '\ndoor: ok' : `\ndoor: ${failures} failed`);
process.exit(failures === 0 ? 0 : 1);
