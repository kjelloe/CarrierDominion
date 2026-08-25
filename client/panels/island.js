// client/panels/island.js - the island board.
//
// What a captured island is for, what is going up on it, and the decisions open
// to its owner, priced. Opened by clicking an island you hold.
//
// Like the damage board, it is handed a context rather than reaching into the
// client: a translator, the current view, the seat's carrier, the build costs,
// and a way to send a command.

const ROLE_KEYS = ['island.roleResource', 'island.roleFactory', 'island.roleDefence'];
const BUILD_KEYS = ['build.factory', 'build.warehouse', 'build.turret',
  'build.upSpeed', 'build.upPd', 'build.upRadar', 'build.runway'];
// Which buildings each role allows, mirroring engine/island.js. The engine is
// the authority - this only decides what to offer.
// Roles are 0 resource, 1 factory, 2 defence; runways (6) belong to the
// mine and the fortress, as the original built them.
const ROLE_BUILDS = [[1, 6], [0, 1], [2, 6]];

function createIslandPanel(ctx) {
  return { islandId: -1, stamp: '', ctx: ctx };
}

// What the cargo network could put toward a site: the island's own stock plus
// whatever is at the depot, which is what engine/island.js will spend.
function depotMaterials(view) {
  if (view === undefined) return 0;
  const depotId = view.resources.stockpileIsland;
  if (depotId < 0) return 0;
  const depot = view.islands.find((i) => i.id === depotId);
  return depot === undefined || depot.stockMaterials < 0 ? 0 : depot.stockMaterials;
}

// The island you hold under this point on the water, if any.
function islandAt(view, x, y) {
  if (view === undefined) return undefined;
  for (const island of view.islands) {
    if (island.owner !== view.team) continue;
    if (Math.hypot(island.x - x, island.y - y) <= island.radius * 1.6) return island;
  }
  return undefined;
}

function openIslandPanel(panel, island) {
  panel.islandId = island === undefined ? -1 : island.id;
  panel.stamp = '';
  document.getElementById('island-panel').classList.toggle('open', island !== undefined);
}

function actionRow(label, enabled, onPick) {
  const row = document.createElement('div');
  row.className = enabled ? 'island-row island-act' : 'island-row island-act off';
  const text = document.createElement('span');
  text.textContent = label;
  row.append(text);
  if (enabled) row.addEventListener('click', onPick);
  return row;
}

function infoRow(label, value) {
  const row = document.createElement('div');
  row.className = 'island-row';
  const left = document.createElement('span');
  left.className = 'hud-label';
  left.textContent = label;
  const right = document.createElement('span');
  right.textContent = value;
  row.append(left, right);
  return row;
}

function roleActions(panel, island, body) {
  const t = panel.ctx.t;
  for (let role = 0; role < ROLE_KEYS.length; role++) {
    if (role === island.role) continue;
    body.append(actionRow(t('island.setRole', { role: t(ROLE_KEYS[role]) }), true, () => {
      panel.ctx.send({
        type: 'set_island_role',
        carrierId: panel.ctx.carrierId(),
        islandId: island.id,
        role: role,
      });
    }));
  }
}

function buildActions(panel, island, body) {
  const t = panel.ctx.t;
  const purse = island.stockMaterials + depotMaterials(panel.ctx.view());
  for (const what of ROLE_BUILDS[island.role]) {
    const cost = panel.ctx.buildCost(what);
    body.append(actionRow(
      t('island.build', { what: t(BUILD_KEYS[what]), cost: cost }),
      purse >= cost,
      () => panel.ctx.send({
        type: 'build_on_island',
        carrierId: panel.ctx.carrierId(),
        islandId: island.id,
        what: what,
      }),
    ));
  }
}

// Rebuilt whenever the island's numbers change, and not every frame: the rows
// are clickable, and an element replaced under the pointer cannot be clicked.
function renderIslandPanel(panel) {
  if (panel.islandId === -1) return;
  const view = panel.ctx.view();
  if (view === undefined) return;
  const island = view.islands.find((i) => i.id === panel.islandId);
  if (island === undefined || island.owner !== view.team) {
    openIslandPanel(panel, undefined);
    return;
  }
  const stamp = [
    island.role, island.factories, island.warehouses, island.turrets,
    island.building, Math.floor(island.buildTicks / 20), island.stockMaterials,
  ].join('/');
  if (stamp === panel.stamp) return;
  panel.stamp = stamp;

  const t = panel.ctx.t;
  document.getElementById('island-title').textContent = t('island.title', {
    name: islandName(island), id: island.id,
  });
  const body = document.getElementById('island-body');
  body.textContent = '';
  body.append(infoRow(
    t('island.role'),
    island.role < 0 ? t('island.roleNone') : t(ROLE_KEYS[island.role]),
  ));
  body.append(infoRow(
    t('island.works'),
    `${island.factories}f / ${island.warehouses}w / ${island.turrets}t`,
  ));
  body.append(infoRow(
    t('island.stock'),
    `m ${island.stockMaterials} / f ${island.stockFuel} / o ${island.stockOrdnance}`,
  ));
  // What is waiting on that rock, before it shoots: a neutral silo, a
  // Defence island's bat cave, or simply how many guns are up. The turret
  // list is already fog-filtered - if you cannot see them, this is silent.
  const guns = (panel.ctx.view()?.turrets ?? []).filter(
    (turret) => turret.island === island.id,
  );
  const neutralGuns = guns.filter((turret) => turret.team < 0).length;
  if (neutralGuns > 0) {
    body.append(infoRow(t('island.teeth'), t('island.silo')));
  } else if (guns.length > 0) {
    body.append(infoRow(t('island.teeth'), t('island.guns', { n: guns.length })));
  }
  if (island.role === 2 && island.owner >= 0) {
    body.append(infoRow('', t('island.batcave')));
  }
  if (island.building >= 0) {
    body.append(infoRow('', t('island.building', {
      what: t(BUILD_KEYS[island.building]),
      ticks: island.buildTicks,
    })));
  }

  const built = island.factories + island.warehouses + island.turrets;
  if (built === 0 && island.building < 0) roleActions(panel, island, body);
  if (island.role >= 0 && island.building < 0) buildActions(panel, island, body);
  document.getElementById('island-note').textContent = built > 0
    ? `${t('island.locked')} - ${t('island.close')}`
    : t('island.close');
}

export {
  ROLE_KEYS,
  BUILD_KEYS,
  ROLE_BUILDS,
  createIslandPanel,
  depotMaterials,
  islandAt,
  openIslandPanel,
  renderIslandPanel,
};
