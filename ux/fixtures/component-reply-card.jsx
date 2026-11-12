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
const ASK = { question: 'Quel mois dois-je rapprocher en premier ?', options: ['Janvier', 'Février', 'Les deux'] };
const FORM = { question: 'Deux précisions pour Atelier Brun', questions: [{ question: 'Quel exercice ?', options: ['2025', '2026'] }, { question: 'Quel journal ?', options: ['Achats', 'Ventes'] }] };
const asked = (args) => [say(1, 'Rapproche le relevé de la banque.'), entry(2, asst([{ type: 'toolCall', id: 'q1', name: 'ask_user', arguments: args }], 'toolUse'))];
const answered = (args, answer) => [...asked(args), result(3, 'q1', 'ask_user', JSON.stringify({ kind: 'answered', answer }))];
const TEXT = 'Le relevé de janvier compte 40 lignes, toutes rapprochées.\n\nDeux écarts de 12,00 € sont notés dans le fichier ci-dessous : **Garage du Port** (09/01) et **Restaurant Le Cèdre** (15/01).';
const replied = [say(1, 'Rapproche le relevé de janvier.'), entry(2, asst([{ type: 'toolCall', id: 'w1', name: 'write', arguments: { path: 'uploads/ecarts-janvier.csv', content: 'date;libellé;écart' } }], 'toolUse')),
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
  setTimeout(() => change({ view: { entries: [...snapshot.view.entries, entry(31, asst([{ type: 'text', text: 'Merci, je commence par là et je vous préviens quand c’est fini.' }]))], docs: {} } }), 500);
  return { kind: 'answered' };
} };
const cards = { question: QuestionCard };

function Inline() {
  const [done, setDone] = useState();
  return <div data-testid="inline-surface" className="w-full max-w-md rounded-xl border bg-background p-4 shadow-sm">
    <InlineQuestion id="q-delorme" kind="question" tone="attention" source="Assistant · Atelier Brun" text="La facture Maison Delorme du 12/01 est en retard de 19 jours. Que fait-on ?"
      options={[{ label: 'Relancer par e-mail', recommended: true }, 'Appeler le client', 'Attendre']} {...(done ? { answered: done } : {})}
      onAnswer={(_id, value) => { window.__answers.push(value); setDone(value); }} onReplyInChat={() => { window.__answers.push('chat'); }}
      labels={{ question: 'Question', send: 'Répondre', placeholder: 'Votre réponse', placeholderMore: 'Ou écrivez une réponse', replyInChat: 'Répondre dans le chat', answered: 'Répondu' }} />
  </div>;
}

const App = () => <main className="flex min-h-dvh items-center justify-center bg-muted/30 p-4 sm:p-8">
  {Q === 'inline' ? <Inline /> : <div data-testid="surface" className="flex h-[30rem] w-full max-w-xl flex-col overflow-hidden rounded-xl border bg-background shadow-sm">
    <PiChat controller={controller} locale="fr" header={false} showHistory={false} renderText={markdownText} cards={cards} actions={actions} fileChanges onOpenFile={path => { window.__opened.push(path); }}
      renderComposer={() => null} />
  </div>}
</main>;
window.__ux = { opened: () => window.__opened.length, answers: () => window.__answers.slice() };
createRoot(document.getElementById('root')).render(<App />);
