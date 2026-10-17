import { useEffect, useRef, useState } from 'react';
import { FolderOpenIcon, HistoryIcon, PlusIcon, XIcon } from 'lucide-react';
import { FileTree } from '../../registry/file-tree/file-tree';
import { ConversationList } from '../../registry/pi-chat/history';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from '@/components/ui/popover';
import { Drawer, DrawerContent, DrawerTitle } from '../../examples/app-shell/components/ui/drawer';

export function ChatTools({ conversations, provider, file, openFile, feed }) {
  const [panel, setPanel] = useState<'history' | 'library' | null>(null);
  const [phone, setPhone] = useState(() => matchMedia('(max-width: 640px)').matches);
  useEffect(() => { const media = matchMedia('(max-width: 640px)'); const change = () => setPhone(media.matches); media.addEventListener('change', change); return () => media.removeEventListener('change', change); }, []);
  const popup = useRef<HTMLDivElement>(null);
  const libraryTrigger = useRef<HTMLButtonElement>(null);
  const picked = useRef(false);
  const focusAfterSelection = () => {
    // Opening a file can hide or unmount the trigger, so resolve focus after that layout commits.
    requestAnimationFrame(() => {
      const trigger = libraryTrigger.current;
      const target = trigger?.checkVisibility() ? trigger : document.querySelector<HTMLElement>('[data-testid=library-document]');
      target?.focus({ preventScroll: true });
    });
  };
  useEffect(() => {
    if (panel !== 'library' || !provider) return;
    let frame = 0;
    const focus = () => {
      const input = popup.current?.querySelector<HTMLInputElement>('input[type=search]');
      if (input) input.focus({ preventScroll: true });
      else frame = requestAnimationFrame(focus);
    };
    focus();
    return () => cancelAnimationFrame(frame);
  }, [panel, provider]);
  const body = id => id === 'history' ? conversations ? <ConversationList conversations={conversations} autoFocus onPicked={() => setPanel(null)} /> : <p role="status" className="p-4 text-sm text-muted-foreground">Loading…</p> : provider ? <div className="min-h-48 flex-1 overflow-auto"><FileTree variant="list" refresh={false} onClose={() => setPanel(null)} revisionProvider={provider} refreshKey={feed} historyKey={feed} selectedPath={file} onOpen={path => { if (openFile(path)) { picked.current = true; setPanel(null); focusAfterSelection(); } }} /></div> : <p role="status" className="p-4 text-sm text-muted-foreground">Loading…</p>;
  if (phone) return <div className="flex shrink-0 items-center gap-0.5" data-testid="chat-tools">
    {([['history', 'History', HistoryIcon], ['library', 'Library', FolderOpenIcon]] as const).map(([id, title, Icon]) => <Button key={id} ref={id === 'library' ? libraryTrigger : undefined} variant="ghost" size="icon" data-testid={`chat-action-${id}`} aria-label={title} onClick={() => setPanel(id)}><Icon aria-hidden="true" /></Button>)}
    <Drawer open={panel !== null} showSwipeHandle onOpenChange={next => { if (!next) setPanel(null); }}><DrawerContent ref={popup} data-testid={panel === 'history' ? 'conversations' : 'library-popover'} className="pi-chat h-[80dvh] pb-[env(safe-area-inset-bottom)] duration-200 motion-reduce:transition-none"><DrawerTitle className={panel === 'library' ? 'sr-only' : 'px-5 py-3'}>{panel === 'history' ? 'Conversations' : 'Library'}</DrawerTitle>{panel && body(panel)}</DrawerContent></Drawer>
  </div>;
  return <div className="flex shrink-0 items-center gap-0.5" data-testid="chat-tools">
    {([['history', 'History', HistoryIcon], ['library', 'Library', FolderOpenIcon]] as const).map(([id, title, Icon]) => <Popover key={id} open={panel === id} onOpenChange={open => { if (open) picked.current = false; setPanel(current => open ? id : current === id ? null : current); }}>
      <PopoverTrigger ref={id === 'library' ? libraryTrigger : undefined} render={<Button size="icon" variant="ghost" />} data-testid={`chat-action-${id}`} aria-label={title} title={title} className="size-11 text-muted-foreground"><Icon className="size-4" aria-hidden="true" /></PopoverTrigger>
      <PopoverContent ref={panel === id ? popup : undefined} side="bottom" align="end" sideOffset={8} data-testid={id === 'history' ? 'conversations' : 'library-popover'}
        initialFocus={type => type === 'touch' ? false : popup.current?.querySelector('input[type=search]') ?? true}
        finalFocus={() => picked.current || panel !== null && panel !== id ? false : true}
        onKeyDown={event => { if (event.key === 'Escape') event.stopPropagation(); }}
        className="pi-chat max-h-[min(32rem,var(--available-height))] w-[min(24rem,calc(100vw-1rem))] gap-0 overflow-hidden p-0">
        {id === 'library' ? <PopoverTitle className="sr-only">Library</PopoverTitle> : <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border px-3">
          <PopoverTitle className="min-w-0 flex-1">{id === 'history' ? 'Conversations' : 'Library'}</PopoverTitle>
          {id === 'history' && conversations?.onNew && <Button size="sm" variant="outline" data-testid="conversation-new" onClick={() => { conversations.onNew(); setPanel(null); }}><PlusIcon data-icon="inline-start" aria-hidden="true" />New</Button>}
          <Button size="icon" variant="ghost" aria-label={`Close ${title}`} className="size-11" onClick={() => setPanel(null)}><XIcon className="size-4" aria-hidden="true" /></Button>
        </header>}
        {body(id)}
      </PopoverContent>
    </Popover>)}
  </div>;
}
