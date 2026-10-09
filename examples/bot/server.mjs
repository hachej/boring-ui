// Bot host: one lifelong conversation (the Harness root) with OptChat memory, code mode and a self it redeploys.
// Sessions live in SQLite and survive a restart; the bot's files are a sandboxed virtual workspace snapshotted to disk.
// Fictional content only; the bearer token is a per-process local fixture, not an identity provider.
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { sendWebResponse, webRequest } from '@hachej/boring-files/node-http';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { Harness, createRegistry } from '@earendil-works/pi-durable';
import { openNodeSqliteStorage } from '@earendil-works/pi-durable/storage/sqlite/node';
import { createModels } from '@earendil-works/pi-ai/models';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import { createVirtualWorkspace } from '@hachej/boring-execution/virtual';
import { createChatTransportHandler } from '@hachej/boring-agent/chat-transport';
import { buildTailwind } from '../studio/tailwind.mjs';
import { createBot } from './agent.mjs';
import { SELF_SEED } from './self.mjs';

const PROVIDERS = {
  openai: { load: async () => (await import('@earendil-works/pi-ai/providers/openai')).openaiProvider(), model: 'gpt-5-mini', nap: 'gpt-5-nano' },
  anthropic: { load: async () => (await import('@earendil-works/pi-ai/providers/anthropic')).anthropicProvider(), model: 'claude-haiku-4-5', nap: 'claude-haiku-4-5' },
};
const here = name => fileURLToPath(new URL(name, import.meta.url));

/**
 * Start the bot. `provider` picks a built-in provider, or pass `modelsOverride` with `model` (and optionally `napModel`)
 * as { provider, modelId } for any other Models collection, such as the scripted one in journey.mjs. `memory` overrides
 * OptChat options (nodeBytes, viewBytes, ...).
 */
export async function startBot({ directory, port = 0, provider = process.env.BOT_PROVIDER ?? 'openai', model, napModel, modelsOverride, memory, token = randomUUID() } = {}) {
  if (!directory) throw new Error('A data directory is required');
  mkdirSync(directory, { recursive: true });
  let models = modelsOverride;
  if (!models) {
    const selected = PROVIDERS[provider];
    if (!selected) throw new Error(`Unknown provider ${provider}`);
    models = createModels(); models.setProvider(await selected.load());
    model ??= { provider, modelId: process.env.BOT_MODEL ?? selected.model };
    napModel ??= { provider, modelId: process.env.BOT_NAP_MODEL ?? selected.nap };
  }
  if (!model) throw new Error('Pass `model` with `modelsOverride`');

  // The bot's files: one sandboxed virtual workspace, saved once a second and on close.
  const snapshotPath = join(directory, 'workspace.json');
  const workspace = createVirtualWorkspace({ providerId: 'bot', files: existsSync(snapshotPath) ? JSON.parse(readFileSync(snapshotPath, 'utf8')) : SELF_SEED });
  const lease = await workspace.acquire({ operationId: 'bot', input: { cwd: '/workspace' } }, context);
  const env = lease.environment;
  const ok = result => { if (!result.ok) throw result.error; return result.value; };
  async function walk(path = '/workspace') {
    const files = [];
    if (!ok(await env.exists(path, context))) return files;
    for (const entry of ok(await env.listDir(path, context))) {
      const child = `${path}/${entry.name}`;
      if (entry.kind === 'directory') files.push(...await walk(child)); else if (entry.kind === 'file') files.push(child);
    }
    return files;
  }
  let persisted = '';
  async function persist() {
    const snapshot = {};
    for (const path of await walk()) snapshot[path] = ok(await env.readTextFile(path, context));
    const text = JSON.stringify(snapshot);
    if (text === persisted) return;
    writeFileSync(`${snapshotPath}.tmp`, text); renameSync(`${snapshotPath}.tmp`, snapshotPath); persisted = text;
  }
  const persisting = setInterval(() => { persist().catch(error => console.error('workspace snapshot failed:', error?.message ?? error)); }, 1000);

  let harness;
  const bot = await createBot({ context, env, directory, models, model, napModel, memory, get harness() { return harness; } });
  const registry = createRegistry();
  bot.install(registry);
  harness = await Harness.open(await openNodeSqliteStorage(join(directory, 'session.sqlite')), { registry, models, env: () => env }, context);
  // One conversation for life: the reserved root, created with the bot's agent the first time and reopened after.
  const conversation = await harness.root(context, { agent: bot.agent.agent });
  await bot.optIn(conversation);
  harness.resume();

  const human = { runtimeId: 'bot', scopeId: 'fictional-home', principalId: 'fictional-person', initiatorId: 'fictional-person' };
  const authenticated = request => request.headers.get('authorization') === `Bearer ${token}`;
  const chat = createChatTransportHandler({ authenticate: async request => authenticated(request) ? { conversation, context } : null });

  const bundle = await build({ entryPoints: [here('./browser.jsx')], bundle: true, write: false, outdir: here('./out'), format: 'esm', platform: 'browser', jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"' }, logLevel: 'silent' });
  const script = bundle.outputFiles.find(file => file.path.endsWith('.js')).text;
  // The pi-chat registry item's Tailwind utilities and shadcn tokens, compiled like the studio's, plus this app's shell.
  const styles = [await buildTailwind(), readFileSync(here('./bot.css'), 'utf8')].join('\n');
  const page = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover,interactive-widget=resizes-content"><title>Bot (fictional)</title>
<link rel="stylesheet" href="/styles.css"></head><body><div id="root"></div>
<script>window.__BOT__=${JSON.stringify({ token, identity: human, model: `${model.provider}/${model.modelId}` })}</script>
<script type="module" src="/app.js"></script></body></html>`;
  const statics = { '/': ['text/html; charset=utf-8', page], '/app.js': ['text/javascript; charset=utf-8', script], '/styles.css': ['text/css; charset=utf-8', styles] };

  async function api(request, url) {
    if (!authenticated(request)) return Response.json({ reason: 'authentication-required' }, { status: 401 });
    return await bot.routes(request, url, conversation.id) ?? Response.json({ reason: 'not-found' }, { status: 404 });
  }
  const server = createServer(async (incoming, outgoing) => {
    const url = new URL(incoming.url, `http://${incoming.headers.host}`);
    const closed = new AbortController();
    outgoing.on('close', () => closed.abort());
    try {
      const fixed = incoming.method === 'GET' && statics[url.pathname];
      if (fixed) return void outgoing.writeHead(200, { 'content-type': fixed[0], 'cache-control': 'no-store' }).end(fixed[1]);
      const request = await webRequest(incoming, url, { signal: closed.signal });
      if (!request) return void outgoing.writeHead(413).end();
      const response = url.pathname === '/api/chat' ? await chat(request) : await api(request, url);
      await sendWebResponse(response, outgoing, { signal: closed.signal });
    } catch (error) {
      if (!outgoing.headersSent) outgoing.writeHead(500);
      outgoing.end();
      if (!closed.signal.aborted) console.error('request failed:', error?.message ?? error);
    }
  });
  await new Promise(resolve => server.listen(port, '127.0.0.1', resolve));
  return {
    url: `http://127.0.0.1:${server.address().port}/`, port: server.address().port, token, model, harness, conversation, env, persist,
    close: async () => {
      clearInterval(persisting);
      server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
      await bot.dispose();
      await harness.close(context);
      await persist();
      await lease.release(context); workspace.dispose();
    },
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const directory = process.env.BOT_DATA ?? '.cache/bot';
  const app = await startBot({ directory, port: Number(process.env.PORT ?? 4192) }); // not 4190: ManageSieve, which Firefox refuses to open
  console.log(`Bot on ${app.url} (${app.model.provider}/${app.model.modelId}). Fictional content only. Data in ${directory}.`);
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { app.close().finally(() => process.exit(0)); });
}
