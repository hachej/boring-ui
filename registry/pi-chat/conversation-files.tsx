'use client';

import { useEffect, useState } from 'react';
import { FileTextIcon, ShapesIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Drawer, DrawerContent, DrawerTitle, DrawerTrigger } from '@/components/ui/drawer';
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { useChatText } from './labels';

/** A conversation's observed file, opened only through the host's existing callback. */
export type { ConversationFile } from '@hachej/boring-ui-kit/chat-react';
import type { ConversationFile } from '@hachej/boring-ui-kit/chat-react';

/** Conversation files, not a second workspace: the native menu on desktop and the installed drawer on phones. */
export function ConversationFiles({ files }: { readonly files: readonly ConversationFile[] }) {
  const { labels } = useChatText();
  const [open, setOpen] = useState(false);
  const [phone, setPhone] = useState(() => globalThis.matchMedia?.('(max-width: 640px)').matches === true);
  useEffect(() => {
    const media = globalThis.matchMedia?.('(max-width: 640px)');
    if (!media) return;
    const change = () => { setPhone(media.matches); setOpen(false); };
    media.addEventListener('change', change);
    return () => media.removeEventListener('change', change);
  }, []);
  const available = files.filter(file => file.open);
  if (!available.length) return null;
  const trigger = <Button variant="outline" data-testid="conversation-files" className="mb-3 max-w-full gap-2"><ShapesIcon data-icon="inline-start" aria-hidden="true" />{labels.artifacts}<span className="text-muted-foreground">· {available.length}</span></Button>;
  const label = (file: ConversationFile) => <><FileTextIcon data-icon="inline-start" className="shrink-0" aria-hidden="true" /><span className="min-w-0 truncate">{file.name}</span></>;
  const select = (file: ConversationFile) => { setOpen(false); file.open?.(); };
  return phone ? <Drawer open={open} onOpenChange={setOpen} showSwipeHandle><DrawerTrigger render={trigger} /><DrawerContent data-testid="conversation-files-list" className="pi-chat max-h-[80dvh]">
    <div className="flex min-h-0 flex-col px-2 pt-2 pb-[env(safe-area-inset-bottom)]"><div className="px-2"><DrawerTitle className="m-0">{labels.artifacts}</DrawerTitle></div>
      <ul className="m-0 max-h-[60dvh] list-none overflow-y-auto p-0">{available.map(file => <li key={file.id} className="flex min-h-12"><Button variant="ghost" size="sm" data-testid="conversation-file" data-file={file.id} className="h-auto w-full justify-start gap-2 text-start" onClick={() => select(file)}>{label(file)}</Button></li>)}</ul>
    </div></DrawerContent></Drawer>
    : <DropdownMenu open={open} onOpenChange={setOpen}><DropdownMenuTrigger render={trigger} /><DropdownMenuContent side="top" align="start" sideOffset={6} data-testid="conversation-files-list" aria-label={labels.artifacts} onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setOpen(false); } }} className="pi-chat w-80 max-w-[calc(100vw-32px)]">
      <DropdownMenuGroup className="max-h-[60dvh] overflow-y-auto"><DropdownMenuLabel>{labels.artifacts}</DropdownMenuLabel>
        {available.map(file => <DropdownMenuItem key={file.id} data-testid="conversation-file" data-file={file.id} className="min-h-8 pointer-coarse:min-h-12" onClick={() => select(file)}>{label(file)}</DropdownMenuItem>)}
      </DropdownMenuGroup></DropdownMenuContent></DropdownMenu>;
}
