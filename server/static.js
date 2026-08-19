// server/static.js - a minimal static file handler.
//
// No express: the whole need is "serve client/ and data/ over http", and a
// dependency for that is a dependency to audit, update, and explain. Paths are
// resolved and then checked to be inside the allowed roots, so a request for
// ../../etc/passwd resolves outside and is refused.

import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

function contentType(path) {
  return MIME[extname(path).toLowerCase()] ?? 'application/octet-stream';
}

function insideRoot(root, candidate) {
  const resolvedRoot = resolve(root);
  const resolvedCandidate = resolve(candidate);
  return resolvedCandidate === resolvedRoot || resolvedCandidate.startsWith(resolvedRoot + sep);
}

// roots: [{ prefix, dir }] checked in order. Returns true when it answered.
async function serveStatic(req, res, roots) {
  const url = new URL(req.url, 'http://localhost');
  let pathname = decodeURIComponent(url.pathname);
  if (pathname.endsWith('/')) pathname += 'index.html';

  for (const root of roots) {
    if (!pathname.startsWith(root.prefix)) continue;
    const relative = normalize(pathname.slice(root.prefix.length)).replace(/^([/\\])+/, '');
    const filePath = join(root.dir, relative);
    if (!insideRoot(root.dir, filePath)) {
      res.writeHead(403).end('forbidden');
      return true;
    }
    let info;
    try {
      info = await stat(filePath);
    } catch {
      continue;
    }
    if (!info.isFile()) continue;
    res.writeHead(200, {
      'content-type': contentType(filePath),
      'content-length': info.size,
      'cache-control': 'no-cache',
    });
    createReadStream(filePath).pipe(res);
    return true;
  }
  return false;
}

export { serveStatic, contentType };
