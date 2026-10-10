// The browser side of the dock example: the host's own app in `DockMain`, an agent chat in a `Dock` on its left and a files `Dock` on its right.
// The chat docked is `PiChat`; floating it is `AmbientChat` on the same controller (draft, transcript and stream carry over). A button in the
// chat header opens the files dock through `useDock('files')`; on a phone that dock is a full-screen sheet. Layout comes from `pi-workspace/dock.tsx`.
// @ts-nocheck: an example page, bundled by esbuild and not part of the typechecked sources.
import { createRoot } from 'react-dom/client';
import { Dock, DockLayout, DockMain, useDock } from '../../registry/pi-workspace/dock.tsx';
import { PiChat } from '../../registry/pi-chat/pi-chat.tsx';
import { AmbientChat } from '../../registry/pi-ambient/ambient.tsx';
import { useRemoteChat } from '../../registry/pi-app/use-remote-chat.ts';

const { token, identity, conversation } = window.__APP__;
const authorized = (request: Request) => { const headers = new Headers(request.headers); headers.set('authorization', `Bearer ${token}`); return fetch(new Request(request, { headers })); };

const ROWS = [
  { day: 'Mon', title: 'Market visit', note: 'Bought plums and a loaf of rye.' },
  { day: 'Wed', title: 'Long walk', note: 'Followed the invented Linden Canal to the old mill.' },
  { day: 'Fri', title: 'New recipe', note: 'Lentil soup with lemon, enough for four.' },
];
const FILES = ['journal/2031-week-14.md', 'journal/2031-week-15.md', 'journal/recipes/lentil-soup.md', 'journal/photos/canal.jpg'];

/** The host's own app: it neither knows nor cares what docks sit beside it. */
function Journal() {
  const files = useDock('files');
  return <div data-testid="journal" className="flex min-h-0 flex-1 flex-col bg-background text-foreground">
    <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-4">
      <h1 className="m-0 flex-1 text-base font-semibold">Journal</h1>
      <button type="button" data-testid="journal-files" onClick={() => files?.toggle()} className="rounded-md border border-border px-2.5 py-1 text-sm">Files</button>
    </header>
    <ul className="m-0 flex-1 list-none divide-y divide-border overflow-y-auto p-0">
      {ROWS.map(row => <li key={row.day} data-testid="journal-row" className="px-4 py-3">
        <span className="text-xs font-medium text-muted-foreground uppercase">{row.day}</span>
        <p className="m-0 font-medium">{row.title}</p><p className="m-0 text-sm text-muted-foreground">{row.note}</p>
      </li>)}
    </ul>
  </div>;
}

/** The chat dock's content: `PiChat` while docked, `AmbientChat` while floating, one controller. */
function Chat({ api }) {
  const files = useDock('files');
  const chat = useRemoteChat({ conversationId: conversation, endpoint: id => new URL(`/api/chat?conversation=${id}`, location.href), fetch: authorized, identity });
  if (chat.status !== 'ready') return <p role="status" data-testid="chat-connecting" className="p-4 text-sm text-muted-foreground">{chat.status === 'offline' ? 'Server unreachable. Retrying…' : 'Connecting…'}</p>;
  if (api.floating) return <AmbientChat controller={chat.controller} actions={chat.actions} variant="surface" defaultState="expanded" onDock={api.dock} />;
  return <PiChat controller={chat.controller} actions={chat.actions} labels={{ title: 'Journal helper' }}
    headerActions={[{ id: 'files', label: files?.open ? 'Close files' : 'Open files', onSelect: () => files?.toggle() }]} />;
}

function Files({ api }) {
  return <div data-testid="files" className="flex min-h-0 flex-1 flex-col">
    <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-4">
      <h2 className="m-0 flex-1 text-sm font-semibold">Files</h2>
      <button type="button" data-testid="files-close" onClick={() => api.setOpen(false)} className="rounded-md border border-border px-2.5 py-1 text-sm">Close</button>
    </header>
    <ul className="m-0 flex-1 list-none overflow-y-auto p-2 text-sm">{FILES.map(file => <li key={file} className="truncate rounded px-2 py-1.5">{file}</li>)}</ul>
  </div>;
}

createRoot(document.getElementById('root')).render(
  <DockLayout storageKey="dock-app" className="h-full">
    <Dock id="chat" side="left" floatable dragBelow={260} narrowBelow={720} defaultWidth={420} minWidth={300} labels={{ region: 'Agent chat', resize: 'Resize chat' }}>
      {api => <Chat api={api} />}
    </Dock>
    <DockMain><Journal /></DockMain>
    <Dock id="files" side="right" defaultOpen={false} defaultWidth={320} minWidth={240} dragBelow={200} narrowBelow={720} narrow="sheet" labels={{ region: 'Files', resize: 'Resize files' }}>
      {api => <Files api={api} />}
    </Dock>
  </DockLayout>);
