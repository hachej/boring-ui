import type { Context } from '@earendil-works/chord/context';
import { awaitWithContext, BACKGROUND_CONTEXT } from '@earendil-works/chord/context';
import { applyImmutable } from '@earendil-works/chord/delta';
import type { ConversationView, ConversationWatch, Cursor, InputSubmissionDraft, Page, EntryRecord, SettledSubmissionRecord, SubmissionRecord, WatchEnd } from '@earendil-works/pi-durable';
import type { ChatConversation, ChatLink } from './native-chat.js';
import { createChatOutbox } from './chat-outbox.js';

/** Browser client for the `@hachej/boring-agent/chat-transport` handler. Bundles only Chord's standalone delta replay, no Pi runtime. */
export interface RemoteChatOptions {
  /** Handler URL. Existing query parameters (for example a conversation selector) are preserved. */
  readonly endpoint: string | URL;
  /** The host adds credentials here. */
  readonly fetch: (request: Request) => Promise<Response>;
  /**
   * The current screen context, read at each submit. An object travels as the submit body's `context` (beside `requestId`, `content`
   * and `whenBusy`) for a host whose chat transport has `requestContext`; `undefined` sends none. Advisory text for the model, never policy.
   */
  readonly requestContext?: () => Readonly<Record<string, unknown>> | undefined;
  /** Submission status poll interval for `Submission.wait`. */
  readonly pollMs?: number;
  /**
   * Release the watch stream while the page is hidden and reopen it when visible again (default true; only effective where
   * `document.visibilityState` exists). Browsers cap concurrent HTTP/1.1 connections per host, so one idle stream per background tab
   * can starve every other request. A reopened watch begins with a complete view, so nothing is lost. Submissions, answers and
   * running turns are separate requests and are never affected. Pass false to keep the stream open while hidden.
   */
  readonly pauseWhenHidden?: boolean;
  /**
   * Backoff for reopening a lost watch stream: the delay doubles from `baseDelayMs` (default 1000) up to `maxDelayMs` (default
   * 30000), each with random jitter of up to half its length. Reopening stops when the watch is stopped (controller disposed).
   */
  readonly reconnect?: { readonly baseDelayMs?: number; readonly maxDelayMs?: number };
  /**
   * `websocket`: carry the watch and every call over one WebSocket to the same endpoint (`ws:`/`wss:` from the page), served by
   * `createConversationSocketHandler` of `@hachej/boring-agent/chat-transport`. A Durable Object can then hibernate while the page
   * is idle. Calls not yet answered when the socket drops are sent again unchanged (same request ID) on the next socket, and every
   * socket begins with a complete view. If the first socket cannot open, the chat uses HTTP (`fetch`) instead. Default `http`.
   */
  readonly transport?: 'http' | 'websocket';
  /**
   * WebSocket details. `open` creates the socket (default `new WebSocket(url, 'boring.chat')`); a browser cannot set headers on a
   * WebSocket, so a host with bearer tokens offers its credential as another subprotocol here. `pingMs` (default 15000): a `ping`
   * every interval; a socket silent for 2.5 intervals is treated as lost and reopened.
   */
  readonly webSocket?: { readonly open?: (url: URL) => WebSocket; readonly pingMs?: number };
  /**
   * How long the first view of a connection may take before the chat gives up and reports an error (default 18000). Without it a
   * host that accepts the watch request but never sends a view leaves the page on « Connecting… » for good. Later views are
   * bounded by the heartbeat.
   */
  readonly firstViewTimeoutMs?: number;
  /** Host events the socket carries beside the chat (`broadcast` on the server, for example presence or the conversation list). */
  readonly onEvent?: (event: unknown) => void;
}

export interface RemoteChat {
  /** The members of the native conversation the chat controller uses, served by the remote host. Nothing else is pretended. */
  readonly conversation: ChatConversation;
  /** Placeholder for the controller's Context argument. The server owns the real native Context. */
  readonly context: Context;
  /** Answer an assistant-entry-bound question ID from the transcript. The host authenticates and resolves it. */
  readonly answer: (callId: string, answer: string) => Promise<{ kind: 'answered' } | { kind: 'denied' | 'conflict' | 'unknown-question'; reason?: string }>;
  /** Ask the host to change this conversation's model or thinking level. The host decides: a refusal carries its reason. */
  readonly configure: (change: { readonly model?: { readonly provider: string; readonly modelId: string }; readonly thinkingLevel?: string }) => Promise<{ kind: 'configured' } | { kind: 'refused'; reason?: string }>;
  /** Stop a watch that the controller never claimed. Safe to call at any time; the controller's own watch is its to stop. */
  readonly close: () => Promise<void>;
  /** Withdraw a queued message before it runs. `already_placed` and `settled` mean it was too late. */
  readonly withdraw: (submissionId: SubmissionRecord['id']) => Promise<'aborted' | 'already_placed' | 'settled'>;
  /**
   * True for a `SubmissionRefused` error: the input was definitely not admitted, so the controller shows the host's refusal as a
   * blocked send instead of reconciling an unknown one. Spreading the remote chat into the controller options passes it.
   */
  readonly definitelyNotAdmitted: (error: unknown) => boolean;
  /** Whether a lost watch stream is being reopened. Spreading the remote chat into the controller options passes it, so the controller reads `reconnecting`. */
  readonly link: ChatLink;
}

type Ops = Parameters<typeof applyImmutable>[1];
type Frame = { readonly kind: 'view'; readonly view: ConversationView } | { readonly kind: 'ops'; readonly ops: Ops } | { readonly kind: 'end'; readonly reason: string };
/** Sent by the server while the stream is idle so proxies keep it open; it announces the interval and never reaches the transcript. */
type Heartbeat = { readonly kind: 'heartbeat'; readonly intervalMs?: number };
/** A stream that ended without the server ending it (a dropped connection, or silence past 2.5 heartbeats) can be reopened. */
type Watch = ConversationWatch & { readonly lost: () => boolean };

/** A watch request the host answered with an error status. */
class WatchRefused extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

/** The host refused a submitted input before it reached the conversation (status 402, `submission-refused`); `message` is the host's words. */
export class SubmissionRefused extends Error {
  readonly code = 'submission-refused';
  constructor(message: string) { super(message); this.name = 'SubmissionRefused'; }
}

/**
 * A photo the host sends as a link (an image part with a `url`, `data: ''`, so the first view stays small) is handed out with its
 * `url` resolved against the chat endpoint: a relative link names the endpoint's own route (`?op=image&…`), whatever page the chat is
 * on. The wire replica stays as sent, so later native operations (a field set, a string append) replay on the host's own values; the
 * linked copy is derived after each replay. Values are immutable, so a node maps to one linked node for good: unchanged entries keep
 * their identity and only changed paths are walked again.
 */
function imageLinker(base: URL): <T>(value: T) => T {
  const linked = new WeakMap<object, unknown>();
  const link = (node: unknown): unknown => {
    if (!node || typeof node !== 'object') return node;
    if (linked.has(node)) return linked.get(node);
    let out: unknown = node;
    if (Array.isArray(node)) {
      const items = node.map(link);
      if (items.some((item, index) => item !== node[index])) out = items;
    } else {
      const record = node as Record<string, unknown>;
      let copy: Record<string, unknown> | undefined;
      for (const key of Object.keys(record)) {
        const value = record[key];
        const next = key === 'url' && record.type === 'image' && typeof value === 'string' ? resolved(value) : link(value);
        if (next !== value) (copy ??= { ...record })[key] = next;
      }
      if (copy) out = copy;
    }
    linked.set(node, out);
    return out;
  };
  // A link that is not a URL is left as sent: the chat draws a placeholder.
  const resolved = (url: string) => { try { return new URL(url, base).href; } catch { return url; } };
  return <T>(value: T) => link(value) as T;
}

async function reason(response: Response): Promise<string> {
  try { const value = await response.json() as { reason?: unknown }; if (typeof value.reason === 'string') return value.reason; } catch { /* fall through */ }
  return `status ${response.status}`;
}

/**
 * Connect a browser to one remote native conversation. Resolves after the first view so the conversation identity is the
 * server's. A dropped or silent stream is reopened automatically with backoff (see `reconnect` and `link`); it never means the
 * native task stopped.
 */
export async function createRemoteChat(options: RemoteChatOptions): Promise<RemoteChat> {
  const base = new URL(options.endpoint, globalThis.location?.href);
  const linkImages = imageLinker(base);
  const send = options.fetch, pollMs = options.pollMs ?? 500;
  const backoff = { base: options.reconnect?.baseDelayMs ?? 1000, max: options.reconnect?.maxDelayMs ?? 30_000 };
  const url = (op: string, extra: Record<string, string> = {}) => {
    const target = new URL(base); target.searchParams.set('op', op);
    for (const [key, value] of Object.entries(extra)) target.searchParams.set(key, value);
    return target;
  };
  // The transport in use: `websocket` until its first socket fails to open, then `http` for good.
  let mode = options.transport ?? 'http', current: WebSocket | undefined, seq = 0;
  /** Calls sent over a socket and not answered yet, by call ID: sent again unchanged on the next socket. */
  const outbox = createChatOutbox<{ readonly text: string; readonly http: () => Request }, Response>();
  function exchange(op: string, init: RequestInit, extra: Record<string, string>): Promise<Response> {
    const http = () => new Request(url(op, extra), init);
    if (mode !== 'websocket') return send(http());
    const id = `c${++seq}`;
    const text = JSON.stringify({ kind: 'call', id, op, params: extra, ...(typeof init.body === 'string' ? { body: JSON.parse(init.body) as unknown } : {}) });
    const pending = outbox.enqueue(id, { text, http });
    try { current?.send(text); } catch { /* sent again on the next socket */ }
    return pending;
  }
  /** Leave the socket for HTTP: calls still waiting for a socket go over HTTP, unchanged (same request ID, so the host deduplicates). */
  function fallBack() {
    mode = 'http';
    const pending = [...outbox.values()]; outbox.clear();
    for (const call of pending) send(call.input.http()).then(call.resolve, call.reject);
  }
  async function call<T>(op: string, init: RequestInit = {}, extra: Record<string, string> = {}): Promise<T> {
    const response = await exchange(op, init, extra);
    if (response.status === 402 && op === 'submit') {
      const refused = await response.json().catch(() => ({})) as { reason?: unknown; message?: unknown };
      if (refused.reason === 'submission-refused') throw new SubmissionRefused(typeof refused.message === 'string' && refused.message ? refused.message : 'The host refused this message');
    }
    if (!response.ok) throw new Error(`Remote chat ${op} failed: ${await reason(response)}`);
    return await response.json() as T;
  }
  const post = <T>(op: string, value: unknown) => call<T>(op, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(value) });
  const lookup = async (requestId: string) => (await call<{ record: SubmissionRecord | null }>('submission', {}, { requestId })).record ?? undefined;

  /** One open watch connection: its first view, then frames until it ends (`undefined`: it closed without an end frame). */
  type Source = { readonly first: ConversationView; readonly next: () => Promise<Frame | undefined>; readonly cancel: () => void; /** The server ended the stream: let it close on its own, no abort. Resolves once closed. */ readonly release?: () => Promise<void> };

  const ping = options.webSocket?.pingMs ?? 15_000;
  const openSocket = options.webSocket?.open ?? ((target: URL) => new WebSocket(target, 'boring.chat'));
  function socketSource(): Promise<Source> {
    return new Promise((ready, refuse) => {
      const target = new URL(base); target.protocol = target.protocol === 'https:' ? 'wss:' : 'ws:';
      let socket: WebSocket;
      try { socket = openSocket(target); } catch (error) { refuse(error); return; }
      const frames: Frame[] = [];
      let wake: (() => void) | undefined, closed = false, opened = false, heard = Date.now();
      const notify = () => { const resume = wake; wake = undefined; resume?.(); };
      const finish = () => {
        if (closed) return;
        closed = true; clearInterval(timer); clearTimeout(firstView); if (current === socket) current = undefined; notify();
        if (!opened) refuse(new Error('Remote chat socket closed before its first view'));
      };
      const timer = setInterval(() => {
        if (Date.now() - heard > ping * 2.5) { try { socket.close(); } catch { /* closing */ } finish(); }
        else if (socket.readyState === 1) socket.send('ping');
      }, ping);
      const next = async () => { while (frames.length === 0 && !closed) await new Promise<void>(resolve => { wake = resolve; }); return frames.shift(); };
      const cancel = () => { try { socket.close(1000); } catch { /* closing */ } finish(); };
      // A socket that opens but never sends its first view is closed (then HTTP is tried, or the error is reported).
      const firstView = setTimeout(() => { if (!opened) { try { socket.close(); } catch { /* closing */ } finish(); } }, options.firstViewTimeoutMs ?? 18_000);
      socket.onclose = finish;
      socket.onerror = () => { try { socket.close(); } catch { /* closing */ } finish(); };
      socket.onmessage = event => {
        heard = Date.now();
        if (typeof event.data !== 'string' || event.data === 'pong') return;
        let frame: Frame | { readonly kind: 'reply'; readonly id: string; readonly status: number; readonly body: unknown } | { readonly kind: 'event'; readonly event: unknown };
        try { frame = JSON.parse(event.data) as typeof frame; } catch { return; }
        if (frame.kind === 'reply') {
          outbox.resolve(frame.id, new Response(JSON.stringify(frame.body), { status: frame.status, headers: { 'content-type': 'application/json' } }));
          return;
        }
        if (frame.kind === 'event') { try { options.onEvent?.(frame.event); } catch { /* a host listener never breaks the chat */ } return; }
        if (!opened) {
          if (frame.kind !== 'view') { cancel(); return; }
          opened = true; current = socket;
          // Unanswered calls go again, unchanged: a submit keeps its request ID, so the host runs it once.
          for (const pending of outbox.values()) socket.send(pending.input.text);
          ready({ first: frame.view, next, cancel });
          return;
        }
        frames.push(frame); notify();
      };
    });
  }

  async function httpSource(): Promise<Source> {
    const stopped = new AbortController();
    // The whole wait for the first view (the response, then its first line) is bounded: a host that never answers is an error with retry.
    const limit = options.firstViewTimeoutMs ?? 18_000;
    let giveUp: ReturnType<typeof setTimeout> | undefined;
    const late = new Promise<never>((_, reject) => { giveUp = setTimeout(() => { stopped.abort(); reject(new WatchRefused('Remote chat watch timed out before its first view', 408)); }, limit); });
    late.catch(() => {});
    try { return await Promise.race([openHttp(stopped), late]); }
    finally { clearTimeout(giveUp); }
  }
  async function openHttp(stopped: AbortController): Promise<Source> {
    const response = await send(new Request(url('watch'), { signal: stopped.signal }));
    if (!response.ok || !response.body) throw new WatchRefused(`Remote chat watch failed: ${await reason(response)}`, response.status);
    const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
    let pending = '', staleMs = 0;
    // Once the server has announced its heartbeat interval, a read waiting 2.5 intervals means the stream is dead even if the
    // socket still looks open (a proxy that dropped it silently).
    async function read() {
      if (!staleMs) return reader.read();
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        return await Promise.race([reader.read(), new Promise<never>((_, reject) => {
          timer = setTimeout(() => { stopped.abort(); reject(new Error('Remote chat stream went silent')); }, staleMs);
        })]);
      } finally { clearTimeout(timer); }
    }
    async function next(): Promise<Frame | undefined> {
      for (;;) {
        const end = pending.indexOf('\n');
        if (end >= 0) {
          const line = pending.slice(0, end); pending = pending.slice(end + 1);
          const frame = JSON.parse(line) as Frame | Heartbeat;
          if (frame.kind === 'heartbeat') { if (typeof frame.intervalMs === 'number' && frame.intervalMs > 0) staleMs = frame.intervalMs * 2.5; continue; }
          return frame;
        }
        const chunk = await read();
        if (chunk.done) return undefined;
        pending += chunk.value;
      }
    }
    const first = await next().catch(() => undefined);
    if (first?.kind !== 'view') { stopped.abort(); throw new Error('Remote chat watch ended before its first view'); }
    // The server ended the stream itself: drain it to its close instead of cancelling, which the browser logs as ERR_ABORTED.
    // A host that never closes it is aborted after a short wait.
    const release = async () => {
      const wait = setTimeout(() => stopped.abort(), 2000);
      try { while (!(await reader.read()).done); } catch { /* closed */ } finally { clearTimeout(wait); }
    };
    return { first: first.view, next, cancel: () => stopped.abort(), release };
  }

  let socketWorked = false;
  async function watch(): Promise<Watch> {
    let source: Source;
    if (mode === 'websocket') {
      try { source = await socketSource(); socketWorked = true; }
      catch (error) { if (socketWorked) throw error; fallBack(); source = await httpSource(); }
    } else source = await httpSource();
    const { next } = source;
    let lost = false;
    let value = source.first, started = false, settle!: (end: WatchEnd) => void, ended: WatchEnd | undefined;
    const closed = new Promise<WatchEnd>(resolve => { settle = resolve; });
    let draining = false;
    const finish = (end: WatchEnd, served = false) => {
      if (ended) return;
      ended = end;
      if (served && source.release) { draining = true; void source.release().finally(() => settle(end)); } else { source.cancel(); settle(end); }
    };
    const handle: Watch = {
      get value() { return linkImages(value); },
      closed,
      lost: () => lost,
      // An explicit stop (the page hidden, the chat disposed) interrupts a draining served end; a served end nobody stops still drains without abort.
      stop: async () => { if (draining) source.cancel(); else finish({ kind: 'stopped' }); return closed; },
      start: listener => {
        if (started) throw new Error('Watch already started');
        started = true;
        void (async () => {
          try {
            for (;;) {
              const frame = await next();
              if (ended) return;
              // The stream ending without an end frame is a lost connection, not a native terminal state. A server-sent
              // `session_closed` (a host restart, for example) is reopened too; `retired`, `stopped` and `revoked` are final.
              if (!frame || frame.kind === 'end') {
                lost = !frame || frame.reason === 'session_closed';
                return finish({ kind: frame?.reason === 'stopped' ? 'stopped' : 'ended' }, frame?.kind === 'end');
              }
              // Native operation batches are replayed with the upstream delta implementation; a view frame resets the replica.
              value = frame.kind === 'view' ? frame.view : applyImmutable(value, frame.ops) as ConversationView;
              try { await listener({ kind: 'value', value: linkImages(value), ops: [], retired: false }, context); }
              catch (error) { return finish({ kind: 'listener_error', error: error instanceof Error ? error : new Error(String(error)) }); }
            }
          } catch (error) {
            if (ended) return;
            // A failed read (network error, silence) is a lost connection; a line the client cannot parse is not.
            if (error instanceof SyntaxError) return finish({ kind: 'listener_error', error });
            lost = true; finish({ kind: 'ended' });
          }
        })();
      },
    };
    return handle;
  }

  const page = options.pauseWhenHidden === false ? undefined : (globalThis as { document?: Document }).document;
  const hidden = () => page?.visibilityState === 'hidden';
  const linkListeners = new Set<() => void>();
  let reconnecting = false;
  const setReconnecting = (next: boolean) => {
    if (reconnecting === next) return;
    reconnecting = next;
    for (const listener of [...linkListeners]) { try { listener(); } catch { /* a viewer's listener never breaks the link */ } }
  };
  const link: ChatLink = { reconnecting: () => reconnecting, subscribe: listener => { linkListeners.add(listener); return () => { linkListeners.delete(listener); }; } };

  /**
   * Wrap a watch so its stream can be lost and reopened, and (with `pauseWhenHidden`) released while the page is hidden. The
   * wrapper stays open for the controller: every reopened stream begins with a complete view, which replaces the replica, so
   * nothing is lost or duplicated. While a lost stream is being reopened (capped exponential backoff with jitter) `link` reports
   * reconnecting. The wrapper ends only when stopped, when the server ends the stream for good, or when it refuses to reopen it.
   */
  function supervise(first: Watch): ConversationWatch {
    let current: Watch | undefined, last = first.value, listener: Parameters<ConversationWatch['start']>[0] | undefined;
    let ended: WatchEnd | undefined, settle!: (end: WatchEnd) => void, opening = false, attempt = 0, retry: ReturnType<typeof setTimeout> | undefined;
    const closed = new Promise<WatchEnd>(resolve => { settle = resolve; });
    const wanted = () => listener !== undefined && !ended && !hidden();
    const cancelRetry = () => { clearTimeout(retry); retry = undefined; };
    const finish = (end: WatchEnd) => {
      if (ended) return;
      ended = end; page?.removeEventListener('visibilitychange', onVisibility); cancelRetry(); setReconnecting(false); settle(end);
      // Stopped before it started (the owner left while the first view was on its way, D-1434): the first watch is still open, close it.
      const live = current ?? (listener ? undefined : first); current = undefined; void live?.stop();
    };
    const fail = (error: unknown) => finish({ kind: 'listener_error', error: error instanceof Error ? error : new Error(String(error)) });
    const forward = async (view: ConversationView) => { last = view; await listener!({ kind: 'value', value: view, ops: [], retired: false }, context); };
    const schedule = () => {
      cancelRetry();
      const delay = Math.min(backoff.max, backoff.base * 2 ** attempt++) * (0.5 + Math.random() / 2);
      retry = setTimeout(() => { retry = undefined; void open(); }, delay);
    };
    function attach(watch: Watch) {
      current = watch;
      void watch.closed.then(end => {
        if (current !== watch) return;
        current = undefined; last = watch.value;
        if (ended) return;
        if (watch.lost()) { setReconnecting(true); schedule(); } else finish(end);
      });
      watch.start(async call => { if (current === watch && call.kind === 'value') await forward(call.value); });
    }
    async function open() {
      if (opening || current || !wanted()) return;
      opening = true;
      try {
        const reopened = await watch();
        if (!wanted() || current) { await reopened.stop(); return; }
        try { await forward(reopened.value); } catch (error) { await reopened.stop(); return fail(error); }
        if (!wanted() || current) { await reopened.stop(); return; }
        attempt = 0; setReconnecting(false); attach(reopened);
      } catch (error) {
        if (ended) return;
        // The host refused (signed out, revoked, gone): reopening cannot help. A network failure or a 5xx is retried.
        const status = error instanceof WatchRefused ? error.status : 0;
        if (status >= 400 && status < 500 && status !== 408 && status !== 429) return finish({ kind: 'ended' });
        setReconnecting(true); schedule();
      } finally { opening = false; }
    }
    async function pause() {
      cancelRetry();
      const live = current; if (!live) return;
      last = live.value; current = undefined; await live.stop();
    }
    function onVisibility() { if (hidden()) void pause(); else { cancelRetry(); void open(); } }
    page?.addEventListener('visibilitychange', onVisibility);
    return {
      get value() { return current?.value ?? last; },
      closed,
      stop: async () => { finish({ kind: 'stopped' }); return closed; },
      start: next => {
        if (listener) throw new Error('Watch already started');
        listener = next;
        if (hidden()) void first.stop(); else attach(first);
      },
    };
  }

  // The first watch tells us the conversation identity. The controller's first `watch()` takes it over instead of opening a second one.
  let unclaimed: Watch | undefined = await watch();
  const id = unclaimed.value.conversation.id;

  const requests = new Map<SubmissionRecord['id'], string>();
  const withdraw = async (submissionId: SubmissionRecord['id'], requestId = requests.get(submissionId)) =>
    (await post<{ result: 'aborted' | 'already_placed' | 'settled' }>('withdraw', { submissionId, ...(requestId === undefined ? {} : { requestId }) })).result;
  const conversation: ChatConversation = {
    id,
    watch: async () => { const first = unclaimed; unclaimed = undefined; return supervise(first ?? await watch()); },
    submit: async (draft: InputSubmissionDraft) => {
      if (draft.type !== 'input' || !draft.requestId) throw new Error('Remote chat submits input drafts with a request ID');
      const requestId = draft.requestId;
      const context = options.requestContext?.();
      const { submissionId } = await post<{ submissionId: SubmissionRecord['id'] }>('submit', { requestId, content: draft.content, whenBusy: draft.whenBusy, ...(context === undefined ? {} : { context }) });
      requests.set(submissionId, requestId);
      const status = async () => { const record = await lookup(requestId); if (!record) throw new Error('Submission is unknown to the remote host'); return record; };
      return {
        id: submissionId, status,
        wait: async context => { for (;;) { if (context.abortSignal?.aborted) throw context.abortSignal.reason; const record = await awaitWithContext(status(), context); if (record.status === 'done' || record.status === 'unanswered') return record as SettledSubmissionRecord; await awaitWithContext(new Promise(resolve => setTimeout(resolve, pollMs)), context); } },
        abort: () => withdraw(submissionId, requestId),
      };
    },
    // The controller only reconciles a submission by request ID; no other transaction work crosses the wire.
    commit: async (change, _context) => change({ submissionByRequest: (_conversationId, requestId) => lookup(requestId) }),
    abort: async () => { await post('abort', {}); },
    entries: async (query, limit, cursor: Cursor | undefined) =>
      linkImages((await call<{ page: Page<EntryRecord, Cursor> }>('entries', {}, { limit: String(limit),
        ...(query.maxEntryId === undefined ? {} : { maxEntryId: String(query.maxEntryId) }),
        ...(query.minEntryId === undefined ? {} : { minEntryId: String(query.minEntryId) }),
        ...(query.order === undefined ? {} : { order: query.order }),
        ...(cursor === undefined ? {} : { cursor: JSON.stringify(cursor) }) })).page),
  };
  const context = BACKGROUND_CONTEXT;
  const close = async () => { const first = unclaimed; unclaimed = undefined; await first?.stop(); };
  return { conversation, context, close, link, withdraw: id => withdraw(id), definitelyNotAdmitted: error => error instanceof SubmissionRefused,
    answer: (callId, answer) => post('answer', { callId, answer }), configure: change => post('configure', change) };
}
