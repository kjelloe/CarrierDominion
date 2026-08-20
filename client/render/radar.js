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

// `rangeUnits` is the ship's own radar reach, so the scope shrinks when the
// mast is shot away - the instrument tells the truth about the sensor.
function drawRadar(ctx, view, own, box, seconds, colours) {
  const cx = box.x + box.size / 2;
  const cy = box.y + box.size / 2;
  const radius = box.size / 2 - 2;
  const range = own.radar > 0 ? own.radar : 1;
  const scale = radius / range;

  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, TAU);
  ctx.fillStyle = colours.scope;
  ctx.fill();
  ctx.clip();
  drawSweep(ctx, cx, cy, radius, seconds, colours);
  drawIslands(ctx, view, own, cx, cy, radius, scale, colours);
  drawContacts(ctx, view, own, cx, cy, radius, scale, colours);
  ctx.restore();

  drawGrid(ctx, cx, cy, radius, colours);
  drawHeadingMark(ctx, cx, cy, radius, own.heading, colours);
  return { cx: cx, cy: cy, radius: radius, rangeUnits: range };
}

export { drawRadar, project, inScope };
