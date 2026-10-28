import type { ToolCall } from '@earendil-works/pi-ai';
import type { ChatController } from './native-chat.js';
import { derive, finishNotice, pendingNotice } from './chat-view.js';
import type { NoticeText, Row } from './chat-view.js';

/** Transient host presentation, never native execution state. */
export type NotificationKind = 'done' | 'input' | 'error';
export interface AgentNotification {
  readonly id: string;
  readonly kind: NotificationKind;
  readonly title: string;
  readonly summary?: string | undefined;
  readonly conversationId?: string | undefined;
  readonly createdAt: number;
}
export type NewNotification = Omit<AgentNotification, 'id' | 'createdAt'> & { readonly id?: string | undefined };
export interface NotificationStore {
  readonly subscribe: (listener: () => void) => () => void;
  readonly getSnapshot: () => readonly AgentNotification[];
  readonly push: (notification: NewNotification) => string;
  readonly dismiss: (id: string) => void;
  readonly dismissConversation: (conversationId: string, kind?: NotificationKind) => void;
  readonly clear: () => void;
}

export function createNotificationStore(): NotificationStore {
  let items: readonly AgentNotification[] = [];
  let sequence = 0;
  const listeners = new Set<() => void>();
  const set = (next: readonly AgentNotification[]) => { items = next; for (const listener of [...listeners]) listener(); };
  return {
    subscribe: listener => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    getSnapshot: () => items,
    push: notification => {
      const id = notification.id ?? `notification-${++sequence}`;
      set([...items.filter(item => item.id !== id), { ...notification, id, createdAt: Date.now() }]);
      return id;
    },
    dismiss: id => { if (items.some(item => item.id === id)) set(items.filter(item => item.id !== id)); },
    dismissConversation: (conversationId, kind) => {
      if (items.some(item => item.conversationId === conversationId && (!kind || item.kind === kind))) set(items.filter(item => item.conversationId !== conversationId || (kind && item.kind !== kind)));
    },
    clear: () => { if (items.length) set([]); },
  };
}

type Outcome = 'done' | 'error' | null;
interface NoticeState { readonly working: boolean; readonly question: string | undefined }
interface NoticeTransition {
  readonly state: NoticeState;
  readonly inputChanged: boolean;
  readonly started: boolean;
  readonly finished: ReturnType<typeof finishNotice>;
}

/** Both watchers consume connected observations only; a transport gap cannot establish a finish or consume a transition. */
function transition(before: NoticeState | undefined, now: NoticeState, rows: readonly Row<unknown>[], text: NoticeText | undefined): NoticeTransition {
  return { state: now, inputChanged: now.question !== before?.question,
    started: Boolean(before && now.working && !before.working),
    finished: before?.working && !now.working ? finishNotice(rows, text) : undefined };
}

export interface RunNotificationOptions {
  readonly conversationId: string;
  readonly title: string | (() => string);
  /** The source recipe owns the ask_user form grammar. */
  readonly question: (call: ToolCall) => string;
  readonly text?: NoticeText | undefined;
  readonly enabled?: boolean | undefined;
  /** Suppresses pushes, not observation or dismissals (for an already visible conversation). */
  readonly suppress?: (() => boolean) | undefined;
  readonly onOutcome?: ((outcome: Outcome) => void) | undefined;
}
export type RunNotificationSource = Pick<ChatController, 'getSnapshot' | 'subscribe'>;

/** Borrows an existing controller; unsubscribe detaches only this viewer, never stops or disposes a task. */
export function watchConversation(controller: RunNotificationSource, store: NotificationStore, options: RunNotificationOptions | (() => RunNotificationOptions)): () => void {
  let before: NoticeState | undefined;
  const observe = () => {
    const snapshot = controller.getSnapshot();
    if (snapshot.connection.kind !== 'connected') return;
    const config = typeof options === 'function' ? options() : options;
    const derived = derive(snapshot.view, { mode: 'expert', renderEntry: undefined, renderTool: undefined, groupTool: undefined });
    const next = transition(before, { working: Boolean(derived.run), question: pendingNotice(derived.rows, config.question, config.text) }, derived.rows, config.text);
    before = next.state; // Fence reentrant host callbacks before delivering effects.
    const { conversationId } = config;
    const push = (kind: NotificationKind, summary: string) => {
      if (config.enabled === false || config.suppress?.()) return;
      store.push({ id: `${conversationId}:${kind === 'input' ? 'input' : 'done'}`, kind, title: typeof config.title === 'function' ? config.title() : config.title, summary, conversationId });
    };
    if (next.started) { store.dismiss(`${conversationId}:done`); config.onOutcome?.(null); }
    if (next.inputChanged) {
      if (next.state.question === undefined) store.dismiss(`${conversationId}:input`);
      else push('input', next.state.question);
    }
    if (next.finished) { config.onOutcome?.(next.finished.kind); push(next.finished.kind, next.finished.summary); }
  };
  const unsubscribe = controller.subscribe(observe);
  observe();
  return unsubscribe;
}
