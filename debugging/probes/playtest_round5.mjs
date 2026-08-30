// debugging/probes/playtest_round5.mjs
//
// Playtest round five (2026-08-30), three findings from the owner:
//
//   1. Changing the look to `modern` on the menu shows the game's name TWICE.
//   2. Buttons overlap in the war - "log is under SQUADRON".
//   3. Selecting a Manta shows no PILOT (T) button.
//
// The overlap check is the point of this file. Two overlap checks already
// existed and neither could have caught it: `consoles.mjs` compares six NAMED
// elements in the top row, and `mobile.mjs` compares CONTAINERS (actions-left
// vs top-bar vs panel) on a phone viewport. Nothing compared one button
// against another, and nothing looked at a desktop window at all - so a column
// whose last buttons run off the bottom, or two chips sitting on each other,
// was invisible to the whole probe suite. The owner's own showcase screenshot
// shows it plainly.
//
//   node debugging/probes/playtest_round5.mjs

import { chromium } from 'playwright';

import { createApp } from '../../server/app.js';
import { loadRules } from '../../server/rules.js';

const app = createApp({ seed: 20260818, rules: loadRules() });
const address = await app.listen(0, '127.0.0.1');
const browser = await chromium.launch();
let failures = 0;

function check(ok, what) {
  if (ok !== true) failures += 1;
  console.log(`${ok === true ? '  ok  ' : ' FAIL '} ${what}`);
}

// Every control a player can see and click, as rectangles. Deliberately by
// ROLE and not by id: a check that names the buttons it knows about cannot
// catch the button somebody adds tomorrow.
const CONTROL_SELECTOR = [
  '#top-bar .tab', '#top-bar .chip', '#console-tabs .tab', '#camera-tabs .tab',
  '#actions-left .act', '#actions-right .act', '#weapon-group .wep',
  '#tier-chip', '#pause-button', '#help-button', '#auto-chip',
].join(', ');

async function layoutFacts(page) {
  return page.evaluate((selector) => {
    const shown = [...document.querySelectorAll(selector)].filter((node) => {
      const style = getComputedStyle(node);
      if (style.display === 'none' || style.visibility === 'hidden') return false;
      const box = node.getBoundingClientRect();
      return box.width > 0 && box.height > 0;
    });
    const label = (node) => (node.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 22)
      || node.id || node.className;
    const boxes = shown.map((node) => ({ label: label(node), box: node.getBoundingClientRect() }));

    const overlaps = [];
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const A = boxes[i].box;
        const B = boxes[j].box;
        // A shared edge is not an overlap; a real intrusion is. One pixel of
        // tolerance, because fractional layout puts neighbours at x.9997.
        const overlapX = Math.min(A.right, B.right) - Math.max(A.left, B.left);
        const overlapY = Math.min(A.bottom, B.bottom) - Math.max(A.top, B.top);
        if (overlapX > 1 && overlapY > 1) {
          overlaps.push(`"${boxes[i].label}" over "${boxes[j].label}"`
            + ` (${Math.round(overlapX)}x${Math.round(overlapY)}px)`);
        }
      }
    }
    const clipped = boxes.filter((b) => b.box.bottom > window.innerHeight + 1
      || b.box.right > window.innerWidth + 1 || b.box.top < -1 || b.box.left < -1)
      .map((b) => `"${b.label}" at ${Math.round(b.box.left)},${Math.round(b.box.top)}`
        + ` ${Math.round(b.box.width)}x${Math.round(b.box.height)}`);
    return { count: boxes.length, overlaps: overlaps, clipped: clipped };
  }, CONTROL_SELECTOR);
}

// ---- 1. the menu, with the look switched the way a player switches it -------
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('pageerror', (error) => console.log('[menu] PAGEERROR', error.message));
  await page.goto(`http://127.0.0.1:${address.port}/`, { waitUntil: 'load' });
  await page.waitForTimeout(2500);

  const titles = async () => page.evaluate(() => ({
    card: getComputedStyle(document.getElementById('title-card')).display,
    header: getComputedStyle(document.getElementById('start-title')).display,
  }));
  const before = await titles();
  check(before.card === 'block' && before.header === 'none',
    `on load the name appears once (card ${before.card}, header ${before.header})`);

  // The row is the clickable thing; the label inside it is not.
  for (let i = 0; i < 5; i++) {
    const row = page.locator('#start-inner .start-row', { hasText: /look/i }).first();
    if (/modern/i.test((await row.textContent()) ?? '')) break;
    await row.click();
    await page.waitForTimeout(1100);
  }
  await page.waitForTimeout(1200);

  const after = await titles();
  // The bug: openShowcase restarts the diorama on a style change, and
  // closeShowcase used to strip `solo-menu` - a class it does not own - so the
  // rule hiding the menu's small header (which needs showcase AND solo-menu)
  // stopped matching and the name appeared twice.
  check(after.card === 'block' && after.header === 'none',
    `after switching to modern the name still appears once (card ${after.card}, header ${after.header})`);
  await page.screenshot({ path: 'debugging/shots/pt5-menu-modern.png' });
  await page.close();
}

// ---- 2. every console, against every control, at every plausible window ----
//
// The sizes matter as much as the checks. At 1280x720 nothing was wrong; the
// bug only appears once the window is short enough that a button column wraps
// into a second column, or narrow enough that the top row wraps to two lines.
// A single-viewport probe would have called this fixed and moved on.
const SIZES = [[1920, 950], [1440, 780], [1280, 720], [1280, 600], [1100, 520], [740, 420]];
for (const [width, height] of SIZES) {
  const page = await browser.newPage({ viewport: { width: width, height: height } });
  page.on('pageerror', (error) => console.log(`[${width}x${height}] PAGEERROR`, error.message));
  await page.goto(
    `http://127.0.0.1:${address.port}/?mode=solo&style=retro&graphics=low&islands=8&teams=2&start=0`,
    { waitUntil: 'load' },
  );
  await page.waitForFunction(
    () => Number(document.getElementById('hud-tick')?.textContent) > 25,
    undefined,
    { timeout: 90000 },
  ).catch(() => {});

  const trouble = [];
  for (const key of ['i', 'j', 'q', 'z']) {
    await page.keyboard.press(key);
    await page.waitForTimeout(350);
    const hits = await page.evaluate(() => {
      // The CONSOLE is the clipping box; the panels inside it are laid out
      // taller and scrolled. Measuring a child's rect calls a perfectly good
      // scrolling panel "off the bottom" - it did, until the console's own box
      // was checked instead and found comfortably inside the window.
      const shell = document.getElementById('console');
      if (shell === null) return [];
      const A = shell.getBoundingClientRect();
      if (A.width < 4 || A.height < 4) return [];
      const found = [];
      for (const id of ['top-bar', 'tier-chip', 'actions-left', 'actions-right', 'panel']) {
        const node = document.getElementById(id);
        if (node === null) continue;
        const B = node.getBoundingClientRect();
        const x = Math.min(A.right, B.right) - Math.max(A.left, B.left);
        const y = Math.min(A.bottom, B.bottom) - Math.max(A.top, B.top);
        if (x > 1 && y > 1) found.push(`${id} ${Math.round(x)}x${Math.round(y)}`);
      }
      if (A.bottom > window.innerHeight + 1) found.push('runs off the bottom');
      const body = document.getElementById('console-body');
      if (body !== null && body.scrollHeight > body.clientHeight + 1
        && getComputedStyle(body).overflow === 'visible') {
        found.push('overflows with no way to scroll');
      }
      return found;
    });
    if (hits.length > 0) trouble.push(`[${key}] ${hits.join(', ')}`);
    await page.keyboard.press(key);
    await page.waitForTimeout(150);
  }
  check(trouble.length === 0,
    `${width}x${height}: an open console clears the bar, the chips and both columns`
    + `${trouble.length ? ` - ${trouble.join(' | ')}` : ''}`);
  if (trouble.length > 0) {
    await page.screenshot({ path: `debugging/shots/pt5-console-${width}x${height}.png` });
  }
  await page.close();
}

// ---- 3. every action stays VISIBLE, at every window ------------------------
//
// The ruling from playtest round one: every action a player can take is a
// button they can see. A column that scrolls obeys the layout and breaks the
// ruling - which is what the first attempt at fixing finding 2 did, hiding
// RECALL and FIRE at 1280x600 and PILOT itself on a small window.
for (const [width, height] of SIZES) {
  const page = await browser.newPage({ viewport: { width: width, height: height } });
  page.on('pageerror', (error) => console.log(`[${width}x${height}] PAGEERROR`, error.message));
  await page.goto(
    `http://127.0.0.1:${address.port}/?mode=solo&style=retro&graphics=low&islands=8&teams=2&start=0`,
    { waitUntil: 'load' },
  );
  await page.waitForFunction(
    () => Number(document.getElementById('hud-tick')?.textContent) > 25,
    undefined,
    { timeout: 90000 },
  ).catch(() => {});
  await page.keyboard.press('1');
  // AWAY, not a stopwatch: the deck cycle is about five seconds, and a fixed
  // wait selected nothing and read exactly like the bug being hunted.
  await page.waitForFunction(
    () => (window.__lastView?.units ?? []).some(
      (u) => u.kind === 0 && u.team === window.__lastView.team && u.state === 1,
    ),
    undefined,
    { timeout: 90000 },
  ).catch(() => {});
  await page.keyboard.press('n');
  await page.waitForTimeout(500);

  const seen = await page.evaluate(() => {
    const out = { hidden: [], pilot: 'ABSENT', total: 0 };
    for (const id of ['actions-left', 'actions-right']) {
      const col = document.getElementById(id);
      if (col === null) continue;
      const box = col.getBoundingClientRect();
      for (const act of col.querySelectorAll('.act')) {
        const r = act.getBoundingClientRect();
        out.total += 1;
        const label = (act.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 12);
        const visible = r.width > 0 && r.top >= box.top - 1 && r.bottom <= box.bottom + 1
          && r.top >= -1 && r.bottom <= window.innerHeight + 1;
        if (!visible) out.hidden.push(label);
        if (/PILOT/i.test(label)) {
          out.pilot = `${visible ? 'visible' : 'HIDDEN'} ${act.classList.contains('off') ? 'off' : 'live'}`;
        }
      }
    }
    return out;
  });
  check(seen.hidden.length === 0,
    `${width}x${height}: all ${seen.total} action buttons are visible`
    + `${seen.hidden.length ? ` - hidden: ${seen.hidden.join(', ')}` : ''}`);
  check(seen.pilot === 'visible live',
    `${width}x${height}: PILOT is visible and live with a Manta selected (${seen.pilot})`);
  await page.close();
}

// ---- the bridge at rest: no control sits on another ------------------------
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('pageerror', (error) => console.log('[war] PAGEERROR', error.message));
  await page.goto(
    `http://127.0.0.1:${address.port}/?mode=solo&style=retro&graphics=low&islands=8&teams=2&start=0`,
    { waitUntil: 'load' },
  );
  await page.waitForFunction(
    () => Number(document.getElementById('hud-tick')?.textContent) > 30,
    undefined,
    { timeout: 90000 },
  );

  const atRest = await layoutFacts(page);
  console.log(`  (${atRest.count} controls visible on the bridge)`);
  check(atRest.overlaps.length === 0,
    `nothing on the bridge sits on anything else${atRest.overlaps.length ? `: ${atRest.overlaps.join('; ')}` : ''}`);
  check(atRest.clipped.length === 0,
    `every control is inside the window${atRest.clipped.length ? `: ${atRest.clipped.join('; ')}` : ''}`);
  await page.screenshot({ path: 'debugging/shots/pt5-bridge.png' });

  const withCraft = await layoutFacts(page);
  console.log(`  (${withCraft.count} controls visible with a Manta selected)`);
  check(withCraft.overlaps.length === 0,
    `nothing overlaps with a craft selected${withCraft.overlaps.length ? `: ${withCraft.overlaps.join('; ')}` : ''}`);
  check(withCraft.clipped.length === 0,
    `nothing is clipped with a craft selected${withCraft.clipped.length ? `: ${withCraft.clipped.join('; ')}` : ''}`);
  await page.screenshot({ path: 'debugging/shots/pt5-manta-selected.png' });
  await page.close();
}

await browser.close();
await app.close();
console.log(failures === 0 ? '\nplaytest_round5: ok' : `\nplaytest_round5: ${failures} failed`);
process.exit(failures === 0 ? 0 : 1);
