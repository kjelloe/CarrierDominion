// client/panels/squadron.js - the Manta and Walrus consoles.
//
// The 1988 original gave each craft type a console of its own (docs/10):
// a numbered selector for the four hulls, a status board, a fitting screen
// and a deck. We have had the mechanics for months and none of the console -
// a Manta could be launched, flown, armed and lost, but the player never saw
// a hangar and never chose what hung under a wing.
//
// Three pages, because the original's right-hand column had three:
//
//   BOARD   what every hull is doing, with the deck cycle's progress
//   OUTFIT  the fitting screen: hardpoints, stores, and a weight budget
//   DECK    launch, abort, recall - the operations, with their clocks
//
// Rows are built once per shape of the thing and updated in place. The
// rebuilt-under-the-pointer bug is in the dev-log twice.

import { islandName } from '../../shared/names.js';

const KIND_MANTA = 0;
const KIND_WALRUS = 1;

// Unit states, from engine/units.js. The console reads them; it never sets
// them - every change goes out as a command and comes back in a view.
const ST_STOWED = 0;
const ST_ACTIVE = 1;
const ST_RETURNING = 2;
const ST_LOST = 3;
const ST_LANDED = 4;
const ST_ON_DECK = 5;
const ST_LAUNCHING = 6;
const ST_DOCKING = 7;

const STATE_KEYS = [
  'sq.stowed', 'sq.active', 'sq.returning', 'sq.lost', 'sq.landed',
  'sq.onDeck', 'sq.launching', 'sq.docking',
];

const KINDS = [
  { kind: KIND_MANTA, label: 'sq.mantas' },
  { kind: KIND_WALRUS, label: 'sq.walruses' },
];
const PAGES = [
  { name: 'board', label: 'sq.board' },
  { name: 'outfit', label: 'sq.outfit' },
  { name: 'deck', label: 'sq.deck' },
  // The defence drones (docs/10 gap 5): the original gave them a screen of
  // their own on this same column, because WHERE the bait sits decides what
  // it baits.
  { name: 'screen', label: 'sq.screen' },
];

// Decoy patterns, matching engine/fleet.js.
const PATTERNS = ['sq.ring', 'sq.ahead', 'sq.astern', 'sq.flanks'];
const PATTERN_DEGREES = [
  [0, 90, 180, 270],
  [-30, -10, 10, 30],
  [150, 170, 190, 210],
  [75, 105, 255, 285],
];
const SPREAD_TIGHT = 600;
const SPREAD_NORMAL = 1000;
const SPREAD_WIDE = 1400;

// The island roles a pod can be typed for (ruled 2026-08-25).
const POD_ROLES = ['sq.podResource', 'sq.podFactory', 'sq.podDefence'];

function createSquadronPanel(context) {
  const panel = {
    context: context,
    root: document.getElementById('squadron-panel'),
    body: document.getElementById('squadron-body'),
    open: false,
    kind: KIND_MANTA,
    page: 'board',
    unitId: -1,
    signature: '',
  };
  document.getElementById('squadron-title').textContent = context.t('sq.title');
  document.getElementById('squadron-note').textContent = context.t('sq.note');

  buildTabs(panel, 'squadron-kinds', KINDS, (entry) => {
    panel.kind = entry.kind;
    panel.unitId = -1;
    panel.signature = '';
  }, (entry) => entry.kind === panel.kind);

  buildTabs(panel, 'squadron-pages', PAGES, (entry) => {
    panel.page = entry.name;
    panel.signature = '';
  }, (entry) => entry.name === panel.page);

  return panel;
}

function buildTabs(panel, rootId, entries, onPick, isOn) {
  const root = document.getElementById(rootId);
  root.textContent = '';
  panel[rootId] = [];
  for (const entry of entries) {
    const tab = document.createElement('div');
    tab.className = 'sq-tab';
    tab.textContent = panel.context.t(entry.label);
    tab.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      onPick(entry);
      renderSquadronPanel(panel);
    });
    root.append(tab);
    panel[rootId].push({ tab: tab, entry: entry, isOn: isOn });
  }
}

function toggleSquadronPanel(panel) {
  panel.open = !panel.open;
  panel.root.classList.toggle('open', panel.open);
  panel.signature = '';
  if (panel.open) renderSquadronPanel(panel);
  return panel.open;
}

// Every hull of the chosen kind that belongs to this seat, in id order, so
// the numbered selector means the same thing from one glance to the next.
function complement(panel) {
  const view = panel.context.view();
  if (view === undefined) return [];
  const out = [];
  for (const unit of view.units) {
    if (unit.team !== view.team || unit.kind !== panel.kind) continue;
    out.push(unit);
  }
  out.sort((a, b) => a.id - b.id);
  return out;
}

// The decoys' states, for the redraw signature: the plan has to notice one
// of them being shot away.
function decoyShape(panel) {
  const view = panel.context.view();
  if (view === undefined) return '';
  let shape = '';
  for (const unit of view.units) {
    if (unit.team !== view.team || unit.kind !== 4) continue;
    shape = `${shape}${unit.id}.${unit.state};`;
  }
  return shape;
}

function chosen(panel, hulls) {
  for (const unit of hulls) if (unit.id === panel.unitId) return unit;
  // Nothing chosen, or the choice is gone: take the first that is not.
  for (const unit of hulls) if (unit.state !== ST_LOST) return unit;
  return hulls.length > 0 ? hulls[0] : undefined;
}

function kg(grams) {
  return Math.round(grams / 1000);
}

function renderSquadronPanel(panel) {
  if (!panel.open) return;
  const t = panel.context.t;
  const hulls = complement(panel);
  const pick = chosen(panel, hulls);
  if (pick !== undefined) panel.unitId = pick.id;

  for (const group of ['squadron-kinds', 'squadron-pages']) {
    for (const row of panel[group]) {
      row.tab.classList.toggle('on', row.isOn(row.entry));
    }
  }
  // The screen is the SHIP's, not a craft's: its page hides the craft rows
  // rather than implying there is a Manta 3 screen.
  const shipPage = panel.page === 'screen';
  document.getElementById('squadron-kinds').style.display = shipPage ? 'none' : 'flex';
  document.getElementById('squadron-craft').style.display = shipPage ? 'none' : 'flex';
  renderCraftRow(panel, hulls, pick);

  const own = panel.context.ownCarrier();
  const screenShape = own === undefined
    ? ''
    : `${own.decoyPattern},${own.decoySpread},` + decoyShape(panel);
  const signature = `${panel.page}:${panel.kind}:${panel.unitId}:${screenShape}:`
    + hulls.map((u) => `${u.id},${u.state},${u.deckTicks},${u.pod},${u.virus},`
      + `${u.podRole},${u.payloadGrams},${u.arms.map((a) => a.n).join('.')}`).join('|');
  if (signature === panel.signature) return;
  panel.signature = signature;

  panel.body.textContent = '';
  document.getElementById('squadron-note').textContent = t(shipPage ? 'sq.screenNote' : 'sq.note');
  if (pick === undefined && !shipPage) {
    panel.body.append(line(t('sq.none')));
    return;
  }
  if (panel.page === 'screen') renderScreen(panel);
  else if (panel.page === 'board') renderBoard(panel, hulls);
  else if (panel.page === 'outfit') renderOutfit(panel, pick);
  else renderDeck(panel, pick);
}

// The numbered selector: 1 2 3 4, exactly the original's, with the state
// showing in the border - solid aboard, dashed away, faded destroyed.
function renderCraftRow(panel, hulls, pick) {
  const root = document.getElementById('squadron-craft');
  const want = hulls.map((u) => `${u.id}:${u.state}`).join('|')
    + (pick === undefined ? '' : `#${pick.id}`);
  if (root.dataset.shape === want) return;
  root.dataset.shape = want;
  root.textContent = '';
  let n = 0;
  for (const unit of hulls) {
    n = n + 1;
    const chip = document.createElement('div');
    chip.className = 'sq-craft';
    chip.textContent = String(n);
    if (pick !== undefined && unit.id === pick.id) chip.classList.add('on');
    if (unit.state === ST_LOST) chip.classList.add('gone');
    else if (unit.state !== ST_STOWED) chip.classList.add('away');
    chip.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      panel.unitId = unit.id;
      panel.signature = '';
      renderSquadronPanel(panel);
    });
    root.append(chip);
  }
}

function line(text, cls) {
  const div = document.createElement('div');
  if (cls !== undefined) div.className = cls;
  div.textContent = text;
  return div;
}

function row(left, right) {
  const div = document.createElement('div');
  div.className = 'sq-row';
  const a = document.createElement('span');
  a.textContent = left;
  const b = document.createElement('span');
  b.className = 'n';
  b.textContent = right;
  div.append(a, b);
  return div;
}

function bar(permil) {
  const outer = document.createElement('div');
  outer.className = 'sq-bar';
  const inner = document.createElement('i');
  inner.style.width = `${Math.max(0, Math.min(100, Math.round(permil / 10)))}%`;
  outer.append(inner);
  return outer;
}

// --- BOARD: what every hull is doing ---------------------------------------

function renderBoard(panel, hulls) {
  const t = panel.context.t;
  const view = panel.context.view();
  let n = 0;
  for (const unit of hulls) {
    n = n + 1;
    const where = unit.state === ST_LANDED && view !== undefined
      ? islandNamed(view, unit.landedIsland)
      : t(STATE_KEYS[unit.state] ?? 'sq.unknown');
    panel.body.append(row(`${n}`, where));
    // The deck cycle's clock, when one is running; otherwise fuel, which is
    // the number that decides whether a hull is any use.
    if (unit.deckPermil > 0) {
      panel.body.append(bar(unit.deckPermil));
    } else {
      panel.body.append(bar(fuelPermilOf(unit)));
    }
  }
}

function islandNamed(view, id) {
  for (const island of view.islands) if (island.id === id) return islandName(island);
  return '?';
}

function fuelPermilOf(unit) {
  if (unit.fuelCapacity <= 0) return 0;
  return Math.floor((unit.fuel * 1000) / unit.fuelCapacity);
}

// --- SCREEN: the defence drones and where they ride -------------------------

function renderScreen(panel) {
  const t = panel.context.t;
  const view = panel.context.view();
  const own = panel.context.ownCarrier();
  if (view === undefined || own === undefined) {
    panel.body.append(line(t('sq.none')));
    return;
  }
  const decoys = view.units.filter((u) => u.team === view.team && u.kind === 4
    && u.carrierId === own.id);
  const out = decoys.filter((u) => u.state === ST_ACTIVE).length;
  const stowed = decoys.filter((u) => u.state === ST_STOWED).length;
  const lost = decoys.filter((u) => u.state === ST_LOST).length;

  const wrap = document.createElement('div');
  wrap.className = 'sq-fit';

  const left = document.createElement('div');
  left.append(row(t('sq.dronesActive'), String(out)));
  left.append(row(t('sq.dronesStowed'), String(stowed)));
  left.append(row(t('sq.dronesLost'), String(lost)));
  left.append(line(''));
  left.append(action(panel, out > 0 ? t('sq.dockScreen') : t('sq.deployScreen'), stowed + out > 0,
    () => {
      panel.context.send({
        type: out > 0 ? 'dock_decoys' : 'deploy_decoys', carrierId: panel.context.carrierId(),
      });
    }));
  left.append(line(t(out > 0 ? 'sq.screenPrice' : 'sq.screenFree')));

  left.append(line(''));
  left.append(line(t('sq.pattern')));
  const patterns = document.createElement('div');
  for (let i = 0; i < PATTERNS.length; i++) {
    const index = i;
    const chip = action(panel, t(PATTERNS[i]), true, () => {
      panel.context.send({
        type: 'set_decoy_pattern',
        carrierId: panel.context.carrierId(),
        pattern: index,
        spread: own.decoySpread,
      });
    });
    if (own.decoyPattern === i) chip.classList.add('on');
    patterns.append(chip);
  }
  left.append(patterns);

  const spreads = document.createElement('div');
  for (const [label, value] of [['sq.tight', SPREAD_TIGHT],
    ['sq.normal', SPREAD_NORMAL], ['sq.wide', SPREAD_WIDE]]) {
    const chip = action(panel, t(label), true, () => {
      panel.context.send({
        type: 'set_decoy_pattern',
        carrierId: panel.context.carrierId(),
        pattern: own.decoyPattern,
        spread: value,
      });
    });
    if (own.decoySpread === value) chip.classList.add('on');
    spreads.append(chip);
  }
  left.append(spreads);

  // The plan, as the original drew it: the ship in the middle, the drones
  // where they will actually be.
  const plan = document.createElement('div');
  plan.className = 'sq-plan';
  plan.append(line(t('sq.screenPlan')));
  plan.append(planCanvas(own, decoys));
  wrap.append(left, plan);
  panel.body.append(wrap);
}

function planCanvas(own, decoys) {
  const size = 150;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const draw = canvas.getContext('2d');
  const ink = getComputedStyle(document.body).getPropertyValue('--hud-ink').trim() || '#e8b84b';
  const dim = getComputedStyle(document.body).getPropertyValue('--hud-dim').trim() || '#7a6636';
  const cx = size / 2;
  const cy = size / 2;
  // The ring is drawn to scale with the chosen spread, so the picture is the
  // setting rather than an illustration of it.
  const ring = (size / 2 - 12) * (own.decoySpread / SPREAD_WIDE);

  draw.strokeStyle = dim;
  draw.lineWidth = 1;
  draw.beginPath();
  draw.arc(cx, cy, size / 2 - 12, 0, Math.PI * 2);
  draw.stroke();

  // The hull, bow up.
  draw.fillStyle = dim;
  draw.beginPath();
  draw.moveTo(cx, cy - 22);
  draw.lineTo(cx + 8, cy - 6);
  draw.lineTo(cx + 8, cy + 20);
  draw.lineTo(cx - 8, cy + 20);
  draw.lineTo(cx - 8, cy - 6);
  draw.closePath();
  draw.fill();

  const degrees = PATTERN_DEGREES[own.decoyPattern] ?? PATTERN_DEGREES[0];
  draw.font = '10px ui-monospace, monospace';
  for (let i = 0; i < degrees.length; i++) {
    // Screen angles run clockwise from up; the pattern table is in the same
    // ship-relative degrees the engine uses.
    const angle = (degrees[i] * Math.PI) / 180 - Math.PI / 2;
    const x = cx + Math.cos(angle) * ring;
    const y = cy + Math.sin(angle) * ring;
    const afloat = decoys[i] !== undefined && decoys[i].state === ST_ACTIVE;
    draw.strokeStyle = afloat ? ink : dim;
    draw.fillStyle = afloat ? ink : dim;
    draw.beginPath();
    draw.arc(x, y, 4, 0, Math.PI * 2);
    if (afloat) draw.fill();
    else draw.stroke();
    draw.fillText(String(i + 1), x + 6, y - 4);
  }
  return canvas;
}

// --- OUTFIT: the fitting screen ---------------------------------------------

function renderOutfit(panel, unit) {
  const t = panel.context.t;
  const view = panel.context.view();
  const wrap = document.createElement('div');
  wrap.className = 'sq-fit';

  // Left: the stores this hull can carry, one row each, with + and -.
  const stores = document.createElement('div');
  const stowed = unit.state === ST_STOWED;
  stores.append(line(t(stowed ? 'sq.payloads' : 'sq.payloadsAway')));
  let station = 0;
  for (const arm of unit.arms) {
    const index = station;
    const each = panel.context.weaponWeight(arm.w);
    const magazine = panel.context.weaponMagazine(arm.w);
    const item = document.createElement('div');
    item.append(row(panel.context.weaponLabel(arm.w),
      `${arm.n}/${magazine} · ${kg(arm.n * each)} kg`));
    if (stowed) {
      const step = magazine > 40 ? Math.floor(magazine / 10) : 1;
      item.append(stepper(panel,
        () => fit(panel, unit, index, arm.n + step),
        () => fit(panel, unit, index, arm.n - step)));
    }
    stores.append(item);
    station = station + 1;
  }
  if (unit.kind === KIND_WALRUS) stores.append(devices(panel, unit, stowed));

  // Right: the craft, its budget and its repair state - the original drew a
  // plan with the hardpoints on it, and so do we.
  const plan = document.createElement('div');
  plan.className = 'sq-plan';
  plan.append(line(t(unit.kind === KIND_MANTA ? 'sq.mantaRole' : 'sq.walrusRole')));
  plan.append(row(t('sq.payloadMax'), `${kg(unit.payloadMaxGrams)} kg`));
  plan.append(row(t('sq.payloadNow'), `${kg(unit.payloadGrams)} kg`));
  plan.append(bar(unit.payloadMaxGrams > 0
    ? Math.floor((unit.payloadGrams * 1000) / unit.payloadMaxGrams) : 0));
  plan.append(line(t(unit.kind === KIND_MANTA ? 'sq.underside' : 'sq.sideView')));
  const hard = document.createElement('div');
  for (const arm of unit.arms) {
    const chip = document.createElement('span');
    chip.className = 'sq-hard';
    if (arm.n > 0) chip.classList.add('loaded');
    chip.textContent = arm.n > 0 ? panel.context.weaponLabel(arm.w) : '—';
    hard.append(chip);
  }
  plan.append(hard);
  plan.append(row(t('sq.repairState'),
    `${Math.round((unit.hp * 100) / Math.max(1, unit.maxHp))}%`));
  plan.append(row(t('sq.fuel'), `${Math.round(fuelPermilOf(unit) / 10)}%`));

  wrap.append(stores, plan);
  panel.body.append(wrap);
}

// A laser magazine is hundreds of rounds; a missile rack is four. One step
// per press on the small racks, a tenth of the magazine on the big ones.
function stepper(panel, onPlus, onMinus) {
  const holder = document.createElement('div');
  const minus = document.createElement('span');
  minus.className = 'sq-minus';
  minus.textContent = '−';
  minus.addEventListener('pointerdown', (event) => { event.preventDefault(); onMinus(); });
  const plus = document.createElement('span');
  plus.className = 'sq-plus';
  plus.textContent = '+';
  plus.addEventListener('pointerdown', (event) => { event.preventDefault(); onPlus(); });
  holder.append(minus, plus);
  return holder;
}

function fit(panel, unit, station, rounds) {
  panel.context.send({
    type: 'set_station', unitId: unit.id, station: station, rounds: Math.max(0, rounds),
  });
  panel.signature = '';
}

// The capture devices, and which KIND of pod is in the rack.
function devices(panel, unit, stowed) {
  const t = panel.context.t;
  const holder = document.createElement('div');
  holder.append(line(t('sq.devices')));

  const podRow = document.createElement('div');
  podRow.append(row(t('sq.pod'), `${unit.pod === 1 ? kg(unit.podGrams) : 0} kg`));
  if (stowed) {
    podRow.append(action(panel, unit.pod === 1 ? t('sq.unfit') : t('sq.fitIt'), true, () => {
      panel.context.send({
        type: 'set_device', unitId: unit.id, device: 0, fitted: unit.pod === 1 ? 0 : 1,
      });
      panel.signature = '';
    }));
    // Typed pods (ruled 2026-08-25): the island's purpose, chosen here.
    podRow.append(action(panel, t(POD_ROLES[unit.podRole] ?? 'sq.podResource'), true, () => {
      panel.context.send({
        type: 'set_pod_role', unitId: unit.id, role: (unit.podRole + 1) % 3,
      });
      panel.signature = '';
    }));
  }
  holder.append(podRow);

  const virusRow = document.createElement('div');
  virusRow.append(row(t('sq.virus'), `${unit.virus === 1 ? kg(unit.virusGrams) : 0} kg`));
  if (stowed) {
    virusRow.append(action(panel, unit.virus === 1 ? t('sq.unfit') : t('sq.fitIt'), true, () => {
      panel.context.send({
        type: 'set_device', unitId: unit.id, device: 1, fitted: unit.virus === 1 ? 0 : 1,
      });
      panel.signature = '';
    }));
  }
  holder.append(virusRow);
  return holder;
}

// --- DECK: the operations ---------------------------------------------------

function renderDeck(panel, unit) {
  const t = panel.context.t;
  panel.body.append(row(t('sq.status'), t(STATE_KEYS[unit.state] ?? 'sq.unknown')));
  panel.body.append(bar(unit.deckPermil > 0 ? unit.deckPermil : 0));

  const inCycle = unit.state === ST_ON_DECK || unit.state === ST_LAUNCHING;
  const aboard = unit.state === ST_STOWED;
  const away = unit.state === ST_ACTIVE || unit.state === ST_RETURNING
    || unit.state === ST_LANDED || unit.state === ST_DOCKING;

  const bar1 = document.createElement('div');
  bar1.append(action(panel, t('sq.launch'), aboard, () => {
    panel.context.send({
      type: 'launch_unit', carrierId: panel.context.carrierId(), kind: unit.kind,
    });
  }));
  bar1.append(action(panel, t('sq.abort'), inCycle, () => {
    panel.context.send({ type: 'abort_deck', unitId: unit.id });
  }));
  bar1.append(action(panel, t('sq.recall'), away, () => {
    panel.context.send({ type: 'recall_unit', unitId: unit.id });
  }));
  panel.body.append(bar1);
  panel.body.append(line(t('sq.deckNote')));
}

function action(panel, label, enabled, onPick) {
  const chip = document.createElement('span');
  chip.className = enabled ? 'sq-act' : 'sq-act off';
  chip.textContent = label;
  if (enabled) {
    chip.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      onPick();
      panel.signature = '';
    });
  }
  return chip;
}

export { createSquadronPanel, renderSquadronPanel, toggleSquadronPanel };
