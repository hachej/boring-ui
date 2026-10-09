// Feedback demo: "Fernhill Studio", a small fictional settings page with the AmbientChat agent bar whose composer has the Feedback
// button (feedback mode, then one chip; `?ui=classic` mounts the Release 1 picker, sheet, list and report instead). Feedback is kept
// by @hachej/boring-feedback/store as one file per report in a SQLite workspace (workspace.mjs), behind a small authenticated save/list/read route, and voice goes
// through `/api/transcribe` (transcribe-route.mjs and transcription.mjs, example glue an app replaces). Fictional content only; the
// bearer tokens are per-process fixtures for two invented people, not an identity provider.
//
// The bar's agent is the builder (builder.mjs): the feedback capability over this store and a small fictional `edit_page` tool, on a
// keyless scripted model by default. `@feedback/<id>.md` mentions in the chat are inlined by the store's mention reader with the
// person's access. `placeholderAgent` is the configuration without the capability. `/assistant` serves the same chat outside the page.
//
// Preview: after feedback, "preview" makes the builder call `browser_preview`, which waits until the person's page answers. The page
// runs its preview subagent (`@hachej/boring-feedback/preview`) on the `/api/llm` gateway, shows the banner, and answers through the chat
// transport's `?op=answer` (`answerBrowserPreview`): the approved changes become the ticket's acceptance criteria.
//
// Tickets (tickets.mjs): the builder writes a ticket as the Markdown file `tickets/<id>.md` of the same workspace with Pi's own `write`
// tool and shares it with `present`. A new ticket is mirrored once to the first sink that accepts the project (the file sink by default,
// whose link is `/tickets/<id>`; GitHub with `FEEDBACK_TICKET_REPO` and `GITHUB_TOKEN`) and the link is written back into its front matter.
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { Harness, createRegistry } from '@earendil-works/pi-durable';
import { openNodeSqliteStorage } from '@earendil-works/pi-durable/storage/sqlite/node';
import { createModels, createProvider } from '@earendil-works/pi-ai/models';
import { createAssistantMessageEventStream } from '@earendil-works/pi-ai/utils/event-stream';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import { defineAgent } from '@hachej/boring-agent/agents';
import { createChatTransportHandler } from '@hachej/boring-agent/chat-transport';
import { createMentionResolver } from '@hachej/boring-agent/mentions';
import { createFeedbackStore, feedbackMentionReader } from '@hachej/boring-feedback/store';
import { parseSaveRequest, saveResponseOf } from '@hachej/boring-feedback/ui';
import { createTicketSinks } from '@hachej/boring-feedback/tickets';
import { answerBrowserPreview } from '@hachej/boring-feedback/agent';
import { buildTailwind, registryCss } from '../studio/tailwind.mjs';
import { sendWebResponse, webRequest } from '@hachej/boring-files/node-http';
import { builderAgent } from './builder.mjs';
import { openFeedbackWorkspace } from './workspace.mjs';
import { transcribeHandler, transcriptionFromEnv } from './transcribe-route.mjs';
import { TICKETS_ROOT, ticketPage, ticketProjectFromEnv, ticketSinksFromEnv } from './tickets.mjs';
import { GATEWAY_PATH, modelGatewayHandler } from './model-gateway-route.mjs';

const here = name => fileURLToPath(new URL(name, import.meta.url));
const root = fileURLToPath(new URL('../../', import.meta.url));

export const APP = 'fernhill-settings';
export const FEEDBACK_ROOT = 'feedback/';
const PROVIDER = 'fernhill-feedback';
const MAX_BODY = 300 * 1024;

/** The two fictional people. Their tokens are made per process; `?as=bob` serves the page as Bob. */
export function fixturePeople() {
  const person = (key, display) => ({ key, display, token: randomUUID(), access: { scopeId: 'fernhill-studio', principalId: `p_fictional_${key}`, initiatorId: `p_fictional_${key}` } });
  return { ada: person('ada', 'Ada Fictional'), bob: person('bob', 'Bob Fictional') };
}

/**
 * An agent WITHOUT the feedback capability: a keyless scripted model that answers one fixed sentence. The default is the builder
 * (builder.mjs); pass `agent: placeholderAgent` for the annotation-plus-storage configuration with no feedback tool (FEEDBACK-5).
 */
export function placeholderAgent() {
  const model = { id: 'fernhill-placeholder', name: 'Fictional placeholder', provider: 'fernhill-fixture', api: 'fernhill-fixture-api', baseUrl: 'https://fixture.invalid',
    input: ['text'], reasoning: false, contextWindow: 8192, maxTokens: 256, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } };
  const stream = () => {
    const message = { role: 'assistant', content: [{ type: 'text', text: 'I am a placeholder in this demo. Use Feedback in the chat to leave feedback on the page; the builder agent that reads it comes later.' }],
      api: model.api, provider: model.provider, model: model.id, timestamp: Date.now(), stopReason: 'stop',
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
    const events = createAssistantMessageEventStream();
    events.push({ type: 'start', partial: message });
    events.push({ type: 'done', reason: 'stop', message });
    events.end(message);
    return events;
  };
  const models = createModels();
  models.setProvider(createProvider({ id: model.provider, models: [model], auth: { apiKey: { name: 'Fictional keyless provider', resolve: async () => ({ auth: {} }) } }, api: { stream, streamSimple: stream } }));
  const definition = defineAgent({ id: 'fernhill-assistant', model: { provider: model.provider, modelId: model.id }, instructions: 'You are a placeholder assistant in a fictional demo.' });
  return { definition, models };
}

/** The browser bundle. In development the WP8 transform stamps `data-source` on the page's elements, so picker labels and pins carry it. */
export async function buildBrowser({ source = true } = {}) {
  const development = source ? await (async () => {
    const { feedbackSourcePlugin } = await import('@hachej/boring-feedback/source');
    return { jsxDev: true, absWorkingDir: root, plugins: [feedbackSourcePlugin({ root, mode: 'development' })], define: { 'process.env.NODE_ENV': '"development"' } };
  })() : { define: { 'process.env.NODE_ENV': '"production"' } };
  const bundle = await build({ entryPoints: [here('./browser.jsx')], bundle: true, write: false, outdir: here('./out'), format: 'esm', platform: 'browser', jsx: 'automatic', logLevel: 'silent', ...development });
  return bundle.outputFiles.find(file => file.path.endsWith('.js')).text;
}

async function readJson(request) {
  const reader = request.body?.getReader();
  if (!reader) return undefined;
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > MAX_BODY) { await reader.cancel(); throw new RangeError('too large'); }
    chunks.push(value);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

/** The builder's own principal: it acts on behalf of the person whose conversation called it (`initiatorId`). */
export const BUILDER = { principalId: 'p_fictional_builder', display: 'Studio builder' };

/**
 * Starts the demo. `protection` is the store's declared root protection (nothing but this route writes the root here). `agent` is
 * `({ store, people, accessOf, page }) => ({ definition, models })`, the builder by default. `source: false` builds without development
 * source locations; `assets: false` serves no page (headless tests drive the routes and `say`). `transcription` is the provider behind
 * `/api/transcribe` (default: `transcriptionFromEnv()` of transcription.mjs, the keyless fake unless TRANSCRIPTION_API_KEY is set).
 * `project` is the `{ name, repos }` the builder works for and
 * `ticketSinks` is `({ linkFor }) => sinks` (defaults from the environment, tickets.mjs); `linkFor(ticket)` is the ticket's `/tickets/<id>` page. `modelGateway` overrides the `/api/llm` model gateway's
 * `configuration`, `budget` or `log` (model-gateway-route.mjs; default: from the environment, keyless scripted without a key).
 */
export async function startFeedbackApp({ directory, port = 0, protection = 'protected', source = process.env.FEEDBACK_SOURCE !== '0', agent = builderAgent, people = fixturePeople(), assets = true, transcription,
  project = ticketProjectFromEnv(), ticketSinks = ticketSinksFromEnv(), modelGateway = {} } = {}) {
  if (!directory) throw new Error('A data directory is required');
  mkdirSync(directory, { recursive: true });
  const buildId = `dev-${Date.now().toString(36)}`;
  const workspace = await openFeedbackWorkspace({ filename: join(directory, 'feedback.sqlite'), providerId: PROVIDER, scopeId: 'fernhill-studio', folders: [TICKETS_ROOT] });
  const { files } = workspace;
  const view = { kind: 'published' };
  // Host authorization: which subject-key prefixes each person may annotate and read. `revoke` removes a grant (FEEDBACK-8).
  const grants = new Map(Object.values(people).map(person => [person.access.principalId, new Set([`host:app-page:${APP}:`])]));
  grants.set(BUILDER.principalId, new Set([`host:app-page:${APP}:`]));
  const displayNames = new Map([...Object.values(people).map(person => [person.access.principalId, person.display]), [BUILDER.principalId, BUILDER.display]]);
  const granted = (principalId, key) => [...(grants.get(principalId) ?? [])].some(prefix => key.startsWith(prefix));
  // Test seams for the journeys, all host-side: lose the next publication reply after its commit (the store must reconcile it), and
  // hold resolutions until `n` have arrived, so two people's resolutions interleave after both have read the same revision.
  const faults = { loseReplies: 0, lostReplies: 0, gate: undefined };
  const publisher = { publish: async (request, access) => {
    const result = await files.publication.publish(request, access);
    if (faults.loseReplies > 0 && result.kind === 'committed') { faults.loseReplies--; faults.lostReplies++; throw new Error('fictional connection reset after commit'); }
    return result;
  } };
  const byToken = request => {
    const header = request.headers.get('authorization') ?? '';
    return Object.values(people).find(person => header === `Bearer ${person.token}`);
  };
  const store = createFeedbackStore({
    providerId: PROVIDER, view, reader: files, publisher, lookup: files.reconciliation, listFolder: workspace.listFolder,
    capabilities: await files.capabilities({ resource: { providerId: PROVIDER, path: FEEDBACK_ROOT.slice(0, -1) }, view }, people.ada.access),
    root: FEEDBACK_ROOT, operationNamespace: 'fernhill-feedback-v1', resolveAccess: request => byToken(request)?.access,
    // The builder may act only where both it and the person it acts for are granted, so a revocation reaches the person's agent too.
    authorizeSubject: (access, subject) => granted(access.principalId, subject.key) && (access.principalId !== BUILDER.principalId || granted(access.initiatorId, subject.key)),
    displayName: principalId => displayNames.get(principalId) ?? 'Someone', protection,
  });

  // The feedback route: Save admits the browser's per-draft operation id with this request's access; list and read filter by read.
  async function feedbackRoute(request, url) {
    const person = byToken(request);
    if (!person) return Response.json({ kind: 'denied', reason: 'Sign in to leave or read feedback.' }, { status: 401 });
    const access = person.access;
    if (url.pathname === '/api/feedback' && request.method === 'POST') {
      let body;
      try { body = await readJson(request); } catch { return Response.json({ kind: 'invalid', reason: 'The request body is not JSON or is too large.' }, { status: 400 }); }
      const parsed = parseSaveRequest(body);
      if (!parsed.ok) return Response.json({ kind: 'invalid', reason: parsed.reason }, { status: 400 });
      const { operationId, draft } = parsed.request;
      const result = await store.create(draft, access, { id: operationId, key: store.operationKey('create', draft, access) });
      const { status, body: answer } = saveResponseOf(result);
      return Response.json(answer, { status });
    }
    if (url.pathname === '/api/feedback' && request.method === 'GET') {
      const status = url.searchParams.get('status');
      const cursor = url.searchParams.get('cursor');
      const listed = await store.list({ ...(status === 'open' || status === 'addressed' ? { status } : {}), ...(cursor ? { cursor } : {}) }, access);
      return Response.json(listed, { status: listed.kind === 'available' ? 200 : listed.kind === 'denied' ? 403 : 503 });
    }
    const match = /^\/api\/feedback\/(fb_[1-9A-HJ-NP-Za-km-z]{16})$/.exec(url.pathname);
    if (match && request.method === 'GET') {
      const read = await store.read(match[1], access);
      return Response.json(read, { status: read.kind === 'available' ? 200 : read.kind === 'missing' ? 404 : read.kind === 'denied' ? 403 : 503 });
    }
    return Response.json({ kind: 'invalid', reason: 'not-found' }, { status: 404 });
  }

  // Voice: the 🎙 toggle of feedback mode posts its recording here (a keyless fake provider unless the host passes another).
  const transcribe = transcribeHandler({ provider: transcription ?? transcriptionFromEnv(), authorize: request => byToken(request) !== undefined });

  // Model gateway: browser-side Pi agents reach models through `/api/llm` with the page session; the key stays here.
  const llm = modelGatewayHandler({ ...modelGateway, authorize: request => byToken(request)?.access.principalId });

  // The fictional page state the builder's `edit_page` changes; the page polls `/api/page`.
  const pageState = { saveLabel: 'Save profile', version: 0 };
  const page = { state: () => ({ ...pageState }), edit: ({ target, label }) => {
    if (target === 'save-profile' && pageState.saveLabel !== label) { pageState.saveLabel = label; pageState.version++; }
    return { ...pageState };
  } };
  const agentStore = Object.freeze({ ...store, resolve: async (...args) => {
    const gate = faults.gate;
    if (gate) { gate.arrived++; if (gate.arrived >= gate.count) { faults.gate = undefined; gate.open(); } await gate.opened; }
    return store.resolve(...args);
  } });

  // The agent bar: one conversation per person on a durable native Harness.
  const personOfConversation = new Map();
  const accessOf = conversationId => {
    const person = personOfConversation.get(String(conversationId));
    if (!person) throw new Error('No person is bound to this conversation');
    return { scopeId: person.access.scopeId, principalId: BUILDER.principalId, initiatorId: person.access.principalId };
  };
  // Tickets: a write that creates `tickets/<id>.md` mirrors it to the first accepting sink before the write returns (tickets.mjs).
  let origin = '';
  const sinks = ticketSinks({ linkFor: ticket => `${origin}tickets/${ticket.id}` });
  const tickets = { files, root: workspace.root, sinks: createTicketSinks({ files, project, sinks, prefix: TICKETS_ROOT }) };
  const { definition, models } = await agent({ store: agentStore, people, accessOf, page, tickets, project });
  const registry = createRegistry();
  definition.install(registry);
  const harness = await Harness.open(await openNodeSqliteStorage(join(directory, 'session.sqlite')), { registry, models, env: () => workspace.env }, context);
  harness.resume();
  const conversations = new Map();
  const conversationOf = async person => {
    if (!conversations.has(person.key)) conversations.set(person.key, definition.createConversation(harness, context).then(conversation => {
      personOfConversation.set(String(conversation.id), person);
      return conversation;
    }));
    return conversations.get(person.key);
  };
  // `@feedback/<id>.md` mentions are inlined with the person's own read access (the store's mention reader).
  const prepareInputOf = person => createMentionResolver({ read: feedbackMentionReader(store, () => person.access) });
  const chat = createChatTransportHandler({ authenticate: async request => {
    const person = byToken(request);
    if (!person) return null;
    const conversation = await conversationOf(person);
    // The page's preview answers the builder's pending `browser_preview` call, with this person's session (FEEDBACK.md, "Preview").
    return { conversation, context, prepareInput: prepareInputOf(person), answer: (id, answer) => answerBrowserPreview(conversation, id, answer) };
  } });
  async function conversationRoute(request) {
    const person = byToken(request);
    if (!person) return Response.json({ reason: 'authentication-required' }, { status: 401 });
    return Response.json({ conversationId: String((await conversationOf(person)).id) });
  }

  const script = assets ? await buildBrowser({ source }) : '';
  const styles = assets ? await (async () => {
    const item = JSON.parse(readFileSync(join(root, 'registry.json'), 'utf8')).items.find(entry => entry.name === 'feedback');
    return [await buildTailwind(), registryCss(item), readFileSync(here('./host.css'), 'utf8')].join('\n');
  })() : '';
  const html = (person, outside) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>Fernhill Studio settings (fictional)</title><link rel="stylesheet" href="/styles.css"></head><body><div id="root"></div>
<script>window.__FEEDBACK__=${JSON.stringify({ token: person.token, person: person.display, identity: { runtimeId: 'feedback-demo', ...person.access }, app: APP, build: buildId, outside })}</script>
<script type="module" src="/app.js"></script></body></html>`;

  const server = createServer(async (incoming, outgoing) => {
    const url = new URL(incoming.url, `http://${incoming.headers.host}`);
    const closed = new AbortController();
    outgoing.on('close', () => closed.abort());
    try {
      if (assets && incoming.method === 'GET' && (url.pathname === '/' || url.pathname.startsWith('/settings') || url.pathname === '/assistant')) {
        const person = people[url.searchParams.get('as') ?? 'ada'] ?? people.ada;
        return void outgoing.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }).end(html(person, url.pathname === '/assistant'));
      }
      const ticket = /^\/tickets\/([^/]+)$/.exec(url.pathname);
      if (ticket && incoming.method === 'GET') {
        const person = people[url.searchParams.get('as') ?? 'ada'] ?? people.ada;
        const shown = await ticketPage({ reader: files, providerId: PROVIDER, access: person.access, id: ticket[1] });
        return void outgoing.writeHead(shown?.status ?? 404, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }).end(shown?.html ?? 'Not a ticket');
      }
      if (incoming.method === 'GET' && url.pathname === '/app.js') return void outgoing.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-store' }).end(script);
      if (incoming.method === 'GET' && url.pathname === '/styles.css') return void outgoing.writeHead(200, { 'content-type': 'text/css; charset=utf-8', 'cache-control': 'no-store' }).end(styles);
      const request = await webRequest(incoming, url, { signal: closed.signal });
      if (!request) return void outgoing.writeHead(413).end();
      const response = url.pathname === '/api/chat' ? await chat(request)
        : url.pathname === '/api/conversation' ? await conversationRoute(request)
          : url.pathname.startsWith('/api/feedback') ? await feedbackRoute(request, url)
            : url.pathname === '/api/transcribe' ? await transcribe(request)
            : url.pathname.startsWith(`${GATEWAY_PATH}/`) ? await llm(request)
            : url.pathname === '/api/page' ? (byToken(request) ? Response.json(page.state()) : Response.json({ reason: 'authentication-required' }, { status: 401 }))
            : Response.json({ reason: 'not-found' }, { status: 404 });
      await sendWebResponse(response, outgoing, { signal: closed.signal });
    } catch (error) {
      if (!outgoing.headersSent) outgoing.writeHead(500);
      outgoing.end();
      if (!closed.signal.aborted) console.error('request failed:', error?.message ?? error);
    }
  });
  await new Promise(resolve => server.listen(port, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}/`;
  return {
    url: `http://127.0.0.1:${server.address().port}/`, port: server.address().port, people, store, build: buildId, project, files,
    revoke: person => grants.get(people[person].access.principalId)?.clear(),
    grant: person => grants.get(people[person].access.principalId)?.add(`host:app-page:${APP}:`),
    page,
    /** Lose the reply of the next `count` committed publications (the commit stands). `lostReplies` counts the ones lost. */
    loseNextReply: (count = 1) => { faults.loseReplies += count; },
    get lostReplies() { return faults.lostReplies; },
    /** Hold the builder's next resolutions until `count` of them have arrived, then release them together. */
    gateResolves: count => { let open; const opened = new Promise(resolve => { open = resolve; }); faults.gate = { count, arrived: 0, open, opened }; },
    /** Headless: what the chat route does with one message from `person` (mentions inlined, then submitted), awaited to the end of
     * the turn. Returns the messages the turn added. */
    say: async (person, text) => {
      const conversation = await conversationOf(people[person]);
      const before = (await conversation.context(context)).messages.length;
      const content = await prepareInputOf(people[person])([{ type: 'text', text }]);
      const submission = await conversation.submit({ type: 'input', requestId: randomUUID(), content }, context);
      await submission.wait(context);
      await conversation.waitForIdle(context);
      return (await conversation.context(context)).messages.slice(before);
    },
    /** Every model-visible message of `person`'s conversation so far. */
    messages: async person => (await (await conversationOf(people[person])).context(context)).messages,
    close: async () => {
      server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
      await harness.close(context);
      workspace.close();
    },
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const directory = process.env.FEEDBACK_DATA ?? '.cache/feedback-app';
  const app = await startFeedbackApp({ directory, port: Number(process.env.PORT ?? 4193) });
  console.log(`Feedback demo on ${app.url}settings/profile (Ada; add ?as=bob for Bob; ${app.url}assistant is the chat outside the page). The builder runs on a keyless scripted model: mention a report with @, or say "check feedback", "show fb_…", "resolve fb_…", "create a ticket". Tickets go to ${app.project.repos.length && process.env.GITHUB_TOKEN ? `GitHub (${app.project.repos[0].repo})` : 'files (/tickets/<id>)'}. Fictional content only. Data in ${directory}.`);
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { app.close().finally(() => process.exit(0)); });
}
