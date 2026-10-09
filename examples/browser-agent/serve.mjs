// Static host for the in-browser agent. It serves the bundles with the cross-origin isolation headers that SQLite on
// OPFS and pi-codemode's SharedArrayBuffer need, and an optional model gateway. It runs no agent code: `--out <dir>`
// writes the same files (minified) for any static host that can send the two headers. It also serves a fictional same-origin API
// (`/fixture/api/notes`) and page (`/fixture/`) that the agent reads and, after approval, changes.
//   node examples/browser-agent/serve.mjs [--port 4200] [--no-gateway] [--out dir]
import { createServer } from 'node:http';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { readBody, sendWebResponse } from '@hachej/boring-files/node-http';
import { fileURLToPath } from 'node:url';
import { buildTailwind } from '../studio/tailwind.mjs';
import { buildBrowserAgent } from './build.mjs';
import { GATEWAY_HOSTS } from './worker/gateway.js';

const here = name => fileURLToPath(new URL(name, import.meta.url));
const ISOLATION = { 'cross-origin-opener-policy': 'same-origin', 'cross-origin-embedder-policy': 'require-corp', 'cross-origin-resource-policy': 'same-origin' };
const TYPES = { html: 'text/html; charset=utf-8', js: 'text/javascript; charset=utf-8', css: 'text/css; charset=utf-8', wasm: 'application/wasm' };

export async function buildSite({ minify = false } = {}) {
  const files = await buildBrowserAgent({ minify });
  const css = [await buildTailwind({ extraDirectories: ['registry/provider-setup'] }), files['/app-bundle.css'], readFileSync(here('./page/app.css'), 'utf8')].join('\n');
  delete files['/app-bundle.css'];
  files['/styles.css'] = css;
  files['/index.html'] = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>Browser agent (fictional)</title>
<link rel="stylesheet" href="/styles.css"></head><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>`;
  return files;
}

/** A fictional notes service: the agent's example of a website's own data and API. State is per server instance. */
export const FIXTURE_PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Fictional notes site</title></head>
<body><h1>Fictional notes site</h1><ul id="notes"></ul><script>fetch('/fixture/api/notes').then(r => r.json()).then(items => { for (const note of items) { const li = document.createElement('li'); li.textContent = note.title; document.getElementById('notes').append(li); } });</script></body></html>`;

function createFixture() {
  const notes = [{ id: 1, title: 'Water the fictional plants' }, { id: 2, title: 'Call the placeholder plumber' }];
  return {
    notes,
    async handle(incoming, outgoing, url) {
      const json = (status, value) => outgoing.writeHead(status, { ...ISOLATION, 'content-type': 'application/json', 'cache-control': 'no-store' }).end(JSON.stringify(value));
      if (url.pathname === '/fixture/' || url.pathname === '/fixture') return void outgoing.writeHead(200, { ...ISOLATION, 'content-type': TYPES.html, 'cache-control': 'no-store' }).end(FIXTURE_PAGE);
      // A stand-in for OpenAI's device-code sign-in, so the journey never contacts a production service: the code is
      // issued, and polling stays "pending" (the journey completes no login).
      if (url.pathname === '/fixture/openai-auth/api/accounts/deviceauth/usercode' && incoming.method === 'POST') return json(200, { device_auth_id: 'fixture-device', user_code: 'FIXT-0001', interval: 5 });
      if (url.pathname === '/fixture/openai-auth/api/accounts/deviceauth/token' && incoming.method === 'POST') return json(403, { error: { code: 'deviceauth_authorization_pending' } });
      if (url.pathname !== '/fixture/api/notes') return json(404, { reason: 'not-found' });
      if (incoming.method === 'GET') return json(200, notes);
      if (incoming.method === 'POST') {
        let text = '';
        for await (const chunk of incoming) text += chunk;
        let body;
        try { body = JSON.parse(text); } catch { return json(400, { reason: 'invalid-json' }); }
        if (typeof body?.title !== 'string' || !body.title.trim() || body.title.length > 200) return json(422, { reason: 'title-required' });
        const note = { id: notes.length + 1, title: body.title.trim() };
        notes.push(note);
        return json(201, note);
      }
      return json(405, { reason: 'method-not-allowed' });
    },
  };
}

/** The gateway: `/gateway/<host>/<path>` forwards to `https://<host>/<path>` for allow-listed hosts. It adds no credentials. */
async function gateway(incoming, outgoing, url) {
  const [, , host, ...rest] = url.pathname.split('/');
  if (!GATEWAY_HOSTS.includes(host)) return void outgoing.writeHead(403, ISOLATION).end('host not allowed');
  const headers = new Headers();
  for (const [name, value] of Object.entries(incoming.headers)) if (!['host', 'origin', 'referer', 'cookie', 'connection', 'content-length', 'accept-encoding'].includes(name) && !name.startsWith('sec-')) headers.set(name, Array.isArray(value) ? value.join(', ') : value);
  const hasBody = incoming.method !== 'GET' && incoming.method !== 'HEAD';
  const body = hasBody ? await readBody(incoming) : undefined;
  if (hasBody && body === undefined) return void outgoing.writeHead(413, ISOLATION).end();
  const upstream = await fetch(`https://${host}/${rest.join('/')}${url.search}`, { method: incoming.method, headers, ...(hasBody ? { body } : {}) });
  const out = { ...ISOLATION, 'content-type': upstream.headers.get('content-type') ?? 'application/octet-stream', 'cache-control': 'no-store' };
  await sendWebResponse(new Response(upstream.body, { status: upstream.status, headers: out }), outgoing);
}

export async function serveBrowserAgent({ port = 0, withGateway = true } = {}) {
  const files = await buildSite();
  const requests = [];
  const fixture = createFixture();
  const server = createServer(async (incoming, outgoing) => {
    const url = new URL(incoming.url, `http://${incoming.headers.host}`);
    requests.push(`${incoming.method} ${url.pathname}`);
    try {
      if (url.pathname.startsWith('/fixture')) return await fixture.handle(incoming, outgoing, url);
      if (withGateway && url.pathname.startsWith('/gateway/')) return await gateway(incoming, outgoing, url);
      const path = url.pathname === '/' ? '/index.html' : url.pathname;
      const body = incoming.method === 'GET' && files[path];
      if (!body) return void outgoing.writeHead(404, ISOLATION).end('not found');
      outgoing.writeHead(200, { ...ISOLATION, 'content-type': TYPES[path.split('.').pop()] ?? 'application/octet-stream', 'cache-control': 'no-store' }).end(body);
    } catch (error) {
      if (!outgoing.headersSent) outgoing.writeHead(502, ISOLATION);
      outgoing.end(String(error?.message ?? error));
    }
  });
  await new Promise(resolve => server.listen(port, '127.0.0.1', resolve));
  return { url: `http://127.0.0.1:${server.address().port}/`, port: server.address().port, requests, fixture, pageInputs: files.pageInputs ?? [], close: () => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }) };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const option = name => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : undefined; };
  if (option('--out')) {
    const out = option('--out');
    for (const [path, body] of Object.entries(await buildSite({ minify: true }))) { mkdirSync(dirname(join(out, path)), { recursive: true }); writeFileSync(join(out, path), body); }
    console.log(`Wrote ${out}. Serve it with Cross-Origin-Opener-Policy: same-origin and Cross-Origin-Embedder-Policy: require-corp.`);
  } else {
    const app = await serveBrowserAgent({ port: Number(option('--port') ?? process.env.PORT ?? 4200), withGateway: !args.includes('--no-gateway') });
    console.log(`Browser agent on ${app.url} (add ?scripted for the keyless demo model).${args.includes('--no-gateway') ? '' : ` Gateway at ${app.url}gateway.`}`);
  }
}
