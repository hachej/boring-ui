// The accounts-payable demo server: one agent ("AP helper") on a durable native Harness, the app's backend (./ap.mjs), the Library (a
// workspace of documents served by the resource and revision handlers) and the chat transport behind a bearer check.
//   - request context: the browser's `{ placement, screen }` is stored per conversation and rendered into the prompt of each request
//     (`createPromptContext` + `renderRequestContext`); it is advice, never authority.
//   - tools: pending_approvals, get_invoice, show (move the viewer to a screen or any workspace file), decide_invoice (the app's `decide` behind the approval card),
//     and Pi's native read, write and edit over the Library's own provider (the file guard records agent writes: history entry 'agent' and a change event, no receipt).
// Imports shared helpers from examples/ by their current path; re-point them after the examples restructure. Fictional content only.
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { Harness, createRegistry, defineTool } from '@earendil-works/pi-durable';
import { openNodeSqliteStorage } from '@earendil-works/pi-durable/storage/sqlite/node';
import { NodeExecutionEnv } from '@earendil-works/pi-durable/env/node';
import { createModels } from '@earendil-works/pi-ai/models';
import { Type } from '@earendil-works/pi-ai';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import { defineAgent } from '@hachej/boring-agent/agents';
import { answerUserQuestion } from '@hachej/boring-agent/ask-user';
import { requireApproval } from '@hachej/boring-agent/approval';
import { createFileGuard } from '@hachej/boring-agent/file-guard';
import { createChatTransportHandler } from '@hachej/boring-agent/chat-transport';
import { createConversations, createConversationsHandler } from '@hachej/boring-agent/conversations';
import { createPromptContext, renderRequestContext } from '@hachej/boring-agent/prompt-context';
import { openNodeConnection } from '@hachej/boring-files/sqlite';
import { createWorkspaceJournal } from '@hachej/boring-files/journal';
import { createWorkspaceProvider } from '@hachej/boring-files/workspace';
import { createRevisionHandler } from '@hachej/boring-files/revision-handler';
import { sendWebResponse, webRequest } from '@hachej/boring-files/node-http';
import { readFiles, writeFiles } from '../../shared/workspace-tools.mjs';
import { buildTailwind } from '../../lab/studio/tailwind.mjs';
import { openAccountsPayable, decisionSchema } from './ap.mjs';
import { ACCOUNTS, COMPANY, POLICY, SUPPLIERS, contractPdf, invoicePdf } from './data.mjs';

const NAVIGATION_TTL_MS = 15_000;
const here = name => fileURLToPath(new URL(name, import.meta.url));
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
const text = value => ({ output: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value) }] });
const INSTRUCTIONS = `You are the AP helper of ${COMPANY}, a fictional company. You help one person approve supplier invoices. Be brief and concrete.
Each request starts with a request-context block: where the chat is placed and which screen the person is looking at. Follow its role: when docked, open what answers the question in the viewer with the show tool; when floating, do not move the page unless asked. Never change an invoice yourself: propose the decision, then call decide_invoice, which asks the person to approve it first. You can read, create and edit files in the workspace (the Library) with read, write and edit, and list them with list_files; after creating or changing a file the person should see, open it with show (screen file, with its path). The AP policy is in the Library (Policies/AP policy.md), supplier agreements are in Contracts/.`;

/** Seeds the workspace: Policies/AP policy.md and Contracts/ with one supply agreement per supplier. */
async function seedLibrary(files, access) {
  const locate = path => ({ resource: { providerId: 'workspace', path }, view: { kind: 'published' } });
  const documents = [['Policies/AP policy.md', new TextEncoder().encode(POLICY), 'text/markdown'],
    ...Object.values(SUPPLIERS).map(supplier => [supplier.contract, contractPdf(supplier), 'application/pdf'])];
  for (const [index, [path, bytes, mediaType]] of documents.entries()) {
    const result = await files.publication.publish({ operationId: `seed-library-${index}`, atomicity: 'all-or-nothing', changes: [{ kind: 'create', target: locate(path), expected: { kind: 'absent' }, bytes, mediaType }] }, access);
    if (result.kind !== 'committed') throw new Error(`Library seed ${path} failed: ${result.kind}`);
  }
}

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
  const models = scripted ? (await (await import('../../lab/studio/scripted-model.mjs')).createScriptedModels({ sources: (await import('./script.mjs')).SOURCES })).models : createModels();
  if (!scripted) models.setProvider((await import('@earendil-works/pi-ai/providers/openai')).openaiProvider());
  const person = { scopeId: 'fictional-ap-team', principalId: 'fictional-approver', initiatorId: 'fictional-approver' };
  const agentAccess = { ...person, principalId: 'fictional-agent' };
  const root = join(directory, 'workspace');
  const env = new NodeExecutionEnv({ cwd: root });
  const db = openNodeConnection(join(directory, 'library.sqlite'));
  const files = createWorkspaceProvider({ identity: { providerId: 'workspace', instanceId: 'ap', incarnation: 'ap', viewId: 'published' }, fs: env, journal: createWorkspaceJournal(db) });
  await seedLibrary(files, person);
  const ap = await openAccountsPayable({ filename: join(directory, 'ap.sqlite'), person });

  // What the browser said about itself with each submit, by conversation; and what the agent asked the viewer to show.
  const contexts = [], latest = new Map(), navigation = [];
  const navigate = command => { navigation.push({ seq: navigation.length + 1, at: Date.now(), ...command }); };
  const lines = invoice => `${invoice.id} ${SUPPLIERS[invoice.supplier].name} ${invoice.amount.toFixed(2)} ${invoice.currency} due ${invoice.due}, ${invoice.status}`;
  const tools = [
    defineTool({ name: 'pending_approvals', description: 'List the invoices waiting for a decision this week.', parameters: Type.Object({}, { additionalProperties: false }), replay: 'safe',
      execute: async () => text((await ap.list()).filter(invoice => invoice.status === 'pending' && invoice.week).map(lines).join('\n') || 'None.') }),
    defineTool({ name: 'get_invoice', description: 'Read one invoice with its supplier and any look-alike invoices.', parameters: Type.Object({ id: Type.String() }, { additionalProperties: false }), replay: 'safe',
      execute: async ({ id }) => {
        const invoice = await ap.read(id);
        if (!invoice) return { ...text(`No invoice ${id}.`), isError: true };
        const matches = ap.duplicatesOf(invoice, await ap.list()).map(lines);
        return text({ ...invoice, supplier: SUPPLIERS[invoice.supplier].name, terms: SUPPLIERS[invoice.supplier].terms, lookAlikes: matches });
      } }),
    defineTool({ name: 'show', description: 'Open something in the viewer beside the chat: the approvals queue, an invoice (with id), a supplier (with id) or any workspace file (screen file, with its path). Use it when the chat is docked.',
      parameters: Type.Object({ screen: Type.Union([Type.Literal('approvals'), Type.Literal('invoice'), Type.Literal('supplier'), Type.Literal('file')]), id: Type.Optional(Type.String()), path: Type.Optional(Type.String()) }, { additionalProperties: false }), replay: 'unsafe',
      execute: async (args, api) => {
        // The command belongs to the conversation that made it and to the tab that was talking to it; the page drops it otherwise.
        if (args.screen === 'file' && !args.path) return { ...text('Name the file to open as path.'), isError: true };
        const conversation = String(api.conversationId);
        navigate({ conversation, tab: latest.get(conversation)?.tab, ...args });
        return text(`Opened ${args.screen === 'file' ? args.path : `${args.screen}${args.id ? ` ${args.id}` : ''}`} in the viewer.`);
      } }),
    // The one way the agent changes an invoice: the app's own `decide`, after the person approves the card. Same receipt as the page's buttons.
    requireApproval(defineTool({ name: 'decide_invoice', description: `Approve an invoice, approve it coded to another account (action recode, account one of: ${ACCOUNTS.join(', ')}), or put it on hold. Pass the revision from get_invoice as expected: a changed invoice is refused.`,
      parameters: Type.Object({ invoice: Type.String(), action: Type.Union([Type.Literal('approve'), Type.Literal('recode'), Type.Literal('hold')]), account: Type.Optional(Type.String()), note: Type.Optional(Type.String()), expected: Type.String({ description: 'The invoice revision you read with get_invoice' }) }, { additionalProperties: false }), replay: 'unsafe',
      execute: async args => { const result = await ap.decide(args); return { ...text(result), isError: result.kind !== 'committed' }; } }),
    { summarize: ({ invoice, action, account }) => action === 'recode' ? `Approve ${invoice} coded to ${account}` : `${action === 'hold' ? 'Hold' : 'Approve'} ${invoice}` }),
  ];
  const agent = defineAgent({ id: 'ap-helper', model: { provider: 'openai', modelId: 'gpt-5-mini' }, instructions: INSTRUCTIONS, tools,
    extensions: [readFiles, writeFiles, createFileGuard({ workspace: { files, root, access: agentAccess } }),
      createPromptContext({ context: ({ conversationId }) => renderRequestContext(latest.get(String(conversationId))) })] });
  const registry = createRegistry();
  agent.install(registry);
  const harness = await Harness.open(await openNodeSqliteStorage(join(directory, 'session.sqlite')), { registry, models, env: () => env }, context);
  const conversations = createConversations({ harness, context });
  harness.resume();
  const start = init => agent.createConversation(harness, context, { init });
  // Earlier conversations, so the sessions list is not empty. The current one is created last and so listed first.
  const earlier = [];
  for (const [title, question] of [['Month-end close checklist', 'Remind me what is left in the month-end close.'], ['Fernhill Labels terms', 'What are the payment terms for Fernhill Labels?']]) {
    const old = await conversations.create(agent.id, { start, title });
    await (await old.submit({ type: 'input', requestId: `seed-${old.id}`, content: question }, context)).wait(context);
    earlier.push(String(old.id));
  }
  const current = await conversations.create(agent.id, { start, title: 'This week\'s approvals' });

  const voice = !scripted && process.env.OPENAI_API_KEY ? transcribeWith(process.env.OPENAI_API_KEY) : undefined;
  const allowed = request => request.headers.get('authorization') === `Bearer ${token}`;
  const submits = [];
  const handlers = {
    '/api/conversations': createConversationsHandler({ conversations, authenticate: async request => allowed(request) ? { owner: agent.id, start } : null }),
    ...(voice ? { '/api/transcribe': async request => allowed(request) && request.method === 'POST' ? voice(request) : new Response(null, { status: 401 }) } : {}),
    '/api/resources': createRevisionHandler({ resolve: async request => allowed(request) ? { provider: files, access: person } : null }),
    '/api/chat': createChatTransportHandler({ authenticate: async request => {
      const id = Number(new URL(request.url).searchParams.get('conversation'));
      const conversation = allowed(request) && Number.isSafeInteger(id) ? await conversations.open(agent.id, id) : undefined;
      return conversation ? { conversation, context, abortSubmission: submission => harness.abortSubmission(submission, context, conversation.id),
        answer: (callId, answer) => answerUserQuestion(conversation, callId, answer, context),
        requestContext: value => { latest.set(String(conversation.id), value); contexts.push({ conversation: String(conversation.id), value }); } } : null;
    } }),
    // The app's own routes: the page reads its state here and the buttons call the same `decide` as the agent's tool.
    '/api/ap': async request => {
      if (!allowed(request)) return new Response(null, { status: 401 });
      const url = new URL(request.url), route = url.pathname.slice('/api/ap'.length);
      if (request.method === 'GET' && route === '/state') {
        const invoices = await ap.list();
        return json({ invoices, duplicates: Object.fromEntries(invoices.map(invoice => [invoice.id, ap.duplicatesOf(invoice, invoices).map(other => other.id)])), suppliers: SUPPLIERS, accounts: ACCOUNTS, latest: navigation.length,
          // Only this tab's commands for the conversation it shows, and only fresh ones: a slow command is dropped, never delivered late.
          navigation: navigation.filter(item => item.seq > Number(url.searchParams.get('after') ?? 0) && item.conversation === url.searchParams.get('conversation') && item.tab === url.searchParams.get('tab') && Date.now() - item.at < NAVIGATION_TTL_MS) });
      }
      const pdf = /^\/pdf\/(INV-\d{4})$/.exec(route);
      if (request.method === 'GET' && pdf) { const invoice = await ap.read(pdf[1]); return invoice ? new Response(invoicePdf(invoice), { headers: { 'content-type': 'application/pdf' } }) : new Response(null, { status: 404 }); }
      const action = /^\/actions\/(approve|recode|hold)$/.exec(route);
      if (request.method === 'POST' && action) {
        const parsed = decisionSchema.safeParse({ ...(await request.json().catch(() => ({}))), action: action[1] });
        return parsed.success ? json(await ap.decide(parsed.data)) : json({ kind: 'denied', reason: 'Invalid request' }, 400);
      }
      return new Response(null, { status: 404 });
    },
  };

  const bundle = await build({ entryPoints: [here('./page.tsx')], bundle: true, write: false, outdir: here('./out'), format: 'esm', platform: 'browser', jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"' }, logLevel: 'silent' });
  const css = [await buildTailwind({ extraDirectories: ['demos/workspace', 'packages/ui/src', 'registry/feedback', 'registry/dock', 'registry/pi-app', 'registry/documents', 'registry/viewers'] }), ...bundle.outputFiles.filter(file => file.path.endsWith('.css')).map(file => file.text),
    '@layer base{*,::before,::after{box-sizing:border-box}ul,ol{list-style:none;margin:0;padding:0}h1,h2,h3,p{margin:0}button{border:0;background:transparent;padding:0;font:inherit;color:inherit;cursor:pointer}button:disabled{cursor:default}}',
    'html,body,#root{height:100%;margin:0}body{background:var(--background);color:var(--foreground);font:14px/1.5 ui-sans-serif,system-ui,sans-serif}'].join('\n');
  const page = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>${COMPANY} - Accounts payable (fictional)</title>
<link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script>window.__APP__=${JSON.stringify({ token, conversation: String(current.id), identity: { runtimeId: 'app', ...person }, voice: Boolean(voice) })}</script>
<script type="module" src="/app.js"></script></body></html>`;
  const statics = { '/': ['text/html; charset=utf-8', page], '/app.js': ['text/javascript; charset=utf-8', bundle.outputFiles.find(file => file.path.endsWith('.js')).text], '/app.css': ['text/css; charset=utf-8', css] };

  const server = createServer(async (incoming, outgoing) => {
    const url = new URL(incoming.url, `http://${incoming.headers.host}`);
    const closed = new AbortController();
    outgoing.on('close', () => closed.abort());
    try {
      const fixed = incoming.method === 'GET' && statics[url.pathname];
      if (fixed) return void outgoing.writeHead(200, { 'content-type': fixed[0], 'cache-control': 'no-store' }).end(fixed[1]);
      const handler = handlers[url.pathname] ?? (url.pathname.startsWith('/api/ap/') ? handlers['/api/ap'] : undefined);
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
    url: `http://127.0.0.1:${server.address().port}/`, token, harness, conversations, ap, contexts, navigation, navigate, submits, current: String(current.id), earlier,
    close: async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await conversations.dispose(); await harness.close(context); ap.close(); db.close(); },
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const app = await startWorkspaceDemo({ ...(process.env.APP_DATA ? { directory: process.env.APP_DATA } : {}), port: Number(process.env.PORT ?? 0) });
  console.log(`Workspace demo on ${app.url}  (fictional content only)`);
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { app.close().finally(() => process.exit(0)); });
}
