// The public workspace demo on Cloudflare: the same demo as the Node server (../../app.mjs: agent, tools, Library seed, routes; the page and
// its assets from ../../assets.mjs), hosted like examples/hosts/cloudflare: native Pi on PiHarness in a SQLite-backed Durable Object, the
// Library and the invoices as workspaces in that object's SQLite, Pi's file environment and just-bash over the same rows, the library chat
// transport. Anonymous visitors: each gets ONE object of their own (an HttpOnly session cookie names it), seeded with the fictional fixtures,
// deleted after it has been idle for a while. The model is the scripted one: no key, no spend. Fictional content only.
import { DurableObject } from 'cloudflare:workers';
import { Lifecycle } from 'agents/lifecycle';
import { PiHarness } from 'agents/harness/pi';
import { Harness, createRegistry } from '@earendil-works/pi-durable';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import { createConversations } from '@hachej/boring-agent/conversations';
import { routeSubmissions } from '@hachej/boring-agent/chat-transport';
import { durableObjectSqliteConnection } from '@hachej/boring-files/sqlite-durable-object';
import { openSqliteFileSystem } from '@hachej/boring-files/sqlite-filesystem';
import { createWorkspaceJournal } from '@hachej/boring-files/journal';
import { createWorkspaceProvider } from '@hachej/boring-files/workspace';
import { createVirtualWorkspace } from '@hachej/boring-execution/virtual';
import { openAccountsPayable } from '../../ap.mjs';
import { PERSON, createWorkspaceDemo, routeOf, scriptedModels, seedLibrary } from '../../app.mjs';

const ROOT = '/workspace';
const COOKIE = 'demo_session';
const MINUTE = 60_000;
// The abuse limits (README "Limits"). Numbers are vars so a local proof run can lower them; a deployment keeps these defaults.
const LIMITS = env => ({
  /** A session's data is deleted after this long without a request ... */
  idleMs: Number(env.DEMO_IDLE_MS ?? 2 * 60 * MINUTE),
  /** ... and at the latest this long after it was created, even with a tab left open. */
  maxAgeMs: Number(env.DEMO_MAX_AGE_MS ?? 8 * 60 * MINUTE),
  /** Largest request body the Worker forwards (uploads, saves, messages). */
  maxBodyBytes: Number(env.DEMO_MAX_BODY_BYTES ?? 1024 * 1024),
  /** Chat messages per session per window. */
  messages: Number(env.DEMO_MESSAGE_LIMIT ?? 30),
  /** Other writes (uploads, saves, decisions, new conversations) per session per window. */
  writes: Number(env.DEMO_WRITE_LIMIT ?? 120),
  windowMs: Number(env.DEMO_WINDOW_MS ?? 10 * MINUTE),
  /** Total request bytes a session may write, all requests together. */
  budgetBytes: Number(env.DEMO_BUDGET_BYTES ?? 20 * 1024 * 1024),
});

const json = (value, status = 200, headers = {}) => Response.json(value, { status, headers: { 'cache-control': 'no-store', ...headers } });
const sessionOf = request => /(?:^|;\s*)demo_session=([0-9a-f]{32})(?:;|$)/.exec(request.headers.get('cookie') ?? '')?.[1];
const newSessionId = () => [...crypto.getRandomValues(new Uint8Array(16))].map(byte => byte.toString(16).padStart(2, '0')).join('');

/** One workspace in the object's SQLite: its rows (`openSqliteFileSystem`) and one provider over them, journal in the same database. */
function openWorkspace(connection, journal, name, providerId) {
  const fs = openSqliteFileSystem({ connection, workspace: name, cwd: ROOT });
  return { fs, files: createWorkspaceProvider({ identity: { providerId, instanceId: name, incarnation: fs.incarnation, viewId: 'published' }, fs, journal }) };
}

export class DemoSession extends DurableObject {
  connection = durableObjectSqliteConnection(this.ctx.storage);
  journal = createWorkspaceJournal(this.connection);
  // The Library (what the page's Library, viewers and Pi's file tools see) and the invoice records (the app's backend), both in this object.
  library = openWorkspace(this.connection, this.journal, 'workspace', 'workspace');
  invoices = openWorkspace(this.connection, this.journal, 'ap', 'ap-invoices');
  // Pi's native environment over the Library rows: file methods and just-bash's `exec` over the same files, no processes, no network.
  shell = createVirtualWorkspace({ providerId: 'demo', fs: this.library.fs });
  registry = createRegistry();
  limits = LIMITS(this.env);
  #prepared;
  #opened;
  #touched = 0;
  harness = new PiHarness({
    harness: async ({ storage, context: opening }) => {
      const { demo, env, models } = await this.#prepare();
      demo.agent.install(this.registry);
      return Harness.open(storage, { models, registry: this.registry, env: () => env }, opening);
    },
  });
  lifecycle = Lifecycle.install(this).use(this.harness);

  /** The seeded fixtures and the demo over them: once per instance (seeds are idempotent, so a restart repeats them harmlessly). */
  #prepare() {
    this.#prepared ??= (async () => {
      const models = await scriptedModels();
      await seedLibrary(this.library.files, PERSON);
      const ap = await openAccountsPayable({ files: this.invoices.files, person: PERSON });
      const demo = createWorkspaceDemo({ files: this.library.files, root: ROOT, ap });
      const env = (await this.shell.acquire({ operationId: 'demo-workspace', input: { cwd: ROOT } }, context)).environment;
      return { demo, env, models };
    })();
    return this.#prepared.catch(error => { this.#prepared = undefined; throw error; });
  }

  /** The conversations and the routes. Submissions go through PiHarness so the object keeps a wake job while a turn runs. */
  #open() {
    this.#opened ??= (async () => {
      const { demo } = await this.#prepare();
      const pi = await this.harness.pi();
      const conversations = createConversations({ harness: pi, context });
      const { start, current } = await demo.openConversations(conversations, pi, context);
      const submitThrough = conversation => routeSubmissions(conversation, draft => this.harness.submit(draft.content, { session: String(conversation.id), operationId: draft.requestId, ...(draft.whenBusy ? { whenBusy: draft.whenBusy } : {}) }));
      return { current, handlers: demo.handlers({ conversations, harness: pi, context, start, submitThrough }) };
    })();
    return this.#opened.catch(error => { this.#opened = undefined; throw error; });
  }

  /**
   * Per-session rate limits and write budget, counted in this object's storage (so an evicted object does not forget them): chat messages,
   * other writes, and the total bytes written. Reads are not limited (the page polls its state).
   */
  async #admit(request, url) {
    if (request.method === 'GET' || request.method === 'HEAD') return undefined;
    const now = Date.now(), { windowMs } = this.limits;
    const state = (await this.ctx.storage.get('limits')) ?? { messages: [], writes: [], bytes: 0 };
    const message = url.pathname === '/api/chat' && url.searchParams.get('op') === 'submit';
    const kind = message ? 'messages' : 'writes';
    state[kind] = state[kind].filter(at => now - at < windowMs);
    if (state[kind].length >= this.limits[kind]) {
      return json({ reason: 'rate-limited', limit: this.limits[kind], windowSeconds: windowMs / 1000 }, 429, { 'retry-after': String(Math.ceil((windowMs - (now - state[kind][0])) / 1000)) });
    }
    const bytes = Number(request.headers.get('content-length') ?? 0);
    if (state.bytes + bytes > this.limits.budgetBytes) return json({ reason: 'session-budget-exhausted', budgetBytes: this.limits.budgetBytes }, 413);
    state[kind].push(now);
    state.bytes += bytes;
    await this.ctx.storage.put('limits', state);
    return undefined;
  }

  /** Re-arms the deletion job: `idleMs` after the last request, never later than `maxAgeMs` after creation. Written at most once a minute. */
  async #touch() {
    const now = Date.now();
    if (now - this.#touched < MINUTE) return;
    this.#touched = now;
    let created = await this.ctx.storage.get('created');
    if (!created) { created = now; await this.ctx.storage.put('created', created); }
    await this.lifecycle.jobs.push({ id: 'expire', fn: 'expire', time: Math.min(now + this.limits.idleMs, created + this.limits.maxAgeMs) });
  }

  /** The deletion job: every row of this session (files, invoices, transcripts, Pi's tables, limits) goes; the next visit starts fresh. */
  async onJob({ job }) {
    if (job.fn !== 'expire') return;
    await this.lifecycle.disableAlarms();
    await this.ctx.storage.deleteAlarm();
    await this.ctx.storage.deleteAll();
    // Drop the in-memory instance too (open harness, caches): nothing of this session survives.
    this.ctx.abort('demo session expired');
  }

  /** Called by the Worker for this visitor's session only, after the body size check. */
  async fetch(request) {
    const url = new URL(request.url);
    try {
      const refused = await this.#admit(request, url);
      if (refused) return refused;
      await this.#touch();
      const { current, handlers } = await this.#open();
      if (url.pathname === '/api/session.js') {
        // What the Node server inlines in its page. No token: the session cookie is the only credential, and the browser holds it (HttpOnly).
        const app = { token: null, conversation: current, identity: { runtimeId: 'demo', ...PERSON }, voice: false };
        return new Response(`window.__APP__=${JSON.stringify(app)};`, { headers: { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-store' } });
      }
      const handler = routeOf(handlers, url.pathname);
      return handler ? await handler(request) : json({ reason: 'not-found' }, 404);
    } catch (error) {
      console.error('request failed', String(error?.stack ?? error));
      return json({ reason: 'internal-error' }, 500);
    }
  }
}

export default {
  /** Static files never reach this code (Workers static assets); everything under /api/ does. */
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
    const limits = LIMITS(env);
    if (request.body) {
      const length = request.headers.get('content-length');
      if (length === null) return json({ reason: 'length-required' }, 411);
      if (!(Number(length) <= limits.maxBodyBytes)) return json({ reason: 'request-too-large', maxBytes: limits.maxBodyBytes }, 413);
    }
    let session = sessionOf(request);
    if (!session) {
      // Only the page's bootstrap starts a session; any other API call without one is refused before an object is woken.
      if (url.pathname !== '/api/session.js') return json({ reason: 'session-required' }, 401);
      const { success } = await env.NEW_SESSIONS?.limit({ key: request.headers.get('cf-connecting-ip') ?? 'unknown' }) ?? { success: true };
      if (!success) return json({ reason: 'too-many-new-sessions' }, 429, { 'retry-after': '60' });
      session = newSessionId();
    }
    const response = await env.SESSIONS.getByName(session).fetch(request);
    if (url.pathname !== '/api/session.js') return response;
    // Each page load renews the cookie; it lasts as long as the session's idle window.
    const renewed = new Response(response.body, response);
    renewed.headers.append('set-cookie', `${COOKIE}=${session}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${Math.floor(limits.idleMs / 1000)}${url.protocol === 'https:' ? '; Secure' : ''}`);
    return renewed;
  },
};
