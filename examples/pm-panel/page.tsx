// Fictional browser fixture: the real remote controller and kit transport; no Factory door or application adoption.
// The app is the mockups' « Coach Max » (Alice, alice@exemple.fr, « Déjeuner 520 kcal · 32 g », D-201…), so every board compares 1:1.
import { createRoot } from 'react-dom/client';
import { useEffect, useState } from 'react';
import { AppShell } from '../../registry/app-shell/app-shell';
import { useRemoteChat } from '../../registry/pi-chat/use-remote-chat';
import { TASKS, TASKS_EN, renderTaskBoard, renderRequest } from './tasks';
import { coachAccount, coachNav, note } from './coach-max';
import { segments, segmentsEn, words, wordsEn } from './speech.mjs';
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
const query = new URLSearchParams(location.search);

function Ready({ remote }: { readonly remote: Extract<ReturnType<typeof useRemoteChat>, { status: 'ready' }> }) {
  const [screen, setScreen] = useState('day');
  return <AppShell layout="screen" title="Coach Max" locale="fr" route={{ id: screen, onChange: setScreen }}
    account={coachAccount} nav={coachNav}
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
