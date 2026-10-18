// The agent as a Durable Object: native Pi (pi-durable) on Cloudflare's PiHarness, the SAME standard agent the studio uses
// (shared/standard-agent.mjs) installed through the registry seam, a workspace of files in the same object's SQLite (the
// SQLite backend of @hachej/boring-files, with just-bash over the same files), and the library chat transport served from `fetch`. Workers
// give it no git, canvas editor, subagents or code sandbox, so those parts are simply not passed: the agent is told only about what it
// has, and the UI says which scenarios need more. Fictional content only.
import { DurableObject } from 'cloudflare:workers';
import { Lifecycle } from 'agents/lifecycle';
import { PiHarness } from 'agents/harness/pi';
import { createAI, CLOUDFLARE_PROVIDER_ID } from 'agents/models/pi-ai';
import { Harness, createRegistry } from '@earendil-works/pi-durable';
import { createModels } from '@earendil-works/pi-ai/models';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import { answerUserQuestion } from '@hachej/boring-agent/ask-user';
import { withWorkspace } from '@hachej/boring-agent/workspaces';
import { defineStandardAgent } from '../../../../shared/standard-agent.mjs';
import { EFFORTS, configureOffered, firstMessageTitle } from '../../../../shared/conversation-host.mjs';
import { createChatTransportHandler, createConversationSocketHandler, routeSubmissions } from '@hachej/boring-agent/chat-transport';
import { durableObjectSqliteConnection } from '@hachej/boring-files/sqlite-durable-object';
import { openSqliteFileSystem } from '@hachej/boring-files/sqlite-filesystem';
import { createWorkspaceJournal } from '@hachej/boring-files/journal';
import { createWorkspaceProvider } from '@hachej/boring-files/workspace';
import { createVirtualWorkspace } from '@hachej/boring-execution/virtual';
import { readFiles, writeFiles, shell } from '../../../../shared/workspace-tools.mjs';
import { createRevisionHandler } from '@hachej/boring-files/revision-handler';
import { readJsonBody } from '@hachej/boring-files/request-guard';

// Workers AI model with native tool calling, chosen by Cloudflare's own Pi example for agent work. The second is a cheaper, faster fallback.
export const MODELS = [
  { modelId: '@cf/moonshotai/kimi-k2.7-code', label: 'Kimi K2.7 Code' },
  { modelId: '@cf/zai-org/glm-4.7-flash', label: 'GLM 4.7 Flash' },
];

// One person owns this object. The Worker has already checked the bearer token; the agent acts in the same scope under its own principal.
const OWNER = { scopeId: 'recipe', principalId: 'owner', initiatorId: 'owner' };
const AGENT_ACCESS = { scopeId: OWNER.scopeId, principalId: 'agent', initiatorId: OWNER.principalId };
const ROOT = '/workspace';
const NOTES = { resource: { providerId: 'workspace', path: 'notes.md' }, view: { kind: 'published' } };

/** One workspace in the object's SQLite: its files, a journal in the same database (bytes and receipt commit together), one provider. */
function openWorkspace(connection, name) {
  const fs = openSqliteFileSystem({ connection, workspace: name, cwd: ROOT });
  const files = createWorkspaceProvider({ identity: { providerId: 'workspace', instanceId: name, incarnation: fs.incarnation, viewId: 'published' }, fs, journal: createWorkspaceJournal(connection) });
  return { fs, files };
}

/** Pi's in-memory caches (an idle document, a kept context) expire on a timer by default; on this object they go right after use. */
const HIBERNATABLE = { documentRetentionMs: 0, contextRetentionMs: 0 };

const json = (value, status = 200) => Response.json(value, { status, headers: { 'cache-control': 'no-store' } });

export class Assistant extends DurableObject {
  ai = createAI({ binding: this.env.AI });
  registry = createRegistry();
  // The workspace: files in this object's SQLite, next to Pi's own `pi_*` tables, served to the viewers, `present` and the shared notes
  // by one provider (a multi-file save commits in one `transactionSync`). Pi's file tools and bash (just-bash) run over the same files.
  workspace = openWorkspace(durableObjectSqliteConnection(this.ctx.storage), 'workspace');
  files = this.workspace.files;
  shell = createVirtualWorkspace({ providerId: 'cloudflare', fs: this.workspace.fs });
  #env;
  // The standard agent with what Workers can give it: Pi's read, write and edit behind the file guard, `present` and the shared notes,
  // bash, ask_user and skills. No tool names a workspace: each uses the one attached to its call's env (`withWorkspace` below), the
  // same interface as a host with a workspace per person; this object has one.
  standard = defineStandardAgent({
    id: 'standard-cloudflare', model: { provider: CLOUDFLARE_PROVIDER_ID, modelId: MODELS[0].modelId }, cwd: ROOT, workspace: 'env',
    parts: [{ capabilities: ['workspace'], extensions: [readFiles, writeFiles] }, { capabilities: ['shell'], extensions: [shell] }],
    // Self-evolution: `.agent/` lives in this object's SQLite workspace (read through the call's env) and agent-written tools run in
    // just-bash over it, like bash. The agent of this object's one workspace selects its extension `self-evolving:workspace`.
    selfEvolving: true,
  });
  agent = this.standard.agent.inWorkspace('workspace');
  harness = new PiHarness({
    harness: async ({ storage, context: opening }) => {
      this.agent.install(this.registry);
      const models = createModels();
      models.setProvider(this.ai.provider);
      const env = await this.#workspaceEnv();
      // The same scan as the agent's `reload`, so what the agent wrote in `.agent/` survives the object's restarts.
      await this.agent.reload(env, opening);
      // Nothing kept in memory on a timer: a pending timer keeps a Durable Object from hibernating, and hibernation drops memory anyway.
      return Harness.open(storage, { models, registry: this.registry, env: () => env, settings: HIBERNATABLE }, opening);
    },
    defaults: { model: this.ai(MODELS[0].modelId) },
  });
  lifecycle = Lifecycle.install(this).use(this.harness);

  /** Conversation ids in creation order and the time of each one's last activity, kept in this object's key-value storage. */
  #state;
  /** Changes whenever the object restarts: the in-memory instance is new, the SQLite state is not. */
  #instance = crypto.randomUUID();
  #conversations = new Map();
  #opening;

  /**
   * Pi's native environment over the workspace: its file methods and just-bash's `exec` see the same SQLite files. The workspace comes
   * with it (`withWorkspace`): the provider, root and the agent's access every tool of a call uses.
   */
  #workspaceEnv() {
    this.#env ??= this.shell.acquire({ operationId: 'cloudflare-workspace', input: { cwd: ROOT } }, context)
      .then(lease => withWorkspace(lease.environment, { id: 'workspace', files: this.files, root: ROOT, access: AGENT_ACCESS }));
    return this.#env;
  }

  async #open() {
    this.#opening ??= (async () => {
      const pi = await this.harness.pi();
      this.#state = (await this.ctx.storage.get('conversations')) ?? { ids: [], activity: {} };
      for (const id of this.#state.ids) { const found = await pi.conversation(id, context); if (found) this.#conversations.set(String(id), found); }
      if (this.#conversations.size === 0) await this.#create(pi);
      return pi;
    })();
    try { return await this.#opening; } catch (error) { this.#opening = undefined; throw error; }
  }

  async #create(pi) {
    const conversation = await this.agent.createConversation(pi, context);
    this.#conversations.set(String(conversation.id), conversation);
    this.#state.ids.push(Number(conversation.id));
    await this.#touch(conversation.id);
    return conversation;
  }

  async #touch(id) {
    this.#state.activity[String(id)] = Date.now();
    await this.ctx.storage.put('conversations', this.#state);
  }

  /** Submissions go through `PiHarness` so the object keeps a wake job (an evicted object restarts from its alarm). */
  #viaHarness(conversation) {
    return routeSubmissions(conversation, draft => this.harness.submit(draft.content, { session: String(conversation.id), operationId: draft.requestId, ...(draft.whenBusy ? { whenBusy: draft.whenBusy } : {}) }));
  }

  #configure(conversation, change) {
    return configureOffered(conversation, change, context, model => model.provider === CLOUDFLARE_PROVIDER_ID && MODELS.some(item => item.modelId === model.modelId));
  }

  /** The chat access to one conversation, the same for the HTTP transport and the socket. `touch` records activity on an effect. */
  #access(conversation) {
    const touched = async effect => { await this.#touch(conversation.id); return effect !== undefined; };
    return { conversation: this.#viaHarness(conversation), context, abortSubmission: async id => (await this.harness.pi()).abortSubmission(id, context, conversation.id), answer: (callId, answer) => answerUserQuestion(conversation, callId, answer),
      configure: change => this.#configure(conversation, change), allow: touched };
  }

  #chat = createChatTransportHandler({ authenticate: async request => {
    await this.#open();
    const conversation = this.#conversations.get(new URL(request.url).searchParams.get('conversation') ?? '');
    return conversation ? this.#access(conversation) : null;
  } });

  /**
   * The chat over hibernatable WebSockets (the page's default): the socket's owner and conversation live in its attachment, so an idle
   * open page lets this object hibernate; a wake (a message, or the harness alarm resuming a run) reopens the watches with a full view.
   */
  #sockets = createConversationSocketHandler({ state: this.ctx,
    authenticate: async request => {
      await this.#open();
      const id = new URL(request.url).searchParams.get('conversation') ?? '';
      return this.#conversations.has(id) ? { owner: OWNER.principalId, conversationId: id } : null;
    },
    access: async ({ conversationId }) => {
      await this.#open();
      const conversation = this.#conversations.get(conversationId);
      return conversation ? this.#access(conversation) : null;
    } });

  webSocketMessage(socket, message) { return this.#sockets.webSocketMessage(socket, message); }
  webSocketClose(socket, code, reason) { return this.#sockets.webSocketClose(socket, code, reason); }
  webSocketError(socket) { return this.#sockets.webSocketClose(socket, 1011, 'error'); }
  /** Lifecycle startup, also on an alarm wake: a run the harness resumes reaches the pages whose sockets slept with the object. */
  onStart() { void this.#sockets.resume().catch(error => console.error('socket resume failed', String(error))); }

  /**
   * Proof that a multi-file save is atomic in this object's SQLite: a second workspace (`atomicity-proof`) whose connection fails the
   * second history insert, after both files, the receipt and the first history row were written in the same transaction. Everything
   * must roll back.
   */
  async #atomicityProof() {
    const base = durableObjectSqliteConnection(this.ctx.storage);
    let injected = 0, staged, histories = 0;
    const counts = () => base.get(`SELECT (SELECT count(*) FROM boring_workspace_files WHERE workspace = 'atomicity-proof' AND kind = 'file') AS documents,
      (SELECT count(*) FROM boring_history) AS versions, (SELECT count(*) FROM boring_operations) AS operations, (SELECT count(*) FROM boring_changes) AS changes`);
    const faulty = { ...base, run: (sql, ...params) => {
      if (sql.startsWith('INSERT INTO boring_history') && ++histories === 2) { injected++; staged = counts(); throw new Error('injected fault after the file, receipt and history rows were written'); }
      return base.run(sql, ...params);
    } };
    const proof = openWorkspace(faulty, 'atomicity-proof').files;
    const before = counts();
    let outcome;
    try {
      outcome = await proof.publication.publish({ operationId: `atomicity-${crypto.randomUUID()}`, atomicity: 'all-or-nothing',
        changes: ['proof/one.md', 'proof/two.md'].map(path => ({ kind: 'create', target: { resource: { providerId: 'workspace', path }, view: { kind: 'published' } }, expected: { kind: 'absent' }, bytes: new TextEncoder().encode(path), mediaType: 'text/markdown' })) },
      { scopeId: 'atomicity-proof', principalId: 'proof', initiatorId: 'proof' });
    } catch (error) { outcome = `threw: ${error.message}`; }
    const after = counts();
    return { injected, staged, outcome, before, after, rolledBack: JSON.stringify(before) === JSON.stringify(after) };
  }

  #resources = createRevisionHandler({ resolve: async () => ({ provider: this.files, access: OWNER }) });

  /** Called by the Worker after it has checked the bearer token. */
  async fetch(request) {
    const url = new URL(request.url);
    try {
      if (url.pathname === '/api/chat') return await (request.headers.get('upgrade')?.toLowerCase() === 'websocket' ? this.#sockets.fetch(request) : this.#chat(request));
      if (url.pathname === '/api/resources') return await this.#resources(request);
      await this.#open();
      if (url.pathname === '/api/agent' && request.method === 'GET') {
        return json({ id: this.agent.id, title: 'Assistant', skills: this.agent.skills, models: MODELS.map(model => ({ provider: CLOUDFLARE_PROVIDER_ID, ...model })), efforts: EFFORTS, notes: NOTES,
          // The variant as the shared scenario list sees it: what this deployment gives the one standard agent.
          // This page shows the workspace as a Library (file tree, filename search, uploads) but has no terminal; the scenarios that need the studio's own routes or a terminal (`workspace`, `shell`) stay listed disabled.
          variant: { id: 'cloudflare', title: 'Cloudflare', description: 'A Durable Object on Workers: files, presented files, the shared document and bash in its SQLite workspace; this page shows them as a Library with filename search and uploads, and has no terminal.',
            capabilities: this.standard.capabilities.filter(capability => capability !== 'workspace' && capability !== 'shell') },
          identity: { runtimeId: 'cloudflare-recipe', ...OWNER }, instance: this.#instance });
      }
      if (url.pathname === '/api/conversations' && request.method === 'GET') {
        const items = await Promise.all(this.#state.ids.filter(id => this.#conversations.has(String(id))).map(async id => ({ id, title: (await firstMessageTitle(this.#conversations.get(String(id)), context)) ?? null, updatedAt: this.#state.activity[String(id)] ?? null })));
        return json({ conversations: items });
      }
      if (url.pathname === '/api/conversations' && request.method === 'POST') {
        // Nothing to read, but a request body still unread when the response is sent makes Workers throw "Can't read from request stream after response has been sent".
        await readJsonBody(request, 1024).catch(() => undefined);
        return json({ conversationId: Number((await this.#create(await this.harness.pi())).id) });
      }
      // Proof routes exist only when the operator sets ENABLE_DEBUG_ROUTES=1 (for example `wrangler dev --var ENABLE_DEBUG_ROUTES:1`); a deployment answers 404.
      if (this.env.ENABLE_DEBUG_ROUTES === '1') {
        if (url.pathname === '/api/debug/atomicity' && request.method === 'POST') return json(await this.#atomicityProof());
        // Restart proof: abort this object's isolate. State lives in SQLite; the next request (or the wake alarm) starts it again.
        if (url.pathname === '/api/debug/restart' && request.method === 'POST') { this.ctx.abort('restart requested for the recovery proof'); return json({ restarting: true }); }
      }
      return json({ reason: 'not-found' }, 404);
    } catch (error) {
      console.error('request failed', String(error?.stack ?? error));
      return json({ reason: 'internal-error' }, 500);
    }
  }
}
