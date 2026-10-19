// Run by maquette-viewer.test.mjs in its own process. The built-in maquette kind driven through the real pi-app ArtifactPanel, as a
// presented `*.maquette.json` opens in it: format v1 and its versioning, the stepper and arrow keys, goto links and their hint, Back and the
// breadcrumb, guided tours, the device frame, `#screen=` deep links, the collapsed workflow, errors, and an app kind overriding the built-in.
// Fictional data only (test/fixtures/maquette/booking.maquette.json).
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const root = fileURLToPath(new URL('../../', import.meta.url));
const out = join(root, '.cache/maquette-viewer-test');
mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'entry.tsx'), `export { ArtifactPanel } from '${root}registry/pi-app/artifact-panel.tsx'; export { createMaquetteKind, maquetteKind } from '${root}registry/maquette-viewer/maquette-viewer.tsx';`);
await build({ entryPoints: [join(out, 'entry.tsx')], outfile: join(out, 'kit.mjs'), bundle: true, format: 'esm', platform: 'node', jsx: 'automatic', packages: 'external', logLevel: 'silent' });
// Imported once the first test's DOM globals exist: Base UI decides at load time whether it runs in a browser.
let kit;
const BOOKING = readFileSync(join(root, 'test/fixtures/maquette/booking.maquette.json'), 'utf8');

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
async function panel(t, text, { path = 'documents/booking.maquette.json', kinds, url } = {}) {
  const page = await dom(t, url);
  const artifact = { schema: 'boring.artifact', version: 1, title: 'Booking', type: 'code', mediaType: 'application/json', language: 'json',
    target: { resource: { providerId: 'workspace', path }, view: { kind: 'published' } }, revision: 'rev-1' };
  const bytes = new TextEncoder().encode(text);
  const client = { read: async () => ({ kind: 'available', snapshot: { bytes, ref: { revision: 'rev-1', providerId: 'workspace', path } } }), saves: async () => [], search: async () => [] };
  await page.render(page.h(kit.ArtifactPanel, { active: { descriptor: artifact, follow: false }, versions: [artifact], options: { client, identity: { runtimeId: 'fixture' }, ...(kinds ? { kinds } : {}) }, onSelect: () => {}, onClose: () => {} }));
  await page.settle();
  const screen = () => page.$('[data-testid=maquette-walk]')?.dataset.screen;
  const key = async (key, init = {}) => { const walk = page.$('[data-testid=maquette-walk]'); await page.act(async () => walk.dispatchEvent(new page.window.KeyboardEvent('keydown', { key, bubbles: true, ...init }))); };
  const menu = async item => { await page.click('[data-testid=maquette-menu]'); await page.settle(); await page.click(item); await page.settle(); };
  return { ...page, screen, key, menu };
}

test('a v1 file renders its start screen in the panel, named Mock-up, with real blocks and a one-line note', async t => {
  const page = await panel(t, BOOKING);
  assert.equal(page.$('[data-testid=artifact-panel-type]').textContent, 'Mock-up');
  assert.equal(page.$('[data-boring=maquette-viewer]').getAttribute('aria-label'), 'Tidewater Studio: class booking');
  assert.equal(page.screen(), 'classes');
  assert.equal(page.$('[data-testid=maquette-screen-title]').textContent, "This week's classes");
  assert.deepEqual(page.$$('[data-testid=maquette-screen] th').map(cell => cell.textContent), ['Class', 'When', 'Places']);
  const note = page.$('[data-testid=maquette-note]');
  assert.match(note.textContent, /this week's classes and how many places/);
  assert.equal(note.getAttribute('title'), note.textContent, 'the full note in its tooltip');
  assert.ok(page.$('[data-testid=maquette-note-more]'), 'and behind the info button');
  assert.equal(page.$('[data-testid=maquette-position]').textContent, '1 / 3');
});

test('the stepper walks the screens with Previous, Next and the arrow keys', async t => {
  const page = await panel(t, BOOKING);
  assert.equal(page.$('[data-testid=maquette-previous]').disabled, true, 'nothing before the first screen');
  await page.click('[data-testid=maquette-next]');
  assert.equal(page.screen(), 'class');
  assert.equal(page.$('[data-testid=maquette-position]').textContent, '2 / 3');
  await page.key('ArrowRight');
  assert.equal(page.screen(), 'confirmed');
  assert.equal(page.$('[data-testid=maquette-next]').disabled, true, 'nothing after the last screen');
  await page.key('ArrowLeft');
  assert.equal(page.screen(), 'class');
  assert.equal(document.activeElement, page.$('[data-testid=maquette-screen-title]'), 'focus starts on the screen just opened');
});

test('a goto block names its screen, pulses on first view, opens its screen, and Back returns', async t => {
  const page = await panel(t, BOOKING);
  const goto = page.$('[data-testid=maquette-screen] [data-testid=maquette-goto][data-goto=class]');
  assert.equal(goto.getAttribute('title'), 'Opens “Wheel throwing, beginners”');
  assert.equal(goto.closest('[data-hint]')?.dataset.hint, 'pulse', 'goto blocks pulse the first time their screen is shown');
  assert.equal(page.$('[data-testid=maquette-back]'), null, 'no Back before a move');
  await page.click(goto);
  assert.equal(page.screen(), 'class');
  await page.click('[data-testid=maquette-goto][data-goto=confirmed]');
  assert.equal(page.screen(), 'confirmed');
  await page.click('[data-testid=maquette-back]');
  assert.equal(page.screen(), 'class');
  assert.equal(page.$('[data-testid=maquette-walk] [data-hint]')?.dataset.hint, undefined, 'a screen seen before does not pulse again');
  await page.click('[data-testid=maquette-back]');
  assert.equal(page.screen(), 'classes');
  assert.equal(page.$('[data-testid=maquette-back]'), null, 'back at the start of the path');
});

test('a case with steps is a guided tour from the menu: its screens in order, a caption and step dots', async t => {
  const page = await panel(t, BOOKING);
  await page.menu('[data-testid=maquette-tour]');
  assert.equal(page.$('[data-testid=maquette-walk]').dataset.tour, 'First booking');
  assert.match(page.$('[data-testid=maquette-caption]').textContent, /^Alex, a fictional student, opens/);
  assert.equal(page.$('[data-testid=maquette-dots]').getAttribute('aria-label'), 'Step 1 of 3');
  assert.equal(page.$('[data-testid=maquette-position]'), null, 'dots replace the counter');
  await page.click('[data-testid=maquette-next]');
  assert.equal(page.screen(), 'class');
  assert.match(page.$('[data-testid=maquette-caption]').textContent, /types a name and an email/);
  await page.key('ArrowRight');
  assert.equal(page.screen(), 'confirmed');
  assert.equal(page.$('[data-testid=maquette-dots]').getAttribute('aria-label'), 'Step 3 of 3');
  await page.click('[data-testid=maquette-end-tour]');
  assert.equal(page.$('[data-testid=maquette-caption]'), null);
  assert.ok(page.$('[data-testid=maquette-menu]'), 'the menu is back');
});

test('the workflow is hidden by default and opens from the menu; a legacy case path still highlights it', async t => {
  const page = await panel(t, BOOKING);
  assert.equal(page.$('[data-testid=maquette-diagram]'), null, 'hidden: no diagram drawn');
  await page.menu('[data-testid=maquette-how-open]');
  assert.ok(page.$('[data-testid=maquette-how] [data-testid=maquette-diagram]'), 'in the How it works dialog');
  assert.equal(page.$$('[data-testid=maquette-legend] li').length, 5, 'a numbered legend line per transition');
  const cancellation = page.$$('[data-testid=maquette-case]').find(button => button.textContent === 'Cancellation');
  await page.click(cancellation);
  assert.deepEqual(page.$$('[data-testid=maquette-diagram] g[data-state][data-lit]').map(state => state.dataset.state), ['browsing', 'requested', 'confirmed', 'cancelled']);
});

test('device: phone draws the phone frame', async t => {
  const page = await panel(t, BOOKING);
  assert.equal(page.$('[data-testid=maquette-frame]').dataset.device, 'phone');
});

test('without device the screen takes the panel width', async t => {
  const plain = JSON.parse(BOOKING); delete plain.device;
  const other = await panel(t, JSON.stringify(plain));
  assert.equal(other.$('[data-testid=maquette-frame]').dataset.device, 'panel');
});

test('#screen=<id> in the page URL opens that screen, and a later fragment moves to its screen', async t => {
  const page = await panel(t, BOOKING, { url: 'https://fictional.invalid/app#screen=confirmed' });
  assert.equal(page.screen(), 'confirmed');
  await page.act(async () => { page.window.location.hash = '#screen=class'; page.window.dispatchEvent(new page.window.Event('hashchange')); });
  await page.settle();
  assert.equal(page.screen(), 'class');
});

test('an unknown component is a named placeholder', async t => {
  const page = await panel(t, BOOKING);
  await page.click('[data-testid=maquette-next]');
  const placeholder = page.$('[data-testid=maquette-placeholder]');
  assert.equal(placeholder.dataset.type, 'studio map');
  assert.match(placeholder.textContent, /Studio map/);
  assert.match(placeholder.textContent, /Where the wheel room is/);
});

test('an unversioned file reads as v1 (legacy aliases included)', async t => {
  const legacy = { title: 'Old', screens: { home: { title: 'Home', blocks: [{ type: 'button', label: 'Go', goto: 'next' }] }, next: { title: 'Next', blocks: [{ type: 'text', text: 'Hello' }] } },
    workflow: { states: ['a', 'b'], transitions: [{ from: 'a', to: 'b', on: 'starts' }] }, cases: [{ name: 'Path', path: ['a', 'b'] }] };
  const page = await panel(t, JSON.stringify(legacy));
  assert.equal(page.$('[data-testid=maquette-newer]'), null);
  assert.equal(page.screen(), 'home');
  await page.click('[data-testid=maquette-goto]');
  assert.equal(page.screen(), 'next');
});

test('a future version shows a notice and still renders what it can', async t => {
  const future = await panel(t, JSON.stringify({ ...JSON.parse(BOOKING), version: 3, hologram: true }));
  assert.match(future.$('[data-testid=maquette-newer]').textContent, /format version 3/);
  assert.ok(future.$$('[data-testid=maquette-screen]').length > 0, 'what it can read is still drawn');
});

test('invalid JSON shows an inline error, not a crash', async t => {
  const broken = await panel(t, '{ "screens": ');
  assert.equal(broken.$('[data-testid=maquette-error]').dataset.reason, 'json');
});

test('a file without screens shows the shape error', async t => {
  const empty = await panel(t, JSON.stringify({ title: 'Nothing', screens: {} }));
  assert.equal(empty.$('[data-testid=maquette-error]').dataset.reason, 'shape');
});

test('an app kind for .maquette.json wins over the built-in', async t => {
  const page = await panel(t, BOOKING, { kinds: [{ match: target => target.resource.path.endsWith('.maquette.json'), label: 'Wireframe', renderer: ({ text }) => JSON.parse(text).title }] });
  assert.equal(page.$('[data-testid=artifact-panel-type]').textContent, 'Wireframe');
  assert.equal(page.$('[data-testid=maquette-walk]'), null, 'the built-in viewer is not drawn');
  assert.equal(page.$('[data-testid=artifact-kind-view]').textContent, 'Tidewater Studio: class booking');
});

test('createMaquetteKind gives the French kind: « Maquette » and French words', async t => {
  const french = await panel(t, BOOKING, { kinds: [kit.createMaquetteKind({ locale: 'fr' })] });
  assert.equal(french.$('[data-testid=artifact-panel-type]').textContent, 'Maquette');
  assert.equal(french.$('[data-testid=maquette-previous]').getAttribute('aria-label'), 'Écran précédent');
});
