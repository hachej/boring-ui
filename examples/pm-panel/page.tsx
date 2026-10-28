// Fictional browser fixture: the real remote controller and kit transport; no Factory door or application adoption.
// The app is the mockups' « Coach Max » (Alice, alice@exemple.fr, « Déjeuner 520 kcal · 32 g », D-201…), so every board compares 1:1.
import { createRoot } from 'react-dom/client';
import { useEffect, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { AppShell } from '../../registry/app-shell/app-shell';
import { useScreenHeader } from '../../registry/app-shell/header';
import { useRemoteChat } from '../../registry/pi-chat/use-remote-chat';
import { Input } from '../app-shell/components/ui/input';
import { TASKS, TASKS_EN, renderTaskBoard, renderRequest } from './tasks';
import { StudioStory } from './studio';

const host = (window as unknown as { __APP__: { token: string; identity: import('@hachej/boring-ui-kit/native-chat').ChatIdentity; conversations: { pm: string } } }).__APP__;
const controls = window as unknown as { __holdReply?: boolean; __releaseReply?: () => void; __dropReply?: boolean; __holdTranscription?: boolean; __releaseTranscription?: () => void; __swapPm?: () => void };
const authorized = async (request: Request) => {
  const headers = new Headers(request.headers); headers.set('authorization', `Bearer ${host.token}`);
  const response = await fetch(new Request(request, { headers }));
  if (new URL(request.url).searchParams.get('op') === 'submit') {
    if (controls.__holdReply) await new Promise<void>(resolve => { controls.__releaseReply = resolve; });
    if (controls.__dropReply) { controls.__dropReply = false; throw new Error('Fictional lost reply after native admission'); }
  }
  return response;
};
// C6: « Sur cette carte ① je veux les protéines en premier, comme sur cette jauge ②. » — 14 s, the picks land at 0:02 and 0:09.
const words = 'Sur cette carte je veux les protéines en premier, comme sur cette jauge.';
const timing = [[0.4, 0.8], [0.9, 1.3], [1.4, 1.9], [2.6, 2.9], [3.0, 3.5], [3.6, 3.8], [3.9, 4.8], [4.9, 5.2], [5.3, 6.4], [6.6, 7.1], [7.2, 7.5], [7.6, 8.1], [8.2, 8.9]] as const;
const segments = [{ start: 0.4, end: 8.9, text: words, words: words.split(' ').map((text, index) => ({ start: timing[index]![0], end: timing[index]![1], text })) }];
// D boards: « On this card ① protein should come before calories, and this gauge ② can go. » — picks at 0:02 and 0:09.
const wordsEn = 'On this card protein should come before calories, and this gauge can go.';
const timingEn = [[0.3, 0.6], [0.7, 1.0], [1.1, 1.8], [2.4, 2.9], [3.0, 3.4], [3.5, 3.8], [3.9, 4.3], [4.4, 5.3], [5.5, 5.8], [5.9, 6.3], [6.4, 8.8], [9.3, 9.6], [9.7, 10.2]] as const;
const segmentsEn = [{ start: 0.3, end: 10.2, text: wordsEn, words: wordsEn.split(' ').map((text, index) => ({ start: timingEn[index]![0], end: timingEn[index]![1], text })) }];
const note = (name: string, value: unknown) => { const global = window as unknown as Record<string, unknown[]>; (global[name] ??= []).push(value); };
const query = new URLSearchParams(location.search);

// The page is the app's own markup (not the kit's), copied from the boards' fictional « Coach Max ».
const ink = { color: 'var(--foreground)' } as const;
const card: CSSProperties = { border: '1px solid var(--border)', borderRadius: 14, padding: 14 };
const label: CSSProperties = { fontSize: 12, letterSpacing: '0.08em', color: 'var(--coach-subtle)' };
const row: CSSProperties = { fontSize: 14, display: 'flex', justifyContent: 'space-between', padding: '6px 0' };
function Page({ title, subtitle, children }: { readonly title: string; readonly subtitle: string; readonly children: ReactNode }) {
  useScreenHeader({ title, subtitle, titleFace: 'sans' });
  return <section data-feedback-visible="" style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 12, ...ink }}>{children}</section>;
}
function Day() {
  return <Page title="Ma journée" subtitle="mer. 28 oct.">
    <div style={card}>
      <div style={label}>REPAS</div>
      <div style={{ fontSize: 22, fontWeight: 800, fontStyle: 'italic', margin: '2px 0 10px' }}>PLAN DU JOUR</div>
      <div style={row}><span>Petit-déjeuner 08:00</span><span>~0 kcal</span></div>
      <div role="article" aria-label="Déjeuner" data-testid="card-a" onClick={() => note('__activated', 'a')} style={{ borderRadius: 10, padding: 8, margin: '6px -8px' }}>
        <div style={{ fontSize: 14, display: 'flex', justifyContent: 'space-between', fontWeight: 650 }}><span>{query.has('long') ? 'Déjeuner fictif · très longue étiquette '.repeat(15) : 'Déjeuner'}</span><span>520 kcal · 32 g</span></div>
        <div style={{ fontSize: 13, marginTop: 2 }}>Salade de lentilles, œuf</div>
      </div>
      <div style={row}><span>Dîner 20:00</span><span>—</span></div>
    </div>
    <div role="meter" aria-label="Protéines" aria-valuenow={229} aria-valuemin={0} aria-valuemax={130} data-testid="gauge" onClick={() => note('__activated', 'gauge')} style={card}>
      <div style={label}>PROTÉINES</div>
      <div style={{ fontSize: 14, marginTop: 6 }}>229 / 130 g · 176 %</div>
    </div>
    <div style={card}>
      <div style={label}>SÉANCE</div>
      <div style={{ fontSize: 14, marginTop: 6 }}>Haut du corps · 18:00</div>
    </div>
    {query.has('case') && <Input data-testid="domain-draft" aria-label="Brouillon de la page" defaultValue="Brouillon fictif" />}
    {query.has('case') && Array.from({ length: 12 }, (_, index) => <div key={index} style={card}><div style={label}>REPÈRE {index + 1}</div><div style={{ fontSize: 14, marginTop: 6 }}>Le contenu reste accessible en défilant.</div></div>)}
    <button type="button" data-testid="last-action" onClick={() => note('__activated', 'last')} style={{ ...card, background: 'transparent', font: 'inherit', fontSize: 14, textAlign: 'left', minHeight: 44, ...(query.has('case') || query.has('scroll') ? {} : { display: 'none' }) }}>Dernière action de la page</button>
  </Page>;
}
function Progress() {
  return <Page title="Progrès" subtitle="7 derniers jours">
    <div role="article" aria-label="Poids" data-testid="card-b" onClick={() => note('__activated', 'b')} style={card}>
      <div style={label}>POIDS</div>
      <div style={{ fontSize: 22, fontWeight: 800, fontStyle: 'italic', margin: '2px 0 10px' }}>72,4 kg</div>
      <svg width="300" height="80" viewBox="0 0 300 80" aria-hidden="true"><polyline points="0,52 50,48 100,54 150,42 200,44 250,36 300,32" fill="none" stroke="currentColor" strokeWidth="2" /></svg>
    </div>
    <div style={card}><div style={label}>ENTRAÎNEMENT</div><div style={{ fontSize: 14, marginTop: 6 }}>3 séances · 41 séries</div></div>
    <div style={card}><div style={label}>PROTÉINES</div><div style={{ fontSize: 14, marginTop: 6 }}>Moyenne 142 g / jour</div></div>
    <button type="button" data-testid="last-action" onClick={() => note('__activated', 'last')} style={{ ...card, background: 'transparent', font: 'inherit', fontSize: 14, textAlign: 'left', minHeight: 44, ...(query.has('case') || query.has('scroll') ? {} : { display: 'none' }) }}>Dernière action de la page</button>
  </Page>;
}
function Plain({ title, subtitle }: { readonly title: string; readonly subtitle: string }) {
  return <Page title={title} subtitle={subtitle}><div style={card}><div style={label}>{title.toUpperCase()}</div><div style={{ fontSize: 14, marginTop: 6 }}>Rien de prévu.</div></div></Page>;
}
const NoIcon = () => null;

function Ready({ remote }: { readonly remote: Extract<ReturnType<typeof useRemoteChat>, { status: 'ready' }> }) {
  const [screen, setScreen] = useState('day');
  return <AppShell layout="screen" title="Coach Max" locale="fr" route={{ id: screen, onChange: setScreen }}
    account={{ name: 'Alice', email: 'alice@exemple.fr', menu: [{ label: 'Réglages', onSelect: () => note('__menu', 'settings') }, { label: 'Accueil du coach', onSelect: () => note('__menu', 'coach') }], signOut: () => note('__menu', 'out') }} nav={[
      { id: 'day', label: 'Ma journée', icon: NoIcon, render: () => <Day /> },
      { id: 'progress', label: 'Progrès', icon: NoIcon, render: () => <Progress /> },
      { id: 'session', label: 'Séance', icon: NoIcon, render: () => <Plain title="Séance" subtitle="Haut du corps · 18:00" /> },
      { id: 'data', label: 'Données', icon: NoIcon, render: () => <Plain title="Données" subtitle="Export et partage" /> },
    ]}
    improve={{ controller: remote.controller, appName: 'Coach Max', chatProps: { actions: remote.actions, showHistory: false },
      pointVoice: { transcribe: async () => { if (controls.__holdTranscription) await new Promise<void>(resolve => { controls.__releaseTranscription = resolve; }); if ((window as unknown as { __failVoice?: boolean }).__failVoice) throw new Error('Fictional refusal'); return { text: words, segments: query.has('untimed') ? undefined : segments }; } },
      taskMentions: { title: id => TASKS.find(task => task.id === id)?.title, present: id => note('__presented', id), search: async (text, { filter }) => { note('__taskFilters', filter); return TASKS.filter(task => (filter === 'all' || task.mine) && (task.id.toLowerCase().startsWith(text.toLowerCase()) || task.title.toLowerCase().includes(text.toLowerCase()))); } },
      tasks: { renderBoard: renderTaskBoard, renderRequest: ({ edit }) => renderRequest(id => note('__confirmed', id), text => { note('__modify', text); edit(text); }) },
    }} />;
}
function Studio({ remote }: { readonly remote: Extract<ReturnType<typeof useRemoteChat>, { status: 'ready' }> }) {
  return <StudioStory note={value => note('__activated', value)} spec={{ controller: remote.controller, appName: 'Coach Max', chatProps: { actions: remote.actions, showHistory: false, locale: 'en' },
    pointVoice: { transcribe: async () => ({ text: wordsEn, segments: segmentsEn }) },
    taskMentions: { title: id => TASKS_EN.find(task => task.id === id)?.title, present: id => note('__presented', id), search: async text => TASKS_EN.filter(task => task.mine && (task.id.toLowerCase().startsWith(text.toLowerCase()) || task.title.toLowerCase().includes(text.toLowerCase()))) },
  }} />;
}
function App() {
  const first = useRemoteChat({ conversationId: host.conversations.pm, endpoint: id => new URL(`/api/chat?agent=pm&conversation=${id}`, location.href), fetch: authorized, identity: host.identity });
  const second = useRemoteChat({ conversationId: host.conversations.pm, endpoint: id => new URL(`/api/chat?agent=pm&conversation=${id}`, location.href), fetch: authorized, identity: host.identity });
  const [swapped, setSwapped] = useState(false);
  useEffect(() => { (window as unknown as { __pmFixtureId?: string }).__pmFixtureId = query.get('case') ?? ''; controls.__swapPm = () => setSwapped(value => !value); return () => { delete controls.__swapPm; }; }, []);
  const remote = swapped ? second : first;
  return remote.status !== 'ready' ? <p data-testid="connecting">Connexion…</p> : query.has('studio') ? <Studio remote={remote} /> : <Ready remote={remote} />;
}
createRoot(document.getElementById('root')!).render(<App />);
