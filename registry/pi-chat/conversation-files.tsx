'use client';

import { useEffect, useState } from 'react';
import { FileTextIcon, ShapesIcon } from '../_shared/icons';
import { Button } from '@/components/ui/button';
import { Drawer, DrawerContent, DrawerTitle, DrawerTrigger } from '@/components/ui/drawer';
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { useChatText } from './labels';
import { usePhone } from '../utils/use-media';

/** A conversation's observed file, opened only through the host's existing callback. */
export type { ConversationFile } from '@hachej/boring-ui-kit/chat-react';
import type { ConversationFile } from '@hachej/boring-ui-kit/chat-react';

/**
 * Conversation files, not a second workspace: the native menu on desktop and the installed drawer on phones. With `attach` (the shell's one
 * composer, D-2198) the same menu opens from the composer's paperclip (`icon`) and starts with « Joindre des fichiers… »: one files menu, no second list.
 */
export function ConversationFiles({ files, attach, icon = false, disabled = false }: { readonly files: readonly ConversationFile[]; readonly attach?: (() => void) | undefined; readonly icon?: boolean; readonly disabled?: boolean }) {
  const { labels, icons } = useChatText();
  const [open, setOpen] = useState(false);
  const phone = usePhone();
  // eslint-disable-next-line react-hooks/set-state-in-effect -- switching presentation closes the old menu once, after commit
  useEffect(() => { setOpen(false); }, [phone]);
  const available = files.filter(file => file.open);
  if (!available.length) return null;
  const listTrigger = <Button variant="outline" data-testid="conversation-files" className="mb-3 max-w-full gap-2"><ShapesIcon data-icon="inline-start" aria-hidden="true" />{labels.artifacts}<span className="text-muted-foreground">· {available.length}</span></Button>;
  const trigger = icon
    ? <Button variant="ghost" size="icon" data-testid="composer-bar-attach" aria-label={labels.artifacts} title={labels.artifacts} disabled={disabled}><icons.attach data-icon="inline-start" aria-hidden="true" /></Button>
    : listTrigger;
  const attachItem = (Item: 'menu' | 'drawer') => attach ? Item === 'menu'
    ? <><DropdownMenuItem data-testid="composer-attach" className="min-h-8 pointer-coarse:min-h-12" onClick={() => { setOpen(false); attach(); }}><icons.attach data-icon="inline-start" aria-hidden="true" />{labels.attachFiles}</DropdownMenuItem><DropdownMenuSeparator /></>
    : <li className="flex min-h-12"><Button variant="ghost" size="sm" data-testid="composer-attach" className="w-full justify-start" onClick={() => { setOpen(false); attach(); }}><icons.attach data-icon="inline-start" aria-hidden="true" />{labels.attachFiles}</Button></li> : null;
  const label = (file: ConversationFile) => <><FileTextIcon data-icon="inline-start" className="shrink-0" aria-hidden="true" /><span className="min-w-0 truncate">{file.name}</span></>;
  const select = (file: ConversationFile) => { setOpen(false); file.open?.(); };
  return phone ? <Drawer open={open} onOpenChange={setOpen} showSwipeHandle><DrawerTrigger render={trigger} /><DrawerContent data-testid="conversation-files-list" className="pi-chat max-h-[80dvh]">
    <div className="flex min-h-0 flex-col px-2 pt-2 pb-[env(safe-area-inset-bottom)]"><div className="px-2"><DrawerTitle className="m-0">{labels.artifacts}</DrawerTitle></div>
      <ul className="m-0 max-h-[60dvh] list-none overflow-y-auto p-0">{attachItem('drawer')}{available.map(file => <li key={file.id} className="flex min-h-12"><Button variant="ghost" size="sm" data-testid="conversation-file" data-file={file.id} className="h-auto w-full justify-start gap-2 text-start" onClick={() => select(file)}>{label(file)}</Button></li>)}</ul>
    </div></DrawerContent></Drawer>
    : <DropdownMenu open={open} onOpenChange={setOpen}><DropdownMenuTrigger render={trigger} /><DropdownMenuContent side="top" align="start" sideOffset={6} data-testid="conversation-files-list" aria-label={labels.artifacts} onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setOpen(false); } }} className="pi-chat w-80 max-w-[calc(100vw-32px)]">
      {attachItem('menu')}<DropdownMenuGroup className="max-h-[60dvh] overflow-y-auto"><DropdownMenuLabel>{labels.artifacts}</DropdownMenuLabel>
        {available.map(file => <DropdownMenuItem key={file.id} data-testid="conversation-file" data-file={file.id} className="min-h-8 pointer-coarse:min-h-12" onClick={() => select(file)}>{label(file)}</DropdownMenuItem>)}
      </DropdownMenuGroup></DropdownMenuContent></DropdownMenu>;
}
