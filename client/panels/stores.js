// client/panels/stores.js - the quartermaster (ruling 2026-08-23, the light
// version of the original's Stores mode).
//
// Two things, on one screen: WHERE the goods are - every island you hold,
// with its stock and which one is the depot - and WHAT the plants make next:
// a production bias per output category, Low starving it, High leaning on it,
// all-Medium being exactly the untouched plant. Clicking an island row makes
// it the depot, which is the designation the original did from its map.
//
// Rows are built once per set of owned islands and updated in place - the
// rebuilt-under-the-pointer bug is in the dev-log twice already.

const CATEGORIES = [
  { item: 0, label: 'stores.fuel', biasKey: 'biasFuel' },
  { item: 1, label: 'stores.ordnance', biasKey: 'biasOrdnance' },
  { item: 2, label: 'stores.chassis', biasKey: 'biasChassis' },
];
const LEVELS = ['stores.low', 'stores.medium', 'stores.high'];

function createStoresPanel(context) {
  const panel = {
    context: context,
    root: document.getElementById('stores-panel'),
    body: document.getElementById('stores-body'),
    bias: document.getElementById('stores-bias'),
    open: false,
    biasCells: [],
    islandRows: {},
    signature: '',
  };
  document.getElementById('stores-title').textContent = context.t('stores.title');
  document.getElementById('stores-note').textContent = context.t('stores.note');

  for (const category of CATEGORIES) {
    const row = document.createElement('div');
    row.className = 'stores-row';
    const label = document.createElement('span');
    label.className = 'stores-label';
    label.textContent = context.t(category.label);
    row.append(label);
    for (let level = 0; level < 3; level++) {
      const cell = document.createElement('span');
      cell.className = 'bias-cell';
      cell.textContent = context.t(LEVELS[level]);
      cell.addEventListener('pointerdown', (event) => {
        event.preventDefault();
        const carrierId = context.carrierId();
        if (carrierId < 0) return;
        context.send({
          type: 'set_supply_bias', carrierId: carrierId, item: category.item, level: level,
        });
      });
      panel.biasCells.push({ biasKey: category.biasKey, level: level, cell: cell });
      row.append(cell);
    }
    panel.bias.append(row);
  }
  return panel;
}

function toggleStoresPanel(panel) {
  panel.open = !panel.open;
  panel.root.classList.toggle('open', panel.open);
}

const ROLE_NAMES = ['stores.mine', 'stores.factory', 'stores.defence'];

function renderStoresPanel(panel) {
  if (!panel.open) return;
  const view = panel.context.view();
  if (view === undefined) return;

  for (const entry of panel.biasCells) {
    entry.cell.classList.toggle('on', view.resources[entry.biasKey] === entry.level);
  }

  const mine = view.islands.filter((island) => island.owner === view.team);
  const signature = mine.map((island) => `${island.id}:${island.role}`).join(',');
  if (signature !== panel.signature) {
    panel.signature = signature;
    panel.islandRows = {};
    panel.body.textContent = '';
    for (const island of mine) {
      const row = document.createElement('div');
      row.className = 'stores-row stores-island';
      const name = document.createElement('span');
      name.className = 'stores-label';
      const stock = document.createElement('span');
      row.append(name, stock);
      row.addEventListener('pointerdown', (event) => {
        event.preventDefault();
        const carrierId = panel.context.carrierId();
        if (carrierId < 0) return;
        panel.context.send({
          type: 'set_stockpile', carrierId: carrierId, islandId: island.id,
        });
      });
      panel.body.append(row);
      panel.islandRows[island.id] = { name: name, stock: stock, row: row };
    }
  }

  const t = panel.context.t;
  for (const island of mine) {
    const entry = panel.islandRows[island.id];
    if (entry === undefined) continue;
    const depot = view.resources.stockpileIsland === island.id;
    const role = island.role >= 0 ? t(ROLE_NAMES[island.role]) : t('stores.unplanned');
    entry.name.textContent = `#${island.id} ${role}${depot ? ` ${t('stores.depot')}` : ''}`;
    entry.stock.textContent = `F${island.stockFuel} M${island.stockMaterials}`
      + ` O${island.stockOrdnance} C${island.stockChassis}`;
    entry.row.classList.toggle('depot', depot);
  }
}

export { createStoresPanel, toggleStoresPanel, renderStoresPanel };
