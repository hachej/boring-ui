'use client';

import { usePhone } from '../utils/use-media';

import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { ChatHistoryState } from '@hachej/boring-ui-kit/native-chat';
import { ArchiveIcon, ArchiveRestoreIcon, ArrowLeftIcon, CheckIcon, EllipsisIcon, Loader2Icon, MessageSquareIcon, PencilIcon, SearchIcon, Trash2Icon, XIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { targetContent } from './rows';
import { Drawer, DrawerContent, DrawerTitle } from '@/components/ui/drawer';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuPortal, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { SidebarGroup, SidebarGroupLabel, SidebarMenu, SidebarMenuItem } from '@/components/ui/sidebar';
import { Toggle } from '@/components/ui/toggle';
import { ActionButton, actionMenuItem, headerActions, menuActions } from '../button/actions';
import type { BlockAction, MenuItem } from '../button/actions';
import type { ConversationItem, ConversationsConfig } from './config';
import { cn } from '../utils/utils';
import { defaultChatLabels, useChatText } from './labels';
import type { ChatLabels } from './labels';

const DAY = 86_400_000;
const toMs = (value: ConversationItem['updatedAt']): number | undefined => {
  if (value === undefined) return undefined;
  const ms = value instanceof Date ? value.getTime() : typeof value === 'number' ? value : Date.parse(value);
  return Number.isFinite(ms) ? ms : undefined;
};

/** Short relative time for a list row: "now", "5m", "3h", "Yesterday", "4d", then a date. */
/** The tooltip's last message without a leading `<target>` block (point-and-speak); a preview clipped inside the block gets no tooltip. */
const lastSaid = (text: string | null | undefined): string | undefined => !text ? undefined : text.startsWith('<target>') ? targetContent(text)?.speech || undefined : text;

export function relativeTime(value: ConversationItem['updatedAt'], now = Date.now(), labels: Pick<ChatLabels, 'justNow' | 'yesterday'> = defaultChatLabels): string {
  const ms = toMs(value);
  if (ms === undefined) return '';
  const age = Math.max(0, now - ms);
  if (age < 60_000) return labels.justNow;
  if (age < 3_600_000) return `${Math.floor(age / 60_000)}m`;
  if (age < DAY) return `${Math.floor(age / 3_600_000)}h`;
  const days = Math.floor(age / DAY);
  if (days === 1) return labels.yesterday;
  if (days < 7) return `${days}d`;
  return new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric', ...(days > 300 ? { year: 'numeric' } : {}) });
}

type Group = 'today' | 'yesterday' | 'previousWeek' | 'older' | 'conversations';
function groupOf(value: ConversationItem['updatedAt'], now: number): Group {
  const ms = toMs(value);
  if (ms === undefined) return 'conversations';
  const start = new Date(now); start.setHours(0, 0, 0, 0);
  const age = start.getTime() - ms;
  return age <= 0 ? 'today' : age <= DAY ? 'yesterday' : age < 7 * DAY ? 'previousWeek' : 'older';
}
const ORDER: readonly Group[] = ['today', 'yesterday', 'previousWeek', 'older', 'conversations'];

/** The row's "…" menu: host actions in the consumer's shadcn dropdown-menu. */
function RowActions({ label, items }: { readonly label: string; readonly items: readonly MenuItem[] }) {
  const portal = useRef<HTMLElement | null>(null);
  return <DropdownMenu>
    <DropdownMenuTrigger render={<Button ref={node => { portal.current = node?.ownerDocument.body ?? null; }} variant="ghost" size="icon-sm" aria-label={label} title={label} data-testid="conversation-action-more"><EllipsisIcon data-icon="inline-start" aria-hidden="true" /></Button>} />
    <DropdownMenuPortal container={portal}>
      <DropdownMenuContent align="end" aria-label={label} data-testid="conversation-action-more-list" className="w-64 max-w-[calc(100vw-1rem)]">
        {items.map(item => <Fragment key={item.id}>
          {item.separatorBefore && <DropdownMenuSeparator />}
          <DropdownMenuItem variant={item.destructive ? 'destructive' : 'default'} disabled={item.disabled} data-testid={item.testId ?? `conversation-action-more-${item.id}`} data-item={item.id} onClick={item.onSelect} className="min-h-8 max-md:min-h-10 pointer-coarse:min-h-10">
            {item.icon}{item.label}
          </DropdownMenuItem>
        </Fragment>)}
      </DropdownMenuContent>
    </DropdownMenuPortal>
  </DropdownMenu>;
}

/**
 * The searchable list of past conversations: a search box (server-side when the host offers `search`), the Archived filter, rows grouped by
 * recency with the open one marked, and the row actions the host offers (rename, archive, delete). It fills its container; `ConversationHistory`
 * puts it in a popover or sheet, the `pi-app` block in its sessions pane. `onPicked` runs after a row is chosen.
 */
export function ConversationList({ conversations, onPicked, autoFocus = false, searchMode = 'disclosure', rowActionLayout = 'menu', navigation }: {
  readonly conversations: ConversationsConfig;
  /** `inline` retains the always-visible search field. */
  readonly searchMode?: 'disclosure' | 'inline';
  /** `inline` retains the separate rename/archive/delete buttons. */
  readonly rowActionLayout?: 'menu' | 'inline';
  readonly navigation?: ReactNode;
  readonly onPicked?: (() => void) | undefined;
  /** Focus the search box on mount (not on touch screens). */
  readonly autoFocus?: boolean;
}) {
  const { labels } = useChatText();
  const [query, setQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(autoFocus || searchMode === 'inline');
  const [archived, setArchived] = useState(false);
  // Server-side results while a query is typed or the Archived filter is on (when the host offers `search`).
  const [found, setFound] = useState<{ readonly items: readonly ConversationItem[]; readonly loading: boolean } | null>(null);
  const [revision, setRevision] = useState(0);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const search = useRef<HTMLInputElement>(null);
  // The time the list arrived: rows group and age against it until the host sends new items.
  // eslint-disable-next-line react-hooks/purity, react-hooks/exhaustive-deps -- read once per items list on purpose, so rows keep one clock between list updates
  const now = useMemo(() => Date.now(), [conversations.items]);
  useEffect(() => { if (autoFocus && !globalThis.matchMedia?.('(pointer: coarse)').matches) search.current?.focus(); }, [autoFocus]);
  const serverSearch = conversations.search;
  useEffect(() => {
    const needle = query.trim();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- leaving server search drops its results once, after commit
    if (!serverSearch || (!needle && !archived)) { setFound(null); return; }
    const controller = new AbortController();
    setFound(previous => ({ items: previous?.items ?? [], loading: true }));
    const timer = setTimeout(() => {
      serverSearch(needle, { archived }, controller.signal).then(items => { if (!controller.signal.aborted) setFound({ items, loading: false }); })
        .catch(() => { if (!controller.signal.aborted) setFound({ items: [], loading: false }); });
    }, 150);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [serverSearch, query, archived, revision]);
  /** Runs one row action; the host refreshes `items`, and a server-side search runs again. */
  const run = (action: () => Promise<void>) => {
    setFailure(null);
    action().then(() => setRevision(value => value + 1), () => setFailure(labels.actionFailed));
  };
  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const items = found ? found.items : conversations.items.filter(item => !item.archived && (!needle || (item.title ?? labels.untitled).toLowerCase().includes(needle)));
    const sorted = [...items].sort((a, b) => (toMs(b.updatedAt) ?? 0) - (toMs(a.updatedAt) ?? 0));
    const groups = new Map<Group, ConversationItem[]>();
    for (const item of sorted) { const key = groupOf(item.updatedAt, now); groups.set(key, [...(groups.get(key) ?? []), item]); }
    return ORDER.flatMap(key => groups.has(key) ? [{ key, items: groups.get(key)! }] : []);
  }, [conversations.items, found, query, now, labels.untitled]);
  const loading = found ? found.loading : conversations.loading;
  const total = shown.reduce((sum, group) => sum + group.items.length, 0);
  const rowActionItems = (item: ConversationItem, extraButtons: readonly BlockAction[], extraMenu: readonly BlockAction[]): MenuItem[] => [
    ...(conversations.rename ? [{ id: 'rename', icon: <PencilIcon />, label: labels.rename, testId: 'conversation-rename', onSelect: () => setRenaming(item.id) }] : []),
    ...(conversations.archive ? [{ id: 'archive', icon: item.archived ? <ArchiveRestoreIcon /> : <ArchiveIcon />, label: item.archived ? labels.restore : labels.archive, testId: 'conversation-archive', onSelect: () => run(() => conversations.archive!(item.id, !item.archived)) }] : []),
    ...(conversations.remove ? [{ id: 'delete', icon: <Trash2Icon />, destructive: true, separatorBefore: true, label: labels.delete, testId: 'conversation-delete', onSelect: () => setConfirming(item.id) }] : []),
    ...[...extraButtons, ...extraMenu].map(entry => actionMenuItem(entry, 'conversation-action')),
  ];
  return <>
      {!searchOpen && <Button variant="ghost" data-testid="conversation-search-open" className="mx-2 justify-start" onClick={() => { setSearchOpen(true); requestAnimationFrame(() => search.current?.focus()); }}><SearchIcon data-icon="inline-start" aria-hidden="true" />{labels.search}</Button>}
      {searchOpen && <div className="shrink-0 px-3 py-2">
        <InputGroup>
          <InputGroupAddon><SearchIcon aria-hidden="true" /></InputGroupAddon>
          <InputGroupInput ref={search} type="search" value={query} onChange={event => setQuery(event.currentTarget.value)} placeholder={labels.searchConversations} aria-label={labels.searchConversations} data-testid="conversation-search" />
          {conversations.archive && serverSearch && <InputGroupAddon align="inline-end"><Toggle pressed={archived} aria-label={labels.archived} title={labels.archived} data-testid="conversations-archived"
            onPressedChange={setArchived}><ArchiveIcon data-icon="inline-start" aria-hidden="true" />{labels.archived}</Toggle></InputGroupAddon>}
        </InputGroup>
      </div>}
      {navigation}
      {failure && <p role="alert" className="m-0 shrink-0 px-3 pt-2 text-xs text-destructive">{failure}</p>}
      <ScrollArea className="min-h-0 flex-1" aria-busy={loading ? 'true' : undefined}>
        {total === 0 && <p role="status" data-testid="conversations-empty" className="m-0 px-3 py-8 text-center text-sm text-muted-foreground">
          {loading ? labels.loadingConversations : query.trim() ? labels.noMatch(query.trim()) : archived ? labels.noArchived : labels.noConversations}</p>}
        {shown.map(group => <SidebarGroup key={group.key} aria-label={labels[group.key]} role="group">
          <SidebarGroupLabel render={<h4 />}>{labels[group.key]}</SidebarGroupLabel>
          <SidebarMenu>
            {group.items.map(item => {
              const active = item.id === conversations.activeId;
              const title = (item.title?.startsWith('<target>') ? lastSaid(item.title) : item.title)?.trim() || labels.untitled;
              const extra = conversations.rowActions?.(item);
              // A row has room for icons only: a header action without an icon goes in the row's "…" menu.
              const extraButtons = headerActions(extra).filter(entry => entry.icon), extraMenu = [...headerActions(extra).filter(entry => !entry.icon), ...menuActions(extra)];
              if (renaming === item.id && conversations.rename) {
                const rename = conversations.rename;
                return <SidebarMenuItem key={item.id}>
                  <form className="flex items-center gap-2" onSubmit={event => {
                    event.preventDefault();
                    const value = new FormData(event.currentTarget).get('title')?.toString().trim();
                    setRenaming(null);
                    if (value && value !== item.title) run(() => rename(item.id, value));
                  }}>
                    <PencilIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                    <Input name="title" autoFocus defaultValue={title} maxLength={200} aria-label={labels.conversationName} data-testid="conversation-rename-input"
                      onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); setRenaming(null); } }}
                      className="min-w-0 flex-1" />
                    <Button type="submit" size="sm" variant="outline" data-testid="conversation-rename-save">{labels.save}</Button>
                  </form>
                </SidebarMenuItem>;
              }
              return <SidebarMenuItem key={item.id} className="flex items-center gap-0.5">
                <Button type="button" variant={active ? 'secondary' : 'ghost'} data-testid="conversation-row" data-conversation-id={item.id} data-active={active ? 'true' : undefined} aria-current={active ? 'true' : undefined}
                  title={lastSaid(item.lastMessage)}
                  onClick={() => { if (!active) conversations.onSelect(item.id); onPicked?.(); }}
                  className="h-auto min-h-10 min-w-0 flex-1 justify-start max-md:min-h-12">
                  <MessageSquareIcon data-icon="inline-start" aria-hidden="true" />
                  <span className="min-w-0 flex-1 truncate text-left">{title}</span>
                  {active ? <span className="inline-flex shrink-0 items-center gap-1 text-xs text-muted-foreground"><CheckIcon className="size-3.5" aria-hidden="true" /><span className="sr-only">{labels.current}</span></span>
                    : <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{relativeTime(item.updatedAt, now, labels)}</span>}
                </Button>
                {(conversations.rename || conversations.archive || conversations.remove || extraButtons.length > 0 || extraMenu.length > 0) && <div data-testid="conversation-actions"
                  className={cn('flex shrink-0 items-center gap-0.5', confirming === item.id ? '' : 'opacity-0 group-hover/menu-item:opacity-100 group-focus-within/menu-item:opacity-100 pointer-coarse:opacity-100')}>
                  {confirming === item.id && conversations.remove ? <>
                    <Button size="sm" variant="destructive" data-testid="conversation-delete-confirm" onClick={() => { const remove = conversations.remove!; setConfirming(null); run(() => remove(item.id)); }}>{labels.delete}</Button>
                    <Button size="icon-sm" variant="ghost" aria-label={labels.keep} title={labels.keep} onClick={() => setConfirming(null)}><XIcon data-icon="inline-start" aria-hidden="true" /></Button>
                  </> : rowActionLayout === 'menu' ? <RowActions label={labels.moreActions} items={rowActionItems(item, extraButtons, extraMenu)} /> : <>
                    {conversations.rename && <Button size="icon-sm" variant="ghost" aria-label={labels.renameItem(title)} title={labels.rename} data-testid="conversation-rename" onClick={() => setRenaming(item.id)}><PencilIcon data-icon="inline-start" aria-hidden="true" /></Button>}
                    {conversations.archive && <Button size="icon-sm" variant="ghost" aria-label={labels.archiveItem(title, item.archived === true)} title={item.archived ? labels.restore : labels.archive} data-testid="conversation-archive"
                      onClick={() => { const archive = conversations.archive!; run(() => archive(item.id, !item.archived)); }}>{item.archived ? <ArchiveRestoreIcon data-icon="inline-start" aria-hidden="true" /> : <ArchiveIcon data-icon="inline-start" aria-hidden="true" />}</Button>}
                    {conversations.remove && <Button size="icon-sm" variant="ghost" aria-label={labels.deleteItem(title)} title={labels.delete} data-testid="conversation-delete" onClick={() => setConfirming(item.id)}><Trash2Icon data-icon="inline-start" aria-hidden="true" /></Button>}
                    {extraButtons.map(entry => <ActionButton key={entry.id} action={entry} testId="conversation-action" />)}
                    {extraMenu.length > 0 && <RowActions label={labels.moreActions} items={extraMenu.map(entry => actionMenuItem(entry, 'conversation-action'))} />}
                  </>}
                </div>}
              </SidebarMenuItem>;
            })}
          </SidebarMenu>
        </SidebarGroup>)}
      </ScrollArea>
  </>;
}

/**
 * The list of past conversations in a dialog: a header with New, then `ConversationList`.
 * An anchored card on a wide screen and a bottom drawer on a phone. Escape or a click outside closes it.
 */
export function ConversationHistory({ conversations, onClose, placement = 'below' }: {
  readonly conversations: ConversationsConfig;
  readonly onClose: () => void;
  /** `above` opens the card upwards from a bar docked at the bottom of the screen; the backdrop then covers the whole page. */
  readonly placement?: 'below' | 'above';
}) {
  const { labels, icons } = useChatText();
  const phone = usePhone();
  useEffect(() => {
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    document.addEventListener('keydown', escape);
    return () => document.removeEventListener('keydown', escape);
  }, [onClose]);
  const content = <>
      <header className="flex shrink-0 items-center gap-2 px-3 py-2.5 max-md:pt-[max(0.625rem,env(safe-area-inset-top))]">
        <Button size="icon-sm" variant="ghost" aria-label={labels.closeHistory} title={labels.close} data-testid="conversations-close" onClick={onClose} className="md:hidden"><ArrowLeftIcon data-icon="inline-start" aria-hidden="true" /></Button>
        <h3 className="m-0 min-w-0 flex-1 text-sm font-semibold">{labels.history}</h3>
        {conversations.onNew && <Button size="sm" variant="outline" data-testid="conversation-new" onClick={() => { conversations.onNew!(); onClose(); }}><icons.newChat data-icon="inline-start" aria-hidden="true" />{labels.newConversation}</Button>}
        <Button size="icon-sm" variant="ghost" aria-label={labels.closeHistory} title={labels.close} onClick={onClose} className="max-md:hidden"><XIcon data-icon="inline-start" aria-hidden="true" /></Button>
      </header>
      <Separator />
      <ConversationList conversations={conversations} onPicked={onClose} autoFocus />
  </>;
  return phone ? <Drawer open showSwipeHandle onOpenChange={next => { if (!next) onClose(); }}><DrawerContent data-testid="conversations" aria-label={labels.historyDialog} className="pi-chat min-h-[80dvh]"><DrawerTitle className="sr-only">{labels.historyDialog}</DrawerTitle><div className="flex min-h-0 flex-1 flex-col pb-[env(safe-area-inset-bottom)]">{content}</div></DrawerContent></Drawer>
    : <Popover open onOpenChange={next => { if (!next) onClose(); }} modal={false}>
      <PopoverTrigger nativeButton={false} render={<span aria-hidden="true" className={cn('pointer-events-none absolute', placement === 'above' ? 'bottom-0 left-0' : 'top-12 right-3')} />} />
      <PopoverContent role="dialog" aria-label={labels.historyDialog} data-testid="conversations" side={placement === 'above' ? 'top' : 'bottom'} align={placement === 'above' ? 'start' : 'end'} className="pi-chat w-[23rem] max-w-[calc(100vw-1rem)] max-h-[min(34rem,70dvh)]">{content}</PopoverContent>
    </Popover>;
}

/** The only history chrome inside the normal transcript: a sentinel, spinner and accessible fallback. */
export function TranscriptHistory({ history, connected, onLoad, sentinelRef, hidden, loaded }: {
  readonly history: ChatHistoryState;
  readonly connected: boolean;
  readonly onLoad: () => void;
  readonly sentinelRef: (element: HTMLDivElement | null) => void;
  readonly hidden: number;
  readonly loaded: number;
}) {
  const { labels } = useChatText();
  if (history.kind === 'disabled' && hidden === 0) return null;
  const exhausted = hidden === 0 && history.kind === 'ready' && !history.hasMore;
  return <div ref={sentinelRef} data-testid="transcript-history" className="flex min-h-8 shrink-0 items-center justify-center text-xs text-muted-foreground">
    <Button variant="ghost" data-testid="transcript-history-load" className="sr-only focus:not-sr-only" disabled={!connected || history.kind === 'loading' || exhausted} onClick={onLoad}>{labels.loadEarlierMessages}</Button>
    {history.kind === 'loading' && <Loader2Icon className="size-4 animate-spin motion-reduce:animate-none" aria-label={labels.loadingShort} />}
    {history.kind === 'error' && <span role="alert">{labels.historyFailed}</span>}
    {exhausted && <span>{labels.beginning}</span>}
    <span role="status" aria-live="polite" className="sr-only">{loaded > 0 ? labels.earlierMessagesLoaded(loaded) : ''}</span>
  </div>;
}
