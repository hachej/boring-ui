import { useLayoutEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { AppShell } from '../../../registry/app-shell/app-shell.tsx';
import { useAgentLayer } from '../../../registry/app-shell/agent-layer.tsx';
import { SlashPicker } from '../../../registry/pi-chat-slash/slash-menu.tsx';

// D-2198: the real AppShell with `composer="bar"` (the one composer) in French, over a fake controller with fictional bookkeeping text.
// The test scripts the agent through `window.__run(kind)`: `tool` (a read with its progress), `form` (two questions), `reply` (the run ends
// with a reply that cites a file). `window.__answered` holds what the question card answered, `window.__sent` what the field sent.
// A cited file opens the fixture's own preview through `useAgentLayer().preview`. `?composer=content` is the previous mode, `?dark=1` the dark theme.
const params = new URLSearchParams(location.search);
if (params.get('dark') === '1') document.documentElement.classList.add('dark');
try { for (const key of Object.keys(localStorage)) if (key.startsWith('boring-ui:sidebar-agent-mode') || key.startsWith('boring.app-shell.agent.')) localStorage.removeItem(key); } catch { /* none */ }
window.__sent = [];
window.__answered = [];
const assistant = (content, stopReason = content.some(part => part.type === 'toolCall') ? 'toolUse' : 'stop') => ({ role: 'assistant', content, api: 'fictional', provider: 'fictional', model: 'fictional', usage: {}, stopReason, timestamp: 2 });
const entry = (id, model) => ({ id, kind: 'message', byTaskId: 7, model: [model] });
const say = (id, text) => ({ id, kind: 'message', model: [{ role: 'user', content: text, timestamp: 1 }] });
const reply = (id, text) => entry(id, assistant([{ type: 'text', text }]));
const history = [say(1, 'Où en est le dossier Cèdre ?'), reply(2, 'Le dossier Cèdre fictif attend deux pièces.')];
let snapshot = { identity: { runtimeId: 'fictional', scopeId: 'one-composer', principalId: 'fictional-reader' }, conversationId: 'one-composer', connection: { kind: 'connected' },
  view: { entries: history, docs: {} }, draft: { text: '', attachments: [], version: 0 }, outbox: [], echo: [], history: { kind: 'disabled' }, send: { kind: 'idle' }, stop: 'idle', disposed: false };
const listeners = new Set();
const change = patch => { snapshot = { ...snapshot, ...patch }; for (const listener of listeners) listener(); };
const controller = {
  getSnapshot: () => snapshot, subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener); },
  setText: text => change({ draft: { ...snapshot.draft, text, version: snapshot.draft.version + 1 } }),
  setAttachments: attachments => change({ draft: { ...snapshot.draft, attachments, version: snapshot.draft.version + 1 } }),
  send: async () => {
    const text = snapshot.draft.text;
    window.__sent.push(text);
    const next = snapshot.view.entries.length + 1;
    change({ draft: { text: '', attachments: [], version: snapshot.draft.version + 1 }, view: { entries: [...snapshot.view.entries, say(next, text), reply(next + 1, 'Réponse fictive : noté.')], docs: {} } });
  },
  connect: async () => {}, stop: async () => {}, dispose: async () => {}, clearHistory() {}, loadEarlier: async () => {}, reconcile: async () => {}, retrySameRequest: async () => {},
};
// The agent's scripted turns, after the person's question (entry 10).
const ask = say(10, 'Rapproche le relevé de janvier.');
const read = entry(11, assistant([{ type: 'toolCall', id: 'c1', name: 'read', arguments: { path: 'uploads/releve-janvier.pdf' } }]));
const readDone = { id: 12, kind: 'message', byTaskId: 8, model: [{ role: 'toolResult', toolCallId: 'c1', toolName: 'read', content: [{ type: 'text', text: '40 lignes' }], isError: false, timestamp: 3 }] };
const FORM = { question: 'Deux précisions', questions: [{ question: 'Quel exercice ?', options: ['2025', '2026'] }, { question: 'Quel journal ?', options: ['Achats', 'Ventes'] }] };
const form = entry(13, assistant([{ type: 'toolCall', id: 'q1', name: 'ask_user', arguments: FORM }]));
const REPLY = 'Le relevé de janvier compte 40 lignes, toutes rapprochées.\nDeux écarts sont notés dans @uploads/ecarts-janvier.csv.\nRien d’autre à faire pour janvier.\nUne quatrième ligne que la carte coupe.';
const live = tools => ({ 'pi.live': { run: { taskId: 7 }, ...(tools ? { tools } : {}) } });
const runs = {
  tool: () => ({ entries: [...history, ask, read], docs: live([{ callId: 'c1', taskId: 8, status: 'running', details: { progress: '12 lignes sur 40' } }]) }),
  form: () => ({ entries: [...history, ask, read, readDone, form], docs: live() }),
  reply: () => ({ entries: [...history, ask, read, readDone, entry(14, assistant([{ type: 'text', text: REPLY }]))], docs: {} }),
};
window.__run = kind => change({ view: runs[kind]() });
const actions = {
  answer: async (questionId, text) => { window.__answered.push({ questionId, text }); change({ view: runs.tool() }); return { kind: 'answered' }; },
};
const onOpenFile = path => window.__layer.preview({ title: path.split('/').at(-1), content: <div data-testid="fixture-preview" className="p-4 text-sm">Aperçu fictif de {path} : deux écarts de 12,00 €.</div> });
window.__openFile = onOpenFile;
const Icon = ({ className }) => <svg className={className} viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" fill="currentColor" /></svg>;
const Probe = () => { const api = useAgentLayer(); useLayoutEffect(() => { window.__layer = api; }); return null; };
const rows = Math.max(5, Number(params.get('rows') ?? 8));
const Page = () => <div data-testid="page" className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
  <Probe />
  <h1 className="text-lg font-medium">Dossier Cèdre (fictif)</h1>
  {Array.from({ length: rows }, (_, index) => <p key={index} role="row" data-testid="page-row" className="flex items-center justify-between rounded-md border p-3">Écriture {index + 1}<span>{(index + 1) * 12},00 €</span></p>)}
</div>;
const nav = [{ id: 'dossier', label: 'Dossier', icon: Icon, render: () => <Page /> }];
const attachments = { upload: async files => files.map(file => ({ name: file.name, path: `uploads/${file.name}` })) };
const slash = { Picker: SlashPicker, commands: [{ name: 'relance', description: 'Rédiger une relance fictive.', run: api => api.setText('Relance du dossier Cèdre') }], skills: [] };
const agent = { controller, icon: Icon, label: 'Assistant', voice: { transcribe: async () => 'Texte dicté fictif', send: 'draft' },
  chatProps: { title: 'Assistant', locale: 'fr', actions, attachments, slash, onOpenFile } };
createRoot(document.getElementById('root')).render(<AppShell layout="screen" locale="fr" title="Compta fictive" nav={nav} route={{ id: 'dossier', onChange() {} }} composer={params.get('composer') ?? 'bar'} rail="icon" agent={agent} />);
