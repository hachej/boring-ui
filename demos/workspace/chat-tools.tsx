import { useEffect, useRef, useState } from 'react';
import { Popover } from '@base-ui/react/popover';
import { FolderOpenIcon, HistoryIcon, PlusIcon, XIcon } from 'lucide-react';
import { FileTree } from '@hachej/boring-ui-kit/file-tree-view';
import { ConversationList } from '../../registry/pi-chat/history';
import { Button } from '../../registry/button/button';

export function ChatTools({ conversations, provider, file, openFile, feed }) {
  const [panel, setPanel] = useState<'history' | 'library' | null>(null);
  const popup = useRef<HTMLDivElement>(null);
  const picked = useRef(false);
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
  return <div className="flex shrink-0 items-center gap-0.5" data-testid="chat-tools">
    {([['history', 'History', HistoryIcon], ['library', 'Library', FolderOpenIcon]] as const).map(([id, title, Icon]) => <Popover.Root key={id} open={panel === id} onOpenChange={open => { picked.current = false; setPanel(open ? id : null); }}>
      <Popover.Trigger render={<Button size="icon" variant="ghost" />} data-testid={`chat-action-${id}`} aria-label={title} title={title} className="size-11 text-muted-foreground"><Icon className="size-4" aria-hidden="true" /></Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner side="bottom" align="end" sideOffset={8} collisionPadding={8} className="z-[70]">
          <Popover.Popup ref={panel === id ? popup : undefined} data-testid={id === 'history' ? 'conversations' : 'library-popover'}
            initialFocus={type => type === 'touch' ? false : popup.current?.querySelector('input[type=search]') ?? true}
            finalFocus={() => picked.current ? false : true}
            onKeyDown={event => { if (event.key === 'Escape') event.stopPropagation(); }}
            className="pi-chat flex max-h-[min(32rem,var(--available-height))] w-[min(24rem,calc(100vw-1rem))] flex-col overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground shadow-lg outline-none">
            <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border px-3">
              <Popover.Title className="min-w-0 flex-1 text-sm font-semibold">{id === 'history' ? 'Conversations' : 'Library'}</Popover.Title>
              {id === 'history' && conversations?.onNew && <Button size="sm" variant="outline" data-testid="conversation-new" onClick={() => { conversations.onNew(); setPanel(null); }}><PlusIcon className="size-3.5" aria-hidden="true" />New</Button>}
              <Popover.Close render={<Button size="icon" variant="ghost" />} aria-label={`Close ${title}`} className="size-11"><XIcon className="size-4" aria-hidden="true" /></Popover.Close>
            </header>
            {id === 'history' ? conversations ? <ConversationList conversations={conversations} onPicked={() => setPanel(null)} /> : <p role="status" className="p-4 text-sm text-muted-foreground">Loading…</p> : provider ? <div className="min-h-48 flex-1 overflow-auto"><FileTree variant="list" refresh={false} upload={false} history={false} revisionProvider={provider} refreshKey={feed} selectedPath={file} onOpen={path => { if (openFile(path)) { picked.current = true; setPanel(null); } }} /></div> : <p role="status" className="p-4 text-sm text-muted-foreground">Loading…</p>}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>)}
  </div>;
}
