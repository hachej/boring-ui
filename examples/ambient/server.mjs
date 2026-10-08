// Ambient agent demo: a fictional "existing app" (a settings console) with the agent as a floating bar over it.
// One agent on a durable native Harness (sessions live in SQLite), behind the library chat transport on a real HTTP socket.
// The agent has a small workspace (Pi's read, write and edit behind the file guard, plus `present`), ask_user and one deliberately slow tool so a run stays visible for a while.
// Fictional content only; the bearer token is a local fixture, not an identity provider.
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { configureOffered, firstMessageTitle } from '../shared/conversation-host.mjs';
import { sendWebResponse, webRequest } from '@hachej/boring-files/node-http';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { Harness, createRegistry, defineTool } from '@earendil-works/pi-durable';
import { openNodeSqliteStorage } from '@earendil-works/pi-durable/storage/sqlite/node';
import { createModels } from '@earendil-works/pi-ai/models';
import { Type } from '@earendil-works/pi-ai';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import { defineAgent } from '@hachej/boring-agent/agents';
import { answerUserQuestion, createAskUserTool } from '@hachej/boring-agent/ask-user';
import { createPresentTool } from '@hachej/boring-agent/artifacts';
import { createFileGuard } from '@hachej/boring-agent/file-guard';
import { createChatTransportHandler } from '@hachej/boring-agent/chat-transport';
import { NodeExecutionEnv } from '@earendil-works/pi-durable/env/node';
import { openNodeConnection } from '@hachej/boring-files/sqlite';
import { createWorkspaceJournal } from '@hachej/boring-files/journal';
import { createWorkspaceProvider } from '@hachej/boring-files/workspace';
import { readFiles, writeFiles } from '../shared/workspace-tools.mjs';
import { createResourceHandler } from '@hachej/boring-files/remote';
import { buildTailwind } from '../studio/tailwind.mjs';

const here = name => fileURLToPath(new URL(name, import.meta.url));
const PROVIDERS = {
  openai: async () => (await import('@earendil-works/pi-ai/providers/openai')).openaiProvider(),
  anthropic: async () => (await import('@earendil-works/pi-ai/providers/anthropic')).anthropicProvider(),
};
const sleep = (ms, signal) => new Promise(resolve => { const timer = setTimeout(resolve, ms); signal?.addEventListener('abort', () => { clearTimeout(timer); resolve(); }, { once: true }); });

export const MODELS = ['gpt-5-mini', 'gpt-5-nano'];
export const INSTRUCTIONS = `You are the assistant inside "Northwind Console", a fictional settings console for an invented company. Be brief and friendly. Everything is fictional.
Use plain Markdown. When asked about the health or status of the console, call run_health_check (once, with the seconds the person asks for, default 15) and then report in two short bullet points with a bold lead-in.
When the person asks you to choose between options or you need a decision from them, call ask_user and wait for the answer before continuing; do not guess.
Write reports, policies and documents as Markdown files (the present tool says how to show and revise them).`;

export async function startAmbient({ directory, port = 0, provider = process.env.AMBIENT_PROVIDER ?? 'openai', modelsOverride, token = randomUUID(),
  // The deterministic test layer, as in the studio (../studio/scripted-model.mjs): chosen by the host process only, scripts in ./script.mjs.
  scripted = process.env.STUDIO_MODEL === 'scripted' } = {}) {
  if (!directory) throw new Error('A data directory is required');
  mkdirSync(directory, { recursive: true });
  let models = modelsOverride;
  if (scripted && !models) {
    provider = 'openai';
    models = (await (await import('../studio/scripted-model.mjs')).createScriptedModels({ sources: (await import('./script.mjs')).AMBIENT_SOURCES })).models;
  }
  if (!models) { models = createModels(); models.setProvider(await PROVIDERS[provider]()); }

  const human = { scopeId: 'fictional-console', principalId: 'fictional-person', initiatorId: 'fictional-person' };
  const agentAccess = { scopeId: human.scopeId, principalId: 'fictional-agent', initiatorId: human.principalId };
  // The workspace: a directory of files, one provider over it for the viewers and `present`, and the guard in front of Pi's file tools.
  const root = join(directory, 'workspace');
  mkdirSync(root, { recursive: true });
  const env = new NodeExecutionEnv({ cwd: root });
  const workspaceDb = openNodeConnection(join(directory, 'workspace.sqlite'));
  const files = createWorkspaceProvider({ identity: { providerId: 'workspace', instanceId: 'ambient', incarnation: 'ambient', viewId: 'published' }, fs: env, journal: createWorkspaceJournal(workspaceDb) });

  const healthCheck = defineTool({
    name: 'run_health_check', description: 'Run the console health check. It takes a while; pass how many seconds it should take (default 15, at most 60).',
    parameters: Type.Object({ seconds: Type.Optional(Type.Number({ minimum: 1, maximum: 60 })) }, { additionalProperties: false }), replay: 'safe',
    execute: async (args, _api, ctx) => {
      const seconds = Math.min(60, Math.max(1, Math.round(args.seconds ?? 15)));
      await sleep(seconds * 1000, ctx.abortSignal);
      return { content: [{ type: 'text', text: `Health check finished after ${seconds}s: API latency 82 ms (ok), webhook queue 0 pending (ok), last export Tuesday 02:14 (ok).` }] };
    },
  });
  const agent = defineAgent({ id: 'console-assistant', model: { provider, modelId: process.env.AMBIENT_MODEL ?? 'gpt-5-mini' }, instructions: INSTRUCTIONS,
    tools: [createAskUserTool(), healthCheck, createPresentTool({ workspace: { files, root, access: agentAccess } })],
    extensions: [readFiles, writeFiles, createFileGuard({ workspace: { files, root, access: agentAccess } })] });

  const registry = createRegistry();
  agent.install(registry);
  const harness = await Harness.open(await openNodeSqliteStorage(join(directory, 'session.sqlite')), { registry, models, env: () => env }, context);
  // Conversations survive a restart: the index and when each last had activity are small JSON files beside the session store.
  const indexPath = join(directory, 'conversations.json'), activityPath = join(directory, 'activity.json');
  const read = (path, fallback) => existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : fallback;
  const index = read(indexPath, []), activity = read(activityPath, {});
  const conversations = new Map(), titles = new Map();
  const touch = id => { activity[String(id)] = Date.now(); writeFileSync(activityPath, JSON.stringify(activity)); };
  async function create() {
    const conversation = await agent.createConversation(harness, context);
    conversations.set(String(conversation.id), conversation);
    index.push(conversation.id); writeFileSync(indexPath, JSON.stringify(index)); touch(conversation.id);
    return conversation;
  }
  for (const id of index) { const found = await harness.conversation(id, context); if (found) conversations.set(String(id), found); }
  harness.resume();

  // The conversation's title is its first message, read once.
  async function titleOf(conversation) {
    const known = titles.get(String(conversation.id));
    if (known) return known;
    const title = await firstMessageTitle(conversation, context, 60);
    if (title) titles.set(String(conversation.id), title);
    return title;
  }

  const authenticated = request => request.headers.get('authorization') === `Bearer ${token}`;
  const chat = createChatTransportHandler({ authenticate: async request => {
    const conversation = conversations.get(new URL(request.url).searchParams.get('conversation') ?? '');
    if (!authenticated(request) || !conversation) return null;
    if (request.method === 'POST') touch(conversation.id);
    return { conversation, context, abortSubmission: id => harness.abortSubmission(id, context, conversation.id), answer: (callId, answer) => answerUserQuestion(conversation, callId, answer),
      configure: change => configureOffered(conversation, change, context, model => model.provider === provider && MODELS.includes(model.modelId)) };
  } });
  const resourceHandler = createResourceHandler({ authenticate: async request => authenticated(request) ? human : null, reader: files, publisher: files.publication, lookup: files.reconciliation });
  async function api(request, url) {
    if (!authenticated(request)) return Response.json({ reason: 'authentication-required' }, { status: 401 });
    if (url.pathname === '/api/conversations' && request.method === 'GET') {
      const found = [...conversations.values()];
      return Response.json({ conversations: await Promise.all(found.map(async conversation => ({ id: String(conversation.id), title: await titleOf(conversation) ?? null, updatedAt: activity[String(conversation.id)] ?? null }))) });
    }
    if (url.pathname === '/api/conversations' && request.method === 'POST') return Response.json({ conversationId: String((await create()).id) });
    // The retained versions of one workspace file with their save times, newest first.
    if (url.pathname === '/api/history' && request.method === 'GET') return Response.json({ saves: files.saves(url.searchParams.get('path') ?? '') });
    return Response.json({ reason: 'not-found' }, { status: 404 });
  }

  // The browser bundle: the pi-chat registry source (AmbientChat) over the remote chat transport. Tailwind is the studio's library-API build.
  const bundle = await build({ entryPoints: [here('./browser.jsx')], bundle: true, write: false, outdir: here('./out'), format: 'esm', platform: 'browser', jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"' }, logLevel: 'silent' });
  const script = bundle.outputFiles.find(file => file.path.endsWith('.js')).text;
  const styles = [await buildTailwind(), readFileSync(here('./host.css'), 'utf8')].join('\n');
  const page = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover,interactive-widget=resizes-content"><title>Northwind Console (fictional)</title>
<link rel="stylesheet" href="/styles.css"></head><body><div id="root"></div>
<script>window.__AMBIENT__=${JSON.stringify({ token, identity: { runtimeId: 'ambient', ...human } })}</script>
<script type="module" src="/app.js"></script></body></html>`;
  const statics = { '/': ['text/html; charset=utf-8', page], '/app.js': ['text/javascript; charset=utf-8', script], '/styles.css': ['text/css; charset=utf-8', styles] };

  const server = createServer(async (incoming, outgoing) => {
    const url = new URL(incoming.url, `http://${incoming.headers.host}`);
    const closed = new AbortController();
    outgoing.on('close', () => closed.abort());
    try {
      const fixed = incoming.method === 'GET' && statics[url.pathname];
      if (fixed) return void outgoing.writeHead(200, { 'content-type': fixed[0], 'cache-control': 'no-store' }).end(fixed[1]);
      const request = await webRequest(incoming, url, { signal: closed.signal });
      if (!request) return void outgoing.writeHead(413).end();
      const response = url.pathname === '/api/chat' ? await chat(request) : url.pathname === '/api/resources' ? await resourceHandler(request) : await api(request, url);
      await sendWebResponse(response, outgoing, { signal: closed.signal });
    } catch (error) {
      if (!outgoing.headersSent) outgoing.writeHead(500);
      outgoing.end();
      if (!closed.signal.aborted) console.error('request failed:', error?.message ?? error);
    }
  });
  await new Promise(resolve => server.listen(port, '127.0.0.1', resolve));
  return {
    url: `http://127.0.0.1:${server.address().port}/`, port: server.address().port, token, provider, scripted, harness, conversations,
    close: async () => {
      server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
      await harness.close(context);
      workspaceDb.close?.();
    },
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const directory = process.env.AMBIENT_DATA ?? '.cache/ambient';
  // Not 4190: that is ManageSieve, a port Firefox refuses to open.
  const app = await startAmbient({ directory, port: Number(process.env.PORT ?? 4191) });
  console.log(`Ambient demo on ${app.url} (${app.provider}). Fictional content only. Data in ${directory}.`);
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { app.close().finally(() => process.exit(0)); });
}
