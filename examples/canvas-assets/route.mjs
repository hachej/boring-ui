// Serves the tldraw assets that selfHostedCanvasAssetUrls() names, from the installed @tldraw/assets (pinned to the tldraw SDK).
// Mount it at the same base the map uses. Traversal-safe: only regular files under the package root are served.
import { createRequire } from 'node:module';
import { readFile, stat } from 'node:fs/promises';
import { dirname, extname, join, normalize, sep } from 'node:path';

const require = createRequire(import.meta.url);
const root = dirname(require.resolve('@tldraw/assets/package.json'));
const TYPES = { '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.json': 'application/json', '.png': 'image/png', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };

/** Returns the asset response for `/<base>/<path>`, or null when the path is not an asset (the caller answers 404). */
export async function tldrawAssetResponse(request, { base = '/tldraw-assets' } = {}) {
  if (request.method !== 'GET' && request.method !== 'HEAD') return null;
  const pathname = new URL(request.url).pathname;
  if (!pathname.startsWith(`${base}/`)) return null;
  let relative;
  try { relative = decodeURIComponent(pathname.slice(base.length + 1)); } catch { return null; }
  const file = normalize(join(root, relative));
  if (!file.startsWith(root + sep)) return null;
  try { if (!(await stat(file)).isFile()) return null; } catch { return null; }
  const body = await readFile(file);
  return new Response(request.method === 'HEAD' ? null : body, {
    headers: { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream', 'cache-control': 'public, max-age=3600' },
  });
}
