// Tiny static file server for browser checks (no python needed): serves the repo root.
//   const srv = await serve(0); ... srv.url ... await srv.close();
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, normalize, extname } from 'node:path';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png',
  '.svg': 'image/svg+xml', '.wasm': 'application/wasm', '.txt': 'text/plain; charset=utf-8' };

export function serve(port = 0, root = ROOT) {
  const srv = createServer(async (req, res) => {
    try {
      let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      if (p.endsWith('/')) p += 'index.html';
      const f = normalize(join(root, p));
      if (!f.startsWith(root)) { res.writeHead(403); res.end(); return; }
      const st = await stat(f).catch(() => null);
      if (!st || !st.isFile()) { res.writeHead(404); res.end('not found'); return; }
      res.writeHead(200, { 'content-type': TYPES[extname(f)] || 'application/octet-stream', 'cache-control': 'no-store' });
      res.end(await readFile(f));
    } catch (e) { res.writeHead(500); res.end(String(e)); }
  });
  return new Promise((resolve) => srv.listen(port, '127.0.0.1', () => {
    const { port: p } = srv.address();
    resolve({ port: p, url: `http://127.0.0.1:${p}/`, close: () => new Promise((r) => srv.close(() => r())) });
  }));
}
