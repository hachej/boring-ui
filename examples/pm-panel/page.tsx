// Fictional browser fixture: the real remote controller and kit transport; no Factory door or application adoption.
import { createRoot } from 'react-dom/client';
import { useEffect, useState } from 'react';
import { Input } from '../app-shell/components/ui/input';
import { ActivityIcon, CalendarDaysIcon } from 'lucide-react';
import { AppShell } from '../../registry/app-shell/app-shell';
import { useRemoteChat } from '../../registry/pi-chat/use-remote-chat';
import { Button } from '../app-shell/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../app-shell/components/ui/card';

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
const tasks = [{ id: 'D-201', title: 'Clarifier les cartes', mine: true }, { id: 'D-202', title: 'Un repère sur la jauge', mine: false }];
const words = 'Sur cette carte je veux changer la couleur, comme sur cette jauge.';
const segments = [{ start: 0, end: 7, text: words, words: words.split(' ').map((text, index) => ({ start: index * 0.5, end: index * 0.5 + 0.4, text })) }];
const note = (name: string, value: unknown) => { const global = window as unknown as Record<string, unknown[]>; (global[name] ??= []).push(value); };

function Screen({ progress = false }: { readonly progress?: boolean }) {
  return <section data-feedback-visible="" className="flex flex-col gap-4 p-4">
    <Card><CardHeader><CardTitle>{progress ? 'Progrès fictifs' : 'Ma journée fictive'}</CardTitle></CardHeader><CardContent>
      <Button variant="outline" className="min-h-11 max-w-full whitespace-normal" data-testid={progress ? 'card-b' : 'card-a'} onClick={() => note('__activated', progress ? 'b' : 'a')}>{new URLSearchParams(location.search).has('long') ? 'Carte fictive · très longue étiquette '.repeat(15) : progress ? 'Jauge · Protéines' : 'Carte · Déjeuner'}</Button>
      <Input data-testid="domain-draft" aria-label="Brouillon de la page" defaultValue="Brouillon fictif" />
    </CardContent></Card>
    {Array.from({ length: 14 }, (_, index) => <Card key={index}><CardHeader><CardTitle>Repère fictif {index + 1}</CardTitle></CardHeader><CardContent>Le contenu reste accessible en défilant.</CardContent></Card>)}
    <Button variant="outline" data-testid="last-action" className="min-h-11" onClick={() => note('__activated', 'last')}>Dernière action de la page</Button>
  </section>;
}
function Ready({ remote }: { readonly remote: Extract<ReturnType<typeof useRemoteChat>, { status: 'ready' }> }) {
  const [screen, setScreen] = useState('day');
  const query = new URLSearchParams(location.search);
  return <AppShell layout="screen" title="Atelier fictif" locale="fr" route={{ id: screen, onChange: setScreen }}
    account={{ name: 'Camille Exemple', menu: [] }} nav={[
      { id: 'day', label: 'Jour', icon: CalendarDaysIcon, render: () => <Screen /> },
      { id: 'progress', label: 'Progrès', icon: ActivityIcon, render: () => <Screen progress /> },
    ]}
    improve={{ controller: remote.controller, chatProps: { actions: remote.actions, showHistory: false },
      pointVoice: { transcribe: async () => { if (controls.__holdTranscription) await new Promise<void>(resolve => { controls.__releaseTranscription = resolve; }); if ((window as unknown as { __failVoice?: boolean }).__failVoice) throw new Error('Fictional refusal'); return { text: words, segments: query.has('untimed') ? undefined : segments }; } },
      taskMentions: { title: id => tasks.find(task => task.id === id)?.title, present: id => note('__presented', id), search: async (query, { filter }) => { note('__taskFilters', filter); return tasks.filter(task => (filter === 'all' || task.mine) && `${task.id} ${task.title}`.toLowerCase().includes(query.toLowerCase())); } },
      tasks: { renderBoard: options => <p data-testid="studio-task-board-seam">D-417 · {options.filter} · {options.variant}{options.limit ? ` · ${options.limit}` : ''}</p>, renderRequest: () => <p data-testid="studio-task-card-seam">D-417 fournit la carte À confirmer (Modifier / Confirmer).</p> },
    }} />;
}
function App() {
  const first = useRemoteChat({ conversationId: host.conversations.pm, endpoint: id => new URL(`/api/chat?agent=pm&conversation=${id}`, location.href), fetch: authorized, identity: host.identity });
  const second = useRemoteChat({ conversationId: host.conversations.pm, endpoint: id => new URL(`/api/chat?agent=pm&conversation=${id}`, location.href), fetch: authorized, identity: host.identity });
  const [swapped, setSwapped] = useState(false);
  useEffect(() => { (window as unknown as { __pmFixtureId?: string }).__pmFixtureId = new URLSearchParams(location.search).get('case') ?? ''; controls.__swapPm = () => setSwapped(value => !value); return () => { delete controls.__swapPm; }; }, []);
  const remote = swapped ? second : first;
  return remote.status === 'ready' ? <Ready remote={remote} /> : <p data-testid="connecting">Connexion…</p>;
}
createRoot(document.getElementById('root')!).render(<App />);
