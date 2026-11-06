// The needs-you blocks (InlineQuestion, then StatusNarrative, SpaceCard) bundled as an app bundles them: the `@/components/ui`
// names resolve to the shadcn fixtures, the relative imports to the registry folders. Each is rendered to static markup and checked.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = fileURLToPath(new URL('../../', import.meta.url));
const shadcn = join(root, 'examples/app-shell/components/ui');
const utils = join(root, 'examples/app-shell/lib/utils.ts');

const entry = `
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement as h } from 'react';
import { InlineQuestion, DECISION_VALUES } from '${join(root, 'registry/inline-question/inline-question.tsx')}';
import { StatusNarrative } from '${join(root, 'registry/status-narrative/status-narrative.tsx')}';
import { QuestionCard } from '${join(root, 'registry/pi-chat-question/question-card.tsx')}';
export { DECISION_VALUES };
const on = () => {};
export const html = {
  decision: () => renderToStaticMarkup(h(InlineQuestion, { id: 'm', kind: 'decision', text: 'Merge #1691?', source: 'factory master', onAnswer: on })),
  question: () => renderToStaticMarkup(h(InlineQuestion, { id: 'p', kind: 'question', text: 'Day 30 or day 45?', options: ['Day 30', 'Day 45'], onAnswer: on, onReplyInChat: on })),
  free: () => renderToStaticMarkup(h(InlineQuestion, { id: 'f', kind: 'question', text: 'Which month?', onAnswer: on })),
  doneDecision: () => renderToStaticMarkup(h(InlineQuestion, { id: 'm', kind: 'decision', text: 'Merge #1691?', answered: 'approve', onAnswer: on })),
  doneFr: (answered) => renderToStaticMarkup(h(InlineQuestion, { id: 'm', kind: 'decision', text: 'Fusionner #1691 ?', answered, labels: { approve: 'Approuver', refuse: 'Refuser', approved: 'Approuvé', refused: 'Refusé', answered: 'Répondu' }, onAnswer: on })),
  openFr: () => renderToStaticMarkup(h(InlineQuestion, { id: 'm', kind: 'decision', text: 'Fusionner #1691 ?', labels: { approve: 'Approuver', refuse: 'Refuser' }, onAnswer: on })),
  doneQuestion: () => renderToStaticMarkup(h(InlineQuestion, { id: 'p', kind: 'question', text: 'Day 30 or day 45?', answered: 'Day 45', onAnswer: on })),
  narr: () => renderToStaticMarkup(h(StatusNarrative, { segments: ['1 agent works on ', { label: 'the supplier import', task: 'D-1511' }, '. Nothing else is open.'], at: '2 min ago', by: 'router', needsYou: 3, onOpen: on, onRefresh: on })),
  narrBare: () => renderToStaticMarkup(h(StatusNarrative, { segments: ['All quiet. ', { label: 'Compta', app: 'compta' }] })),
  narrOne: () => renderToStaticMarkup(h(StatusNarrative, { segments: ['x'], needsYou: 1 })),
  narrFr: () => renderToStaticMarkup(h(StatusNarrative, { segments: ['x'], needsYou: 2, onRefresh: on, labels: { needsYou: n => n + ' à traiter', refresh: 'Actualiser' } })),
  waitingQuestion: () => renderToStaticMarkup(h(QuestionCard, { call: { type: 'toolCall', id: 'c1', name: 'ask_user', arguments: { question: 'Day 30 or day 45?', options: ['Day 30', 'Day 45'] } }, result: undefined, questionId: 'q1', answer: async () => ({ kind: 'answered' }) })),
  many: () => renderToStaticMarkup(h(InlineQuestion, { id: 'x', kind: 'question', text: 'Which file?', options: ['a', 'b', 'c', 'd', 'e'], onAnswer: on })),
};
`;

const dir = mkdtempSync(join(tmpdir(), 'pattern-blocks-'));
const entryFile = join(dir, 'entry.tsx');
const outfile = join(dir, 'bundle.cjs');
const plugin = {
  name: 'app-aliases',
  setup(b) {
    b.onResolve({ filter: /^@\/components\/ui\/(.+)$/ }, args => ({ path: join(shadcn, `${args.path.split('/').pop()}.tsx`) }));
    b.onResolve({ filter: /^@\/lib\/utils$/ }, () => ({ path: utils }));
  },
};

await build({
  stdin: { contents: entry, resolveDir: root, loader: 'tsx', sourcefile: entryFile },
  bundle: true, format: 'cjs', platform: 'node', outfile, write: true, logLevel: 'silent', jsx: 'automatic', plugins: [plugin],
  absWorkingDir: root,
});
const mod = createRequire(import.meta.url)(outfile);
test.after(() => rmSync(dir, { recursive: true, force: true }));
const { html } = mod;

test('a decision is approve or refuse on an info tint, with no text field and no border', () => {
  const markup = html.decision();
  assert.match(markup, /Decision/); assert.match(markup, />Approve</); assert.match(markup, />Refuse</);
  assert.match(markup, /bg-info-soft/); assert.doesNotMatch(markup, /<input/);
  const box = /^<div[^>]*class="([^"]*)"/.exec(markup)[1];
  assert.doesNotMatch(box, /\bborder\b|shadow|ring/, 'the block draws no border of its own');
  assert.match(markup, /min-h-11 md:min-h-8/, '44px on phones');
});

test('a question with options offers the choices, a free-text field and reply in chat, on a warning tint', () => {
  const markup = html.question();
  assert.match(markup, /Day 30/); assert.match(markup, /Day 45/); assert.match(markup, /Reply in chat/);
  assert.match(markup, /<input[^>]*placeholder="Or type an answer"/); assert.match(markup, /bg-warning-soft/);
});

test('a question without options is free text only', () => {
  const markup = html.free();
  assert.match(markup, /<input[^>]*placeholder="Type your answer"/);
  assert.equal((markup.match(/<button/g) ?? []).length, 1, 'only Send');
});

test('answered: the controls give way to the answer, muted; a decision says approved or refused', () => {
  assert.doesNotMatch(html.doneDecision(), /<button|<input/); assert.match(html.doneDecision(), /Approved/);
  assert.match(html.doneQuestion(), /Answered: Day 45/); assert.doesNotMatch(html.doneQuestion(), /bg-warning-soft/);
});

test('a question shows at most four choices', () => {
  const markup = html.many();
  assert.match(markup, />d</); assert.doesNotMatch(markup, />e</);
});

test('needs-you blocks never fetch: props in, callbacks out', async () => {
  const { readFileSync } = await import('node:fs');
  const source = readFileSync(join(root, 'registry/inline-question/inline-question.tsx'), 'utf8');
  assert.doesNotMatch(source, /\bfetch\s*\(|XMLHttpRequest|useEffect|localStorage/);
});

test('a decision answers with stable values, never translated labels', () => {
  assert.deepEqual(mod.DECISION_VALUES, ['approve', 'refuse']);
  const open = html.openFr();
  assert.match(open, />Approuver</); assert.match(open, />Refuser</, 'the buttons say the translated words');
});

test('an answered decision reads by value under overridden labels; an unknown value is neutral, not Refused', () => {
  assert.match(html.doneFr('approve'), /Approuvé/);
  assert.match(html.doneFr('refuse'), /Refusé/);
  const other = html.doneFr('approved');
  assert.doesNotMatch(other, /Refusé|Approuvé/);
  assert.match(other, /Répondu: approved/);
});

test('a status narrative shows text and links in order, the time and author, one needs-you count and a refresh', () => {
  const markup = html.narr();
  assert.match(markup, /1 agent works on <\/span><button[^>]*>the supplier import<\/button><span>\. Nothing else is open\./);
  assert.match(markup, /2 min ago/); assert.match(markup, />router</); assert.match(markup, /3 need you/);
  assert.match(markup, /aria-label="Refresh status"/); assert.match(markup, /bg-warning-soft/);
  assert.equal(html.narrOne().includes('1 needs you'), true);
});

test('a status narrative without handlers shows links as plain emphasis; with no count there is no pill and no clock is read', () => {
  const markup = html.narrBare();
  assert.doesNotMatch(markup, /<button/); assert.match(markup, /Compta/); assert.doesNotMatch(markup, /need you|needs you/);
  const fr = html.narrFr();
  assert.match(fr, /2 à traiter/); assert.match(fr, /aria-label="Actualiser"/);
});

test('a waiting chat question renders through InlineQuestion: a flat warning tint, choices and free text, test ids kept', () => {
  const markup = html.waitingQuestion();
  const inner = /<div role="group" aria-label="Day 30 or day 45\?" class="([^"]*)"/.exec(markup);
  assert.ok(inner, 'the InlineQuestion group is there');
  assert.match(inner[1], /bg-\(--chat-warning-soft\)/); assert.doesNotMatch(inner[1], /\bborder\b|shadow|ring/);
  assert.doesNotMatch(markup, /data-slot="card"/);
  for (const id of ['question-card', 'question-text', 'question-option', 'question-input', 'question-submit']) assert.match(markup, new RegExp('data-testid="' + id + '"'), id);
  assert.match(markup, /data-option="Day 45"/);
});

test('untrusted question text and choices wrap inside a narrow chat; no empty notice row when there is nothing to say', () => {
  const markup = html.waitingQuestion();
  const text = /<span[^>]*data-testid="question-text"[^>]*class="([^"]*)"|<span[^>]*class="([^"]*)"[^>]*data-testid="question-text"/.exec(markup);
  const textClass = text ? text[1] ?? text[2] : '';
  assert.match(textClass, /\[overflow-wrap:anywhere\]/); assert.match(textClass, /min-w-0/);
  const options = [...markup.matchAll(/<button[^>]*data-testid="question-option"[^>]*>/g)].map(m => m[0]);
  assert.ok(options.length >= 2);
  for (const option of options) { assert.match(option, /max-w-full/); assert.match(option, /\[overflow-wrap:anywhere\]/); }
  assert.doesNotMatch(markup, /<div class="text-sm"><\/div>/, 'no empty notice row');
  assert.doesNotMatch(markup, /<div class="text-sm">\s*<\/div>/);
});

test('in the chat the waiting question tints with the --chat-* tokens, so a host without the opt-in theme keeps its tint', () => {
  const markup = html.waitingQuestion();
  assert.match(markup, /bg-\(--chat-warning-soft\)/); assert.match(markup, /text-\(--chat-warning-soft-foreground\)/);
  assert.doesNotMatch(markup, /bg-warning-soft|text-warning-soft-foreground/, 'cn replaced the default tint, nothing of it is left');
  assert.doesNotMatch(readFileSync(join(root, 'registry/pi-chat-question/question-card.tsx'), 'utf8'), /\bbg-warning-soft|\btext-warning-soft-foreground/, 'the form uses the --chat-* tokens too');
});

test('status narrative never fetches or reads a clock', async () => {
  const { readFileSync } = await import('node:fs');
  const source = readFileSync(join(root, 'registry/status-narrative/status-narrative.tsx'), 'utf8');
  assert.doesNotMatch(source, /\bfetch\s*\(|XMLHttpRequest|useEffect|localStorage|Date\.now|new Date/);
});
