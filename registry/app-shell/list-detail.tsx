'use client';

// The one list/detail primitive of layout B. Expanded: the list (20rem, its own scroll) and the detail side by side. Compact: one pane at a
// time; opening a detail is a stack step (one history entry, Back returns to the list) and the list stays mounted, hidden, so its scroll is
// kept. Host concern: Pi has no layout. A deep link that mounts with a detail needs nothing more: the Back manager's entry sits above the
// one the page was opened on, and the app's `onBack` (called by Back and by « ← ») clears the selection and replaces the URL.
import { useContext } from 'react';
import type { ReactNode } from 'react';
import { cn } from '../utils/utils';
import { ScreenActiveContext } from './agent-context';
import { useBackLayer } from './back';
import { useIsCompact } from './compact';
import { useScreenHeader } from './header';

export interface ListDetailProps {
  /** The list pane (the app's own list; a card list when compact is the app's choice through `useIsCompact`). */
  readonly list: ReactNode;
  /** `null` = nothing selected. */
  readonly detail: ReactNode | null;
  /** Clears the selection: compact Back and the header's « ← ». */
  readonly onBack: () => void;
  /** The detail's header title when compact (default: the screen's own). */
  readonly title?: string;
}

/** Which panes show: both when expanded; when compact the detail if one is selected, else the list. */
export function listDetailView(compact: boolean, detail: ReactNode | null): 'list' | 'detail' | 'both' {
  return !compact ? 'both' : detail === null ? 'list' : 'detail';
}

export function ListDetail({ list, detail, onBack, title }: ListDetailProps) {
  const compact = useIsCompact();
  const active = useContext(ScreenActiveContext);
  const view = listDetailView(compact, detail);
  const stacked = view === 'detail';
  useBackLayer(active && stacked, onBack, 'stack');
  useScreenHeader(stacked ? { back: onBack, ...(title ? { title } : {}) } : {}, { overlay: true });
  return <div data-testid="list-detail" data-view={view} className="flex h-full min-h-0">
    <div hidden={view === 'detail'} data-testid="list-pane" className={cn('min-h-0 overflow-y-auto overscroll-contain', compact ? 'w-full' : 'w-80 shrink-0 border-r border-border')}>{list}</div>
    <div hidden={view === 'list'} data-testid="detail-pane" className={cn('min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain', detail === null && 'bg-muted/30')}>{detail}</div>
  </div>;
}
