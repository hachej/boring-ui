'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { EntryRecord } from '@earendil-works/pi-durable';
import type { AssistantMessage, Message } from '@earendil-works/pi-ai';
import type { ChatHistoryState } from '@hachej/boring-ui-kit/native-chat';
import { ArchiveIcon, ArchiveRestoreIcon, ArrowLeftIcon, CheckIcon, EllipsisIcon, MessageSquareIcon, PencilIcon, SearchIcon, Trash2Icon, XIcon } from 'lucide-react';
import { Button } from '../button/button';
import { Drawer, DrawerContent, DrawerTitle } from '@/components/ui/drawer';
import { ActionButton, ActionMenu, actionMenuItem, headerActions, menuActions } from '../button/actions';
import type { ConversationItem, ConversationsConfig, ReplyRef } from './config';
import { Markdown } from './markdown';
import { cn } from '../utils/utils';
import { isFileBlock, replyMeta } from './rows';
import { defaultChatLabels, useChatText } from './labels';
import type { ChatLabels } from './labels';

const DAY = 86_400_000;
const toMs = (value: ConversationItem['updatedAt']): number | undefined => {
  if (value === undefined) return undefined;
  const ms = value instanceof Date ? value.getTime() : typeof value === 'number' ? value : Date.parse(value);
  return Number.isFinite(ms) ? ms : undefined;
};

/** Short relative time for a list row: "now", "5m", "3h", "Yesterday", "4d", then a date. */
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
  const now = useMemo(() => Date.now(), [conversations.items]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (autoFocus && !globalThis.matchMedia?.('(pointer: coarse)').matches) search.current?.focus(); }, [autoFocus]);
  const serverSearch = conversations.search;
  useEffect(() => {
    const needle = query.trim();
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
  const action = 'text-muted-foreground';
  const total = shown.reduce((sum, group) => sum + group.items.length, 0);
  return <>
      {!searchOpen && <Button variant="ghost" data-testid="conversation-search-open" className="mx-2 justify-start" onClick={() => { setSearchOpen(true); requestAnimationFrame(() => search.current?.focus()); }}><SearchIcon className="size-4" aria-hidden="true" />{labels.search}</Button>}
      {searchOpen && <div className="relative flex shrink-0 flex-wrap items-center gap-2 px-3 py-2">
        <SearchIcon className="pointer-events-none absolute top-5 left-5.5 size-4 text-muted-foreground" aria-hidden="true" />
        <input ref={search} type="search" value={query} onChange={event => setQuery(event.currentTarget.value)} placeholder={labels.searchConversations} aria-label={labels.searchConversations} data-testid="conversation-search"
          className={cn('h-9 w-full rounded-lg border border-border bg-background pr-3 pl-8 text-base outline-none max-sm:h-11 pointer-coarse:h-11 placeholder:text-muted-foreground focus-visible:border-ring/60 focus-visible:ring-[3px] focus-visible:ring-ring/15 sm:text-sm', conversations.archive && serverSearch && 'pr-10')} />
        {conversations.archive && serverSearch && <Button size="icon-sm" variant={archived ? 'secondary' : 'ghost'} aria-pressed={archived} aria-label={labels.archived} title={labels.archived} data-testid="conversations-archived"
          className="h-8 w-auto gap-2 rounded-full px-3 text-muted-foreground" onClick={() => setArchived(value => !value)}><ArchiveIcon className="size-3.5" aria-hidden="true" />{labels.archived}</Button>}
      </div>}
      {navigation}
      {failure && <p role="alert" className="m-0 shrink-0 px-3 pt-2 text-xs text-destructive">{failure}</p>}
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-1.5 py-1.5" aria-busy={loading ? 'true' : undefined}>
        {total === 0 && <p role="status" data-testid="conversations-empty" className="m-0 px-3 py-8 text-center text-sm text-muted-foreground">
          {loading ? labels.loadingConversations : query.trim() ? labels.noMatch(query.trim()) : archived ? labels.noArchived : labels.noConversations}</p>}
        {shown.map(group => <section key={group.key} aria-label={labels[group.key]} className="mb-1">
          <h4 className="m-0 px-2.5 pt-2 pb-1 text-xs font-medium tracking-wide text-muted-foreground">{labels[group.key]}</h4>
          <ul className="m-0 list-none p-0">
            {group.items.map(item => {
              const active = item.id === conversations.activeId;
              const title = item.title?.trim() || labels.untitled;
              const extra = conversations.rowActions?.(item);
              // A row has room for icons only: a header action without an icon goes in the row's "…" menu.
              const extraButtons = headerActions(extra).filter(entry => entry.icon), extraMenu = [...headerActions(extra).filter(entry => !entry.icon), ...menuActions(extra)];
              if (renaming === item.id && conversations.rename) {
                const rename = conversations.rename;
                return <li key={item.id}>
                  <form className="flex min-h-10 items-center gap-2 px-2.5 py-1" onSubmit={event => {
                    event.preventDefault();
                    const value = new FormData(event.currentTarget).get('title')?.toString().trim();
                    setRenaming(null);
                    if (value && value !== item.title) run(() => rename(item.id, value));
                  }}>
                    <PencilIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                    <input name="title" autoFocus defaultValue={title} maxLength={200} aria-label={labels.conversationName} data-testid="conversation-rename-input"
                      onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); setRenaming(null); } }}
                      className="h-8 min-w-0 flex-1 rounded-md border border-border bg-background px-2 text-base outline-none focus-visible:border-ring/60 focus-visible:ring-[3px] focus-visible:ring-ring/15 sm:text-sm" />
                    <Button type="submit" size="sm" variant="outline" data-testid="conversation-rename-save">{labels.save}</Button>
                  </form>
                </li>;
              }
              return <li key={item.id} className="group/row relative flex items-center">
                <button type="button" data-testid="conversation-row" data-conversation-id={item.id} data-active={active ? 'true' : undefined} aria-current={active ? 'true' : undefined}
                  title={item.lastMessage ?? undefined}
                  onClick={() => { if (!active) conversations.onSelect(item.id); onPicked?.(); }}
                  className={cn('flex min-h-10 w-full min-w-0 cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/60 max-sm:min-h-12 motion-reduce:transition-none',
                    active ? 'bg-muted font-medium' : 'hover:bg-muted/60')}>
                  <MessageSquareIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                  <span className="min-w-0 flex-1 truncate">{title}</span>
                  {active ? <span className="inline-flex shrink-0 items-center gap-1 text-xs text-muted-foreground"><CheckIcon className="size-3.5" aria-hidden="true" /><span className="sr-only">{labels.current}</span></span>
                    : <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{relativeTime(item.updatedAt, now, labels)}</span>}
                </button>
                {(conversations.rename || conversations.archive || conversations.remove || extraButtons.length > 0 || extraMenu.length > 0) && <div data-testid="conversation-actions"
                  className={cn('absolute right-1 flex shrink-0 items-center gap-0.5 rounded-md bg-background pr-1',
                    confirming === item.id ? '' : 'opacity-0 group-hover/row:opacity-100 group-focus-within/row:opacity-100 pointer-coarse:opacity-100')}>
                  {confirming === item.id && conversations.remove ? <>
                    <Button size="sm" variant="destructive" data-testid="conversation-delete-confirm" onClick={() => { const remove = conversations.remove!; setConfirming(null); run(() => remove(item.id)); }}>{labels.delete}</Button>
                    <Button size="icon-sm" variant="ghost" aria-label={labels.keep} className={action} onClick={() => setConfirming(null)}><XIcon className="size-3.5" aria-hidden="true" /></Button>
                  </> : rowActionLayout === 'menu' ? <ActionMenu label={labels.moreActions} size="icon-sm" testId="conversation-action-more" icon={<EllipsisIcon className="size-4" aria-hidden="true" />} items={[
                    ...(conversations.rename ? [{ id: 'rename', label: labels.rename, testId: 'conversation-rename', onSelect: () => setRenaming(item.id) }] : []),
                    ...(conversations.archive ? [{ id: 'archive', label: item.archived ? labels.restore : labels.archive, testId: 'conversation-archive', onSelect: () => run(() => conversations.archive!(item.id, !item.archived)) }] : []),
                    ...(conversations.remove ? [{ id: 'delete', label: labels.delete, testId: 'conversation-delete', onSelect: () => setConfirming(item.id) }] : []),
                    ...[...extraButtons, ...extraMenu].map(entry => actionMenuItem(entry, 'conversation-action')),
                  ]} /> : <>
                    {conversations.rename && <Button size="icon-sm" variant="ghost" aria-label={labels.renameItem(title)} title={labels.rename} data-testid="conversation-rename" className={action} onClick={() => setRenaming(item.id)}><PencilIcon className="size-3.5" aria-hidden="true" /></Button>}
                    {conversations.archive && <Button size="icon-sm" variant="ghost" aria-label={labels.archiveItem(title, item.archived === true)} title={item.archived ? labels.restore : labels.archive} data-testid="conversation-archive" className={action}
                      onClick={() => { const archive = conversations.archive!; run(() => archive(item.id, !item.archived)); }}>{item.archived ? <ArchiveRestoreIcon className="size-3.5" aria-hidden="true" /> : <ArchiveIcon className="size-3.5" aria-hidden="true" />}</Button>}
                    {conversations.remove && <Button size="icon-sm" variant="ghost" aria-label={labels.deleteItem(title)} title={labels.delete} data-testid="conversation-delete" className={action} onClick={() => setConfirming(item.id)}><Trash2Icon className="size-3.5" aria-hidden="true" /></Button>}
                    {extraButtons.map(entry => <ActionButton key={entry.id} action={entry} testId="conversation-action" className={action} />)}
                    {extraMenu.length > 0 && <ActionMenu label={labels.moreActions} size="icon-sm" testId="conversation-action-more" icon={<EllipsisIcon className="size-3.5" aria-hidden="true" />}
                      items={extraMenu.map(entry => actionMenuItem(entry, 'conversation-action'))} />}
                  </>}
                </div>}
              </li>;
            })}
          </ul>
        </section>)}
      </div>
  </>;
}

/**
 * The list of past conversations in a dialog: a header with New, then `ConversationList`.
 * An anchored card on a wide screen and a bottom drawer on a phone. Escape or a click outside closes it.
 */
export function ConversationHistory({ conversations, onClose, onBrowseEarlier, placement = 'below' }: {
  readonly conversations: ConversationsConfig;
  readonly onClose: () => void;
  /** When given, a footer action opens the earlier records of the open conversation. */
  readonly onBrowseEarlier?: (() => void) | undefined;
  /** `above` opens the card upwards from a bar docked at the bottom of the screen; the backdrop then covers the whole page. */
  readonly placement?: 'below' | 'above';
}) {
  const { labels, icons } = useChatText();
  const [phone, setPhone] = useState(() => globalThis.matchMedia?.('(max-width: 640px)').matches === true);
  useEffect(() => { const media = globalThis.matchMedia?.('(max-width: 640px)'); if (!media) return; const change = () => setPhone(media.matches); media.addEventListener('change', change); return () => media.removeEventListener('change', change); }, []);
  useEffect(() => {
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    document.addEventListener('keydown', escape);
    return () => document.removeEventListener('keydown', escape);
  }, [onClose]);
  const content = <>
      <header className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2.5 max-sm:pt-[max(0.625rem,env(safe-area-inset-top))]">
        <Button size="icon-sm" variant="ghost" aria-label={labels.closeHistory} title={labels.close} data-testid="conversations-close" onClick={onClose} className="sm:hidden"><ArrowLeftIcon className="size-4" aria-hidden="true" /></Button>
        <h3 className="m-0 min-w-0 flex-1 font-(family-name:--chat-display) text-sm font-semibold tracking-tight">{labels.history}</h3>
        {conversations.onNew && <Button size="sm" variant="outline" data-testid="conversation-new" onClick={() => { conversations.onNew!(); onClose(); }}><icons.newChat className="size-3.5" aria-hidden="true" />{labels.newConversation}</Button>}
        <Button size="icon-sm" variant="ghost" aria-label={labels.closeHistory} title={labels.close} onClick={onClose} className="max-sm:hidden"><XIcon className="size-4" aria-hidden="true" /></Button>
      </header>
      <ConversationList conversations={conversations} onPicked={onClose} autoFocus />
      {onBrowseEarlier && <footer className="shrink-0 border-t border-border p-1.5 max-sm:pb-[max(0.375rem,env(safe-area-inset-bottom))]">
        <Button size="sm" variant="ghost" data-testid="history-earlier" className="w-full justify-start text-muted-foreground" onClick={() => { onBrowseEarlier(); onClose(); }}>
          <icons.history className="size-3.5" aria-hidden="true" />{labels.earlierInConversation}</Button>
      </footer>}
  </>;
  return phone ? <Drawer open showSwipeHandle onOpenChange={next => { if (!next) onClose(); }}><DrawerContent data-testid="conversations" aria-label={labels.historyDialog} className="pi-chat h-[80dvh] pb-[env(safe-area-inset-bottom)] duration-(--chat-sheet-duration) motion-reduce:transition-none"><DrawerTitle className="sr-only">{labels.historyDialog}</DrawerTitle>{content}</DrawerContent></Drawer>
    : <><button type="button" tabIndex={-1} aria-hidden="true" data-testid="conversations-backdrop" onClick={onClose} className={cn('z-20 cursor-default', placement === 'above' ? 'fixed inset-0' : 'absolute inset-0')} /><section role="dialog" aria-label={labels.historyDialog} data-testid="conversations" className={cn('absolute z-30 flex w-[23rem] flex-col rounded-2xl border border-border bg-background text-foreground shadow-lg', placement === 'above' ? 'bottom-full left-0 mb-2 max-h-[min(26rem,60dvh)]' : 'top-12 right-3 max-h-[min(34rem,calc(100%-4rem))]')}>{content}</section></>;
}

function line(message: Message, developer: boolean, labels: ChatLabels): { readonly role: string; readonly body: string; readonly assistant?: AssistantMessage } | undefined {
  if (message.role === 'system') return developer ? { role: labels.roleSystem, body: typeof message.content === 'string' ? message.content : message.content.map(part => part.text).join('\n') } : undefined;
  if (message.role === 'toolResult') return { role: labels.roleToolResult(message.toolName, message.isError), body: message.content.map(part => part.type === 'text' ? part.text : '[image result]').join('\n') };
  if (message.role === 'user') return { role: labels.roleUser, body: typeof message.content === 'string' ? message.content : message.content.filter(part => part.type !== 'text' || !isFileBlock(part.text)).map(part => part.type === 'text' ? part.text : '[image attachment]').join('\n') };
  const body = message.content.map(part => part.type === 'text' ? part.text : part.type === 'toolCall' ? `[tool call: ${part.name}]` : developer ? `[reasoning]\n${part.thinking}` : '').filter(Boolean).join('\n\n');
  return { role: labels.roleAssistant(message.stopReason === 'aborted' ? 'interrupted' : message.stopReason === 'error' ? 'failed' : 'ok'), body, ...(message.stopReason === 'error' || message.stopReason === 'aborted' ? {} : { assistant: message }) };
}

type HistoryRow = { readonly key: string; readonly role: string; readonly body: string; readonly entryId: string; readonly assistant: AssistantMessage | undefined };
const replyText = (message: AssistantMessage) => message.content.flatMap(part => part.type === 'text' && part.text ? [part.text] : []).join('\n\n');

/** Read-only older records of the open conversation, paged in by the controller. Historical tool results are not current actions. */
export function HistoryPanel({ history, developer, connected, onLoad, onClose, replyFooter }: {
  readonly history: ChatHistoryState; readonly developer: boolean; readonly connected: boolean; readonly onLoad: () => void; readonly onClose: () => void;
  /** The host's reply footer, shown under each earlier reply that has text. Earlier records get no actions. */
  readonly replyFooter?: ((reply: ReplyRef) => ReactNode) | undefined;
}) {
  const { labels, icons } = useChatText();
  const entries: readonly EntryRecord[] = 'entries' in history ? history.entries : [];
  const rows = entries.flatMap((entry): HistoryRow[] => entry.model?.length
    ? entry.model.flatMap((message, index) => { const made = line(message, developer, labels); return made ? [{ key: `history:${entry.id}:${index}`, entryId: String(entry.id), assistant: undefined, ...made }] : []; })
    : [{ key: `history:${entry.id}`, role: labels.roleEvent, body: entry.head === undefined ? entry.kind : labels.contextBoundary, entryId: String(entry.id), assistant: undefined }]);
  const exhausted = history.kind === 'ready' && !history.hasMore;
  return <section aria-label={labels.earlierMessages} data-testid="history" aria-live="off" className="shrink-0 border-b border-border bg-muted/20">
    <div className="mx-auto flex max-w-3xl items-center gap-2 px-4 py-2">
      <icons.history className="size-4 text-muted-foreground" aria-hidden="true" />
      <h3 className="m-0 min-w-0 flex-1 truncate font-(family-name:--chat-display) text-sm font-medium">{labels.earlierMessages} <span className="font-normal text-muted-foreground">{labels.readOnly}</span></h3>
      <Button size="sm" variant="outline" data-testid="history-load" onClick={onLoad} disabled={!connected || history.kind === 'loading' || history.kind === 'disabled' || exhausted}>
        {history.kind === 'error' ? labels.retry : history.kind === 'loading' ? labels.loadingShort : labels.loadEarlier}</Button>
      <Button size="icon-sm" aria-label={labels.returnToConversation} title={labels.returnToConversation} onClick={onClose}><XIcon className="size-4" aria-hidden="true" /></Button>
    </div>
    <div className="mx-auto max-h-[40dvh] max-w-3xl space-y-3 overflow-y-auto px-4 pb-3">
      {history.kind === 'error' && <p role="alert" className="m-0 text-sm text-destructive">{labels.historyFailed}</p>}
      {history.kind === 'idle' && <p className="m-0 text-sm text-muted-foreground">{labels.loadPage}</p>}
      {rows.map(row => <article key={row.key} data-history-row-id={row.key} className="rounded-lg border border-border bg-background/60 px-3 py-2">
        <p className="m-0 mb-1 text-xs font-medium tracking-wide text-muted-foreground uppercase">{row.role}</p>
        <div className="text-sm opacity-90"><Markdown text={row.body} /></div>
        {replyFooter && row.assistant && replyText(row.assistant) && replyFooter({ key: row.key, text: replyText(row.assistant), entryId: row.entryId, ...replyMeta(row.assistant) })}</article>)}
      {history.kind === 'ready' && !rows.length && <p className="m-0 text-sm text-muted-foreground">{labels.noRecords}</p>}
      {exhausted && <p className="m-0 text-center text-xs text-muted-foreground">{labels.beginning}</p>}
    </div>
  </section>;
}

/** Native archived records remain reachable even when the host hides the chat header or conversation History action. */
export function TranscriptHistory(props: Parameters<typeof HistoryPanel>[0]) {
  const { labels } = useChatText();
  if (props.history.kind === 'disabled') return null;
  return <div className="relative z-10" data-testid="transcript-history">
    {props.history.kind === 'idle'
      ? <div className="flex justify-center"><Button size="sm" variant="quiet" data-testid="transcript-history-load" disabled={!props.connected} onClick={props.onLoad}>{labels.loadEarlier}</Button></div>
      : <HistoryPanel {...props} />}
  </div>;
}
