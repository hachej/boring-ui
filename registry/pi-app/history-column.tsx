'use client';

// Conversation history as a side column at the start of an agent pane (page and docked placements, pane at least 720px wide), and a
// popover or sheet otherwise. Host concern: Pi has no layout. The column is `SessionsPane` over the consumer's sidebar parts; this file
// decides when it fits and remembers, per viewer, whether it is open. `AgentWorkspace` uses the same rule and memory for its sessions pane.
import { useCallback, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { useAppText } from './app-labels';
import { SessionsPane } from './sessions';
import type { ConversationsConfig } from '../pi-chat/pi-chat';
import { cn } from '../utils/utils';

/** `column` (default): History toggles the side column where it fits. `popover`: History always opens the popover or sheet. */
export type HistoryPlacement = 'column' | 'popover';

/** The column (SessionsPane's 260px and its separator), the pane it needs with nothing beside the chat, and the chat it must leave usable. */
export const HISTORY_COLUMN = { width: 261, minPane: 720, minChat: 360 } as const;

/** Whether the column fits a pane `width` wide; `beside` is what an open artifact takes next to the chat (0 when none is open). */
export const historyColumnFits = (width: number, beside = 0): boolean =>
  width >= (beside > 0 ? HISTORY_COLUMN.width + beside + HISTORY_COLUMN.minChat : HISTORY_COLUMN.minPane);

/** The open state of the column, remembered per viewer under `storageKey` (a convenience: storage may be unavailable). */
export function useHistoryOpen(storageKey: string, defaultOpen: boolean): readonly [boolean, (open: boolean) => void] {
  const [open, setOpenState] = useState(() => {
    try { const stored = localStorage.getItem(storageKey); return stored === null ? defaultOpen : stored === 'open'; } catch { return defaultOpen; }
  });
  const setOpen = useCallback((next: boolean) => {
    try { localStorage.setItem(storageKey, next ? 'open' : 'closed'); } catch { /* per-viewer convenience */ }
    setOpenState(next);
  }, [storageKey]);
  return [open, setOpen] as const;
}

/** Opening moves focus to the open conversation's row; closing leaves it on the toggle that was pressed. */
export const focusHistoryRow = (id: string) => requestAnimationFrame(() => {
  document.getElementById(id)?.querySelector<HTMLElement>('[data-testid=conversation-row][aria-current=true], [data-testid=conversation-row]')?.focus({ preventScroll: true });
});

export interface HistoryColumnToggleState { readonly id: string; readonly open: boolean; readonly onToggle: () => void }

export interface HistoryColumnOptions {
  /** The column's element id, the toggle's `aria-controls`. */
  readonly id: string;
  /** Where the open state is remembered for this viewer (`localStorage`). */
  readonly storageKey: string;
  readonly conversations: ConversationsConfig | undefined;
  /** False where only the popover or sheet fits (floating panes, phones) and for `history="popover"`. */
  readonly enabled: boolean;
  /** What an open artifact takes beside the chat (0 when none is open): the column steps aside while column, artifact and chat do not fit. */
  readonly beside?: number;
  readonly defaultOpen?: boolean;
  readonly title?: string;
}

/**
 * The column of one agent pane: put `ref` on the pane (the column and the chat), render `column` at its start and give `toggle` to the
 * History button (`HistoryColumnToggle`). `toggle` is null while the column does not fit: History then opens its popover or sheet.
 */
export function useHistoryColumn({ id, storageKey, conversations, enabled, beside = 0, defaultOpen = false, title }: HistoryColumnOptions): {
  readonly ref: (element: HTMLElement | null) => void;
  readonly toggle: HistoryColumnToggleState | null;
  readonly column: ReactNode;
} {
  const [width, setWidth] = useState(0);
  const observer = useRef<ResizeObserver | null>(null);
  const ref = useCallback((element: HTMLElement | null) => {
    observer.current?.disconnect();
    if (!element) return;
    setWidth(element.getBoundingClientRect().width);
    if (typeof ResizeObserver === 'undefined') return;
    observer.current = new ResizeObserver(([entry]) => { if (entry) setWidth(entry.contentRect.width); });
    observer.current.observe(element);
  }, []);
  const [open, setOpen] = useHistoryOpen(storageKey, defaultOpen);
  const fits = enabled && Boolean(conversations) && historyColumnFits(width, beside);
  const shown = fits && open;
  const toggle = fits ? { id, open: shown, onToggle: () => { setOpen(!open); if (!open) focusHistoryRow(id); } } : null;
  return { ref, toggle, column: shown && <HistoryColumn id={id} conversations={conversations} {...(title ? { title } : {})} /> };
}

/** The side column: the sessions pane (search, New, the rows and their actions) and a vertical separator. Escape and a pick leave it open. */
export function HistoryColumn({ id, conversations, title }: { readonly id: string; readonly conversations: ConversationsConfig | undefined; readonly title?: string }) {
  return <div id={id} data-testid="history-column" className="flex min-h-0 shrink-0">
    <SessionsPane conversations={conversations} drawer={false} {...(title ? { title } : {})} />
    <Separator orientation="vertical" className="w-px" />
  </div>;
}

/** History as the column's toggle: `aria-expanded`, `aria-controls`, test id `chat-action-history`. */
export function HistoryColumnToggle({ toggle, className }: { readonly toggle: HistoryColumnToggleState; readonly className?: string }) {
  const { labels, icons } = useAppText();
  return <Button size="icon" variant="ghost" data-testid="chat-action-history" aria-label={labels.history} title={toggle.open ? labels.hideHistory : labels.showHistory}
    aria-expanded={toggle.open} aria-controls={toggle.id} data-state={toggle.open ? 'open' : 'closed'} onClick={toggle.onToggle} className={cn(className)}>
    <icons.history aria-hidden="true" />
  </Button>;
}
