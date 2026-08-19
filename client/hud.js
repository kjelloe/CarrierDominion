// client/hud.js - the dev overlay.
//
// Deliberately text-only for Milestone 0: the numbers that tell you whether the
// simulation is healthy (tick, state hash, seed) matter more right now than a
// styled instrument panel. The hash is here so a desync is visible the moment
// it happens rather than three minutes later.

function createHud(root) {
  const lines = {};
  const order = [
    'transport', 'seat', 'tick', 'hash', 'seed', 'graphics',
    'fps', 'speed', 'throttle', 'heading', 'fuel', 'stores', 'hangar', 'unit', 'islands', 'status',
  ];
  for (const key of order) {
    const row = document.createElement('div');
    row.className = 'hud-row';
    const label = document.createElement('span');
    label.className = 'hud-label';
    label.textContent = key;
    const value = document.createElement('span');
    value.className = 'hud-value';
    value.id = `hud-${key}`;
    value.textContent = '-';
    row.append(label, value);
    root.append(row);
    lines[key] = value;
  }
  return { lines: lines, frames: 0, lastFpsMs: 0, fps: 0 };
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
  if (carrier === undefined) {
    setHud(hud, 'speed', 'no hull');
    return;
  }
  setHud(hud, 'speed', `${knotsFrom(carrier.speed, params.unitsPerMetre, params.tickHz)} kn`);
  setHud(hud, 'throttle', `${carrier.throttle}%${carrier.grounded === 1 ? ' AGROUND' : ''}`);
  setHud(hud, 'heading', `${degreesFrom(carrier.heading)} deg`);
  const percent = carrier.fuelCapacity > 0
    ? Math.round((carrier.fuel * 100) / carrier.fuelCapacity)
    : 0;
  setHud(hud, 'fuel', `${percent}%`);
}

const KIND_NAMES = ['Manta', 'Walrus'];
const STATE_NAMES = ['stowed', 'active', 'returning', 'lost'];
const ORDER_NAMES = ['holding', 'moving', 'returning'];

// "3 Manta / 2 Walrus" - what is still on the deck and launchable.
function describeHangar(units, team) {
  let mantas = 0;
  let walruses = 0;
  for (const unit of units) {
    if (unit.team !== team || unit.state !== 0) continue;
    if (unit.kind === 0) mantas += 1;
    else walruses += 1;
  }
  return `${mantas} Manta / ${walruses} Walrus`;
}

function describeUnit(unit, params) {
  if (unit === undefined) return 'none selected';
  const kind = KIND_NAMES[unit.kind] ?? 'unit';
  const situation = unit.control !== -1
    ? 'PILOTED'
    : (ORDER_NAMES[unit.order] ?? STATE_NAMES[unit.state] ?? '');
  const fuel = unit.fuelCapacity > 0
    ? Math.round((unit.fuel * 100) / unit.fuelCapacity)
    : 0;
  const speed = knotsFrom(unit.speed, params.unitsPerMetre, params.tickHz);
  return `#${unit.id} ${kind} ${situation} ${speed}kn ${fuel}%`;
}

function describeStores(view) {
  const r = view.resources;
  return `f ${r.fuel} / m ${r.materials} / o ${r.ordnance}`;
}

const WIN_REASONS = ['', 'held the archipelago', 'sank the enemy carrier'];

// "3 of 8 held - war over: you won (sank the enemy carrier)"
function describeIslands(view) {
  let mine = 0;
  let theirs = 0;
  for (const island of view.islands) {
    if (island.owner === view.team) mine += 1;
    else if (island.owner >= 0) theirs += 1;
  }
  const tally = `${mine} of ${view.islands.length} (enemy ${theirs})`;
  if (view.phase !== 1) return tally;
  const outcome = view.winner === view.team ? 'YOU WON' : 'YOU LOST';
  return `${tally} - ${outcome}, ${WIN_REASONS[view.winReason] ?? 'somehow'}`;
}

export {
  describeStores,
  describeIslands,
  createHud,
  setHud,
  tickFps,
  updateCarrierHud,
  describeHangar,
  describeUnit,
  knotsFrom,
  degreesFrom,
  KIND_NAMES,
};
