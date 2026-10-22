import type { Context } from '@earendil-works/chord';
import { RequestGuardError, hasJsonContentType, readJsonBody } from '@hachej/boring-files/request-guard';
import type { Conversation, ConversationView, ConversationWatch, Cursor, EntryId, EntryQuery, EntryRecord, InputSubmissionDraft, SubmissionId, SubmissionRecord, WatchEnd } from '@earendil-works/pi-durable';

/** Wire protocol shared with the browser client in `@hachej/boring-ui-kit/remote-chat`. */
export const CHAT_TRANSPORT = Object.freeze({ schema: 'boring.chat-transport', version: 1, maxRequestBytes: 8_388_608, maxContextBytes: 4096, maxHistoryPage: 200, maxPendingFrames: 100, heartbeatMs: 15_000 });

/** The agent change a browser may ask for. Names only: the host maps it to a native `AgentChange`. */
export interface ChatConfigureChange {
  readonly model?: { readonly provider: string; readonly modelId: string };
  readonly thinkingLevel?: string;
}

export interface ChatTransportAccess {
  readonly conversation: Conversation;
  readonly context: Context;
  /** The host aborts on revocation or identity change; open watches then end. */
  readonly revoked?: AbortSignal;
  /**
   * Remove fields the caller may not see. Without it the raw native view is sent to a trusted viewer. With it, raw
   * conversation data never leaves the host: every read (the watch, `?op=entries` history pages, `?op=submission`) goes
   * through it. History pages are projected as a view holding just the page's entries and no documents.
   */
  readonly project?: (view: ConversationView) => ConversationView;
  /** Resolve a pending `ask_user` call. The host authenticates the person; without it `?op=answer` is not supported. */
  readonly answer?: (questionId: string, answer: string) => Promise<unknown>;
  /**
   * Change the conversation's native agent (`conversation.configure`). The host validates the change against its own
   * allow-list and returns a refusal (for example `{ kind: 'refused', reason }`) instead of applying it; this handler
   * never decides which models or levels are allowed. Without it `?op=configure` is not supported.
   */
  readonly configure?: (change: ChatConfigureChange) => Promise<unknown>;
  /**
   * Improve a submitted input on the host before it reaches the native conversation, for example resolve `@path`
   * mentions into file content with `createMentionResolver` from `@hachej/boring-agent/mentions`. It must return the
   * input to submit; if it throws, the original input is submitted unchanged so a message is never lost.
   */
  readonly prepareInput?: (content: InputSubmissionDraft['content']) => Promise<InputSubmissionDraft['content']>;
  /**
   * Withdraw one queued input: the host binds the native `Harness.abortSubmission(id, context, conversation.id)`, which
   * scopes the id to this conversation. Without it `?op=withdraw` is not supported. This handler never edits the inbox.
   */
  readonly abortSubmission?: (id: SubmissionId) => Promise<'aborted' | 'already_placed' | 'settled' | 'not_found'>;
  /**
   * Receive the screen context a browser sent with a submit (`context`, from `createRemoteChat({ requestContext })`), called after
   * the request is validated and admitted and before `conversation.submit`. The value is a plain JSON object of at most
   * `CHAT_TRANSPORT.maxContextBytes`; anything else is `400 invalid-request`. The host stores it by conversation id and renders
   * it in `createPromptContext({ context })`; this handler keeps nothing. Without it the `context` field is ignored.
   */
  readonly requestContext?: (value: Readonly<Record<string, unknown>>) => void | Promise<void>;
  /**
   * Refuse an effect call. Reading stays governed by `authenticate` and `project`. Without it EVERY effect (submit, abort, answer,
   * withdraw, configure) is allowed to whoever `authenticate` accepted: a host with read-only viewers must pass it.
   */
  readonly allow?: (operation: 'submit' | 'abort' | 'answer' | 'withdraw' | 'configure') => boolean | Promise<boolean>;
}

export interface ChatTransportOptions {
  /**
   * Authenticate and select the native conversation in trusted host code. Null refuses. The host also enforces its
   * Origin/CSRF policy here; this handler only requires `application/json` on every POST, which a cross-site form
   * cannot send without a preflight.
   */
  readonly authenticate: (request: Request) => Promise<ChatTransportAccess | null>;
  /**
   * While the watch stream has nothing to send, write `{"kind":"heartbeat","intervalMs":N}` every N milliseconds (default
   * `CHAT_TRANSPORT.heartbeatMs`, 15 s; 0 turns it off). Proxies and load balancers close a response that stays silent past
   * their idle timeout (an AWS ALB after 60 s by default); the browser client ignores the frame for the transcript and treats a
   * stream silent for 2.5 intervals as lost, then reopens it. The first heartbeat follows the first view, announcing the interval.
   */
  readonly heartbeatMs?: number;
}

/** `no-transform` keeps proxies from compressing or rewriting responses; the watch stream adds `x-accel-buffering: no` so nginx does not buffer it. */
const headers = { 'cache-control': 'no-store, no-transform', 'x-content-type-options': 'nosniff' };
const failure = (status: number, reason: string): Response => Response.json({ schema: CHAT_TRANSPORT.schema, version: CHAT_TRANSPORT.version, reason }, { status, headers });
const json = (value: unknown): Response => Response.json(value, { headers });
const encoder = new TextEncoder();

function content(value: unknown): value is InputSubmissionDraft['content'] {
  if (typeof value === 'string') return value.length > 0;
  return Array.isArray(value) && value.length > 0 && value.every(part => part !== null && typeof part === 'object'
    && ((part.type === 'text' && typeof part.text === 'string') || (part.type === 'image' && typeof part.data === 'string' && typeof part.mimeType === 'string')));
}

/** The submit `context` field: absent, or a plain JSON object of at most `maxContextBytes` once serialized. */
function contextValue(value: unknown): value is Readonly<Record<string, unknown>> | undefined {
  if (value === undefined) return true;
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  return encoder.encode(JSON.stringify(value)).length <= CHAT_TRANSPORT.maxContextBytes;
}

async function body(request: Request): Promise<Record<string, unknown>> {
  const value = await readJsonBody(request, CHAT_TRANSPORT.maxRequestBytes, request.signal);
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new RequestGuardError(400, 'Expected a JSON object');
  return value as Record<string, unknown>;
}

/**
 * The only way conversation data other than the watch leaves this handler. With `project` set, history entries are
 * projected and a submission record loses its free-form `detail`; `npm run check` fails if the native history read or
 * submission lookup is called anywhere else in this file.
 */
function reads(conversation: Conversation, context: Context, project: ((view: ConversationView) => ConversationView) | undefined) {
  return {
    async entries(query: Omit<EntryQuery, 'conversationId'>, limit: number, cursor: Cursor | undefined) {
      const page = await conversation.entries(query, limit, cursor, context);
      if (!project) return page;
      const record = await conversation.commit(tx => tx.conversation(conversation.id), context);
      if (!record) throw new Error('The conversation is not available');
      let items: readonly EntryRecord[];
      try { items = project({ conversation: record, entries: page.items, docs: {} }).entries; }
      catch { throw new Error('projection_failed'); }
      return { ...page, items };
    },
    async submission(requestId: string): Promise<SubmissionRecord | null> {
      const record = await conversation.commit(tx => tx.submissionByRequest(conversation.id, requestId), context);
      if (!record) return null;
      if (!project || record.detail === undefined) return record;
      const { detail: _detail, ...rest } = record;
      return rest as SubmissionRecord;
    },
  };
}

/** A watch frame: a complete view, or one native operation batch. The NDJSON stream and the socket send the same JSON. */
type WatchFrame = { readonly kind: 'view'; readonly view: ConversationView } | { readonly kind: 'ops'; readonly ops: readonly unknown[] };
/** Serialize one watch frame; with `project` a view is projected first (a throw means `projection_failed`). */
function encodeFrame(frame: WatchFrame, project: ((view: ConversationView) => ConversationView) | undefined): string {
  return JSON.stringify(frame.kind === 'view' && project ? { kind: 'view', view: project(frame.view) } : frame);
}

/** Open the conversation watch for an authenticated access, refusing a revoked one. Shared by the HTTP watch and the socket. */
async function openWatch(access: ChatTransportAccess, signal?: AbortSignal): Promise<ConversationWatch | null> {
  const watch = await access.conversation.watch(access.context);
  if (signal?.aborted || access.revoked?.aborted) { await watch.stop(); return null; }
  return watch;
}

/**
 * Stream newline-delimited JSON. A trusted viewer receives one view and then the exact native operation batches,
 * replayed in the browser with `@earendil-works/chord/delta`. With `project`, raw operations never leave the host:
 * the viewer receives complete projected views, and a slow reader gets the latest one rather than a backlog.
 */
function stream(watch: ConversationWatch, project: ((view: ConversationView) => ConversationView) | undefined, signal: AbortSignal, heartbeatMs: number): Response {
  let pending: WatchFrame[] = [{ kind: 'view', view: watch.value }], wake: (() => void) | undefined, end: WatchEnd | undefined, finished = false;
  // `beat` asks the next pull for a heartbeat. The timer restarts after every frame, so it fires only on an idle stream, and it is
  // cleared when the stream finishes or is cancelled: nothing outlives the response.
  let beat = false, timer: ReturnType<typeof setTimeout> | undefined;
  const notify = () => { const resume = wake; wake = undefined; resume?.(); };
  const idle = () => { clearTimeout(timer); timer = undefined; if (heartbeatMs > 0 && !finished) timer = setTimeout(() => { beat = true; notify(); }, heartbeatMs); };
  const heartbeat = () => encoder.encode(JSON.stringify({ kind: 'heartbeat', intervalMs: heartbeatMs }) + '\n');
  const stop = () => { pending = []; clearTimeout(timer); notify(); void watch.stop(); };
  signal.addEventListener('abort', stop, { once: true });
  watch.start(async (view, ops) => {
    if (signal.aborted) return;
    if (project || pending.length >= CHAT_TRANSPORT.maxPendingFrames) pending = [{ kind: 'view', view }];
    else pending.push({ kind: 'ops', ops });
    notify();
  });
  void watch.closed.then(result => { end = result; signal.removeEventListener('abort', stop); notify(); });
  let started = false;
  const frames = new ReadableStream<Uint8Array>({
    async pull(controller) {
      while (pending.length === 0 && !beat && end === undefined && !signal.aborted) await new Promise<void>(resolve => { wake = resolve; });
      if (finished) return;
      const close = (reason: string) => {
        finished = true; clearTimeout(timer);
        controller.enqueue(encoder.encode(JSON.stringify({ kind: 'end', reason }) + '\n'));
        controller.close();
      };
      if (signal.aborted) { close('revoked'); return; }
      const frame = pending.shift();
      if (frame) {
        let line: string;
        try { line = encodeFrame(frame, project); }
        catch { finished = true; stop(); controller.enqueue(encoder.encode(JSON.stringify({ kind: 'end', reason: 'projection_failed' }) + '\n')); controller.close(); return; }
        if (signal.aborted) { close('revoked'); return; }
        controller.enqueue(encoder.encode(line + '\n'));
        // The first frame is followed by a heartbeat at once, so the client learns the interval before any idle period.
        if (!started && heartbeatMs > 0) { started = true; controller.enqueue(heartbeat()); }
        beat = false; idle();
        return;
      }
      if (beat && end === undefined) { beat = false; controller.enqueue(heartbeat()); idle(); return; }
      finished = true; clearTimeout(timer);
      controller.enqueue(encoder.encode(JSON.stringify({ kind: 'end', reason: end!.reason }) + '\n'));
      controller.close();
    },
    cancel() { finished = true; stop(); },
  });
  return new Response(frames, { headers: { ...headers, 'content-type': 'application/x-ndjson; charset=utf-8', 'x-accel-buffering': 'no' } });
}

/**
 * Authenticated Fetch adapter over one native conversation: watch, submit, abort, configure, submission lookup and history.
 * It adds no execution lifecycle. A closed connection says nothing about the native task.
 */
export function createChatTransportHandler(options: ChatTransportOptions): (request: Request) => Promise<Response> {
  return async request => {
    const operation = new URL(request.url).searchParams.get('op');
    if (request.method === 'POST' && !hasJsonContentType(request.headers)) return failure(415, 'unsupported-media-type');
    let access: ChatTransportAccess | null;
    try { access = await options.authenticate(request); }
    catch { return failure(503, 'authentication-unavailable'); }
    if (!access) return failure(401, 'authentication-required');
    const { conversation, context } = access;
    if (access.revoked?.aborted) return failure(403, 'not-authorized');
    const read = reads(conversation, context, access.project);
    const allowed = async (effect: 'submit' | 'abort' | 'answer' | 'withdraw' | 'configure') => {
      if (access.revoked?.aborted) return false;
      const granted = access.allow === undefined || await access.allow(effect) === true;
      return granted && !access.revoked?.aborted;
    };
    const params = new URL(request.url).searchParams;
    try {
      if (request.method === 'GET' && operation === 'watch') {
        const signal = access.revoked ? AbortSignal.any([request.signal, access.revoked]) : request.signal;
        const watch = await openWatch(access, signal);
        if (!watch) return failure(403, 'not-authorized');
        return stream(watch, access.project, signal, options.heartbeatMs ?? CHAT_TRANSPORT.heartbeatMs);
      }
      if (request.method === 'GET' && operation === 'submission') {
        const requestId = params.get('requestId');
        if (!requestId) return failure(400, 'invalid-request');
        const record = await read.submission(requestId);
        if (access.revoked?.aborted) return failure(403, 'not-authorized');
        return json({ record });
      }
      if (request.method === 'GET' && operation === 'entries') {
        const limit = Number(params.get('limit'));
        if (!Number.isInteger(limit) || limit < 1 || limit > CHAT_TRANSPORT.maxHistoryPage) return failure(400, 'invalid-request');
        let cursor: Cursor | undefined;
        const encoded = params.get('cursor');
        if (encoded !== null) { try { cursor = JSON.parse(encoded) as Cursor; } catch { return failure(400, 'invalid-request'); } }
        const entryId = (encoded: string | null): EntryId | undefined => {
          if (encoded === null) return undefined;
          const value = Number(encoded);
          if (!Number.isSafeInteger(value) || value < 1) throw new RequestGuardError(400, 'Invalid native entry bound');
          return value as EntryId;
        };
        const maxEntryId = entryId(params.get('maxEntryId')), minEntryId = entryId(params.get('minEntryId'));
        const order = params.get('order');
        if (order !== null && order !== 'ascending' && order !== 'descending') return failure(400, 'invalid-request');
        const page = await read.entries({ ...(maxEntryId === undefined ? {} : { maxEntryId }), ...(minEntryId === undefined ? {} : { minEntryId }), ...(order === null ? {} : { order }) }, limit, cursor);
        if (access.revoked?.aborted) return failure(403, 'not-authorized');
        return json({ page });
      }
      if (request.method === 'POST' && operation === 'submit') {
        const input = await body(request);
        if (typeof input['requestId'] !== 'string' || !input['requestId'] || !content(input['content'])
          || (input['whenBusy'] !== undefined && typeof input['whenBusy'] !== 'string')
          || (access.requestContext && !contextValue(input['context']))) return failure(400, 'invalid-request');
        if (!await allowed('submit')) return failure(403, 'not-authorized'); // before `prepareInput`: a denied submitter reads nothing
        let prepared = input['content'];
        if (access.prepareInput) { try { prepared = await access.prepareInput(prepared); } catch { /* submit what the person typed */ } }
        if (access.revoked?.aborted) return failure(403, 'not-authorized');
        if (access.requestContext && input['context'] !== undefined) await access.requestContext(input['context'] as Readonly<Record<string, unknown>>);
        if (access.revoked?.aborted) return failure(403, 'not-authorized');
        const submission = await conversation.submit({ type: 'input', requestId: input['requestId'], content: prepared,
          ...(input['whenBusy'] === undefined ? {} : { whenBusy: input['whenBusy'] as NonNullable<InputSubmissionDraft['whenBusy']> }) }, context);
        return json({ submissionId: submission.id });
      }
      if (request.method === 'POST' && operation === 'abort') {
        if (!await allowed('abort') || access.revoked?.aborted) return failure(403, 'not-authorized');
        // The body carries nothing, but it is read under the shared guard before answering: on Workers a body still unread
        // when the response is sent makes the runtime throw "Can't read from request stream after response has been sent".
        await body(request).catch(() => undefined);
        await conversation.abort(context);
        return json({ aborted: true });
      }
      if (request.method === 'POST' && operation === 'answer') {
        if (!access.answer) return failure(404, 'not-supported');
        const input = await body(request);
        if (typeof input['callId'] !== 'string' || !input['callId'] || typeof input['answer'] !== 'string') return failure(400, 'invalid-request');
        if (!await allowed('answer')) return failure(403, 'not-authorized');
        return json(await access.answer(input['callId'], input['answer']));
      }
      if (request.method === 'POST' && operation === 'configure') {
        if (!access.configure) return failure(404, 'not-supported');
        const input = await body(request);
        const model = input['model'], level = input['thinkingLevel'];
        const validModel = model === undefined || (model !== null && typeof model === 'object' && !Array.isArray(model)
          && typeof (model as Record<string, unknown>)['provider'] === 'string' && typeof (model as Record<string, unknown>)['modelId'] === 'string');
        if (!validModel || (level !== undefined && typeof level !== 'string') || (model === undefined && level === undefined)) return failure(400, 'invalid-request');
        const { provider, modelId } = (model ?? {}) as Record<string, string>;
        if (!await allowed('configure') || access.revoked?.aborted) return failure(403, 'not-authorized');
        return json(await access.configure({ ...(model === undefined ? {} : { model: { provider: provider!, modelId: modelId! } }), ...(level === undefined ? {} : { thinkingLevel: level }) }));
      }
      if (request.method === 'POST' && operation === 'withdraw') {
        if (!access.abortSubmission) return failure(404, 'not-supported');
        const id = (await body(request))['submissionId'];
        if (typeof id !== 'number' && typeof id !== 'string') return failure(400, 'invalid-request');
        if (!await allowed('withdraw')) return failure(403, 'not-authorized');
        // The native operation scopes the id to this conversation; an unknown or foreign id is "too late" to the caller.
        const result = await access.abortSubmission(id as SubmissionId);
        return json({ result: result === 'not_found' ? 'settled' : result });
      }
    } catch (error) {
      if (error instanceof RequestGuardError) return failure(error.status, error.status === 413 ? 'request-too-large' : error.status === 415 ? 'unsupported-media-type' : 'invalid-request');
      // A host admission refused the input before it reached the conversation (for example `MeteringRefused` from `@hachej/boring-agent/metering`).
      if (error instanceof Error && (error as { code?: unknown }).code === 'submission-refused') {
        return Response.json({ schema: CHAT_TRANSPORT.schema, version: CHAT_TRANSPORT.version, reason: 'submission-refused', message: error.message.slice(0, 500) }, { status: 402, headers });
      }
      return failure(503, 'source-unavailable'); // the detail stays on the host: a message can carry paths, hosts or credentials
    }
    return failure(404, 'unknown-operation');
  };
}

/**
 * A view of a native conversation whose `submit` first hands the input to a host admission function (for example Cloudflare's
 * `PiHarness.submit`, which schedules the wake job that restarts an evicted Durable Object) and then answers with the native
 * submission, found by its request ID. Every other member is the native conversation, bound to it. The admission must be
 * idempotent on `requestId`, as native submission is.
 */
export function routeSubmissions(conversation: Conversation, admit: (draft: InputSubmissionDraft, context: Context) => Promise<unknown>): Conversation {
  return new Proxy(conversation, { get: (target, key) => {
    if (key === 'submit') {
      return async (draft: InputSubmissionDraft, context: Context) => {
        const requestId = draft.requestId;
        if (!requestId) throw new TypeError('A request ID is required');
        await admit(draft, context);
        const record = await target.commit(tx => tx.submissionByRequest(target.id, requestId), context);
        if (!record) throw new Error('The submission was not recorded');
        return { id: record.id };
      };
    }
    const value: unknown = Reflect.get(target, key, target);
    return typeof value === 'function' ? value.bind(target) : value;
  } });
}

/**
 * A WebSocket accepted with the Durable Object Hibernation API (`ctx.acceptWebSocket`): the members this handler uses. Any host
 * with the same shape can mount it (tests use an in-memory one).
 */
export interface HibernatableSocket {
  send(message: string): void;
  close(code?: number, reason?: string): void;
  serializeAttachment(value: unknown): void;
  deserializeAttachment(): unknown;
}

/** The Hibernation API of a Durable Object's `ctx` (`DurableObjectState`) that the handler uses. */
export interface HibernationState {
  acceptWebSocket(socket: HibernatableSocket, tags?: string[]): void;
  getWebSockets(tag?: string): HibernatableSocket[];
  setWebSocketAutoResponse?(pair?: unknown): void;
}

/**
 * Per-socket state, kept in the socket's attachment so it survives hibernation. `owner` and `conversationId` are the host's
 * (who the socket acts for, which conversation it watches); further JSON fields are the host's to add. `socketId` is the handler's.
 */
export interface ConversationSocketAttachment {
  readonly owner: string;
  readonly conversationId: string;
  readonly [key: string]: unknown;
}

export interface ConversationSocketOptions {
  /** The Durable Object's `ctx`, or any object with the same Hibernation API. */
  readonly state: HibernationState;
  /**
   * Authenticate the upgrade request and select the conversation, in trusted host code (also the Origin policy: a browser sends
   * cookies with a cross-site upgrade). Null refuses with 401 before any socket is accepted. The result becomes the attachment.
   */
  readonly authenticate: (request: Request) => Promise<ConversationSocketAttachment | null>;
  /**
   * The conversation access for a socket, from its attachment alone: called when the socket is accepted and again after every
   * hibernation (the original request is gone by then). The same access the HTTP handler gets from `authenticate`. Null closes the socket.
   */
  readonly access: (attachment: ConversationSocketAttachment) => Promise<ChatTransportAccess | null>;
  /**
   * Origins (`https://app.example`) besides the request's own host that may open the socket. A browser upgrade whose `Origin` is
   * neither the request's host nor listed here is refused (a cross-site page would otherwise ride the visitor's cookies); a request with
   * no `Origin` (not a browser) is not subject to this check, so `authenticate` still decides who it is.
   */
  readonly allowedOrigins?: readonly string[];
}

/** A socket frame a client sends: `ping` (plain text), or a call with the HTTP handler's operation, query parameters and JSON body. */
type SocketCall = { readonly kind: 'call'; readonly id: string; readonly op: string; readonly params?: Record<string, string>; readonly body?: unknown };
/** The subprotocol a browser client offers and the handler selects. Other offered values (for example a credential) are the host's. */
export const CHAT_SOCKET_PROTOCOL = 'boring.chat';

export interface ConversationSocketHandler {
  /** Cloudflare upgrade: authenticate, create the `WebSocketPair`, accept the server end and answer 101 (401 when refused). */
  readonly fetch: (request: Request) => Promise<Response>;
  /** Accept a socket the host created: tag it with its owner and conversation, store the attachment and send the first view. False when refused. */
  readonly accept: (socket: HibernatableSocket, request: Request) => Promise<boolean>;
  /** The Durable Object's `webSocketMessage`. */
  readonly webSocketMessage: (socket: HibernatableSocket, message: string | ArrayBuffer) => Promise<void>;
  /** The Durable Object's `webSocketClose` (and `webSocketError`): stops the socket's watch. */
  readonly webSocketClose: (socket: HibernatableSocket, code?: number, reason?: string) => Promise<void>;
  /**
   * Reopen the watch of every accepted socket that has none in memory: after a wake from hibernation each socket receives a
   * complete view again, then deltas. Messages and upgrades call it; a host also calls it when the object wakes for another
   * reason (an alarm), so a resumed run reaches open pages. Idempotent.
   */
  readonly resume: () => Promise<void>;
  /** Send a host event (`{"kind":"event","event":...}`, for example presence or the conversation list) to the sockets of an owner or conversation, or all. */
  readonly broadcast: (event: unknown, to?: { readonly owner?: string; readonly conversationId?: string }) => void;
  /** The attachments of the open sockets, optionally by owner or conversation: presence is these. */
  readonly connections: (to?: { readonly owner?: string; readonly conversationId?: string }) => ConversationSocketAttachment[];
}

/** Whether a WebSocket upgrade comes from the page's own host or a listed origin. No `Origin` header: not a browser, so not subject. */
function sameOrigin(request: Request, allowed: readonly string[] = []): boolean {
  const origin = request.headers.get('origin');
  if (origin === null) return true;
  if (allowed.includes(origin)) return true;
  try { return new URL(origin).host === (request.headers.get('host') ?? new URL(request.url).host); } catch { return false; }
}

const ownerTag = (owner: string) => `owner:${owner}`;
const conversationTag = (id: string) => `conversation:${id}`;
const tagFor = (to?: { readonly owner?: string; readonly conversationId?: string }) =>
  to?.conversationId !== undefined ? conversationTag(to.conversationId) : to?.owner !== undefined ? ownerTag(to.owner) : undefined;

/**
 * The chat transport over hibernatable WebSockets, for a Durable Object (`ctx.acceptWebSocket`). One socket carries the watch (the
 * same `view` then `ops` frames as the NDJSON stream) and every call (`{"kind":"call","id","op","params","body"}`, answered by
 * `{"kind":"reply","id","status","body"}`), which runs through `createChatTransportHandler` unchanged: the same validation,
 * `allow`, `project` and request-id deduplication. A submit without `whenBusy` is a follow-up when the conversation is busy.
 * Nothing in memory is needed between messages: the attachment holds the socket's owner and conversation, so an idle page lets
 * the object hibernate, and a wake reopens the watches with a complete view. `ping` is answered `pong` (on Cloudflare by the
 * platform's auto-response, without waking the object).
 */
export function createConversationSocketHandler(options: ConversationSocketOptions): ConversationSocketHandler {
  const { state } = options;
  const Pair = (globalThis as { WebSocketRequestResponsePair?: new (request: string, response: string) => unknown }).WebSocketRequestResponsePair;
  if (Pair && state.setWebSocketAutoResponse) state.setWebSocketAutoResponse(new Pair('ping', 'pong'));
  /** Live watches by socket id, in memory only: empty after a wake, refilled by `attach`. */
  const live = new Map<string, Promise<{ readonly access: ChatTransportAccess; readonly watch?: ConversationWatch } | null>>();
  const attachment = (socket: HibernatableSocket) => socket.deserializeAttachment() as (ConversationSocketAttachment & { readonly socketId: string }) | null;
  const send = (socket: HibernatableSocket, value: string) => { try { socket.send(value); } catch { /* the socket closed meanwhile */ } };
  const end = (socket: HibernatableSocket, reason: string, code = 1000) => {
    send(socket, JSON.stringify({ kind: 'end', reason }));
    try { socket.close(code, reason); } catch { /* already closed */ }
  };

  function attach(socket: HibernatableSocket) {
    const found = attachment(socket);
    if (!found) return Promise.resolve(null);
    let entry = live.get(found.socketId);
    if (entry) return entry;
    entry = (async () => {
      let access: ChatTransportAccess | null;
      try { access = await options.access(found); } catch { access = null; }
      if (!access) { live.delete(found.socketId); end(socket, 'revoked', 1008); return null; }
      const watch = await openWatch(access).catch(() => null);
      if (!watch) { live.delete(found.socketId); end(socket, 'revoked', 1008); return null; }
      const { project } = access;
      const frame = (value: WatchFrame) => {
        try { send(socket, encodeFrame(value, project)); }
        catch { void watch.stop(); end(socket, 'projection_failed', 1011); }
      };
      frame({ kind: 'view', view: watch.value });
      access.revoked?.addEventListener('abort', () => { void watch.stop(); }, { once: true });
      watch.start(async (view, ops) => frame(project ? { kind: 'view', view } : { kind: 'ops', ops }));
      void watch.closed.then(result => {
        if (live.get(found.socketId) !== entry) return;
        live.delete(found.socketId);
        // A host restart (`session_closed`) asks the client to reconnect; the other reasons are final.
        end(socket, access!.revoked?.aborted ? 'revoked' : result.reason, result.reason === 'session_closed' ? 1012 : 1000);
      });
      return { access, watch };
    })();
    live.set(found.socketId, entry);
    return entry;
  }

  async function resume() { await Promise.all(state.getWebSockets().map(socket => attach(socket))); }

  async function accept(socket: HibernatableSocket, request: Request): Promise<boolean> {
    if (!sameOrigin(request, options.allowedOrigins)) return false;
    const found = await options.authenticate(request);
    if (!found) return false;
    state.acceptWebSocket(socket, [ownerTag(found.owner), conversationTag(found.conversationId)]);
    socket.serializeAttachment({ ...found, socketId: crypto.randomUUID() });
    void resume();
    return true;
  }

  async function call(socket: HibernatableSocket, frame: SocketCall) {
    const entry = await attach(socket);
    if (!entry) return;
    const url = new URL('https://socket.invalid/');
    for (const [key, value] of Object.entries(frame.params ?? {})) if (typeof value === 'string') url.searchParams.set(key, value);
    url.searchParams.set('op', frame.op);
    let body = frame.body;
    if (frame.op === 'submit' && body !== null && typeof body === 'object' && !Array.isArray(body) && (body as Record<string, unknown>)['whenBusy'] === undefined) body = { ...body, whenBusy: 'followUp' };
    let response: Response;
    if (frame.op === 'watch') response = failure(400, 'invalid-request');
    else {
      // The HTTP handler, unchanged, with this socket's access: the same checks, `allow`, `project` and request-id deduplication.
      const handler = createChatTransportHandler({ authenticate: async () => entry.access });
      response = await handler(new Request(url, body === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }));
    }
    const reply = await response.json().catch(() => null);
    send(socket, JSON.stringify({ kind: 'reply', id: frame.id, status: response.status, body: reply }));
  }

  return {
    accept,
    resume,
    async fetch(request) {
      if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') return failure(426, 'upgrade-required');
      const Socket = (globalThis as { WebSocketPair?: new () => Record<0 | 1, HibernatableSocket> }).WebSocketPair;
      if (!Socket) return failure(501, 'not-supported');
      const pair = new Socket();
      let accepted: boolean;
      try { accepted = await accept(pair[1], request); } catch { return failure(503, 'authentication-unavailable'); }
      if (!accepted) return failure(sameOrigin(request, options.allowedOrigins) ? 401 : 403, sameOrigin(request, options.allowedOrigins) ? 'authentication-required' : 'origin-not-allowed');
      const offered = (request.headers.get('sec-websocket-protocol') ?? '').split(',').map(value => value.trim());
      return new Response(null, { status: 101, webSocket: pair[0], ...(offered.includes(CHAT_SOCKET_PROTOCOL) ? { headers: { 'sec-websocket-protocol': CHAT_SOCKET_PROTOCOL } } : {}) } as ResponseInit);
    },
    async webSocketMessage(socket, message) {
      if (message === 'ping') return send(socket, 'pong');
      let frame: SocketCall;
      try { frame = JSON.parse(typeof message === 'string' ? message : new TextDecoder().decode(message)) as SocketCall; }
      catch { return; }
      if (frame?.kind !== 'call' || typeof frame.id !== 'string' || typeof frame.op !== 'string') return;
      void resume();
      await call(socket, frame);
    },
    async webSocketClose(socket, code, reason) {
      const found = attachment(socket);
      const entry = found ? live.get(found.socketId) : undefined;
      if (found) live.delete(found.socketId);
      const opened = await entry?.catch(() => null);
      await opened?.watch?.stop();
      try { socket.close(code === undefined || code === 1005 || code === 1006 || code === 1015 ? 1000 : code, reason); } catch { /* already closed */ }
    },
    broadcast(event, to) {
      const text = JSON.stringify({ kind: 'event', event });
      for (const socket of state.getWebSockets(tagFor(to))) send(socket, text);
    },
    connections: to => state.getWebSockets(tagFor(to)).flatMap(socket => { const found = attachment(socket); return found ? [found] : []; }),
  };
}
