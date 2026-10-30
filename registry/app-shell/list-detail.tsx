'use client';

// The one list/detail primitive of layout B. Expanded: the list (20rem, or a `railWidth` rail when `collapsible` and folded; its own scroll) and the detail side by side. Compact: one pane at a
// time; opening a detail is a stack step (one history entry, Back returns to the list) and the list stays mounted, hidden, so its scroll is
// kept. Host concern: Pi has no layout. A deep link that mounts with a detail needs nothing more: the Back manager's entry sits above the
// one the page was opened on, and the app's `onBack` (called by Back, and by « ← » which is Back) clears the selection and replaces the URL.
import { useContext, useState } from 'react';
import type { ReactNode } from 'react';
import { ChevronsLeftIcon, ChevronsRightIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { cn } from '../utils/utils';
import { ScreenActiveContext } from './agent-context';
import { useBackLayer } from '../utils/back';
import { useIsCompact } from './compact';
import { useScreenHeader } from './header';

export interface ListDetailProps {
  /** The list pane (the app's own list; a card list when compact is the app's choice through `useIsCompact`). */
  readonly list: ReactNode | ((state: { readonly collapsed: boolean }) => ReactNode);
  /** `null` = nothing selected. */
  readonly detail: ReactNode | null;
  /** Clears the selection and replaces the URL: called by compact Back and by the header's « ← » (which goes through the browser's Back). */
  readonly onBack: () => void;
  /** The detail's header title when compact (default: the screen's own). */
  readonly title?: string;
  /** Wide screens only: the list pane can fold to a narrow rail (`railWidth`), with a toggle on its edge. Give `list` as a function to render the rail's content. Default: fixed 20rem, no toggle. */
  readonly collapsible?: boolean;
  /** Controlled fold state; without it the pane keeps its own (starting open). */
  readonly collapsed?: boolean;
  readonly onCollapsedChange?: (collapsed: boolean) => void;
  /** The rail's width when collapsed (any CSS length). Default `3rem`, the shell's icon rail. */
  readonly railWidth?: string;
  /** The toggle's accessible names. Default English. */
  readonly labels?: { readonly collapse: string; readonly expand: string };
}

/** Which panes show: both when expanded; when compact the detail if one is selected, else the list. */
export function listDetailView(compact: boolean, detail: ReactNode | null): 'list' | 'detail' | 'both' {
  return !compact ? 'both' : detail === null ? 'list' : 'detail';
}

export function ListDetail({ list, detail, onBack, title, collapsible, collapsed: controlled, onCollapsedChange, railWidth = '3rem', labels = { collapse: 'Collapse the list', expand: 'Expand the list' } }: ListDetailProps) {
  const compact = useIsCompact();
  const [own, setOwn] = useState(false);
  const folds = Boolean(collapsible) && !compact;
  const collapsed = folds && (controlled ?? own);
  const toggle = () => { if (controlled === undefined) setOwn(!collapsed); onCollapsedChange?.(!collapsed); };
  const active = useContext(ScreenActiveContext);
  const view = listDetailView(compact, detail);
  const stacked = view === 'detail';
  useBackLayer(active && stacked, onBack, 'stack');
  // « ← » is the browser's Back, so there is one path: the popstate calls `onBack`, and the URL the entry below holds is the one the app then replaces.
  useScreenHeader(stacked ? { back: () => history.back(), ...(title ? { title } : {}) } : {}, { overlay: true });
  return <div data-testid="list-detail" data-view={view} className="flex h-full min-h-0">
    <div hidden={view === 'detail'} data-testid="list-pane" data-collapsed={folds ? collapsed : undefined} style={collapsed ? { width: railWidth } : undefined}
      className={cn('min-h-0 overflow-y-auto overscroll-contain', compact ? 'w-full' : collapsed ? 'shrink-0' : 'w-80 shrink-0')}>{folds && <div className={cn('flex p-1', collapsed ? 'justify-center' : 'justify-end')}>
        <Button variant="ghost" size="icon-sm" data-testid="list-toggle" aria-expanded={!collapsed} aria-label={collapsed ? labels.expand : labels.collapse} title={collapsed ? labels.expand : labels.collapse} onClick={toggle}>
          {collapsed ? <ChevronsRightIcon /> : <ChevronsLeftIcon />}
        </Button>
      </div>}
      {typeof list === 'function' ? list({ collapsed }) : list}</div>
    {!compact && view !== 'detail' && <Separator orientation="vertical" />}
    <div hidden={view === 'list'} data-testid="detail-pane" className={cn('min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain', detail === null && 'bg-muted/30')}>{detail}</div>
  </div>;
}
