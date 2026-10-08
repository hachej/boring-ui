import type { Context } from '@earendil-works/chord';
import { RequestGuardError, hasJsonContentType, readJsonBody } from '@hachej/boring-files/request-guard';
import type { Conversation, ConversationView, ConversationWatch, Cursor, EntryRecord, InputSubmissionDraft, SubmissionId, SubmissionRecord, WatchEnd } from '@earendil-works/pi-durable';

/** Wire protocol shared with the browser client in `@hachej/boring-ui-kit/remote-chat`. */
export const CHAT_TRANSPORT = Object.freeze({ schema: 'boring.chat-transport', version: 1, maxRequestBytes: 8_388_608, maxHistoryPage: 200, maxPendingFrames: 100, heartbeatMs: 15_000 });

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
  /** Refuse an effect call. Reading stays governed by `authenticate` and `project`. */
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
    async entries(limit: number, cursor: Cursor | undefined) {
      const page = await conversation.entries({}, limit, cursor, context);
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

/**
 * Stream newline-delimited JSON. A trusted viewer receives one view and then the exact native operation batches,
 * replayed in the browser with `@earendil-works/chord/delta`. With `project`, raw operations never leave the host:
 * the viewer receives complete projected views, and a slow reader gets the latest one rather than a backlog.
 */
function stream(watch: ConversationWatch, project: ((view: ConversationView) => ConversationView) | undefined, signal: AbortSignal, heartbeatMs: number): Response {
  type Pending = { readonly kind: 'view'; readonly view: ConversationView } | { readonly kind: 'ops'; readonly ops: readonly unknown[] };
  let pending: Pending[] = [{ kind: 'view', view: watch.value }], wake: (() => void) | undefined, end: WatchEnd | undefined, finished = false;
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
        try { line = JSON.stringify(frame.kind === 'view' && project ? { kind: 'view', view: project(frame.view) } : frame); }
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
        const watch = await conversation.watch(context);
        if (signal.aborted) { await watch.stop(); return failure(403, 'not-authorized'); }
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
        const page = await read.entries(limit, cursor);
        if (access.revoked?.aborted) return failure(403, 'not-authorized');
        return json({ page });
      }
      if (request.method === 'POST' && operation === 'submit') {
        const input = await body(request);
        if (typeof input['requestId'] !== 'string' || !input['requestId'] || !content(input['content'])
          || (input['whenBusy'] !== undefined && typeof input['whenBusy'] !== 'string')) return failure(400, 'invalid-request');
        let prepared = input['content'];
        if (access.prepareInput) { try { prepared = await access.prepareInput(prepared); } catch { /* submit what the person typed */ } }
        if (!await allowed('submit') || access.revoked?.aborted) return failure(403, 'not-authorized');
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
      return failure(503, error instanceof Error && error.message ? `source-unavailable: ${error.message.slice(0, 200)}` : 'source-unavailable');
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
