// The whole agent, inside one dedicated Web Worker of the user's tab: the durable native Harness on SQLite (OPFS),
// pi-ai model calls, the git repository with just-bash, and pi-codemode in nested workers. The page reaches it with
// ordinary Requests carried over postMessage (`@hachej/boring-browser/transport`), so the chat stack is the same one a server
// would run; pointing the page at a real server instead is a one-line change.
import { Harness, createRegistry } from '@earendil-works/pi-durable';
import { SqliteStorage } from '@earendil-works/pi-durable/storage/sqlite';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import { getOrThrow } from '@earendil-works/pi-durable/env';
import { openaiProvider } from '@earendil-works/pi-ai/providers/openai';
import { anthropicProvider } from '@earendil-works/pi-ai/providers/anthropic';
import { openaiCodexProvider } from '@earendil-works/pi-ai/providers/openai-codex';
import { createChatTransportHandler } from '@hachej/boring-agent/chat-transport';
import { answerUserQuestion } from '@hachej/boring-agent/ask-user';
import { serveRequests } from '@hachej/boring-browser/transport';
import { openBrowserSqlite, openBrowserSqliteConnection, wipeBrowserSqlite } from '@hachej/boring-browser/sqlite';
import { openSqliteFileSystem } from '@hachej/boring-files/sqlite-filesystem';
import { createModelAccessHandler, openBrowserModels } from '@hachej/boring-browser/models';
import { createOptChatMemory } from '@hachej/boring-agent/memory/optchat';
import { browserCodemode } from '@hachej/boring-browser/codemode';
import { openVirtualRepository } from '@hachej/boring-execution/virtual-sqlite';
import { GATEWAY_REQUIRED_HOSTS, openGateway, redirect } from './gateway.js';
import { INSTRUCTIONS, ROOT, SEED, createCodingAgent, listFiles } from './coding-agent.js';
import { createScriptedProvider } from './scripted.js';

const SQLITE = { wasmUrl: '/vendor/sqlite3.wasm' };
const scripted = new URL(self.location.href).searchParams.has('scripted');
const DEFAULT_MODELS = { openai: 'gpt-6-sol', anthropic: 'claude-sonnet-5-5', 'openai-codex': 'gpt-6-sol' };

async function boot() {
  const app = await openBrowserSqlite('/app.sqlite', SQLITE);
  const session = await openBrowserSqlite('/session.sqlite', SQLITE);

  // Any pi-ai provider can be registered here; the settings popover lists whatever this returns. The model in use is the
  // root conversation's own native setting; the gateway URL is this example's host setting (worker/gateway.js).
  const browser = await openBrowserModels({
    db: app,
    providers: [openaiProvider, anthropicProvider, openaiCodexProvider, ...(scripted ? [createScriptedProvider] : [])],
    defaultModels: DEFAULT_MODELS,
  });
  const gateway = await openGateway(app);
  if (scripted) {
    // The journey never contacts a production service: OpenAI's sign-in endpoints go to the dev server's fixture instead.
    const next = globalThis.fetch;
    globalThis.fetch = (input, init) => {
      const request = input instanceof Request ? input : new Request(input, init);
      const target = new URL(request.url);
      return target.host === 'auth.openai.com' ? redirect(next, request, `${self.location.origin}/fixture/openai-auth${target.pathname}${target.search}`) : next(input, init);
    };
  }

  // The repository's files are rows of their own SQLite file (the SQLite workspace backend of @hachej/boring-files): every write lands there
  // at once, so a closed tab loses nothing that was written.
  const files = await openBrowserSqliteConnection('/workspace.sqlite', SQLITE);
  const workspace = await openVirtualRepository({ fs: openSqliteFileSystem({ connection: files, workspace: 'browser-agent', cwd: ROOT }), root: ROOT, seed: SEED,
    seedMessage: 'Initial scratch project', author: { name: 'Browser Agent', email: 'agent@example.invalid' }, context });
  const codemode = browserCodemode({ wasmUrl: '/vendor/quickjs.wasm', workerUrl: '/codemode-worker.js' });
  const coding = createCodingAgent({ workspace, codemode });
  // OptChat memory: installed for everyone, selected per conversation. The root conversation starts without it; the page's
  // toggle adds or removes the extension with the native `configure`. Summaries use the conversation's current model.
  let harness, conversation;
  const memory = createOptChatMemory({ harness: () => harness, context, agentName: 'the assistant',
    summarizer: { models: browser.models, model: async id => (await (await harness.conversation(id, context)).agent(context)).model } });
  const registry = createRegistry();
  registry.install(coding.extension);
  registry.install(memory.extension);
  harness = await Harness.open(await SqliteStorage.open(session), { registry, models: browser.models, env: () => workspace.env }, context);
  const initial = scripted ? { provider: 'scripted', modelId: 'scripted' } : { provider: 'openai', modelId: DEFAULT_MODELS.openai };
  conversation = await harness.root(context, { agent: { model: initial, instructions: INSTRUCTIONS, extensions: [coding.extension] } });
  harness.resume();

  // Approve / Deny for gated tools is answered through the same operation as ask_user questions.
  const chat = createChatTransportHandler({ authenticate: async () => ({ conversation, context, answer: (callId, answer) => answerUserQuestion(conversation, callId, answer) }) });
  // catalog / model / sign-in routes for the provider-setup item, under /api/model, over the root conversation's native model
  const access = createModelAccessHandler(browser, conversation, context);
  /** What the popover shows: the handler's state plus this example's gateway setting and which providers need it. */
  async function modelState() {
    const state = await access.state();
    return { ...state, settings: { ...state.settings, gateway: gateway.url() },
      providers: state.providers.map(provider => ({ ...provider, needsGateway: browser.models.getModels(provider.id).some(model => GATEWAY_REQUIRED_HOSTS.includes(new URL(model.baseUrl).host)) })) };
  }

  const memorySelected = async () => (await conversation.agent(context)).extensions.some(extension => extension.name === memory.extension.name);
  async function memoryState() {
    const enabled = await memorySelected();
    return enabled ? { enabled, ...await memory.stats(conversation.id) } : { enabled };
  }

  async function gitLog() {
    const head = getOrThrow(await workspace.env.readTextFile('.git/HEAD', context)).trim();
    const commits = await workspace.repository.log().catch(() => []);
    return { branch: head.startsWith('ref: refs/heads/') ? head.slice(16) : head.slice(0, 7),
      commits: commits.map(entry => ({ oid: entry.oid.slice(0, 7), message: entry.commit.message.trim(), timestamp: entry.commit.author.timestamp })) };
  }
  const relative = path => typeof path === 'string' && path !== '' && !path.startsWith('/') && !path.split('/').some(part => part === '..' || part === '');

  async function state() {
    return { ...await modelState(), storage: { persistent: app.persistent && session.persistent && files.persistent }, isolated: self.crossOriginIsolated,
      files: await listFiles(workspace.env, context), git: await gitLog(), codemode: coding.runs, memory: await memoryState() };
  }

  async function route(request) {
    const url = new URL(request.url);
    if (url.pathname === '/api/model' && request.method === 'PUT') {
      const { gateway: next } = await request.clone().json().catch(() => ({}));
      if (typeof next === 'string') await gateway.set(next);
    }
    const modelAccess = await access(request);
    if (modelAccess) return modelAccess.ok && url.pathname.startsWith('/api/model') ? Response.json(await modelState()) : modelAccess;
    if (url.pathname === '/api/chat') return chat(request);
    if (url.pathname === '/api/state' && request.method === 'GET') return Response.json(await state());
    if (url.pathname === '/api/file' && request.method === 'GET') {
      const path = url.searchParams.get('path');
      const read = relative(path) ? await workspace.env.readTextFile(path, context) : undefined;
      return read?.ok ? Response.json({ path, text: read.value }) : Response.json({ reason: 'not-found' }, { status: 404 });
    }
    if (url.pathname === '/api/memory' && request.method === 'PUT') {
      const { enabled } = await request.json();
      if (typeof enabled !== 'boolean') return Response.json({ reason: 'enabled must be true or false' }, { status: 400 });
      await conversation.configure({ extensions: enabled ? { add: [memory.extension] } : { remove: [memory.extension] } }, context);
      return Response.json(await memoryState());
    }
    if (url.pathname === '/api/reset' && request.method === 'POST') {
      await memory.dispose();
      await harness.close(context).catch(() => {});
      await workspace.close(); files.close(); await app.close(); await session.close();
      await wipeBrowserSqlite(SQLITE);
      return Response.json({ ok: true });
    }
    return Response.json({ reason: 'not-found' }, { status: 404 });
  }
  return route;
}

serveRequests(boot());
