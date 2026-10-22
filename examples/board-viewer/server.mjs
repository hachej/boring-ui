// Ported from spike/canvas-board. One real workspace provider, fictional files and the actual ArtifactPanel.
import { createServer } from 'node:http';
import { rejectForeignHost, sameSecret } from '../../shared/local-host.mjs';
import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { sendWebResponse, webRequest } from '@hachej/boring-files/node-http';
import { NodeExecutionEnv } from '@earendil-works/pi-durable/env/node';
import { openNodeConnection } from '@hachej/boring-files/sqlite';
import { createWorkspaceJournal } from '@hachej/boring-files/journal';
import { createWorkspaceProvider } from '@hachej/boring-files/workspace';
import { createResourceHandler } from '@hachej/boring-files/remote';
import { buildTailwind } from '../../lab/studio/tailwind.mjs';
import { tldrawAssetResponse } from '../canvas-assets/route.mjs';

const here = name => fileURLToPath(new URL(name, import.meta.url));
const injectCss = { name: 'lazy-css', setup(builder) {
  builder.onLoad({ filter: /\.css$/ }, ({ path }) => ({ loader: 'js', contents: `const style = document.createElement('style'); style.textContent = ${JSON.stringify(readFileSync(path, 'utf8'))}; document.head.append(style);` }));
} };
const policy = "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; frame-src 'none'; worker-src 'self' blob:; base-uri 'none'; form-action 'none'";

export async function startBoard({ port = 0, directory = mkdtempSync('/var/tmp/board-viewer-'), token = randomUUID() } = {}) {
  const person = { scopeId: 'fictional-studio', principalId: 'fictional-reviewer', initiatorId: 'fictional-reviewer' };
  const workspace = join(directory, 'workspace');
  mkdirSync(join(workspace, 'mockups'), { recursive: true });
  const db = openNodeConnection(join(directory, 'workspace.sqlite'));
  const files = createWorkspaceProvider({ identity: { providerId: 'workspace', instanceId: 'board', incarnation: 'board', viewId: 'published' }, fs: new NodeExecutionEnv({ cwd: workspace }), journal: createWorkspaceJournal(db) });
  const seeded = {};
  for (const name of ['booking.maquette.json', 'confirm.mockup.html', 'booking.board.json']) {
    const path = `mockups/${name}`, text = readFileSync(here(`../../test/fixtures/board/${name}`), 'utf8');
    const result = await files.publication.publish({ operationId: `seed-${name}`, atomicity: 'all-or-nothing', changes: [{ kind: 'create',
      target: { resource: { providerId: 'workspace', path }, view: { kind: 'published' } }, expected: { kind: 'absent' }, bytes: new TextEncoder().encode(text), mediaType: name.endsWith('.html') ? 'text/html' : 'application/json' }] }, person);
    if (result.kind !== 'committed') throw new Error(`Seed failed: ${result.kind}`);
    seeded[path] = result.receipt.changes[0].after.revision;
  }
  const allowed = request => sameSecret(request.headers.get('authorization'), `Bearer ${token}`);
  const resources = createResourceHandler({ authenticate: async request => allowed(request) ? person : null, reader: files, publisher: files.publication, lookup: files.reconciliation });
  const bundle = await build({ entryPoints: [here('./page.tsx')], bundle: true, write: false, outdir: here('./out'), format: 'esm', splitting: true, platform: 'browser', jsx: 'automatic',
    alias: { '@': here('../app-shell') }, define: { 'process.env.NODE_ENV': '"production"' }, minify: true, plugins: [injectCss], metafile: true, logLevel: 'silent', chunkNames: 'chunk-[hash]' });
  const outputs = Object.fromEntries(bundle.outputFiles.map(file => [`/${file.path.slice(here('./out').length + 1)}`, file]));
  const css = [await buildTailwind({ extraDirectories: ['examples/board-viewer', 'registry/board-viewer', 'registry/mockup-viewer'] }), 'html,body,#root{margin:0;height:100%}body{background:var(--background);color:var(--foreground);font-family:ui-sans-serif,system-ui,sans-serif}'].join('\n');
  const boot = { token, identity: { runtimeId: 'board', ...person }, seeded };
  // Journeys are always keyless. Production hosts pass their key to createBoardKind, never into a board file.
  const page = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>Board viewer, fictional</title><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script type="application/json" id="boot">${JSON.stringify(boot).replaceAll('<', '\\u003c')}</script><script type="module" src="/page.js"></script></body></html>`;
  const faults = { lose: false, hold: false, release: null, dispatched: false };
  const server = createServer(async (incoming, outgoing) => {
    if (rejectForeignHost(incoming, outgoing)) return;
    const url = new URL(incoming.url, `http://${incoming.headers.host}`);
    const closed = new AbortController(); outgoing.on('close', () => closed.abort());
    try {
      if (incoming.method === 'GET' && url.pathname === '/') return void outgoing.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'content-security-policy': policy }).end(page);
      if (incoming.method === 'GET' && url.pathname === '/app.css') return void outgoing.writeHead(200, { 'content-type': 'text/css' }).end(css);
      if (incoming.method === 'GET' && outputs[url.pathname]) return void outgoing.writeHead(200, { 'content-type': 'text/javascript' }).end(outputs[url.pathname].contents);
      const request = await webRequest(incoming, url, { signal: closed.signal });
      if (!request) return void outgoing.writeHead(413).end();
      let response = await tldrawAssetResponse(request);
      if (!response && url.pathname === '/api/resources') {
        const publication = incoming.method === 'POST' && (await request.clone().json()).kind === 'publish';
        response = await resources(request);
        if (publication) {
          faults.dispatched = true;
          if (faults.hold) { faults.hold = false; await new Promise(resolve => { faults.release = resolve; }); }
          if (faults.lose) { faults.lose = false; outgoing.writeHead(503).end(); return; }
        }
      }
      if (!response && url.pathname === '/api/history' && allowed(request)) response = Response.json({ saves: files.saves(url.searchParams.get('path') ?? '') });
      await sendWebResponse(response ?? new Response(null, { status: 404 }), outgoing, { signal: closed.signal });
    } catch (error) {
      if (!outgoing.headersSent) outgoing.writeHead(500);
      outgoing.end();
      if (!closed.signal.aborted) console.error('Board request failed', error.message);
    }
  });
  await new Promise((done, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', done); });
  return { url: `http://127.0.0.1:${server.address().port}/`, token, files, person, faults, metafile: bundle.metafile,
    close: async () => { server.closeAllConnections(); await new Promise(done => server.close(done)); db.close(); } };
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const app = await startBoard({ port: Number(process.env.PORT ?? 4310) });
  console.log(`Fictional board viewer: ${app.url}`);
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { void app.close().finally(() => process.exit(0)); });
}
