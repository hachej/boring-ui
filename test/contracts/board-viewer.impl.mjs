import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { Window } from 'happy-dom';

const out = join(process.cwd(), '.cache/board-viewer-test');
mkdirSync(out, { recursive: true });
await build({ entryPoints: ['registry/board-viewer/board-viewer.tsx'], outfile: join(out, 'viewer.mjs'), bundle: true, format: 'esm', platform: 'node', jsx: 'automatic', packages: 'external', logLevel: 'silent' });
const window = new Window({ url: 'https://fictional.invalid/', settings: { disableIframePageLoading: true } });
for (const name of ['document', 'navigator', 'HTMLElement', 'HTMLButtonElement', 'Element', 'Node', 'MutationObserver', 'Event', 'MouseEvent', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame']) {
  const value = window[name];
  Object.defineProperty(globalThis, name, { configurable: true, value: typeof value === 'function' && /^[a-z]/.test(name) ? value.bind(window) : value });
}
Object.assign(globalThis, { window, IS_REACT_ACT_ENVIRONMENT: true });
const { createElement: h, act } = await import('react');
const { createRoot } = await import('react-dom/client');
const { createBoardKind, BoardViewer } = await import(pathToFileURL(join(out, 'viewer.mjs')));
const identity = { scopeId: 'fictional', principalId: 'reviewer', initiatorId: 'reviewer' };
const target = { resource: { providerId: 'fictional', path: 'mockups/booking.board.json' }, view: { kind: 'published' } };

test('kind matches only board files and renders invalid/newer files without loading the canvas', async t => {
  const kind = createBoardKind({ identity, client: { read: async () => { throw Error('must not read invalid board'); } }, assetUrls: {} });
  assert.equal(kind.label, 'Board');
  assert.equal(kind.match(target), true);
  assert.equal(kind.match({ ...target, resource: { ...target.resource, path: 'other.json' } }), false);
  assert.equal(kind.match({ ...target, resource: { ...target.resource, path: 'BOOKING.BOARD.JSON' } }), true);
  const element = document.createElement('div'); document.body.append(element);
  const root = createRoot(element);
  t.after(async () => { await act(() => root.unmount()); element.remove(); });
  for (const [text, expected] of [['{', /cannot be read/i], ['{"format":"board@2","items":[]}', /newer board format/i]]) {
    await act(() => root.render(kind.renderer({ artifact: { target }, text, revision: 'observed-revision', pinned: true })));
    assert.match(element.querySelector('[role=alert]').textContent, expected);
    assert.equal(element.querySelector('[data-testid=board]'), null);
  }
});

test('a missing linked-file reader reports failure instead of leaving a loading board', async t => {
  const element = document.createElement('div'); document.body.append(element);
  const root = createRoot(element);
  t.after(async () => { await act(() => root.unmount()); element.remove(); });
  await act(async () => root.render(h(BoardViewer, { target, text: '{"format":"board@1","items":[{"id":"screen","maquette":"missing.maquette.json"}]}', revision: 'r1', pinned: true, identity, assetUrls: {}, client: { read: async () => { throw Error('offline'); } } })));
  assert.match(element.querySelector('[role=alert]').textContent, /linked files.*unavailable/i);
  assert.equal(element.querySelector('[data-testid=board]'), null);
});
