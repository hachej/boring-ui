// Spike host for the canvas board (examples/canvas-board/README.md). One workspace provider over a scratch directory, seeded with the
// fictional fixtures; the resource endpoint the artifact panel reads and publishes through; the page; tldraw's own assets served from this
// origin (no CDN). The page gets a Content-Security-Policy header that allows nothing outside this origin, so any vendor egress shows up as
// a violation. A tldraw licence key is used only if TLDRAW_LICENSE_KEY is set in this process's environment; it is never logged.
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, extname, join, normalize, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { gzipSync } from 'node:zlib';
import { build } from 'esbuild';
import { sendWebResponse, webRequest } from '@hachej/boring-files/node-http';
import { NodeExecutionEnv } from '@earendil-works/pi-durable/env/node';
import { openNodeConnection } from '@hachej/boring-files/sqlite';
import { createWorkspaceJournal } from '@hachej/boring-files/journal';
import { createWorkspaceProvider } from '@hachej/boring-files/workspace';
import { createResourceHandler } from '@hachej/boring-files/remote';
import { buildTailwind, themeCss } from '../../lab/studio/tailwind.mjs';

const here = name => fileURLToPath(new URL(name, import.meta.url));
const root = fileURLToPath(new URL('../../', import.meta.url));
const require = createRequire(import.meta.url);
const TLDRAW_VERSION = JSON.parse(readFileSync(join(root, 'node_modules/tldraw/package.json'), 'utf8')).version;

/** tldraw's fonts, icons and translations for the pinned SDK version, unpacked once into .cache (gitignored), then served from this origin. */
function tldrawAssets() {
  const directory = join(root, '.cache/tldraw-assets'), unpacked = join(directory, 'package');
  if (!existsSync(join(unpacked, 'selfHosted.js'))) {
    mkdirSync(directory, { recursive: true });
    execFileSync('npm', ['pack', `@tldraw/assets@${TLDRAW_VERSION}`], { cwd: directory, stdio: 'ignore' });
    execFileSync('tar', ['xzf', `tldraw-assets-${TLDRAW_VERSION}.tgz`], { cwd: directory });
  }
  return unpacked;
}

const MIME = { '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.json': 'application/json', '.png': 'image/png', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };

/** The page's policy. `inline` adds 'unsafe-inline' to script-src: a srcdoc frame inherits this policy, so without it no mock-up script runs. */
export function hostPolicy(mode = 'inline') {
  return [
    "default-src 'self'",
    `script-src 'self'${mode === 'inline' ? " 'unsafe-inline'" : ''}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "frame-src 'none'",
    "worker-src 'self' blob:",
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ');
}

export async function startBoard({ port = 0, directory = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), 'canvas-board-')), token = randomUUID() } = {}) {
  const person = { scopeId: 'fictional-studio', principalId: 'fictional-pm-reviewer', initiatorId: 'fictional-pm-reviewer' };
  const workspace = join(directory, 'workspace');
  mkdirSync(join(workspace, 'mockups'), { recursive: true });
  const env = new NodeExecutionEnv({ cwd: workspace });
  const db = openNodeConnection(join(directory, 'workspace.sqlite'));
  const files = createWorkspaceProvider({ identity: { providerId: 'workspace', instanceId: 'board', incarnation: 'board', viewId: 'published' }, fs: env, journal: createWorkspaceJournal(db) });
  // The fixtures as the PM agent would have written them, published through the provider (so each has a revision and history).
  const seeded = {};
  for (const name of ['booking.maquette.json', 'confirm.mockup.html', 'booking.board.json']) {
    const path = `mockups/${name}`, text = readFileSync(here(`./fixtures/${name}`), 'utf8');
    const result = await files.publication.publish({ operationId: `seed-${name}`, atomicity: 'all-or-nothing', changes: [{ kind: 'create',
      target: { resource: { providerId: 'workspace', path }, view: { kind: 'published' } }, expected: { kind: 'absent' }, bytes: new TextEncoder().encode(text),
      mediaType: name.endsWith('.html') ? 'text/html' : 'application/json' }] }, person);
    if (result.kind !== 'committed') throw new Error(`seed ${name}: ${result.kind}`);
    seeded[path] = result.receipt.changes[0].after.revision;
  }

  const allowed = request => request.headers.get('authorization') === `Bearer ${token}`;
  const resources = createResourceHandler({ authenticate: async request => allowed(request) ? person : null, reader: files, publisher: files.publication, lookup: files.reconciliation });

  const bundle = await build({ entryPoints: [here('./page.tsx')], bundle: true, write: false, outdir: here('./out'), format: 'esm', splitting: true, platform: 'browser', jsx: 'automatic',
    alias: { '@': join(root, 'examples/app-shell') }, define: { 'process.env.NODE_ENV': '"production"' }, minify: true, metafile: true, logLevel: 'silent', chunkNames: 'chunk-[hash]' });
  const outputs = Object.fromEntries(bundle.outputFiles.map(file => [`/${file.path.slice(here('./out').length + 1)}`, file]));
  const bundleCss = bundle.outputFiles.filter(file => file.path.endsWith('.css')).map(file => file.text).join('\n');
  const appCss = await buildTailwind({ extraDirectories: ['examples/canvas-board'] });
  const css = [appCss, bundleCss, 'html,body{margin:0;height:100%;background:var(--background);color:var(--foreground);font-family:ui-sans-serif,system-ui,sans-serif}#root{height:100dvh}'].join('\n');
  const tailwindDir = dirname(require.resolve('tailwindcss/package.json'));
  const mockupCss = { tokens: themeCss(), theme: readFileSync(join(tailwindDir, 'theme.css'), 'utf8'), preflight: readFileSync(join(tailwindDir, 'preflight.css'), 'utf8'), utilities: readFileSync(join(tailwindDir, 'utilities.css'), 'utf8') };
  const assets = tldrawAssets();
  const licenseKey = process.env.TLDRAW_LICENSE_KEY || undefined;
  const boot = { token, identity: { runtimeId: 'board', ...person }, seeded, mockupCss, ...(licenseKey ? { licenseKey } : {}) };
  const page = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>Canvas board spike (fictional)</title><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div>
<script type="application/json" id="boot">${JSON.stringify(boot).replaceAll('<', '\\u003c')}</script><script type="module" src="/page.js"></script></body></html>`;

  const server = createServer(async (incoming, outgoing) => {
    const url = new URL(incoming.url, `http://${incoming.headers.host}`);
    const closed = new AbortController();
    outgoing.on('close', () => closed.abort());
    try {
      if (incoming.method === 'GET' && url.pathname === '/') return void outgoing.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'content-security-policy': hostPolicy(url.searchParams.get('csp') ?? 'inline') }).end(page);
      if (incoming.method === 'GET' && url.pathname === '/app.css') return void outgoing.writeHead(200, { 'content-type': MIME['.css'] }).end(css);
      if (incoming.method === 'GET' && outputs[url.pathname] && url.pathname.endsWith('.js')) return void outgoing.writeHead(200, { 'content-type': MIME['.js'] }).end(outputs[url.pathname].contents);
      if (incoming.method === 'GET' && url.pathname.startsWith('/tldraw-assets/')) {
        const file = resolve(assets, normalize(decodeURIComponent(url.pathname.slice('/tldraw-assets/'.length))));
        if (!file.startsWith(assets + '/') || !existsSync(file) || !statSync(file).isFile()) return void outgoing.writeHead(404).end();
        return void outgoing.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream', 'cache-control': 'max-age=3600' }).end(readFileSync(file));
      }
      const request = await webRequest(incoming, url, { signal: closed.signal });
      if (!request) return void outgoing.writeHead(413).end();
      let response;
      if (url.pathname === '/api/resources') response = await resources(request);
      else if (url.pathname === '/api/history' && allowed(request)) response = Response.json({ saves: files.saves(url.searchParams.get('path') ?? '') });
      else response = Response.json({ reason: 'not-found' }, { status: 404 });
      await sendWebResponse(response, outgoing, { signal: closed.signal });
    } catch (error) {
      if (!outgoing.headersSent) outgoing.writeHead(500);
      outgoing.end();
      if (!closed.signal.aborted) console.error('request failed:', error?.message ?? error);
    }
  });
  await new Promise(done => server.listen(port, '127.0.0.1', done));
  return {
    url: `http://127.0.0.1:${server.address().port}/`, token, files, person, workspace, metafile: bundle.metafile, outputs: bundle.outputFiles.map(file => ({ path: file.path.slice(here('./out').length + 1), bytes: file.contents.length, gzip: gzipSync(file.contents).length })), cssBytes: { app: appCss.length, bundle: bundleCss.length },
    close: async () => { server.closeAllConnections(); await new Promise(done => server.close(done)); db.close?.(); },
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const app = await startBoard({ port: Number(process.env.PORT ?? 4310) });
  console.log(`Canvas board spike on ${app.url} (fictional content). ?open=board|mockup|maquette, &csp=strict for a host without inline scripts.`);
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { app.close().finally(() => process.exit(0)); });
}
