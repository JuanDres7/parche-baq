import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { api } from './api.ts';
import { refreshDemo } from './database.ts';

const root = resolve('dist');
const port = Number(process.env.PARCHE_PORT ?? 3000);
const host = '127.0.0.1';
const types: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json',
};

// Keep the entry files paired with this API until the server restarts.
const entryFiles = new Map([
  ['/index.html', await readFile(resolve(root, 'index.html'))],
  ['/sw.js', await readFile(resolve(root, 'sw.js'))],
]);

refreshDemo();

createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  try {
    const url = new URL(req.url ?? '/', `http://${host}:${port}`);
    if (url.pathname.startsWith('/api/')) return await api(req, res, url);
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { Allow: 'GET, HEAD' });
      return res.end();
    }
    const pathname = url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname);
    const entry = entryFiles.get(pathname);
    const file = resolve(root, `.${pathname}`);
    if (!entry && (!file.startsWith(`${root}${sep}`) || !(await stat(file)).isFile())) {
      res.writeHead(404);
      return res.end('Archivo no encontrado');
    }
    res.writeHead(200, { 'Content-Type': types[extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(req.method === 'HEAD' ? undefined : entry ?? await readFile(file));
  } catch {
    if (!res.headersSent) res.writeHead(404);
    res.end('Archivo no encontrado');
  }
}).listen(port, host, () => console.log(`Parche está listo en http://localhost:${port}`));
