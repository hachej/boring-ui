'use client';

import { useEffect, useState } from 'react';
import { Popover } from '@base-ui/react/popover';
import { FileTextIcon, ShapesIcon } from 'lucide-react';
import { Drawer, DrawerContent, DrawerTitle, DrawerTrigger } from '../drawer/drawer';
import { Button } from '@/components/ui/button';
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
  const content = <ul className="m-0 max-h-[60dvh] list-none overflow-y-auto p-2">
    {files.map(file => <li key={file.id}><Button variant="ghost" disabled={!file.open} data-testid="conversation-file" data-file={file.id} className="h-10 w-full justify-start gap-2 px-3 max-sm:h-11 pointer-coarse:h-11" onClick={() => { setOpen(false); file.open?.(); }}><FileTextIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" /><span className="min-w-0 truncate">{file.name}</span></Button></li>)}
  </ul>;
  return phone ? <Drawer open={open} onOpenChange={setOpen} showSwipeHandle><DrawerTrigger render={trigger} /><DrawerContent data-testid="conversation-files-list" className="pi-chat max-h-[80dvh] pb-[env(safe-area-inset-bottom)]"><DrawerTitle className="px-5 py-3 text-base">{labels.artifacts}</DrawerTitle>{content}</DrawerContent></Drawer>
    : <Popover.Root open={open} onOpenChange={setOpen}><Popover.Trigger render={trigger} /><Popover.Portal><Popover.Positioner side="top" align="start" sideOffset={8} className="z-50"><Popover.Popup data-testid="conversation-files-list" aria-label={labels.artifacts} onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setOpen(false); } }} className="pi-chat w-80 max-w-[calc(100vw-32px)] overflow-hidden rounded-2xl border border-border bg-popover text-popover-foreground shadow-lg outline-none"><h3 className="m-0 px-5 pt-4 pb-2 text-sm font-semibold">{labels.artifacts}</h3>{content}</Popover.Popup></Popover.Positioner></Popover.Portal></Popover.Root>;
}
