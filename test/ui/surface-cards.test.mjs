// Cards on the canvas are --card, not grey on grey (D-1742, after D-1733 for PiChat): the real rendered SpaceCard (static and
// clickable) and StatusNarrative, light and dark, each root asserted to paint --card straight on the canvas (--background); every surface
// inside it (the initial chip, the warning pill, the hover fills) is at least 1.1:1 on what it sits on. The card itself differs from the
// canvas by 1.09:1 light, 1.11:1 dark (the designer's white card on 0.97 grey): "differs", as in pi-chat-surfaces.test.mjs.
// Needs no browser. Fictional text only.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { Window } from 'happy-dom';
import { contrast, surfaceOf } from '../helpers/theme-colors.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const MIN = 1.1;
const entry = `
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement as h } from 'react';
import { StatusNarrative } from '${join(root, 'registry/status-narrative/status-narrative.tsx')}';
import { InlineQuestion } from '${join(root, 'registry/inline-question/inline-question.tsx')}';
import { SpaceCard } from '${join(root, 'registry/space-card/space-card.tsx')}';
const on = () => {};
export const html = {
  staticCard: () => renderToStaticMarkup(h(SpaceCard, { name: 'Compta', activity: { working: 2, waiting: 1 }, lastShip: '2h ago' })),
  buttonCard: () => renderToStaticMarkup(h(SpaceCard, { name: 'Compta', activity: { working: 2, waiting: 1 }, lastShip: '2h ago', onOpen: on })),
  answered: tone => () => renderToStaticMarkup(h(InlineQuestion, { id: 'q1', kind: 'question', text: 'Which ledger?', options: ['A'], answered: 'A', onAnswer: on, tone })),
  waiting: () => renderToStaticMarkup(h(InlineQuestion, { id: 'q1', kind: 'question', text: 'Which ledger?', options: ['A'], onAnswer: on, tone: 'attention' })),
  narrative: () => renderToStaticMarkup(h(StatusNarrative, { segments: ['x'], at: '2 min ago', by: 'router', needsYou: 3, onRefresh: on })),
};
`;
const dir = mkdtempSync(join(tmpdir(), 'surface-cards-'));
const outfile = join(dir, 'bundle.cjs');
await build({
  stdin: { contents: entry, resolveDir: root, loader: 'tsx', sourcefile: join(dir, 'entry.tsx') },
  bundle: true, format: 'cjs', platform: 'node', outfile, logLevel: 'silent', jsx: 'automatic', absWorkingDir: root,
  plugins: [{ name: 'app-aliases', setup(b) {
    b.onResolve({ filter: /^@\/components\/ui\/(.+)$/ }, args => ({ path: join(root, 'examples/app-shell/components/ui', `${args.path.split('/').pop()}.tsx`) }));
    b.onResolve({ filter: /^@\/lib\/utils$/ }, () => ({ path: join(root, 'examples/app-shell/lib/utils.ts') }));
  } }],
});
const { html } = createRequire(import.meta.url)(outfile);
test.after(() => rmSync(dir, { recursive: true, force: true }));

/** The rendered card (first element on the canvas) of a block. */
const rendered = markup => { const window = new Window(); window.document.body.innerHTML = markup; return window.document.body.firstElementChild; };
const classOf = element => String(element.getAttribute('class') ?? '');
const classes = element => classOf(element).split(/\s+/);
/** The surface an element's ancestors give it: the nearest painted ancestor, else the canvas. */
const under = (element, mode, card) => { for (let up = element.parentElement; up && up !== card.parentElement; up = up.parentElement) { const token = surfaceOf(classOf(up), mode); if (token) return token; } return 'background'; };

for (const [name, make] of [['SpaceCard, static', html.staticCard], ['SpaceCard, clickable', html.buttonCard], ['StatusNarrative', html.narrative]]) {
  for (const mode of ['light', 'dark']) {
    test(`${name}: the root is --card on the canvas and its inner surfaces are 1.1:1 on it, ${mode}`, () => {
      const card = rendered(make());
      assert.equal(surfaceOf(classOf(card), mode), 'card', `${mode}: the root of ${name} is --card`);
      assert.equal(contrast('card', 'background', mode) > 1.05, true, `${mode}: --card differs from the canvas`);
      let judged = 0;
      for (const node of card.querySelectorAll('*')) {
        const token = surfaceOf(classOf(node), mode); if (!token) continue;
        const beneath = under(node, mode, card), measured = contrast(token, beneath, mode);
        assert.equal(token === beneath, false, `${mode}: <${node.tagName.toLowerCase()}> ${token} sits on ${beneath}`);
        assert.equal(measured >= MIN, true, `${mode}: <${node.tagName.toLowerCase()}> ${token} on ${beneath} is ${measured.toFixed(3)}:1, under ${MIN}:1`);
        judged += 1;
      }
      assert.equal(judged >= 1, true, `${name} has an inner surface (the chip or the pill) and it was judged`);
    });
  }
}

test('SpaceCard: the clickable card keeps a visible hover (accent) and the chip stays readable on it; focus is the Button ring', () => {
  const button = rendered(html.buttonCard());
  assert.equal(button.getAttribute('data-slot'), 'button');
  assert.equal(classes(button).includes('hover:bg-accent'), true, 'a hover fill');
  assert.equal(classes(button).includes('bg-card'), true);
  assert.equal(/focus-visible:ring/.test(classOf(button)), true, 'the Button focus ring is kept');
  const chip = button.querySelector('span span');
  assert.equal(classes(chip).includes('group-hover/button:bg-card'), true, 'the chip flips to --card on hover so it does not vanish into --accent');
  for (const mode of ['light', 'dark']) {
    assert.equal(contrast('accent', 'card', mode) >= MIN, true, `${mode}: hover --accent differs from --card`);
    assert.equal(contrast('card', 'accent', mode) >= MIN, true, `${mode}: the hovered chip (--card) on --accent`);
  }
});

// An answered question is history, not a card: no fill at all, so it cannot be grey on grey on the canvas or on a chat panel (D-1742 round 3).
for (const tone of ['neutral', 'attention']) {
  for (const mode of ['light', 'dark']) {
    test(`InlineQuestion answered (${tone}): paints no fill, keeps its spacing, check icon and labels, ${mode}`, () => {
      const root_ = rendered(html.answered(tone)());
      for (const node of [root_, ...root_.querySelectorAll('*')]) {
        const token = surfaceOf(classOf(node), mode);
        assert.equal(token === null || token === undefined, true, `${mode}: <${node.tagName.toLowerCase()}> paints ${token}`);
        assert.equal(/(^|\s)bg-(?!transparent)/.test(classOf(node)), false, `<${node.tagName.toLowerCase()}> has a bg- class`);
      }
      assert.equal(root_.getAttribute('role'), 'group');
      assert.equal(root_.getAttribute('aria-label'), 'Which ledger?');
      assert.equal(classes(root_).includes('text-muted-foreground'), true, 'plain muted text');
      assert.equal(classes(root_).includes('p-3'), tone === 'attention', 'the attention padding is kept so the spacing is unchanged');
      assert.equal(root_.querySelector('svg')?.getAttribute('aria-hidden'), 'true', 'the check icon is hidden from assistive tech');
    });
  }
}

test('InlineQuestion waiting (attention) stays a tinted fill, not a neutral one', () => {
  const card = rendered(html.waiting());
  assert.equal(classes(card).includes('bg-warning-soft'), true);
  for (const mode of ['light', 'dark']) assert.equal(['muted', 'secondary', 'accent', 'card', 'background'].includes(surfaceOf(classOf(card), mode)), false, `${mode}: tinted`);
});
