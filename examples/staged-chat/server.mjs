import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { AssistantEntry, UserEntry } from '@earendil-works/pi-durable';
import { sendWebResponse, webRequest } from '@hachej/boring-files/node-http';
import { createChatTransportHandler } from '@hachej/boring-agent/chat-transport';
import { buildTailwind } from '../../lab/studio/tailwind.mjs';
import { stockShadowTokens, themePreviewHead, themePreviewStatics } from '../../test/fixtures/themes/preview.mjs';
import { createStagedHost } from './host.mjs';

const here = name => fileURLToPath(new URL(name, import.meta.url));
/** Loopback-only fictional fixture, not a production authentication/deployment recipe. Native state survives browser reload, not server restart. */
export async function startStagedChat({ port = 0 } = {}) {
  const host = await createStagedHost();
  for (const conversation of Object.values(host.threads)) await conversation.commit(async tx => {
    for (let index = 0; index < 16; index++) {
      await tx.appendEntry(UserEntry, conversation.id, { model: [{ role: 'user', content: `Question fictive précédente ${index + 1}`, timestamp: index }] });
      await tx.appendEntry(AssistantEntry, conversation.id, { model: [{ role: 'assistant', content: [{ type: 'text', text: `Note fictive précédente ${index + 1}. Aucun conseil médical.\n::meta {"offer":true}` }], api: 'fictional', provider: 'fictional', model: 'fictional', stopReason: 'stop', timestamp: index, durationMs: 0, usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } }] });
    }
  }, host.context);
  const chat = createChatTransportHandler({ authenticate: async request => {
    const name = new URL(request.url).searchParams.get('thread'), conversation = host.threads[name];
    return conversation ? { conversation, context: host.context, abortSubmission: id => host.harness.abortSubmission(id, host.context, conversation.id) } : null;
  } });
  const bundle = await build({ entryPoints: [here('./page.jsx')], bundle: true, write: false, outdir: here('./out'), format: 'esm', platform: 'browser', jsx: 'automatic', alias: { '@': here('../app-shell') }, define: { 'process.env.NODE_ENV': '"production"' }, logLevel: 'silent' });
  const css = [await buildTailwind({ extraDirectories: ['examples/staged-chat', 'test/fixtures/themes'], extraFiles: ['examples/staged-chat/page.jsx'] }), stockShadowTokens, 'html,body,#root{min-height:100%;margin:0}body{background:var(--background);color:var(--foreground);font-family:var(--font-sans,ui-sans-serif,system-ui,sans-serif)}'].join('\n');
  const page = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Notes de triage fictives</title><link rel="stylesheet" href="/app.css">${themePreviewHead}</head><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>`;
  const statics = { ...themePreviewStatics, '/': ['text/html; charset=utf-8', page], '/app.js': ['text/javascript', bundle.outputFiles.find(file => file.path.endsWith('.js')).text], '/app.css': ['text/css', css] };
  const server = createServer(async (incoming, outgoing) => {
    const url = new URL(incoming.url, `http://${incoming.headers.host}`), abort = new AbortController();
    outgoing.on('close', () => abort.abort());
    try {
      const fixed = incoming.method === 'GET' && statics[url.pathname];
      if (fixed) return void outgoing.writeHead(200, { 'content-type': fixed[0], 'cache-control': 'no-store' }).end(fixed[1]);
      const request = await webRequest(incoming, url, { signal: abort.signal });
      if (!request) return void outgoing.writeHead(413).end();
      let response;
      const name = url.searchParams.get('thread');
      if (url.pathname === '/chat') response = await chat(request);
      else if (!Object.hasOwn(host.threads, name)) response = new Response(null, { status: 404 });
      else if (url.pathname === '/state' && request.method === 'GET') response = Response.json(await host.readerState(name));
      else if (url.pathname === '/action' && request.method === 'POST') {
        const body = await request.json();
        response = ['seen', 'offer'].includes(body.action) && typeof body.key === 'string' && body.key.length < 200 ? Response.json(await host.act(name, body.action, body.key)) : new Response(null, { status: 400 });
      } else response = new Response(null, { status: 404 });
      await sendWebResponse(response, outgoing, { signal: abort.signal });
    } catch (error) { if (!abort.signal.aborted) console.error(error); if (!outgoing.headersSent) outgoing.writeHead(500); outgoing.end(); }
  });
  await new Promise(resolve => server.listen(port, '127.0.0.1', resolve));
  return { host, url: `http://127.0.0.1:${server.address().port}/`, close: async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await host.close(); } };
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const app = await startStagedChat({ port: Number(process.env.PORT ?? 0) }); console.log(`Fictional staged chat at ${app.url}`);
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { void app.close().finally(() => process.exit(0)); });
}
