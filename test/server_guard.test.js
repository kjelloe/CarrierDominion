import test from 'node:test';
import assert from 'node:assert/strict';

import {
  RATE_MAX,
  RATE_WINDOW_MS,
  clientAddress,
  createMeter,
  originAllowed,
  overLimit,
} from '../server/guard.js';

test('a commander\'s pace passes the meter, a script\'s does not', () => {
  const meter = createMeter(0);
  for (let i = 0; i < RATE_MAX; i++) assert.equal(overLimit(meter, i), 0);
  assert.equal(overLimit(meter, RATE_MAX), 1, 'one past the limit inside the window was let through');
});

test('the window starts again, so a busy minute is not a sentence', () => {
  const meter = createMeter(0);
  for (let i = 0; i < RATE_MAX; i++) overLimit(meter, 0);
  assert.equal(overLimit(meter, RATE_WINDOW_MS), 0);
});

test('a native client sends no origin and is let in; the page\'s own host is too', () => {
  assert.equal(originAllowed(undefined, 'carrier.example:8135'), true);
  assert.equal(originAllowed('http://carrier.example:8135', 'carrier.example:8135'), true);
  // Behind the TLS proxy the page is https and the upgrade arrives as http.
  assert.equal(originAllowed('https://carrierdominion.example', 'carrierdominion.example'), true);
  assert.equal(originAllowed('http://LOCALHOST:8135', 'localhost:8135'), true);
});

test('another website, a mangled origin, or a missing Host is refused', () => {
  assert.equal(originAllowed('https://evil.example', 'carrier.example'), false);
  assert.equal(originAllowed('http://carrier.example:9000', 'carrier.example:8135'), false);
  assert.equal(originAllowed('null', 'carrier.example'), false);
  assert.equal(originAllowed('http://carrier.example', undefined), false);
});

test('the proxy\'s real address is believed from loopback and only from loopback', () => {
  const proxied = { socket: { remoteAddress: '127.0.0.1' }, headers: { 'x-real-ip': '203.0.113.7' } };
  assert.equal(clientAddress(proxied), '203.0.113.7');
  const forged = { socket: { remoteAddress: '192.168.1.20' }, headers: { 'x-real-ip': '203.0.113.7' } };
  assert.equal(clientAddress(forged), '192.168.1.20', 'a LAN client picked its own ban address');
  const local = { socket: { remoteAddress: '::1' }, headers: {} };
  assert.equal(clientAddress(local), '::1');
});
