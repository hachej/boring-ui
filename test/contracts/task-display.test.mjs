import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const root = fileURLToPath(new URL('../../', import.meta.url));
const out = `${root}.cache/task-display-test`;
mkdirSync(out, { recursive: true });
await build({ stdin: { contents: "export { TaskRequestCard } from './registry/task-board/task-request-card';", resolveDir: root, loader: 'tsx' }, outfile: `${out}/card.mjs`, bundle: true, format: 'esm', platform: 'node', jsx: 'automatic', packages: 'external', alias: { '@': `${root}examples/app-shell` }, logLevel: 'silent' });
const { TaskRequestCard } = await import(pathToFileURL(`${out}/card.mjs`).href);

test('both public request-card variants prefer the host display title without mutating the original record', () => {
  const original = 'A complete original need kept for the request detail';
  const task = Object.freeze({ id: 'fictional', title: original, display: 'Choisir les repas', state: 'open', technical: false });
  for (const variant of ['card', 'compact']) {
    const rendered = renderToStaticMarkup(createElement(TaskRequestCard, { task, variant, locale: 'fr' }));
    assert.match(rendered, /Choisir les repas/);
    assert.ok(!rendered.includes(original));
    assert.equal(task.title, original);
    const fallback = renderToStaticMarkup(createElement(TaskRequestCard, { task: { ...task, display: undefined }, variant }));
    assert.ok(fallback.includes(original));
  }
});
