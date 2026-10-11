// server/guard.js - what a socket may cost the server, before the war sees it.
//
// The baseline the Unity port asked every server in the family for (requests
// C3-C6 in ../unityworks/specs/server_change_requests.md), and what boombrawl
// already had: a frame size cap, a message rate cap, a heartbeat that notices a
// dead peer, and an origin check at the upgrade. None of it is the doorman's
// business - that decides WHO may sit down; this decides how much any socket,
// seated or not, may ask of the process.
//
// Pure apart from the constants: the clock is passed in, so the policy is
// tested without a network. Server timing constants live here, not in data/,
// for the same reason as GRACE_MS and BAN_MS: data/ is the simulation's.

// The largest real client message is an eight-point course or a 160-character
// chat line, both well under 1 KB even fully escaped. ws defaults to 100 MiB.
const MAX_PAYLOAD = 4096;

// Every command is a key press or a click (held keys do not repeat; see
// bindInput in client/main.js), so twenty a second for ten seconds is a script,
// not a commander. Boombrawl uses the same windowed count.
const RATE_WINDOW_MS = 10000;
const RATE_MAX = 200;

// A realistic interval: a phone radio waking from power save stalls longer
// than an aggressive one tolerates. Two missed beats, at most a minute, and
// the socket is dropped and its seat held for the grace window like any drop.
const HEARTBEAT_MS = 30000;

function createMeter(nowMs) {
  return { windowStartMs: nowMs, count: 0, flooded: 0 };
}

// Count one message. 1 when this one is over the limit, else 0.
function overLimit(meter, nowMs) {
  if (nowMs - meter.windowStartMs >= RATE_WINDOW_MS) {
    meter.windowStartMs = nowMs;
    meter.count = 0;
  }
  meter.count += 1;
  return meter.count > RATE_MAX ? 1 : 0;
}

// A browser always sends Origin, and a page served by this process sends this
// process's own host. A native client (Unity, a test, curl) sends none, and is
// let through: the check exists to stop another WEBSITE from driving a
// visitor's browser into the war, which needs an Origin to happen at all.
//
// Compared by host:port only. Behind the TLS proxy the page is https and the
// upgrade arrives here as plain http, so the schemes never match; the proxy
// passes Host through (DEPLOYING.md).
function originAllowed(origin, host) {
  if (origin === undefined) return true;
  if (typeof host !== 'string' || host === '') return false;
  try {
    return new URL(origin).host === host.toLowerCase();
  } catch (error) {
    return false;
  }
}

function isLoopback(address) {
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
}

// Who is really on the other end. Behind the proxy every socket arrives from
// loopback, so a ban keyed on remoteAddress banned EVERYBODY for a minute. The
// proxy's X-Real-IP is believed only from loopback: anyone else could simply
// send the header and pick the address their ban lands on.
function clientAddress(req) {
  const remote = req.socket === undefined ? '' : (req.socket.remoteAddress ?? '');
  if (!isLoopback(remote)) return remote;
  const real = req.headers['x-real-ip'];
  if (typeof real === 'string' && real.trim() !== '') return real.trim();
  return remote;
}

export {
  MAX_PAYLOAD,
  RATE_WINDOW_MS,
  RATE_MAX,
  HEARTBEAT_MS,
  createMeter,
  overLimit,
  originAllowed,
  clientAddress,
};
