// The accounts-payable demo server on Node: the demo (./app.mjs: agent, tools, Library seed, routes) on a durable native Harness, the app's
// backend (./ap.mjs) and the Library (a workspace of documents on disk) behind a bearer check. The public copy runs the same demo on a
// Cloudflare Worker (./cloudflare/). Fictional content only.
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Harness, createRegistry } from '@earendil-works/pi-durable';
import { openNodeSqliteStorage } from '@earendil-works/pi-durable/storage/sqlite/node';
import { NodeExecutionEnv } from '@earendil-works/pi-durable/env/node';
import { createModels } from '@earendil-works/pi-ai/models';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import { createConversations } from '@hachej/boring-agent/conversations';
import { openNodeConnection } from '@hachej/boring-files/sqlite';
import { createWorkspaceJournal } from '@hachej/boring-files/journal';
import { createWorkspaceProvider } from '@hachej/boring-files/workspace';
import { sendWebResponse, webRequest } from '@hachej/boring-files/node-http';
import { openSqliteWorkspaces } from '../../shared/sqlite-workspaces.mjs';
import { openAccountsPayable } from './ap.mjs';
import { PERSON as person, createWorkspaceDemo, routeOf, scriptedModels, seedLibrary } from './app.mjs';
import { buildWorkspaceDemoAssets } from './assets.mjs';

const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

/** Speech to text for the composer's microphone: OpenAI's transcription, only when a key is set (the scripted public copy has none, so no microphone). */
const transcribeWith = key => async request => {
  const form = new FormData();
  form.set('model', 'gpt-4o-mini-transcribe');
  form.set('file', new File([await request.arrayBuffer()], 'speech.webm', { type: request.headers.get('content-type') ?? 'audio/webm' }));
  const response = await fetch('https://api.openai.com/v1/audio/transcriptions', { method: 'POST', headers: { authorization: `Bearer ${key}` }, body: form });
  return response.ok ? json({ text: (await response.json()).text ?? '' }) : json({ error: 'Transcription failed' }, 502);
};

export async function startWorkspaceDemo({ directory = mkdtempSync(join(tmpdir(), 'boring-workspace-demo-')), port = 0, token = randomUUID(), scripted = process.env.STUDIO_MODEL === 'scripted' } = {}) {
  mkdirSync(join(directory, 'workspace'), { recursive: true });
  const models = scripted ? await scriptedModels() : createModels();
  if (!scripted) models.setProvider((await import('@earendil-works/pi-ai/providers/openai')).openaiProvider());
  const root = join(directory, 'workspace');
  const env = new NodeExecutionEnv({ cwd: root });
  const db = openNodeConnection(join(directory, 'library.sqlite'));
  const files = createWorkspaceProvider({ identity: { providerId: 'workspace', instanceId: 'ap', incarnation: 'ap', viewId: 'published' }, fs: env, journal: createWorkspaceJournal(db) });
  await seedLibrary(files, person);
  const store = openSqliteWorkspaces({ filename: join(directory, 'ap.sqlite'), providerId: 'ap-invoices' });
  const ap = await openAccountsPayable({ files: store.workspace(person.scopeId), person });

  const demo = createWorkspaceDemo({ files, root, ap });
  const registry = createRegistry();
  demo.agent.install(registry);
  const harness = await Harness.open(await openNodeSqliteStorage(join(directory, 'session.sqlite')), { registry, models, env: () => env }, context);
  const conversations = createConversations({ harness, context });
  harness.resume();
  const { start, current, earlier } = await demo.openConversations(conversations, harness, context);

  const voice = !scripted && process.env.OPENAI_API_KEY ? transcribeWith(process.env.OPENAI_API_KEY) : undefined;
  const allowed = request => request.headers.get('authorization') === `Bearer ${token}`;
  const submits = [];
  const handlers = demo.handlers({ conversations, harness, context, start, allowed, voice });
  const assets = await buildWorkspaceDemoAssets();
  const page = assets.page(`<script>window.__APP__=${JSON.stringify({ token, conversation: current, identity: { runtimeId: 'app', ...person }, voice: Boolean(voice) })}</script>`);
  const statics = { ...assets.files, '/': ['text/html; charset=utf-8', page] };

  const server = createServer(async (incoming, outgoing) => {
    const url = new URL(incoming.url, `http://${incoming.headers.host}`);
    const closed = new AbortController();
    outgoing.on('close', () => closed.abort());
    try {
      const fixed = incoming.method === 'GET' && statics[url.pathname];
      if (fixed) return void outgoing.writeHead(200, { 'content-type': fixed[0], 'cache-control': 'no-store' }).end(fixed[1]);
      const handler = routeOf(handlers, url.pathname);
      const request = handler && await webRequest(incoming, url, { signal: closed.signal });
      if (request && url.pathname === '/api/chat' && url.searchParams.get('op') === 'submit' && request.method === 'POST') submits.push(await request.clone().json().catch(() => undefined));
      await sendWebResponse(request ? await handler(request) : new Response(null, { status: handler ? 413 : 404 }), outgoing, { signal: closed.signal });
    } catch (error) {
      if (!outgoing.headersSent) outgoing.writeHead(500);
      outgoing.end();
      if (!closed.signal.aborted) console.error('request failed:', error?.message ?? error);
    }
  });
  await new Promise(resolve => server.listen(port, '127.0.0.1', resolve));
  return {
    url: `http://127.0.0.1:${server.address().port}/`, token, harness, conversations, ap, contexts: demo.contexts, navigation: demo.navigation, navigate: demo.navigate, submits, current, earlier,
    /** How many operations the publication journal holds (agent writes add none: they are observed, never receipted). */
    publications: () => Number(db.all('SELECT COUNT(*) AS n FROM boring_operations')[0].n),
    close: async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await conversations.dispose(); await harness.close(context); store.close(); db.close(); },
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const app = await startWorkspaceDemo({ ...(process.env.APP_DATA ? { directory: process.env.APP_DATA } : {}), port: Number(process.env.PORT ?? 0) });
  console.log(`Workspace demo on ${app.url}  (fictional content only)`);
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { app.close().finally(() => process.exit(0)); });
}
