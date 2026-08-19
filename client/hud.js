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
  'fps', 'speed', 'throttle', 'heading', 'fuel', 'damage', 'weapons',
  'stores', 'hangar', 'unit', 'islands', 'supply', 'status',
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
  const ammo = unit.ammo > 0 ? ` ${unit.ammo}x` : '';
  return `#${unit.id} ${kind} ${situation} ${speed}${t('hud.knots')} ${fuel}%${ammo}${pod}`;
}

// The damage report, in the order the sections sit along the ship: stern to
// bow. A percentage each, and the ones that are gone say so - what is broken
// matters more than by how much, once it is broken.
// In the order the sections sit on the ship, which is the order the damage
// board draws them: bow, midship, stern, port, starboard, topside, engine.
const SECTION_KEYS = [
  'section.bow', 'section.midship', 'section.stern',
  'section.port', 'section.starboard', 'section.topside', 'section.engine',
];
const PRIORITY_KEYS = ['priority.low', 'priority.medium', 'priority.high'];

function sectionPercent(section) {
  return section.maxHp > 0 ? Math.round((section.hp * 100) / section.maxHp) : 100;
}

// One line for the overlay: only what is actually hurt, because seven sections
// at 100 is a row of noise. "all sound" when there is nothing to say.
function describeDamage(t, view) {
  const carrier = view.carriers.find((c) => c.team === view.team && c.contact === 0);
  if (carrier === undefined || carrier.sections.length === 0) return t('damage.none');
  const parts = [];
  for (const section of carrier.sections) {
    const percent = sectionPercent(section);
    if (percent >= 100) continue;
    const name = t(SECTION_KEYS[section.id] ?? 'damage.none');
    parts.push(percent === 0 ? `${name} ${t('damage.out')}` : `${name} ${percent}`);
  }
  if (parts.length === 0) return t('damage.sound');
  return parts.join(' ');
}

// "600 rnd - 3 in the air". Point defence is the number that decides whether a
// strike gets through, so it belongs next to the hull, not buried in a menu.
function describeWeapons(t, view) {
  const carrier = view.carriers.find((c) => c.team === view.team && c.contact === 0);
  const rounds = carrier === undefined ? 0 : carrier.ammo;
  const store = carrier === undefined ? 0 : carrier.ordnance;
  const air = view.shots.filter((s) => s.team === view.team).length;
  return t('weapons.state', { rounds: rounds, store: store, air: air });
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
    const aboard = boat.cargoFuel + boat.cargoMaterials + boat.cargoOrdnance;
    const laden = boat.cargoCap > 0 ? Math.round((aboard * 100) / boat.cargoCap) : 0;
    parts.push(laden > 0 ? t('supply.laden', { percent: laden }) : t('supply.atSea'));
  }
  return parts.join(' - ');
}

const WIN_KEYS = ['war.unknown', 'war.byIslands', 'war.byCarrier', 'war.draw'];

function describeIslands(t, view) {
  let mine = 0;
  let theirs = 0;
  for (const island of view.islands) {
    if (island.owner === view.team) mine += 1;
    else if (island.owner >= 0) theirs += 1;
  }
  const tally = t('islands.tally', { mine: mine, total: view.islands.length, theirs: theirs });
  if (view.phase !== 1) return tally;
  // A draw is a real ending: both carriers on the bottom, nobody's war to win.
  if (view.winner < 0) return `${tally} - ${t('war.draw')}`;
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
  describeWeapons,
  describeDamage,
  sectionPercent,
  SECTION_KEYS,
  PRIORITY_KEYS,
  describeIslands,
  describeSupply,
  knotsFrom,
  degreesFrom,
};
