// engine/route.js - a course with more than one leg.
//
// The 1988 map had PROG and CLEAR and dropped NUMBERED waypoints, per craft
// and for the ship (ruled 2026-08-25). Ours had one leg: click a spot, go
// there, stop. That is enough to move something and not enough to PLAN -
// you could not send a Walrus round the back of an island, or route a Manta
// clear of a battery on the way to its target.
//
// A route is a flat list of points on the record and an index into it. The
// movement code is untouched: it still steers at targetX/targetY, and this
// file is only what happens when the hull gets there.
//
// Eight legs. Enough to go round an island and come back; small enough that
// the state stays a state and not a filing cabinet.

const ROUTE_MAX = 8;

function clearRoute(holder) {
  holder.route = [];
  holder.routeAt = 0;
}

// Lay a course. The points arrive flat - x0, y0, x1, y1 - because a command
// is integers and nothing else, and they are stored as pairs because
// everything that reads them wants pairs.
function setRoute(holder, flat) {
  const route = [];
  for (let i = 0; i + 1 < flat.length && route.length < ROUTE_MAX; i = i + 2) {
    route.push({ x: flat[i], y: flat[i + 1] });
  }
  holder.route = route;
  holder.routeAt = 0;
  return route.length;
}

// The leg being steered now, or -1 when the route is run out.
function legOf(holder) {
  if (holder.route.length === 0) return -1;
  if (holder.routeAt >= holder.route.length) return -1;
  return holder.route[holder.routeAt];
}

// Reached the current mark: take the next one. Returns 1 if there IS a next
// one - the caller keeps going - and 0 when the route is finished, which is
// the point at which arriving means arrived.
function advanceRoute(holder) {
  if (holder.route.length === 0) return 0;
  holder.routeAt = holder.routeAt + 1;
  if (holder.routeAt < holder.route.length) return 1;
  clearRoute(holder);
  return 0;
}

function copyRoute(route) {
  const out = [];
  for (let i = 0; i < route.length; i++) out.push({ x: route[i].x, y: route[i].y });
  return out;
}

export { ROUTE_MAX, advanceRoute, clearRoute, copyRoute, legOf, setRoute };
