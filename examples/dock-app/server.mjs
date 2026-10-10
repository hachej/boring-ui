// The dock example: a fictional host app ("Journal") in `DockMain`, an agent chat in a `Dock` on its left and a files `Dock` on its right.
// The server is only what the chat needs: one agent on a durable native Harness (sessions in SQLite), one conversation and the chat
// transport behind a bearer check. The docks are browser side (./page.tsx). Fictional content only.
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { Harness, createRegistry } from '@earendil-works/pi-durable';
import { openNodeSqliteStorage } from '@earendil-works/pi-durable/storage/sqlite/node';
import { NodeExecutionEnv } from '@earendil-works/pi-durable/env/node';
import { createModels } from '@earendil-works/pi-ai/models';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import { defineAgent } from '@hachej/boring-agent/agents';
import { createChatTransportHandler } from '@hachej/boring-agent/chat-transport';
import { createConversations } from '@hachej/boring-agent/conversations';
import { sendWebResponse, webRequest } from '@hachej/boring-files/node-http';
import { buildTailwind } from '../studio/tailwind.mjs';

const here = name => fileURLToPath(new URL(name, import.meta.url));

export async function startDockApp({ directory, port = 0, token = randomUUID(), scripted = process.env.STUDIO_MODEL === 'scripted' } = {}) {
  mkdirSync(join(directory, 'workspace'), { recursive: true });
  // The model: a real provider, or the keyless scripted layer of the journeys (./script.mjs), chosen by the host process only.
  const models = scripted ? (await (await import('../studio/scripted-model.mjs')).createScriptedModels({ sources: (await import('./script.mjs')).SOURCES })).models : createModels();
  if (!scripted) models.setProvider((await import('@earendil-works/pi-ai/providers/openai')).openaiProvider());
  const person = { scopeId: 'fictional-team', principalId: 'fictional-person', initiatorId: 'fictional-person' };
  const env = new NodeExecutionEnv({ cwd: join(directory, 'workspace') });
  const agent = defineAgent({ id: 'journal-helper', model: { provider: 'openai', modelId: 'gpt-5-mini' }, instructions: 'You help with a fictional journal. Be brief.', tools: [], extensions: [] });
  const registry = createRegistry();
  agent.install(registry);
  const harness = await Harness.open(await openNodeSqliteStorage(join(directory, 'session.sqlite')), { registry, models, env: () => env }, context);
  const conversations = createConversations({ harness, context });
  harness.resume();
  const start = init => agent.createConversation(harness, context, { init });
  const first = await conversations.create(agent.id, { start });

  const allowed = request => request.headers.get('authorization') === `Bearer ${token}`;
  const handlers = {
    '/api/chat': createChatTransportHandler({ authenticate: async request => {
      const id = Number(new URL(request.url).searchParams.get('conversation'));
      const conversation = allowed(request) && Number.isSafeInteger(id) ? await conversations.open(agent.id, id) : undefined;
      return conversation ? { conversation, context, abortSubmission: submission => harness.abortSubmission(submission, context, conversation.id) } : null;
    } }),
  };

  // The page: page.tsx bundled once, Tailwind over the registry blocks and this folder, the token, identity and conversation in the page.
  const bundle = await build({ entryPoints: [here('./page.tsx')], bundle: true, write: false, outdir: here('./out'), format: 'esm', platform: 'browser', jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"' }, logLevel: 'silent' });
  const css = [await buildTailwind({ extraDirectories: ['examples/dock-app'] }), ...bundle.outputFiles.filter(file => file.path.endsWith('.css')).map(file => file.text),
    'html,body,#root{height:100%;margin:0}body{background:var(--background);color:var(--foreground);font:15px/1.5 ui-sans-serif,system-ui,sans-serif}'].join('\n');
  const page = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>Dock app (fictional)</title>
<link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script>window.__APP__=${JSON.stringify({ token, conversation: String(first.id), identity: { runtimeId: 'app', ...person } })}</script>
<script type="module" src="/app.js"></script></body></html>`;
  const statics = { '/': ['text/html; charset=utf-8', page], '/app.js': ['text/javascript; charset=utf-8', bundle.outputFiles.find(file => file.path.endsWith('.js')).text], '/app.css': ['text/css; charset=utf-8', css] };

  const server = createServer(async (incoming, outgoing) => {
    const url = new URL(incoming.url, `http://${incoming.headers.host}`);
    const closed = new AbortController();
    outgoing.on('close', () => closed.abort());
    try {
      const fixed = incoming.method === 'GET' && statics[url.pathname];
      if (fixed) return void outgoing.writeHead(200, { 'content-type': fixed[0], 'cache-control': 'no-store' }).end(fixed[1]);
      const handler = handlers[url.pathname];
      const request = handler && await webRequest(incoming, url, { signal: closed.signal });
      await sendWebResponse(request ? await handler(request) : new Response(null, { status: handler ? 413 : 404 }), outgoing, { signal: closed.signal });
    } catch (error) {
      if (!outgoing.headersSent) outgoing.writeHead(500);
      outgoing.end();
      if (!closed.signal.aborted) console.error('request failed:', error?.message ?? error);
    }
  });
  await new Promise(resolve => server.listen(port, '127.0.0.1', resolve));
  return {
    url: `http://127.0.0.1:${server.address().port}/`, token, harness, conversations,
    close: async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await conversations.dispose(); await harness.close(context); },
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const app = await startDockApp({ directory: process.env.APP_DATA ?? '.cache/dock-app', port: Number(process.env.PORT ?? 0) });
  console.log(`Dock app on ${app.url}. Fictional content only.`);
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { app.close().finally(() => process.exit(0)); });
}
