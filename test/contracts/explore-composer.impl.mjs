import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { Window } from 'happy-dom';
import { createDemoController } from '../../ux/fixtures/demo-controller.mjs';

// `composer="explore"` through the public path: the real AppShell rendered in happy-dom over a scripted fake agent (fictional). Closed on every visit with an « Ask » toggle at the bottom
// right; the toggle opens a panel that pushes the page (1100 px and up), overlays it (below) or is the bottom sheet (a phone); Ctrl or Cmd + J and Esc; focus in and back; the unread dot and
// the needs-you ring while closed; the context line shown and sent only when given; French; the width remembered. Its own process (see explore-composer.test.mjs).
const root = fileURLToPath(new URL('../../', import.meta.url));
const script = JSON.parse(readFileSync(`${root}ux/scenarios/scripts/design-system.json`, 'utf8'));

let bundles = 0;
async function bundle() {
  const out = `${root}.cache/explore-composer-test`;
  mkdirSync(out, { recursive: true });
  const outfile = `${out}/entry.mjs`;
  const entry = `${out}/entry.ts`;
  writeFileSync(entry, `export { AppShell } from '${root}registry/app-shell/app-shell.tsx';\nexport { readAgentContext } from '${root}registry/app-shell/agent-context.ts';\n`);
  await build({ entryPoints: [entry], outfile, bundle: true, format: 'esm', platform: 'node', jsx: 'automatic', packages: 'external', alias: { '@': `${root}examples/app-shell`, '@hachej/boring-ui-kit/file-tree.css': `${root}packages/ui/styles/file-tree.css` }, logLevel: 'silent',
    plugins: process.env.BEFORE_APP_SHELL ? [{ name: 'pre-fix-app-shell', setup(builder) { builder.onLoad({ filter: /registry\/app-shell\/[\w-]+\.tsx?$/ }, args => ({ contents: readFileSync(`${process.env.BEFORE_APP_SHELL}/${args.path.split('/').pop()}`, 'utf8'), loader: 'tsx', resolveDir: `${root}registry/app-shell` })); } }] : [] });
  return import(`${pathToFileURL(outfile).href}?fresh=${++bundles}`);
}

function dom(t, width) {
  const names = ['window', 'document', 'navigator', 'history', 'location', 'HTMLElement', 'Element', 'Node', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame', 'matchMedia', 'getSelection', 'MutationObserver', 'ResizeObserver', 'Event', 'CustomEvent', 'EventTarget', 'KeyboardEvent', 'MouseEvent', 'PointerEvent', 'FocusEvent', 'DOMRect', 'localStorage', 'IS_REACT_ACT_ENVIRONMENT'];
  const saved = new Map(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  const window = new Window({ url: 'https://fictional.invalid/' });
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
  for (const name of names) Object.defineProperty(globalThis, name, { configurable: true, writable: true, value: name === 'window' ? window : name === 'IS_REACT_ACT_ENVIRONMENT' ? true : /^(?:getComputedStyle|requestAnimationFrame|cancelAnimationFrame|matchMedia|getSelection)$/.test(name) ? window[name].bind(window) : window[name] });
  t.after(() => { for (const [name, descriptor] of saved) descriptor ? Object.defineProperty(globalThis, name, descriptor) : delete globalThis[name]; window.close(); });
  return window;
}

const Icon = () => null;
const nav = ['Orders', 'Customers'].map(label => ({ id: label, label, icon: Icon, render: () => null }));
const KEY = 'boring-ui:sidebar-explore-width:Orders%20app';

/** A scripted agent (answers, approvals) and a shell around it; `remount` is a second visit in the same browser (the same storage). */
async function render(t, props = {}, { width = 1280 } = {}) {
  const window = dom(t, width);
  const { AppShell, readAgentContext } = await bundle();
  const { createElement: h, act } = await import('react');
  const { createRoot } = await import('react-dom/client');
  const demo = createDemoController({ script, pace: 1 });
  const agent = { controller: demo.controller, label: 'Assistant', chatProps: { actions: demo.actions }, ...(props.locale ? { chatProps: { actions: demo.actions, locale: props.locale } } : {}) };
  const container = window.document.createElement('div');
  window.document.body.append(container);
  let root;
  const draw = async more => { await act(async () => root.render(h(AppShell, { layout: 'screen', title: 'Orders app', nav, route: { id: 'Orders', onChange() {} }, composer: 'explore', agent, ...props, ...more }))); };
  root = createRoot(container);
  await draw();
  const $ = selector => container.ownerDocument.querySelector(selector);
  const wait = async ms => { await act(async () => new Promise(done => setTimeout(done, ms))); };
  const until = async (what, check) => { for (let tries = 0; tries < 80; tries++) { if (check()) return; await wait(25); } assert.fail(`timed out: ${what}`); };
  const click = selector => act(async () => $(selector).dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 })));
  const key = (init, target = window.document) => act(async () => { target.dispatchEvent(new window.KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })); });
  const remount = async () => { await act(async () => root.unmount()); root = createRoot(container); await draw(); };
  return { window, container, $, click, key, wait, until, remount, demo, readAgentContext, say: async text => { void demo.controller.send('followUp', { text, attachments: [], restore: { text: '', attachments: [] } }); await wait(50); }, unmount: () => act(async () => root.unmount()) };
}
const toggle = ui => ui.$('[data-testid=explore-toggle]');
const placeOf = ui => ui.$('[data-testid=explore-place]');
const panel = ui => ui.$('[data-testid=explore-panel]');
const open = async ui => { await ui.click('[data-testid=explore-toggle]'); };

test('closed by default: the page keeps its width, nothing sits at the bottom, and the Ask toggle is at the bottom right inside the safe areas', async t => {
  const ui = await render(t);
  assert.equal(panel(ui), null, 'no panel');
  assert.equal(ui.$('[data-testid=agent-composer-box]'), null, 'no bar at the bottom');
  assert.equal(ui.$('[data-testid=composer-icon]'), null, 'no floating icon: explore replaces it');
  assert.equal(ui.$('[data-testid=agent-trigger]'), null, 'one way in: the toggle');
  assert.equal(ui.$('[data-testid=agent-layer]'), null, 'no layer open');
  assert.equal(toggle(ui).textContent, 'Ask');
  assert.equal(toggle(ui).getAttribute('aria-expanded'), 'false');
  assert.ok(placeOf(ui).className.includes('fixed'), 'fixed to the screen (its safe-area offsets are measured in the browser test)');
  assert.equal(ui.$('[data-testid=explore-context]'), null, 'no context line without a context');
});

test('without composer="explore" there is no toggle (the mode is opt-in)', async t => {
  const ui = await render(t, { composer: undefined });
  assert.equal(toggle(ui), null);
});

test('the toggle opens the panel and its close button closes it; the toggle is hidden while open', async t => {
  const ui = await render(t);
  await open(ui);
  assert.ok(panel(ui), 'the panel is open');
  assert.equal(placeOf(ui).hidden, true, 'the toggle steps aside while open');
  assert.equal(toggle(ui).getAttribute('aria-expanded'), 'true');
  await ui.click('[data-testid=agent-layer-close]');
  assert.equal(panel(ui), null, 'closed again');
  assert.equal(placeOf(ui).hidden, false);
});

test('Ctrl+J and Cmd+J toggle the panel, from anywhere on the page', async t => {
  const ui = await render(t);
  await ui.key({ key: 'j', ctrlKey: true });
  assert.ok(panel(ui), 'Ctrl+J opens');
  await ui.key({ key: 'j', ctrlKey: true });
  assert.equal(panel(ui), null, 'Ctrl+J closes');
  await ui.key({ key: 'J', metaKey: true });
  assert.ok(panel(ui), 'Cmd+J opens');
  await ui.key({ key: 'j', metaKey: true });
  assert.equal(panel(ui), null);
  await ui.key({ key: 'j' });
  assert.equal(panel(ui), null, 'a bare J does nothing');
});

test('Esc closes the open panel, pushing or overlaying', async t => {
  for (const width of [1280, 900]) {
    const ui = await render(t, {}, { width });
    await open(ui);
    assert.ok(panel(ui), `${width}: open`);
    await ui.key({ key: 'Escape' });
    assert.equal(panel(ui), null, `${width}: Esc closes`);
    await ui.unmount();
  }
});

test('focus moves into the field on open and back to the toggle on close', async t => {
  const ui = await render(t);
  toggle(ui).focus();
  await open(ui);
  await ui.until('the field has focus', () => ui.window.document.activeElement?.getAttribute('data-testid') === 'composer-input');
  await ui.key({ key: 'Escape' });
  await ui.until('focus is back on the toggle', () => ui.window.document.activeElement === toggle(ui));
});

test('the panel pushes the page from 1100 px, overlays it below, and is a bottom sheet on a phone', async t => {
  const wide = await render(t, {}, { width: 1280 });
  await open(wide);
  assert.equal(panel(wide).dataset.mode, 'push');
  assert.equal(panel(wide).parentElement.dataset.boring, 'dock-layout', 'a column in the page row: the page narrows');
  assert.equal(panel(wide).className.includes('fixed'), false);
  await wide.unmount();
  const edge = await render(t, {}, { width: 1100 });
  await open(edge);
  assert.equal(panel(edge).dataset.mode, 'push', '1100 pushes');
  await edge.unmount();
  const narrow = await render(t, {}, { width: 1099 });
  await open(narrow);
  assert.equal(panel(narrow).dataset.mode, 'overlay', '1099 overlays');
  assert.ok(panel(narrow).className.includes('fixed'), 'over the page, not in its row');
  assert.notEqual(panel(narrow).parentElement.dataset.boring, 'dock-layout');
  await narrow.unmount();
  const phone = await render(t, {}, { width: 390 });
  assert.equal(phone.$('[data-testid=agent-layer]'), null, 'closed on a phone: no peek bar either');
  await open(phone);
  await phone.until('the sheet', () => phone.$('[data-testid=agent-layer]'));
  await phone.wait(100);
  assert.equal(panel(phone), null, 'no side panel on a phone');
  assert.equal(phone.$('[data-testid=agent-layer]').dataset.state, 'half');
  assert.ok(phone.$('[data-slot=drawer-swipe-handle]'), 'a visible grabber');
  assert.ok(phone.$('[data-testid=agent-layer-close]'), 'a close button');
  await phone.click('[data-testid=agent-layer-close]');
  await phone.until('closed', () => !phone.$('[data-testid=agent-layer]') || phone.$('[data-testid=agent-layer]').dataset.state === 'closed');
  assert.equal(placeOf(phone).hidden, false, 'the toggle is back');
});

test('while closed, a reply shows as the unread dot on the toggle and a waiting decision as the needs-you ring; opening reads the reply', async t => {
  const ui = await render(t);
  assert.equal(ui.$('[data-testid=explore-place] [data-testid=agent-bar-unread]'), null, 'nothing unread at first');
  assert.equal(toggle(ui).hasAttribute('data-needs-you'), false);
  await ui.say('answer');
  await ui.until('the dot', () => ui.$('[data-testid=explore-place] [data-testid=agent-bar-unread]'));
  assert.match(toggle(ui).getAttribute('aria-label'), /Ask \(New reply\)/, 'named for a screen reader too');
  await open(ui);
  assert.equal(ui.$('[data-testid=explore-place] [data-testid=agent-bar-unread]'), null, 'read once the panel is open');
  await ui.click('[data-testid=agent-layer-close]');
  assert.equal(ui.$('[data-testid=explore-place] [data-testid=agent-bar-unread]'), null, 'still read after closing');
  await ui.say('approval');
  await ui.until('the ring', () => toggle(ui).hasAttribute('data-needs-you'));
  assert.match(placeOf(ui).className, /ring-warning/, 'the same ring as the icon');
});

test('the context line shows « You are looking at » and travels with the turn, only when the app gives a context', async t => {
  const given = await render(t, { context: { title: 'Orders, last 30 days', detail: '4 rows' } });
  assert.equal(given.readAgentContext()?.params?.lookingAt?.title, 'Orders, last 30 days', 'sent while closed too');
  await open(given);
  assert.equal(given.$('[data-testid=explore-context-label]').textContent, 'You are looking at');
  assert.equal(given.$('[data-testid=explore-context-title]').textContent, 'Orders, last 30 days');
  assert.equal(given.$('[data-testid=explore-context-detail]').textContent, '4 rows');
  assert.deepEqual(given.readAgentContext().params.lookingAt, { title: 'Orders, last 30 days', detail: '4 rows' });
  await given.unmount();
  const none = await render(t);
  await open(none);
  assert.equal(none.$('[data-testid=explore-context]'), null, 'not shown');
  assert.equal(none.readAgentContext()?.params?.lookingAt, undefined, 'not sent');
  await none.unmount();
  const phone = await render(t, { context: { title: 'Orders' } }, { width: 390 });
  await open(phone);
  await phone.until('the sheet shows the line', () => phone.$('[data-testid=explore-context-title]'));
  assert.equal(phone.$('[data-testid=explore-context-detail]'), null, 'no detail, no detail line');
});

test('French: the toggle says « Demander » and the line « Vous regardez »', async t => {
  const ui = await render(t, { locale: 'fr', context: { title: 'Commandes' } });
  assert.equal(toggle(ui).textContent, 'Demander');
  await open(ui);
  assert.equal(ui.$('[data-testid=explore-context-label]').textContent, 'Vous regardez');
  assert.equal(ui.$('[data-testid=explore-resize]').getAttribute('aria-label'), 'Redimensionner le panneau de l’assistant');
});

test('the width is resizable by keys and by drag, and remembered on the next visit, which still starts closed', async t => {
  const ui = await render(t, { appId: 'Orders app' });
  await open(ui);
  const edge = () => ui.$('[data-testid=explore-resize]');
  assert.equal(panel(ui).style.width, '384px', 'the default width');
  await ui.key({ key: 'ArrowLeft' }, edge());
  assert.equal(panel(ui).style.width, '408px', 'a key step widens');
  assert.equal(ui.window.localStorage.getItem(KEY), '408');
  await act(ui, () => edge().dispatchEvent(new ui.window.PointerEvent('pointerdown', { bubbles: true, button: 0, clientX: 1000, pointerId: 1 })));
  await act(ui, () => edge().dispatchEvent(new ui.window.PointerEvent('pointermove', { bubbles: true, clientX: 940, pointerId: 1 })));
  await act(ui, () => edge().dispatchEvent(new ui.window.PointerEvent('pointerup', { bubbles: true, clientX: 940, pointerId: 1 })));
  assert.equal(panel(ui).style.width, '468px', 'a drag to the left by 60 px widens by 60');
  assert.equal(ui.window.localStorage.getItem(KEY), '468');
  await ui.remount();
  assert.equal(panel(ui), null, 'a new visit starts closed');
  await open(ui);
  assert.equal(panel(ui).style.width, '468px', 'the remembered width');
  await ui.key({ key: 'Enter' }, edge());
  assert.equal(panel(ui).style.width, '384px', 'Enter resets');
  assert.equal(ui.window.localStorage.getItem(KEY), null);
});
const act = async (ui, run) => { const { act: reactAct } = await import('react'); await reactAct(async () => { run(); }); };
