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
  decisionAttention: () => renderToStaticMarkup(h(InlineQuestion, { id: 'm', kind: 'decision', text: 'Merge #1691?', tone: 'attention', onAnswer: on })),
  questionAttention: () => renderToStaticMarkup(h(InlineQuestion, { id: 'p', kind: 'question', text: 'Day 30 or day 45?', options: ['Day 30', 'Day 45'], tone: 'attention', onAnswer: on, onReplyInChat: on })),
  doneQuestionAttention: () => renderToStaticMarkup(h(InlineQuestion, { id: 'p', kind: 'question', text: 'Day 30 or day 45?', answered: 'Day 45', tone: 'attention', onAnswer: on })),
  doneQuestion: () => renderToStaticMarkup(h(InlineQuestion, { id: 'p', kind: 'question', text: 'Day 30 or day 45?', answered: 'Day 45', onAnswer: on })),
  narrAt: at => renderToStaticMarkup(h(StatusNarrative, { segments: ['x'], at })),
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

test('a decision is approve or refuse, with no text field and no border', () => {
  const markup = html.decisionAttention();
  assert.match(markup, /Decision/); assert.match(markup, />Approve</); assert.match(markup, />Refuse</);
  assert.match(markup, /bg-warning-soft/); assert.doesNotMatch(markup, /<input/);
  const box = /^<div[^>]*class="([^"]*)"/.exec(markup)[1];
  assert.doesNotMatch(box, /\bborder\b|shadow|ring/, 'the block draws no border of its own');
  assert.match(markup, /min-h-11 md:min-h-8/, '44px on phones');
});

test('a question with options offers the choices, a free-text field and reply in chat; tone attention gives the warning tint', () => {
  const markup = html.questionAttention();
  assert.match(markup, /Day 30/); assert.match(markup, /Day 45/); assert.match(markup, /Reply in chat/);
  assert.match(markup, /<input[^>]*placeholder="Or type an answer"/); assert.match(markup, /bg-warning-soft/);
});

test('tone neutral (the default) is flat for a question and a decision: no fill, no padding, foreground text, icon and buttons kept', () => {
  for (const [name, markup] of [['question', html.question()], ['decision', html.decision()]]) {
    const box = /^<div[^>]*class="([^"]*)"/.exec(markup)[1];
    assert.equal(/bg-warning-soft/.test(markup), false, name + ' has no warning tint');
    assert.equal(/bg-info-soft/.test(markup), false, name + ' has no info tint');
    assert.equal(/\bp-3\b/.test(box), false, name + ' has no padding');
    assert.equal(/\btext-foreground\b/.test(box), true, name + ' reads in the foreground colour');
    assert.equal(/data-testid="question-option"|>Approve</.test(markup), true, name + ' has its buttons');
    assert.equal(/<svg/.test(markup), true, name + ' keeps the icon');
    assert.equal(/bg-card px-2/.test(markup), false, name + ' kind label is not a chip');
  }
});

test('tone attention tints a question and a decision with the warning tint, never the info tint', () => {
  for (const markup of [html.questionAttention(), html.decisionAttention()]) {
    assert.equal(/bg-warning-soft/.test(markup), true); assert.equal(/bg-info-soft/.test(markup), false);
    assert.equal(/\bp-3\b/.test(markup), true); assert.equal(/bg-card px-2/.test(markup), true, 'the chip is kept');
  }
});

test('a question without options is free text only', () => {
  const markup = html.free();
  assert.match(markup, /<input[^>]*placeholder="Type your answer"/);
  assert.equal((markup.match(/<button/g) ?? []).length, 1, 'only Send');
});

test('answered: the controls give way to the answer, muted; a decision says approved or refused', () => {
  assert.doesNotMatch(html.doneDecision(), /<button|<input/); assert.match(html.doneDecision(), /Approved/);
  assert.match(html.doneQuestion(), /Answered: Day 45/); assert.doesNotMatch(html.doneQuestion(), /bg-warning-soft/);
  assert.equal(html.doneQuestion().includes('bg-muted'), false, 'the default answered state is flat');
  assert.equal(html.doneQuestionAttention().includes('bg-'), false, 'attention keeps the padding but paints no fill: the answer is history');
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
  assert.match(markup, /1 agent works on <\/span><a[^>]*>the supplier import<\/a><span>\. Nothing else is open\./);
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

test('status narrative never fetches; a string `at` reads no clock, a Date reads it only to decide on the year', async () => {
  const { readFileSync } = await import('node:fs');
  const source = readFileSync(join(root, 'registry/status-narrative/status-narrative.tsx'), 'utf8');
  assert.doesNotMatch(source, /\bfetch\s*\(|XMLHttpRequest|useEffect|localStorage|Date\.now/);
  const RealDate = globalThis.Date; let reads = 0;
  class Counted extends RealDate { constructor(...args) { if (args.length === 0) reads += 1; super(...args); } static now() { reads += 1; return RealDate.now(); } }
  globalThis.Date = Counted;
  try {
    html.narr();
    assert.equal(reads, 0, 'a string `at` (or none) reads no clock');
    html.narrAt(new Date('2026-11-06T09:00:00'));
    assert.equal(reads, 1, 'a Date reads the clock once, for the current year');
  } finally { globalThis.Date = RealDate; }
});

test('a status narrative link is an inline text link: no padding, height or leading, underlined, in the link colour', () => {
  const markup = html.narr();
  const found = markup.match(/<a([^>]*)>the supplier import<\/a>/);
  assert.equal(found !== null, true, 'the link anchor is rendered');
  const cls = (found[1].match(/class="([^"]*)"/) || [, ''])[1].split(/\s+/).filter(Boolean);
  for (const want of ['text-link', 'underline', 'underline-offset-4', 'font-medium']) {
    assert.equal(cls.includes(want), true, `link has ${want}: ${cls.join(' ')}`);
  }
  const bad = cls.filter(c => /(^|:)(p|px|py|pt|pb|pl|pr|ps|pe|h|min-h|leading)-/.test(c) || /^has-\[/.test(c));
  assert.equal(bad.join(' '), '', 'no padding, h-*, min-h-* or leading-* class on the link');
});

test('a status narrative link is an anchor, not a button: a button is atomic and cannot break across lines (D-1715)', () => {
  const markup = html.narr();
  assert.doesNotMatch(markup, /<button[^>]*>the supplier import</, 'the link label is not inside a <button>');
  assert.match(markup, /<a [^>]*href="#"[^>]*>the supplier import<\/a>/, 'the link is an <a href="#"> (preventDefault, no route)');
});

test('the theme item defines the link role in light and dark', () => {
  const reg = JSON.parse(readFileSync(join(root, 'registry.json'), 'utf8')).items.find(i => i.name === 'theme');
  const built = JSON.parse(readFileSync(join(root, 'public/r/theme.json'), 'utf8'));
  for (const [where, item] of [['registry.json', reg], ['public/r/theme.json', built]]) {
    for (const mode of ['light', 'dark']) {
      // Literal copied from hachej/boring-factory templates/app/web/src/theme.derived.css (not readable from here).
      assert.equal(item.cssVars[mode].link, 'color-mix(in oklab, var(--primary) 70%, var(--foreground))', `${where} ${mode} has the template's link`);
    }
  }
});
