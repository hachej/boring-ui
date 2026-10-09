// The smallest whole agent app: the pi-app block (page.jsx) over the host handlers it needs, and nothing from the studio's browser code.
// One agent on a durable native Harness (sessions in SQLite) that writes files and presents them; the composition below is the one the
// block's README documents: chat transport, conversations, resources and file history, behind one bearer check. Fictional content only.
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
import { createPresentTool } from '@hachej/boring-agent/artifacts';
import { createFileGuard } from '@hachej/boring-agent/file-guard';
import { createChatTransportHandler } from '@hachej/boring-agent/chat-transport';
import { createConversations, createConversationsHandler } from '@hachej/boring-agent/conversations';
import { openNodeConnection } from '@hachej/boring-files/sqlite';
import { createWorkspaceJournal } from '@hachej/boring-files/journal';
import { createWorkspaceProvider } from '@hachej/boring-files/workspace';
import { createResourceHandler } from '@hachej/boring-files/remote';
import { sendWebResponse, webRequest } from '@hachej/boring-files/node-http';
import { readFiles, writeFiles } from '../shared/workspace-tools.mjs';
import { buildTailwind } from '../studio/tailwind.mjs';

const here = name => fileURLToPath(new URL(name, import.meta.url));

export async function startWorkspaceApp({ directory, port = 0, token = randomUUID(), scripted = process.env.STUDIO_MODEL === 'scripted' } = {}) {
  mkdirSync(join(directory, 'workspace'), { recursive: true });
  // The model: a real provider, or the keyless scripted layer of the journeys (./script.mjs), chosen by the host process only.
  const models = scripted ? (await (await import('../studio/scripted-model.mjs')).createScriptedModels({ sources: (await import('./script.mjs')).SOURCES })).models : createModels();
  if (!scripted) models.setProvider((await import('@earendil-works/pi-ai/providers/openai')).openaiProvider());
  const person = { scopeId: 'fictional-team', principalId: 'fictional-person', initiatorId: 'fictional-person' };
  const agentAccess = { ...person, principalId: 'fictional-agent' };
  // One workspace: a directory, one provider over it (viewers, `present`, history) and the guard in front of Pi's file tools.
  const root = join(directory, 'workspace'), env = new NodeExecutionEnv({ cwd: root });
  const db = openNodeConnection(join(directory, 'workspace.sqlite'));
  const files = createWorkspaceProvider({ identity: { providerId: 'workspace', instanceId: 'app', incarnation: 'app', viewId: 'published' }, fs: env, journal: createWorkspaceJournal(db) });
  const agent = defineAgent({ id: 'writer', model: { provider: 'openai', modelId: 'gpt-5-mini' }, instructions: 'You write short fictional documents for the person. Be brief.',
    tools: [createPresentTool({ workspace: { files, root, access: agentAccess } })],
    extensions: [readFiles, writeFiles, createFileGuard({ workspace: { files, root, access: agentAccess } })] });
  const registry = createRegistry();
  agent.install(registry);
  const harness = await Harness.open(await openNodeSqliteStorage(join(directory, 'session.sqlite')), { registry, models, env: () => env }, context);
  const conversations = createConversations({ harness, context });
  harness.resume();
  // The list starts with one conversation; the sessions pane makes the others.
  const start = init => agent.createConversation(harness, context, { init });
  if (!(await conversations.list({ owner: agent.id })).items.length) await conversations.create(agent.id, { start });

  // ---- The host handlers the block talks to. Authentication (here one bearer token) and the owner key are the host's.
  const allowed = request => request.headers.get('authorization') === `Bearer ${token}`;
  const handlers = {
    '/api/conversations': createConversationsHandler({ conversations, authenticate: async request => allowed(request) ? { owner: agent.id, start } : null }),
    '/api/chat': createChatTransportHandler({ authenticate: async request => {
      const id = Number(new URL(request.url).searchParams.get('conversation'));
      const conversation = allowed(request) && Number.isSafeInteger(id) ? await conversations.open(agent.id, id) : undefined;
      return conversation ? { conversation, context, abortSubmission: submission => harness.abortSubmission(submission, context, conversation.id) } : null;
    } }),
    '/api/resources': createResourceHandler({ authenticate: async request => allowed(request) ? person : null, reader: files, publisher: files.publication, lookup: files.reconciliation }),
    '/api/history': async request => allowed(request) ? Response.json({ saves: files.saves(new URL(request.url).searchParams.get('path') ?? '') }) : new Response(null, { status: 401 }),
  };

  // ---- The page: page.jsx bundled once, Tailwind over the registry blocks, the token and identity in the page.
  const bundle = await build({ entryPoints: [here('./page.jsx')], bundle: true, write: false, outdir: here('./out'), format: 'esm', platform: 'browser', jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"' }, logLevel: 'silent' });
  const css = [await buildTailwind(), ...bundle.outputFiles.filter(file => file.path.endsWith('.css')).map(file => file.text),
    'html,body,#root{height:100%;margin:0}body{background:var(--background);color:var(--foreground);font:15px/1.5 ui-sans-serif,system-ui,sans-serif}'].join('\n');
  const page = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>Workspace app (fictional)</title>
<link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script>window.__APP__=${JSON.stringify({ token, identity: { runtimeId: 'app', ...person } })}</script>
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
    url: `http://127.0.0.1:${server.address().port}/`, token, harness, conversations, owner: agent.id,
    close: async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await conversations.dispose(); await harness.close(context); db.close(); },
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const app = await startWorkspaceApp({ directory: process.env.APP_DATA ?? '.cache/workspace-app', port: Number(process.env.PORT ?? 0) });
  console.log(`Workspace app on ${app.url}. Fictional content only.`);
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { app.close().finally(() => process.exit(0)); });
}
