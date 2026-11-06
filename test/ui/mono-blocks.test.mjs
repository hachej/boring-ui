// D-1742: mono is for code and ids. StatusNarrative and SpaceCard render with plain text and numbers in sans, in a happy-dom document.
// Comparisons are on strings and booleans: a failing assert on a happy-dom element looks like a runner shutdown.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { mock } from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { Window } from 'happy-dom';

const root = fileURLToPath(new URL('../../', import.meta.url));
const shadcn = join(root, 'examples/app-shell/components/ui');
const utils = join(root, 'examples/app-shell/lib/utils.ts');
const entry = `
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement as h } from 'react';
import { StatusNarrative } from '${join(root, 'registry/status-narrative/status-narrative.tsx')}';
import { SpaceCard } from '${join(root, 'registry/space-card/space-card.tsx')}';
export const html = {
  narr: at => renderToStaticMarkup(h(StatusNarrative, { segments: ['x'], at, by: 'router', needsYou: 2 })),
  card: labels => renderToStaticMarkup(h(SpaceCard, { name: 'Compta', activity: { working: 2, waiting: 1 }, lastShip: '2h ago', labels })),
};
`;
const dir = mkdtempSync(join(tmpdir(), 'mono-blocks-'));
const outfile = join(dir, 'bundle.cjs');
await build({
  stdin: { contents: entry, resolveDir: root, loader: 'tsx', sourcefile: join(dir, 'entry.tsx') },
  bundle: true, format: 'cjs', platform: 'node', outfile, logLevel: 'silent', jsx: 'automatic', absWorkingDir: root,
  plugins: [{ name: 'app-aliases', setup(b) {
    b.onResolve({ filter: /^@\/components\/ui\/(.+)$/ }, args => ({ path: join(shadcn, `${args.path.split('/').pop()}.tsx`) }));
    b.onResolve({ filter: /^@\/lib\/utils$/ }, () => ({ path: utils }));
  } }],
});
const { html } = createRequire(import.meta.url)(outfile);
test.after(() => rmSync(dir, { recursive: true, force: true }));

const dom = markup => { const window = new Window(); window.document.body.innerHTML = markup; return window.document; };
const classes = document => [...document.querySelectorAll('[class]')].map(node => node.getAttribute('class') ?? '').join(' ');
const short = (date, year) => new Intl.DateTimeFormat(undefined, year ? { day: 'numeric', month: 'short', year: 'numeric' } : { day: 'numeric', month: 'short' }).format(date);

test('StatusNarrative: the meta row is sans and a Date reads short, with the full date in the title', () => {
  mock.timers.enable({ apis: ['Date'], now: new Date('2026-11-06T12:00:00') });
  try {
    const document = dom(html.narr(new Date('2026-11-06T09:30:00')));
    const time = document.querySelector('time');
    assert.equal(time.textContent, short(new Date('2026-11-06T09:30:00')));
    assert.equal(/\d\/\d/.test(time.textContent), false, 'no numeric 11/6/2026');
    assert.equal(/2026/.test(time.textContent), false, 'this year is left out');
    assert.equal(time.getAttribute('datetime'), new Date('2026-11-06T09:30:00').toISOString());
    assert.equal(/2026/.test(time.getAttribute('title')), true, 'the title holds the full date');
    assert.equal(/\bfont-mono\b/.test(classes(document)), false);
    assert.equal(document.body.textContent.includes('router'), true);
  } finally { mock.timers.reset(); }
});

test('StatusNarrative: a date from another year carries its year; a string is shown as given', () => {
  mock.timers.enable({ apis: ['Date'], now: new Date('2026-11-06T12:00:00') });
  try {
    const old = dom(html.narr(new Date('2025-11-06T09:30:00'))).querySelector('time');
    assert.equal(old.textContent, short(new Date('2025-11-06T09:30:00'), true));
    assert.equal(/2025/.test(old.textContent), true);
    const text = dom(html.narr('2 min ago'));
    assert.equal(text.querySelector('time') === null, true);
    assert.equal(text.body.textContent.includes('2 min ago'), true);
  } finally { mock.timers.reset(); }
});

test('SpaceCard: sentence-case label, overridable; counts are semibold tabular sans; nothing is mono', () => {
  const document = dom(html.card());
  assert.equal(document.body.textContent.includes('Last ship 2h ago'), true);
  assert.equal(/\bfont-mono\b/.test(classes(document)), false);
  const counts = [...document.querySelectorAll('b')];
  assert.equal(counts.length, 2);
  for (const count of counts) {
    const list = (count.getAttribute('class') ?? '').split(/\s+/);
    assert.equal(list.includes('tabular-nums') && list.includes('font-semibold'), true);
  }
  assert.equal(dom(html.card({ lastShip: 'Dernier envoi' })).body.textContent.includes('Dernier envoi 2h ago'), true);
});
