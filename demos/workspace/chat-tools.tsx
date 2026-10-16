import { useEffect, useRef, useState } from 'react';
import { Popover } from '@base-ui/react/popover';
import { FolderOpenIcon, HistoryIcon, PlusIcon, XIcon } from 'lucide-react';
import { FileTree } from '@hachej/boring-ui-kit/file-tree-view';
import { ConversationList } from '../../registry/pi-chat/history';
import { Button } from '../../registry/button/button';
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
  const body = id => id === 'history' ? conversations ? <ConversationList conversations={conversations} autoFocus onPicked={() => setPanel(null)} /> : <p role="status" className="p-4 text-sm text-muted-foreground">Loading…</p> : provider ? <div className="min-h-48 flex-1 overflow-auto"><FileTree variant="list" refresh={false} upload={false} history={false} revisionProvider={provider} refreshKey={feed} selectedPath={file} onOpen={path => { if (openFile(path)) { picked.current = true; setPanel(null); focusAfterSelection(); } }} /></div> : <p role="status" className="p-4 text-sm text-muted-foreground">Loading…</p>;
  if (phone) return <div className="flex shrink-0 items-center gap-0.5" data-testid="chat-tools">
    {([['history', 'History', HistoryIcon], ['library', 'Library', FolderOpenIcon]] as const).map(([id, title, Icon]) => <Button key={id} ref={id === 'library' ? libraryTrigger : undefined} variant="ghost" size="icon" data-testid={`chat-action-${id}`} aria-label={title} onClick={() => setPanel(id)}><Icon className="size-4" aria-hidden="true" /></Button>)}
    <Drawer open={panel !== null} showSwipeHandle onOpenChange={next => { if (!next) setPanel(null); }}><DrawerContent ref={popup} data-testid={panel === 'history' ? 'conversations' : 'library-popover'} className="pi-chat h-[80dvh] pb-[env(safe-area-inset-bottom)] duration-200 motion-reduce:transition-none"><DrawerTitle className="px-5 py-3">{panel === 'history' ? 'Conversations' : 'Library'}</DrawerTitle>{panel && body(panel)}</DrawerContent></Drawer>
  </div>;
  return <div className="flex shrink-0 items-center gap-0.5" data-testid="chat-tools">
    {([['history', 'History', HistoryIcon], ['library', 'Library', FolderOpenIcon]] as const).map(([id, title, Icon]) => <Popover.Root key={id} open={panel === id} onOpenChange={open => { if (open) picked.current = false; setPanel(current => open ? id : current === id ? null : current); }}>
      <Popover.Trigger ref={id === 'library' ? libraryTrigger : undefined} render={<Button size="icon" variant="ghost" />} data-testid={`chat-action-${id}`} aria-label={title} title={title} className="size-11 text-muted-foreground"><Icon className="size-4" aria-hidden="true" /></Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner side="bottom" align="end" sideOffset={8} collisionPadding={8} className="z-[70]">
          <Popover.Popup ref={panel === id ? popup : undefined} data-testid={id === 'history' ? 'conversations' : 'library-popover'}
            initialFocus={type => type === 'touch' ? false : popup.current?.querySelector('input[type=search]') ?? true}
            finalFocus={() => picked.current || panel !== null && panel !== id ? false : true}
            onKeyDown={event => { if (event.key === 'Escape') event.stopPropagation(); }}
            className="pi-chat flex max-h-[min(32rem,var(--available-height))] w-[min(24rem,calc(100vw-1rem))] flex-col overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground shadow-lg outline-none">
            <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border px-3">
              <Popover.Title className="min-w-0 flex-1 text-sm font-semibold">{id === 'history' ? 'Conversations' : 'Library'}</Popover.Title>
              {id === 'history' && conversations?.onNew && <Button size="sm" variant="outline" data-testid="conversation-new" onClick={() => { conversations.onNew(); setPanel(null); }}><PlusIcon className="size-3.5" aria-hidden="true" />New</Button>}
              <Popover.Close render={<Button size="icon" variant="ghost" />} aria-label={`Close ${title}`} className="size-11"><XIcon className="size-4" aria-hidden="true" /></Popover.Close>
            </header>
            {body(id)}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>)}
  </div>;
}
