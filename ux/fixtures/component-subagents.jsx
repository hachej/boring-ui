import { createRoot } from 'react-dom/client';
import { SubagentActivityList } from '../../registry/pi-chat-subagent/subagent-card.tsx';
import { ChatTextProvider, defaultChatText } from '../../registry/pi-chat/labels.ts';
import { frenchChatLabels } from '../../registry/pi-chat/labels-fr.ts';

// Component scenario `component:subagents`: the kit's SubagentActivityList on a neutral page: three sub-agents of Harbor Studio (fictional) as one
// card each (running with its goal, what it does now, its last steps and counts; finished with its result; failed with its error), from a plain
// array of details the app keeps. Nothing is fetched. Query: dark=1, lang=fr (the kit's French labels; the app's own text stays as given), empty=1.
// `window.__ux`: opened (the conversation ids the cards opened).
const params = new URLSearchParams(location.search);
if (params.get('dark') === '1') document.documentElement.classList.add('dark');
window.__opened = [];
const fr = params.get('lang') === 'fr';
const text = fr
  ? { task: 'Retrouver les reçus de Hetzner, février', now: 'Recherche dans la boîte mail « Hetzner, février »', steps: ['Relevé de février lu : 41 lignes', 'Boîte mail ouverte', '3 courriels de Hetzner trouvés'], counts: [{ label: 'trouvées', value: 12 }, { label: 'manquantes', value: 40 }],
    task2: 'Lire le relevé de mars', steps2: ['Relevé de mars ouvert', '12 lignes lues', '2 lignes sans pièce notées'], result: 'Les 12 lignes du relevé de mars sont lues ; 2 factures de Brown & Fils n’ont pas de pièce.', task3: 'Chercher les reçus de Brown & Fils', steps3: ['Recherche dans la boîte mail'], error: 'La boîte mail ne répond pas.' }
  : { task: 'Find the Hetzner receipts, February', now: 'Searching the mailbox for “Hetzner, February”', steps: ['February statement read: 41 lines', 'Mailbox opened', '3 Hetzner emails found'], counts: [{ label: 'found', value: 12 }, { label: 'missing', value: 40 }],
    task2: 'Read the March statement', steps2: ['March statement opened', '12 lines read', '2 lines without a receipt noted'], result: 'The 12 lines of the March statement are read; 2 invoices from Brown & Sons have no receipt.', task3: 'Look for the Brown & Sons receipts', steps3: ['Searched the mailbox'], error: 'The mailbox did not answer.' };
const base = { version: 1, kind: 'boring.delegate', tokens: { input: 1200, output: 340 } };
const now = Date.now();
const runs = params.get('empty') === '1' ? [] : [
  { ...base, agent: fr ? 'Lecteur' : 'Reader', conversationId: 40, status: 'done', startedAt: now - 600_000, durationMs: 38_000, toolCalls: 3, task: text.task2, steps: text.steps2, result: text.result },
  { ...base, agent: fr ? 'Chercheur' : 'Researcher', conversationId: 39, status: 'failed', startedAt: now - 900_000, durationMs: 9_000, toolCalls: 1, task: text.task3, steps: text.steps3, error: text.error },
  { ...base, agent: fr ? 'Rapprocheur' : 'Matcher', conversationId: 41, status: 'running', startedAt: now - 72_000, durationMs: 72_000, toolCalls: 5, task: text.task, now: text.now, steps: text.steps, counts: text.counts },
];
const value = { ...defaultChatText, labels: fr ? frenchChatLabels : defaultChatText.labels };
createRoot(document.getElementById('root')).render(<ChatTextProvider value={value}>
  <main className="mx-auto flex min-h-dvh max-w-xl flex-col gap-3 bg-background p-4">
    <h1 data-testid="title" className="m-0 text-sm font-semibold">{fr ? 'Sous-agents de Harbor Studio (fictif)' : 'Sub-agents of Harbor Studio (fictional)'}</h1>
    <SubagentActivityList runs={runs} onOpen={id => { window.__opened.push(id); }} />
  </main>
</ChatTextProvider>);
window.__ux = { opened: () => window.__opened.slice() };
