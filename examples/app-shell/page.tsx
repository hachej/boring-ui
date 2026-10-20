// The browser side of the app-shell example: fictional apps in <AppShell layout="screen">. `?app=fitness` (the default) is "Forme", a
// fitness app with Jour, Progrès and Données, a coach with push-to-talk and a product manager; `&nav=6` adds three more screens (« Plus »);
// `?app=empty` is the one-screen template (an agent without voice). `?agent=none` leaves the agent out (the product manager remains) and
// `?send=draft` makes push-to-talk only fill the composer. `?app=redaction` is layout B: a fictional consultation list grouped by day with a
// detail (`#12` deep-links to one); `?app=pm` is layout C: the workspace-app's AgentWorkspace, untouched, inside the shell (`&embedded`:
// its `layout="embedded"`, whose History, Library and New join the shell's header). `?app=placed` is PlacedAgentWorkspace: the same writer as the
// Agent tab, or collapsed (a floating chat on a wide screen, the shell's own drawer on a phone) while another screen is on show.
// @ts-nocheck: an example page, bundled by esbuild and not part of the typechecked sources.
import { createRoot } from 'react-dom/client';
import { createPortal } from 'react-dom';
import { useEffect, useState } from 'react';
import { ActivityIcon, ArchiveIcon, CalendarDaysIcon, CalendarPlusIcon, ClipboardListIcon, DatabaseIcon, HomeIcon, MessageCircleIcon, MessagesSquareIcon, Share2Icon, MoonIcon, MoonStarIcon, PlusIcon, TargetIcon, UsersIcon, UploadIcon } from 'lucide-react';
import { createFeedbackSession } from '@hachej/boring-feedback/ui';
import { createPrivacyPolicy } from '@hachej/boring-feedback/page';
import { connectRevisionProvider } from '@hachej/boring-files/revision';
import { afterBack } from '../../registry/app-shell/back.ts';
import { AppShell, ListDetail, useAgentContext, readAgentContext, useScreenHeader } from '../../registry/app-shell/index.ts';
import type { RevisionProvider } from '@hachej/boring-files/revision';
import { Documents } from '../../registry/documents/documents.tsx';
import { DocumentSheet } from '../../registry/documents/document-sheet.tsx';
import { AgentWorkspace, useConversations } from '../../registry/pi-app/agent-workspace.tsx';
import { PlacedAgentWorkspace, usePlacedAgentState } from '../../registry/placed-agent/placed-agent-workspace.tsx';
import { useRemoteChat } from '../../registry/pi-chat/use-remote-chat.ts';

const { token, identity, conversations } = window.__APP__;
const query = new URLSearchParams(location.search);
const app = ['empty', 'redaction', 'pm', 'placed'].includes(query.get('app')) ? query.get('app') : 'fitness';
const six = query.get('nav') === '6';
const rail = query.get('rail') === 'hover' ? { rail: 'hover' } : {};
// `?documents=1`: the workspace's Documents screen (the Library, a file and its revisions) and the product manager's « Voir la fiche » sheet.
const documents = query.get('documents') === '1';
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
const importAction = { id: 'import', label: 'Importer', icon: UploadIcon, showLabel: 'always', onSelect: () => window.__did.push('import') };
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
const DASHBOARD = [
  { id: 'dashboard', label: 'Tableau de bord', icon: HomeIcon, render: () => <Plain label="Votre tableau de bord" /> },
  { id: 'repas', label: 'Repas', icon: ClipboardListIcon, render: () => <Plain label="Vos repas" /> },
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
  // The workspace's revision provider, bound to the server's resources route (only for `?documents=1`).
  const [docs, setDocs] = useState<RevisionProvider>();
  const [spec, setSpec] = useState<string>();
  useEffect(() => { if (documents) void connectRevisionProvider({ endpoint: new URL('/api/resources', location.href), fetch: authorized }).then(setDocs); }, []);
  const coach = useRemoteChat({ conversationId: noAgent ? undefined : conversations.coach, endpoint: endpoint('coach'), fetch: authorized, identity, requestContext: readAgentContext });
  const manager = useRemoteChat({ conversationId: conversations.pm, endpoint: endpoint('pm'), fetch: authorized, identity, requestContext: readAgentContext });
  const [route, setRoute] = useState(() => location.hash.slice(1));
  const waiting = (!noAgent && coach.status !== 'ready') || manager.status !== 'ready';
  const feedback = useManagerFeedback(!waiting);
  if (waiting) return <p role="status" data-testid="connecting" className="p-4 text-sm text-muted-foreground">Connexion…</p>;
  // A test seam: a send that fails the way an unconfirmed earlier submission does (the controller throws).
  if (!window.__sendWrapped && coach.status === 'ready') {
    window.__sendWrapped = true;
    const real = coach.controller.send.bind(coach.controller);
    coach.controller.send = (...args) => window.__breakSend ? Promise.reject(new Error('Reconcile the existing submission before sending another')) : real(...args);
  }
  const common = { locale: 'fr', showHistory: false, showConnectionStatus: false };
  const agent = noAgent ? undefined : {
    controller: coach.controller,
    // Three actions: the first two in the title row, the third (a link) in « … ».
    headerActions: [
      { id: 'whatsapp', label: 'Discuter avec Max sur WhatsApp', icon: MessageCircleIcon, href: '/whatsapp/open?app=fitness', onSelect: () => window.__did.push('whatsapp') },
      { id: 'share', label: 'Partager ma semaine', icon: Share2Icon, onSelect: () => window.__did.push('share') },
      { id: 'invite', label: 'Inviter un ami', icon: UsersIcon, href: '/invite?app=fitness', onSelect: () => window.__did.push('invite') },
    ],
    chatProps: { ...common, actions: coach.actions, labels: { title: 'Coach', placeholder: 'Parle au coach…' }, tools: <span data-testid="host-tool" className="sr-only">outil</span>, suggestions: [{ label: 'Résumé de la semaine', text: 'Fais le résumé de ma semaine' }] },
    ...(app === 'empty' ? {} : { voice: { transcribe: async () => window.__transcript ?? 'Combien de pas hier ?', send } }),
  };
  // The product manager's « Voir la fiche » opens the product sheet over the app (`DocumentSheet`); the host decides which document.
  const seeSheet = docs ? [{ id: 'spec', label: 'Voir la fiche', icon: ClipboardListIcon, onSelect: () => setSpec('fiche-produit.md') }] : [];
  const improve = { controller: manager.controller, ...(feedback ? { feedback } : {}), ...(seeSheet.length ? { headerActions: seeSheet } : {}), chatProps: { ...common, actions: manager.actions, labels: { title: 'Chef de produit' } } };
  const nav = [...(app === 'empty' ? EMPTY : query.get('nav') === 'dashboard' ? DASHBOARD : FITNESS), ...(docs ? [{ id: 'fiches', label: 'Fiches', icon: ClipboardListIcon, render: () => <Documents provider={docs} locale="fr" /> }] : [])];
  const account = {
    name: 'Camille Martin', email: 'camille@example.invalid',
    menu: app === 'empty' ? [{ label: 'Réglages', onSelect: () => window.__did.push('settings') }]
      : [{ label: 'Réglages', onSelect: () => window.__did.push('settings') }, { label: 'Nouveautés', onSelect: () => window.__did.push('news') }],
    signOut: () => window.__did.push('sign-out'),
  };
  // The app's router: a tab switch replaces the URL (a hash here) and adds no history entry.
  const onChange = (id: string) => { window.__routes.push(id); history.replaceState(history.state, '', `#${id}`); setRoute(id); };
  return <div id="app-root" className="contents">
    <AppShell {...rail} layout="screen" title="Forme" nav={nav} agent={agent} improve={improve} account={account} route={{ id: route, onChange }} />
    {docs && <DocumentSheet provider={docs} path={spec} onClose={() => setSpec(undefined)} onShowAll={() => onChange('fiches')} locale="fr" />}
  </div>;
}

// ---- Layout B: « Redaction », a fictional clinic-like consultation list. Placeholders only: no names, no patient-like data.
const DAYS = ['Lundi 12 octobre', 'Mardi 13 octobre', 'Mercredi 14 octobre', 'Jeudi 15 octobre'];
const CONSULTATIONS = Array.from({ length: 24 }, (_, index) => ({ id: index + 1, day: DAYS[Math.floor(index / 6)], time: `${9 + (index % 6)}h00`, label: `Consultation ${index + 1}`, person: `Personne ${String.fromCharCode(65 + (index % 26))}` }));
const newAction = { id: 'new', label: 'Nouvelle consultation', icon: PlusIcon, onSelect: () => window.__did.push('new') };
const agendaAction = { id: 'agenda', label: 'Importer l\'agenda', icon: CalendarPlusIcon, onSelect: () => window.__did.push('agenda') };

function ConsultationList({ selected, onSelect }: { selected: number | null; onSelect: (id: number) => void }) {
  return <div data-testid="consultation-list">{DAYS.map(day => <section key={day}>
    <h2 className="sticky top-0 m-0 bg-muted px-4 py-1.5 text-xs font-medium text-muted-foreground">{day}</h2>
    <ul className="m-0 list-none divide-y divide-border p-0">{CONSULTATIONS.filter(row => row.day === day).map(row => <li key={row.id}>
      <button type="button" data-testid={`consultation-${row.id}`} aria-current={row.id === selected} onClick={() => onSelect(row.id)}
        className={`flex min-h-12 w-full items-center justify-between gap-2 px-4 text-left text-sm outline-none hover:bg-accent focus-visible:bg-accent ${row.id === selected ? 'bg-accent' : ''}`}>
        <span>{row.label}<span className="block text-xs text-muted-foreground">{row.person}</span></span><span className="text-muted-foreground">{row.time}</span>
      </button></li>)}</ul>
  </section>)}</div>;
}

function Consultation({ id }: { id: number }) {
  useAgentContext({ name: 'Consultations', params: { selected: id } });
  const row = CONSULTATIONS.find(entry => entry.id === id);
  return <article data-testid="consultation-detail" className="grid gap-3 p-4">
    <h2 className="m-0 text-lg font-semibold">{row ? `${row.label} · ${row.person}` : `Consultation ${id}`}</h2>
    {['A · Contexte', 'B · Observations', 'C · Suite'].map(block => <section key={block} className="rounded-md border border-border p-3"><h3 className="m-0 text-sm font-medium">{block}</h3><p className="m-0 mt-1 text-sm text-muted-foreground">Texte d'exemple.</p></section>)}
  </article>;
}

function Consultations({ selected, onSelect, onBack }: { selected: number | null; onSelect: (id: number) => void; onBack: () => void }) {
  useScreenHeader({ actions: [newAction, agendaAction] });
  return <ListDetail list={<ConsultationList selected={selected} onSelect={onSelect} />} detail={selected === null ? null : <Consultation id={selected} />} onBack={onBack} title={selected === null ? undefined : `Consultation ${selected}`} />;
}

function Archives() {
  useScreenHeader({});
  return <p className="m-0 p-4">Archives</p>;
}

const NAV_IDS = ['consultations', 'archives'];
function RedactionApp() {
  const manager = useRemoteChat({ conversationId: conversations.pm, endpoint: endpoint('pm'), fetch: authorized, identity, requestContext: readAgentContext });
  const [hash, setHash] = useState(() => location.hash.slice(1));
  const feedback = useManagerFeedback(manager.status === 'ready');
  if (manager.status !== 'ready') return <p role="status" data-testid="connecting" className="p-4 text-sm text-muted-foreground">Connexion…</p>;
  // The app's router: the URL is a hash and is only ever replaced; the shell's Back layer owns the one history entry of an open detail.
  const go = (next: string) => { history.replaceState(history.state, '', `#${next}`); setHash(next); };
  const selected = /^\d+$/.test(hash) ? Number(hash) : null;
  // A tab from a detail: the selection changes first, the stack entry then goes back on its own, and only after that is the URL replaced.
  const onChange = (id: string) => { window.__routes.push(id); setHash(id); afterBack(() => history.replaceState(history.state, '', `#${id}`)); };
  const nav = [
    { id: 'consultations', label: 'Consultations', icon: ClipboardListIcon, render: () => <Consultations selected={selected} onSelect={id => go(String(id))} onBack={() => go('')} /> },
    { id: 'archives', label: 'Archives', icon: ArchiveIcon, render: () => <Archives /> },
  ];
  const improve = { controller: manager.controller, ...(feedback ? { feedback } : {}), chatProps: { locale: 'fr', showHistory: false, showConnectionStatus: false, actions: manager.actions, labels: { title: 'Chef de produit' } } };
  const account = { name: 'Camille Martin', email: 'camille@example.invalid', menu: [{ label: 'Réglages', onSelect: () => window.__did.push('settings') }, { label: 'Nouveautés', onSelect: () => window.__did.push('news') }] };
  return <div id="app-root" className="contents">
    <AppShell {...rail} layout="workspace" title="Cabinet" nav={nav} improve={improve} account={account} route={{ id: NAV_IDS.includes(hash) ? hash : 'consultations', onChange }} />
  </div>;
}

// ---- Layout C: the workspace-app's AgentWorkspace as the one screen. No shell agent: the page is the chat.
function PmApp() {
  const manager = useRemoteChat({ conversationId: conversations.pm, endpoint: endpoint('pm'), fetch: authorized, identity, requestContext: readAgentContext });
  const [revisionProvider, setRevisionProvider] = useState();
  const [selected, setSelected] = useState();
  useEffect(() => { let off = false; connectRevisionProvider({ endpoint: new URL('/api/resources', location.href), fetch: authorized }).then(value => { if (!off) setRevisionProvider(value); }); return () => { off = true; }; }, []);
  const listed = useConversations({ endpoint: new URL('/api/conversations', location.href), fetch: authorized, activeId: selected, onSelect: setSelected });
  const items = listed?.items;
  useEffect(() => { if (items?.length && !items.some(item => item.id === selected)) setSelected(items[0].id); }, [items, selected]);
  const active = items?.some(item => item.id === selected) ? selected : undefined;
  const chat = useRemoteChat({ conversationId: active, endpoint: id => new URL(`/api/chat?agent=writer&conversation=${id}`, location.href), fetch: authorized, identity });
  const feedback = useManagerFeedback(manager.status === 'ready' && Boolean(revisionProvider));
  if (manager.status !== 'ready' || !revisionProvider) return <p role="status" data-testid="connecting" className="p-4 text-sm text-muted-foreground">Connexion…</p>;
  const nav = [{ id: 'atelier', label: 'Atelier', icon: MessagesSquareIcon, render: () => <main data-testid="app" data-conversation={active} className="flex h-full min-h-0">
    <AgentWorkspace conversationId={active} controller={chat.status === 'ready' ? chat.controller : undefined} conversations={listed} revisionProvider={revisionProvider} layout={query.has('embedded') ? 'embedded' : 'default'}
      chat={{ labels: { title: 'Writer' }, ...(chat.status === 'ready' ? { actions: chat.actions } : {}) }} connecting={<p role="status" className="p-4 text-sm text-muted-foreground">Connecting…</p>} />
  </main> }];
  const improve = { controller: manager.controller, ...(feedback ? { feedback } : {}), chatProps: { locale: 'fr', showHistory: false, showConnectionStatus: false, actions: manager.actions, labels: { title: 'Chef de produit' } } };
  const account = { name: 'Camille Martin', email: 'camille@example.invalid', menu: [{ label: 'Réglages', onSelect: () => window.__did.push('settings') }] };
  return <div id="app-root" className="contents">
    <AppShell {...rail} layout="chat" title="Atelier" nav={nav} improve={improve} account={account} route={{ id: 'atelier', onChange: () => {} }} />
  </div>;
}

// ---- PlacedAgentWorkspace: « Agent » is a tab; any other screen collapses it (floating chat wide, the shell's drawer on a phone). The route is the placement.
const APPROVALS = ['Fournisseur Alpha : 1 240 €', 'Fournisseur Bêta : 310 €', 'Fournisseur Gamma : 2 075 €'];
function PlacedApp() {
  const [revisionProvider, setRevisionProvider] = useState();
  const [selected, setSelected] = useState();
  useEffect(() => { let off = false; connectRevisionProvider({ endpoint: new URL('/api/resources', location.href), fetch: authorized }).then(value => { if (!off) setRevisionProvider(value); }); return () => { off = true; }; }, []);
  const listed = useConversations({ endpoint: new URL('/api/conversations', location.href), fetch: authorized, activeId: selected, onSelect: setSelected });
  const items = listed?.items;
  useEffect(() => { if (items?.length && !items.some(item => item.id === selected)) setSelected(items[0].id); }, [items, selected]);
  const active = items?.some(item => item.id === selected) ? selected : undefined;
  const chat = useRemoteChat({ conversationId: active, endpoint: id => new URL(`/api/chat?agent=writer&conversation=${id}`, location.href), fetch: authorized, identity });
  const [remembered, remember] = usePlacedAgentState('forme.placed');
  const [route, setRoute] = useState(() => location.hash.slice(1) || (remembered ? 'approvals' : 'agent'));
  const collapsed = route !== 'agent';
  useEffect(() => { remember(collapsed); }, [collapsed, remember]);
  if (!revisionProvider || !listed) return <p role="status" data-testid="connecting" className="p-4 text-sm text-muted-foreground">Connexion…</p>;
  const go = (id: string) => { history.replaceState(history.state, '', `#${id}`); setRoute(id); };
  const nav = [
    { id: 'agent', label: 'Agent', icon: MessagesSquareIcon, render: () => <main data-testid="app" data-conversation={active} className="flex h-full min-h-0">
      <PlacedAgentWorkspace conversationId={active} controller={chat.status === 'ready' ? chat.controller : undefined} conversations={listed} revisionProvider={revisionProvider} layout="embedded" title="Agent" locale="fr" storageKey="forme.placed"
        collapsed={collapsed} onCollapsedChange={next => go(next ? 'approvals' : 'agent')}
        chat={{ labels: { title: 'Agent' }, ...(chat.status === 'ready' ? { actions: chat.actions } : {}) }} connecting={<p role="status" className="p-4 text-sm text-muted-foreground">Connexion…</p>} />
    </main> },
    { id: 'approvals', label: 'Approbations', icon: ClipboardListIcon, render: () => <Approvals /> },
    { id: 'suppliers', label: 'Fournisseurs', icon: UsersIcon, render: () => <Plain label="Vos fournisseurs" /> },
  ];
  return <div id="app-root" className="contents">
    <AppShell layout="chat" title="Factures" nav={nav} locale="fr" route={{ id: route, onChange: go }} />
  </div>;
}
function Approvals() {
  useScreenHeader({ title: 'Approbations', subtitle: 'cette semaine' });
  return <ul data-testid="approvals" className="m-0 list-none divide-y divide-border p-0">{APPROVALS.map(row => <li key={row} className="px-4 py-3 text-sm">{row}</li>)}</ul>;
}

createRoot(document.getElementById('root')).render(app === 'redaction' ? <RedactionApp /> : app === 'pm' ? <PmApp /> : app === 'placed' ? <PlacedApp /> : <App />);
