// client/render/radar.js - the scope.
//
// A plan-position indicator: your ship at the centre, north up, everything the
// VIEW knows about drawn where it is. That last part matters - the scope is fed
// the fog-filtered view like everything else, so it cannot show you a contact
// your hulls have not detected. There is no separate "radar truth".
//
// Drawn on a 2D canvas rather than built from DOM: an instrument redraws every
// frame, and sixty new elements a second is how you make a browser miserable.

const TAU = Math.PI * 2;

function ring(ctx, cx, cy, radius, colour, width) {
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, TAU);
  ctx.strokeStyle = colour;
  ctx.lineWidth = width;
  ctx.stroke();
}

function dot(ctx, x, y, size, colour) {
  ctx.fillStyle = colour;
  ctx.fillRect(x - size, y - size, size * 2, size * 2);
}

// Engine units to scope pixels, with north up and east right. The engine's y
// grows north, and a screen's y grows down, so the sign flips here and nowhere
// else.
function project(cx, cy, ownX, ownY, x, y, scale) {
  return { x: cx + (x - ownX) * scale, y: cy - (y - ownY) * scale };
}

function inScope(cx, cy, px, py, radius) {
  const dx = px - cx;
  const dy = py - cy;
  return dx * dx + dy * dy <= radius * radius;
}

// The sweep, purely cosmetic - the detection is the fog filter's job. It is
// here because a scope that does not sweep does not read as a scope.
function drawSweep(ctx, cx, cy, radius, seconds, colours) {
  const angle = (seconds * 1.1) % TAU;
  const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
  gradient.addColorStop(0, colours.sweepInner);
  gradient.addColorStop(1, colours.sweepOuter);
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.arc(cx, cy, radius, -angle - 0.42, -angle);
  ctx.closePath();
  ctx.fillStyle = gradient;
  ctx.fill();
}

function drawGrid(ctx, cx, cy, radius, colours) {
  ring(ctx, cx, cy, radius, colours.bezel, 2);
  ring(ctx, cx, cy, radius * 0.66, colours.grid, 1);
  ring(ctx, cx, cy, radius * 0.33, colours.grid, 1);
  ctx.beginPath();
  ctx.moveTo(cx - radius, cy);
  ctx.lineTo(cx + radius, cy);
  ctx.moveTo(cx, cy - radius);
  ctx.lineTo(cx, cy + radius);
  ctx.strokeStyle = colours.grid;
  ctx.lineWidth = 1;
  ctx.stroke();
}

function drawIslands(ctx, view, own, cx, cy, radius, scale, colours) {
  for (const island of view.islands) {
    const spot = project(cx, cy, own.x, own.y, island.x, island.y, scale);
    const size = Math.max(3, island.radius * scale);
    if (!inScope(cx, cy, spot.x, spot.y, radius - 2)) continue;
    ctx.beginPath();
    ctx.arc(spot.x, spot.y, size, 0, TAU);
    ctx.fillStyle = colours.land;
    ctx.fill();
    if (island.owner < 0) continue;
    ctx.strokeStyle = island.owner === view.team ? colours.own : colours.enemy;
    ctx.lineWidth = 2;
    ctx.stroke();
  }
}

// The chart's memory: a hollow mark where an enemy WAS, drawn faint, because a
// ghost that looked like a live contact would be the scope lying about how
// much it knows. Live contacts are solid; memories are outlines.
function drawGhosts(ctx, view, own, cx, cy, radius, scale, colours) {
  if (view.contacts === undefined) return;
  ctx.save();
  ctx.globalAlpha = 0.55;
  for (const ghost of view.contacts) {
    const spot = project(cx, cy, own.x, own.y, ghost.x, ghost.y, scale);
    if (!inScope(cx, cy, spot.x, spot.y, radius - 2)) continue;
    const size = ghost.kind === 1 ? 4 : 3;
    ctx.strokeStyle = colours.enemy;
    ctx.lineWidth = 1;
    ctx.strokeRect(spot.x - size, spot.y - size, size * 2, size * 2);
  }
  ctx.restore();
}

// The programmed course, when there is one: a hollow diamond at the mark and
// a faint line out to it - the scope is where a navigator looks for it.
function drawCourse(ctx, own, cx, cy, radius, scale, colours) {
  if (own.courseX === undefined || own.courseX < 0) return;
  const spot = project(cx, cy, own.x, own.y, own.courseX, own.courseY, scale);
  if (!inScope(cx, cy, spot.x, spot.y, radius - 4)) return;
  ctx.strokeStyle = colours.own;
  ctx.lineWidth = 1;
  ctx.setLineDash([3, 4]);
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(spot.x, spot.y);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.moveTo(spot.x, spot.y - 5);
  ctx.lineTo(spot.x + 5, spot.y);
  ctx.lineTo(spot.x, spot.y + 5);
  ctx.lineTo(spot.x - 5, spot.y);
  ctx.closePath();
  ctx.stroke();
}

function drawContacts(ctx, view, own, cx, cy, radius, scale, colours) {
  for (const turret of view.turrets) {
    const spot = project(cx, cy, own.x, own.y, turret.x, turret.y, scale);
    if (!inScope(cx, cy, spot.x, spot.y, radius - 2)) continue;
    dot(ctx, spot.x, spot.y, 2, turret.team === view.team ? colours.own : colours.enemy);
  }
  for (const unit of view.units) {
    if (unit.state === 0 || unit.state === 3) continue;
    const spot = project(cx, cy, own.x, own.y, unit.x, unit.y, scale);
    if (!inScope(cx, cy, spot.x, spot.y, radius - 2)) continue;
    const mine = unit.team === view.team;
    dot(ctx, spot.x, spot.y, mine ? 2 : 3, mine ? colours.own : colours.enemy);
  }
  for (const carrier of view.carriers) {
    const spot = project(cx, cy, own.x, own.y, carrier.x, carrier.y, scale);
    if (!inScope(cx, cy, spot.x, spot.y, radius - 2)) continue;
    const mine = carrier.team === view.team && carrier.contact === 0;
    dot(ctx, spot.x, spot.y, 4, mine ? colours.self : colours.enemy);
  }
  // Rounds in the air, which is what tells you a fight has started somewhere
  // you were not looking.
  for (const shot of view.shots) {
    const spot = project(cx, cy, own.x, own.y, shot.x, shot.y, scale);
    if (!inScope(cx, cy, spot.x, spot.y, radius - 2)) continue;
    dot(ctx, spot.x, spot.y, 1, shot.team === view.team ? colours.own : colours.enemy);
  }
}

// The heading marker: which way the ship is actually pointing, on the rim.
function drawHeadingMark(ctx, cx, cy, radius, headingBam, colours) {
  const angle = (headingBam / 65536) * TAU;
  const x = cx + Math.cos(angle) * (radius - 6);
  const y = cy - Math.sin(angle) * (radius - 6);
  ctx.beginPath();
  ctx.arc(x, y, 4, 0, TAU);
  ctx.fillStyle = colours.self;
  ctx.fill();
}

// `range` is what the scope is set to show, in engine units - not what the ship
// can detect. Zooming out never reveals more than the fog allows, because the
// view it is drawing has already been filtered: a wider scope shows more empty
// sea and more of the chart, and exactly as many contacts.

// A strike blooms the scope (ruled 2026-08-26, Q3b). Lightning throws a wall
// of return into the set for a fraction of a second, and the player learns to
// read past it.
//
// Two rules keep it honest. It is drawn UNDER everything real - islands,
// ghosts, course, contacts all paint over it - so a strike can never hide a
// blip the player was entitled to see. And it is derived from (seed, tick),
// which every seat in the war already agrees on, so two players in one storm
// see the same clutter and nobody is being shown private noise.
function clutterHash(seed, n) {
  let h = (seed * 374761393 + n * 668265263) % 2147483647;
  if (h < 0) h += 2147483647;
  h = (h ^ Math.floor(h / 8192)) % 2147483647;
  return (h * 1274126177) % 2147483647;
}

function drawStormClutter(ctx, view, cx, cy, radius, colours) {
  const weather = view === undefined ? undefined : view.weather;
  if (weather === undefined) return;
  const flash = weather.flashPermil;
  if (flash <= 0) return;

  // The bloom is brightest on the first tick of the stroke and gone by the
  // last, which is the same curve the sky uses.
  const strength = flash / 1000;
  const arcs = 5 + Math.round(strength * 7);
  const seed = view.seed === undefined ? 0 : view.seed;
  // One slot per stroke rather than per tick: the clutter must SIT there and
  // fade, not re-scatter every frame like television snow.
  const slot = Math.floor(view.tick / 8);

  ctx.save();
  ctx.globalAlpha = 0.10 + strength * 0.30;
  ctx.strokeStyle = colours.grid;
  for (let i = 0; i < arcs; i++) {
    const h = clutterHash(seed + i * 7919, slot);
    const bearing = ((h % 65536) / 65536) * TAU;
    const distance = (0.18 + ((Math.floor(h / 65536) % 1000) / 1000) * 0.78) * radius;
    const spread = 0.10 + ((Math.floor(h / 131072) % 400) / 1000);
    ctx.lineWidth = 1 + strength * 2;
    ctx.beginPath();
    ctx.arc(cx, cy, distance, bearing - spread, bearing + spread);
    ctx.stroke();
  }
  ctx.restore();
}

function drawRadar(ctx, view, own, box, seconds, colours, range) {
  const cx = box.x + box.size / 2;
  const cy = box.y + box.size / 2;
  const radius = box.size / 2 - 2;
  const scale = radius / (range > 0 ? range : 1);

  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, TAU);
  ctx.fillStyle = colours.scope;
  ctx.fill();
  ctx.clip();
  drawSweep(ctx, cx, cy, radius, seconds, colours);
  // Under everything real, deliberately.
  drawStormClutter(ctx, view, cx, cy, radius, colours);
  drawIslands(ctx, view, own, cx, cy, radius, scale, colours);
  drawGhosts(ctx, view, own, cx, cy, radius, scale, colours);
  drawCourse(ctx, own, cx, cy, radius, scale, colours);
  drawContacts(ctx, view, own, cx, cy, radius, scale, colours);
  ctx.restore();

  drawGrid(ctx, cx, cy, radius, colours);
  drawHeadingMark(ctx, cx, cy, radius, own.heading, colours);
  // A ring the ship cannot see past, drawn only when the scope is set wider
  // than the radar: past it the scope is a chart, not a sensor.
  // The ring is what this set reaches NOW, weather and all - `radarNow` when
  // the view carries it, the fair-weather figure otherwise. Drawing the fair
  // figure in a storm would draw a promise the set cannot keep.
  const reach = own.radarNow !== undefined && own.radarNow >= 0 ? own.radarNow : own.radar;
  if (reach > 0 && reach < range) {
    ring(ctx, cx, cy, reach * scale, colours.grid, 1);
  }
  return { cx: cx, cy: cy, radius: radius, rangeUnits: range };
}

export { drawRadar, project, inScope };
