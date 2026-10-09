'use client';

import { useEffect } from 'react';
import { Button } from '../button/button';
import { useAppText } from './app-labels';
import { ConversationList } from '../pi-chat/pi-chat';
import type { ConversationsConfig } from '../pi-chat/pi-chat';
import { cn } from '../utils/utils';

/**
 * The sessions pane: a title with New, then the searchable conversation list of `pi-chat` (`ConversationList`: search, Archived filter,
 * rename, archive, delete). Docked at the left on a wide screen; a drawer over the page with a backdrop on a narrow one, closed by
 * Escape, the backdrop, the close button or choosing a conversation.
 */
export function SessionsPane({ conversations, title: givenTitle, drawer, onClose, library, onChat }: {
  readonly conversations?: ConversationsConfig | undefined;
  readonly library?: { readonly selected: boolean; readonly onSelect: () => void } | undefined;
  readonly onChat?: (() => void) | undefined;
  readonly title?: string;
  /** Rendered as a drawer (narrow screens). */
  readonly drawer: boolean;
  /** Closes the drawer; absent when docked. */
  readonly onClose?: (() => void) | undefined;
}) {
  const { labels, icons } = useAppText();
  const title = givenTitle ?? labels.sessionsTitle;
  useEffect(() => {
    if (!drawer || !onClose) return;
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape' && !event.defaultPrevented) onClose(); };
    document.addEventListener('keydown', escape);
    return () => document.removeEventListener('keydown', escape);
  }, [drawer, onClose]);
  const picked = () => { onChat?.(); if (drawer) onClose?.(); };
  return <>
    {drawer && <button type="button" tabIndex={-1} aria-hidden="true" data-testid="sessions-backdrop" onClick={onClose} className="fixed inset-0 z-40 cursor-default bg-black/40" />}
    <aside data-testid="conversations" data-drawer={drawer ? 'true' : 'false'} aria-label={title} {...(drawer ? { role: 'dialog', 'aria-modal': true } : {})}
      className={cn('pi-chat flex min-h-0 flex-col bg-background text-foreground', drawer
        ? 'fixed inset-y-0 left-0 z-50 w-[min(20rem,85vw)] border-r border-border shadow-xl pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]'
        : 'w-72 shrink-0 border-r border-border')}>
      <header className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
        <h2 className="m-0 min-w-0 flex-1 truncate text-sm font-semibold tracking-tight">{title}</h2>
        {conversations?.onNew && <Button size="sm" variant="outline" data-testid="conversation-new" onClick={() => { conversations.onNew!(); picked?.(); }}><icons.newChat className="size-3.5" aria-hidden="true" />{labels.newChat}</Button>}
        {drawer && onClose && <Button size="icon-sm" variant="ghost" aria-label={library ? labels.closeNavigation : labels.closeSessions} title={labels.close} data-testid="sessions-close" onClick={onClose}><icons.closeSessions className="size-4" aria-hidden="true" /></Button>}
      </header>
      {library && <nav aria-label={labels.workspaceNavigation} className="flex shrink-0 flex-col gap-1 border-b border-border p-2">
        <Button variant="ghost" data-testid="workspace-chat-link" aria-current={!library.selected ? 'page' : undefined} className="justify-start" onClick={picked}><icons.chat className="size-4" aria-hidden="true" />{labels.chat}</Button>
        <Button variant="ghost" data-testid="workspace-library" aria-current={library.selected ? 'page' : undefined} className="justify-start" onClick={() => { library.onSelect(); if (drawer) onClose?.(); }}><icons.library className="size-4" aria-hidden="true" />{labels.library}</Button>
      </nav>}
      {conversations && <ConversationList conversations={conversations} onPicked={picked} />}
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
