'use client';

import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Drawer, DrawerContent, DrawerTitle } from '@/components/ui/drawer';
import { DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { ScrollArea } from '@/components/ui/scroll-area';
import { ChevronsUpDownIcon, MenuIcon } from 'lucide-react';
import { useAppText } from './app-labels';
import { ConversationList } from '../pi-chat/pi-chat';
import type { ConversationsConfig } from '../pi-chat/pi-chat';
import { cn } from '../utils/utils';

export interface WorkspaceAgent { readonly id: string; readonly label: string; readonly description?: string | undefined }
export interface WorkspaceAgents { readonly items: readonly WorkspaceAgent[]; readonly activeId: string; readonly onSelect: (id: string) => void }
export type SessionsView = 'conversations' | 'library';

/** The same navigation in a desktop column and a focus-trapped, swipe-dismissable phone drawer. */
export function SessionsPane({ id, conversations, title: givenTitle, drawer, onClose, onCollapse, library, onChat, libraryContent, view = 'conversations', onViewChange, agents }: {
  /** The pane's element id (the toggle's `aria-controls`). */
  readonly id?: string | undefined;
  readonly conversations?: ConversationsConfig | undefined;
  readonly library?: { readonly selected: boolean; readonly onSelect: () => void; readonly side?: boolean } | undefined;
  readonly onChat?: (() => void) | undefined;
  readonly libraryContent?: ((onPicked: () => void) => ReactNode) | undefined;
  readonly view?: SessionsView | undefined;
  readonly onViewChange?: ((view: SessionsView) => void) | undefined;
  readonly agents?: WorkspaceAgents | undefined;
  readonly title?: string;
  readonly drawer: boolean;
  readonly onClose?: (() => void) | undefined;
  readonly onCollapse?: (() => void) | undefined;
}) {
  const { labels, icons } = useAppText();
  const title = givenTitle ?? (conversations || !libraryContent ? labels.sessionsTitle : labels.library);
  const picked = () => { onChat?.(); if (drawer) onClose?.(); };
  const tabs = Boolean(libraryContent && conversations);
  const shown = !conversations && libraryContent ? 'library' : tabs ? view : 'conversations';
  const navigation = library && <Button variant="ghost" data-testid="workspace-library" aria-pressed={library.selected} className="mx-2 justify-start" onClick={() => { library.onSelect(); if (drawer) onClose?.(); }}><icons.library aria-hidden="true" />{labels.library}</Button>;
  const pane = <aside id={id} data-testid="conversations" data-drawer={drawer ? 'true' : 'false'} aria-label={title}
    className={cn('pi-chat flex min-h-0 flex-1 flex-col bg-muted/30 text-foreground', drawer ? 'pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]' : 'w-[260px] shrink-0 flex-none')}>
    <header className="flex h-13 shrink-0 items-center gap-2 px-4">
      {agents && agents.items.length > 1 ? <DropdownMenu>
        <DropdownMenuTrigger render={<Button variant="ghost" aria-label={labels.agent} data-testid="agent-select" className="min-w-0 flex-1 justify-between" />}>
          <span className="truncate">{(agents.items.find(agent => agent.id === agents.activeId) ?? agents.items[0])?.label}</span><ChevronsUpDownIcon data-icon="inline-end" aria-hidden="true" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" aria-label={labels.agent}>
          <DropdownMenuRadioGroup value={agents.activeId} onValueChange={agents.onSelect}>
            {agents.items.map(agent => <DropdownMenuRadioItem key={agent.id} value={agent.id} title={agent.description} data-testid={`agent-option-${agent.id}`}>{agent.label}</DropdownMenuRadioItem>)}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu> : <h2 className="m-0 min-w-0 flex-1 truncate text-sm font-semibold tracking-tight">{agents?.items[0]?.label ?? title}</h2>}
      {(drawer ? onClose : onCollapse) && <SessionsToggle open drawer={drawer} navigation={Boolean(library || libraryContent)} onToggle={(drawer ? onClose : onCollapse)!} />}
    </header>
    {conversations?.onNew && <Button variant="ghost" data-testid="conversation-new" className="mx-2 mb-1 justify-start" onClick={() => { conversations.onNew?.(); picked(); }}><icons.newChat data-icon="inline-start" aria-hidden="true" />{labels.newChat}</Button>}
    {tabs && <div role="tablist" aria-label={title} className="mx-2 flex gap-1">{(['conversations', 'library'] as const).map(tab => <Button key={tab} role="tab" variant="ghost" aria-selected={shown === tab} data-testid={`sessions-tab-${tab}`} onClick={() => onViewChange?.(tab)}>{tab === 'library' ? labels.library : title}</Button>)}</div>}
    {shown === 'library' && libraryContent ? <ScrollArea data-testid="sessions-library" className="min-h-0 flex-1">{libraryContent(() => { if (drawer) onClose?.(); })}</ScrollArea>
      : conversations ? <ConversationList conversations={conversations} onPicked={picked} navigation={navigation} /> : navigation}
  </aside>;
  if (!drawer) return pane;
  return <Drawer open onOpenChange={next => { if (!next) onClose?.(); }} swipeDirection="left">
    <DrawerContent aria-label={title}>
      <DrawerTitle className="sr-only">{title}</DrawerTitle>{pane}
    </DrawerContent>
  </Drawer>;
}

export function SessionsToggle({ open, drawer, onToggle, navigation = false, controls }: { readonly open: boolean; readonly drawer: boolean; readonly onToggle: () => void; readonly navigation?: boolean; readonly controls?: string | undefined }) {
  const { labels, icons } = useAppText();
  const label = navigation ? drawer ? open ? labels.closeNavigation : labels.openNavigation : open ? labels.hideNavigation : labels.showNavigation
    : drawer ? open ? labels.closeSessions : labels.openSessions : open ? labels.hideSessions : labels.showSessions;
  return <Button size="icon-sm" variant="ghost" data-testid="sessions-toggle" aria-label={label} title={label} aria-expanded={open} aria-controls={controls} onClick={onToggle} className="shrink-0">
    {drawer && !open ? <MenuIcon data-icon="inline-start" aria-hidden="true" /> : <icons.sessionsToggle data-icon="inline-start" aria-hidden="true" />}
  </Button>;
}
