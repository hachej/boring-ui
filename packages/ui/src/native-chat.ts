import type { Context } from '@earendil-works/chord';
import { awaitWithContext, withCancel } from '@earendil-works/chord/context';
import type { Conversation, ConversationView, ConversationWatch, Cursor, EntryId, EntryRecord, Page, InputSubmissionDraft, Submission, SubmissionRecord, Tx, WatchEnd } from '@earendil-works/pi-durable';
import type { ImageContent } from '@earendil-works/pi-ai';
import type { ChatSource } from './pi.js';
import { randomUUID } from '@hachej/boring-files/platform';

export interface ChatIdentity {
  readonly runtimeId: string;
  readonly scopeId: string;
  readonly principalId: string;
}
export interface ChatAttachment {
  readonly id: string;
  readonly name: string;
  readonly content: ImageContent;
}
export interface ChatDraft {
  readonly text: string;
  readonly attachments: readonly ChatAttachment[];
  readonly version: number;
}
export interface ChatAttempt {
  readonly requestId: string;
  readonly draft: ChatDraft;
  readonly whenBusy: NonNullable<InputSubmissionDraft['whenBusy']>;
}
/**
 * Explicit content for `send` instead of the composer draft (the composer is then left alone). `restore` is what goes back into the
 * composer if the host refuses it (default: the content itself), for example the person's own text without a host-attached block.
 */
export interface ChatSendInput {
  readonly text: string;
  readonly attachments?: readonly ChatAttachment[];
  readonly restore?: { readonly text: string; readonly attachments?: readonly ChatAttachment[] };
}
export type ChatSendState = { readonly kind: 'idle' }
  | { readonly kind: 'validating'; readonly draft: ChatDraft }
  | { readonly kind: 'blocked'; readonly reason: string }
  | { readonly kind: 'submitting' | 'unknown'; readonly attempt: ChatAttempt }
  | { readonly kind: 'admitted'; readonly attempt: ChatAttempt; readonly submissionId: Submission['id']; readonly record?: SubmissionRecord };
/** `reconnecting`: the watch is still owned but its remote stream was lost and is being reopened (see `ChatLink`). */
export type ChatConnection = { readonly kind: 'idle' | 'connecting' | 'connected' | 'reconnecting' }
  | { readonly kind: 'closed'; readonly end?: WatchEnd }
  | { readonly kind: 'error'; readonly error: unknown };
/**
 * The part of a conversation the controller uses. A native `Conversation` satisfies it, and so does the remote client of
 * `@hachej/boring-ui-kit/remote-chat`, which implements exactly these members (everything else is unavailable over the wire).
 */
export interface ChatConversation {
  readonly id: Conversation['id'];
  readonly watch: Conversation['watch'];
  readonly submit: (draft: InputSubmissionDraft, context: Context) => Promise<Submission>;
  readonly abort: Conversation['abort'];
  readonly entries: Conversation['entries'];
  /** Only `tx.submissionByRequest` is used, to reconcile an unconfirmed send. */
  readonly commit: <T>(change: (tx: Pick<Tx, 'submissionByRequest'>) => T | Promise<T>, context: Context) => Promise<T>;
}
/**
 * A remote source's link to its host, for example `link` from `@hachej/boring-ui-kit/remote-chat`. While it reports reconnecting, the
 * controller's watch stays open (it receives a complete view when the stream is back) and the connection reads `reconnecting`.
 */
export interface ChatLink {
  readonly reconnecting: () => boolean;
  readonly subscribe: (listener: () => void) => () => void;
}
export interface NativeChatHistorySource {
  readonly id: Conversation['id'];
  readonly entries: Conversation['entries'];
}
export type ChatHistoryState = { readonly kind: 'disabled' | 'idle' }
  | { readonly kind: 'loading' | 'ready'; readonly entries: readonly EntryRecord[]; readonly hasMore: boolean }
  | { readonly kind: 'error'; readonly entries: readonly EntryRecord[]; readonly hasMore: boolean; readonly error: unknown };
/**
 * A message the person sent that the server has not shown yet. The chat draws it as their message at once (the echo), and drops it
 * when the server's own copy arrives in the view, so it never shows twice. `failed`: the send was not confirmed (see `send`: `unknown`).
 */
export interface EchoMessage {
  readonly key: string;
  readonly draft: ChatDraft;
  /** Wall-clock ms (`Date.now()`) when it was sent. */
  readonly sentAt: number;
  readonly state: 'sending' | 'failed';
}
/** Times in ms on `performance.now()` for one sent message, for tests and harnesses; a step not reached yet is absent. */
export interface SendTiming {
  readonly key: string;
  /** The person pressed Enter (the controller's `send` was called). */
  readonly enter: number;
  /** The message was on screen (the chat's layout effect after it committed the echo). */
  readonly shown?: number;
  /** The first words of the reply reached the view. */
  readonly firstWords?: number;
  /** The reply was complete (the run ended). */
  readonly done?: number;
}
export interface ChatTiming {
  /** The connection first became usable (the composer can send). */
  readonly inputReady?: number;
  readonly sends: readonly SendTiming[];
}
export interface NativeChatSnapshot {
  readonly identity: ChatIdentity;
  readonly conversationId: Conversation['id'];
  readonly connection: ChatConnection;
  readonly view?: ConversationView;
  readonly draft: ChatDraft;
  /** Messages already taken from the composer that wait, in order, for the current send to be confirmed before they are submitted. */
  readonly outbox: readonly ChatDraft[];
  /** Sent messages not yet in the server's view, oldest first: drawn at once as the person's messages. */
  readonly echo: readonly EchoMessage[];
  /** The steps of each send, for tests and harnesses. Also written as `performance.mark('boring-chat:<step>')`. */
  readonly timing: ChatTiming;
  readonly history: ChatHistoryState;
  readonly send: ChatSendState;
  readonly stop: 'idle' | 'requested' | 'confirmed' | 'unconfirmed';
  readonly disposed: boolean;
}
/** Structural presentation seam. Native controllers retain their concrete IDs, methods and recovery return values. */
export type ChatSnapshot = Omit<NativeChatSnapshot, 'conversationId' | 'send' | 'echo' | 'timing'> & {
  /** Absent from a controller that does not echo sent messages. */
  readonly echo?: NativeChatSnapshot['echo'];
  readonly timing?: NativeChatSnapshot['timing'];
  readonly conversationId: NativeChatSnapshot['conversationId'] | string;
  readonly send: ChatSendState | { readonly kind: 'idle' | 'submitting' | 'admitted' }
    | { readonly kind: 'unknown'; readonly reason: string; readonly retryable: boolean };
};
export type ChatController = Partial<Pick<NativeChatController, 'markShown'>> & Pick<NativeChatController, 'subscribe' | 'setText' | 'setAttachments' | 'clearHistory' | 'loadEarlier' | 'connect' | 'stop' | 'dispose'> & {
  readonly getSnapshot: () => ChatSnapshot;
  readonly send: (whenBusy?: ChatAttempt['whenBusy'], input?: ChatSendInput) => Promise<unknown>;
  readonly reconcile: () => Promise<unknown>;
  readonly retrySameRequest: () => Promise<unknown>;
};

export interface NativeChatOptions {
  readonly identity: ChatIdentity;
  readonly conversation: ChatConversation;
  readonly context: Context;
  readonly source?: ChatSource;
  readonly link?: ChatLink;
  readonly history?: NativeChatHistorySource | false;
  /** Validate the exact selected draft before any native admission. */
  readonly beforeSubmit?: (draft: ChatDraft) => Promise<string | undefined>;
  /** Restore a question after a native model/run error with no answer text. Opt-in, local to this controller; never replays work. */
  readonly restoreOnError?: boolean;
  /** Only a qualified host boundary can prove a thrown submission was not admitted. */
  readonly definitelyNotAdmitted?: (error: unknown) => boolean;
  readonly onListenerError?: (error: unknown) => void;
}

function draft(text: string, attachments: readonly ChatAttachment[], version: number): ChatDraft {
  if (typeof text !== 'string' || attachments.some(item => typeof item.id !== 'string' || !item.id || typeof item.name !== 'string'
    || item.content.type !== 'image' || typeof item.content.data !== 'string' || typeof item.content.mimeType !== 'string')) throw new TypeError('Invalid chat draft');
  if (new Set(attachments.map(item => item.id)).size !== attachments.length) throw new TypeError('Attachment identifiers must be unique');
  return Object.freeze({ text, attachments: Object.freeze(attachments.map(item => Object.freeze({ ...item, content: Object.freeze({ ...item.content }) }))), version });
}

/** Local presentation/draft state over a borrowed native conversation and one owned native watch. */
export function createNativeChatController(options: NativeChatOptions) {
  const { conversation, context } = options;
  const historySource = options.history === false ? undefined : options.history ?? (options.source ? undefined : conversation);
  if (historySource && historySource.id !== conversation.id) throw new TypeError('History belongs to another conversation');
  const readHistory = historySource?.entries.bind(historySource);
  const emptyHistory = (): ChatHistoryState => Object.freeze({ kind: readHistory ? 'idle' : 'disabled' });
  const identity = Object.freeze({ runtimeId: options.identity.runtimeId, scopeId: options.identity.scopeId, principalId: options.identity.principalId });
  if (Object.values(identity).some(value => typeof value !== 'string' || !value)) throw new TypeError('Explicit runtime, scope and principal identity are required');
  let snapshot: NativeChatSnapshot = { identity, conversationId: conversation.id, connection: { kind: 'idle' },
    draft: draft('', [], 0), outbox: Object.freeze([]), echo: Object.freeze([]), timing: Object.freeze({ sends: Object.freeze([]) }), history: emptyHistory(), send: { kind: 'idle' }, stop: 'idle', disposed: false };
  const listeners = new Set<() => void>();
  let watch: ConversationWatch | undefined, opening: Promise<void> | undefined, disposing: Promise<WatchEnd | undefined> | undefined;
  const publish = (change: Partial<NativeChatSnapshot>) => {
    if (snapshot.disposed) return;
    snapshot = Object.freeze({ ...snapshot, ...change, ...(change.send ? { send: Object.freeze(change.send) } : {}),
      ...(change.connection ? { connection: Object.freeze(change.connection) } : {}),
      ...(change.history ? { history: Object.freeze(change.history) } : {}), ...(change.outbox ? { outbox: Object.freeze(change.outbox) } : {}) });
    for (const listener of [...listeners]) {
      try { listener(); }
      catch (error) { queueMicrotask(() => { if (options.onListenerError) options.onListenerError(error); else throw error; }); }
    }
  };
  snapshot = Object.freeze({ ...snapshot, send: Object.freeze(snapshot.send), connection: Object.freeze(snapshot.connection) });
  const live = (): ChatConnection => ({ kind: options.link?.reconnecting() ? 'reconnecting' : 'connected' });
  const open = () => snapshot.connection.kind === 'connected' || snapshot.connection.kind === 'reconnecting';
  const unlink = options.link?.subscribe(() => {
    if (snapshot.disposed || !watch || !open()) return;
    const next = live();
    if (next.kind !== snapshot.connection.kind) publish({ connection: next });
  });
  let stopping: Promise<void> | undefined, retrying: Promise<Submission | undefined> | undefined;
  let historyGeneration = 0, historyPending: Promise<void> | undefined;
  let historyScan: { readonly maxEntryId: EntryId; readonly cursor?: Cursor; readonly lastId?: EntryId } | undefined;
  const invalidateHistory = (): ChatHistoryState => {
    historyGeneration++; historyPending = undefined; historyScan = undefined;
    return emptyHistory();
  };
  interface Restoring { readonly submissionId: Submission['id']; readonly cancel: () => void; textObserved: boolean; runTaskId?: number }
  const restoring = new Map<string, Restoring>();
  const hasText = (messages: readonly { readonly role: string; readonly content: unknown }[] | undefined): boolean => messages?.some(message => message.role === 'assistant' && Array.isArray(message.content) && message.content.some(part => part?.type === 'text' && typeof part.text === 'string' && part.text.length > 0)) ?? false;
  const observeText = (view: ConversationView): void => {
    const live = view.docs['pi.live'], run = live?.['run'];
    if (!run || typeof run !== 'object' || Array.isArray(run)) return;
    const inputs = run['inputs'], taskId = run['taskId'], generation = live?.['generation'];
    const message = generation && typeof generation === 'object' && !Array.isArray(generation) ? generation['message'] : undefined;
    const streamed = message && typeof message === 'object' && !Array.isArray(message) && hasText([{ role: 'assistant', content: message['content'] }]);
    if (!Array.isArray(inputs)) return;
    for (const item of restoring.values()) if (inputs.includes(item.submissionId)) {
      if (typeof taskId === 'number') item.runTaskId = taskId;
      if (streamed || view.entries.some(entry => entry.byTaskId === taskId && hasText(entry.model))) item.textObserved = true;
    }
  };
  // The echo: what the person sent, drawn at once and dropped when the server's own copy is in the view.
  interface Echo { readonly key: string; readonly draft: ChatDraft; readonly match: string; readonly base: number; readonly at: number; readonly sentAt: number; failed: boolean; admitted: boolean }
  let echoSeq = 0;
  const echoes: Echo[] = [];
  /** A sent message still not in the view after this long is dropped from the echo (the server may have changed its words); the transcript is the truth. */
  const ECHO_LIFETIME_MS = 120_000;
  const now = (): number => (globalThis.performance?.now?.() ?? Date.now());
  const textOfContent = (content: unknown): string => typeof content === 'string' ? content
    : Array.isArray(content) ? content.flatMap(part => part && typeof part === 'object' && (part as { type?: unknown }).type === 'text' && typeof (part as { text?: unknown }).text === 'string' ? [(part as { text: string }).text] : []).join('\n') : '';
  /** The texts of the people's messages the view holds: placed ones and those waiting in the inbox. */
  const userTexts = (view: ConversationView | undefined): string[] => {
    if (!view) return [];
    const texts = view.entries.flatMap(entry => (entry.model ?? []).flatMap(message => message.role === 'user' ? [textOfContent(message.content)] : []));
    const items = view.docs['pi.inbox'] && typeof view.docs['pi.inbox'] === 'object' && !Array.isArray(view.docs['pi.inbox']) ? view.docs['pi.inbox']['items'] : undefined;
    if (Array.isArray(items)) for (const item of items) if (item && typeof item === 'object' && !Array.isArray(item)) texts.push(textOfContent(item['content']));
    return texts;
  };
  const countOf = (view: ConversationView | undefined, match: string): number => userTexts(view).filter(text => match === '' || text.includes(match)).length;
  const echoView = (): readonly EchoMessage[] => Object.freeze(echoes.map(item => Object.freeze({ key: item.key, draft: item.draft, sentAt: item.sentAt, state: item.failed ? 'failed' as const : 'sending' as const })));
  /** Applies a change to the echo list and returns the snapshot field for it. */
  const publishEcho = (change: Partial<NativeChatSnapshot> = {}): void => publish({ ...change, echo: echoView() });
  const echoOf = (draft: ChatDraft): Echo | undefined => echoes.find(item => item.draft === draft);
  const dropEcho = (drafts: readonly ChatDraft[]): boolean => {
    let changed = false;
    for (const item of drafts) { const found = echoOf(item); if (found) { echoes.splice(echoes.indexOf(found), 1); changed = true; } }
    return changed;
  };
  // Timing: one record per send, kept for the last 20, readable from the snapshot and as performance marks.
  const timings: SendTiming[] = [];
  const mark = (step: string): number => {
    const at = now();
    try { globalThis.performance?.mark?.(`boring-chat:${step}`); } catch { /* marks are optional */ }
    return at;
  };
  const stamp = (key: string, step: 'shown' | 'firstWords' | 'done'): void => {
    const index = timings.findIndex(item => item.key === key);
    if (index < 0 || timings[index]![step] !== undefined) return;
    timings[index] = Object.freeze({ ...timings[index]!, [step]: mark(`${step}:${key}`) });
  };
  const publishTiming = (change: Partial<NativeChatSnapshot> = {}): void => publish({ ...change, timing: Object.freeze({ ...(snapshot.timing.inputReady !== undefined ? { inputReady: snapshot.timing.inputReady } : {}), sends: Object.freeze([...timings]) }) });
  /** Reads the view for the steps of the sends: the first words of a reply and its end. */
  const observeTiming = (view: ConversationView): void => {
    const open = timings.filter(item => item.done === undefined && item.enter !== undefined);
    if (!open.length) return;
    const live = view.docs['pi.live'], run = live && typeof live === 'object' && !Array.isArray(live) ? live['run'] : undefined;
    const running = Boolean(run) && typeof run === 'object';
    const generation = live && typeof live === 'object' && !Array.isArray(live) ? live['generation'] : undefined;
    const message = generation && typeof generation === 'object' && !Array.isArray(generation) ? generation['message'] : undefined;
    const streamed = message && typeof message === 'object' && !Array.isArray(message) && hasText([{ role: 'assistant', content: (message as { content?: unknown })['content'] }]);
    const key = open[0]!.key;
    const placed = view.entries.slice(firstEntries.get(key) ?? view.entries.length).some(entry => hasText(entry.model));
    if (streamed || placed) stamp(key, 'firstWords');
    if (!running && timings.find(item => item.key === key)?.firstWords !== undefined) stamp(key, 'done');
  };
  /** How many entries the view held when a message was sent: text after them is the reply. */
  const firstEntries = new Map<string, number>();
  /** Drops the echoes whose message the view now holds (or that waited too long). */
  const settleEchoes = (view: ConversationView): boolean => {
    if (!echoes.length) return false;
    const seen = new Map<string, number>();
    const remaining = echoes.filter(item => {
      if (now() - item.at > ECHO_LIFETIME_MS && item.admitted) return false;
      const count = seen.get(item.match) ?? countOf(view, item.match);
      seen.set(item.match, count);
      return count < item.base + 1;
    });
    if (remaining.length === echoes.length) return false;
    echoes.splice(0, echoes.length, ...remaining);
    return true;
  };
  const acceptView = (view: ConversationView): void => {
    observeText(view);
    const previous = snapshot.view?.entries;
    const appendOnly = !previous || previous.every((entry, index) => view.entries[index]?.id === entry.id);
    const changed = settleEchoes(view);
    observeTiming(view);
    publish({ view, ...(!appendOnly ? { history: invalidateHistory() } : {}), ...(changed ? { echo: echoView() } : {}), timing: Object.freeze({ ...(snapshot.timing.inputReady !== undefined ? { inputReady: snapshot.timing.inputReady } : {}), sends: Object.freeze([...timings]) }) });
  };
  const stillPending = (attempt: ChatAttempt): boolean => (snapshot.send.kind === 'unknown' || snapshot.send.kind === 'submitting') && snapshot.send.attempt.requestId === attempt.requestId;
  const active = () => { if (snapshot.disposed) throw new Error('Chat controller is disposed'); };
  const editable = () => { active(); return snapshot.draft; };
  // The composer is emptied when a message is sent, so a confirmation never has to clear it (text typed meanwhile is a new draft).
  const markAdmitted = (attempt: ChatAttempt, submissionId: Submission['id'], record?: SubmissionRecord) => {
    if (snapshot.disposed || !stillPending(attempt)) return false;
    const found = echoOf(attempt.draft);
    if (found) { found.failed = false; found.admitted = true; }
    publish({ send: { kind: 'admitted', attempt, submissionId, ...(record ? { record } : {}) }, ...(found ? { echo: echoView() } : {}) });
    return true;
  };
  interface Outgoing { readonly draft: ChatDraft; readonly whenBusy: ChatAttempt['whenBusy']; readonly resolve: (submission: Submission | undefined) => void }
  /** Messages taken from the composer that wait for the current send (`outbox` in the snapshot). */
  const waiting: Outgoing[] = [];
  let sending = false;
  /** What goes back into the composer when a sent message is refused (default: the message itself). */
  const restoreOf = new WeakMap<ChatDraft, ChatDraft>();
  /**
   * Puts refused messages back into the composer, followed by every message still waiting behind them (never submitted now) and then
   * whatever was typed since, one per line.
   */
  const restore = (drafts: readonly ChatDraft[], change: Partial<NativeChatSnapshot> = {}): void => {
    const left = waiting.splice(0);
    for (const item of left) item.resolve(undefined);
    if (snapshot.disposed) return;
    const gone = dropEcho([...drafts, ...left.map(item => item.draft)]);
    putBack([...drafts, ...left.map(item => item.draft)], { ...change, ...(gone ? { echo: echoView() } : {}), ...(left.length || snapshot.outbox.length ? { outbox: Object.freeze([]) } : {}) });
  };
  function putBack(selected: readonly ChatDraft[], change: Partial<NativeChatSnapshot> = {}): void {
    if (snapshot.disposed) return;
    const current = snapshot.draft, back = selected.map(item => restoreOf.get(item) ?? item);
    const text = [...back.map(item => item.text), current.text].filter(value => value.trim()).join('\n');
    const attachments = [...back.flatMap(item => item.attachments), ...current.attachments].filter((item, index, all) => all.findIndex(other => other.id === item.id) === index);
    publish({ ...change, ...(back.length ? { draft: draft(text, attachments, current.version + 1) } : {}) });
  }
  function definitelyNotAdmitted(error: unknown): boolean {
    try { return options.definitelyNotAdmitted?.(error) === true; }
    catch { return false; }
  }
  function monitor(attempt: ChatAttempt, submission: Pick<Submission, 'id' | 'wait'>): void {
    if (!options.restoreOnError || snapshot.disposed || restoring.has(attempt.requestId)) return;
    const waiter = withCancel(context);
    const item: Restoring = { submissionId: submission.id, cancel: waiter.cancel, textObserved: false };
    restoring.set(attempt.requestId, item);
    if (snapshot.view) observeText(snapshot.view);
    void (async () => {
      try {
        const record = await awaitWithContext(submission.wait(waiter.context), waiter.context);
        if (snapshot.disposed || record.id !== item.submissionId || record.conversationId !== conversation.id || record.requestId !== attempt.requestId || record.type !== 'input'
          || record.status !== 'unanswered' || !['model_error', 'no_model', 'faulted'].includes(record.reason) || record.entry === undefined || item.textObserved) return;
        // The native transcript, not watch timing or connection loss, decides whether the failed input received any text.
        const minEntryId = record.entry, detail = record.detail;
        const newest = await awaitWithContext(conversation.entries({}, 1, undefined, waiter.context), waiter.context);
        const maxEntryId = newest.items[0]?.id;
        if (maxEntryId === undefined || maxEntryId < minEntryId) return;
        let cursor: Cursor | undefined, ended = false;
        do {
          const page: Awaited<ReturnType<ChatConversation['entries']>> = await awaitWithContext(conversation.entries({ minEntryId, maxEntryId, order: 'ascending' }, 40, cursor, waiter.context), waiter.context);
          if (snapshot.disposed || item.textObserved) return;
          for (const entry of page.items) {
            if (hasText(entry.model)) return;
            // One run may consume several inputs and retain interrupted attempts. Neither is the final error boundary.
            if (entry.model?.some(message => message.role === 'assistant' && message.stopReason === 'error'
              && (item.runTaskId !== undefined ? entry.byTaskId === item.runTaskId : typeof detail === 'string' && message.errorMessage === detail))) { ended = true; break; }
          }
          cursor = page.next;
        } while (!ended && cursor !== undefined);
        if (!snapshot.disposed && !item.textObserved) putBack([attempt.draft]);
      } catch { /* Missing settlement/history is unknown, never proof of an empty failed answer. */ }
      finally { restoring.delete(attempt.requestId); waiter.cancel(); }
    })();
  }
  async function submitAttempt(attempt: ChatAttempt): Promise<Submission | undefined> {
    const retried = echoOf(attempt.draft);
    if (retried) retried.failed = false;
    publish({ send: { kind: 'submitting', attempt }, ...(retried ? { echo: echoView() } : {}), ...(!stopping && snapshot.stop !== 'idle' ? { stop: 'idle' as const } : {}) });
    if (snapshot.disposed) return;
    try {
      const content: InputSubmissionDraft['content'] = attempt.draft.attachments.length
        ? [{ type: 'text', text: attempt.draft.text }, ...attempt.draft.attachments.map(item => ({ ...item.content }))]
        : attempt.draft.text;
      const submission = await conversation.submit({ type: 'input', requestId: attempt.requestId, content, whenBusy: attempt.whenBusy }, context);
      if (markAdmitted(attempt, submission.id)) monitor(attempt, submission);
      return submission;
    } catch (error) {
      const denied = definitelyNotAdmitted(error);
      if (!stillPending(attempt)) return;
      // Refused: the message goes back into the composer. Unknown: it stays held by the attempt for `reconcile`/`retrySameRequest`.
      if (denied) restore([attempt.draft], { send: { kind: 'blocked', reason: error instanceof Error ? error.message : 'Submission was not admitted' } });
      else {
        const found = echoOf(attempt.draft);
        if (found) found.failed = true;
        publish({ send: { kind: 'unknown', attempt }, ...(found ? { echo: echoView() } : {}) });
      }
      return undefined;
    }
  }
  /** Validates and submits one message; a validation refusal puts it back into the composer. */
  async function dispatch(item: Outgoing): Promise<Submission | undefined> {
    const selected = item.draft;
    publish({ send: { kind: 'validating', draft: selected }, ...(!stopping && snapshot.stop !== 'idle' ? { stop: 'idle' as const } : {}) });
    if (snapshot.disposed) return;
    try {
      const reason = await options.beforeSubmit?.(selected);
      if (snapshot.disposed) return;
      if (reason !== undefined) {
        restore([selected], { send: { kind: 'blocked', reason: typeof reason === 'string' && reason ? reason : 'Submission validation did not return success' } }); return;
      }
    } catch (error) {
      if (!snapshot.disposed) restore([selected], { send: { kind: 'blocked', reason: error instanceof Error ? error.message : 'Submission validation failed' } });
      return;
    }
    if (snapshot.disposed) return;
    return submitAttempt(Object.freeze({ requestId: randomUUID(), draft: selected, whenBusy: item.whenBusy }));
  }
  const controller = {
    conversation,
    getSnapshot: (): NativeChatSnapshot => snapshot,
    /** The chat reports which echoed messages are now on screen (called after the commit that drew them); it stamps `timing`. */
    markShown: (keys: readonly string[]): void => {
      if (snapshot.disposed) return;
      const before = timings.map(item => item.shown);
      for (const key of keys) stamp(key, 'shown');
      if (timings.some((item, index) => item.shown !== before[index])) publishTiming();
    },
    /** Reads the exact native submission with this controller's Context; observing never aborts or owns its execution. */
    submissionStatus: async (submission: Submission): Promise<SubmissionRecord> => {
      active();
      const record = await submission.status(context);
      active();
      if (record.id !== submission.id || record.conversationId !== conversation.id) throw new Error('Submission belongs to a different conversation');
      return record;
    },
    subscribe: (listener: () => void): (() => void) => { if (snapshot.disposed) return () => {}; listeners.add(listener); return () => { listeners.delete(listener); }; },
    setText: (text: string): void => { const current = editable(); publish({ draft: draft(text, current.attachments, current.version + 1) }); },
    setAttachments: (attachments: readonly ChatAttachment[]): void => { const current = editable(); publish({ draft: draft(current.text, attachments, current.version + 1) }); },
    clearHistory: (): void => { active(); publish({ history: invalidateHistory() }); },
    loadEarlier: (): Promise<void> => {
      active();
      if (!readHistory) throw new Error('Conversation history is not enabled');
      if (!open()) throw new Error('Connect before loading conversation history');
      if (historyPending) return historyPending;
      const previous = snapshot.history;
      if (previous.kind === 'ready' && !previous.hasMore) return Promise.resolve();
      if (!historyScan) {
        let maxEntryId: EntryId | undefined;
        for (const entry of snapshot.view?.entries ?? []) if (maxEntryId === undefined || entry.id > maxEntryId) maxEntryId = entry.id;
        if (maxEntryId === undefined) { publish({ history: { kind: 'ready', entries: Object.freeze([]), hasMore: false } }); return Promise.resolve(); }
        historyScan = { maxEntryId };
      }
      const scan = historyScan, generation = historyGeneration;
      const entries = 'entries' in previous ? previous.entries : Object.freeze([]);
      const current = () => !snapshot.disposed && historyGeneration === generation && open();
      const pending = Promise.resolve().then(async () => {
        try {
          if (!current()) return;
          if (historySource?.id !== conversation.id) throw new Error('History conversation identity changed');
          // Bound only this read, never the borrowed conversation or its running task. A late page cannot publish after timeout.
          const reading = withCancel(context);
          const timer = setTimeout(() => reading.cancel(new Error('Conversation history read timed out')), 15_000);
          let page: Page<EntryRecord, Cursor>;
          try { page = await awaitWithContext(readHistory({ maxEntryId: scan.maxEntryId }, 40, scan.cursor === undefined ? undefined : structuredClone(scan.cursor), reading.context), reading.context); }
          finally { clearTimeout(timer); reading.cancel(); }
          if (!current()) return;
          if (historySource?.id !== conversation.id) throw new Error('History conversation identity changed');
          if (page.items.length > 40 || !page.items.length && page.next !== undefined) throw new Error('History page did not respect its bounds');
          let previousId = scan.lastId;
          for (const entry of page.items) {
            if (entry.id > scan.maxEntryId || previousId !== undefined && entry.id >= previousId) throw new Error('History page did not progress in native entry order');
            previousId = entry.id;
          }
          const cursor = page.next === undefined ? undefined : structuredClone(page.next);
          historyScan = { maxEntryId: scan.maxEntryId, ...(cursor === undefined ? {} : { cursor }), ...(previousId === undefined ? {} : { lastId: previousId }) };
          publish({ history: { kind: 'ready', entries: Object.freeze([...page.items].reverse().concat(entries)), hasMore: cursor !== undefined } });
        } catch (error) {
          if (current()) publish({ history: { kind: 'error', entries, hasMore: true, error } });
        } finally { if (historyGeneration === generation) historyPending = undefined; }
      });
      historyPending = pending;
      publish({ history: { kind: 'loading', entries, hasMore: true } });
      return pending;
    },
    connect: (): Promise<void> => {
      active();
      if (opening) return opening;
      if (watch) return Promise.resolve();
      opening = Promise.resolve().then(async () => {
        try {
          const acquired = await (options.source ? options.source.open() : conversation.watch(context));
          if (snapshot.disposed) { await acquired.stop(); return; }
          if (acquired.value.conversation.id !== conversation.id) { await acquired.stop(); throw new Error('Chat source returned another conversation'); }
          watch = acquired;
          const ready = snapshot.timing.inputReady === undefined;
          publish({ connection: live(), view: acquired.value, ...(ready ? { timing: Object.freeze({ inputReady: mark('input-ready'), sends: Object.freeze([...timings]) }) } : {}) });
          acquired.start(async view => {
            if (snapshot.disposed || watch !== acquired) return;
            if (view.conversation.id !== conversation.id) throw new Error('Chat source changed conversation identity');
            acceptView(view);
          });
          void acquired.closed.then(end => {
            if (watch !== acquired) return;
            watch = undefined;
            publish({ connection: { kind: 'closed', end }, history: invalidateHistory() });
          });
        } catch (error) { if (!snapshot.disposed) publish({ connection: { kind: 'error', error } }); }
        finally { opening = undefined; }
      });
      publish({ connection: { kind: 'connecting' }, history: invalidateHistory() });
      return opening;
    },
    /**
     * Sends the composer draft (or `input`) and empties the composer at once. While another send is still being confirmed the message
     * waits in `outbox` and is submitted, in order, after it. A refused message, and any waiting behind it, go back into the composer
     * ahead of what was typed since; nothing is dropped or merged into another message. Resolves with the native submission, or
     * undefined when the message was not admitted (refused, unknown, or the controller was disposed).
     */
    send: async (whenBusy: ChatAttempt['whenBusy'] = 'followUp', input?: ChatSendInput): Promise<Submission | undefined> => {
      active();
      if (snapshot.send.kind === 'unknown') throw new Error('Reconcile the existing submission before sending another');
      const current = snapshot.draft;
      const selected = input ? draft(input.text, input.attachments ?? [], 0) : current;
      if (!selected.text.trim() && !selected.attachments.length) {
        if (!sending) publish({ send: { kind: 'blocked', reason: 'Enter a message or attach an image' } });
        return;
      }
      if (input?.restore) restoreOf.set(selected, draft(input.restore.text, input.restore.attachments ?? [], 0));
      // The message is the person's from this moment: it is drawn at once (the echo) and the composer is emptied, before any
      // validation or network call. The server's copy replaces it when it arrives; a refusal puts the words back in the composer.
      // (A steer takes a queued message back and sends it again, so it is not echoed twice.)
      if (whenBusy !== 'steer') {
        const enter = mark('enter');
        const match = selected.text.trim(), key = `m${++echoSeq}`;
        echoes.push({ key, draft: selected, match, base: countOf(snapshot.view, match) + echoes.filter(item => item.match === match).length, at: enter, sentAt: Date.now(), failed: false, admitted: false });
        firstEntries.set(key, snapshot.view?.entries.length ?? 0);
        timings.push(Object.freeze({ key, enter })); if (timings.length > 20) firstEntries.delete(timings.shift()!.key);
      }
      const cleared = { ...(input ? {} : { draft: draft('', [], current.version + 1) }), echo: echoView(), timing: Object.freeze({ ...(snapshot.timing.inputReady !== undefined ? { inputReady: snapshot.timing.inputReady } : {}), sends: Object.freeze([...timings]) }) };
      if (sending) {
        return new Promise(resolve => {
          waiting.push({ draft: selected, whenBusy, resolve });
          publish({ ...cleared, outbox: Object.freeze(waiting.map(item => item.draft)) });
        });
      }
      sending = true;
      publish(cleared);
      try {
        let next: Outgoing | undefined = { draft: selected, whenBusy, resolve: () => {} };
        const first = await dispatch(next);
        let result = first;
        while (result && (next = waiting.shift())) {
          publish({ outbox: Object.freeze(waiting.map(item => item.draft)) });
          result = await dispatch(next);
          next.resolve(result);
        }
        return first;
      } finally {
        sending = false;
        // Whatever still waits (behind an unknown submission, or after disposal) was never submitted: it goes back into the composer.
        if (waiting.length) restore([]);
      }
    },
    reconcile: async (): Promise<SubmissionRecord | undefined> => {
      active();
      if (snapshot.send.kind !== 'unknown') throw new Error('No unconfirmed submission to reconcile');
      const { attempt } = snapshot.send;
      const record = await conversation.commit(tx => tx.submissionByRequest(conversation.id, attempt.requestId), context);
      if (record) {
        if (record.conversationId !== conversation.id || record.requestId !== attempt.requestId || record.type !== 'input') throw new Error('Native submission lookup returned a different binding');
        const admitted = markAdmitted(attempt, record.id, record);
        if (admitted && options.restoreOnError) {
          // Reconciliation observes the original request only; no duplicate submission is made to obtain a handle.
          monitor(attempt, { id: record.id, wait: async waiter => {
            for (;;) {
              if (waiter.abortSignal?.aborted) throw waiter.abortSignal.reason;
              const current = await awaitWithContext(conversation.commit(tx => tx.submissionByRequest(conversation.id, attempt.requestId), waiter), waiter);
              if (!current || current.id !== record.id) throw new Error('Submission binding is unavailable');
              if (current.status === 'done' || current.status === 'unanswered') return current;
              await awaitWithContext(new Promise(resolve => setTimeout(resolve, 250)), waiter);
            }
          } });
        }
      }
      return record;
    },
    retrySameRequest: (): Promise<Submission | undefined> => {
      active();
      if (retrying) return retrying;
      if (snapshot.send.kind !== 'unknown') throw new Error('No unconfirmed submission to retry');
      const { attempt } = snapshot.send;
      retrying = Promise.resolve().then(async () => {
        try {
          const reason = await options.beforeSubmit?.(attempt.draft);
          if (reason !== undefined) throw new Error(typeof reason === 'string' && reason ? reason : 'Submission validation did not return success');
          if (snapshot.disposed || !stillPending(attempt)) return;
          return await submitAttempt(attempt);
        } finally { retrying = undefined; }
      });
      return retrying;
    },
    stop: (): Promise<void> => {
      active();
      if (stopping) return stopping;
      stopping = Promise.resolve().then(async () => {
        try { await conversation.abort(context); publish({ stop: 'confirmed' }); }
        catch (error) { publish({ stop: 'unconfirmed' }); throw error; }
        finally { stopping = undefined; }
      });
      publish({ stop: 'requested' });
      return stopping;
    },
    dispose: (): Promise<WatchEnd | undefined> => {
      if (disposing) return disposing;
      disposing = Promise.resolve().then(async () => { await opening; const owned = watch; watch = undefined; return owned?.stop(); });
      unlink?.();
      for (const item of restoring.values()) item.cancel(); restoring.clear();
      publish({ disposed: true, connection: { kind: 'closed' }, history: invalidateHistory() }); listeners.clear();
      return disposing;
    },
  };
  return controller;
}
export type NativeChatController = ReturnType<typeof createNativeChatController>;
