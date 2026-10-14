import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { buildPreviewFrame } from '../../scripts/build-preview-frame.mjs';

// The sandboxed frame's logic without a browser: the compile step with its import allowlist, and the message guards both ways.
// (The frame itself, sandboxed in a real browser, is proven by examples/app-shell/journey.mjs.)
const root = fileURLToPath(new URL('../../', import.meta.url));
const out = `${root}.cache/live-preview-frame-test`;
mkdirSync(out, { recursive: true });
writeFileSync(`${out}/package.json`, '{"type":"module"}');
await build({ entryPoints: { snapshot: `${root}registry/live-preview/snapshot.ts`, compile: `${root}scripts/preview-frame/compile.ts`, 'frame-protocol': `${root}registry/live-preview/frame-protocol.ts` }, outdir: out, bundle: true, format: 'esm', platform: 'node', packages: 'external', logLevel: 'silent' });
const { compileComponent } = await import(pathToFileURL(`${out}/compile.js`).href);
const { snapshotProps } = await import(pathToFileURL(`${out}/snapshot.js`).href);
const { acceptFromFrame, acceptFromParent, FRAME_TAG } = await import(pathToFileURL(`${out}/frame-protocol.js`).href);

const modules = { react: { marker: 'react' }, 'react/jsx-runtime': { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }), Fragment: 'f' }, '@/components/ui/button': { Button: 'button' } };

test('a TSX component compiles and renders with allowed imports', () => {
  const Component = compileComponent(`import { Button } from '@/components/ui/button';\nexport default function Card({ steps }: { steps: number }) { return <Button>{steps}</Button>; }`, modules);
  assert.deepEqual(Component({ steps: 3 }), { type: 'button', props: { children: 3 } });
});

test('the import allowlist rejects any other import, static or dynamic', async () => {
  assert.throws(() => compileComponent(`import x from 'x';\nexport default () => x;`, modules), /Import "x" is not allowed/);
  assert.throws(() => compileComponent(`import { Dialog } from '@/components/ui/dialog';\nexport default () => Dialog;`, modules), /not allowed/);
  assert.throws(() => compileComponent(`import 'node:fs';\nexport default () => null;`, modules), /not allowed/);
  compileComponent(`globalThis.__dynamic = import('https://example.invalid/x.js');\nexport default () => null;`, modules);
  await assert.rejects(globalThis.__dynamic, /not allowed/);
});

test('a syntax error and a missing component throw readable errors', () => {
  assert.throws(() => compileComponent('export default function ( {', modules), /Unexpected|expected|\(1:/i);
  assert.throws(() => compileComponent('export const answer = 42;', modules), /must export a component/);
});

test('the app accepts only well-formed messages from its own iframe window', () => {
  const frame = {};
  const ok = { boring: FRAME_TAG, type: 'error', message: 'boom' };
  assert.deepEqual(acceptFromFrame({ data: ok, source: frame }, frame), ok);
  assert.equal(acceptFromFrame({ data: ok, source: {} }, frame), undefined, 'another window');
  assert.equal(acceptFromFrame({ data: ok, source: frame }, null), undefined, 'no frame');
  assert.equal(acceptFromFrame({ data: { type: 'error', message: 'x' }, source: frame }, frame), undefined, 'untagged');
  assert.equal(acceptFromFrame({ data: { boring: FRAME_TAG, type: 'size', height: 'tall' }, source: frame }, frame), undefined);
  assert.equal(acceptFromFrame({ data: { boring: FRAME_TAG, type: 'render', source: 'x', css: '' }, source: frame }, frame), undefined, 'a frame cannot send render');
});

test('the frame accepts a render only from its parent window', () => {
  const parent = {};
  const render = { boring: FRAME_TAG, type: 'render', source: 'export default () => null', props: { a: 1 }, css: '', dark: true };
  assert.deepEqual(acceptFromParent({ data: render, source: parent }, parent), render);
  assert.equal(acceptFromParent({ data: render, source: {} }, parent), undefined);
  assert.equal(acceptFromParent({ data: { ...render, source: 5 }, source: parent }, parent), undefined);
  assert.equal(acceptFromParent({ data: { boring: FRAME_TAG, type: 'size', height: 1 }, source: parent }, parent), undefined);
});

test('the props snapshot keeps clone-safe values, turns functions into intent markers and drops the rest', () => {
  const cyclic = { name: 'loop' }; cyclic.self = cyclic;
  const snap = snapshotProps({ title: 'Jour', steps: [1, 2], nested: { onPick() {}, when: 3 }, onSelect() {}, bad: Symbol('x'), big: 10n, element: { $$typeof: Symbol.for('react.element') }, date: new Date(), cyclic });
  assert.deepEqual(snap, { title: 'Jour', steps: [1, 2], nested: { onPick: { __boringIntent: 'onPick' }, when: 3 }, onSelect: { __boringIntent: 'onSelect' }, cyclic: { name: 'loop' } });
  structuredClone(snap);
  assert.deepEqual(snapshotProps(undefined), {});
});

test('the committed preview-frame.js is the build of scripts/preview-frame', async () => {
  assert.equal(readFileSync(`${root}registry/live-preview/preview-frame.js`, 'utf8'), await buildPreviewFrame(), 'run npm run registry:build');
});
