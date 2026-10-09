'use client';

import { useEffect } from 'react';
import type { ReactNode } from 'react';
import { Button } from '../button/button';
import { useAppText } from './app-labels';
import { ConversationList } from '../pi-chat/pi-chat';
import type { ConversationsConfig } from '../pi-chat/pi-chat';
import { cn } from '../utils/utils';

/** One agent the person can talk to; the pane shows a switcher when there are two or more. */
export interface WorkspaceAgent { readonly id: string; readonly label: string; readonly description?: string | undefined }
/** The page's agents and the chosen one. The host scopes `conversations` and the controller to `activeId`. */
export interface WorkspaceAgents { readonly items: readonly WorkspaceAgent[]; readonly activeId: string; readonly onSelect: (id: string) => void }
export type SessionsView = 'conversations' | 'library';

/**
 * The sessions pane: a title with New, then the searchable conversation list of `pi-chat` (`ConversationList`: search, Archived filter,
 * rename, archive, delete). Docked at the left on a wide screen; a drawer over the page with a backdrop on a narrow one, closed by
 * Escape, the backdrop, the close button or choosing a conversation. `library` adds Chat and Library links (the Library opens in the
 * center); `libraryContent` instead shows the library in the pane, as a tab beside the conversations or alone without them. With two
 * or more `agents`, a switcher at the top chooses whose conversations are listed.
 */
export function SessionsPane({ conversations, title: givenTitle, drawer, onClose, library, onChat, libraryContent, view = 'conversations', onViewChange, agents }: {
  readonly conversations?: ConversationsConfig | undefined;
  readonly library?: { readonly selected: boolean; readonly onSelect: () => void } | undefined;
  readonly onChat?: (() => void) | undefined;
  /** The library shown in the pane; invoke onPicked after opening a file to close a mobile drawer. */
  readonly libraryContent?: ((onPicked: () => void) => ReactNode) | undefined;
  /** Which tab is shown when the pane has both conversations and `libraryContent`. */
  readonly view?: SessionsView | undefined;
  readonly onViewChange?: ((view: SessionsView) => void) | undefined;
  readonly agents?: WorkspaceAgents | undefined;
  readonly title?: string;
  /** Rendered as a drawer (narrow screens). */
  readonly drawer: boolean;
  /** Closes the drawer; absent when docked. */
  readonly onClose?: (() => void) | undefined;
}) {
  const { labels, icons } = useAppText();
  const title = givenTitle ?? (conversations || !libraryContent ? labels.sessionsTitle : labels.library);
  useEffect(() => {
    if (!drawer || !onClose) return;
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape' && !event.defaultPrevented) onClose(); };
    document.addEventListener('keydown', escape);
    return () => document.removeEventListener('keydown', escape);
  }, [drawer, onClose]);
  const picked = () => { onChat?.(); if (drawer) onClose?.(); };
  const tabs = Boolean(libraryContent && conversations);
  const shown: SessionsView = !conversations && libraryContent ? 'library' : tabs ? view : 'conversations';
  const switcher = agents && agents.items.length > 1;
  const close = drawer && onClose && <Button size="icon-sm" variant="ghost" aria-label={library || libraryContent ? labels.closeNavigation : labels.closeSessions} title={labels.close} data-testid="sessions-close" onClick={onClose}><icons.closeSessions className="size-4" aria-hidden="true" /></Button>;
  return <>
    {drawer && <button type="button" tabIndex={-1} aria-hidden="true" data-testid="sessions-backdrop" onClick={onClose} className="fixed inset-0 z-40 cursor-default bg-black/40" />}
    <aside data-testid="conversations" data-drawer={drawer ? 'true' : 'false'} aria-label={title} {...(drawer ? { role: 'dialog', 'aria-modal': true } : {})}
      className={cn('pi-chat flex min-h-0 flex-col bg-background text-foreground', drawer
        ? 'fixed inset-y-0 left-0 z-50 w-[min(20rem,85vw)] border-r border-border shadow-xl pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]'
        : 'w-72 shrink-0 border-r border-border')}>
      {switcher && <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
        <label className="flex min-w-0 flex-1 items-center gap-2 text-xs text-muted-foreground">
          <span className="shrink-0">{labels.agent}</span>
          <select data-testid="agent-select" value={agents.activeId} onChange={event => agents.onSelect(event.target.value)}
            className="h-8 min-w-0 flex-1 cursor-pointer truncate rounded-md border border-border bg-background px-2 text-sm font-medium text-foreground">
            {agents.items.map(agent => <option key={agent.id} value={agent.id} title={agent.description}>{agent.label}</option>)}
          </select>
        </label>
        {close}
      </div>}
      <header className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
        {tabs
          ? <div role="tablist" aria-label={title} className="flex min-w-0 flex-1 items-center gap-0.5 rounded-lg bg-muted p-0.5">
              {(['conversations', 'library'] as const).map(tab => <button key={tab} type="button" role="tab" data-testid={`sessions-tab-${tab}`} aria-selected={shown === tab} onClick={() => onViewChange?.(tab)}
                className={cn('h-7 min-w-0 flex-1 cursor-pointer truncate rounded-md px-2 text-[13px] font-medium', shown === tab ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground')}>
                {tab === 'library' ? labels.library : title}
              </button>)}
            </div>
          : <h2 className="m-0 min-w-0 flex-1 truncate text-sm font-semibold tracking-tight">{title}</h2>}
        {conversations?.onNew && shown === 'conversations' && (tabs
          ? <Button size="icon-sm" variant="outline" data-testid="conversation-new" aria-label={labels.newChat} title={labels.newChat} onClick={() => { conversations.onNew?.(); picked(); }}><icons.newChat className="size-3.5" aria-hidden="true" /></Button>
          : <Button size="sm" variant="outline" data-testid="conversation-new" onClick={() => { conversations.onNew?.(); picked(); }}><icons.newChat className="size-3.5" aria-hidden="true" />{labels.newChat}</Button>)}
        {!switcher && close}
      </header>
      {library && <nav aria-label={labels.workspaceNavigation} className="flex shrink-0 flex-col gap-1 border-b border-border p-2">
        <Button variant="ghost" data-testid="workspace-chat-link" aria-current={!library.selected ? 'page' : undefined} className="justify-start" onClick={picked}><icons.chat className="size-4" aria-hidden="true" />{labels.chat}</Button>
        <Button variant="ghost" data-testid="workspace-library" aria-current={library.selected ? 'page' : undefined} className="justify-start" onClick={() => { library.onSelect(); if (drawer) onClose?.(); }}><icons.library className="size-4" aria-hidden="true" />{labels.library}</Button>
      </nav>}
      {shown === 'library' && libraryContent
        ? <div {...(tabs ? { role: 'tabpanel' } : {})} data-testid="sessions-library" className="flex min-h-0 flex-1 flex-col overflow-auto">{libraryContent(() => { if (drawer) onClose?.(); })}</div>
        : conversations && <ConversationList conversations={conversations} onPicked={picked} />}
    </aside>
  </>;
}

/** The chat header's button that shows or hides the sessions pane (opens the drawer on a narrow screen). */
export function SessionsToggle({ open, drawer, onToggle, navigation = false }: { readonly open: boolean; readonly drawer: boolean; readonly onToggle: () => void; readonly navigation?: boolean }) {
  const { labels, icons } = useAppText();
  const label = navigation ? drawer ? labels.openNavigation : open ? labels.hideNavigation : labels.showNavigation
    : drawer ? labels.openSessions : open ? labels.hideSessions : labels.showSessions;
  return <Button size="icon-sm" variant="ghost" data-testid="sessions-toggle" aria-label={label} title={label} aria-expanded={open} onClick={onToggle} className="-ml-1 shrink-0 text-muted-foreground">
    <icons.sessionsToggle className="size-4" aria-hidden="true" />
  </Button>;
}
