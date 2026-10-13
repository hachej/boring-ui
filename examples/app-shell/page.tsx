// The browser side of the app-shell example: fictional apps in <AppShell layout="screen">. `?app=fitness` (the default) is "Forme", a
// fitness app with Jour, Progrès and Données, a coach with push-to-talk and a product manager; `&nav=6` adds three more screens (« Plus »);
// `?app=empty` is the one-screen template (an agent without voice). `?agent=none` leaves the agent out (the product manager remains) and
// `?send=draft` makes push-to-talk only fill the composer.
// @ts-nocheck: an example page, bundled by esbuild and not part of the typechecked sources.
import { createRoot } from 'react-dom/client';
import { useEffect, useState } from 'react';
import { ActivityIcon, CalendarDaysIcon, DatabaseIcon, HomeIcon, MoonIcon, MoonStarIcon, TargetIcon, UsersIcon, UploadIcon } from 'lucide-react';
import { createFeedbackSession } from '@hachej/boring-feedback/ui';
import { createPrivacyPolicy } from '@hachej/boring-feedback/page';
import { AppShell, useAgentContext, readAgentContext, useScreenHeader } from '../../registry/app-shell/index.ts';
import { useRemoteChat } from '../../registry/pi-chat/use-remote-chat.ts';

const { token, identity, conversations } = window.__APP__;
const query = new URLSearchParams(location.search);
const app = query.get('app') === 'empty' ? 'empty' : 'fitness';
const six = query.get('nav') === '6';
const send = query.get('send') === 'draft' ? 'draft' : 'auto';
const noAgent = query.get('agent') === 'none';
const authorized = (request: Request) => { const headers = new Headers(request.headers); headers.set('authorization', `Bearer ${token}`); return fetch(new Request(request, { headers })); };
const endpoint = (agent: string) => (id: string) => new URL(`/api/chat?agent=${agent}&conversation=${id}`, location.href);

const policy = createPrivacyPolicy({ routeOf: ({ pathname }) => pathname });
const ROWS = Array.from({ length: 40 }, (_, index) => ({ day: `Jour ${index + 1}`, steps: 6000 + ((index * 937) % 5000) }));

// What the test reads back: every `onChange` of the shell, and what the account menu and the actions did.
window.__routes = [];
window.__did = [];
window.__agentContext = readAgentContext;

const themeAction = { id: 'theme', label: 'Thème', icon: MoonIcon, onSelect: () => document.documentElement.classList.toggle('dark') };
const importAction = { id: 'import', label: 'Importer', icon: UploadIcon, onSelect: () => window.__did.push('import') };
const moreAction = { id: 'export', label: 'Exporter', icon: DatabaseIcon, onSelect: () => window.__did.push('export') };

const List = () => <ul className="m-0 list-none divide-y divide-border p-0">
  {ROWS.map(row => <li key={row.day} className="flex items-center justify-between px-4 py-3"><span>{row.day}</span><span className="text-muted-foreground">{row.steps} pas</span></li>)}
</ul>;

function Day() {
  useScreenHeader({ title: 'Ma journée', subtitle: 'mardi 13 octobre', actions: [themeAction] });
  return <List />;
}
function Progress() {
  useAgentContext({ name: 'Progrès', params: { range: 30 } });
  useScreenHeader({ actions: [themeAction] });
  return <List />;
}
function Data() {
  useScreenHeader({ actions: [importAction, themeAction] });
  return <p className="m-0 p-4">Vos données</p>;
}
function Plain({ label }: { label: string }) {
  useScreenHeader({ actions: [themeAction, importAction, moreAction] });
  return <p className="m-0 p-4">{label}</p>;
}

const FITNESS = [
  { id: 'jour', label: 'Jour', icon: CalendarDaysIcon, render: () => <Day /> },
  { id: 'progres', label: 'Progrès', icon: ActivityIcon, render: () => <Progress /> },
  { id: 'donnees', label: 'Données', icon: DatabaseIcon, badge: true, render: () => <Data /> },
  ...(six ? [
    { id: 'objectifs', label: 'Objectifs', icon: TargetIcon, render: () => <Plain label="Vos objectifs" /> },
    { id: 'sommeil', label: 'Sommeil', icon: MoonStarIcon, badge: true, render: () => <Plain label="Votre sommeil" /> },
    { id: 'amis', label: 'Amis', icon: UsersIcon, render: () => <Plain label="Vos amis" /> },
  ] : []),
];
const EMPTY = [{ id: 'accueil', label: 'Accueil', icon: HomeIcon, render: () => <p className="m-0 p-4">Bienvenue</p> }];

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
  const coach = useRemoteChat({ conversationId: noAgent ? undefined : conversations.coach, endpoint: endpoint('coach'), fetch: authorized, identity, requestContext: readAgentContext });
  const manager = useRemoteChat({ conversationId: conversations.pm, endpoint: endpoint('pm'), fetch: authorized, identity, requestContext: readAgentContext });
  const [route, setRoute] = useState(() => location.hash.slice(1));
  const waiting = (!noAgent && coach.status !== 'ready') || manager.status !== 'ready';
  const feedback = useManagerFeedback(!waiting);
  if (waiting) return <p role="status" data-testid="connecting" className="p-4 text-sm text-muted-foreground">Connexion…</p>;
  const common = { locale: 'fr', showHistory: false, showConnectionStatus: false };
  const agent = noAgent ? undefined : {
    controller: coach.controller,
    chatProps: { ...common, actions: coach.actions, labels: { title: 'Coach' }, suggestions: [{ label: 'Résumé de la semaine', text: 'Fais le résumé de ma semaine' }] },
    ...(app === 'empty' ? {} : { voice: { transcribe: async () => window.__transcript ?? 'Combien de pas hier ?', send } }),
  };
  const improve = { controller: manager.controller, ...(feedback ? { feedback } : {}), chatProps: { ...common, actions: manager.actions, labels: { title: 'Chef de produit' } } };
  const nav = app === 'empty' ? EMPTY : FITNESS;
  const account = {
    name: 'Camille Martin', email: 'camille@example.invalid',
    menu: app === 'empty' ? [{ label: 'Réglages', onSelect: () => window.__did.push('settings') }]
      : [{ label: 'Réglages', onSelect: () => window.__did.push('settings') }, { label: 'Nouveautés', onSelect: () => window.__did.push('news') }],
    signOut: () => window.__did.push('sign-out'),
  };
  // The app's router: a tab switch replaces the URL (a hash here) and adds no history entry.
  const onChange = (id: string) => { window.__routes.push(id); history.replaceState(history.state, '', `#${id}`); setRoute(id); };
  return <div id="app-root" className="contents">
    <AppShell layout="screen" title="Forme" nav={nav} agent={agent} improve={improve} account={account} route={{ id: route, onChange }} />
  </div>;
}

createRoot(document.getElementById('root')).render(<App />);
