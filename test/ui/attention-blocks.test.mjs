// The needs-you blocks (InlineQuestion, then StatusNarrative, SpaceCard) bundled as an app bundles them: the `@/components/ui`
// names resolve to the shadcn fixtures, the relative imports to the registry folders. Each is rendered to static markup and checked.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
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
