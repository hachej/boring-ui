// The app-shell example: a fictional fitness app ("Forme") and a one-screen template in <AppShell layout="screen"> (the page is ./page.tsx), with a coach
// agent and a product-manager agent shown by the AgentLayer. The server is only what the chats need: two agents on one durable native Harness
// (sessions in SQLite), one conversation each (plus the writer's workspace, resources and conversation list for layout C), and the chat transport behind a bearer check. It records every submit body and the screen context the transport
// hands to the host (`requestContext`), so the journey can prove what travelled. Fictional content only.
import { createServer } from 'node:http';
import { rejectForeignHost, sameSecret } from '../../shared/local-host.mjs';
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { Harness, createRegistry, defineTool } from '@earendil-works/pi-durable';
import { Type } from '@earendil-works/pi-ai';
import { openNodeSqliteStorage } from '@earendil-works/pi-durable/storage/sqlite/node';
import { NodeExecutionEnv } from '@earendil-works/pi-durable/env/node';
import { createModels } from '@earendil-works/pi-ai/models';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import { defineAgent } from '@hachej/boring-agent/agents';
import { createPresentTool } from '@hachej/boring-agent/artifacts';
import { createFileGuard } from '@hachej/boring-agent/file-guard';
import { answerUserQuestion, createAskUserTool } from '@hachej/boring-agent/ask-user';
import { createChatTransportHandler } from '@hachej/boring-agent/chat-transport';
import { createConversations, createConversationsHandler } from '@hachej/boring-agent/conversations';
import { openNodeConnection } from '@hachej/boring-files/sqlite';
import { createWorkspaceJournal } from '@hachej/boring-files/journal';
import { createWorkspaceProvider } from '@hachej/boring-files/workspace';
import { createRevisionHandler } from '@hachej/boring-files/revision-handler';
import { createResourceHandler } from '@hachej/boring-files/remote';
import { sendWebResponse, webRequest } from '@hachej/boring-files/node-http';
import { readFiles, writeFiles } from '../../shared/workspace-tools.mjs';
import { buildTailwind } from '../../lab/studio/tailwind.mjs';

const here = name => fileURLToPath(new URL(name, import.meta.url));
// The PM's turn with the host task API, as on the live app: a read, a write the workspace refuses, `tasks_create` (its arguments streamed, so
// the step runs a moment), then a streamed Markdown reply. The member's thread (C7) shows pi-chat's standard tool trace, the reply and its
// request card, never the raw refusal.
const PM_TASK_TURNS = [{ tools: [{ name: 'read', args: { path: 'fiche-produit.md' } }], delay: 300 },
  { tools: [{ name: 'write', args: { path: '../outside/brief.md', content: '# Fictional brief' } }], delay: 300 },
  { tools: [{ name: 'tasks_create', args: { title: 'Protéines avant les calories sur les cartes repas' }, ms: 120 }], delay: 600 },
  { text: { chunks: ["C'est noté : ", '**Protéines avant les calories** ', 'sur les cartes repas ', 'de Ma journée.'], ms: 350 } }];
/** Two fictional HTML mockups of Coach Max's meal card, written by the PM, then presented. */
const mockup = (title, first, second) => `<!doctype html><html lang="fr"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${title}</title>
<style>body{margin:0;font:15px/1.4 system-ui,sans-serif;color:#18181b;background:#fff}main{padding:18px;display:flex;flex-direction:column;gap:12px}h1{font-size:20px;margin:0}.card{border:1px solid #e4e4e7;border-radius:14px;padding:14px}.big{font-size:28px;font-weight:800}.small{color:#52525b;font-size:13px}</style>
<main><h1>${title}</h1><div class="card"><div class="small">DÉJEUNER · Salade de lentilles, œuf</div><div class="big">${first}</div><div class="small">${second}</div></div><div class="card"><div class="small">DÎNER</div><div class="big">—</div></div></main></html>`;
// The mockup turn: two pages written and presented, then a choice with `ask_user`; the answer gets a one-line reply.
const PM_MOCKUP_TURNS = [{ text: 'Je prépare deux pistes.', tools: [{ name: 'write', args: { path: 'maquettes/piste-a.html', content: mockup('Piste A', '32 g de protéines', '520 kcal') } },
  { name: 'write', args: { path: 'maquettes/piste-b.html', content: mockup('Piste B', '520 kcal', 'Protéines 32 g · 25 % du jour') } }], delay: 300 },
  { tools: [{ name: 'present', args: { path: 'maquettes/piste-a.html' } }, { name: 'present', args: { path: 'maquettes/piste-b.html' } }], delay: 300 },
  { text: 'Laquelle préférez-vous ?', tools: [{ name: 'ask_user', args: { question: 'Quelle piste pour la carte repas ?', options: ['Piste A · protéines en grand', "Piste B · calories d'abord"] } }] },
  ctx => `Parfait : **${ctx.last?.json?.answer ?? 'noté'}**. Je l'ajoute à la demande.`];

/** A fictional product sheet with three saves, so its history has older revisions for the documents screen (`?documents=1`). */
async function seedDocuments(files, access) {
  const locate = path => ({ resource: { providerId: 'workspace', path }, view: { kind: 'published' } });
  const bytes = text => new TextEncoder().encode(text);
  const write = async (operationId, change) => {
    const result = await files.publication.publish({ operationId, atomicity: 'all-or-nothing', changes: [change] }, access);
    if (result.kind !== 'committed') throw new Error(`Fixture seed ${operationId} failed: ${result.kind}`);
    return result.receipt.changes[0].after.revision;
  };
  const first = await write('seed-fiche-1', { kind: 'create', target: locate('fiche-produit.md'), expected: { kind: 'absent' }, bytes: bytes('# Fiche produit\n\nBrouillon initial.\n'), mediaType: 'text/markdown' });
  const second = await write('seed-fiche-2', { kind: 'replace', target: { ...locate('fiche-produit.md'), revision: first }, bytes: bytes('# Fiche produit\n\nRelue par l’équipe.\n'), mediaType: 'text/markdown' });
  await write('seed-fiche-3', { kind: 'replace', target: { ...locate('fiche-produit.md'), revision: second }, bytes: bytes('# Fiche produit\n\nVersion validée.\n'), mediaType: 'text/markdown' });
}

/** The sidebar tokens the shadcn sidebar fixture uses; a host's own shadcn style defines them, the repository theme does not. */
const SIDEBAR_TOKENS = `:root{--sidebar:var(--background);--sidebar-foreground:var(--foreground);--sidebar-border:var(--border);--sidebar-accent:var(--accent);--sidebar-accent-foreground:var(--accent-foreground);--sidebar-ring:var(--ring)}
@theme inline{--color-sidebar:var(--sidebar);--color-sidebar-foreground:var(--sidebar-foreground);--color-sidebar-border:var(--sidebar-border);--color-sidebar-accent:var(--sidebar-accent);--color-sidebar-accent-foreground:var(--sidebar-accent-foreground);--color-sidebar-ring:var(--sidebar-ring)}`;

/** The few Tailwind preflight rules the shell's own markup relies on (a host's shadcn app has the whole preflight); in the base layer, so utilities win. */
const BASE = '@layer base{*,::before,::after{box-sizing:border-box}ul{list-style:none;margin:0;padding:0}h1,p{margin:0}a{color:inherit;text-decoration:inherit}}';

export async function startAppShell({ directory, port = 0, token = randomUUID(), scripted = process.env.STUDIO_MODEL === 'scripted', pageFile = here('./page.tsx'), browserPlugins = [], themeCss = '', pmTranscript, prefix = '/', pmTasks = false } = {}) {
  mkdirSync(join(directory, 'workspace'), { recursive: true });
  // `pmTasks`: the host's task API (`/_tasks/api`, fictional records) and a PM task tool whose result carries the new D-ref, as the one line reads them.
  // `is_requester`: the viewer filed D-202; D-190 is listed (mine=1) only because it once waited on them, so it is not theirs to withdraw.
  // Three finished requests, one per « Terminées » label (`closed_reason`): shipped (« En ligne »), withdrawn (« Retirée »), closed (« Fermée »).
  const tasks = pmTasks ? [{ id: randomUUID(), ref: 'D-202', title: 'Plan du jour : photo du déjeuner', state: 'open', created: '2026-10-27T09:00:00Z', updated: '2026-10-27T09:00:00Z', waiting_on_you: false, is_requester: true },
    { id: randomUUID(), ref: 'D-190', title: 'Un repère sur la jauge', state: 'open', created: '2026-10-26T09:00:00Z', updated: '2026-10-26T09:00:00Z', waiting_on_you: false, is_requester: false },
    { id: randomUUID(), ref: 'D-180', title: 'Graphique de la semaine', state: 'done', closed_reason: 'shipped', created: '2026-10-20T09:00:00Z', updated: '2026-10-24T09:00:00Z', waiting_on_you: false, is_requester: true },
    { id: randomUUID(), ref: 'D-181', title: 'Rappel du dimanche soir', state: 'closed', closed_reason: 'withdrawn', created: '2026-10-21T09:00:00Z', updated: '2026-10-23T09:00:00Z', waiting_on_you: false, is_requester: true },
    { id: randomUUID(), ref: 'D-182', title: 'Cartes repas en mode sombre', state: 'closed', closed_reason: 'closed', created: '2026-10-19T09:00:00Z', updated: '2026-10-22T09:00:00Z', waiting_on_you: false, is_requester: true }] : [];
  const answers = [], withdrawals = [];
  // `refuseTasks(true)`: the task list answers 403 until `refuseTasks(false)` (the host's list « unavailable for now »).
  let refusing = false;
  const createTask = defineTool({ name: 'tasks_create', description: 'File a fictional request for the person.', replay: 'safe', parameters: Type.Object({ title: Type.String() }), execute: async ({ title }) => {
    const task = { id: randomUUID(), ref: `D-${203 + tasks.length}`, title, state: 'waiting', created: '2026-10-29T08:00:00Z', updated: '2026-10-29T08:00:00Z', waiting_on_you: true, is_requester: true, question: 'Confirmez-vous cette demande ?' };
    tasks.push(task);
    // hachej/boring-factory#892's result: JSON `{ created, task: { id, number, title, state, status, updated_at } }` in the first text block.
    return { output: [{ type: 'text', text: JSON.stringify({ created: true, task: { id: task.id, number: task.ref, title, state: task.state, status: 'À confirmer', updated_at: task.updated } }) }] };
  } });
  const script = (await import('./script.mjs')).SOURCES.map(source => !pmTasks ? source : { ...source, entries: source.entries.map(entry => entry.match === 'pm.points@1' ? { ...entry, turns: PM_TASK_TURNS } : entry).concat(source.entries.some(entry => entry.match === 'pm.points@1') ? [{ match: 'deux maquettes', turns: PM_MOCKUP_TURNS }] : []) });
  const models = scripted ? (await (await import('../../lab/studio/scripted-model.mjs')).createScriptedModels({ sources: script })).models : createModels();
  if (!scripted) models.setProvider((await import('@earendil-works/pi-ai/providers/openai')).openaiProvider());
  const person = { scopeId: 'fictional-team', principalId: 'fictional-person', initiatorId: 'fictional-person' };
  const env = new NodeExecutionEnv({ cwd: join(directory, 'workspace') });
  // The workspace of `?app=pm` (layout C): the same composition as examples/workspace-app, so AgentWorkspace runs unchanged.
  const root = join(directory, 'workspace'), agentAccess = { ...person, principalId: 'fictional-agent' };
  const db = openNodeConnection(join(directory, 'workspace.sqlite'));
  const files = createWorkspaceProvider({ identity: { providerId: 'workspace', instanceId: 'app', incarnation: 'app', viewId: 'published' }, fs: env, journal: createWorkspaceJournal(db) });
  await seedDocuments(files, person);
  const agents = {
    writer: defineAgent({ id: 'writer', model: { provider: 'openai', modelId: 'gpt-5-mini' }, instructions: 'You write short fictional documents for the person. Be brief.',
      tools: [createPresentTool({ workspace: { files, root, access: agentAccess } })],
      extensions: [readFiles, writeFiles, createFileGuard({ workspace: { files, root, access: agentAccess } })] }),
    coach: defineAgent({ id: 'coach', model: { provider: 'openai', modelId: 'gpt-5-mini' }, instructions: 'You coach a fictional walker. Be brief.', tools: [], extensions: [] }),
    pm: defineAgent({ id: 'pm', model: { provider: 'openai', modelId: 'gpt-5-mini' }, instructions: 'You are the product manager of a fictional fitness app. Be brief.', tools: pmTasks ? [createTask, createAskUserTool(), createPresentTool({ workspace: { files, root, access: agentAccess } })] : [],
      extensions: pmTasks ? [readFiles, writeFiles, createFileGuard({ workspace: { files, root, access: agentAccess } })] : [] }),
  };
  const registry = createRegistry();
  for (const agent of Object.values(agents)) agent.install(registry);
  const harness = await Harness.open(await openNodeSqliteStorage(join(directory, 'session.sqlite')), { registry, models, env: () => env }, context);
  const conversations = createConversations({ harness, context });
  harness.resume();
  const created = {};
  for (const [name, agent] of Object.entries(agents)) created[name] = await conversations.create(agent.id, { start: init => agent.createConversation(harness, context, { init }) });

  /** Submit bodies as the browser sent them, and the contexts the transport handed to `requestContext`. */
  const submits = [], contexts = [], transcribes = [];
  let mealReads = 0;
  const allowed = request => sameSecret(request.headers.get('authorization'), `Bearer ${token}`);
  const resources = createRevisionHandler({ resolve: async request => allowed(request) ? { provider: files, access: person } : null });
  const writerStart = init => agents.writer.createConversation(harness, context, { init });
  // The in-app PM door as hachej/boring-factory#854 asks for it (a fake: fictional identity, scripted model), plus the host's dictation route
  // (fixed transcript; dictation belongs to the host, not the PM agent). Same origin stands for « signed in as the person » here; a real host
  // authenticates its own session.
  const signedIn = request => request.headers.get('sec-fetch-site') === 'same-origin';
  const pmStart = init => agents.pm.createConversation(harness, context, { init });
  const door = {
    '/api/pm/agent': async request => signedIn(request) && request.method === 'GET' ? Response.json({ agent: 'pm', identity: { runtimeId: 'app', ...person }, resources: { endpoint: 'api/pm/library' } }) : new Response(null, { status: 403 }),
    '/api/pm/conversations': createConversationsHandler({ conversations, authenticate: async request => signedIn(request) ? { owner: agents.pm.id, start: pmStart } : null }),
    '/api/pm/chat': createChatTransportHandler({ authenticate: async request => {
      const id = Number(new URL(request.url).searchParams.get('conversation'));
      const conversation = signedIn(request) && Number.isSafeInteger(id) ? await conversations.open(agents.pm.id, id) : undefined;
      return conversation ? { conversation, context, abortSubmission: submission => harness.abortSubmission(submission, context, conversation.id), answer: (callId, answer) => answerUserQuestion(conversation, callId, answer),
        requestContext: value => { contexts.push({ conversation: id, value }); } } : null;
    } }),
    '/api/host/transcribe': async request => {
      if (!signedIn(request) || request.method !== 'POST' || !pmTranscript) return new Response(null, { status: signedIn(request) ? 404 : 403 });
      transcribes.push({ language: new URL(request.url).searchParams.get('language'), bytes: (await request.arrayBuffer()).byteLength });
      return Response.json(pmTranscript);
    },
    // Match the actual PM door: resources is POST-only; Library serves revision discovery, catalog and reads without writes.
    '/api/pm/resources': createResourceHandler({ authenticate: async request => pmTasks && signedIn(request) ? person : null, reader: files }),
    '/api/pm/library': async request => {
      if (!pmTasks || !signedIn(request)) return new Response(null, { status: 403 });
      if (request.method === 'POST' && !request.headers.has('x-boring-catalog') && (await request.clone().json()).kind !== 'read') return new Response(null, { status: 403 });
      const headers = new Headers(request.headers);
      headers.set('authorization', `Bearer ${token}`);
      return resources(new Request(request, { headers }));
    },
    '/_tasks/api': async request => !pmTasks ? new Response(null, { status: 404 }) : !signedIn(request) || refusing ? new Response(null, { status: 403 })
      : Response.json({ tasks: new URL(request.url).searchParams.get('mine') === '1' ? tasks : [], cursor: String(tasks.length + answers.length) }),
  };
  /** `POST /_tasks/api/<id>/answer { text }`: the viewer answers the question the task waits on. */
  const answer = async (request, id) => {
    const task = tasks.find(each => each.id === id);
    if (!pmTasks || !signedIn(request) || request.method !== 'POST' || !task?.waiting_on_you) return new Response(null, { status: !pmTasks ? 404 : 403 });
    answers.push({ id, ref: task.ref, text: (await request.json()).text });
    // Confirmed, not started: the task stays `open` and carries `confirmed_at`.
    Object.assign(task, { state: 'open', waiting_on_you: false, question: undefined, confirmed_at: '2026-10-29T08:05:00Z', updated: '2026-10-29T08:05:00Z' });
    return Response.json({ ok: true });
  };
  /** `POST /_tasks/api/<id>/withdraw`: the requester withdraws a request nobody started. 404 for anyone else, 409 once work started. */
  const withdraw = async (request, id) => {
    const task = tasks.find(each => each.id === id);
    if (!pmTasks || !signedIn(request) || request.method !== 'POST' || task?.is_requester !== true) return new Response(null, { status: 404 });
    if (task.state !== 'open' && !task.waiting_on_you) return new Response(null, { status: 409 });
    withdrawals.push({ id, ref: task.ref });
    Object.assign(task, { state: 'closed', closed_reason: 'withdrawn', waiting_on_you: false, question: undefined, updated: '2026-10-29T08:10:00Z' });
    return Response.json({ task });
  };
  const handlers = {
    ...door,
    '/api/conversations': createConversationsHandler({ conversations, authenticate: async request => allowed(request) ? { owner: agents.writer.id, start: writerStart } : null }),
    '/api/resources': resources,
    '/api/chat': createChatTransportHandler({ authenticate: async request => {
      const params = new URL(request.url).searchParams, agent = agents[params.get('agent')], id = Number(params.get('conversation'));
      const conversation = allowed(request) && agent && Number.isSafeInteger(id) ? await conversations.open(agent.id, id) : undefined;
      return conversation ? { conversation, context, abortSubmission: submission => harness.abortSubmission(submission, context, conversation.id),
        requestContext: value => { contexts.push({ conversation: id, value }); } } : null;
    } }),
  };

  const bundle = await build({ entryPoints: [pageFile], plugins: browserPlugins, bundle: true, write: false, outdir: here('./out'), format: 'esm', platform: 'browser', jsx: 'automatic',
    alias: { '@': here('.') }, define: { 'process.env.NODE_ENV': '"production"' }, logLevel: 'silent' });
  const css = [await buildTailwind({ extraDirectories: ['examples/app-shell', 'registry/app-shell', 'registry/agent-target', 'registry/documents'], extraCss: SIDEBAR_TOKENS }), BASE, ...bundle.outputFiles.filter(file => file.path.endsWith('.css')).map(file => file.text),
    'html,body,#root{min-height:100%;margin:0}body{background:var(--background);color:var(--foreground);font:15px/1.5 ui-sans-serif,system-ui,sans-serif}',
    themeCss,
    // The app's own rule for AppShell overlayBlur={false} (an item's CSS stays inside .app-shell; overlays are portalled outside it).
    ':root[data-overlay-blur="off"] :is([data-slot="dialog-overlay"],[data-slot="alert-dialog-overlay"],[data-slot="sheet-overlay"],[data-slot="drawer-overlay"]){-webkit-backdrop-filter:none;backdrop-filter:none}'].join('\n');
  const page = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>Forme (fictional)</title>
<link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script>window.__APP__=${JSON.stringify({ token, conversations: { coach: String(created.coach.id), pm: String(created.pm.id) }, identity: { runtimeId: 'app', ...person } })}</script>
<script type="module" src="/app.js"></script></body></html>`;
  // Journey link destinations are fictional pages, not Chromium's network-error document (whose location is chrome-error://).
  const destination = ['text/html; charset=utf-8', '<!doctype html><html lang="fr"><meta charset="utf-8"><title>Exemple fictif</title><p>Destination fictive. Aucun message envoyé et aucune invitation créée.</p></html>'];
  const statics = { '/invite': destination, '/whatsapp/open': destination, '/': ['text/html; charset=utf-8', page], '/app.js': ['text/javascript; charset=utf-8', bundle.outputFiles.find(file => file.path.endsWith('.js')).text], '/app.css': ['text/css; charset=utf-8', css] };

  const server = createServer(async (incoming, outgoing) => {
    if (rejectForeignHost(incoming, outgoing)) return;
    const url = new URL(incoming.url, `http://${incoming.headers.host}`);
    // Served under `prefix` (a host's /apps/<app>/): the app's own paths only answer there; the shared assets stay at the root.
    if (prefix !== '/') {
      if (url.pathname.startsWith(prefix)) url.pathname = `/${url.pathname.slice(prefix.length)}`;
      else if (/^\/(api\/pm\/|api\/host\/|_tasks\/)|^\/$/.test(url.pathname)) return void outgoing.writeHead(404).end();
    }
    const closed = new AbortController();
    outgoing.on('close', () => closed.abort());
    try {
      if (incoming.method === 'GET' && url.pathname === '/api/meals') {
        if (!sameSecret(incoming.headers.authorization, `Bearer ${token}`)) return void outgoing.writeHead(401).end();
        mealReads++;
        return void outgoing.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify([{ id: 'm-42', slot: 'lunch', label: 'Déjeuner fictif · riz et légumes' }]));
      }
      const fixed = incoming.method === 'GET' && statics[url.pathname];
      if (fixed) return void outgoing.writeHead(200, { 'content-type': fixed[0], 'cache-control': 'no-store' }).end(fixed[1]);
      const acting = /^\/_tasks\/api\/([^/]+)\/(answer|withdraw)$/.exec(url.pathname);
      const handler = acting ? request => (acting[2] === 'answer' ? answer : withdraw)(request, decodeURIComponent(acting[1])) : handlers[url.pathname];
      const request = handler && await webRequest(incoming, url, { signal: closed.signal });
      if (request && url.searchParams.get('op') === 'submit' && request.method === 'POST') submits.push({ agent: url.searchParams.get('agent') ?? (url.pathname.startsWith('/api/pm/') ? 'pm' : null), body: await request.clone().json().catch(() => undefined) });
      await sendWebResponse(request ? await handler(request) : new Response(null, { status: handler ? 413 : 404 }), outgoing, { signal: closed.signal });
    } catch (error) {
      if (!outgoing.headersSent) outgoing.writeHead(500);
      outgoing.end();
      if (!closed.signal.aborted) console.error('request failed:', error?.message ?? error);
    }
  });
  await new Promise(resolve => server.listen(port, '127.0.0.1', resolve));
  return {
    url: `http://127.0.0.1:${server.address().port}${prefix}`, token, harness, conversations, submits, contexts, transcribes, answers, withdrawals, tasks, mealReads: () => mealReads, refuseTasks: value => { refusing = value; },
    close: async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await conversations.dispose(); await harness.close(context); files.close(); db.close(); },
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const app = await startAppShell({ directory: process.env.APP_DATA ?? '.cache/app-shell', port: Number(process.env.PORT ?? 0) });
  console.log(`App shell example on ${app.url}. Fictional content only.`);
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { app.close().finally(() => process.exit(0)); });
}
