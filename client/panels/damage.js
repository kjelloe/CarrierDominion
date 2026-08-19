// client/panels/damage.js - the damage control board, as a self-contained panel.
//
// A turning wireframe of the ship with one box per section, a list of what is
// broken, and the repair priority the player has set on each. Clicking either
// the model or a row cycles that section LOW -> MED -> HIGH.
//
// It knows nothing about the rest of the client: it is handed a context with a
// translator, a way to read the current view, and a way to send a command. That
// is the whole interface, and it is what lets main.js stop being the place
// every panel lives.

import { createBoard, pickSection, renderBoard, updateBoard } from '../render/damageboard.js';
import { PRIORITY_KEYS, SECTION_KEYS, sectionPercent } from '../hud.js';

// The rows are built ONCE and then only have their text rewritten. Rebuilding
// them every frame - which is what this did first - replaces the element under
// the pointer sixty times a second, so a click lands on a node that has already
// been thrown away.
function buildRows(panel, ctx) {
  const list = document.getElementById('damage-list');
  list.textContent = '';
  panel.rows = [];
  for (const key of SECTION_KEYS) {
    const row = document.createElement('div');
    row.className = 'damage-row';
    const name = document.createElement('span');
    name.className = 'damage-name';
    name.textContent = ctx.t(key);
    const value = document.createElement('span');
    value.textContent = '-';
    row.append(name, value);
    const index = panel.rows.length;
    row.addEventListener('click', () => cyclePriority(ctx, index));
    list.append(row);
    panel.rows.push(value);
  }
}

// Low, medium, high, and round again. The engine holds the authority; this only
// asks, and the next view answers.
function cyclePriority(ctx, sectionId) {
  if (sectionId === -1) return;
  const carrier = ctx.ownCarrier();
  if (carrier === undefined) return;
  const section = carrier.sections.find((s) => s.id === sectionId);
  if (section === undefined) return;
  ctx.send({
    type: 'set_repair_priority',
    carrierId: carrier.id,
    section: sectionId,
    priority: (section.priority + 1) % 3,
  });
}

function createDamagePanel(ctx) {
  return { open: false, board: undefined, rows: [], ctx: ctx };
}

// Built the first time it is opened: a player who never presses Z never pays
// for a second WebGL context.
function toggleDamagePanel(panel) {
  const root = document.getElementById('damage-panel');
  panel.open = !root.classList.contains('open');
  root.classList.toggle('open', panel.open);
  if (!panel.open || panel.board !== undefined) return panel.open;

  const canvas = document.getElementById('damage-view');
  panel.board = createBoard(canvas);
  document.getElementById('damage-title').textContent = panel.ctx.t('damage.title');
  document.getElementById('damage-legend').textContent = panel.ctx.t('damage.legend');
  canvas.addEventListener('pointerdown', (event) => {
    const bounds = canvas.getBoundingClientRect();
    const ndcX = ((event.clientX - bounds.left) / bounds.width) * 2 - 1;
    const ndcY = -(((event.clientY - bounds.top) / bounds.height) * 2 - 1);
    cyclePriority(panel.ctx, pickSection(panel.board, ndcX, ndcY));
  });
  buildRows(panel, panel.ctx);
  return panel.open;
}

function renderDamagePanel(panel, deltaSeconds) {
  if (!panel.open || panel.board === undefined) return;
  const carrier = panel.ctx.ownCarrier();
  if (carrier === undefined) return;
  updateBoard(panel.board, carrier.sections);
  const canvas = document.getElementById('damage-view');
  renderBoard(panel.board, deltaSeconds, canvas.clientWidth, canvas.clientHeight);

  for (const section of carrier.sections) {
    const value = panel.rows[section.id];
    if (value === undefined) continue;
    value.textContent = `${sectionPercent(section)} ${panel.ctx.t(PRIORITY_KEYS[section.priority] ?? '')}`;
  }
  document.getElementById('damage-stores').textContent = panel.ctx.t('damage.stores', {
    materials: carrier.materials,
    capacity: carrier.materialsCapacity,
  });
}

export { createDamagePanel, toggleDamagePanel, renderDamagePanel };
