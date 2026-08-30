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
// Read back from the stylesheet rather than repeated here: the panel is
// shorter on a landscape phone, where 196px of a 390px window left the sea
// with less room than the instruments (mobile pass, 2026-08-30). One number,
// declared in CSS as `--panel-h`, so the canvas is always exactly as tall as
// the box it is drawn into.
const PANEL_FALLBACK = 196;

function panelHeight() {
  if (typeof window === 'undefined') return PANEL_FALLBACK;
  const raw = window.getComputedStyle(document.documentElement)
    .getPropertyValue('--panel-h');
  const value = Number(String(raw).replace('px', '').trim());
  return Number.isFinite(value) && value > 40 ? value : PANEL_FALLBACK;
}

// The helm's clickable geometry, shared between the drawing below and the
// hit-test the client uses - one table, so the paint and the click can never
// disagree. The 1988 original was mouse-first ("click directly on speed scale
// to set target speed" - the operations manual), and this is that: the
// throttle bar IS the speed scale, and the rudder arrows hold like the keys
// and CENTRE UP on release.
// The helm's geometry at the FULL panel height, and a scaled copy for any
// other. On a landscape phone the panel is 124px rather than 196, and these
// vertical offsets are what put the fuel bar and the rudder buttons below the
// bottom edge - drawn but unreachable, which for a rudder is worse than
// missing (mobile pass, 2026-08-30).
//
// Everything vertical scales; nothing horizontal does, because the panel is
// always as wide as the window. The hit test reads the SAME scaled table as
// the paint, so a shrunken helm still answers the finger where it looks.
const HELM_FULL = {
  pad: 10,
  width: 250,
  gaugeX: 10 + 250 * 0.55,
  gaugeW: 250 * 0.38,
  throttleY: 58,
  throttleH: 12,
  speedY: 88,
  fuelY: 128,
  rudderY: 156,
  rudderW: 34,
  rudderH: 24,
};

// How much shorter this panel is than the one the layout was designed for.
// Everything with a fixed vertical offset multiplies by this; horizontal
// positions do not, because the panel is always the width of the window.
function panelScale(panelH) {
  return Math.min(1, panelH / PANEL_FALLBACK);
}

function helmLayout(panelH) {
  const scale = panelH / PANEL_FALLBACK;
  if (scale >= 0.999) return HELM_FULL;
  return {
    pad: Math.max(4, Math.round(HELM_FULL.pad * scale)),
    width: HELM_FULL.width,
    gaugeX: HELM_FULL.gaugeX,
    gaugeW: HELM_FULL.gaugeW,
    throttleY: Math.round(HELM_FULL.throttleY * scale),
    throttleH: Math.max(8, Math.round(HELM_FULL.throttleH * scale)),
    speedY: Math.round(HELM_FULL.speedY * scale),
    fuelY: Math.round(HELM_FULL.fuelY * scale),
    rudderY: Math.round(HELM_FULL.rudderY * scale),
    rudderW: HELM_FULL.rudderW,
    rudderH: Math.max(18, Math.round(HELM_FULL.rudderH * scale)),
  };
}

// Kept for anything that wants the nominal table.
const HELM = HELM_FULL;

// What a click at panel coordinates (x, y) means: a throttle setting, a held
// rudder, or nothing. Slack rows above and below the bar make the scale easy
// to hit without stealing the rest of the helm.
function helmHitAt(x, y) {
  const HELM = helmLayout(panelHeight());
  if (x >= HELM.gaugeX - 4 && x <= HELM.gaugeX + HELM.gaugeW + 4
    && y >= HELM.throttleY - 10 && y <= HELM.throttleY + HELM.throttleH + 8) {
    // The scale runs -25..100: the leftmost fifth is the astern gear (the
    // original's bottom quarter of the speed indicator). A craft's helm
    // clamps the astern zone away in the client - a Manta has no reverse.
    const fraction = Math.max(0, Math.min(1, (x - HELM.gaugeX) / HELM.gaugeW));
    return { kind: 'throttle', throttle: Math.round((fraction * 125 - 25) / 5) * 5 };
  }
  if (y >= HELM.rudderY && y <= HELM.rudderY + HELM.rudderH) {
    if (x >= HELM.gaugeX && x <= HELM.gaugeX + HELM.rudderW) {
      return { kind: 'rudder', rudder: 1 }; // port, like A
    }
    if (x >= HELM.gaugeX + HELM.gaugeW - HELM.rudderW && x <= HELM.gaugeX + HELM.gaugeW) {
      return { kind: 'rudder', rudder: -1 }; // starboard, like D
    }
  }
  return -1;
}

// The rudder buttons: two arrows that act while held, like the keys they
// mirror. `active` is the current rudder so the pressed side reads pressed.
// No label: two arrows either side of the helm explain themselves.
function drawRudderButtons(ctx, colours, active) {
  // The scaled table, like everything else on the helm: at 124px the nominal
  // rudder row sits 32 pixels below the bottom edge.
  const HELM = helmLayout(panelHeight());
  const y = HELM.rudderY;
  for (const side of [1, -1]) {
    const x = side === 1 ? HELM.gaugeX : HELM.gaugeX + HELM.gaugeW - HELM.rudderW;
    const pressed = active === side;
    ctx.fillStyle = pressed ? colours.good : colours.panel;
    ctx.fillRect(x, y, HELM.rudderW, HELM.rudderH);
    ctx.strokeStyle = colours.bezel;
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, HELM.rudderW - 1, HELM.rudderH - 1);
    ctx.fillStyle = pressed ? colours.panel : colours.ink;
    ctx.font = '14px ui-monospace, monospace';
    ctx.textAlign = 'center';
    ctx.fillText(side === 1 ? '\u25C0' : '\u25B6', x + HELM.rudderW / 2, y + 17);
    ctx.textAlign = 'left';
  }
}

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

// The ship's throttle scale, -25..100: a dim astern zone on the left fifth,
// a zero notch, ahead filling right and astern filling LEFT from the notch -
// so which way the engines push is readable before any number is.
function drawThrottleScale(ctx, x, y, w, h, throttle, colours, label) {
  const zeroX = x + Math.round(w * 0.2);
  ctx.fillStyle = colours.grid;
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = colours.dead;
  ctx.fillRect(x, y, zeroX - x, h);
  if (throttle > 0) {
    ctx.fillStyle = throttle > 50 ? colours.good : colours.warn;
    ctx.fillRect(zeroX, y, Math.round(((w - (zeroX - x)) * throttle) / 100), h);
  } else if (throttle < 0) {
    ctx.fillStyle = colours.bad;
    const back = Math.round(((zeroX - x) * -throttle) / 25);
    ctx.fillRect(zeroX - back, y, back, h);
  }
  ctx.fillStyle = colours.ink;
  ctx.fillRect(zeroX, y - 2, 1, h + 4);
  ctx.strokeStyle = colours.bezel;
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  ctx.fillStyle = colours.dim;
  ctx.font = '10px ui-monospace, monospace';
  ctx.fillText(label, x, y - 4);
  ctx.fillStyle = colours.ink;
  ctx.textAlign = 'right';
  ctx.fillText(`${throttle}%`, x + w, y - 4);
  ctx.textAlign = 'left';
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

// The gunnery console (docs/10 gap 5, built 2026-08-26): the original's
// turret screen showed WHERE THE GUN IS POINTING on a plan of the ship, and
// a TEMP gauge beside it, and said in words whether the mount and the weapon
// were still working. Ours had the heat in the engine and nothing on the
// glass - a player learned about overheating by the gun going quiet.
//
// The bearing is drawn ship-relative, as the original drew it: the hull
// points up the box, and the gun line swings around it.
function drawGunnery(ctx, box, own, aimBam, colours, readout) {
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  const radius = Math.min(box.w, box.h) / 2 - 14;

  // The ring the gun traverses in, and its cardinal ticks.
  ctx.strokeStyle = colours.dim;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, TAU);
  ctx.stroke();
  for (let i = 0; i < 4; i++) {
    const angle = (i * TAU) / 4 - TAU / 4;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(angle) * (radius - 4), cy + Math.sin(angle) * (radius - 4));
    ctx.lineTo(cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius);
    ctx.stroke();
  }

  // The hull in plan, bow up: a lozenge, small, so the gun line reads.
  ctx.fillStyle = colours.dim;
  ctx.beginPath();
  ctx.moveTo(cx, cy - radius * 0.55);
  ctx.lineTo(cx + radius * 0.22, cy - radius * 0.15);
  ctx.lineTo(cx + radius * 0.22, cy + radius * 0.5);
  ctx.lineTo(cx - radius * 0.22, cy + radius * 0.5);
  ctx.lineTo(cx - radius * 0.22, cy - radius * 0.15);
  ctx.closePath();
  ctx.fill();

  // And the gun. Screen angles run clockwise from up, engine BAM runs
  // counter-clockwise from +X, which is the conversion every other bearing
  // drawing in this file makes too.
  const angle = (aimBam / 65536) * TAU - TAU / 4;
  ctx.strokeStyle = own.overheated === 1 ? colours.bad : colours.ink;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(cx + Math.cos(angle) * (radius - 2), cy + Math.sin(angle) * (radius - 2));
  ctx.stroke();
  ctx.lineWidth = 1;

  ctx.fillStyle = colours.dim;
  ctx.font = '10px ui-monospace, monospace';
  ctx.textAlign = 'center';
  ctx.fillText(readout.bearing, cx, box.y + box.h - 8);
  ctx.textAlign = 'left';
}

// Clamped at the brim: the ordnance hold can sit ABOVE its delivery ceiling
// after stores are landed off a hull (they never left the ship), and a bar
// drawn at 108% runs out through the side of its own bezel.
function permilOf(value, capacity) {
  if (capacity <= 0) return 0;
  const permil = Math.round((value * 1000) / capacity);
  return permil > 1000 ? 1000 : permil;
}

function createInstruments(canvas) {
  return { canvas: canvas, ctx: canvas.getContext('2d'), elapsed: 0 };
}

// One frame of the whole panel. `readout` carries the few strings the panel
// shows as text - they are already translated; this module does no wording.
// Where the scope actually IS, published for anything that has to measure it.
//
// The weather probe was reading the scope by re-deriving its geometry from
// "pad 10, helm width 250" copied out of this file - which is the failure
// class the review skill names as "a probe that selects the UI by position":
// the next re-layout silently moves the sample window onto a different
// instrument and the check goes green measuring the wrong pixels (review
// R-008). Now the panel says where it drew the thing.
function publishScopeBox(box) {
  if (typeof window === 'undefined') return;
  window.__scopeBox = { x: box.x, y: box.y, size: box.size };
}

function drawInstruments(panel, view, own, readout, deltaSeconds, colours) {
  const canvas = panel.canvas;
  const width = window.innerWidth;
  const PANEL_HEIGHT = panelHeight();
  if (canvas.width !== width || canvas.height !== PANEL_HEIGHT) {
    canvas.width = width;
    canvas.height = PANEL_HEIGHT;
  }
  panel.elapsed += deltaSeconds;
  const ctx = panel.ctx;
  ctx.clearRect(0, 0, width, PANEL_HEIGHT);
  if (own === undefined) return;

  const HELM = helmLayout(PANEL_HEIGHT);
  const pad = HELM.pad;
  const helmW = HELM.width;
  const scopeSize = PANEL_HEIGHT - pad * 2;
  const rightX = pad * 3 + helmW + scopeSize;
  const rightW = Math.max(220, width - rightX - pad);

  // Helm.
  bezel(ctx, pad, pad, helmW, PANEL_HEIGHT - pad * 2, colours, readout.helmTitle);
  drawCompass(ctx, { x: pad, y: pad, w: helmW * 0.52, h: PANEL_HEIGHT - pad * 2 }, own.heading, colours);
  const gaugeX = HELM.gaugeX;
  const gaugeW = HELM.gaugeW;
  drawThrottleScale(ctx, gaugeX, HELM.throttleY, gaugeW, HELM.throttleH,
    own.throttle, colours, readout.throttle);
  const wayOn = own.speed < 0 ? -own.speed : own.speed;
  bar(ctx, gaugeX, HELM.speedY, gaugeW, HELM.throttleH,
    permilOf(wayOn, own.maxSpeed > 0 ? own.maxSpeed : 1), colours, readout.speed, readout.knots);
  bar(ctx, gaugeX, HELM.fuelY, gaugeW, HELM.throttleH,
    permilOf(own.fuel, own.fuelCapacity), colours, readout.fuel, readout.fuelFigure);
  drawRudderButtons(ctx, colours, own.rudder);

  // Scope.
  const scopeX = pad * 2 + helmW;
  bezel(ctx, scopeX, pad, scopeSize, scopeSize, colours, readout.scopeTitle);
  const scopeBoxOwn = { x: scopeX + 8, y: pad + 8, size: scopeSize - 16 };
  publishScopeBox(scopeBoxOwn);
  drawRadar(ctx, view, own, scopeBoxOwn, panel.elapsed, colours, readout.scopeRange);
  ctx.fillStyle = colours.dim;
  ctx.font = '10px ui-monospace, monospace';
  ctx.textAlign = 'right';
  ctx.fillText(readout.scopeLabel, scopeX + scopeSize - 10, pad + 18);
  ctx.textAlign = 'left';
  // Conditions, under the scope where both weather effects are felt: the
  // sea that is slowing the boats and the rain that is shortening this very
  // picture. A rule the player cannot see is a rule they experience as the
  // game cheating, so this line is part of the ruling, not decoration.
  if (readout.conditions !== undefined && readout.conditions !== '') {
    ctx.fillText(readout.conditions, scopeX + 10, pad + scopeSize - 8);
  }

  // At the GUN, the right box is the gunnery console instead: where the
  // mount is pointing, how hot it is, and whether it and the weapon still
  // work (docs/10 gap 5). Everywhere else it is the ship's condition.
  if (readout.gunnery === 1) {
    drawGunneryBox(ctx, { x: rightX, y: pad, w: rightW, h: PANEL_HEIGHT - pad * 2 },
      own, colours, readout);
    return;
  }

  // Condition: the ship in plan on the left, what it is carrying on the right.
  // Two columns rather than one, because a schematic stretched to the width of
  // the screen stops looking like a ship and starts looking like a bar chart.
  bezel(ctx, rightX, pad, rightW, PANEL_HEIGHT - pad * 2, colours, readout.shipTitle);
  const shipW = Math.min(340, Math.round(rightW * 0.46));
  // The ship in plan, scaled with the panel: at 124px a 96-pixel schematic
  // started 40 pixels down and ran off the bottom edge (mobile pass).
  const shrink = panelScale(PANEL_HEIGHT);
  drawSchematic(ctx, {
    x: rightX + 16,
    y: Math.round((pad + 34) * shrink),
    w: shipW,
    h: Math.round(96 * shrink),
  }, own, colours);
  ctx.fillStyle = colours.dim;
  ctx.font = '10px ui-monospace, monospace';
  ctx.fillText(readout.bow, rightX + 16 + shipW - 22, Math.round((pad + 148) * shrink));
  ctx.fillText(readout.stern, rightX + 16, Math.round((pad + 148) * shrink));

  // Four bars in two columns rather than four stacked: stacked, the fourth
  // pushed the weapon line out through the bottom of its own bezel.
  const barX = rightX + shipW + 40;
  const barW = Math.max(120, rightW - shipW - 56);
  const half = Math.floor((barW - 24) / 2);
  const rightCol = barX + half + 24;
  bar(ctx, barX, pad + 46, half, 12, permilOf(own.hull, own.maxHull), colours,
    readout.hull, readout.hullFigure);
  bar(ctx, rightCol, pad + 46, half, 12, permilOf(own.materials, own.materialsCapacity), colours,
    readout.materials, readout.materialsFigure);
  bar(ctx, barX, pad + 92, half, 12, permilOf(own.ordnance, own.ordnanceCapacity), colours,
    readout.ordnance, readout.ordnanceFigure);
  // The launchers: a bar that fills as they reload, because what you need to
  // know in the half second after a warning is whether you may fire yet.
  bar(ctx, rightCol, pad + 92, half, 12, readout.flaresPermil, colours,
    readout.flares, readout.flaresFigure);
  ctx.fillStyle = colours.dim;
  ctx.font = '10px ui-monospace, monospace';
  ctx.fillText(readout.weapon, barX, pad + 136);
  ctx.textAlign = 'right';
  ctx.fillStyle = colours.ink;
  ctx.fillText(readout.tally, barX + barW, pad + 136);
  ctx.textAlign = 'left';
}

// The right-hand box at the gun: the orientation diagram, the TEMP gauge,
// and the two lines of plain words the original put there - a mount that has
// been shot away says so, rather than simply never firing.
function drawGunneryBox(ctx, box, own, colours, readout) {
  bezel(ctx, box.x, box.y, box.w, box.h, colours, readout.gunTitle);
  const dialW = Math.min(150, Math.round(box.w * 0.34));
  drawGunnery(ctx, { x: box.x + 12, y: box.y + 26, w: dialW, h: box.h - 40 },
    own, readout.aimBam, colours, readout);

  const textX = box.x + dialW + 30;
  const barW = Math.max(110, box.w - dialW - 48);
  // TEMP, as the original labelled it. A weapon that does not heat has no
  // gauge rather than an empty one.
  if (own.heatMax > 0) {
    bar(ctx, textX, box.y + 44, barW, 12,
      permilOf(own.heat, own.heatMax), colours, readout.temp,
      own.overheated === 1 ? readout.overheated : readout.tempFigure);
  }
  bar(ctx, textX, box.y + 88, barW, 12, readout.flaresPermil, colours,
    readout.flares, readout.flaresFigure);

  ctx.font = '10px ui-monospace, monospace';
  ctx.fillStyle = own.overheated === 1 ? colours.bad : colours.ink;
  ctx.fillText(readout.weaponState, textX, box.y + 126);
  ctx.fillStyle = colours.ink;
  ctx.fillText(readout.mountState, textX, box.y + 142);
  ctx.fillStyle = colours.dim;
  ctx.textAlign = 'right';
  ctx.fillText(readout.tally, textX + barW, box.y + 126);
  ctx.textAlign = 'left';
}

// The panel while PILOTING (playtest ruling 2026-08-24): the instruments are
// the craft's, not the ship's. Same three-bezels layout and the same helm
// geometry - the throttle scale and rudder arrows drive the craft through
// the same hit-test - but the left box is FLIGHT or DRIVE, the scope centres
// on the hull you are flying, and the right box is that hull's condition:
// hull, altitude or magazine, the weapon, and the way home.
function drawFlightInstruments(panel, view, unit, readout, deltaSeconds, colours) {
  const canvas = panel.canvas;
  const width = window.innerWidth;
  const PANEL_HEIGHT = panelHeight();
  if (canvas.width !== width || canvas.height !== PANEL_HEIGHT) {
    canvas.width = width;
    canvas.height = PANEL_HEIGHT;
  }
  panel.elapsed += deltaSeconds;
  const ctx = panel.ctx;
  ctx.clearRect(0, 0, width, PANEL_HEIGHT);
  if (unit === undefined) return;

  const HELM = helmLayout(PANEL_HEIGHT);
  const pad = HELM.pad;
  const helmW = HELM.width;
  const scopeSize = PANEL_HEIGHT - pad * 2;
  const rightX = pad * 3 + helmW + scopeSize;
  const rightW = Math.max(220, width - rightX - pad);

  // The stick: compass, throttle, speed, fuel - the craft's own.
  bezel(ctx, pad, pad, helmW, PANEL_HEIGHT - pad * 2, colours, readout.helmTitle);
  drawCompass(ctx, { x: pad, y: pad, w: helmW * 0.52, h: PANEL_HEIGHT - pad * 2 }, unit.heading, colours);
  bar(ctx, HELM.gaugeX, HELM.throttleY, HELM.gaugeW, HELM.throttleH,
    unit.throttle * 10, colours, readout.throttle, `${unit.throttle}%`);
  bar(ctx, HELM.gaugeX, HELM.speedY, HELM.gaugeW, HELM.throttleH,
    permilOf(unit.speed, unit.maxSpeed > 0 ? unit.maxSpeed : 1), colours,
    readout.speed, readout.speedFigure);
  bar(ctx, HELM.gaugeX, HELM.fuelY, HELM.gaugeW, HELM.throttleH,
    permilOf(unit.fuel, unit.fuelCapacity), colours, readout.fuel, readout.fuelFigure);
  drawRudderButtons(ctx, colours, readout.rudderActive);

  // The scope, centred on the craft. Its picture is still the TEAM's fog -
  // there is no per-hull sensor model - but what you see is arranged around
  // where YOU are, which is what a cockpit scope is for.
  const scopeX = pad * 2 + helmW;
  bezel(ctx, scopeX, pad, scopeSize, scopeSize, colours, readout.scopeTitle);
  const scopeBoxUnit = { x: scopeX + 8, y: pad + 8, size: scopeSize - 16 };
  publishScopeBox(scopeBoxUnit);
  drawRadar(ctx, view, unit, scopeBoxUnit, panel.elapsed, colours, readout.scopeRange);
  ctx.fillStyle = colours.dim;
  ctx.font = '10px ui-monospace, monospace';
  ctx.textAlign = 'right';
  ctx.fillText(readout.scopeLabel, scopeX + scopeSize - 10, pad + 18);
  ctx.textAlign = 'left';
  // The same conditions line as the ship's scope: a pilot in a squall is
  // being told why the picture is short and why the boats are late.
  if (readout.conditions !== undefined && readout.conditions !== '') {
    ctx.fillText(readout.conditions, scopeX + 10, pad + scopeSize - 8);
  }

  // The craft: hull, altitude (a Manta) or the magazine (a Walrus), the
  // selected weapon with its tally, and the bearing home.
  bezel(ctx, rightX, pad, rightW, PANEL_HEIGHT - pad * 2, colours, readout.craftTitle);
  const barX = rightX + 20;
  const barW = Math.min(420, rightW - 40);
  const half = Math.floor((barW - 24) / 2);
  const rightCol = barX + half + 24;
  bar(ctx, barX, pad + 46, half, 12, permilOf(unit.hp, unit.maxHp), colours,
    readout.hull, readout.hullFigure);
  bar(ctx, rightCol, pad + 46, half, 12, readout.secondPermil, colours,
    readout.secondLabel, readout.secondFigure);
  ctx.fillStyle = colours.dim;
  ctx.font = '10px ui-monospace, monospace';
  ctx.fillText(readout.weapon, barX, pad + 100);
  ctx.fillStyle = colours.ink;
  ctx.font = '16px ui-monospace, monospace';
  ctx.fillText(readout.tally, barX, pad + 122);
  ctx.font = '10px ui-monospace, monospace';
  ctx.fillStyle = colours.dim;
  ctx.textAlign = 'right';
  ctx.fillText(readout.homeLabel, barX + barW, pad + 100);
  ctx.fillStyle = colours.ink;
  ctx.fillText(readout.homeFigure, barX + barW, pad + 118);
  ctx.textAlign = 'left';
}

export {
  panelHeight, SCHEMATIC, HELM, helmHitAt, createInstruments,
  drawInstruments, drawFlightInstruments, bezel, bar,
};
