import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { createApp, ROOT } from '../server/app.js';
import { loadRules } from '../server/rules.js';
import { nativeListing, nativeSource } from '../server/native.js';
import { describeSize, nativeLinks } from '../client/native.js';

const rules = loadRules();

function folderWith(files) {
  const dir = mkdtempSync(join(tmpdir(), 'cd-native-'));
  for (const [name, bytes] of Object.entries(files)) writeFileSync(join(dir, name), Buffer.alloc(bytes, 7));
  return dir;
}

async function withNative(setting, run) {
  const app = createApp({ seed: 20260818, rules: rules, nativeDownloads: setting });
  const address = await app.listen(0, '127.0.0.1');
  try {
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await app.close();
  }
}

test('the setting can be a folder, a file URL, a web address, or nothing', () => {
  assert.deepEqual(nativeSource(undefined, ROOT), { kind: 'none' });
  assert.deepEqual(nativeSource('  ', ROOT), { kind: 'none' });
  assert.deepEqual(nativeSource('/srv/builds', ROOT), { kind: 'folder', dir: '/srv/builds' });
  assert.deepEqual(nativeSource('dist', ROOT), { kind: 'folder', dir: join(ROOT, 'dist') });
  assert.deepEqual(nativeSource('file:///srv/builds', ROOT), { kind: 'folder', dir: '/srv/builds' });
  assert.deepEqual(nativeSource('http://192.168.1.5:9000/cd/', ROOT),
    { kind: 'url', url: 'http://192.168.1.5:9000/cd/' });
  assert.deepEqual(nativeSource('https://example.com/releases', ROOT),
    { kind: 'url', url: 'https://example.com/releases' });
});

test('a shared dist folder offers only this game\'s builds, newest first', async () => {
  const dir = folderWith({
    'CarrierDominion-20261011-abc-win64.zip': 2048,
    'CarrierDominion-20261011-abc-linux64.zip': 1024,
    'boombrawl-20261011-def-win64.zip': 512,
    '.CarrierDominion-partial.zip': 10,
    'notes.txt': 5,
  });
  mkdirSync(join(dir, 'CarrierDominion-old'));
  try {
    const listing = await nativeListing({ kind: 'folder', dir: dir });
    assert.equal(listing.kind, 'folder');
    assert.deepEqual(listing.files.map((f) => f.name).sort(), [
      'CarrierDominion-20261011-abc-linux64.zip',
      'CarrierDominion-20261011-abc-win64.zip',
    ]);
    const win = listing.files.find((f) => f.name.endsWith('win64.zip'));
    assert.equal(win.size, 2048);
    assert.equal(win.url, '/native/CarrierDominion-20261011-abc-win64.zip');
  } finally {
    rmSync(dir, { recursive: true });
  }
});

test('a missing folder, or one with nothing for this game, is no link at all', async () => {
  assert.deepEqual(await nativeListing({ kind: 'folder', dir: '/nonexistent/cd-native' }), { kind: 'none' });
  const dir = folderWith({ 'boombrawl-1-win64.zip': 4 });
  try {
    assert.deepEqual(await nativeListing({ kind: 'folder', dir: dir }), { kind: 'none' });
  } finally {
    rmSync(dir, { recursive: true });
  }
});

test('the page is told what to show, and the file comes down whole', async () => {
  const dir = folderWith({ 'CarrierDominion-1-linux64.zip': 3000 });
  try {
    await withNative(pathToFileURL(dir).href, async (base) => {
      const listing = await (await fetch(`${base}/native.json`)).json();
      assert.equal(listing.kind, 'folder');
      assert.equal(listing.files.length, 1);

      const response = await fetch(`${base}${listing.files[0].url}`);
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('content-type'), 'application/zip');
      assert.match(response.headers.get('content-disposition'), /attachment; filename="CarrierDominion-1-linux64.zip"/);
      const body = Buffer.from(await response.arrayBuffer());
      assert.equal(body.length, 3000);

      const head = await fetch(`${base}${listing.files[0].url}`, { method: 'HEAD' });
      assert.equal(head.headers.get('content-length'), '3000');
    });
  } finally {
    rmSync(dir, { recursive: true });
  }
});

test('nothing outside the offered files can be fetched through /native/', async () => {
  const dir = folderWith({ 'CarrierDominion-1-win64.zip': 8, 'boombrawl-1-win64.zip': 8, '.secret': 8 });
  try {
    await withNative(dir, async (base) => {
      for (const path of [
        '/native/boombrawl-1-win64.zip',
        '/native/.secret',
        '/native/..%2Fpackage.json',
        '/native/%2E%2E/package.json',
        '/native/',
        '/native/CarrierDominion-2-win64.zip',
      ]) {
        const response = await fetch(`${base}${path}`);
        assert.equal(response.status, 404, `${path} answered ${response.status}`);
      }
      const post = await fetch(`${base}/native.json`, { method: 'POST' });
      assert.equal(post.status, 405);
    });
  } finally {
    rmSync(dir, { recursive: true });
  }
});

test('with nothing configured the page gets no link and /native/ is not there', async () => {
  await withNative('', async (base) => {
    assert.deepEqual(await (await fetch(`${base}/native.json`)).json(), { kind: 'none' });
    assert.equal((await fetch(`${base}/native/CarrierDominion-1-win64.zip`)).status, 404);
  });
});

test('a web address is linked as it is, and nothing is served locally', async () => {
  await withNative('https://example.com/cd/', async (base) => {
    assert.deepEqual(await (await fetch(`${base}/native.json`)).json(),
      { kind: 'url', url: 'https://example.com/cd/' });
  });
});

test('the page line names each build with its size, or one link to the page', () => {
  const t = (key) => key;
  assert.deepEqual(nativeLinks({ kind: 'none' }, t), []);
  assert.deepEqual(nativeLinks(null, t), []);
  assert.deepEqual(nativeLinks({ kind: 'url', url: 'https://x/' }, t), [{ label: 'start.nativeLink', href: 'https://x/' }]);
  assert.deepEqual(
    nativeLinks({ kind: 'folder', files: [{ name: 'CarrierDominion-1-win64.zip', size: 88 * 1048576, url: '/native/a' }] }, t),
    [{ label: 'CarrierDominion-1-win64.zip (88 MB)', href: '/native/a' }],
  );
  assert.equal(describeSize(1536 * 1024), '1.5 MB');
  assert.equal(describeSize(1000), '0.1 MB');
});
