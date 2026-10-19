'use client';

// The compact top bar of `AgentWorkspace layout="embedded"`: the conversation title, then History, Library and New as icon buttons
// (History and Library open a popover on a wide workspace and a bottom sheet on a phone) and the host's controls. Inside an app-shell
// screen the controls go into the shell's header instead (`useScreenHeaderSlot`), so the page keeps one row. Host concern: Pi has no layout.
import { useState } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { XIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Drawer, DrawerContent, DrawerTitle } from '@/components/ui/drawer';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Separator } from '@/components/ui/separator';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { ConversationList } from '../pi-chat/history';
import type { ConversationsConfig } from '../pi-chat/config';
import type { BlockIcon } from '../button/actions';
import { useScreenHeaderSlot } from '../utils/screen-header-slot';
import { cn } from '../utils/utils';
import { useAppText } from './app-labels';

/** 44px on a phone (`narrow`), the bar's 32px otherwise. */
const iconSize = (narrow: boolean) => cn(narrow && 'size-11');

/** A hover and focus tooltip on a wide workspace; a phone has no hover, and focus coming back from a sheet must not raise one. */
function Hinted({ label, trigger, narrow }: { readonly label: string; readonly trigger: ReactElement; readonly narrow: boolean }) {
  if (narrow) return trigger;
  return <Tooltip><TooltipTrigger render={trigger} /><TooltipContent>{label}</TooltipContent></Tooltip>;
}

/** One icon button that opens `children`: an anchored popover on a wide workspace, a bottom sheet on a phone. */
function BarPanel({ id, label, icon: Icon, narrow, open, onOpenChange, children }: {
  readonly id: string;
  readonly label: string;
  readonly icon: BlockIcon;
  readonly narrow: boolean;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly children: ReactNode;
}) {
  const button = <Button variant="ghost" size="icon" data-testid={`workspace-bar-${id}`} aria-label={label} className={iconSize(narrow)}><Icon aria-hidden="true" /></Button>;
  if (narrow) return <>
    <Button variant="ghost" size="icon" data-testid={`workspace-bar-${id}`} aria-label={label} aria-haspopup="dialog" aria-expanded={open} className={iconSize(narrow)} onClick={() => onOpenChange(true)}><Icon aria-hidden="true" /></Button>
    <Drawer open={open} onOpenChange={onOpenChange} showSwipeHandle>
      <DrawerContent data-testid={`workspace-${id}`} aria-label={label} className="pi-chat min-h-[50dvh] max-h-[85dvh]">
        <DrawerTitle className="sr-only">{label}</DrawerTitle>
        <div className="flex min-h-0 flex-1 flex-col pb-[env(safe-area-inset-bottom)]">{children}</div>
      </DrawerContent>
    </Drawer>
  </>;
  return <Popover open={open} onOpenChange={onOpenChange}>
    <Hinted label={label} narrow={false} trigger={<PopoverTrigger render={button} />} />
    <PopoverContent data-testid={`workspace-${id}`} aria-label={label} align="end" className="pi-chat w-[23rem] max-w-[calc(100vw-1rem)] max-h-[min(34rem,70dvh)]">{children}</PopoverContent>
  </Popover>;
}

export interface WorkspaceBarProps {
  readonly title: string;
  /** Muted after a fixed `title`: the conversation's title. Hidden on a phone, where History names the conversations. */
  readonly subtitle?: string | undefined;
  readonly conversations: ConversationsConfig | undefined;
  /** The Library's list (`onPicked` closes the popover or sheet), or undefined without a Library. */
  readonly library: ((onPicked: () => void) => ReactNode) | undefined;
  /** A phone-sized workspace: sheets instead of popovers, 44px buttons. */
  readonly narrow: boolean;
  /** The host's own controls, after New. */
  readonly controls?: ReactNode;
}

/** The bar, or only its controls in the app shell's header when the page sits in a shell screen (then nothing renders here). */
export function WorkspaceBar({ title, subtitle, conversations, library, narrow, controls }: WorkspaceBarProps) {
  const { labels, icons } = useAppText();
  const slot = useScreenHeaderSlot();
  const [shown, setShown] = useState<'history' | 'library' | null>(null);
  const toggle = (which: 'history' | 'library') => (open: boolean) => setShown(open ? which : current => current === which ? null : current);
  const close = () => setShown(null);
  const tools = <div data-testid="workspace-bar-tools" className="flex shrink-0 items-center gap-0.5">
    {conversations && <BarPanel id="history" label={labels.history} icon={icons.history} narrow={narrow} open={shown === 'history'} onOpenChange={toggle('history')}>
      <header className="flex shrink-0 items-center gap-2 pl-1">
        <h3 className="m-0 min-w-0 flex-1 truncate text-sm font-semibold">{labels.history}</h3>
        <Button variant="ghost" size="icon-sm" aria-label={labels.close} title={labels.close} className={iconSize(narrow)} onClick={close}><XIcon aria-hidden="true" /></Button>
      </header>
      <Separator />
      <div className="flex min-h-0 flex-1 flex-col"><ConversationList conversations={conversations} onPicked={close} /></div>
    </BarPanel>}
    {library && <BarPanel id="library" label={labels.library} icon={icons.library} narrow={narrow} open={shown === 'library'} onOpenChange={toggle('library')}>
      <div className="min-h-0 flex-1 overflow-auto">{library(close)}</div>
    </BarPanel>}
    {conversations?.onNew && <Hinted label={labels.newChat} narrow={narrow} trigger={<Button variant="ghost" size="icon" data-testid="workspace-bar-new" aria-label={labels.newChat} className={iconSize(narrow)} onClick={() => conversations.onNew?.()}><icons.newChat aria-hidden="true" /></Button>} />}
    {controls}
  </div>;
  if (slot) return createPortal(tools, slot);
  return <header data-testid="workspace-bar" className="flex h-13 shrink-0 items-center gap-1 pr-2 pl-4 max-[640px]:h-14 max-[640px]:pl-3">
    <div className="flex min-w-0 flex-1 items-baseline gap-2">
      <h2 data-testid="workspace-bar-title" className={cn('m-0 min-w-0 truncate text-sm font-medium tracking-tight', subtitle === undefined && 'flex-1')}>{title}</h2>
      {subtitle !== undefined && <span data-testid="workspace-bar-conversation" className="min-w-0 flex-1 truncate text-sm text-muted-foreground max-sm:hidden">{subtitle}</span>}
    </div>
    {tools}
  </header>;
}
