import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { Window } from 'happy-dom';

// Rendering the app shell (registry/app-shell) in happy-dom: the `locale` prop (the shell's words and the layer's, with an agent's own locale
// first), a shell with no agent (it renders at once), the portalled popups carrying `app-shell` (its css reset reaches them), the account
// theme switch, and one layer at a time. Its own file, so its DOM and bundles share no module or global state with the source tests.
const root = fileURLToPath(new URL('../../', import.meta.url));
const folder = 'registry/app-shell';

// Each call imports a fresh copy of the bundle: the shell's module state (the Back manager) belongs to one window, not to every test.
let bundles = 0;
async function bundle(name, source) {
  const out = `${root}.cache/app-shell-render-test`;
  mkdirSync(out, { recursive: true });
  const outfile = `${out}/${name.replace(/\.tsx?$/, '')}.mjs`;
  const entry = source ? `${out}/${name}` : `${root}${folder}/${name}`;
  if (source) writeFileSync(entry, source);
  await build({ entryPoints: [entry], outfile, bundle: true, format: 'esm', platform: 'node', jsx: 'automatic', packages: 'external', alias: { '@': `${root}examples/app-shell` }, logLevel: 'silent' });
  return import(`${pathToFileURL(outfile).href}?fresh=${++bundles}`);
}

/** A happy-dom page for rendering; restores the globals afterwards. */
function dom(t, width = 390) {
  const names = ['window', 'document', 'navigator', 'history', 'location', 'HTMLElement', 'Element', 'Node', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame', 'matchMedia', 'getSelection', 'MutationObserver', 'ResizeObserver', 'Event', 'CustomEvent', 'EventTarget', 'KeyboardEvent', 'MouseEvent', 'PointerEvent', 'FocusEvent', 'DOMRect', 'IS_REACT_ACT_ENVIRONMENT'];
  const saved = new Map(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  const window = new Window({ url: 'https://fictional.invalid/' });
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
  for (const name of names) Object.defineProperty(globalThis, name, { configurable: true, writable: true, value: name === 'window' ? window : name === 'IS_REACT_ACT_ENVIRONMENT' ? true : /^(?:getComputedStyle|requestAnimationFrame|cancelAnimationFrame|matchMedia|getSelection)$/.test(name) ? window[name].bind(window) : window[name] });
  t.after(() => { for (const [name, descriptor] of saved) descriptor ? Object.defineProperty(globalThis, name, descriptor) : delete globalThis[name]; window.close(); });
  return window;
}

const Icon = () => null;
const nav = ['Jour', 'Semaine', 'Mois', 'Progrès', 'Profil'].map(label => ({ id: label, label, icon: Icon, render: () => null }));
// A layer's agent without a transcript: the trigger and the layer's title read the spec, nothing here opens the chat.
// An idle chat: the snapshot the chat session reads on mount (no view, nothing sent).
const IDLE = Object.freeze({ identity: { runtimeId: 'app', scopeId: 'fictional-team', principalId: 'fictional-person', initiatorId: 'fictional-person' }, conversationId: 'fictional-conversation',
  connection: { kind: 'idle' }, send: { kind: 'idle' }, history: { kind: 'disabled' }, draft: { text: '', attachments: [] }, disposed: false, stop: 'idle', view: undefined });
// Every other method of the controller is a no-op (the chat's mount calls a few; nothing here sends).
const idleController = new Proxy({ getSnapshot: () => IDLE, subscribe: () => () => {} }, { get: (target, key) => key in target ? target[key] : () => Promise.resolve() });
const agentWith = chatProps => ({ controller: idleController, ...(chatProps ? { chatProps } : {}) });

async function render(t, props, { width = 390 } = {}) {
  const window = dom(t, width);
  const { AppShell } = await bundle('app-shell.tsx');
  const { createElement: h, act } = await import('react');
  const { createRoot } = await import('react-dom/client');
  const container = window.document.createElement('div');
  window.document.body.append(container);
  const root = createRoot(container);
  await act(async () => root.render(h(AppShell, { layout: 'screen', title: 'Forme', nav, route: { id: 'Jour', onChange() {} }, ...props })));
  return { container, window, unmount: () => act(async () => root.unmount()) };
}

test('with no agent, the shell\'s own words render in the locale prop, and the account sheet is titled « Compte »', async t => {
  const account = { name: 'Camille Martin', menu: [], signOut() {} };
  const { container, window, unmount } = await render(t, { account, locale: 'fr' });
  assert.equal(container.querySelector('[role=tablist]')?.getAttribute('aria-label'), 'Navigation');
  assert.equal(container.querySelector('[data-testid=tab-plus]')?.textContent, 'Plus');
  assert.equal(container.querySelector('[data-testid=account-button]')?.getAttribute('aria-label'), 'Camille Martin');
  const { act } = await import('react');
  await act(async () => container.querySelector('[data-testid=account-button]').dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true })));
  // The drawer mounts after the click's state update and its portal: wait for it (a few frames at most).
  for (let tries = 0; tries < 40 && !window.document.querySelector('[data-testid=app-sheet]'); tries++) await act(async () => new Promise(done => setTimeout(done, 25)));
  const sheet = window.document.querySelector('[data-testid=app-sheet]');
  assert.ok(sheet, 'the account sheet opens');
  assert.equal(sheet.querySelector('[data-slot=drawer-title]')?.textContent, 'Compte', 'the title is the generic word, so the name appears once (in the person block)');
  assert.equal(sheet.querySelector('[data-testid=account-sign-out]')?.textContent, 'Se déconnecter');
  await unmount();
});

test('no agent: the nav and the header render at once, with the locale prop and without waiting on a spec', async t => {
  const { container, unmount } = await render(t, { locale: 'fr' });
  assert.ok(container.querySelector('[data-testid=screen-header]'), 'the header renders in the same pass');
  assert.ok(container.querySelector('[data-testid=tab-Semaine]'), 'the tab bar renders in the same pass');
  assert.equal(container.querySelector('[data-testid=agent-trigger]'), null, 'no agent, no trigger');
  await unmount();
});

test('the layer\'s own words follow the shell locale when the agent sets none; the agent\'s own locale wins', async t => {
  const trigger = async (agentChatProps, locale) => {
    const { container, unmount } = await render(t, { agent: agentWith(agentChatProps), locale });
    const label = container.querySelector('[data-testid=agent-trigger]')?.getAttribute('aria-label');
    await unmount();
    return label;
  };
  assert.equal(await trigger(undefined, 'fr'), 'Ouvrir l’assistant', 'no agent locale: the shell\'s French');
  assert.equal(await trigger({ locale: 'en' }, 'fr'), 'Open the assistant', 'the agent\'s own locale wins');
  assert.equal(await trigger(undefined, undefined), 'Open the assistant', 'neither set: English');
});

const openAccount = async (t, props) => {
  const rendered = await render(t, props);
  const { act } = await import('react');
  await act(async () => rendered.container.querySelector('[data-testid=account-button]').dispatchEvent(new rendered.window.MouseEvent('click', { bubbles: true, cancelable: true })));
  // The drawer mounts after the click's state update and its portal: wait for it (a few frames at most).
  for (let tries = 0; tries < 40 && !rendered.window.document.querySelector('[data-testid=app-sheet]'); tries++) await act(async () => new Promise(done => setTimeout(done, 25)));
  return rendered;
};

test('a portalled popup carries app-shell, so the item\'s css reset (which matches inside .app-shell) reaches its buttons', async t => {
  const { window, unmount } = await openAccount(t, { account: { name: 'Camille Martin', menu: [], signOut() {} }, locale: 'fr' });
  const sheet = window.document.querySelector('[data-testid=app-sheet]');
  assert.ok(sheet, 'the account sheet opens');
  assert.ok(sheet.classList.contains('app-shell'), 'the sheet root is the reset\'s scope');
  await unmount();
});

test('the account theme: one « Mode sombre » switch when the app gives a theme, nothing when it does not', async t => {
  const changed = [];
  const { window, unmount } = await openAccount(t, { account: { name: 'Camille Martin', menu: [], signOut() {}, theme: { value: 'light', onChange: value => changed.push(value) } }, locale: 'fr' });
  const { act } = await import('react');
  const row = window.document.querySelector('[data-testid=app-sheet] [data-testid=account-theme]');
  assert.equal(row?.getAttribute('role'), 'switch');
  assert.equal(row?.getAttribute('aria-checked'), 'false');
  assert.equal(row?.textContent.trim(), 'Mode sombre');
  await act(async () => row.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true })));
  assert.deepEqual(changed, ['dark'], 'a light app turns dark');
  await unmount();

  const darkChanged = [];
  const dark = await openAccount(t, { account: { name: 'Camille Martin', menu: [], signOut() {}, theme: { value: 'dark', onChange: value => darkChanged.push(value) } }, locale: 'fr' });
  const darkRow = dark.window.document.querySelector('[data-testid=app-sheet] [data-testid=account-theme]');
  assert.equal(darkRow?.getAttribute('aria-checked'), 'true', 'a dark app shows the switch on');
  const { act: actDark } = await import('react');
  await actDark(async () => darkRow.dispatchEvent(new dark.window.MouseEvent('click', { bubbles: true, cancelable: true })));
  assert.deepEqual(darkChanged, ['light'], 'a dark app turns light');
  await dark.unmount();

  const none = await openAccount(t, { account: { name: 'Camille Martin', menu: [], signOut() {} }, locale: 'fr' });
  assert.equal(none.window.document.querySelector('[data-testid=account-theme]'), null, 'no theme, no row');
  await none.unmount();
});

// One happy-dom window per test: `dom()` saves and restores the globals, so two windows in one test would leave happy-dom's globals behind for
// the other test files that run in the same process (the runner uses --experimental-test-isolation=none).
async function oneLayerAt(t, width) {
  const Icon = () => null;
  let latest;
  const { createElement: h, useLayoutEffect } = await import('react');
  // The probe and the shell come from one bundle, so they share the layer's context.
  const shell = await bundle('shell-entry.tsx', `export { AppShell } from '${root}${folder}/app-shell.tsx';\nexport { useAgentLayer } from '${root}${folder}/agent-layer.tsx';\n`);
  const Probe = () => { const api = shell.useAgentLayer(); useLayoutEffect(() => { latest = api; }); return null; };
  const window = dom(t, width);
  const { createRoot } = await import('react-dom/client');
  const { act } = await import('react');
  const container = window.document.createElement('div');
  window.document.body.append(container);
  const reactRoot = createRoot(container);
  const shellNav = [{ id: 'Jour', label: 'Jour', icon: Icon, render: () => h(Probe) }, { id: 'Semaine', label: 'Semaine', icon: Icon, render: () => null }];
  const agent = { controller: idleController };
  await act(async () => reactRoot.render(h(shell.AppShell, { layout: 'screen', title: 'Forme', nav: shellNav, route: { id: 'Jour', onChange() {} }, agent, improve: agent, locale: 'fr' })));
  await act(async () => latest.open('agent', 'half'));
  assert.equal(latest.showing, 'agent', `${width}: the coach shows`);
  await act(async () => latest.open('improve', 'half'));
  assert.equal(latest.showing, 'improve', `${width}: opening the product manager closes the coach`);
  await act(async () => latest.open('agent', 'half'));
  assert.equal(latest.showing, 'agent', `${width}: and back`);
  await act(async () => reactRoot.unmount());
}

test('one layer at a time on a phone: opening the agent closes the product manager and back', t => oneLayerAt(t, 390));
test('one layer at a time on a wide screen: opening the agent closes the product manager and back', t => oneLayerAt(t, 1280));
