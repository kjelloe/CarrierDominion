// client/hud.js - the dev overlay.
//
// Deliberately text-only for now: the numbers that tell you whether the
// simulation is healthy (tick, state hash, seed) matter more than a styled
// instrument panel. The hash is here so a desync is visible the moment it
// happens rather than three minutes later.
//
// Every string goes through the translator. That is not ceremony for a debug
// overlay - it is how the catalogues stay honest while the HUD is still small
// enough to fix cheaply.

const HUD_ROWS = [
  'transport', 'seat', 'tick', 'speedx', 'hash', 'seed', 'graphics',
  'fps', 'speed', 'throttle', 'heading', 'fuel', 'stores', 'hangar',
  'unit', 'islands', 'supply', 'status',
];

function createHud(root, t) {
  const lines = {};
  for (const key of HUD_ROWS) {
    const row = document.createElement('div');
    row.className = 'hud-row';
    const label = document.createElement('span');
    label.className = 'hud-label';
    label.textContent = t(`hud.${key}`);
    const value = document.createElement('span');
    value.className = 'hud-value';
    value.id = `hud-${key}`;
    value.textContent = '-';
    row.append(label, value);
    root.append(row);
    lines[key] = value;
  }
  return { lines: lines, frames: 0, lastFpsMs: 0, fps: 0, t: t };
}

function setHud(hud, key, text) {
  const line = hud.lines[key];
  if (line !== undefined) line.textContent = String(text);
}

function tickFps(hud, nowMs) {
  hud.frames += 1;
  if (hud.lastFpsMs === 0) hud.lastFpsMs = nowMs;
  if (nowMs - hud.lastFpsMs >= 500) {
    hud.fps = Math.round((hud.frames * 1000) / (nowMs - hud.lastFpsMs));
    hud.frames = 0;
    hud.lastFpsMs = nowMs;
    setHud(hud, 'fps', hud.fps);
  }
  return hud.fps;
}

// Speeds are engine units per tick; the player wants knots.
function knotsFrom(unitsPerTick, unitsPerMetre, tickHz) {
  const metresPerSecond = (unitsPerTick / unitsPerMetre) * tickHz;
  return Math.round(metresPerSecond * 1.94384 * 10) / 10;
}

function degreesFrom(bam) {
  return Math.round((bam / 65536) * 3600) / 10;
}

function updateCarrierHud(hud, carrier, params) {
  const t = hud.t;
  if (carrier === undefined) {
    setHud(hud, 'speed', '-');
    return;
  }
  const knots = knotsFrom(carrier.speed, params.unitsPerMetre, params.tickHz);
  setHud(hud, 'speed', `${knots} ${t('hud.knots')}`);
  const aground = carrier.grounded === 1 ? ` ${t('hud.aground')}` : '';
  setHud(hud, 'throttle', `${carrier.throttle}%${aground}`);
  setHud(hud, 'heading', `${degreesFrom(carrier.heading)} ${t('hud.degrees')}`);
  const percent = carrier.fuelCapacity > 0
    ? Math.round((carrier.fuel * 100) / carrier.fuelCapacity)
    : 0;
  const hull = carrier.maxHull > 0 ? Math.round((carrier.hull * 100) / carrier.maxHull) : 0;
  setHud(hud, 'fuel', `${percent}% / hull ${hull}%`);
}

const KIND_KEYS = ['unit.manta', 'unit.walrus'];
const STATE_KEYS = ['unit.stowed', 'unit.holding', 'unit.returning', 'unit.lost'];
const ORDER_KEYS = ['unit.holding', 'unit.moving', 'unit.returning'];

function describeHangar(t, units, team) {
  let mantas = 0;
  let walruses = 0;
  for (const unit of units) {
    if (unit.team !== team || unit.state !== 0) continue;
    if (unit.kind === 0) mantas += 1;
    else walruses += 1;
  }
  return t('hangar.tally', { mantas: mantas, walruses: walruses });
}

function describeUnit(t, unit, params) {
  if (unit === undefined) return t('unit.none');
  const kind = t(KIND_KEYS[unit.kind] ?? 'unit.none');
  const situation = unit.control !== -1
    ? t('unit.piloted')
    : t(ORDER_KEYS[unit.order] ?? STATE_KEYS[unit.state] ?? 'unit.holding');
  const fuel = unit.fuelCapacity > 0 ? Math.round((unit.fuel * 100) / unit.fuelCapacity) : 0;
  const speed = knotsFrom(unit.speed, params.unitsPerMetre, params.tickHz);
  const pod = unit.kind === 1 && unit.pod === 1 ? ' [pod]' : '';
  return `#${unit.id} ${kind} ${situation} ${speed}${t('hud.knots')} ${fuel}%${pod}`;
}

function describeStores(t, view) {
  const r = view.resources;
  return `f ${r.fuel} / m ${r.materials} / o ${r.ordnance}`;
}

// "running - depot #3 - boat 62% laden"
function describeSupply(t, view) {
  const carrier = view.carriers.find((c) => c.team === view.team && c.contact === 0);
  const running = carrier !== undefined && carrier.supplyRun === 1;
  const parts = [t(running ? 'supply.on' : 'supply.off')];
  const depot = view.resources.stockpileIsland;
  parts.push(depot < 0 ? t('supply.noDepot') : t('supply.depot', { island: depot }));
  const boat = view.units.find((u) => u.kind === 2 && u.team === view.team && u.state !== 0);
  if (boat !== undefined) {
    const laden = boat.cargoCap > 0
      ? Math.round(((boat.cargoFuel + boat.cargoMaterials) * 100) / boat.cargoCap)
      : 0;
    parts.push(laden > 0 ? t('supply.laden', { percent: laden }) : t('supply.atSea'));
  }
  return parts.join(' - ');
}

const WIN_KEYS = ['war.unknown', 'war.byIslands', 'war.byCarrier'];

function describeIslands(t, view) {
  let mine = 0;
  let theirs = 0;
  for (const island of view.islands) {
    if (island.owner === view.team) mine += 1;
    else if (island.owner >= 0) theirs += 1;
  }
  const tally = t('islands.tally', { mine: mine, total: view.islands.length, theirs: theirs });
  if (view.phase !== 1) return tally;
  const outcome = view.winner === view.team ? t('war.won') : t('war.lost');
  return `${tally} - ${outcome}, ${t(WIN_KEYS[view.winReason] ?? 'war.unknown')}`;
}

export {
  HUD_ROWS,
  createHud,
  setHud,
  tickFps,
  updateCarrierHud,
  describeHangar,
  describeUnit,
  describeStores,
  describeIslands,
  describeSupply,
  knotsFrom,
  degreesFrom,
};
