import { createServer } from 'node:http';
import { rejectForeignHost, sameSecret } from '../../shared/local-host.mjs';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { sendWebResponse, webRequest } from '@hachej/boring-files/node-http';
import { createResourceHandler } from '@hachej/boring-files/remote';
import { createMarkStore } from '@hachej/boring-ui-kit/mark-store';
import { captureMarkdownQuote } from '@hachej/boring-ui-kit/markdown-quote';
import { openSqliteWorkspaces } from '../../shared/sqlite-workspaces.mjs';
import { buildTailwind } from '../../lab/studio/tailwind.mjs';

export const source = '# Field notes\n\nA fictional kite rises above the orchard.\n\nEchoes: echo echo.\n';
export const target = { resource: { providerId: 'documents', path: 'field-notes.md' }, view: { kind: 'published' } };
export async function startHighlights({ port = 0 } = {}) {
  const identity = { scopeId: 'fictional', principalId: 'reviewer', initiatorId: 'reviewer' }, token = randomUUID();
  const files = openSqliteWorkspaces({ filename: ':memory:', providerId: 'documents', authorize: () => true });
  const client = { read: r => files.read(r, identity), publish: r => files.publication.publish(r, identity), lookup: id => files.reconciliation.lookup(id, identity) };
  const seeded = await client.publish({ operationId: 'seed', atomicity: 'all-or-nothing', changes: [{ kind: 'create', target, expected: { kind: 'absent' }, bytes: new TextEncoder().encode(source), mediaType: 'text/markdown' }] });
  if (seeded.kind !== 'committed') throw Error('Fictional seed failed');
  const store = await createMarkStore({ client, identity }, target);
  for (const [id, text, colour] of [['kite', 'fictional kite', 'primary'], ['duplicate', 'echo', 'accent'], ['missing', 'vanished passage', 'muted']]) {
    const anchor = id === 'kite' ? captureMarkdownQuote(source, { start: source.indexOf(text), end: source.indexOf(text) + text.length }).anchor : captureMarkdownQuote(text, { start: 0, end: text.length }).anchor;
    const result = await store.add({ id, anchor, colour, note: id === 'kite' ? 'A fictional observation.' : '', author: 'reviewer', time: '2026-10-10T10:00:00Z' });
    if (result.kind !== 'saved') throw Error('Fictional mark seed failed');
  }
  store.dispose();
  const resources = createResourceHandler({ authenticate: async request => sameSecret(request.headers.get('authorization'), `Bearer ${token}`) ? identity : null, reader: files, publisher: files.publication, lookup: files.reconciliation });
  const bundle = await build({ entryPoints: [fileURLToPath(new URL('./page.tsx', import.meta.url))], bundle: true, write: false, format: 'esm', platform: 'browser', jsx: 'automatic', alias: { '@': fileURLToPath(new URL('../app-shell', import.meta.url)) }, define: { 'process.env.NODE_ENV': '"production"' }, minify: true, logLevel: 'silent', metafile: true });
  const css = await buildTailwind({ extraDirectories: ['examples/highlights', 'registry/highlights'], extraCss: 'body { font-family: var(--font-sans, system-ui, sans-serif); }' });
  const boot = JSON.stringify({ identity, token, target }).replaceAll('<', '\\u003c');
  const page = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Fictional anchored highlights</title><link rel="stylesheet" href="/app.css"></head><body class="m-0 bg-background text-foreground font-sans"><div id="root"></div><script type="application/json" id="boot">${boot}</script><script type="module" src="/page.js"></script></body></html>`;
  const server = createServer(async (incoming, outgoing) => {
    if (rejectForeignHost(incoming, outgoing)) return;
    const url = new URL(incoming.url, `http://${incoming.headers.host}`), abort = new AbortController(); outgoing.on('close', () => abort.abort());
    try {
      if (incoming.method === 'GET' && url.pathname === '/') return void outgoing.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(page);
      if (incoming.method === 'GET' && url.pathname === '/page.js') return void outgoing.writeHead(200, { 'content-type': 'text/javascript' }).end(bundle.outputFiles[0].contents);
      if (incoming.method === 'GET' && url.pathname === '/app.css') return void outgoing.writeHead(200, { 'content-type': 'text/css' }).end(css);
      const request = await webRequest(incoming, url, { signal: abort.signal });
      await sendWebResponse(request && url.pathname === '/api/resources' ? await resources(request) : new Response(null, { status: 404 }), outgoing, { signal: abort.signal });
    } catch (error) { if (!outgoing.headersSent) outgoing.writeHead(500); outgoing.end(); if (!abort.signal.aborted) console.error(error); }
  });
  await new Promise((done, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', done); });
  return { files, client, identity, target, metafile: bundle.metafile, url: `http://127.0.0.1:${server.address().port}/`, close: async () => { server.closeAllConnections(); await new Promise(done => server.close(done)); files.close(); } };
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const app = await startHighlights({ port: Number(process.env.PORT ?? 4320) }); console.log(`Fictional highlights: ${app.url}`);
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { void app.close().finally(() => process.exit(0)); });
}
