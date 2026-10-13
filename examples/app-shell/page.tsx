// The browser side of the app-shell example: a fictional fitness app ("Forme") with a fake screen, a 56px fake tab bar and the AgentLayer
// (the coach and, from the menu, the product manager). `?mode=` picks a proof case: `fitness` (coach with voice plus product manager, the
// default), `redaction` (product manager only) or `template` (coach without voice); `?send=draft` makes push-to-talk only fill the composer.
// @ts-nocheck: an example page, bundled by esbuild and not part of the typechecked sources.
import { createRoot } from 'react-dom/client';
import { useEffect, useState } from 'react';
import { createFeedbackSession } from '@hachej/boring-feedback/ui';
import { createPrivacyPolicy } from '@hachej/boring-feedback/page';
import { AgentLayer, AgentLayerProvider, AgentTrigger, useAgentLayer } from '../../registry/app-shell/agent-layer.tsx';
import { readAgentContext, useAgentContext } from '../../registry/app-shell/agent-context.ts';
import { useRemoteChat } from '../../registry/pi-chat/use-remote-chat.ts';

const { token, identity, conversations } = window.__APP__;
const query = new URLSearchParams(location.search);
const mode = query.get('mode') ?? 'fitness';
const send = query.get('send') === 'draft' ? 'draft' : 'auto';
const authorized = (request: Request) => { const headers = new Headers(request.headers); headers.set('authorization', `Bearer ${token}`); return fetch(new Request(request, { headers })); };
const endpoint = (agent: string) => (id: string) => new URL(`/api/chat?agent=${agent}&conversation=${id}`, location.href);

const policy = createPrivacyPolicy({ routeOf: ({ pathname }) => pathname });
const ROWS = Array.from({ length: 40 }, (_, index) => ({ day: `Jour ${index + 1}`, steps: 6000 + ((index * 937) % 5000) }));

/** The fake screen: it tells the layer what the person is looking at, and has a header with the trigger and a menu entry for the manager. */
function Screen() {
  useAgentContext({ name: 'Progrès', params: { range: 30 } });
  const layer = useAgentLayer();
  return <main data-testid="screen" className="min-h-screen pb-[calc(var(--app-shell-tabbar)+1rem)]">
    <header className="sticky top-0 z-10 flex h-14 items-center gap-1 border-b border-border bg-background px-3">
      <h1 className="m-0 flex-1 text-base font-semibold">Progrès</h1>
      <button type="button" data-testid="menu-improve" onClick={() => layer.open('improve')} className="inline-flex min-h-9 items-center rounded-md px-2 text-sm hover:bg-accent pointer-coarse:min-h-11">Améliorer l'app</button>
      <AgentTrigger />
    </header>
    <ul className="m-0 list-none divide-y divide-border p-0">
      {ROWS.map(row => <li key={row.day} className="flex items-center justify-between px-4 py-3"><span>{row.day}</span><span className="text-muted-foreground">{row.steps} pas</span></li>)}
    </ul>
  </main>;
}

/** The fake tab bar: the layer's peek sits right above it, and it stays tappable at peek. */
function TabBar() {
  const [taps, setTaps] = useState(0);
  return <nav data-testid="tabbar" aria-label="Onglets" className="fixed inset-x-0 bottom-0 z-(--app-shell-z-tabs) flex border-t border-border bg-background" style={{ height: 'var(--app-shell-tabbar)' }}>
    {['Jour', 'Progrès', 'Données'].map(name => <button key={name} type="button" data-testid={`tab-${name}`} onClick={() => setTaps(count => count + 1)} className="min-h-11 flex-1 text-sm">{name}</button>)}
    <output data-testid="tab-count" className="sr-only">{taps}</output>
  </nav>;
}

/** The product manager's point-mode session over the app's own root (the layer itself is outside it, so it is never picked). */
function useManagerFeedback(mounted: boolean) {
  const [session, setSession] = useState(undefined);
  useEffect(() => {
    if (!mounted) return;
    const created = createFeedbackSession({ app: 'forme', build: 'dev', root: document.getElementById('app-root'), policy });
    setSession(created);
    return () => created.dispose();
  }, [mounted]);
  return session;
}

function App() {
  const coach = useRemoteChat({ conversationId: mode === 'redaction' ? undefined : conversations.coach, endpoint: endpoint('coach'), fetch: authorized, identity, requestContext: readAgentContext });
  const manager = useRemoteChat({ conversationId: mode === 'template' ? undefined : conversations.pm, endpoint: endpoint('pm'), fetch: authorized, identity, requestContext: readAgentContext });
  const waiting = (mode !== 'redaction' && coach.status !== 'ready') || (mode !== 'template' && manager.status !== 'ready');
  const feedback = useManagerFeedback(!waiting);
  if (waiting) return <p role="status" data-testid="connecting" className="p-4 text-sm text-muted-foreground">Connexion…</p>;
  // A test seam: a send that fails the way an unconfirmed earlier submission does (the controller throws).
  if (!window.__sendWrapped && coach.status === 'ready') {
    window.__sendWrapped = true;
    const real = coach.controller.send.bind(coach.controller);
    coach.controller.send = (...args) => window.__breakSend ? Promise.reject(new Error('Reconcile the existing submission before sending another')) : real(...args);
  }
  const common = { locale: 'fr', showHistory: false, showConnectionStatus: false };
  const agent = mode === 'redaction' ? undefined : {
    controller: coach.controller,
    chatProps: { ...common, actions: coach.actions, labels: { title: 'Coach' }, suggestions: [{ label: 'Résumé de la semaine', text: 'Fais le résumé de ma semaine' }] },
    ...(mode === 'template' ? {} : { voice: { transcribe: async () => window.__transcript ?? 'Combien de pas hier ?', send } }),
  };
  const improve = mode === 'template' ? undefined : { controller: manager.controller, ...(feedback ? { feedback } : {}), chatProps: { ...common, actions: manager.actions, labels: { title: 'Chef de produit' } } };
  window.__layer = { mode };
  // The shell root defines the tab bar's height; portalled parts (the drawer, the point bar) are outside it and must be given it explicitly.
  return <div id="shell" style={{ '--app-shell-tabbar': '56px' }}>
    <AgentLayerProvider agent={agent} improve={improve}>
      <div id="app-root"><Screen /><TabBar /></div>
      <AgentLayer />
    </AgentLayerProvider>
  </div>;
}

createRoot(document.getElementById('root')).render(<App />);
