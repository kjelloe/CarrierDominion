// client/panels/chart.js - the CHART: the original's map screen.
//
// A real chart at last (second source review, dev-questions §30): every 1988
// screenshot of the map shows named islands on a pannable, zoomable plot with
// owner colours and a resource overlay - our BIRDSEYE is a 3D pull-back and
// the scope is a radar, and neither is a chart you can plan on. This one is:
// islands drawn with their names and roles, your carriers and the fog's
// contacts and ghosts, the depot starred, the course diamond, and the same
// click meanings as the world - a click on water is PROG, a click on an
// island is its board, drag pans, the wheel zooms.
//
// Everything drawn comes from the fog-filtered VIEW. The chart can never
// know more than the seat does.

import { islandName } from '../../shared/names.js';

const ROLE_LETTERS = ['R', 'F', 'D'];

function createChartPanel(ctx) {
  const panel = {
    ctx: ctx,
    open: false,
    canvas: document.getElementById('chart-canvas'),
    // World units per canvas pixel, and the world point under the centre.
    scale: 0,
    centreX: 0,
    centreY: 0,
    network: false,
    // PROG (ruled 2026-08-25): while it is lit, a tap on the chart is a LEG
    // of a course being laid rather than an order to sail there now. LAY
    // sends it; CLEAR throws it away.
    prog: false,
    legs: [],
    dragging: false,
    moved: false,
    lastX: 0,
    lastY: 0,
  };
  panel.draw2d = panel.canvas.getContext('2d');
  bindChartInput(panel);
  return panel;
}

function fitChart(panel, view) {
  const size = view.params.sizeUnits;
  const span = Math.min(window.innerWidth, window.innerHeight - 210);
  panel.scale = size / Math.max(1, span - 60);
  panel.centreX = Math.floor(size / 2);
  panel.centreY = Math.floor(size / 2);
}

// Whose course the chart is drawing: the selected hull's if it has one,
// otherwise the ship's.
function routeOf(panel, view) {
  const subject = panel.ctx.routeSubject === undefined ? undefined : panel.ctx.routeSubject();
  if (subject !== undefined && subject.route !== undefined && subject.route.length > 0) {
    return subject.route;
  }
  const own = view.carriers.find((c) => c.team === view.team && c.contact === 0);
  return own === undefined || own.route === undefined ? [] : own.route;
}

// Numbered marks joined by a line, which is what a course looks like on
// paper and looked like in 1988. Legs still being laid are dashed.
function drawRoute(panel, draw, colours, legs, pending) {
  if (legs === undefined || legs.length === 0) return;
  draw.save();
  draw.strokeStyle = colours.self;
  draw.fillStyle = colours.self;
  draw.lineWidth = 1;
  if (pending) draw.setLineDash([4, 4]);
  draw.beginPath();
  let n = 0;
  for (const leg of legs) {
    const at = plot(panel, leg.x, leg.y);
    if (n === 0) draw.moveTo(at.x, at.y);
    else draw.lineTo(at.x, at.y);
    n = n + 1;
  }
  draw.stroke();
  draw.setLineDash([]);
  n = 0;
  draw.font = '10px monospace';
  for (const leg of legs) {
    n = n + 1;
    const at = plot(panel, leg.x, leg.y);
    draw.strokeRect(at.x - 3, at.y - 3, 6, 6);
    draw.fillText(String(n), at.x + 6, at.y - 4);
  }
  draw.restore();
}

function toggleChart(panel, view) {
  panel.open = !panel.open;
  document.getElementById('chart-panel').classList.toggle('open', panel.open);
  if (panel.open && panel.scale === 0 && view !== undefined) fitChart(panel, view);
}

function worldAt(panel, pixelX, pixelY) {
  return {
    x: Math.round(panel.centreX + (pixelX - panel.canvas.width / 2) * panel.scale),
    y: Math.round(panel.centreY - (pixelY - panel.canvas.height / 2) * panel.scale),
  };
}

function plot(panel, x, y) {
  return {
    x: panel.canvas.width / 2 + (x - panel.centreX) / panel.scale,
    y: panel.canvas.height / 2 - (y - panel.centreY) / panel.scale,
  };
}

function bindChartInput(panel) {
  const canvas = panel.canvas;
  canvas.addEventListener('pointerdown', (event) => {
    panel.dragging = true;
    panel.moved = false;
    panel.lastX = event.clientX;
    panel.lastY = event.clientY;
  });
  window.addEventListener('pointermove', (event) => {
    if (!panel.dragging) return;
    const dx = event.clientX - panel.lastX;
    const dy = event.clientY - panel.lastY;
    if (Math.abs(dx) + Math.abs(dy) > 3) panel.moved = true;
    if (panel.moved) {
      panel.centreX -= Math.round(dx * panel.scale);
      panel.centreY += Math.round(dy * panel.scale);
      panel.lastX = event.clientX;
      panel.lastY = event.clientY;
    }
  });
  window.addEventListener('pointerup', (event) => {
    if (!panel.dragging) return;
    panel.dragging = false;
    if (panel.moved) return;
    // A tap, not a drag: the same click the world takes - unless PROG is
    // lit (the 1988 map's own button), in which case the tap is a leg of a
    // course rather than an order to go there now.
    const rect = canvas.getBoundingClientRect();
    const point = worldAt(panel, event.clientX - rect.left, event.clientY - rect.top);
    if (panel.prog) {
      if (panel.legs.length < 8) panel.legs.push(point);
      return;
    }
    panel.ctx.onPoint(point);
  });
  canvas.addEventListener('wheel', (event) => {
    event.preventDefault();
    const factor = event.deltaY > 0 ? 1.25 : 0.8;
    panel.scale = Math.max(6, Math.min(panel.scale * factor, 40000));
  }, { passive: false });
}

function drawTriangle(draw, x, y, size, headingRadians, colour, hollow) {
  draw.save();
  draw.translate(x, y);
  draw.rotate(-headingRadians + Math.PI / 2);
  draw.beginPath();
  draw.moveTo(0, -size);
  draw.lineTo(-size * 0.7, size);
  draw.lineTo(size * 0.7, size);
  draw.closePath();
  if (hollow) {
    draw.strokeStyle = colour;
    draw.lineWidth = 1.5;
    draw.stroke();
  } else {
    draw.fillStyle = colour;
    draw.fill();
  }
  draw.restore();
}

function renderChart(panel, view, teamColour) {
  if (!panel.open || view === undefined) return;
  const canvas = panel.canvas;
  if (canvas.width !== window.innerWidth || canvas.height !== window.innerHeight - 196) {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight - 196;
  }
  const draw = panel.draw2d;
  const colours = panel.ctx.colours();
  draw.fillStyle = colours.scope;
  draw.fillRect(0, 0, canvas.width, canvas.height);

  const size = view.params.sizeUnits;
  const edgeA = plot(panel, 0, size);
  const edgeB = plot(panel, size, 0);
  draw.strokeStyle = colours.grid;
  draw.lineWidth = 1;
  draw.strokeRect(edgeA.x, edgeA.y, edgeB.x - edgeA.x, edgeB.y - edgeA.y);

  // The resource overlay: the real LINK GRAPH (proposal 3b) - every pair of
  // your islands close enough to link, drawn solid, plus the cut-off ones
  // marked so a broken chain is visible rather than deduced. With topology
  // off the reach is 0 and the overlay falls back to the star.
  const depotId = view.stockpileIsland;
  const depot = view.islands.find((island) => island.id === depotId);
  if (panel.network) {
    const reach = view.params.networkLink ?? 0;
    const mine = view.islands.filter((island) => island.owner === view.team);
    draw.lineWidth = 1;
    if (reach > 0) {
      draw.strokeStyle = colours.good;
      for (let a = 0; a < mine.length; a++) {
        for (let b = a + 1; b < mine.length; b++) {
          const dx = mine[a].x - mine[b].x;
          const dy = mine[a].y - mine[b].y;
          if (dx * dx + dy * dy > reach * reach) continue;
          const from = plot(panel, mine[a].x, mine[a].y);
          const to = plot(panel, mine[b].x, mine[b].y);
          draw.beginPath();
          draw.moveTo(from.x, from.y);
          draw.lineTo(to.x, to.y);
          draw.stroke();
        }
      }
      // A cut-off island wears a ring in the warning colour: it keeps what
      // it makes and its Command Centre has stopped.
      draw.strokeStyle = colours.bad;
      for (const island of mine) {
        if (island.networkHops >= 0) continue;
        const at = plot(panel, island.x, island.y);
        const radius = Math.max(5, island.radius / panel.scale) + 4;
        draw.beginPath();
        draw.arc(at.x, at.y, radius, 0, Math.PI * 2);
        draw.stroke();
      }
    } else if (depot !== undefined) {
      draw.strokeStyle = colours.good;
      draw.setLineDash([4, 4]);
      for (const island of mine) {
        if (island.id === depotId) continue;
        const from = plot(panel, island.x, island.y);
        const to = plot(panel, depot.x, depot.y);
        draw.beginPath();
        draw.moveTo(from.x, from.y);
        draw.lineTo(to.x, to.y);
        draw.stroke();
      }
      draw.setLineDash([]);
    }
  }

  for (const island of view.islands) {
    const at = plot(panel, island.x, island.y);
    const radius = Math.max(3, island.radius / panel.scale);
    draw.beginPath();
    draw.arc(at.x, at.y, radius, 0, Math.PI * 2);
    draw.fillStyle = island.owner === view.team
      ? colours.own
      : (island.owner === -1 ? colours.dim : colours.enemy);
    draw.globalAlpha = 0.35;
    draw.fill();
    draw.globalAlpha = 1;
    draw.strokeStyle = draw.fillStyle;
    draw.lineWidth = island.id === depotId ? 2.5 : 1;
    draw.stroke();

    draw.fillStyle = colours.ink;
    draw.font = '11px ui-monospace, monospace';
    draw.textAlign = 'center';
    draw.fillText(islandName(island), at.x, at.y - radius - 5);
    // An island with guns on it wears a spur: the chart should not let a
    // Walrus wander onto a defended beach unwarned.
    const armed = (view.turrets ?? []).some((turret) => turret.island === island.id);
    if (armed) {
      draw.strokeStyle = colours.warn;
      draw.lineWidth = 1.5;
      draw.beginPath();
      draw.moveTo(at.x + radius * 0.7, at.y - radius * 0.7);
      draw.lineTo(at.x + radius * 1.5, at.y - radius * 1.5);
      draw.stroke();
    }
    const glyphs = [];
    if (island.role >= 0) glyphs.push(ROLE_LETTERS[island.role]);
    if (island.runway === 1) glyphs.push('=');
    if (island.id === depotId) glyphs.push('*');
    if (glyphs.length > 0) {
      draw.fillStyle = colours.dim;
      draw.fillText(glyphs.join(' '), at.x, at.y + 4);
    }
    draw.textAlign = 'left';
  }

  // Hulls: own solid, contacts hollow, ghosts faded - the scope's grammar.
  for (const carrier of view.carriers) {
    const at = plot(panel, carrier.x, carrier.y);
    const heading = (carrier.heading / 65536) * Math.PI * 2;
    drawTriangle(draw, at.x, at.y, 7,
      heading, carrier.contact === 1 ? colours.enemy : teamColour, carrier.contact === 1);
  }
  for (const ghost of view.ghosts ?? []) {
    const at = plot(panel, ghost.x, ghost.y);
    draw.globalAlpha = 0.5;
    draw.strokeStyle = colours.enemy;
    draw.lineWidth = 1.5;
    draw.beginPath();
    draw.moveTo(at.x - 4, at.y - 4);
    draw.lineTo(at.x + 4, at.y + 4);
    draw.moveTo(at.x + 4, at.y - 4);
    draw.lineTo(at.x - 4, at.y + 4);
    draw.stroke();
    draw.globalAlpha = 1;
  }
  for (const unit of view.units) {
    if (unit.state !== 1 && unit.state !== 2 && unit.state !== 4) continue;
    const at = plot(panel, unit.x, unit.y);
    draw.fillStyle = unit.contact === 1 ? colours.enemy : colours.self;
    draw.fillRect(at.x - 2, at.y - 2, 4, 4);
  }

  // A course of more than one leg, drawn and numbered as the original drew
  // it: the laid route in full, then the legs being programmed now.
  drawRoute(panel, draw, colours, routeOf(panel, view), false);
  drawRoute(panel, draw, colours, panel.legs, true);

  // The course diamond, exactly the scope's.
  const own = view.carriers.find((c) => c.team === view.team && c.contact === 0);
  if (own !== undefined && own.courseX >= 0) {
    const at = plot(panel, own.courseX, own.courseY);
    draw.strokeStyle = colours.self;
    draw.lineWidth = 1.5;
    draw.beginPath();
    draw.moveTo(at.x, at.y - 6);
    draw.lineTo(at.x + 6, at.y);
    draw.lineTo(at.x, at.y + 6);
    draw.lineTo(at.x - 6, at.y);
    draw.closePath();
    draw.stroke();
  }
}

export { createChartPanel, toggleChart, renderChart, fitChart };
