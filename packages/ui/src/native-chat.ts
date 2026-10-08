import type { Context } from '@earendil-works/chord';
import type { Conversation, ConversationView, ConversationWatch, Cursor, EntryId, EntryRecord, InputSubmissionDraft, Submission, SubmissionRecord, Tx, WatchEnd } from '@earendil-works/pi-durable';
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
export interface NativeChatSnapshot {
  readonly identity: ChatIdentity;
  readonly conversationId: Conversation['id'];
  readonly connection: ChatConnection;
  readonly view?: ConversationView;
  readonly draft: ChatDraft;
  /** Messages already taken from the composer that wait, in order, for the current send to be confirmed before they are submitted. */
  readonly outbox: readonly ChatDraft[];
  readonly history: ChatHistoryState;
  readonly send: ChatSendState;
  readonly stop: 'idle' | 'requested' | 'confirmed' | 'unconfirmed';
  readonly disposed: boolean;
}
export interface NativeChatOptions {
  readonly identity: ChatIdentity;
  readonly conversation: ChatConversation;
  readonly context: Context;
  readonly source?: ChatSource;
  readonly link?: ChatLink;
  readonly history?: NativeChatHistorySource | false;
  /** Validate the exact selected draft before any native admission. */
  readonly beforeSubmit?: (draft: ChatDraft) => Promise<string | undefined>;
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
    draft: draft('', [], 0), outbox: Object.freeze([]), history: emptyHistory(), send: { kind: 'idle' }, stop: 'idle', disposed: false };
  const listeners = new Set<() => void>();
  let watch: ConversationWatch | undefined, opening: Promise<void> | undefined, disposing: Promise<WatchEnd | undefined> | undefined;
  const publish = (change: Partial<NativeChatSnapshot>) => {
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
  const acceptView = (view: ConversationView): void => {
    const previous = snapshot.view?.entries;
    const appendOnly = !previous || previous.every((entry, index) => view.entries[index]?.id === entry.id);
    publish({ view, ...(!appendOnly ? { history: invalidateHistory() } : {}) });
  };
  const stillPending = (attempt: ChatAttempt): boolean => (snapshot.send.kind === 'unknown' || snapshot.send.kind === 'submitting') && snapshot.send.attempt.requestId === attempt.requestId;
  const active = () => { if (snapshot.disposed) throw new Error('Chat controller is disposed'); };
  const editable = () => { active(); return snapshot.draft; };
  // The composer is emptied when a message is sent, so a confirmation never has to clear it (text typed meanwhile is a new draft).
  const markAdmitted = (attempt: ChatAttempt, submissionId: Submission['id'], record?: SubmissionRecord) => {
    if (!stillPending(attempt)) return;
    publish({ send: { kind: 'admitted', attempt, submissionId, ...(record ? { record } : {}) } });
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
    const current = snapshot.draft, back = [...drafts, ...left.map(item => item.draft)].map(item => restoreOf.get(item) ?? item);
    const text = [...back.map(item => item.text), current.text].filter(value => value.trim()).join('\n');
    const attachments = [...back.flatMap(item => item.attachments), ...current.attachments].filter((item, index, all) => all.findIndex(other => other.id === item.id) === index);
    publish({ ...change, ...(left.length || snapshot.outbox.length ? { outbox: Object.freeze([]) } : {}), ...(back.length ? { draft: draft(text, attachments, current.version + 1) } : {}) });
  };
  function definitelyNotAdmitted(error: unknown): boolean {
    try { return options.definitelyNotAdmitted?.(error) === true; }
    catch { return false; }
  }
  async function submitAttempt(attempt: ChatAttempt): Promise<Submission | undefined> {
    publish({ send: { kind: 'submitting', attempt }, ...(!stopping && snapshot.stop !== 'idle' ? { stop: 'idle' as const } : {}) });
    if (snapshot.disposed) return;
    try {
      const content: InputSubmissionDraft['content'] = attempt.draft.attachments.length
        ? [{ type: 'text', text: attempt.draft.text }, ...attempt.draft.attachments.map(item => ({ ...item.content }))]
        : attempt.draft.text;
      const submission = await conversation.submit({ type: 'input', requestId: attempt.requestId, content, whenBusy: attempt.whenBusy }, context);
      markAdmitted(attempt, submission.id);
      return submission;
    } catch (error) {
      const denied = definitelyNotAdmitted(error);
      if (!stillPending(attempt)) return;
      // Refused: the message goes back into the composer. Unknown: it stays held by the attempt for `reconcile`/`retrySameRequest`.
      if (denied) restore([attempt.draft], { send: { kind: 'blocked', reason: error instanceof Error ? error.message : 'Submission was not admitted' } });
      else publish({ send: { kind: 'unknown', attempt } });
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
          const page = await readHistory({ maxEntryId: scan.maxEntryId }, 40, scan.cursor === undefined ? undefined : structuredClone(scan.cursor), context);
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
          publish({ history: { kind: 'ready', entries: Object.freeze([...page.items].reverse()), hasMore: cursor !== undefined } });
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
          publish({ connection: live(), view: acquired.value });
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
      const cleared = input ? {} : { draft: draft('', [], current.version + 1) };
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
        markAdmitted(attempt, record.id, record);
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
      publish({ disposed: true, connection: { kind: 'closed' }, history: invalidateHistory() }); listeners.clear();
      return disposing;
    },
  };
  return controller;
}
export type NativeChatController = ReturnType<typeof createNativeChatController>;
