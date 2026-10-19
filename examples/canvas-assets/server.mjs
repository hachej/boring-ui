// The canvas-assets example host: one fictional page, the bundled page code, and tldraw's assets from this origin (route.mjs).
// Every request is logged so the journey can prove no request leaves the origin. The licence key is read from this process's
// environment (TLDRAW_LICENSE_KEY) and sent in the boot data only when set; it is never logged or written to disk.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { sendWebResponse, webRequest } from '@hachej/boring-files/node-http';
import { tldrawAssetResponse } from './route.mjs';

const here = name => fileURLToPath(new URL(name, import.meta.url));

// The lazy canvas module carries tldraw's stylesheet as a <style> injected when the module loads, so the CSS arrives with the canvas.
const injectCss = {
  name: 'inject-css',
  setup(builder) {
    builder.onLoad({ filter: /\.css$/ }, async ({ path }) => ({
      contents: `const style = document.createElement('style'); style.textContent = ${JSON.stringify(await readFile(path, 'utf8'))}; document.head.append(style);`,
      loader: 'js',
    }));
  },
};

async function bundlePage() {
  const result = await build({
    entryPoints: [here('./host.jsx')], bundle: true, splitting: true, format: 'esm', outdir: '/bundle', write: false, jsx: 'automatic',
    platform: 'browser', define: { 'process.env.NODE_ENV': '"production"' }, plugins: [injectCss],
  });
  return Object.fromEntries(result.outputFiles.map(file => ['/' + file.path.split('/').pop(), file.contents]));
}

const policy = [
  "default-src 'self'", "script-src 'self'", "style-src 'self' 'unsafe-inline'", "img-src 'self' data: blob:",
  "font-src 'self' data:", "connect-src 'self'", "frame-src 'none'", "object-src 'none'", "base-uri 'none'",
].join('; ');

export async function startCanvasAssetsServer({ port = 0, licenseKey = process.env.TLDRAW_LICENSE_KEY || undefined } = {}) {
  const bundle = await bundlePage();
  const requests = [];
  const boot = JSON.stringify({ ...(licenseKey ? { licenseKey } : {}) }).replace(/</g, '\\u003c');
  const page = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Fictional canvas host</title>`
    + `<script type="application/json" id="boot">${boot}</script><div id="root"></div><script type="module" src="/host.js"></script>`;
  const server = createServer(async (incoming, outgoing) => {
    const url = new URL(incoming.url, 'http://localhost');
    requests.push(`${incoming.method} ${url.pathname}`);
    if (incoming.method === 'GET' && url.pathname === '/') {
      return void outgoing.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': policy, 'cache-control': 'no-store' }).end(page);
    }
    if (incoming.method === 'GET' && bundle[url.pathname]) {
      const type = url.pathname.endsWith('.css') ? 'text/css' : 'text/javascript';
      return void outgoing.writeHead(200, { 'content-type': `${type}; charset=utf-8` }).end(bundle[url.pathname]);
    }
    const request = await webRequest(incoming, url);
    const response = request && await tldrawAssetResponse(request);
    if (response) return void (await sendWebResponse(response, outgoing));
    outgoing.writeHead(404).end();
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  return { url: `http://127.0.0.1:${server.address().port}`, requests, close: () => new Promise(resolve => server.close(resolve)) };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const served = await startCanvasAssetsServer({ port: Number(process.env.PORT ?? 5330) });
  console.log(`canvas-assets example: ${served.url}`);
}
