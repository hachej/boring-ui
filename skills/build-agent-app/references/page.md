# Page template (`src/App.tsx`)

The whole browser side, adapted from [examples/workspace-app/page.jsx](../../../examples/workspace-app/page.jsx). It needs the `pi-app` and `pi-app-kinds` blocks installed (they bring `pi-chat`, `pi-workspace`, the viewers and `theme`).

Verified on 2026-10-22 in a fresh `shadcn init -t vite` app with 0.4.8: `tsc -p tsconfig.app.json --noEmit` reports nothing in this file, `vite build` succeeds, and the page renders the sessions pane, the chat with its suggestion and the Library against `server.mjs`. The `pi-app-kinds` import and `artifactKinds` were added after that check, when pi-app stopped drawing kinds of its own.

```tsx
// src/App.tsx: the whole browser side. Sessions, chat and artifact viewers come from the pi-app block's AgentWorkspace.
import { useEffect, useState } from 'react';
import { connectRevisionProvider } from '@hachej/boring-files/revision';
import { TooltipProvider } from '@/components/ui/tooltip';
import { AgentWorkspace, useConversations, useRemoteChat } from '@/components/pi-app/agent-workspace';
import { defaultKinds } from '@/components/pi-app-kinds/pi-app-kinds';

// The person the page acts for. It must match the `access` the server's revision route resolves.
const identity = { runtimeId: 'app', scopeId: 'demo-team', principalId: 'demo-person', initiatorId: 'demo-person' };
// Your auth goes here (a cookie needs nothing). In development the Vite proxy adds the bearer token instead.
const authorized: typeof fetch = (input, init) => fetch(input, init);
const at = (path: string) => new URL(path, location.href);
// The files the page draws (Markdown, HTML, PDF, images, mock-ups, diagrams…); put your own kinds first to add one.
const kinds = defaultKinds();

type RevisionProvider = Awaited<ReturnType<typeof connectRevisionProvider>>;

export default function App() {
  const [selected, setSelected] = useState<string>();
  const [revisionProvider, setRevisionProvider] = useState<RevisionProvider>();
  useEffect(() => {
    let off = false;
    connectRevisionProvider({ endpoint: at('/api/resources'), fetch: authorized }).then(value => { if (!off) setRevisionProvider(value); });
    return () => { off = true; };
  }, []);
  const conversations = useConversations({ endpoint: at('/api/conversations'), fetch: authorized, activeId: selected, onSelect: setSelected });
  // Open the chosen conversation while it is listed, otherwise the most recent one.
  const items = conversations?.items;
  useEffect(() => { if (items?.length && !items.some(item => item.id === selected)) setSelected(items[0].id); }, [items, selected]);
  const active = items?.some(item => item.id === selected) ? selected : undefined;
  const chat = useRemoteChat({ conversationId: active, endpoint: id => at(`/api/chat?conversation=${id}`), fetch: authorized, identity });

  return (
    <TooltipProvider>
      <main className="flex h-svh min-h-0">
        {revisionProvider ? (
          <AgentWorkspace
            artifactKinds={kinds}
            conversationId={active}
            conversations={conversations}
            revisionProvider={revisionProvider}
            controller={chat.status === 'ready' ? chat.controller : undefined}
            chat={{
              labels: { title: 'Writer' },
              suggestions: [{ label: 'Draft a plan', text: 'Write a short picnic plan and present it.' }],
              ...(chat.status === 'ready' ? { actions: chat.actions } : {}),
            }}
          />
        ) : <p role="status" className="p-4 text-sm text-muted-foreground">Connecting…</p>}
      </main>
    </TooltipProvider>
  );
}
```

`TooltipProvider` is required: the shadcn CLI prints that reminder when `pi-app` installs the `tooltip` component.

The ids `useConversations` returns are strings. Keep `selected` a `string`.
