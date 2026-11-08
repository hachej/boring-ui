import { createRoot } from 'react-dom/client';
import { PiChat } from '../../../registry/pi-chat/pi-chat.tsx';
import { withChatPlugins } from '../../../registry/pi-chat-plugins/chat-plugins.ts';

// D-1901: the real PiChat over a fake controller, in four states a person sees: empty, a reply with Markdown, a thought and a tool row, and streaming.
// Driven by the query string (?state=empty|reply|thought|streaming&theme=light|dark). Fictional text only.
const query = new URLSearchParams(location.search);
const state = query.get('state') ?? 'reply';
document.documentElement.classList.toggle('dark', query.get('theme') === 'dark');

const assistant = content => ({ role: 'assistant', content, api: 'fictional', provider: 'fictional', model: 'fictional', usage: {}, stopReason: 'stop', timestamp: 2 });
const entry = (id, model) => ({ id, kind: 'message', byTaskId: 100, model: [model] });
const user = id => entry(id, { role: 'user', content: 'Summarise the fictional visit notes.', timestamp: 1 });
const markdown = [
  '## Visit summary', '',
  'The patient reports **mild** symptoms. Run `check_notes` before the next visit; a longer answer wraps over several lines so the line height shows.', '',
  '- First fictional finding', '- Second fictional finding with `inline code`', '',
  '| Item | Value |', '| --- | --- |', '| Dose | 5 mg |', '| Interval | 8 h |', '',
  '```', 'const fictional = true;', '```',
].join('\n');
const call = { type: 'toolCall', id: 'a', name: 'read', arguments: { path: 'fictional/notes.md' } };
const result = { role: 'toolResult', toolCallId: 'a', toolName: 'read', content: [{ type: 'text', text: '{"fictional":true}' }], isError: false, timestamp: 2 };
const views = {
  empty: { entries: [], docs: {} },
  reply: { entries: [user(1), entry(2, assistant([{ type: 'text', text: markdown }]))], docs: {} },
  thought: { entries: [user(1), entry(2, assistant([{ type: 'thinking', thinking: 'Check the fictional notes first.' }, call])), entry(3, result), entry(4, assistant([{ type: 'text', text: 'Hi, what would you like me to work on?' }]))], docs: {} },
  streaming: { entries: [user(1)], docs: { 'pi.live': { run: { taskId: 100 }, generation: { message: { role: 'assistant', content: [{ type: 'text', text: 'The fictional notes say the visit was routine and that the' }] } } } },
};

function controller() {
  const snapshot = { identity: { runtimeId: 'fictional', scopeId: 'chat-text', principalId: 'fictional-reader' }, conversationId: 'chat-text', connection: { kind: 'connected' }, view: views[state], draft: { text: '', attachments: [], version: 0 }, outbox: [], echo: [], history: { kind: 'disabled' }, send: { kind: 'idle' }, stop: 'idle', disposed: false };
  return { getSnapshot: () => snapshot, subscribe: () => () => {}, setText() {}, setAttachments() {}, connect: async () => {}, send: async () => {}, stop: async () => {}, dispose: async () => {}, clearHistory() {}, loadEarlier: async () => {}, reconcile: async () => {}, retrySameRequest: async () => {} };
}

createRoot(document.getElementById('root')).render(<div className="h-dvh"><PiChat {...withChatPlugins({ controller: controller(), mode: 'developer', title: 'Assistant' })} /></div>);
