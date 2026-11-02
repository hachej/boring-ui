// Public artifact-panel and feedback tests. Actual browser security is exercised separately by mockup:journey.
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
export { createMockupKind, mockupKind } from '${root}registry/mockup-viewer/mockup-kind.tsx';
export { compileMockup } from '${root}registry/mockup-viewer/mockup-compile.ts';
export { defaultKinds } from '${root}registry/pi-app-kinds/pi-app-kinds.ts';`);
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

/** The real panel showing a workspace file. No kinds means its built-in default. */
async function panel(t, text, { path = 'documents/booking.mockup.html', kinds, url, onShown } = {}) {
  const page = await dom(t, url);
  const artifact = { schema: 'boring.artifact', version: 1, title: 'Booking', type: 'html', mediaType: 'text/html',
    target: { resource: { providerId: 'workspace', path }, view: { kind: 'published' } }, revision: 'rev-1' };
  const bytes = new TextEncoder().encode(text);
  const client = { read: async () => ({ kind: 'available', snapshot: { bytes, ref: { revision: 'rev-1', providerId: 'workspace', path } } }), saves: async () => [], search: async () => [] };
  await page.render(page.h(kit.ArtifactPanel, { active: { descriptor: artifact, follow: false }, versions: [artifact], options: { client, identity: { runtimeId: 'fixture' }, kinds: kinds ?? kit.defaultKinds(), onShown }, onSelect: () => {}, onClose: () => {} }));
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

test('an app kind overrides the built-in', async t => {
  const page = await panel(t, BOOKING, { kinds: [{ match: () => true, label: 'Host mock-up', renderer: () => 'Host renderer' }, ...kit.defaultKinds()] });
  assert.equal(page.$('[data-testid=mockup-run-frame]'), null);
  assert.match(page.container.textContent, /Host renderer/);
});

test('ordinary HTML retains its passive default', async t => {
  const page = await panel(t, BOOKING, { path: 'booking.html' });
  assert.equal(page.$('[data-testid=mockup-run-frame]'), null);
  assert.equal(page.$$('iframe').some(frame => frame.getAttribute('sandbox')?.includes('allow-scripts')), false);
});

test('presentation acknowledgement waits for the async frame load', async t => {
  const shown = [];
  await panel(t, BOOKING, { onShown: value => shown.push({ ...value, hasFrame: !!document.querySelector('[data-testid=mockup-run-frame]') }) });
  assert.ok(shown.length, 'the loaded frame acknowledges its revision');
  assert.equal(shown[0].hasFrame, true, 'the async frame exists before the revision is acknowledged');
  assert.equal(shown[0].path, 'documents/booking.mockup.html');
  assert.equal(shown[0].revision, 'rev-1');
});

test('Tailwind keeps child and attribute variants intact', async t => {
  await dom(t);
  const css = await kit.compileMockup('<main class="[&>button]:p-2 data-[state=open]:bg-primary"><button>Fictional</button></main>');
  assert.match(css, /padding: calc\(var\(--spacing\) \* 2\)/);
  assert.match(css, /data-state/);
});

async function commented(t) {
  const page = await dom(t);
  const { createFeedbackSession } = await import('@hachej/boring-feedback/ui');
  const { createPrivacyPolicy } = await import('@hachej/boring-feedback/page');
  const { useMemo } = await import('react');
  const session = createFeedbackSession({ app: 'fictional-mockup', root: page.container, policy: createPrivacyPolicy() });
  t.after(() => session.dispose());
  const path = 'booking.mockup.html';
  const artifact = { schema: 'boring.artifact', version: 1, title: 'Booking', type: 'html', mediaType: 'text/html',
    target: { resource: { providerId: 'workspace', path }, view: { kind: 'published' } }, revision: 'rev-1' };
  const client = { read: async () => ({ kind: 'available', snapshot: { bytes: new TextEncoder().encode(BOOKING), ref: { revision: 'rev-1', providerId: 'workspace', path } } }) };
  const composer = { current: undefined };
  function Host() {
    const comments = kit.usePointComments(session);
    composer.current = kit.useComposerFeedback(session);
    const kinds = useMemo(() => [kit.createMockupKind({ comments })], [comments]);
    return page.h(kit.ArtifactPanel, { active: { descriptor: artifact, follow: false }, versions: [artifact], options: { client, identity: { runtimeId: 'fixture' }, kinds }, onSelect: () => {}, onClose: () => {} });
  }
  await page.render(page.h(Host));
  await page.settle();
  const message = async (data, source = page.$('[data-testid=mockup-run-frame]').contentWindow, origin = 'null') => page.act(async () => {
    page.window.dispatchEvent(new page.window.MessageEvent('message', { data, source, origin }));
  });
  return { ...page, session, composer, message };
}
const PICK = { type: 'mockup:pick', selector: ':root > :nth-child(2) > :nth-child(1) > :nth-child(1)', rect: { x: 10, y: 20, w: 100, h: 40 } };



