// The looks viewer story: fictional files from test/fixtures/looks/, no workspace (the viewer reads through its `read`).
import { createServer } from 'node:http';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { rejectForeignHost } from '../../shared/local-host.mjs';
import { buildTailwind } from '../../lab/studio/tailwind.mjs';

const here = name => fileURLToPath(new URL(name, import.meta.url));
const policy = "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; frame-src 'none'; base-uri 'none'; form-action 'none'";

export async function startLooks({ port = 0 } = {}) {
  const folder = here('../../test/fixtures/looks/');
  const files = Object.fromEntries(readdirSync(folder).map(name => [name, readFileSync(folder + name, 'utf8')]));
  const bundle = await build({ entryPoints: [here('./page.tsx')], bundle: true, write: false, outdir: here('./out'), format: 'esm', splitting: true, platform: 'browser', jsx: 'automatic',
    alias: { '@': here('../app-shell') }, define: { 'process.env.NODE_ENV': '"production"' }, minify: true, logLevel: 'silent', chunkNames: 'chunk-[hash]' });
  const outputs = Object.fromEntries(bundle.outputFiles.map(file => [`/${file.path.slice(here('./out').length + 1)}`, file]));
  const css = [await buildTailwind({ extraDirectories: ['examples/looks-viewer', 'registry/looks-viewer', 'registry/mockup-viewer'] }), 'html,body,#root{margin:0}h1,h2,h3,p{margin:0}button{font:inherit}iframe{border:0}body{background:var(--background);color:var(--foreground);font-family:ui-sans-serif,system-ui,sans-serif}'].join('\n');
  const page = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Looks viewer, fictional</title><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script type="application/json" id="boot">${JSON.stringify({ files }).replaceAll('<', '\\u003c')}</script><script type="module" src="/page.js"></script></body></html>`;
  const server = createServer((incoming, outgoing) => {
    if (rejectForeignHost(incoming, outgoing)) return;
    const url = new URL(incoming.url, `http://${incoming.headers.host}`);
    if (url.pathname === '/') return void outgoing.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'content-security-policy': policy }).end(page);
    if (url.pathname === '/app.css') return void outgoing.writeHead(200, { 'content-type': 'text/css' }).end(css);
    if (outputs[url.pathname]) return void outgoing.writeHead(200, { 'content-type': 'text/javascript' }).end(outputs[url.pathname].contents);
    outgoing.writeHead(404).end();
  });
  await new Promise((done, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', done); });
  return { url: `http://127.0.0.1:${server.address().port}/`, close: async () => { server.closeAllConnections(); await new Promise(done => server.close(done)); } };
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const app = await startLooks({ port: Number(process.env.PORT ?? 4311) });
  console.log(`Fictional looks viewer: ${app.url}`);
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { void app.close().finally(() => process.exit(0)); });
}
