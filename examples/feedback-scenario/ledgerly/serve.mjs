// Serves dist/ for every path (the page is a single-page app), so a person can open the scenario route by hand:
// node build.mjs && node serve.mjs, then open the printed URL and use Point.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import config from './feedback.scenario.mjs';

const TYPES = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html; charset=utf-8', '.json': 'application/json' };
export function serve(port = 0, dist = join(process.cwd(), 'dist')) {
  const server = createServer(async (request, response) => {
    const path = new URL(request.url, 'http://ledgerly.invalid').pathname;
    const file = ['/main.js', '/main.css'].includes(path) ? path : '/index.html';
    try {
      const body = await readFile(join(dist, file));
      response.writeHead(200, { 'content-type': TYPES[extname(file)], 'cache-control': 'no-store' });
      response.end(body);
    } catch { response.writeHead(404).end(); }
  });
  return new Promise(resolve => server.listen(port, '127.0.0.1', () => resolve(server)));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const server = await serve(Number(process.env.PORT ?? 4310));
  console.log(`Ledgerly on http://127.0.0.1:${server.address().port}${config.url}`);
}
