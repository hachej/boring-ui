// The accounts-payable demo without its host: the agent ("AP helper"), its tools, the Library seed, the seeded conversations and the HTTP
// handlers. Two hosts run it unchanged: the Node server (./server.mjs: files on disk, a native Harness) and the public Cloudflare Worker
// (./cloudflare/: one Durable Object per visitor, files in that object's SQLite, PiHarness). The host gives it the Library's provider, the
// app's backend (./ap.mjs) and Pi's Harness; nothing here imports Node or Workers APIs.
//   - request context: the browser's `{ placement, screen }` is stored per conversation and rendered into the prompt of each request
//     (`createPromptContext` + `renderRequestContext`); it is advice, never authority.
//   - tools: pending_approvals, get_invoice, show (move the viewer to a screen or any workspace file), decide_invoice (the app's `decide` behind the approval card),
//     and Pi's native read, write and edit over the Library's own provider (the file guard records agent writes: history entry 'agent' and a change event, no receipt).
// Fictional content only.
import { defineTool } from '@earendil-works/pi-durable';
import { Type } from '@earendil-works/pi-ai';
import { defineAgent } from '@hachej/boring-agent/agents';
import { answerUserQuestion } from '@hachej/boring-agent/ask-user';
import { requireApproval } from '@hachej/boring-agent/approval';
import { createFileGuard } from '@hachej/boring-agent/file-guard';
import { createChatTransportHandler } from '@hachej/boring-agent/chat-transport';
import { createConversationsHandler } from '@hachej/boring-agent/conversations';
import { createPromptContext, renderRequestContext } from '@hachej/boring-agent/prompt-context';
import { createRevisionHandler } from '@hachej/boring-files/revision-handler';
import { readFiles, writeFiles } from '../../shared/workspace-tools.mjs';
import { decisionSchema } from './ap.mjs';
import { validWorkspacePath } from './paths.mjs';
import { ACCOUNTS, BUDGETS, COMPANY, POLICY, SUPPLIERS, contractPdf, invoicePdf } from './data.mjs';

const NAVIGATION_TTL_MS = 15_000;
export const PERSON = { scopeId: 'fictional-ap-team', principalId: 'fictional-approver', initiatorId: 'fictional-approver' };
const AGENT_ACCESS = { ...PERSON, principalId: 'fictional-agent' };
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
const text = value => ({ output: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value) }] });
const INSTRUCTIONS = `You are the AP helper of ${COMPANY}, a fictional company. You help one person approve supplier invoices. Be brief and concrete.
Each request starts with a request-context block: where the chat is placed and which screen the person is looking at. Follow its role: when docked, open what answers the question in the viewer with the show tool; when floating, do not move the page unless asked. Never change an invoice yourself: propose the decision, then call decide_invoice, which asks the person to approve it first. You can read, create and edit files in the workspace (the Library) with read, write and edit, and list them with list_files; after creating or changing a file the person should see, open it with show (screen file, with its path). The AP policy is in the Library (Policies/AP policy.md), supplier agreements are in Contracts/.`;

/** The scripted model (no key, no spend): the studio's scripted provider answering from ./script.mjs. */
export async function scriptedModels() {
  const [{ createScriptedModels }, { SOURCES }] = await Promise.all([import('../../lab/studio/scripted-model.mjs'), import('./script.mjs')]);
  return (await createScriptedModels({ sources: SOURCES })).models;
}

/** Seeds the workspace: Policies/AP policy.md and Contracts/ with one supply agreement per supplier. */
export async function seedLibrary(files, access = PERSON) {
  const locate = path => ({ resource: { providerId: 'workspace', path }, view: { kind: 'published' } });
  // Stable operation ids: a restart on the same data repeats each seed (a committed one returns its receipt). The policy moved from
  // Library/ to Policies/ with a new id (the old `seed-library-0` names the old path); the contracts keep theirs.
  const documents = [['seed-policy-ap', 'Policies/AP policy.md', new TextEncoder().encode(POLICY), 'text/markdown'],
    ...Object.values(SUPPLIERS).map((supplier, index) => [`seed-library-${index + 1}`, supplier.contract, contractPdf(supplier), 'application/pdf'])];
  for (const [operationId, path, bytes, mediaType] of documents) {
    const result = await files.publication.publish({ operationId, atomicity: 'all-or-nothing', changes: [{ kind: 'create', target: locate(path), expected: { kind: 'absent' }, bytes, mediaType }] }, access);
    // `conflict`: the file is already there (the person edited it since the first start); a seed never overwrites.
    if (result.kind !== 'committed' && result.kind !== 'conflict') throw new Error(`Library seed ${path} failed: ${result.kind}`);
  }
}

/**
 * The agent and its per-host state. `files`: the Library's provider; `root`: the workspace root Pi's file tools see; `ap`: the backend.
 * `contexts`, `latest` and `navigation` are in memory: what the browser said with each submit, and the viewer commands the agent queued.
 */
export function createWorkspaceDemo({ files, root, ap }) {
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
      parameters: Type.Object({ screen: Type.Union([...['dashboard', 'approvals', 'invoices', 'invoice', 'suppliers', 'supplier', 'spend', 'payments', 'file'].map(screen => Type.Literal(screen))]), id: Type.Optional(Type.String()), path: Type.Optional(Type.String()) }, { additionalProperties: false }), replay: 'unsafe',
      execute: async (args, api) => {
        // The command belongs to the conversation that made it and to the tab that was talking to it; the page drops it otherwise.
        // A file path is checked here, before anything is queued: it must be a plain workspace-relative path of a file that exists.
        let command = args;
        if (args.screen === 'file') {
          const path = validWorkspacePath(args.path);
          if (!path) return { ...text('Not a workspace file path: give a path relative to the workspace root, such as Policies/AP policy.md (no leading /, no .. segments).'), isError: true };
          const found = await files.read({ target: { resource: { providerId: 'workspace', path }, view: { kind: 'published' } }, revision: { kind: 'latest' } }, PERSON);
          if (found.kind !== 'available') return { ...text(`No such file: ${path}.`), isError: true };
          command = { screen: 'file', path };
        }
        const conversation = String(api.conversationId);
        navigate({ conversation, tab: latest.get(conversation)?.tab, ...command });
        return text(`Opened ${command.screen === 'file' ? command.path : `${command.screen}${command.id ? ` ${command.id}` : ''}`} in the viewer.`);
      } }),
    // The one way the agent changes an invoice: the app's own `decide`, after the person approves the card. Same receipt as the page's buttons.
    requireApproval(defineTool({ name: 'decide_invoice', description: `Approve an invoice, approve it coded to another account (action recode, account one of: ${ACCOUNTS.join(', ')}), or put it on hold. Pass the revision from get_invoice as expected: a changed invoice is refused.`,
      parameters: Type.Object({ invoice: Type.String(), action: Type.Union([Type.Literal('approve'), Type.Literal('recode'), Type.Literal('hold')]), account: Type.Optional(Type.String()), note: Type.Optional(Type.String()), expected: Type.String({ description: 'The invoice revision you read with get_invoice' }) }, { additionalProperties: false }), replay: 'unsafe',
      execute: async args => { const result = await ap.decide(args); return { ...text(result), isError: result.kind !== 'committed' }; } }),
    { summarize: ({ invoice, action, account }) => action === 'recode' ? `Approve ${invoice} coded to ${account}` : `${action === 'hold' ? 'Hold' : 'Approve'} ${invoice}` }),
  ];
  const agent = defineAgent({ id: 'ap-helper', model: { provider: 'openai', modelId: 'gpt-5-mini' }, instructions: INSTRUCTIONS, tools,
    extensions: [readFiles, writeFiles, createFileGuard({ workspace: { files, root, access: AGENT_ACCESS } }),
      createPromptContext({ context: ({ conversationId }) => renderRequestContext(latest.get(String(conversationId))) })] });

  /**
   * The conversations a visitor starts with: two earlier ones (so the sessions list is not empty) and the current one, created last and
   * so listed first. Only on fresh data: a restart keeps the conversations it has (and never asks the model the seed questions again).
   */
  async function openConversations(conversations, harness, context) {
    const start = init => agent.createConversation(harness, context, { init });
    const existing = (await conversations.list({ owner: agent.id, archived: 'all' })).items;
    const earlier = [];
    if (existing.length === 0) for (const [title, question] of [['Month-end close checklist', 'Remind me what is left in the month-end close.'], ['Fernhill Labels terms', 'What are the payment terms for Fernhill Labels?']]) {
      const old = await conversations.create(agent.id, { start, title });
      await (await old.submit({ type: 'input', requestId: `seed-${old.id}`, content: question }, context)).wait(context);
      earlier.push(String(old.id));
    }
    const current = existing.length ? existing[0] : await conversations.create(agent.id, { start, title: 'This week\'s approvals' });
    if (existing.length) earlier.push(...existing.slice(1).map(item => String(item.id)));
    return { start, current: String(current.id), earlier };
  }

  /**
   * The routes, by path. `allowed(request)` is the host's gate (the Node server's bearer token; the Worker has already picked the visitor's
   * object). `submitThrough(conversation)` lets a host route submissions (the Worker's PiHarness); `voice` is an optional transcription route.
   */
  function handlers({ conversations, harness, context, start, allowed = () => true, submitThrough = conversation => conversation, voice }) {
    return {
      '/api/conversations': createConversationsHandler({ conversations, authenticate: async request => allowed(request) ? { owner: agent.id, start } : null }),
      ...(voice ? { '/api/transcribe': async request => allowed(request) && request.method === 'POST' ? voice(request) : new Response(null, { status: 401 }) } : {}),
      '/api/resources': createRevisionHandler({ resolve: async request => allowed(request) ? { provider: files, access: PERSON } : null }),
      '/api/chat': createChatTransportHandler({ authenticate: async request => {
        const id = Number(new URL(request.url).searchParams.get('conversation'));
        const conversation = allowed(request) && Number.isSafeInteger(id) ? await conversations.open(agent.id, id) : undefined;
        return conversation ? { conversation: submitThrough(conversation), context, abortSubmission: submission => harness.abortSubmission(submission, context, conversation.id),
          answer: (callId, answer) => answerUserQuestion(conversation, callId, answer, context),
          requestContext: value => { latest.set(String(conversation.id), value); contexts.push({ conversation: String(conversation.id), value }); } } : null;
      } }),
      // The app's own routes: the page reads its state here and the buttons call the same `decide` as the agent's tool.
      '/api/ap': async request => {
        if (!allowed(request)) return new Response(null, { status: 401 });
        const url = new URL(request.url), route = url.pathname.slice('/api/ap'.length);
        if (request.method === 'GET' && route === '/state') {
          const invoices = await ap.list();
          return json({ invoices, duplicates: Object.fromEntries(invoices.map(invoice => [invoice.id, ap.duplicatesOf(invoice, invoices).map(other => other.id)])), suppliers: SUPPLIERS, accounts: ACCOUNTS, budgets: BUDGETS, latest: navigation.length,
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
  }

  return { agent, contexts, latest, navigation, navigate, openConversations, handlers };
}

/** The handler for a path: exact routes, and everything under /api/ap/. */
export const routeOf = (handlers, pathname) => handlers[pathname] ?? (pathname.startsWith('/api/ap/') ? handlers['/api/ap'] : undefined);
