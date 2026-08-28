// test/client_smoke.mjs - the browser gate.
//
// Starts a real server on an ephemeral port, loads the real client in a real
// Chromium, and fails on ANY console error or page exception. Everything below
// this line is tested headless; this is the only check that the three.js layer,
// the importmap, the module graph, and the transports actually work in a
// browser. WSL runs it for correctness only - never quote frame rates from it.
//
//   node test/client_smoke.mjs [--headed] [--keep]
//
// Exits 0 when both transports come up clean, 1 otherwise. Skips with exit 0
// and a message when Playwright browsers are not installed, so the suite still
// runs on a machine that has not downloaded them.

import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createApp } from '../server/app.js';
import { loadRules } from '../server/rules.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const SHOTS = join(HERE, '..', 'debugging', 'shots');
const HEADED = process.argv.includes('--headed');

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  process.stdout.write('SKIP: playwright is not installed (npm install)\n');
  process.exit(0);
}

const problems = [];

function watch(page, label) {
  // The gate fails on ANY console error, which is what makes it worth having.
  // One exception, narrowly worded: headless Chromium on a box with no sound
  // card intermittently reports that the WebAudio renderer could not reach an
  // audio device. That is the machine talking, not the game - it appeared in
  // roughly one run in five on WSL and made the GATE flaky, which is worse
  // than a flaky probe because a gate you re-run is a gate you stop reading.
  //
  // Deliberately matched on the device wording rather than on "audio", so a
  // real fault in client/sound.js still fails the gate.
  const HOST_AUDIO = /AudioContext encountered an error from the audio device/i;
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    const text = message.text();
    if (HOST_AUDIO.test(text)) {
      process.stdout.write(`[${label}] ignored (no audio device on this host): ${text}\n`);
      return;
    }
    problems.push(`[${label}] console: ${text}`);
  });
  page.on('pageerror', (error) => problems.push(`[${label}] pageerror: ${error.message}`));
  page.on('requestfailed', (request) => {
    problems.push(`[${label}] request failed: ${request.url()} ${request.failure()?.errorText}`);
  });
}

async function hudValue(page, key) {
  return page.textContent(`#hud-${key}`);
}

async function waitForTicks(page, atLeast, label) {
  await page.waitForFunction(
    (minimum) => {
      const cell = document.getElementById('hud-tick');
      return cell !== null && Number(cell.textContent) >= minimum;
    },
    atLeast,
    { timeout: 20000 },
  ).catch(() => {
    problems.push(`[${label}] never reached tick ${atLeast}`);
  });
}

async function checkMode(browser, baseUrl, mode) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  watch(page, mode);
  await page.goto(`${baseUrl}/?mode=${mode}`, { waitUntil: 'load' });
  await waitForTicks(page, 40, mode);

  const tick = Number(await hudValue(page, 'tick'));
  const hash = await hudValue(page, 'hash');
  const transport = await hudValue(page, 'transport');
  const graphics = await hudValue(page, 'graphics');
  if (!(tick >= 40)) problems.push(`[${mode}] tick stalled at ${tick}`);
  if (!/^[0-9a-f]{16}$/.test(String(hash))) problems.push(`[${mode}] no state hash: ${hash}`);
  if (mode === 'lan' && !String(transport).includes('ws')) {
    problems.push(`[${mode}] wrong transport: ${transport}`);
  }

  // Drive the helm through the transport and prove the engine answered. Read
  // the VIEW rather than a HUD cell: the throttle is an instrument now, and a
  // gate that breaks when the panel is redesigned is testing the wrong thing.
  await page.keyboard.press('w');
  await page.keyboard.press('w');
  await page.waitForFunction(
    () => {
      const view = window.__lastView;
      if (view === undefined) return false;
      const own = view.carriers.find((c) => c.team === view.team && c.contact === 0);
      return own !== undefined && own.throttle >= 20;
    },
    undefined,
    { timeout: 10000 },
  ).catch(() => problems.push(`[${mode}] throttle never answered the helm`));

  // Launch a Manta and prove the whole chain answered: command out through the
  // transport, engine state changed, filtered view came back, HUD read it.
  await page.keyboard.press('1');
  await page.waitForFunction(
    () => {
      // The hangar count proves the round trip: the Manta has left the
      // hangar's books the moment the order is given, even though she is
      // still on the lift. WHAT is selected cannot be asked yet - nothing
      // is selectable until she is actually away, which is the next wait.
      const hangar = document.getElementById('hud-hangar');
      return hangar !== null && /3 Manta/.test(hangar.textContent);
    },
    undefined,
    { timeout: 10000 },
  ).catch(async () => {
    // Say WHAT it read. "never reached the HUD" with no reading is a
    // failure you cannot act on without re-running the gate by hand.
    const saw = await page.evaluate(() => ({
      hangar: document.getElementById('hud-hangar')?.textContent ?? '(no line)',
      unit: document.getElementById('hud-unit')?.textContent ?? '(no line)',
      states: (window.__lastView?.units ?? [])
        .filter((u) => u.kind === 0).map((u) => u.state).join(','),
    }));
    problems.push(`[${mode}] launching a Manta never reached the HUD`
      + ` - hangar "${saw.hangar}", unit "${saw.unit}", Manta states [${saw.states}]`);
  });

  // And WAIT for her to be away. Launching is a deck operation now (ruled
  // 2026-08-25): about a hundred ticks from the order to the ramp, so
  // pressing T on a timer used to take the controls of a Manta still on the
  // lift. The wait is generous because in SOLO the engine is driven by the
  // animation frame - five seconds at the table, and the better part of a
  // minute in a headless browser sharing a machine with the whole suite.
  await page.waitForFunction(
    () => {
      const view = window.__lastView;
      if (view === undefined) return false;
      return view.units.some((u) => u.kind === 0 && u.team === view.team && u.state === 1);
    },
    undefined,
    { timeout: 90000 },
  ).catch(() => problems.push(`[${mode}] the Manta never left the deck`));

  // NOW she can be chosen, and the HUD should say so.
  await page.waitForFunction(
    () => {
      const unit = document.getElementById('hud-unit');
      return unit !== null && /Manta|Walrus|Lighter|Lekter/.test(unit.textContent);
    },
    undefined,
    { timeout: 30000 },
  ).catch(async () => {
    const saw = await page.evaluate(
      () => document.getElementById('hud-unit')?.textContent ?? '(no line)',
    );
    problems.push(`[${mode}] nothing was selected once she was away - unit "${saw}"`);
  });

  await page.keyboard.press('t');
  await page.waitForFunction(
    () => {
      const unit = document.getElementById('hud-unit');
      return unit !== null && /PILOTED/.test(unit.textContent);
    },
    undefined,
    { timeout: 10000 },
  ).catch(() => problems.push(`[${mode}] taking the controls never took`));

  // Every panel, opened once. The gate fails on any console error, so this
  // is the cheapest possible guard against a board that throws the moment it
  // is asked to draw: client/panels/island.js used `islandName` without
  // importing it, and the island board came up titleless and choiceless for
  // anyone who clicked one of their own islands. Nothing in the gate opened
  // it, so nothing caught it. Hand back to the ship afterwards.
  await page.keyboard.press('t');
  // One key per tab, once each. Since the console became a tab strip (ruled
  // 2026-08-26, Q5b) these keys are a RADIO rather than six toggles: each one
  // shows its tab and hides the rest, so pressing a key twice closes the
  // console rather than returning it to where it was.
  for (const key of ['i', 'q', 'z', 'j', '?']) {
    await page.keyboard.press(key);
    await page.waitForTimeout(120);
  }
  await page.keyboard.press('?');
  await page.waitForTimeout(120);

  // And every PAGE of the squadron console, which is four screens behind one
  // tab: a page that throws when it draws is invisible to a gate that only
  // opens the panel. Ask for the tab rather than assuming which way the key
  // will flip it.
  const squadronShowing = () => page.evaluate(
    () => document.getElementById('squadron-panel').classList.contains('open'),
  );
  if (!await squadronShowing()) {
    await page.keyboard.press('j');
    await page.waitForTimeout(150);
  }
  if (!await squadronShowing()) {
    problems.push(`[${mode}] J did not bring up the squadron tab`);
  }
  for (const page4 of ['BOARD', 'OUTFIT', 'DECK', 'SCREEN']) {
    const tab = page.locator('#squadron-pages .sq-tab', { hasText: page4 });
    if (await tab.count() > 0) {
      await tab.first().click();
      await page.waitForTimeout(150);
    } else {
      problems.push(`[${mode}] the squadron console has no ${page4} page`);
    }
  }
  // Leave the console shut.
  if (await squadronShowing()) {
    await page.keyboard.press('j');
    await page.waitForTimeout(120);
  }
  // And the island board, which has no key: it opens by clicking an island
  // you hold, from the chart where they are all reachable.
  await page.keyboard.press('c');
  await page.waitForTimeout(300);
  const boarded = await page.evaluate(() => {
    const view = window.__lastView;
    if (view === undefined) return 'no view';
    const mine = view.islands.filter((island) => island.owner === view.team);
    if (mine.length === 0) return '';  // a from-zero opening owns nothing yet
    window.__openIsland(mine[0].id);
    return '';
  });
  if (boarded !== '') problems.push(`[${mode}] island board: ${boarded}`);
  await page.waitForTimeout(300);
  const boardTitle = await page.evaluate(
    () => document.getElementById('island-title')?.textContent ?? '',
  );
  if (boardTitle.trim() === '') {
    problems.push(`[${mode}] the island board opened without a title`);
  }

  const glLost = await page.evaluate(() => {
    const canvas = document.getElementById('view');
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
    return gl === null ? 'no context' : (gl.isContextLost() ? 'context lost' : '');
  });
  if (glLost !== '') problems.push(`[${mode}] webgl: ${glLost}`);

  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: join(SHOTS, `smoke-${mode}.png`) });
  // And the strategic pull-back, which is where island ownership is read.
  await page.keyboard.press('c');
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(SHOTS, `smoke-${mode}-strategic.png`) });
  process.stdout.write(`${mode}: tick ${tick}, hash ${hash}, ${graphics}, ${transport}\n`);
  await page.close();
}

const app = createApp({ seed: 20260818, rules: loadRules() });
const address = await app.listen(0, '127.0.0.1');
const baseUrl = `http://127.0.0.1:${address.port}`;

let browser;
try {
  browser = await chromium.launch({ headless: !HEADED });
} catch (error) {
  process.stdout.write(`SKIP: cannot launch chromium (${error.message.split('\n')[0]})\n`);
  await app.close();
  process.exit(0);
}

try {
  await checkMode(browser, baseUrl, 'solo');
  await checkMode(browser, baseUrl, 'lan');
} finally {
  await browser.close();
  await app.close();
}

if (problems.length > 0) {
  process.stderr.write(`\nclient smoke FAILED (${problems.length}):\n`);
  for (const problem of problems) process.stderr.write(`  - ${problem}\n`);
  process.exit(1);
}
process.stdout.write('client smoke OK\n');
