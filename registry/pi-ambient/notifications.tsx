'use client';

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { KeyboardEvent } from 'react';
import { CircleCheckIcon, CircleAlertIcon, MessageCircleQuestionIcon, XIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { NativeChatController } from '@hachej/boring-ui-kit/native-chat';
import { notifyWhenHidden } from './browser-notify';
import { parseQuestion } from '../pi-chat-question/question-card';
import { defaultNoticeText, pendingNotice } from '@hachej/boring-ui-kit/chat-view';
import { useRunNotifications as useKitRunNotifications, watchConversation as watchKitConversation } from '@hachej/boring-ui-kit/chat-react';
import type { AgentNotification, NotificationKind, NotificationStore, RunNotificationOptions } from '@hachej/boring-ui-kit/chat-react';
import type { NoticeText } from '@hachej/boring-ui-kit/chat-view';
import type { Row } from '../pi-chat/rows';
import { cn, withDefaults } from '../utils/utils';

export { createNotificationStore } from '@hachej/boring-ui-kit/chat-react';
export type { AgentNotification, NewNotification, NotificationKind, NotificationStore } from '@hachej/boring-ui-kit/chat-react';

/** The current notifications of a store. */
export function useNotifications(store: NotificationStore): readonly AgentNotification[] {
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}

export { finishNotice, summaryOf } from '@hachej/boring-ui-kit/chat-view';

/** A surface's run-notice words (`approveNotice`, `runFailed`, `finished`) as the kit's `NoticeText`, which `pendingNotice` and `finishNotice` take. */
export const noticeTextOf = (labels: Pick<NotificationLabels, 'approveNotice' | 'runFailed' | 'finished'>): NoticeText => ({ approve: labels.approveNotice, runFailed: labels.runFailed, finished: labels.finished });

/** What the newest pending `ask_user` question or approval asks, if one waits for the person (the kit's `waitingPart` rule and notice words). */
export function pendingQuestion(rows: readonly Row[], text?: NoticeText): string | undefined {
  return pendingNotice(rows, call => parseQuestion(call).question, text);
}

/**
 * Feeds a store from a conversation the host keeps connected in the background (a task, a subagent, another chat): a toast when its
 * run finishes or fails and while a question waits. Returns the unsubscribe. `AmbientChat` does the same for its own conversation.
 */
export function watchConversation(controller: NativeChatController, store: NotificationStore, options: { readonly conversationId: string; readonly title: string | (() => string); readonly labels?: Partial<NotificationLabels> | undefined }): () => void {
  return watchKitConversation(controller, store, { ...options, text: noticeTextOf({ ...defaultNotificationLabels, ...options.labels }), question: call => parseQuestion(call).question });
}

/** Presentation supplies only the ask_user grammar; the kit owns every transition. */
export function useRunNotifications(controller: NativeChatController, store: NotificationStore, options: Omit<RunNotificationOptions, 'question'>): void {
  useKitRunNotifications(controller, store, { ...options, question: call => parseQuestion(call).question });
}

const ICONS = {
  done: { Icon: CircleCheckIcon, label: 'finished', tone: 'text-(--chat-success)' },
  input: { Icon: MessageCircleQuestionIcon, label: 'needsInput', tone: 'text-(--chat-warning)' },
  error: { Icon: CircleAlertIcon, label: 'failedRun', tone: 'text-destructive' },
} as const;

/** The toasts' words; `AmbientChat`'s `labels` carries them too. */
export const defaultNotificationLabels = {
  /** The run notices' words are the kit's (`defaultNoticeText`): one source. */
  finished: defaultNoticeText.finished,
  /** What a waiting approval asks, as a notice (`defaultNoticeText.approve`). */
  approveNotice: defaultNoticeText.approve,
  runFailed: defaultNoticeText.runFailed,
  needsInput: 'Needs your input',
  failedRun: 'Failed',
  notifications: 'Agent notifications',
  /** A toast's accessible name: its kind, title and summary, then what a press does. */
  openNotification: (kind: string, title: string, summary: string | undefined) => `${kind}: ${title}${summary ? `. ${summary}` : ''}. Open`,
  dismissNotification: (title: string) => `Dismiss: ${title}`,
  dismissShort: 'Dismiss',
};
export type NotificationLabels = typeof defaultNotificationLabels;

/** The toasts' and run notices' words in French: pass it as `labels` (`AmbientChat`, `AgentNotifications`, `watchConversation`). Typed as `NotificationLabels`, so a key added in English must be added here too. */
export const frenchNotificationLabels: NotificationLabels = {
  finished: 'Terminé',
  approveNotice: summary => `Approbation requise : ${summary}`,
  runFailed: 'L’exécution a échoué',
  needsInput: 'En attente de votre réponse',
  failedRun: 'Échec',
  notifications: 'Notifications de l’agent',
  openNotification: (kind, title, summary) => `${kind} : ${title}${summary ? `. ${summary}` : ''}. Ouvrir`,
  dismissNotification: title => `Fermer : ${title}`,
  dismissShort: 'Fermer',
};

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
  const { Icon } = ICONS[item.kind];
  const label = labels[ICONS[item.kind].label];
  return <li data-testid="agent-toast" data-kind={item.kind} data-conversation-id={item.conversationId} className="pointer-events-auto relative list-none"
    onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)} onFocus={() => setPaused(true)} onBlur={() => setPaused(false)}
    onKeyDown={(event: KeyboardEvent) => { if (event.key === 'Escape') { event.stopPropagation(); onDismiss(item); } }}>
    <Button variant="ghost" data-testid="agent-toast-open" onClick={() => onActivate(item)} aria-label={labels.openNotification(label, item.title, item.summary)}
      className="h-auto w-full flex-col items-start whitespace-normal">
      <span className="flex items-center gap-2.5"><Icon data-icon="inline-start" aria-hidden="true" /><span className="min-w-0 flex-1 truncate">{item.title}</span></span>
      {item.summary && <span data-testid="agent-toast-summary" className="mt-1 block max-w-full truncate">{item.summary}</span>}
    </Button>
    <Button variant="ghost" size="icon-sm" data-testid="agent-toast-close" aria-label={labels.dismissNotification(item.title)} title={labels.dismissShort} onClick={() => onDismiss(item)}
      className="absolute -top-2 -left-2">
      <XIcon data-icon="inline-start" aria-hidden="true" /></Button>
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
    className={cn('pi-chat pi-ambient pointer-events-none z-50', variant === 'contrast' && 'dark scheme-dark', placement === 'fixed' && 'fixed right-4 bottom-4 w-[min(26rem,calc(100vw-2rem))]', className)}>
    <ul className="m-0 flex list-none flex-col gap-3 p-0">
      {shown.map(item => <Toast key={`${item.id}:${item.createdAt}`} item={item} autoDismissMs={autoDismissMs} onActivate={activate} onDismiss={dismiss} labels={labels} />)}
    </ul>
  </div>;
}
