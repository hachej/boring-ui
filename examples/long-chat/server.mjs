import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { AssistantEntry, Harness, MemoryStorage, UserEntry, createRegistry } from '@earendil-works/pi-durable';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import { sendWebResponse, webRequest } from '@hachej/boring-files/node-http';
import { createChatTransportHandler } from '@hachej/boring-agent/chat-transport';
import { createScriptedModel } from '@hachej/boring-testing/model';
import { buildTailwind } from '../../lab/studio/tailwind.mjs';
import { stockShadowTokens, themePreviewHead, themePreviewStatics } from '../../test/fixtures/themes/preview.mjs';

const here = name => fileURLToPath(new URL(name, import.meta.url));
const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
const reply = index => `## Fictional note ${index}\n\nA **fictional** answer with \`inline code\` and [a link](https://example.com).\n\n- Pack the blanket\n- Check the weather\n- Bring ${index % 7 + 1} thermos\n\n\`\`\`text\nFictional list ${index}\n\`\`\``;

/** Loopback-only fixture: one fictional conversation of `messages` native records, for the transcript scroll budget. */
export async function startLongChat({ port = 0, messages = 500 } = {}) {
  const scripted = createScriptedModel({ fallback: () => 'A fictional reply.' });
  const harness = await Harness.open(new MemoryStorage(), { registry: createRegistry(), models: scripted.models }, context);
  const conversation = await harness.createConversation({ ownership: { kind: 'ownerless' }, agent: { model: scripted.model } }, context);
  await conversation.commit(async tx => {
    for (let index = 0; index < messages / 2; index++) {
      await tx.appendEntry(UserEntry, conversation.id, { model: [{ role: 'user', content: `Fictional question ${index + 1}: what should we bring to the picnic on day ${index + 1}?`, timestamp: index }] });
      await tx.appendEntry(AssistantEntry, conversation.id, { model: [{ role: 'assistant', content: [{ type: 'text', text: reply(index + 1) }], api: 'fictional', provider: 'fictional', model: 'fictional', stopReason: 'stop', timestamp: index, durationMs: 0, usage }] });
    }
  }, context);
  const chat = createChatTransportHandler({ authenticate: async () => ({ conversation, context }) });
  const bundle = await build({ entryPoints: [here('./page.jsx')], bundle: true, write: false, outdir: here('./out'), format: 'esm', platform: 'browser', jsx: 'automatic', alias: { '@': here('../app-shell') }, define: { 'process.env.NODE_ENV': '"production"' }, logLevel: 'silent' });
  const css = [await buildTailwind({ extraDirectories: ['examples/long-chat'], extraFiles: ['examples/long-chat/page.jsx'] }), stockShadowTokens, 'html,body,#root{height:100%;margin:0}body{background:var(--background);color:var(--foreground);font-family:var(--font-sans,ui-sans-serif,system-ui,sans-serif)}'].join('\n');
  const page = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Fictional long chat</title><link rel="stylesheet" href="/app.css">${themePreviewHead}</head><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>`;
  const statics = { ...themePreviewStatics, '/': ['text/html; charset=utf-8', page], '/app.js': ['text/javascript', bundle.outputFiles.find(file => file.path.endsWith('.js')).text], '/app.css': ['text/css', css] };
  const server = createServer(async (incoming, outgoing) => {
    const url = new URL(incoming.url, `http://${incoming.headers.host}`), abort = new AbortController();
    outgoing.on('close', () => abort.abort());
    try {
      const fixed = incoming.method === 'GET' && statics[url.pathname];
      if (fixed) return void outgoing.writeHead(200, { 'content-type': fixed[0], 'cache-control': 'no-store' }).end(fixed[1]);
      const request = await webRequest(incoming, url, { signal: abort.signal });
      if (!request) return void outgoing.writeHead(413).end();
      await sendWebResponse(url.pathname === '/chat' ? await chat(request) : new Response(null, { status: 404 }), outgoing, { signal: abort.signal });
    } catch (error) { if (!abort.signal.aborted) console.error(error); if (!outgoing.headersSent) outgoing.writeHead(500); outgoing.end(); }
  });
  await new Promise(resolve => server.listen(port, '127.0.0.1', resolve));
  return { url: `http://127.0.0.1:${server.address().port}/`, close: async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await harness.close(context); } };
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const app = await startLongChat({ port: Number(process.env.PORT ?? 0) }); console.log(`Fictional long chat at ${app.url}`);
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { void app.close().finally(() => process.exit(0)); });
}
