// Run by mockup-viewer.test.mjs in its own process. The built-in maquette kind driven through the real pi-app ArtifactPanel, as a
// presented `*.maquette.json` opens in it: format v1 and its versioning, the stepper and arrow keys, goto links and their hint, Back and the
// breadcrumb, guided tours, the device frame, `#screen=` deep links, the collapsed workflow, errors, an app kind overriding the built-in, and
// comment pins: the feedback item's point mode entered from the viewer, with the note sent to the conversation naming the screen and block.
// Fictional data only (test/fixtures/maquette/booking.maquette.json).
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const root = fileURLToPath(new URL('../../', import.meta.url));
const out = join(root, '.cache/mockup-viewer-test');
mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'entry.tsx'), `export { ArtifactPanel } from '${root}registry/pi-app/artifact-panel.tsx';
export { useComposerFeedback, usePointComments } from '${root}registry/feedback/feedback-session.tsx';`);
await build({ entryPoints: [join(out, 'entry.tsx')], outfile: join(out, 'kit.mjs'), bundle: true, format: 'esm', platform: 'node', jsx: 'automatic', packages: 'external', logLevel: 'silent' });
// Imported once the first test's DOM globals exist: Base UI decides at load time whether it runs in a browser.
let kit;
const BOOKING = '<main class="p-4 bg-background text-foreground"><button id="calendar" class="bg-primary text-primary-foreground">Add to calendar</button></main>';

const DOM = ['window', 'document', 'navigator', 'location', 'HTMLElement', 'HTMLButtonElement', 'Element', 'Node', 'Text', 'Event', 'KeyboardEvent', 'MouseEvent', 'PointerEvent', 'addEventListener', 'removeEventListener', 'MutationObserver', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame', 'IS_REACT_ACT_ENVIRONMENT', 'ResizeObserver', 'localStorage', 'sessionStorage'];
async function dom(t, url = 'https://fictional.invalid/') {
  const { Window } = await import('happy-dom');
  const window = new Window({ url, settings: { disableIframePageLoading: true } });
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
  const settle = async () => { for (let i = 0; i < 10; i++) await act(async () => new Promise(resolve => setTimeout(resolve, 5))); };
  // The whole document: menus and dialogs render in a portal outside the panel.
  const $ = selector => document.querySelector(selector);
  const $$ = selector => [...document.querySelectorAll(selector)];
  const click = async selector => { const element = typeof selector === 'string' ? $(selector) : selector; assert.ok(element, `missing ${selector}`); await act(async () => element.click()); };
  return { window, act, container, $, $$, click, settle, h: createElement, render: async element => act(async () => ui.render(element)) };
}

/** The real ArtifactPanel showing `text` as a presented file at `path`, with the host's `kinds` (none: only the built-in maquette kind). */
async function panel(t, text, { path = 'documents/booking.mockup.html', kinds, url } = {}) {
  const page = await dom(t, url);
  const artifact = { schema: 'boring.artifact', version: 1, title: 'Booking', type: 'html', mediaType: 'text/html',
    target: { resource: { providerId: 'workspace', path }, view: { kind: 'published' } }, revision: 'rev-1' };
  const bytes = new TextEncoder().encode(text);
  const client = { read: async () => ({ kind: 'available', snapshot: { bytes, ref: { revision: 'rev-1', providerId: 'workspace', path } } }), saves: async () => [], search: async () => [] };
  await page.render(page.h(kit.ArtifactPanel, { active: { descriptor: artifact, follow: false }, versions: [artifact], options: { client, identity: { runtimeId: 'fixture' }, ...(kinds ? { kinds } : {}) }, onSelect: () => {}, onClose: () => {} }));
  await page.settle();
  return page;
}

test('a mockup.html file uses the built-in opaque sandbox and host theme', async t => {
  const page = await panel(t, BOOKING);
  await page.settle();
  const frame = page.$('[data-testid=mockup-run-frame]');
  assert.ok(frame, 'the default artifact kind renders an HTML mock-up');
  assert.equal(frame.getAttribute('sandbox'), 'allow-scripts');
  assert.equal(frame.getAttribute('allow'), '');
  assert.equal(frame.getAttribute('referrerpolicy'), 'no-referrer');
  assert.match(frame.srcdoc, /connect-src 'none'/);
  assert.match(frame.srcdoc, /bg-primary/);
  assert.equal(page.$('#calendar'), null, 'artifact markup never enters the host document');
});
