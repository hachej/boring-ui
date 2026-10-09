// One real vertical slice: native Harness + real model + SQLite documents behind a real HTTP socket.
// Fictional content only. The bearer token is a per-process local fixture, not an identity provider.
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { sendWebResponse, webRequest } from '@hachej/boring-files/node-http';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { Harness, MemoryStorage, createRegistry, defineExtension, defineTool, UserEntry, AssistantEntry } from '@earendil-works/pi-durable';
import { createModels } from '@earendil-works/pi-ai/models';
import { Type } from '@earendil-works/pi-ai';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import { openSqliteWorkspaces } from '../shared/sqlite-workspaces.mjs';
import { createResourceHandler } from '@hachej/boring-files/remote';
import { createConversationProjectionHandler } from '@hachej/boring-agent/projection';

const PROVIDERS = {
  openai: { load: async () => (await import('@earendil-works/pi-ai/providers/openai')).openaiProvider(), model: 'gpt-5-mini' },
  anthropic: { load: async () => (await import('@earendil-works/pi-ai/providers/anthropic')).anthropicProvider(), model: 'claude-haiku-4-5' },
};
const INSTRUCTIONS = `You maintain exactly one fictional Markdown document for the person in this chat.
Always call read_note first. If it is missing, call save_note with expected {"kind":"absent"}.
Otherwise call save_note with the complete new text and expected {"kind":"revision","revision":<the revision you read>}.
Preserve every existing line you were not asked to change. After saving, reply with one short sentence.`;

export async function startLiveSlice({ port = 0, provider = process.env.SLICE_PROVIDER ?? 'openai', model = process.env.SLICE_MODEL } = {}) {
  const selected = PROVIDERS[provider];
  if (!selected) throw new Error(`Unknown provider ${provider}`);
  const models = createModels();
  models.setProvider(await selected.load());
  const modelId = model ?? selected.model;
  if (!models.getModel(provider, modelId)) throw new Error(`Model ${provider}/${modelId} is not available`);

  const token = randomUUID();
  const human = { scopeId: 'fictional-project', principalId: 'fictional-person', initiatorId: 'fictional-person' };
  const agent = { scopeId: 'fictional-project', principalId: 'fictional-agent', initiatorId: 'fictional-person' };
  const target = { resource: { providerId: 'documents', path: 'notes.md' }, view: { kind: 'published' } };
  const resources = openSqliteWorkspaces({ filename: ':memory:', providerId: 'documents', authorize: () => true });

  const readTool = defineTool({
    name: 'read_note', description: 'Read the current saved document text and its exact revision.',
    parameters: Type.Object({}, { additionalProperties: false }), replay: 'safe',
    execute: async () => {
      const read = await resources.read({ target, revision: { kind: 'latest' } }, agent);
      const body = read.kind === 'available'
        ? { kind: 'available', revision: read.snapshot.ref.revision, text: new TextDecoder().decode(read.snapshot.bytes) }
        : { kind: read.kind };
      return { content: [{ type: 'text', text: JSON.stringify(body) }] };
    },
  });
  // The slice's own conditional save (the agent package has no document tool: workspace agents use Pi's file tools behind the guard).
  const saveTool = defineTool({
    name: 'save_note', description: 'Save this document against its exact saved revision, or create it only if absent.',
    parameters: Type.Object({ text: Type.String(), expected: Type.Union([Type.Object({ kind: Type.Literal('absent') }), Type.Object({ kind: Type.Literal('revision'), revision: Type.String({ minLength: 1 }) })]) }, { additionalProperties: false }),
    execute: async (args, api) => {
      const bytes = new TextEncoder().encode(args.text);
      const result = await resources.publication.publish({ operationId: JSON.stringify(['live-slice-v1', api.taskId]), atomicity: 'all-or-nothing', changes: [args.expected.kind === 'absent'
        ? { kind: 'create', target, expected: { kind: 'absent' }, bytes, mediaType: 'text/markdown' }
        : { kind: 'replace', target: { ...target, revision: args.expected.revision }, bytes, mediaType: 'text/markdown' }] }, agent);
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    },
  });
  const registry = createRegistry();
  registry.install(defineExtension({ name: 'slice.document', tools: [readTool, saveTool] }));
  const harness = await Harness.open(new MemoryStorage(), { registry, models }, context);
  const conversation = await harness.createConversation({ ownership: { kind: 'ownerless' },
    agent: { model: { provider, modelId }, instructions: INSTRUCTIONS } }, context);

  const authenticated = request => request.headers.get('authorization') === `Bearer ${token}`;
  const revoked = new AbortController();
  const resourceHandler = createResourceHandler({ authenticate: async request => authenticated(request) ? human : null,
    reader: resources, publisher: resources.publication, lookup: resources.reconciliation });
  const projectionHandler = createConversationProjectionHandler({ authenticate: async request => authenticated(request) ? {
    runtimeId: 'live-slice', scopeId: human.scopeId, principalId: human.principalId, conversation, context,
    revoked: revoked.signal, authorize: async () => !revoked.signal.aborted,
    allowEntry: (_identity, entry) => entry.kind === UserEntry.kind || entry.kind === AssistantEntry.kind,
  } : null });
  // Host adapter: the library has no remote command transport yet, so admission is one small authenticated POST.
  async function submitHandler(request) {
    if (!authenticated(request)) return Response.json({ kind: 'denied' }, { status: 401 });
    const body = await request.json().catch(() => null);
    if (!body || typeof body.text !== 'string' || !body.text.trim() || body.text.length > 4000 || typeof body.requestId !== 'string') return Response.json({ kind: 'invalid' }, { status: 400 });
    const submission = await conversation.submit({ type: 'input', requestId: body.requestId, content: body.text, whenBusy: 'queue' }, context);
    return Response.json({ kind: 'admitted', submissionId: submission.id });
  }

  const bundle = await build({ entryPoints: [fileURLToPath(new URL('./browser.jsx', import.meta.url))], bundle: true, write: false,
    format: 'esm', platform: 'browser', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"' }, logLevel: 'silent' });
  const script = bundle.outputFiles[0].text;
  const page = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Fictional live slice</title>
<style>body{font:15px system-ui;margin:0;display:grid;grid-template-columns:1fr 1fr;gap:16px;padding:16px}
section{border:1px solid #ccc;border-radius:8px;padding:12px;min-height:80vh}textarea{width:100%;min-height:300px}
[data-role=user]{font-weight:600}[data-role]{margin:8px 0;white-space:pre-wrap}</style></head>
<body><script>window.__SLICE__=${JSON.stringify({ token, conversationId: conversation.id, identity: human, runtimeId: 'live-slice', target })}</script>
<script type="module" src="/app.js"></script></body></html>`;

  const server = createServer(async (incoming, outgoing) => {
    const url = new URL(incoming.url, `http://${incoming.headers.host}`);
    const closed = new AbortController();
    outgoing.on('close', () => closed.abort());
    try {
      if (incoming.method === 'GET' && url.pathname === '/') return void outgoing.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }).end(page);
      if (incoming.method === 'GET' && url.pathname === '/app.js') return void outgoing.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-store' }).end(script);
      const handler = url.pathname === '/resources' ? resourceHandler : url.pathname === '/conversation' ? projectionHandler : url.pathname === '/submit' ? submitHandler : null;
      if (!handler) return void outgoing.writeHead(404).end();
      const request = await webRequest(incoming, url, { signal: closed.signal });
      if (!request) return void outgoing.writeHead(413).end();
      const response = await handler(request);
      await sendWebResponse(response, outgoing, { signal: closed.signal });
    } catch (error) {
      if (!outgoing.headersSent) outgoing.writeHead(500);
      outgoing.end();
      if (!closed.signal.aborted) console.error('request failed:', error?.message ?? error);
    }
  });
  await new Promise(resolve => server.listen(port, '127.0.0.1', resolve));
  return {
    url: `http://127.0.0.1:${server.address().port}/`, provider, modelId, conversation, harness, resources, target, agent,
    close: async () => {
      revoked.abort();
      server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
      await harness.close(context);
      resources.close();
    },
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const app = await startLiveSlice({ port: Number(process.env.PORT ?? 4173) });
  console.log(`Live slice on ${app.url} using ${app.provider}/${app.modelId}. Fictional content only.`);
}
