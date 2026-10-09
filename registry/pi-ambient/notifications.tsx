'use client';

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { KeyboardEvent } from 'react';
import { CircleCheckIcon, CircleAlertIcon, MessageCircleQuestionIcon, XIcon } from 'lucide-react';
import type { NativeChatController } from '@hachej/boring-ui-kit/native-chat';
import { notifyWhenHidden } from './browser-notify';
import { parseQuestion } from '../pi-chat/question-card';
import { derive, object } from '../pi-chat/rows';
import type { Row } from '../pi-chat/rows';
import { cn, withDefaults } from '../utils/utils';

/** `done`: a run finished. `input`: the agent waits for an answer (never auto-dismissed). `error`: a run failed. */
export type NotificationKind = 'done' | 'input' | 'error';

export interface AgentNotification {
  readonly id: string;
  readonly kind: NotificationKind;
  /** The task or conversation title. */
  readonly title: string;
  /** One line: the first line of the final reply, the question, or the failure. */
  readonly summary?: string | undefined;
  /** What a click opens. Hosts use their own ids for background tasks. */
  readonly conversationId?: string | undefined;
  readonly createdAt: number;
}
export type NewNotification = Omit<AgentNotification, 'id' | 'createdAt'> & { readonly id?: string | undefined };

/**
 * A small external store of notifications. `AmbientChat` feeds it for its own conversation; a host feeds it for background
 * conversations or tasks (`push` from any event), and may share one store between `AmbientChat` and `AgentNotifications`.
 */
export interface NotificationStore {
  readonly subscribe: (listener: () => void) => () => void;
  readonly getSnapshot: () => readonly AgentNotification[];
  /** Adds a notification (or replaces the one with the same `id`) and returns its id. */
  readonly push: (notification: NewNotification) => string;
  readonly dismiss: (id: string) => void;
  /** Dismisses every notification of a conversation, optionally of one kind. */
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

/** The current notifications of a store. */
export function useNotifications(store: NotificationStore): readonly AgentNotification[] {
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}

/** One line from a Markdown reply: its first non-empty line without Markdown marks, cut with an ellipsis. */
export function summaryOf(text: string, limit = 140): string {
  const line = text.split('\n').map(item => item.trim()).find(item => item && !/^(```|---+$)/.test(item)) ?? '';
  const plain = line.replace(/^(#{1,6}\s+|>\s*|[-*+]\s+|\d+[.)]\s+)/, '').replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/[*_`~]+/g, '').replace(/\s+/g, ' ').trim();
  return plain.length > limit ? `${plain.slice(0, limit - 1).trimEnd()}…` : plain;
}

/** What the newest pending `ask_user` question or approval asks, if one waits for the person. */
export function pendingQuestion(rows: readonly Row[]): string | undefined {
  for (const row of [...rows].reverse()) if (row.type === 'assistant') for (const part of row.parts) {
    if (part.kind === 'question' && !part.live && !part.result) return parseQuestion(part.call).question;
    if (part.kind === 'approval' && !part.live && !part.result && !part.decision) return `Approve: ${part.summary}`;
  }
  return undefined;
}

/** What a toast says about a run that just ended, from the conversation's rows; `undefined` when the person stopped it. */
export function finishNotice(rows: readonly Row[]): { readonly kind: 'done' | 'error'; readonly summary: string } | undefined {
  const last = [...rows].reverse().find((row): row is Extract<Row, { type: 'assistant' }> => row.type === 'assistant');
  if (last?.stopReason === 'aborted') return undefined;
  if (last?.stopReason === 'error') return { kind: 'error', summary: last.errorMessage ?? 'The run failed' };
  return { kind: 'done', summary: summaryOf(last?.text ?? '') || 'Finished' };
}

/**
 * Feeds a store from a conversation the host keeps connected in the background (a task, a subagent, another chat): a toast when its
 * run finishes or fails and while a question waits. Returns the unsubscribe. `AmbientChat` does the same for its own conversation.
 */
export function watchConversation(controller: NativeChatController, store: NotificationStore, options: { readonly conversationId: string; readonly title: string | (() => string) }): () => void {
  const { conversationId } = options;
  const title = () => typeof options.title === 'function' ? options.title() : options.title;
  const state = () => {
    const snapshot = controller.getSnapshot();
    const live = object(snapshot.view?.docs['pi.live']);
    return { working: Boolean(object(live?.['run'])), entries: snapshot.view?.entries.length ?? 0, connected: snapshot.connection.kind === 'connected' };
  };
  let before = state(), waiting = false;
  return controller.subscribe(() => {
    const now = state();
    const was = before;
    before = now;
    if (!now.connected || (now.working === was.working && now.entries === was.entries)) return;
    const rows = derive(controller.getSnapshot().view, { mode: 'expert', renderEntry: undefined, renderTool: undefined, groupTool: undefined }).rows;
    const question = now.working ? pendingQuestion(rows) : undefined;
    if (question !== undefined && !waiting) store.push({ id: `${conversationId}:input`, kind: 'input', title: title(), summary: question, conversationId });
    if (question === undefined && waiting) store.dismiss(`${conversationId}:input`);
    waiting = question !== undefined;
    if (now.working && !was.working) store.dismiss(`${conversationId}:done`);
    if (was.working && !now.working) {
      const finished = finishNotice(rows);
      if (finished) store.push({ id: `${conversationId}:done`, kind: finished.kind, title: title(), summary: finished.summary, conversationId });
    }
  });
}

const ICONS = {
  done: { Icon: CircleCheckIcon, label: 'finished', tone: 'text-emerald-500' },
  input: { Icon: MessageCircleQuestionIcon, label: 'needsInput', tone: 'text-amber-400' },
  error: { Icon: CircleAlertIcon, label: 'failedRun', tone: 'text-destructive' },
} as const;

/** The toasts' words; `AmbientChat`'s `labels` carries them too. */
export const defaultNotificationLabels = {
  finished: 'Finished',
  needsInput: 'Needs your input',
  failedRun: 'Failed',
  notifications: 'Agent notifications',
  /** A toast's accessible name: its kind, title and summary, then what a press does. */
  openNotification: (kind: string, title: string, summary: string | undefined) => `${kind}: ${title}${summary ? `. ${summary}` : ''}. Open`,
  dismissNotification: (title: string) => `Dismiss: ${title}`,
  dismissShort: 'Dismiss',
};
export type NotificationLabels = typeof defaultNotificationLabels;

/** The status icon of a notification, also used by the ambient header. */
export function KindIcon({ kind, className }: { readonly kind: NotificationKind; readonly className?: string }) {
  const { Icon, tone } = ICONS[kind];
  return <Icon className={cn('size-5 shrink-0', tone, className)} aria-hidden="true" />;
}

function Toast({ item, autoDismissMs, onActivate, onDismiss, labels }: {
  readonly item: AgentNotification; readonly autoDismissMs: number; readonly labels: NotificationLabels;
  readonly onActivate: (item: AgentNotification) => void; readonly onDismiss: (item: AgentNotification) => void;
}) {
  const [paused, setPaused] = useState(false);
  const dismissible = item.kind !== 'input' && autoDismissMs > 0;
  useEffect(() => {
    if (!dismissible || paused) return;
    const timer = setTimeout(() => onDismiss(item), autoDismissMs);
    return () => clearTimeout(timer);
  }, [dismissible, paused, autoDismissMs, item, onDismiss]);
  const label = labels[ICONS[item.kind].label];
  return <li data-testid="agent-toast" data-kind={item.kind} data-conversation-id={item.conversationId} className="pointer-events-auto relative list-none"
    onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)} onFocus={() => setPaused(true)} onBlur={() => setPaused(false)}
    onKeyDown={(event: KeyboardEvent) => { if (event.key === 'Escape') { event.stopPropagation(); onDismiss(item); } }}>
    <button type="button" data-testid="agent-toast-open" onClick={() => onActivate(item)} aria-label={labels.openNotification(label, item.title, item.summary)}
      className="block w-full cursor-pointer rounded-[1.75rem] border border-border bg-background py-3.5 pr-6 pl-4 text-left text-foreground shadow-xl outline-none transition-colors hover:bg-popover focus-visible:ring-2 focus-visible:ring-ring/70 motion-reduce:transition-none">
      <span className="flex items-center gap-2.5"><KindIcon kind={item.kind} /><span className="min-w-0 flex-1 truncate text-[0.9375rem] font-medium">{item.title}</span></span>
      {item.summary && <span data-testid="agent-toast-summary" className="mt-1 block truncate text-sm text-muted-foreground">{item.summary}</span>}
    </button>
    <button type="button" data-testid="agent-toast-close" aria-label={labels.dismissNotification(item.title)} title={labels.dismissShort} onClick={() => onDismiss(item)}
      className="absolute -top-2 -left-2 inline-flex size-6 cursor-pointer items-center justify-center rounded-full border border-border bg-background text-foreground shadow-md outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/70 max-sm:size-8 pointer-coarse:size-8 motion-reduce:transition-none">
      <XIcon className="size-3.5" aria-hidden="true" /></button>
  </li>;
}

export interface AgentNotificationsProps {
  readonly store: NotificationStore;
  /** Toasts shown at once; older ones appear when newer ones are closed. */
  readonly max?: number;
  /** Milliseconds before a toast closes itself; 0 keeps them. "Needs input" toasts never close themselves. Hovering or focusing a toast pauses the timer. */
  readonly autoDismissMs?: number;
  /** A click on a toast. It is dismissed afterwards. */
  readonly onActivate?: (notification: AgentNotification) => void;
  /** Also show a system notification while the page is hidden, when the person has allowed it (see `AmbientChat`'s bell). */
  readonly systemNotifications?: boolean;
  readonly variant?: 'contrast' | 'surface';
  /** `fixed` docks the stack at the bottom right of the page; `inline` leaves placement to `className`. */
  readonly placement?: 'fixed' | 'inline';
  /** The toasts' words, over `defaultNotificationLabels`. */
  readonly labels?: Partial<NotificationLabels> | undefined;
  readonly className?: string;
}

/**
 * A stack of toasts for finished, failed and waiting tasks, driven by a `NotificationStore`. It is a polite live region;
 * Escape closes the focused toast. `AmbientChat` renders one above its bar; use this directly for a host-placed stack.
 */
export function AgentNotifications({ store, max = 3, autoDismissMs = 8000, onActivate, systemNotifications = false, variant = 'contrast', placement = 'fixed', labels: given, className }: AgentNotificationsProps) {
  const labels = useMemo(() => withDefaults(defaultNotificationLabels, given), [given]);
  const items = useNotifications(store);
  const seen = useRef(new Set<string>());
  const dismiss = useCallback((item: AgentNotification) => store.dismiss(item.id), [store]);
  const activate = useCallback((item: AgentNotification) => { onActivate?.(item); store.dismiss(item.id); }, [onActivate, store]);
  useEffect(() => {
    for (const item of items) {
      if (seen.current.has(`${item.id}:${item.createdAt}`)) continue;
      seen.current.add(`${item.id}:${item.createdAt}`);
      if (systemNotifications) notifyWhenHidden(item.title, item.summary ?? labels[ICONS[item.kind].label], item.id, () => { globalThis.focus?.(); activate(item); });
    }
  }, [items, systemNotifications, activate, labels]);
  const shown = items.slice(-max);
  return <div data-boring="agent-notifications" data-variant={variant} role="status" aria-live="polite" aria-relevant="additions" aria-label={labels.notifications}
    className={cn('pi-chat pi-ambient pointer-events-none z-50', placement === 'fixed' && 'fixed right-4 bottom-4 w-[min(26rem,calc(100vw-2rem))]', className)}>
    <ul className="m-0 flex list-none flex-col gap-3 p-0">
      {shown.map(item => <Toast key={`${item.id}:${item.createdAt}`} item={item} autoDismissMs={autoDismissMs} onActivate={activate} onDismiss={dismiss} labels={labels} />)}
    </ul>
  </div>;
}
