import type { Context } from '@earendil-works/chord';
import { applyImmutable } from '@earendil-works/chord/delta';
import type { ConversationView, ConversationWatch, Cursor, InputSubmissionDraft, Page, EntryRecord, SettledSubmissionRecord, SubmissionRecord, WatchEnd } from '@earendil-works/pi-durable';
import type { ChatConversation, ChatLink } from './native-chat.js';

/** Browser client for the `@hachej/boring-agent/chat-transport` handler. Bundles only Chord's standalone delta replay, no Pi runtime. */
export interface RemoteChatOptions {
  /** Handler URL. Existing query parameters (for example a conversation selector) are preserved. */
  readonly endpoint: string | URL;
  /** The host adds credentials here. */
  readonly fetch: (request: Request) => Promise<Response>;
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
  const send = options.fetch, pollMs = options.pollMs ?? 500;
  const backoff = { base: options.reconnect?.baseDelayMs ?? 1000, max: options.reconnect?.maxDelayMs ?? 30_000 };
  const url = (op: string, extra: Record<string, string> = {}) => {
    const target = new URL(base); target.searchParams.set('op', op);
    for (const [key, value] of Object.entries(extra)) target.searchParams.set(key, value);
    return target;
  };
  async function call<T>(op: string, init: RequestInit = {}, extra: Record<string, string> = {}): Promise<T> {
    const response = await send(new Request(url(op, extra), init));
    if (response.status === 402 && op === 'submit') {
      const refused = await response.json().catch(() => ({})) as { reason?: unknown; message?: unknown };
      if (refused.reason === 'submission-refused') throw new SubmissionRefused(typeof refused.message === 'string' && refused.message ? refused.message : 'The host refused this message');
    }
    if (!response.ok) throw new Error(`Remote chat ${op} failed: ${await reason(response)}`);
    return await response.json() as T;
  }
  const post = <T>(op: string, value: unknown) => call<T>(op, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(value) });
  const lookup = async (requestId: string) => (await call<{ record: SubmissionRecord | null }>('submission', {}, { requestId })).record ?? undefined;

  async function watch(): Promise<Watch> {
    const stopped = new AbortController();
    const response = await send(new Request(url('watch'), { signal: stopped.signal }));
    if (!response.ok || !response.body) throw new WatchRefused(`Remote chat watch failed: ${await reason(response)}`, response.status);
    const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
    let pending = '', staleMs = 0, lost = false;
    // Once the server has announced its heartbeat interval, a read waiting 2.5 intervals means the stream is dead even if the
    // socket still looks open (a proxy that dropped it silently).
    async function read() {
      if (!staleMs) return reader.read();
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        return await Promise.race([reader.read(), new Promise<never>((_, reject) => {
          timer = setTimeout(() => { lost = true; stopped.abort(); reject(new Error('Remote chat stream went silent')); }, staleMs);
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
    let value = first.view, started = false, settle!: (end: WatchEnd) => void, ended: WatchEnd | undefined;
    const closed = new Promise<WatchEnd>(resolve => { settle = resolve; });
    const finish = (end: WatchEnd) => { if (!ended) { ended = end; stopped.abort(); settle(end); } };
    const handle: Watch = {
      get value() { return value; },
      closed,
      lost: () => lost,
      stop: async () => { finish({ reason: 'stopped' }); return closed; },
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
                return finish({ reason: frame?.reason === 'retired' ? 'retired' : frame?.reason === 'stopped' ? 'stopped' : 'session_closed' });
              }
              // Native operation batches are replayed with the upstream delta implementation; a view frame resets the replica.
              value = frame.kind === 'view' ? frame.view : applyImmutable(value, frame.ops) as ConversationView;
              try { await listener(value, [], context); }
              catch (error) { return finish({ reason: 'listener_error', error: error instanceof Error ? error : new Error(String(error)) }); }
            }
          } catch (error) {
            if (ended) return;
            // A failed read (network error, silence) is a lost connection; a line the client cannot parse is not.
            if (error instanceof SyntaxError) return finish({ reason: 'listener_error', error });
            lost = true; finish({ reason: 'session_closed' });
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
      const live = current; current = undefined; void live?.stop();
    };
    const fail = (error: unknown) => finish({ reason: 'listener_error', error: error instanceof Error ? error : new Error(String(error)) });
    const forward = async (view: ConversationView) => { last = view; await listener!(view, [], context); };
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
      watch.start(async view => { if (current === watch) await forward(view); });
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
        if (status >= 400 && status < 500 && status !== 408 && status !== 429) return finish({ reason: 'session_closed' });
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
      stop: async () => { finish({ reason: 'stopped' }); return closed; },
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
      const { submissionId } = await post<{ submissionId: SubmissionRecord['id'] }>('submit', { requestId, content: draft.content, whenBusy: draft.whenBusy });
      requests.set(submissionId, requestId);
      const status = async () => { const record = await lookup(requestId); if (!record) throw new Error('Submission is unknown to the remote host'); return record; };
      return {
        id: submissionId, status,
        wait: async () => { for (;;) { const record = await status(); if (record.status === 'done' || record.status === 'unanswered') return record as SettledSubmissionRecord; await new Promise(resolve => setTimeout(resolve, pollMs)); } },
        abort: () => withdraw(submissionId, requestId),
      };
    },
    // The controller only reconciles a submission by request ID; no other transaction work crosses the wire.
    commit: async (change, _context) => change({ submissionByRequest: (_conversationId, requestId) => lookup(requestId) }),
    abort: async () => { await post('abort', {}); },
    entries: async (_query, limit, cursor: Cursor | undefined) =>
      (await call<{ page: Page<EntryRecord, Cursor> }>('entries', {}, { limit: String(limit), ...(cursor === undefined ? {} : { cursor: JSON.stringify(cursor) }) })).page,
  };
  const context = Object.freeze({}) as unknown as Context;
  const close = async () => { const first = unclaimed; unclaimed = undefined; await first?.stop(); };
  return { conversation, context, close, link, withdraw: id => withdraw(id), definitelyNotAdmitted: error => error instanceof SubmissionRefused,
    answer: (callId, answer) => post('answer', { callId, answer }), configure: change => post('configure', change) };
}
