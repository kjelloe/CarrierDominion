// client/render/instruments.js - the 1988 panel.
//
// Bezelled instruments across the bottom of the screen instead of a table of
// labelled numbers: the helm on the left, the scope in the middle, the ship's
// condition on the right. Everything is drawn from the fog-filtered view, and
// everything redraws every frame, on one 2D canvas.
//
// The rule the whole panel is built on: an instrument says ONE thing, and says
// it in a shape you can read without stopping to parse it. A bar that is a
// third full, a schematic with a red section, a needle off the mark. Numbers
// are there for when you want the exact figure, not for reading the situation.

import { drawRadar } from './radar.js';

const TAU = Math.PI * 2;
const PANEL_HEIGHT = 196;

// Section boxes for the damage schematic, in the ship's own frame: bow forward.
// The order is the engine's - bow, midship, stern, port, starboard, topside,
// engine - so a section id indexes straight into it.
const SCHEMATIC = [
  { x: 0.62, y: 0.28, w: 0.30, h: 0.44 }, // bow
  { x: 0.34, y: 0.28, w: 0.28, h: 0.44 }, // midship
  { x: 0.08, y: 0.28, w: 0.10, h: 0.44 }, // stern
  { x: 0.08, y: 0.10, w: 0.84, h: 0.18 }, // port
  { x: 0.08, y: 0.72, w: 0.84, h: 0.18 }, // starboard
  { x: 0.40, y: 0.36, w: 0.16, h: 0.28 }, // topside
  { x: 0.18, y: 0.28, w: 0.16, h: 0.44 }, // engine
];

function bezel(ctx, x, y, w, h, colours, title) {
  ctx.fillStyle = colours.panel;
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = colours.bezel;
  ctx.lineWidth = 2;
  ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);
  ctx.strokeStyle = colours.grid;
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 5, y + 5, w - 10, h - 10);
  if (title === undefined) return;
  ctx.fillStyle = colours.dim;
  ctx.font = '10px ui-monospace, monospace';
  ctx.fillText(title, x + 10, y + 18);
}

// A horizontal bar with its own label and figure. Reads as "how much is left"
// before you have read a single character of it.
function bar(ctx, x, y, w, h, permil, colours, label, figure) {
  ctx.fillStyle = colours.grid;
  ctx.fillRect(x, y, w, h);
  const fill = Math.max(0, Math.min(1000, permil));
  ctx.fillStyle = fill < 250 ? colours.bad : (fill < 500 ? colours.warn : colours.good);
  ctx.fillRect(x, y, Math.round((w * fill) / 1000), h);
  ctx.strokeStyle = colours.bezel;
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  ctx.fillStyle = colours.dim;
  ctx.font = '10px ui-monospace, monospace';
  ctx.fillText(label, x, y - 4);
  if (figure === undefined) return;
  ctx.fillStyle = colours.ink;
  ctx.textAlign = 'right';
  ctx.fillText(figure, x + w, y - 4);
  ctx.textAlign = 'left';
}

// The compass: a rose that turns under a fixed lubber line, which is how a
// steering compass works and why it is readable at a glance.
function drawCompass(ctx, box, headingBam, colours) {
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2 + 6;
  const radius = Math.min(box.w, box.h) / 2 - 16;
  const heading = (headingBam / 65536) * TAU;

  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, TAU);
  ctx.strokeStyle = colours.bezel;
  ctx.lineWidth = 2;
  ctx.stroke();

  const marks = ['N', 'E', 'S', 'W'];
  ctx.font = '11px ui-monospace, monospace';
  ctx.textAlign = 'center';
  for (let i = 0; i < 4; i++) {
    // Heading-up, so a compass point sits at its bearing RELATIVE to the ship.
    // Engine bearings grow counter-clockwise from east; counter-clockwise on
    // screen is to the left, which is why the sine is subtracted. Facing east,
    // north belongs at nine o'clock - getting that sign wrong mirrors the rose
    // and it takes a screenshot to notice.
    const bearing = TAU / 4 - (i * TAU) / 4; // N, E, S, W in engine bearings
    const relative = bearing - heading;
    const x = cx - Math.sin(relative) * (radius - 12);
    const y = cy - Math.cos(relative) * (radius - 12);
    ctx.fillStyle = i === 0 ? colours.ink : colours.dim;
    ctx.fillText(marks[i], x, y + 4);
  }
  ctx.beginPath();
  ctx.moveTo(cx, cy - radius - 2);
  ctx.lineTo(cx - 5, cy - radius + 8);
  ctx.lineTo(cx + 5, cy - radius + 8);
  ctx.closePath();
  ctx.fillStyle = colours.ink;
  ctx.fill();
  ctx.textAlign = 'left';
}

// The ship, in plan, with every section coloured by what is left of it. This is
// the always-on version of the Z board: no priorities, no numbers, just where
// the ship is hurt.
function drawSchematic(ctx, box, carrier, colours) {
  const sections = carrier.sections ?? [];
  for (let i = 0; i < SCHEMATIC.length; i++) {
    const cell = SCHEMATIC[i];
    const section = sections.find((s) => s.id === i);
    const permil = section === undefined || section.maxHp <= 0
      ? 1000
      : Math.round((section.hp * 1000) / section.maxHp);
    ctx.fillStyle = permil <= 0
      ? colours.dead
      : (permil < 350 ? colours.bad : (permil < 800 ? colours.warn : colours.good));
    ctx.fillRect(
      box.x + cell.x * box.w,
      box.y + cell.y * box.h,
      cell.w * box.w,
      cell.h * box.h,
    );
    ctx.strokeStyle = colours.panel;
    ctx.lineWidth = 1;
    ctx.strokeRect(
      box.x + cell.x * box.w,
      box.y + cell.y * box.h,
      cell.w * box.w,
      cell.h * box.h,
    );
  }
}

function permilOf(value, capacity) {
  if (capacity <= 0) return 0;
  return Math.round((value * 1000) / capacity);
}

function createInstruments(canvas) {
  return { canvas: canvas, ctx: canvas.getContext('2d'), elapsed: 0 };
}

// One frame of the whole panel. `readout` carries the few strings the panel
// shows as text - they are already translated; this module does no wording.
function drawInstruments(panel, view, own, readout, deltaSeconds, colours) {
  const canvas = panel.canvas;
  const width = window.innerWidth;
  if (canvas.width !== width || canvas.height !== PANEL_HEIGHT) {
    canvas.width = width;
    canvas.height = PANEL_HEIGHT;
  }
  panel.elapsed += deltaSeconds;
  const ctx = panel.ctx;
  ctx.clearRect(0, 0, width, PANEL_HEIGHT);
  if (own === undefined) return;

  const pad = 10;
  const helmW = 250;
  const scopeSize = PANEL_HEIGHT - pad * 2;
  const rightX = pad * 3 + helmW + scopeSize;
  const rightW = Math.max(220, width - rightX - pad);

  // Helm.
  bezel(ctx, pad, pad, helmW, PANEL_HEIGHT - pad * 2, colours, readout.helmTitle);
  drawCompass(ctx, { x: pad, y: pad, w: helmW * 0.52, h: PANEL_HEIGHT - pad * 2 }, own.heading, colours);
  const gaugeX = pad + helmW * 0.55;
  const gaugeW = helmW * 0.38;
  bar(ctx, gaugeX, pad + 48, gaugeW, 12, own.throttle * 10, colours, readout.throttle, `${own.throttle}%`);
  bar(ctx, gaugeX, pad + 88, gaugeW, 12,
    permilOf(own.speed, own.maxSpeed > 0 ? own.maxSpeed : 1), colours, readout.speed, readout.knots);
  bar(ctx, gaugeX, pad + 128, gaugeW, 12,
    permilOf(own.fuel, own.fuelCapacity), colours, readout.fuel, readout.fuelFigure);

  // Scope.
  const scopeX = pad * 2 + helmW;
  bezel(ctx, scopeX, pad, scopeSize, scopeSize, colours, readout.scopeTitle);
  drawRadar(ctx, view, own, { x: scopeX + 8, y: pad + 8, size: scopeSize - 16 },
    panel.elapsed, colours, readout.scopeRange);
  ctx.fillStyle = colours.dim;
  ctx.font = '10px ui-monospace, monospace';
  ctx.textAlign = 'right';
  ctx.fillText(readout.scopeLabel, scopeX + scopeSize - 10, pad + 18);
  ctx.textAlign = 'left';

  // Condition: the ship in plan on the left, what it is carrying on the right.
  // Two columns rather than one, because a schematic stretched to the width of
  // the screen stops looking like a ship and starts looking like a bar chart.
  bezel(ctx, rightX, pad, rightW, PANEL_HEIGHT - pad * 2, colours, readout.shipTitle);
  const shipW = Math.min(340, Math.round(rightW * 0.46));
  drawSchematic(ctx, { x: rightX + 16, y: pad + 34, w: shipW, h: 96 }, own, colours);
  ctx.fillStyle = colours.dim;
  ctx.font = '10px ui-monospace, monospace';
  ctx.fillText(readout.bow, rightX + 16 + shipW - 22, pad + 148);
  ctx.fillText(readout.stern, rightX + 16, pad + 148);

  const barX = rightX + shipW + 40;
  const barW = Math.max(120, rightW - shipW - 56);
  bar(ctx, barX, pad + 46, barW, 12, permilOf(own.hull, own.maxHull), colours,
    readout.hull, readout.hullFigure);
  bar(ctx, barX, pad + 86, barW, 12, permilOf(own.ordnance, own.ordnanceCapacity), colours,
    readout.ordnance, readout.ordnanceFigure);
  bar(ctx, barX, pad + 126, barW, 12, permilOf(own.materials, own.materialsCapacity), colours,
    readout.materials, readout.materialsFigure);
  ctx.fillStyle = colours.dim;
  ctx.font = '10px ui-monospace, monospace';
  ctx.fillText(readout.weapon, barX, pad + 162);
  ctx.textAlign = 'right';
  ctx.fillStyle = colours.ink;
  ctx.fillText(readout.tally, barX + barW, pad + 162);
  ctx.textAlign = 'left';
}

export { PANEL_HEIGHT, SCHEMATIC, createInstruments, drawInstruments, bezel, bar };
