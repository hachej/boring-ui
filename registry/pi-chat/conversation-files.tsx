'use client';

import { useEffect, useState } from 'react';
import { FileTextIcon, ShapesIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Drawer, DrawerContent, DrawerTitle, DrawerTrigger } from '@/components/ui/drawer';
import { Popover, PopoverContent, PopoverHeader, PopoverTitle, PopoverTrigger } from '@/components/ui/popover';
import { useChatText } from './labels';

/** A conversation's observed file, opened only through the host's existing callback. */
export interface ConversationFile {
  readonly id: string;
  readonly name: string;
  readonly open: (() => void) | undefined;
}

/** Conversation files, not a second workspace: an anchored list on desktop and the installed drawer on phones. */
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
  if (!files.length) return null;
  const trigger = <Button variant="outline" data-testid="conversation-files" className="mb-3 max-w-full gap-2"><ShapesIcon data-icon="inline-start" aria-hidden="true" />{labels.artifacts}<span className="text-muted-foreground">· {files.length}</span></Button>;
  const content = <ul className="m-0 max-h-[60dvh] list-none overflow-y-auto">
    {files.map(file => <li key={file.id}><Button variant="ghost" disabled={!file.open} data-testid="conversation-file" data-file={file.id} className="w-full justify-start gap-2 text-start" onClick={() => { setOpen(false); file.open?.(); }}><FileTextIcon className="shrink-0" aria-hidden="true" /><span className="min-w-0 truncate">{file.name}</span></Button></li>)}
  </ul>;
  return phone ? <Drawer open={open} onOpenChange={setOpen} showSwipeHandle><DrawerTrigger render={trigger} /><DrawerContent data-testid="conversation-files-list" className="pi-chat max-h-[80dvh]"><DrawerTitle>{labels.artifacts}</DrawerTitle><div className="pb-[env(safe-area-inset-bottom)]">{content}</div></DrawerContent></Drawer>
    : <Popover open={open} onOpenChange={setOpen}><PopoverTrigger render={trigger} /><PopoverContent side="top" align="start" sideOffset={8} data-testid="conversation-files-list" aria-label={labels.artifacts} onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setOpen(false); } }} className="pi-chat w-80 max-w-[calc(100vw-32px)]"><PopoverHeader><PopoverTitle>{labels.artifacts}</PopoverTitle></PopoverHeader>{content}</PopoverContent></Popover>;
}
