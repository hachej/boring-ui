// The app-shell example: a fictional fitness app ("Forme") and a one-screen template in <AppShell layout="screen"> (the page is ./page.tsx), with a coach
// agent and a product-manager agent shown by the AgentLayer. The server is only what the chats need: two agents on one durable native Harness
// (sessions in SQLite), one conversation each (plus the writer's workspace, resources and conversation list for layout C), and the chat transport behind a bearer check. It records every submit body and the screen context the transport
// hands to the host (`requestContext`), so the journey can prove what travelled. Fictional content only.
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync } from 'node:fs';
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
import { createRevisionHandler } from '@hachej/boring-files/revision-handler';
import { sendWebResponse, webRequest } from '@hachej/boring-files/node-http';
import { readFiles, writeFiles } from '../shared/workspace-tools.mjs';
import { buildTailwind } from '../studio/tailwind.mjs';

const here = name => fileURLToPath(new URL(name, import.meta.url));

/** The sidebar tokens the shadcn sidebar fixture uses; a host's own shadcn style defines them, the repository theme does not. */
const SIDEBAR_TOKENS = `:root{--sidebar:var(--background);--sidebar-foreground:var(--foreground);--sidebar-border:var(--border);--sidebar-accent:var(--accent);--sidebar-accent-foreground:var(--accent-foreground);--sidebar-ring:var(--ring)}
@theme inline{--color-sidebar:var(--sidebar);--color-sidebar-foreground:var(--sidebar-foreground);--color-sidebar-border:var(--sidebar-border);--color-sidebar-accent:var(--sidebar-accent);--color-sidebar-accent-foreground:var(--sidebar-accent-foreground);--color-sidebar-ring:var(--sidebar-ring)}`;

/** The few Tailwind preflight rules the shell's own markup relies on (a host's shadcn app has the whole preflight); in the base layer, so utilities win. */
const BASE = '@layer base{*,::before,::after{box-sizing:border-box}ul{list-style:none;margin:0;padding:0}h1,p{margin:0}}';

export async function startAppShell({ directory, port = 0, token = randomUUID(), scripted = process.env.STUDIO_MODEL === 'scripted' } = {}) {
  mkdirSync(join(directory, 'workspace'), { recursive: true });
  const models = scripted ? (await (await import('../studio/scripted-model.mjs')).createScriptedModels({ sources: (await import('./script.mjs')).SOURCES })).models : createModels();
  if (!scripted) models.setProvider((await import('@earendil-works/pi-ai/providers/openai')).openaiProvider());
  const person = { scopeId: 'fictional-team', principalId: 'fictional-person', initiatorId: 'fictional-person' };
  const env = new NodeExecutionEnv({ cwd: join(directory, 'workspace') });
  // The workspace of `?app=pm` (layout C): the same composition as examples/workspace-app, so AgentWorkspace runs unchanged.
  const root = join(directory, 'workspace'), agentAccess = { ...person, principalId: 'fictional-agent' };
  const db = openNodeConnection(join(directory, 'workspace.sqlite'));
  const files = createWorkspaceProvider({ identity: { providerId: 'workspace', instanceId: 'app', incarnation: 'app', viewId: 'published' }, fs: env, journal: createWorkspaceJournal(db) });
  const agents = {
    writer: defineAgent({ id: 'writer', model: { provider: 'openai', modelId: 'gpt-5-mini' }, instructions: 'You write short fictional documents for the person. Be brief.',
      tools: [createPresentTool({ workspace: { files, root, access: agentAccess } })],
      extensions: [readFiles, writeFiles, createFileGuard({ workspace: { files, root, access: agentAccess } })] }),
    coach: defineAgent({ id: 'coach', model: { provider: 'openai', modelId: 'gpt-5-mini' }, instructions: 'You coach a fictional walker. Be brief.', tools: [], extensions: [] }),
    pm: defineAgent({ id: 'pm', model: { provider: 'openai', modelId: 'gpt-5-mini' }, instructions: 'You are the product manager of a fictional fitness app. Be brief.', tools: [], extensions: [] }),
  };
  const registry = createRegistry();
  for (const agent of Object.values(agents)) agent.install(registry);
  const harness = await Harness.open(await openNodeSqliteStorage(join(directory, 'session.sqlite')), { registry, models, env: () => env }, context);
  const conversations = createConversations({ harness, context });
  harness.resume();
  const created = {};
  for (const [name, agent] of Object.entries(agents)) created[name] = await conversations.create(agent.id, { start: init => agent.createConversation(harness, context, { init }) });

  /** Submit bodies as the browser sent them, and the contexts the transport handed to `requestContext`. */
  const submits = [], contexts = [];
  const allowed = request => request.headers.get('authorization') === `Bearer ${token}`;
  const resources = createRevisionHandler({ resolve: async request => allowed(request) ? { provider: files, access: person } : null });
  const writerStart = init => agents.writer.createConversation(harness, context, { init });
  const handlers = {
    '/api/conversations': createConversationsHandler({ conversations, authenticate: async request => allowed(request) ? { owner: agents.writer.id, start: writerStart } : null }),
    '/api/resources': resources,
    '/api/chat': createChatTransportHandler({ authenticate: async request => {
      const params = new URL(request.url).searchParams, agent = agents[params.get('agent')], id = Number(params.get('conversation'));
      const conversation = allowed(request) && agent && Number.isSafeInteger(id) ? await conversations.open(agent.id, id) : undefined;
      return conversation ? { conversation, context, abortSubmission: submission => harness.abortSubmission(submission, context, conversation.id),
        requestContext: value => { contexts.push({ conversation: id, value }); } } : null;
    } }),
  };

  const bundle = await build({ entryPoints: [here('./page.tsx')], bundle: true, write: false, outdir: here('./out'), format: 'esm', platform: 'browser', jsx: 'automatic',
    alias: { '@': here('.') }, define: { 'process.env.NODE_ENV': '"production"' }, logLevel: 'silent' });
  const css = [await buildTailwind({ extraDirectories: ['examples/app-shell', 'registry/app-shell'], extraCss: SIDEBAR_TOKENS }), BASE, ...bundle.outputFiles.filter(file => file.path.endsWith('.css')).map(file => file.text),
    readFileSync(here('../../registry/feedback/feedback.css'), 'utf8'),
    'html,body,#root{min-height:100%;margin:0}body{background:var(--background);color:var(--foreground);font:15px/1.5 ui-sans-serif,system-ui,sans-serif}'].join('\n');
  const page = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>Forme (fictional)</title>
<link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script>window.__APP__=${JSON.stringify({ token, conversations: { coach: String(created.coach.id), pm: String(created.pm.id) }, identity: { runtimeId: 'app', ...person } })}</script>
<script type="module" src="/app.js"></script></body></html>`;
  const statics = { '/': ['text/html; charset=utf-8', page], '/app.js': ['text/javascript; charset=utf-8', bundle.outputFiles.find(file => file.path.endsWith('.js')).text], '/app.css': ['text/css; charset=utf-8', css],
    // The sandboxed preview frame, served as files from the app's origin (what a host does with the live-preview item's two files).
    '/preview-frame.html': ['text/html; charset=utf-8', readFileSync(here('../../registry/live-preview/preview-frame.html'), 'utf8')], '/preview-frame.js': ['text/javascript; charset=utf-8', readFileSync(here('../../registry/live-preview/preview-frame.js'), 'utf8')] };

  const server = createServer(async (incoming, outgoing) => {
    const url = new URL(incoming.url, `http://${incoming.headers.host}`);
    const closed = new AbortController();
    outgoing.on('close', () => closed.abort());
    try {
      const fixed = incoming.method === 'GET' && statics[url.pathname];
      if (fixed) return void outgoing.writeHead(200, { 'content-type': fixed[0], 'cache-control': 'no-store' }).end(fixed[1]);
      const handler = handlers[url.pathname];
      const request = handler && await webRequest(incoming, url, { signal: closed.signal });
      if (request && url.searchParams.get('op') === 'submit' && request.method === 'POST') submits.push({ agent: url.searchParams.get('agent'), body: await request.clone().json().catch(() => undefined) });
      await sendWebResponse(request ? await handler(request) : new Response(null, { status: handler ? 413 : 404 }), outgoing, { signal: closed.signal });
    } catch (error) {
      if (!outgoing.headersSent) outgoing.writeHead(500);
      outgoing.end();
      if (!closed.signal.aborted) console.error('request failed:', error?.message ?? error);
    }
  });
  await new Promise(resolve => server.listen(port, '127.0.0.1', resolve));
  return {
    url: `http://127.0.0.1:${server.address().port}/`, token, harness, conversations, submits, contexts,
    close: async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await conversations.dispose(); await harness.close(context); files.close(); db.close(); },
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const app = await startAppShell({ directory: process.env.APP_DATA ?? '.cache/app-shell', port: Number(process.env.PORT ?? 0) });
  console.log(`App shell example on ${app.url}. Fictional content only.`);
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { app.close().finally(() => process.exit(0)); });
}
