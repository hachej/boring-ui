import { useLayoutEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { AppShell } from '../../../registry/app-shell/app-shell.tsx';
import { useAgentLayer } from '../../../registry/app-shell/agent-layer.tsx';
import { SlashPicker } from '../../../registry/pi-chat-slash/slash-menu.tsx';
import { createScriptedAgent } from '../../../ux/fixtures/scripted-agent.mjs';
import script from '../../../ux/scenarios/scripts/bar.json';
import { FileTextIcon, FolderIcon, SparklesIcon } from '../../../registry/_shared/icons';
import { CONVERSATIONS, DEMO, demoLibrary, fileView, recordView, useDemoConversations } from './one-composer-demo.jsx';

// D-2198: the real AppShell with `composer="bar"` (the one composer) in French, over a fake controller with fictional bookkeeping text.
// The test scripts the agent through `window.__run(kind)`: `tool` (a read with its progress), `form` (two questions), `reply` (the run ends
// with a reply that cites a file). `window.__answered` holds what the question card answered, `window.__sent` what the field sent.
// A cited file opens the fixture's own preview through `useAgentLayer().preview`. `?composer=content` is the previous mode, `?dark=1` the dark theme,
// `?single=1` a single-screen app (`sidebar={false}`, with an account).
const params = new URLSearchParams(location.search);
// The demo page (one-composer-demo.html) runs in English; the tests keep the French words they assert.
const EN = typeof window !== 'undefined' && window.__DEMO_LANG === 'en';
const T = (fr, en) => EN ? en : fr;
const LOCALE = EN ? 'en' : 'fr';
if (params.get('dark') === '1') document.documentElement.classList.add('dark');
try { for (const key of Object.keys(localStorage)) if (key.startsWith('boring-ui:sidebar-agent-mode') || key.startsWith('boring.app-shell.agent.')) localStorage.removeItem(key); } catch { /* none */ }
window.__sent = [];
// The fake microphone (as the agent bar's fixture): getUserMedia hands out one track, MediaRecorder hands over one chunk when it stops; the
// fixture's `transcribe` answers « Texte dicté fictif ». Web Audio is removed so the kit's capture takes the MediaRecorder path.
Object.defineProperty(window, 'AudioContext', { configurable: true, value: undefined });
Object.defineProperty(window, 'webkitAudioContext', { configurable: true, value: undefined });
// `?slowmic=1`: the first open of the microphone takes 700 ms, as a real phone's first open does (permission, device start); the next ones are instant.
let micOpened = false;
Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: async () => {
  if (params.get('slowmic') === '1' && !micOpened) await new Promise(done => setTimeout(done, 700));
  micOpened = true;
  const track = { stop() {} };
  return { getTracks: () => [track], getAudioTracks: () => [track] };
} } });
class FakeRecorder extends EventTarget {
  static isTypeSupported() { return true; }
  constructor() { super(); this.state = 'inactive'; this.mimeType = 'audio/webm'; }
  start() { this.state = 'recording'; }
  stop() {
    this.state = 'inactive';
    const chunk = new Event('dataavailable'); chunk.data = new Blob(['fictional audio'], { type: 'audio/webm' }); this.dispatchEvent(chunk);
    this.dispatchEvent(new Event('stop'));
  }
}
window.MediaRecorder = FakeRecorder;
window.__answered = [];
const assistant = (content, stopReason = content.some(part => part.type === 'toolCall') ? 'toolUse' : 'stop') => ({ role: 'assistant', content, api: 'fictional', provider: 'fictional', model: 'fictional', usage: {}, stopReason, timestamp: 2 });
const entry = (id, model) => ({ id, kind: 'message', byTaskId: 7, model: [model] });
const say = (id, text) => ({ id, kind: 'message', model: [{ role: 'user', content: text, timestamp: 1 }] });
const reply = (id, text) => entry(id, assistant([{ type: 'text', text }]));
const history = DEMO && params.get('conv') === 'long' ? CONVERSATIONS.long.entries : params.get('empty') === '1' ? [] : [say(1, T('Où en est le dossier Cèdre ?', 'Where is the Cedar file at?')), reply(2, T('Le dossier Cèdre fictif attend deux pièces.', 'The fictional Cedar file is waiting for two documents.'))];
let snapshot = { identity: { runtimeId: 'fictional', scopeId: 'one-composer', principalId: 'fictional-reader' }, conversationId: 'one-composer', connection: { kind: 'connected' },
  view: { entries: history, docs: {} }, draft: { text: '', attachments: [], version: 0 }, outbox: [], echo: [], history: { kind: 'disabled' }, send: { kind: 'idle' }, stop: 'idle', disposed: false };
const listeners = new Set();
const live = tools => ({ 'pi.live': { run: { taskId: 7 }, ...(tools ? { tools } : {}) } });
const change = patch => { snapshot = { ...snapshot, ...patch }; for (const listener of listeners) listener(); };
let demoId = 5000;
const scripted = createScriptedAgent({ script, pace: params.get('pace') === 'instant' ? 0.15 : 1, entries: () => snapshot.view.entries, show: (entries, docs) => change({ view: { entries, docs } }) });
const controller = {
  getSnapshot: () => snapshot, subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener); },
  setText: text => change({ draft: { ...snapshot.draft, text, version: snapshot.draft.version + 1 } }),
  setAttachments: attachments => change({ draft: { ...snapshot.draft, attachments, version: snapshot.draft.version + 1 } }),
  // As the real controller: the content given (a draft with app mentions is sent as one), else the draft.
  send: async (_kind, content) => {
    const text = content?.text ?? snapshot.draft.text;
    // `window.__failNext`: the next send is refused, as a real controller does it: the text stays in the field and `send` says why.
    if (window.__failNext) { window.__failNext = false; change({ send: { kind: 'blocked', reason: 'Hors ligne (fictif)' } }); return undefined; }
    window.__sent.push(text);
    if (DEMO) { change({ send: { kind: 'idle' }, draft: { text: '', attachments: [], version: snapshot.draft.version + 1 }, view: { entries: [...snapshot.view.entries, say(++demoId, text)], docs: live() } }); void scripted.say(text); return undefined; }
    const next = snapshot.view.entries.length + 1;
    // As a real run: the agent works a moment, then replies.
    const asked = [...snapshot.view.entries, say(next, text)];
    change({ send: { kind: 'idle' }, draft: { text: '', attachments: [], version: snapshot.draft.version + 1 }, view: { entries: asked, docs: live() } });
    setTimeout(() => change({ view: { entries: [...asked, reply(next + 1, T('Réponse fictive : noté.', 'Fictional reply: noted.'))], docs: {} } }), 800);
  },
  connect: async () => {}, stop: async () => { window.__stops = (window.__stops ?? 0) + 1; if (DEMO) scripted.stop(); else change({ view: runs.reply() }); }, dispose: async () => {}, clearHistory() {}, loadEarlier: async () => {}, reconcile: async () => {}, retrySameRequest: async () => {},
};
// The agent's scripted turns, after the person's question (entry 10).
const ask = say(10, T('Rapproche le relevé de janvier.', 'Reconcile the January statement.'));
const read = entry(11, assistant([{ type: 'toolCall', id: 'c1', name: 'read', arguments: { path: 'uploads/releve-janvier.pdf' } }]));
const readDone = { id: 12, kind: 'message', byTaskId: 8, model: [{ role: 'toolResult', toolCallId: 'c1', toolName: 'read', content: [{ type: 'text', text: '40 lignes' }], isError: false, timestamp: 3 }] };
const FORM = EN ? { question: 'Two details', questions: [{ question: 'Which year?', options: ['2025', '2026'] }, { question: 'Which journal?', options: ['Purchases', 'Sales'] }] }
  : { question: 'Deux précisions', questions: [{ question: 'Quel exercice ?', options: ['2025', '2026'] }, { question: 'Quel journal ?', options: ['Achats', 'Ventes'] }] };
const form = entry(13, assistant([{ type: 'toolCall', id: 'q1', name: 'ask_user', arguments: FORM }]));
const REPLY = EN ? 'The January statement has 40 lines, all reconciled.\nTwo gaps are noted in @uploads/ecarts-janvier.csv.\nNothing else to do for January.\nA fourth line the card cuts.'
  : 'Le relevé de janvier compte 40 lignes, toutes rapprochées.\nDeux écarts sont notés dans @uploads/ecarts-janvier.csv.\nRien d’autre à faire pour janvier.\nUne quatrième ligne que la carte coupe.';
const runs = {
  // `think`: the agent works with no tool running (the card has only its fallback words).
  think: () => ({ entries: [...history, ask], docs: live() }),
  tool: () => ({ entries: [...history, ask, read], docs: live([{ callId: 'c1', taskId: 8, status: 'running', details: { progress: '12 lignes sur 40' } }]) }),
  form: () => ({ entries: [...history, ask, read, readDone, form], docs: live() }),
  reply: () => ({ entries: [...history, ask, read, readDone, entry(14, assistant([{ type: 'text', text: REPLY }]))], docs: {} }),
};
window.__ux = { failNext: () => { window.__failNext = true; }, setText: text => controller.setText(text) };
window.__run = kind => change({ view: runs[kind]() });
window.__setText = text => controller.setText(text);
const actions = {
  answer: async (questionId, text) => { window.__answered.push({ questionId, text }); if (DEMO) scripted.answer(text); else change({ view: runs.tool() }); return { kind: 'answered' }; },
};
window.__library = 0;
const onOpenFile = path => DEMO ? window.__layer.preview(fileView(path)) : window.__layer.preview({ title: path.split('/').at(-1), content: (DEMO || params.get('page') === 'real') ? <div data-testid="fixture-preview" className="flex flex-col gap-3 p-4 text-sm"><p className="font-medium">{path.split('/').at(-1)}</p><table className="w-full border-collapse text-left"><thead><tr className="border-b text-xs text-muted-foreground"><th className="py-1">Date</th><th>Libellé</th><th className="text-right">Écart</th></tr></thead><tbody><tr className="border-b"><td className="py-2">09/01</td><td>Carte Garage du Port</td><td className="text-right tabular-nums">12,00 €</td></tr><tr><td className="py-2">15/01</td><td>Carte Restaurant Le Cèdre</td><td className="text-right tabular-nums">−12,00 €</td></tr></tbody></table><p className="text-muted-foreground">Deux écarts à justifier avant la clôture.</p></div> : <div data-testid="fixture-preview" className="p-4 text-sm">{T('Aperçu fictif de', 'Fictional preview of')} {path}{T(' : deux écarts de 12,00 €.', ': two gaps of €12.00.')}</div> });
window.__openFile = onOpenFile;
const Icon = ({ className }) => <svg className={className} width="24" height="24" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" fill="currentColor" /></svg>;
const Probe = () => { const api = useAgentLayer(); useLayoutEffect(() => { window.__layer = api; }); return null; };
const rows = Math.max(5, Number(params.get('rows') ?? 8));
const Page = () => <div data-testid="page" className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
  <Probe />
  <h1 className="text-lg font-medium">{T('Dossier Cèdre (fictif)', 'Cedar file (fictional)')}</h1>
  {Array.from({ length: rows }, (_, index) => <p key={index} role="row" data-testid="page-row" className="flex items-center justify-between rounded-md border p-3">{T('Écriture', 'Entry')} {index + 1}<span>{T(`${(index + 1) * 12},00 €`, `€${(index + 1) * 12}.00`)}</span></p>)}
</div>;
// `?page=real`: a realistic page behind the composer (a bank reconciliation: figures, tabs, a table), for judging the layout on real content.
const LINES = [['02/01', 'Virement Maison Delorme', '1 240,00 €', 'ok'], ['03/01', 'Prélèvement Énergie Pro', '−186,40 €', 'ok'], ['05/01', 'Carte Papeterie Lemaire', '−42,90 €', 'ok'], ['06/01', 'Virement client Atelier Brun', '2 880,00 €', 'ok'],
  ['08/01', 'Prélèvement Assurance Axiom', '−212,00 €', 'ok'], ['09/01', 'Carte Garage du Port', '−96,50 €', 'gap'], ['12/01', 'Virement client Maison Delorme', '640,00 €', 'ok'], ['14/01', 'Loyer local Rue des Halles', '−950,00 €', 'ok'],
  ['15/01', 'Carte Restaurant Le Cèdre', '−58,20 €', 'gap'], ['17/01', 'Remboursement URSSAF', '312,00 €', 'wait'], ['19/01', 'Prélèvement Télécom Pro', '−64,99 €', 'ok'], ['21/01', 'Virement client Brun & Fils', '1 150,00 €', 'wait'],
  ['23/01', 'Carte Station du Quai', '−71,30 €', 'ok'], ['26/01', 'Prélèvement Titres-repas', '−120,00 €', 'ok'], ['28/01', 'Virement client Cabinet Roux', '1 980,00 €', 'ok'], ['30/01', 'Frais de tenue de compte', '−14,50 €', 'ok']];
const STATUS = { ok: ['Rapprochée', 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'], gap: ['Écart', 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-300'], wait: ['À justifier', 'bg-muted text-muted-foreground'] };
const quote = date => window.__layer.talkAbout('@ecriture:' + date.replace('/', '-'));
const openRecord = line => window.__layer.preview(recordView(line, () => quote(line[0])));
const RealPage = () => <div data-testid="page" className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4 md:p-6">
  <Probe />
  <div className="flex flex-wrap items-baseline justify-between gap-2"><div><h1 className="text-lg font-semibold">Rapprochement bancaire</h1><p className="text-sm text-muted-foreground">Janvier 2026 · Atelier Brun (fictif)</p></div>
    <button type="button" className="h-9 rounded-md border px-3 text-sm">Exporter</button></div>
  <div className="grid grid-cols-3 gap-3">{[['Rapprochées', '13 / 16'], ['Écarts', '2'], ['Solde banque', '8 412,10 €']].map(([label, value]) => <div key={label} className="rounded-lg border bg-card p-3"><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 text-base font-semibold md:text-xl">{value}</p></div>)}</div>
  <div className="flex gap-2 text-sm">{['Toutes', 'Écarts', 'À justifier'].map((tab, i) => <span key={tab} className={`rounded-full border px-3 py-1 ${i === 0 ? 'bg-foreground text-background' : ''}`}>{tab}</span>)}</div>
  <div className="overflow-hidden rounded-lg border bg-card">{LINES.map(([date, label, amount, status]) => <div key={date + label} role="row" data-testid="page-row" {...(DEMO ? { tabIndex: 0, onClick: () => openRecord([date, label, amount, status]), onKeyDown: event => { if (event.key === 'Enter') openRecord([date, label, amount, status]); } } : {})} className={`flex items-center gap-3 border-b p-3 text-sm last:border-b-0 ${DEMO ? 'cursor-pointer hover:bg-muted/50' : ''}`}>
    <span className="w-12 shrink-0 text-muted-foreground">{date}</span><span className="min-w-0 flex-1 truncate">{label}</span>
    <span className={`hidden shrink-0 rounded-full px-2 py-0.5 text-xs sm:inline ${STATUS[status][1]}`}>{STATUS[status][0]}</span><span aria-label={STATUS[status][0]} className={`size-2 shrink-0 rounded-full sm:hidden ${status === 'ok' ? 'bg-emerald-500' : status === 'gap' ? 'bg-amber-500' : 'bg-muted-foreground'}`} /><span className="w-24 shrink-0 text-right tabular-nums">{amount}</span></div>)}</div>
</div>;
const Screen = (DEMO || params.get('page') === 'real') ? RealPage : Page;
const nav = [{ id: 'dossier', label: T('Dossier', 'File'), icon: DEMO ? FileTextIcon : Icon, render: () => <Screen /> },
  // `?tabs=1`: a second screen, so a phone shows its bottom tabs (AC-20).
  ...(params.get('tabs') === '1' ? [{ id: 'pieces', label: T('Pièces', 'Documents'), icon: DEMO ? FolderIcon : Icon, render: () => <Screen /> }] : [])];
const attachments = { upload: async files => files.map(file => ({ name: file.name, path: `uploads/${file.name}` })) };
const slash = { Picker: SlashPicker, commands: [{ name: 'relance', description: T('Rédiger une relance fictive.', 'Draft a fictional reminder.'), run: api => api.setText(T('Relance du dossier Cèdre', 'Reminder for the Cedar file')) }], skills: [] };
if (DEMO) slash.commands.push({ name: 'rapprocher', description: 'Rapprocher le relevé du mois.', run: api => api.setText('Rapproche le relevé de janvier') }, { name: 'resume', description: 'Résumer les écarts.', run: api => api.setText('Résume les écarts de janvier') });
const FILES = ['uploads/releve-janvier.pdf', 'uploads/ecarts-janvier.csv', 'uploads/releve-fevrier.pdf'];
// The app's navigator for « Bibliothèque » (an app would pass the kit's FileTreeView here); a pick opens the file in the same pane.
const library = onPicked => <ul data-testid="fixture-library" className="m-0 flex list-none flex-col gap-1 p-2">{FILES.map(path => <li key={path}>
  <button type="button" data-testid="fixture-library-file" data-path={path} className="w-full rounded-md p-2 text-left text-sm hover:bg-accent" onClick={() => { window.__library += 1; onOpenFile(path); onPicked(); }}>{path.split('/').at(-1)}</button></li>)}</ul>;
// K-3, K-4, K-5 (kit 0.4.85): the app's action on the reply card, its words while the agent works, and a whole set of words in « tu ».
window.__undone = 0;
const TU = { conversation: 'Ton fil', dictate: 'Dicte', listening: 'Je t’écoute…', releaseToSend: 'Relâche et j’envoie', answerHere: 'Ou réponds ici', sendFailed: 'Ton message n’est pas parti : il est revenu dans le champ.',
  placeholder: 'Dis-moi ce que tu as mangé', send: 'Envoie', stop: 'Arrête', attachFiles: 'Joins un fichier', retry: 'Réessaie', voiceStop: 'Arrête de m’écouter', voiceCancel: 'Annule', emptyTitle: 'Parle-moi', emptyDescription: 'Dis-moi ce que tu as mangé.' };
const agent = { controller, icon: DEMO ? SparklesIcon : Icon, label: 'Assistant', library: DEMO ? demoLibrary(onOpenFile) : library,
  ...(params.get('action') === '1' ? { replyAction: { label: 'Annuler', onSelect() { window.__undone += 1; } } } : {}),
  ...(params.get('status') === '1' ? { workingWords: ({ tool }) => tool === 'read' ? 'Max compte…' : 'Max réfléchit…' } : {}),
  ...(params.get('tu') === '1' ? { words: TU } : {}), ...(params.get('words') === '1' ? { words: { dictate: 'Parler', conversation: 'Le fil' } } : {}), ...(params.get('readonly') === '1' ? { readOnly: T('Lecture seule : votre rôle permet de lire, pas d’écrire (fictif).', 'Read only: your role may read, not write (fictional).') } : {}), voice: { transcribe: async () => 'Texte dicté fictif', send: 'draft' },
  // `?fork=1`: the host's conversations with fork and new (edit last, D3): `window.__forked` holds the entries forked at, `window.__new` counts new ones.
  chatProps: { ...(params.get('fork') === '1' ? { conversations: { items: [{ id: 'one-composer', title: 'Dossier Cèdre' }], activeId: 'one-composer', onSelect() {},
    onNew() { window.__new = (window.__new ?? 0) + 1; }, fork: async at => { (window.__forked ??= []).push(String(at)); } } } : {}), title: 'Assistant', locale: LOCALE, mentions: { kinds: { ecriture: { label: id => `Écriture ${id}`, icon: <Icon className="size-4" /> }, task: { label: id => id, icon: <Icon className="size-4" /> } } }, labels: { ...(params.get('tu') === '1' ? {} : { placeholder: T('Demandez, ou « / » pour une action', 'Ask anything, or « / » for an action') }) }, actions, attachments, slash, onOpenFile } };
const showEntries = entries => change({ view: { entries, docs: {} }, draft: { text: '', attachments: [], version: snapshot.draft.version + 1 } });
const App = () => { const conv = useDemoConversations(showEntries, history); const shellAgent = { ...agent, chatProps: { ...agent.chatProps, ...conv } };
  return <AppShell layout="screen" locale={LOCALE} title={DEMO ? 'Compta · Atelier Brun' : T('Compta fictive', 'Demo books')} nav={nav} route={{ id: 'dossier', onChange(id) { window.__route = id; } }} composer={params.get('composer') ?? 'bar'} rail="icon" agent={shellAgent}
  {...(params.get('single') === '1' ? { sidebar: false, account: { name: DEMO ? 'Julie Marchand' : 'Julie (fictive)', email: 'julie.marchand@example.test', signOut() {}, menu: [] } } : {})} />; };
createRoot(document.getElementById('root')).render(<App />);
