// server/native.js - where the native (Unity) client can be downloaded from.
//
// Request C10 from the Unity port (the same as boombrawl's B4): the browser
// page links to the native builds, so a desktop player can fetch them from the
// page a phone plays on. One setting, NATIVE_DOWNLOADS, says where they are:
//
//   a folder        absolute, or relative to the repository; served here
//   file://...      the same, as a URL
//   http(s)://...   linked as is (a release page, a LAN box)
//
// A folder is served BY THIS PROCESS under /native/ rather than linked,
// because the owner tunnels a remote disk onto the box: the files reach a
// player without ever being copied anywhere public. It is read on every
// request, not at boot, so a disk that mounts after the server started still
// counts, and one that goes away just makes the link disappear.
//
// Only files named for this game are offered. package.sh writes
// `<product>-<version>-<target>.zip` into one shared dist/ for every game in
// the family, and a folder that also holds boombrawl's zips must not offer
// them on this page.

import { createReadStream } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const PRODUCT = 'CarrierDominion';

// A plain file name: no separators, no leading dot, nothing to decode. Only
// a name that passes this AND is in the folder's listing is ever opened.
const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

// What the setting points at. Never throws: a setting that cannot be read is
// no link, not a server that will not start.
function nativeSource(value, root) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (text === '') return { kind: 'none' };
  if (/^https?:\/\//i.test(text)) {
    try {
      return { kind: 'url', url: new URL(text).href };
    } catch (error) {
      return { kind: 'none' };
    }
  }
  if (/^file:/i.test(text)) {
    try {
      return { kind: 'folder', dir: fileURLToPath(text) };
    } catch (error) {
      return { kind: 'none' };
    }
  }
  return { kind: 'folder', dir: isAbsolute(text) ? text : resolve(root, text) };
}

function isOffered(name) {
  return SAFE_NAME.test(name) && name.toLowerCase().startsWith(PRODUCT.toLowerCase());
}

// The files on offer right now, newest first. A folder that is missing or
// unreadable lists as nothing, and the page then shows no link.
async function listFolder(dir) {
  let names;
  try {
    names = await readdir(dir);
  } catch (error) {
    return [];
  }
  const files = [];
  for (const name of names) {
    if (!isOffered(name)) continue;
    try {
      const info = await stat(join(dir, name));
      if (info.isFile()) files.push({ name: name, size: info.size, mtimeMs: info.mtimeMs });
    } catch (error) {
      // Gone between the listing and the stat: not on offer.
    }
  }
  files.sort((a, b) => b.mtimeMs - a.mtimeMs || (a.name < b.name ? -1 : 1));
  return files.map((file) => ({ name: file.name, size: file.size, url: `/native/${file.name}` }));
}

// What the page should show: { kind: 'none' }, { kind: 'url', url } or
// { kind: 'folder', files: [{ name, size, url }] }. A folder with nothing to
// offer is 'none', so the page has one case for "no link".
async function nativeListing(source) {
  if (source.kind === 'url') return { kind: 'url', url: source.url };
  if (source.kind !== 'folder') return { kind: 'none' };
  const files = await listFolder(source.dir);
  return files.length === 0 ? { kind: 'none' } : { kind: 'folder', files: files };
}

function sendJson(req, res, body) {
  const text = JSON.stringify(body);
  res.writeHead(200, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(text),
    'cache-control': 'no-cache',
  });
  res.end(req.method === 'HEAD' ? undefined : text);
}

function refuse(res, status) {
  res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8' });
  res.end(status === 404 ? 'not found' : 'method not allowed');
}

// Answers /native.json and /native/<file>. Returns true when it answered.
async function serveNative(req, res, source) {
  const path = String(req.url ?? '').split('?')[0];
  if (path !== '/native.json' && !path.startsWith('/native/')) return false;
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    refuse(res, 405);
    return true;
  }
  if (path === '/native.json') {
    sendJson(req, res, await nativeListing(source));
    return true;
  }
  if (source.kind !== 'folder') {
    refuse(res, 404);
    return true;
  }
  const name = path.slice('/native/'.length);
  const offered = (await listFolder(source.dir)).find((file) => file.name === name);
  if (offered === undefined) {
    refuse(res, 404);
    return true;
  }
  res.writeHead(200, {
    'content-type': name.toLowerCase().endsWith('.zip') ? 'application/zip' : 'application/octet-stream',
    'content-length': offered.size,
    'content-disposition': `attachment; filename="${name}"`,
    'cache-control': 'no-cache',
  });
  if (req.method === 'HEAD') {
    res.end();
    return true;
  }
  const stream = createReadStream(join(source.dir, name));
  // A tunnelled disk can drop mid-file. That ends this one download, cut
  // short where the length header will show it, and nothing else.
  stream.on('error', () => res.destroy());
  stream.pipe(res);
  return true;
}

export { PRODUCT, nativeSource, nativeListing, serveNative };
