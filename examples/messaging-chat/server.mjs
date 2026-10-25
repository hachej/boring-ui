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
const at = (hour, minute) => Date.UTC(2026, 9, 25, hour, minute);
/** A fictional French coaching conversation: runs of one side, a pause that starts a new run, a list and a long message. */
export const conversation = [
  ['user', 'Bonjour Coach, que manger avant la séance de ce soir ?', at(16, 2)],
  ['assistant', 'Bonjour ! Une banane et un yaourt grec, environ deux heures avant, suffisent.', at(16, 3)],
  ['assistant', 'Pense aussi à boire :\n\n- un grand verre d’eau en rentrant\n- une petite gorgée toutes les dix minutes pendant la séance', at(16, 3)],
  ['user', 'Merci. Et après la séance ?', at(16, 5)],
  ['user', 'Plutôt riz et poulet ?', at(16, 5)],
  ['assistant', 'Oui, avec des légumes. Vise environ trente grammes de protéines dans l’heure qui suit.', at(16, 8)],
  ['user', 'Parfait, je note. Dernière question : et si je n’ai pas très faim le soir, je saute le repas ?', at(19, 40)],
  ['assistant', 'Ne le saute pas tout à fait : un fromage blanc avec un fruit et une poignée d’amandes feront très bien l’affaire. Dors bien !', at(19, 42)],
];

/** Loopback-only fixture: the fictional conversation above, served with PiChat's `messageStyle` (`?style=messaging`). */
export async function startMessagingChat({ port = 0 } = {}) {
  const scripted = createScriptedModel({ fallback: () => 'Une réponse fictive.' });
  const harness = await Harness.open(new MemoryStorage(), { registry: createRegistry(), models: scripted.models }, context);
  const thread = await harness.createConversation({ ownership: { kind: 'ownerless' }, agent: { model: scripted.model } }, context);
  await thread.commit(async tx => {
    for (const [role, text, timestamp] of conversation) {
      if (role === 'user') await tx.appendEntry(UserEntry, thread.id, { model: [{ role, content: text, timestamp }] });
      else await tx.appendEntry(AssistantEntry, thread.id, { model: [{ role, content: [{ type: 'text', text }], api: 'fictional', provider: 'fictional', model: 'fictional', stopReason: 'stop', timestamp, durationMs: 0, usage }] });
    }
  }, context);
  const chat = createChatTransportHandler({ authenticate: async () => ({ conversation: thread, context }) });
  const bundle = await build({ entryPoints: [here('./page.jsx')], bundle: true, write: false, outdir: here('./out'), format: 'esm', platform: 'browser', jsx: 'automatic', alias: { '@': here('../app-shell') }, define: { 'process.env.NODE_ENV': '"production"' }, logLevel: 'silent' });
  const css = [await buildTailwind({ extraDirectories: ['examples/messaging-chat'], extraFiles: ['examples/messaging-chat/page.jsx'] }), stockShadowTokens, 'html,body,#root{height:100%;margin:0}body{background:var(--background);color:var(--foreground);font-family:var(--font-sans,ui-sans-serif,system-ui,sans-serif)}'].join('\n');
  const page = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Coach fictif</title><link rel="stylesheet" href="/app.css">${themePreviewHead}</head><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>`;
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
  const app = await startMessagingChat({ port: Number(process.env.PORT ?? 0) }); console.log(`Fictional messaging chat at ${app.url}?style=messaging`);
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { void app.close().finally(() => process.exit(0)); });
}
