import { createRoot } from 'react-dom/client';
import { PiChat } from '../../registry/pi-chat/pi-chat.tsx';
import { markdownText } from '../../registry/pi-chat-markdown/markdown.tsx';
import { SlashPicker } from '../../registry/pi-chat-slash/slash-menu.tsx';
import { voiceMessagePlugin } from '../../registry/pi-chat-voice/voice-message.tsx';

// Component scenario `component:message-field`: the kit's message field (the Composer inside PiChat, layout 'pill') alone on a neutral page,
// over a fake controller. Nothing here is a model: the reply to a send is a fixed sentence after a short wait.
// Query: dark=1 (dark theme), pace=instant|real (the wait before the reply), readonly=1 (the host's read-only note instead of the field),
// working=1 (starts with a run in progress), text=... (a draft already typed). `window.__ux`: failNext, setText, sent.
const params = new URLSearchParams(location.search);
if (params.get('dark') === '1') document.documentElement.classList.add('dark');
const FAST = params.get('pace') === 'instant';
window.__sent = [];

// A fake microphone: one chunk when it stops, so a tap on the microphone really records and the transcript comes back as a draft.
Object.defineProperty(window, 'AudioContext', { configurable: true, value: undefined });
Object.defineProperty(window, 'webkitAudioContext', { configurable: true, value: undefined });
Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: async () => { const track = { stop() {} }; return { getTracks: () => [track], getAudioTracks: () => [track] }; } } });
window.MediaRecorder = class extends EventTarget {
  static isTypeSupported() { return true; }
  constructor() { super(); this.state = 'inactive'; this.mimeType = 'audio/webm'; }
  start() { this.state = 'recording'; }
  stop() { this.state = 'inactive'; const chunk = new Event('dataavailable'); chunk.data = new Blob(['audio fictif'], { type: 'audio/webm' }); this.dispatchEvent(chunk); this.dispatchEvent(new Event('stop')); }
};

const model = (role, content, extra = {}) => ({ role, content, timestamp: 1, ...extra });
const say = (id, text) => ({ id, kind: 'message', model: [model('user', text)] });
const reply = id => ({ id, kind: 'message', byTaskId: 7, model: [model('assistant', [{ type: 'text', text: 'Bien reçu : je relance Maison Delorme et je vous préviens dès sa réponse.' }], { api: 'fictional', provider: 'fictional', model: 'fictional', usage: {}, stopReason: 'stop' })] });
const live = { 'pi.live': { run: { taskId: 7 } } };
let snapshot = { identity: { runtimeId: 'fictional', scopeId: 'message-field', principalId: 'julie' }, conversationId: 'message-field', connection: { kind: 'connected' },
  view: { entries: params.get('working') === '1' ? [say(1, 'Rapproche le relevé de janvier')] : [], docs: params.get('working') === '1' ? live : {} },
  draft: { text: params.get('text') ?? '', attachments: [], version: 0 }, outbox: [], echo: [], history: { kind: 'disabled' }, send: { kind: 'idle' }, stop: 'idle', disposed: false };
const listeners = new Set();
const change = patch => { snapshot = { ...snapshot, ...patch }; for (const listener of listeners) listener(); };
const draft = patch => change({ draft: { ...snapshot.draft, ...patch, version: snapshot.draft.version + 1 } });
let next = 10;
const controller = {
  getSnapshot: () => snapshot, subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener); },
  setText: text => draft({ text }), setAttachments: attachments => draft({ attachments }),
  send: async (_kind, content) => {
    const text = content?.text ?? snapshot.draft.text;
    // A refused send, as a real controller: the text stays in the field and `send` says why.
    if (window.__failNext) { window.__failNext = false; change({ send: { kind: 'blocked', reason: 'Hors ligne : le message n’est pas parti.' } }); return undefined; }
    window.__sent.push(text);
    const asked = [...snapshot.view.entries, say(++next, text)];
    change({ send: { kind: 'idle' }, draft: { text: '', attachments: [], version: snapshot.draft.version + 1 }, view: { entries: asked, docs: live } });
    setTimeout(() => change({ view: { entries: [...asked, reply(++next)], docs: {} } }), FAST ? 400 : 1500);
    return undefined;
  },
  connect: async () => {}, stop: async () => { change({ view: { entries: snapshot.view.entries, docs: {} } }); }, dispose: async () => {}, clearHistory() {}, loadEarlier: async () => {}, reconcile: async () => {}, retrySameRequest: async () => {},
};
window.__ux = { failNext: () => { window.__failNext = true; }, setText: text => controller.setText(text), sent: () => window.__sent.length };

const slash = { Picker: SlashPicker, commands: [
  { name: 'relance', description: 'Rédiger une relance client.', run: api => api.setText('Relance pour la facture de janvier de Maison Delorme') },
  { name: 'rapprocher', description: 'Rapprocher le relevé du mois.', run: api => api.setText('Rapproche le relevé de janvier') },
  { name: 'resume', description: 'Résumer les écarts.', run: api => api.setText('Résume les écarts de janvier') }], skills: [] };
const attachments = { upload: async files => files.map(file => ({ name: file.name, path: `uploads/${file.name}` })) };
const readOnly = <p data-testid="agent-read-only" className="m-0 flex min-h-14 items-center rounded-xl border bg-muted/40 px-4 text-sm text-muted-foreground">Lecture seule : votre rôle permet de lire le dossier Atelier Brun, pas d’écrire.</p>;

const App = () => <main className="flex min-h-dvh items-center justify-center bg-muted/30 p-4 sm:p-8">
  <div data-testid="surface" className="flex h-[26rem] w-full max-w-xl flex-col overflow-hidden rounded-xl border bg-background shadow-sm">
    <PiChat controller={controller} locale="fr" header={false} showHistory={false} emptyState={<div />} emptyLayout="docked" composerLayout="pill" composerBarActions="attach" composerFileChips renderText={markdownText}
      labels={{ placeholder: 'Écrivez ici ou « / »' }} slash={slash} attachments={attachments} voiceMessage={{ transcribe: async () => 'Relance Maison Delorme pour la facture de janvier.', ...voiceMessagePlugin }} voiceReplacesSend
      {...(params.get('readonly') === '1' ? { renderComposer: () => readOnly } : {})} />
  </div>
</main>;
createRoot(document.getElementById('root')).render(<App />);
