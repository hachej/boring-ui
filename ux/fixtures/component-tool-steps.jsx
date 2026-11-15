import { createRoot } from 'react-dom/client';
import { PiChat } from '../../registry/pi-chat/pi-chat.tsx';
import { AppShell } from '../../registry/app-shell/app-shell.tsx';
import { SparklesIcon } from '../../registry/_shared/icons';
import { createScriptedAgent } from './scripted-agent.mjs';
import script from '../scenarios/scripts/tool-steps.json';

// Component scenario `component:tool-steps`: the chat's tool steps with `toolDetails`, alone on a neutral page, over the scripted agent (no model, no network).
// Query: dark=1, pace, details=none (default) | auto, seed=1 (the conversation already holds a failed step), words=1 (the host's own sentence, a function of the tool),
// chatMode=developer (the kit's own switch), shell=1 (the same chat inside the app shell's agent layer: `agent.chatProps` carries the prop).
// `window.__ux`: sent (what the field sent).
const params = new URLSearchParams(location.search);
if (params.get('dark') === '1') document.documentElement.classList.add('dark');
// The kit's developer switch keeps itself in this browser; a scenario state must not inherit it from an earlier one.
try { if (!params.get('chatMode')) localStorage.removeItem('boring-ui:chat-mode'); } catch { /* none */ }
const DETAILS = params.get('details') === 'auto' ? 'auto' : 'none';
window.__sent = [];

const asst = (content, stopReason) => ({ role: 'assistant', content, api: 'fictional', provider: 'fictional', model: 'fictional', usage: {}, stopReason, timestamp: 2 });
const entry = (id, model, byTaskId = 7) => ({ id, kind: 'message', byTaskId, model: [model] });
const say = (id, text) => ({ id, kind: 'message', model: [{ role: 'user', content: text, timestamp: 1 }] });
const failed = [say(1, 'Find the Brown & Sons invoice.'),
  entry(2, asst([{ type: 'toolCall', id: 'f1', name: 'bash', arguments: { command: 'grep -r invoice-0121 /srv/ledger_fictional/ --include=*.csv' } }], 'toolUse')),
  entry(3, { role: 'toolResult', toolCallId: 'f1', toolName: 'bash', content: [{ type: 'text', text: "Traceback (most recent call last): File ledger_fictional.py, line 41, KeyError: 'invoice-0121'" }], isError: true, timestamp: 3 }, 8)];
const START = params.get('seed') === '1' ? failed : [];

let snapshot = { identity: { runtimeId: 'fictional', scopeId: 'tool-steps', principalId: 'julie' }, conversationId: 'tool-steps', connection: { kind: 'connected' },
  view: { entries: START, docs: {} }, draft: { text: '', attachments: [], version: 0 }, outbox: [], echo: [], history: { kind: 'disabled' }, send: { kind: 'idle' }, stop: 'idle', disposed: false };
const listeners = new Set();
const change = patch => { snapshot = { ...snapshot, ...patch }; for (const listener of listeners) listener(); };
const scripted = createScriptedAgent({ script, pace: params.get('pace') === 'instant' ? 0.15 : 1, entries: () => snapshot.view.entries, show: (entries, docs) => change({ view: { entries, docs } }) });
let sent = 100;
const controller = {
  getSnapshot: () => snapshot, subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener); },
  setText: text => change({ draft: { ...snapshot.draft, text, version: snapshot.draft.version + 1 } }),
  setAttachments() {},
  send: async () => {
    const text = snapshot.draft.text;
    window.__sent.push(text);
    change({ send: { kind: 'idle' }, draft: { text: '', attachments: [], version: snapshot.draft.version + 1 }, view: { entries: [...snapshot.view.entries, say(++sent, text)], docs: { 'pi.live': { run: { taskId: 7 } } } } });
    void scripted.say(text);
    return undefined;
  },
  connect: async () => {}, stop: async () => { scripted.stop(); }, dispose: async () => {}, clearHistory() {}, loadEarlier: async () => {}, reconcile: async () => {}, retrySameRequest: async () => {},
};

const words = params.get('words') === '1' ? { labels: { toolFailedSummary: tool => `${tool === 'bash' ? 'The search' : 'This step'} did not finish. I will say what is next.` } } : {};
const nav = [{ id: 'file', label: 'File', icon: SparklesIcon, render: () => <div data-testid="page" className="p-4 text-sm">Harbor file (fictional)</div> }];
const Shell = () => <AppShell layout="screen" locale="en" title="Harbor Studio (fictional)" nav={nav} route={{ id: 'file', onChange() {} }} composer="bar" sidebar={false}
  agent={{ controller, icon: SparklesIcon, label: 'Assistant', chatProps: { locale: 'en', toolDetails: DETAILS, ...words } }} />;
const App = () => params.get('shell') === '1' ? <Shell /> : <main className="flex min-h-dvh items-center justify-center bg-muted/30 p-4 sm:p-8">
  <div data-testid="surface" className="flex h-[34rem] w-full max-w-xl flex-col overflow-hidden rounded-xl border bg-background shadow-sm">
    <PiChat controller={controller} locale="en" header={false} showHistory={false} toolDetails={DETAILS} {...words} />
  </div>
</main>;
window.__ux = { sent: () => window.__sent.slice() };
createRoot(document.getElementById('root')).render(<App />);
