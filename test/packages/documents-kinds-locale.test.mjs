// The documents item (`registry/documents`) drawn in French: the sheet opens a `*.maquette.json` through its real FileViewer, and the kind
// is named in the item's locale ("Maquette" in French, "Mock-up" in English). Fictional file (test/fixtures/maquette/booking.maquette.json).
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const root = fileURLToPath(new URL('../../', import.meta.url));
const out = join(root, '.cache/documents-kinds-locale-test');
mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'entry.tsx'), `export { DocumentSheet } from '${root}registry/documents/document-sheet.tsx';`);
await build({ entryPoints: [join(out, 'entry.tsx')], outfile: join(out, 'kit.mjs'), bundle: true, format: 'esm', platform: 'node', jsx: 'automatic', packages: 'external', logLevel: 'silent' });
let kit;
const BOOKING = readFileSync(join(root, 'test/fixtures/maquette/booking.maquette.json'));
const PATH = 'documents/booking.maquette.json';

const DOM = ['window', 'document', 'navigator', 'location', 'HTMLElement', 'HTMLButtonElement', 'Element', 'Node', 'Text', 'Event', 'KeyboardEvent', 'MouseEvent', 'PointerEvent', 'addEventListener', 'removeEventListener', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame', 'MutationObserver', 'IS_REACT_ACT_ENVIRONMENT', 'ResizeObserver', 'history', 'localStorage', 'sessionStorage', 'matchMedia', 'HTMLDivElement', 'HTMLInputElement', 'SVGElement', 'CustomEvent', 'DOMParser', 'Blob', 'File', 'FileReader', 'Image'];
async function dom(t) {
  const { Window } = await import('happy-dom');
  const window = new Window({ url: 'https://fictional.invalid/', settings: { disableIframePageLoading: true } });
  const globals = new Map(DOM.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  for (const name of DOM) {
    const value = name === 'window' ? window : name === 'IS_REACT_ACT_ENVIRONMENT' ? true : name === 'ResizeObserver' ? class { observe() {} unobserve() {} disconnect() {} } : window[name];
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value: typeof value === 'function' && /^[a-z]/.test(name) ? value.bind(window) : value });
  }
  kit ??= await import(pathToFileURL(join(out, 'kit.mjs')).href);
  const { act, createElement } = await import('react');
  const { createRoot } = await import('react-dom/client');
  const container = document.createElement('div'); document.body.append(container);
  const ui = createRoot(container);
  t.after(async () => {
    await act(async () => ui.unmount()); container.remove();
    await window.happyDOM.close();
    for (const [name, descriptor] of globals) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name]; }
  });
  const settle = async () => { for (let i = 0; i < 20; i++) await act(async () => new Promise(resolve => setTimeout(resolve, 5))); };
  return { document, act, settle, $: selector => document.querySelector(selector), h: createElement, render: async element => act(async () => ui.render(element)) };
}

// A fictional workspace provider: one file, read as bytes; nothing is saved.
function provider() {
  const bytes = new Uint8Array(BOOKING);
  const locator = path => ({ resource: { providerId: 'workspace', path }, view: { kind: 'published' } });
  return {
    identity: { runtimeId: 'fixture' },
    locate: locator,
    read: async () => ({ kind: 'available', snapshot: { bytes, ref: { revision: 'rev-1', providerId: 'workspace', path: PATH } } }),
    saves: async () => [], search: async () => [], list: async () => [], changes: undefined,
  };
}

async function namedKind(t, locale) {
  const page = await dom(t);
  await page.render(page.h(kit.DocumentSheet, { provider: provider(), path: PATH, onClose: () => {}, ...(locale ? { locale } : {}) }));
  // The file is read asynchronously: wait for the kind label rather than a fixed settle, which is too short under a full-suite load.
  for (let i = 0; i < 200 && !page.$('[data-testid=artifact-panel-type]'); i++) await page.settle();
  return page;
}

test('the documents sheet names a maquette in French when the item is French', async t => {
  const page = await namedKind(t, 'fr');
  assert.equal(page.$('[data-testid=artifact-panel-type]')?.textContent, 'Maquette');
});

test('the documents sheet names a maquette in English by default', async t => {
  const page = await namedKind(t, undefined);
  assert.equal(page.$('[data-testid=artifact-panel-type]')?.textContent, 'Mock-up');
});
