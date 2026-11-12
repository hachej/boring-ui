import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { PiChat } from '../../registry/pi-chat/pi-chat.tsx';
import { markdownText } from '../../registry/pi-chat-markdown/markdown.tsx';
import { QuestionCard } from '../../registry/pi-chat-question/question-card.tsx';
import { InlineQuestion } from '../../registry/inline-question/inline-question.tsx';

// Component scenario `component:reply-card`: what shows a reply or a question, alone on a neutral page. The folded reply card of the bar layout
// (FoldedCard in registry/app-shell/agent-layer.tsx) is internal and not exported, so it is NOT rendered here: this mounts the closest exported
// things, PiChat's message list (a reply, its file chip) with the question card (pi-chat-question) and the stand-alone InlineQuestion.
// Query: dark=1, pace (ignored), q=ask (default) | answered | reply | form | inline. `window.__ux`: opened (the paths the file chip opened), answers.
const params = new URLSearchParams(location.search);
if (params.get('dark') === '1') document.documentElement.classList.add('dark');
const Q = params.get('q') ?? 'ask';
window.__opened = []; window.__answers = [];

const asst = (content, stopReason = 'stop') => ({ role: 'assistant', content, api: 'fictional', provider: 'fictional', model: 'fictional', usage: {}, stopReason, timestamp: 2 });
const entry = (id, model, byTaskId = 7) => ({ id, kind: 'message', byTaskId, model: [model] });
const say = (id, text) => ({ id, kind: 'message', model: [{ role: 'user', content: text, timestamp: 1 }] });
const result = (id, call, name, text) => entry(id, { role: 'toolResult', toolCallId: call, toolName: name, content: [{ type: 'text', text }], isError: false, timestamp: 3 }, 8);
const ASK = { question: 'Which month should I reconcile first?', options: ['January', 'February', 'Both'] };
const FORM = { question: 'Two details for Harbor Studio', questions: [{ question: 'Which year?', options: ['2025', '2026'] }, { question: 'Which journal?', options: ['Purchases', 'Sales'] }] };
const asked = (args) => [say(1, 'Reconcile the bank statement.'), entry(2, asst([{ type: 'toolCall', id: 'q1', name: 'ask_user', arguments: args }], 'toolUse'))];
const answered = (args, answer) => [...asked(args), result(3, 'q1', 'ask_user', JSON.stringify({ kind: 'answered', answer }))];
const TEXT = 'The January statement has 40 lines, all reconciled.\n\nTwo discrepancies of $12.00 are noted in the file below: **Harbor Garage** (Jan 9) and **The Cedar Diner** (Jan 15).';
const replied = [say(1, 'Reconcile the January statement.'), entry(2, asst([{ type: 'toolCall', id: 'w1', name: 'write', arguments: { path: 'uploads/discrepancies-january.csv', content: 'date;label;gap' } }], 'toolUse')),
  result(3, 'w1', 'write', 'ok'), entry(4, asst([{ type: 'text', text: TEXT }]))];
const START = { ask: asked(ASK), answered: answered(ASK, 'Janvier'), form: asked(FORM), reply: replied }[Q] ?? asked(ASK);

let snapshot = { identity: { runtimeId: 'fictional', scopeId: 'reply-card', principalId: 'julie' }, conversationId: 'reply-card', connection: { kind: 'connected' },
  view: { entries: START, docs: Q === 'ask' || Q === 'form' ? { 'pi.live': { run: { taskId: 7 } } } : {} }, draft: { text: '', attachments: [], version: 0 }, outbox: [], echo: [], history: { kind: 'disabled' }, send: { kind: 'idle' }, stop: 'idle', disposed: false };
const listeners = new Set();
const change = patch => { snapshot = { ...snapshot, ...patch }; for (const listener of listeners) listener(); };
const controller = {
  getSnapshot: () => snapshot, subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener); },
  setText() {}, setAttachments() {}, send: async () => undefined, connect: async () => {}, stop: async () => {}, dispose: async () => {}, clearHistory() {}, loadEarlier: async () => {}, reconcile: async () => {}, retrySameRequest: async () => {},
};
// The host's answer: the question gets its result, then the agent replies. No model.
const actions = { answer: async (_id, text) => {
  window.__answers.push(text);
  const base = snapshot.view.entries;
  change({ view: { entries: [...base, result(30, 'q1', 'ask_user', JSON.stringify({ kind: 'answered', answer: text }))], docs: {} } });
  setTimeout(() => change({ view: { entries: [...snapshot.view.entries, entry(31, asst([{ type: 'text', text: 'Thanks, I will start there and tell you when it is done.' }]))], docs: {} } }), 500);
  return { kind: 'answered' };
} };
const cards = { question: QuestionCard };

function Inline() {
  const [done, setDone] = useState();
  return <div data-testid="inline-surface" className="w-full max-w-md rounded-xl border bg-background p-4 shadow-sm">
    <InlineQuestion id="q-delmore" kind="question" tone="attention" source="Assistant · Harbor Studio" text="The Delmore House invoice of Jan 12 is 19 days late. What should we do?"
      options={[{ label: 'Send a reminder by e-mail', recommended: true }, 'Call the customer', 'Wait']} {...(done ? { answered: done } : {})}
      onAnswer={(_id, value) => { window.__answers.push(value); setDone(value); }} onReplyInChat={() => { window.__answers.push('chat'); }}
      labels={{ question: 'Question', send: 'Reply', placeholder: 'Your answer', placeholderMore: 'Or write your own answer', replyInChat: 'Reply in chat', answered: 'Answered' }} />
  </div>;
}

const App = () => <main className="flex min-h-dvh items-center justify-center bg-muted/30 p-4 sm:p-8">
  {Q === 'inline' ? <Inline /> : <div data-testid="surface" className="flex h-[30rem] w-full max-w-xl flex-col overflow-hidden rounded-xl border bg-background shadow-sm">
    <PiChat controller={controller} locale="en" header={false} showHistory={false} renderText={markdownText} cards={cards} actions={actions} fileChanges onOpenFile={path => { window.__opened.push(path); }}
      renderComposer={() => null} />
  </div>}
</main>;
window.__ux = { opened: () => window.__opened.length, answers: () => window.__answers.slice() };
createRoot(document.getElementById('root')).render(<App />);
