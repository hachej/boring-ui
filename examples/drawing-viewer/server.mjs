// The drawing viewer journey's host (D-1398): the page bundled with code splitting as an app bundles it, the fictional fixtures, and
// Excalidraw's fonts served by the app at /excalidraw/fonts/ (the package's dist/prod/fonts), under a policy that allows no request
// to another origin, so any fetch from a CDN is refused and reported as a violation.
import { createServer } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { rejectForeignHost } from '../../shared/local-host.mjs';
import { buildTailwind } from '../../lab/studio/tailwind.mjs';

const here = name => fileURLToPath(new URL(name, import.meta.url));
const root = here('../../');
const fonts = join(root, 'node_modules/@excalidraw/excalidraw/dist/prod/fonts');
const injectCss = { name: 'lazy-css', setup(builder) {
  builder.onLoad({ filter: /\.css$/ }, ({ path }) => ({ loader: 'js', contents: `const style = document.createElement('style'); style.textContent = ${JSON.stringify(readFileSync(path, 'utf8'))}; document.head.append(style);` }));
} };
const policy = "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; frame-src 'none'; worker-src 'self' blob:; base-uri 'none'; form-action 'none'";
export const FIXTURES = ['oakfield-garden.excalidraw', 'bakery-morning.drawio', 'bakery-morning-plain.drawio', 'broken.excalidraw'];

export async function startDrawings({ port = 0 } = {}) {
  const fixtures = Object.fromEntries(FIXTURES.map(name => [name, readFileSync(join(root, 'test/fixtures/drawing', name), 'utf8')]));
  const bundle = await build({ entryPoints: [here('./page.tsx')], bundle: true, write: false, outdir: here('./out'), format: 'esm', splitting: true, platform: 'browser', jsx: 'automatic',
    alias: { '@': here('../app-shell') }, conditions: ['production'], define: { 'process.env.NODE_ENV': '"production"', 'process.env.IS_PREACT': '"false"' }, minify: true, plugins: [injectCss],
    loader: { '.woff2': 'file', '.ttf': 'file' }, metafile: true, logLevel: 'silent', chunkNames: 'chunk-[hash]', assetNames: 'asset-[hash]' });
  const outputs = Object.fromEntries(bundle.outputFiles.map(file => [`/${file.path.slice(here('./out').length + 1)}`, file]));
  const css = [await buildTailwind({ extraDirectories: ['examples/drawing-viewer', 'registry/drawing-viewer'] }), 'html,body,#root{margin:0}body{background:var(--background);color:var(--foreground);font-family:ui-sans-serif,system-ui,sans-serif}'].join('\n');
  const page = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Drawing viewer, fictional</title><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script type="application/json" id="boot">${JSON.stringify({ fixtures }).replaceAll('<', '\\u003c')}</script><script type="module" src="/page.js"></script></body></html>`;
  const requests = [];
  const server = createServer((incoming, outgoing) => {
    if (rejectForeignHost(incoming, outgoing)) return;
    const url = new URL(incoming.url, `http://${incoming.headers.host}`);
    requests.push(url.pathname);
    if (url.pathname === '/') return void outgoing.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'content-security-policy': policy }).end(page);
    if (url.pathname === '/app.css') return void outgoing.writeHead(200, { 'content-type': 'text/css' }).end(css);
    if (outputs[url.pathname]) return void outgoing.writeHead(200, { 'content-type': url.pathname.endsWith('.js') ? 'text/javascript' : 'application/octet-stream' }).end(outputs[url.pathname].contents);
    if (url.pathname.startsWith('/excalidraw/fonts/')) {
      const file = normalize(join(fonts, decodeURIComponent(url.pathname.slice('/excalidraw/fonts/'.length))));
      if (file.startsWith(`${fonts}/`) && file.endsWith('.woff2') && existsSync(file)) return void outgoing.writeHead(200, { 'content-type': 'font/woff2', 'access-control-allow-origin': '*' }).end(readFileSync(file));
    }
    // A folder that serves the probe font only: every other Excalidraw font is missing, so Excalidraw would turn to its CDN.
    if (url.pathname === '/partial-fonts/fonts/Virgil/Virgil-Regular.woff2') return void outgoing.writeHead(200, { 'content-type': 'font/woff2' }).end(readFileSync(join(fonts, 'Virgil/Virgil-Regular.woff2')));
    // An app's fallback page for an unknown path, as a single-page app serves it: the viewer must not take it for a font.
    outgoing.writeHead(200, { 'content-type': 'text/html' }).end('<!doctype html><title>Not here</title>');
  });
  await new Promise((done, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', done); });
  return { url: `http://127.0.0.1:${server.address().port}/`, requests, metafile: bundle.metafile,
    close: async () => { server.closeAllConnections(); await new Promise(done => server.close(done)); } };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const app = await startDrawings({ port: Number(process.env.PORT ?? 4183) });
  console.log(`Drawing viewer on ${app.url}`);
}
