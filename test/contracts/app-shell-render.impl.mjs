import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
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
  await build({ entryPoints: [entry], outfile, bundle: true, format: 'esm', platform: 'node', jsx: 'automatic', packages: 'external', alias: { '@': `${root}examples/app-shell` }, logLevel: 'silent', plugins: process.env.BEFORE_ACCOUNT_SOURCE ? [{ name: 'pre-fix-account', setup(builder) { builder.onLoad({ filter: /registry\/app-shell\/account\.tsx$/ }, () => ({ contents: readFileSync(process.env.BEFORE_ACCOUNT_SOURCE, 'utf8'), loader: 'tsx', resolveDir: `${root}registry/app-shell` })); } }] : [] });
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

test('overlayBlur={false} marks <html data-overlay-blur="off"> while the shell is mounted; the default marks nothing', async t => {
  const plain = await render(t, {});
  assert.equal(plain.window.document.documentElement.dataset.overlayBlur, undefined, 'blur stays on by default');
  await plain.unmount();
  const { window, unmount } = await render(t, { overlayBlur: false });
  assert.equal(window.document.documentElement.dataset.overlayBlur, 'off');
  await unmount();
  assert.equal(window.document.documentElement.dataset.overlayBlur, undefined, 'unmounting the shell gives the blur back');
});

test('the hover rail starts collapsed, reveals on pointer hover or focus within, and collapses on leave, blur or Escape', async t => {
  const items = ['Tableau de bord', 'Repas'].map(label => ({ id: label, label, icon: Icon, render: () => null }));
  const chosen = [];
  const ui = await render(t, { rail: 'hover', nav: items, route: { id: 'Tableau de bord', onChange: id => chosen.push(id) } }, { width: 1440 });
  const { act } = await import('react');
  const panel = ui.container.querySelector('[data-testid=app-sidebar]');
  const sidebar = panel.closest('[data-slot=sidebar]');
  const first = panel.querySelector('[data-testid="nav-Tableau de bord"]');
  const second = panel.querySelector('[data-testid=nav-Repas]');
  const state = () => sidebar.getAttribute('data-state');
  assert.equal(state(), 'collapsed', 'hover mode reserves only an icon rail');
  assert.equal(ui.container.querySelector('[role=tablist]'), null);
  await act(async () => panel.dispatchEvent(new ui.window.PointerEvent('pointerover', { bubbles: true, pointerType: 'mouse' })));
  assert.equal(state(), 'expanded', 'hover reveals the labels');
  assert.equal(first.textContent, 'Tableau de bord');
  assert.equal(second.textContent, 'Repas');
  await act(async () => panel.dispatchEvent(new ui.window.PointerEvent('pointerout', { bubbles: true, pointerType: 'mouse', relatedTarget: ui.window.document.body })));
  assert.equal(state(), 'collapsed', 'leaving collapses');
  await act(async () => panel.dispatchEvent(new ui.window.PointerEvent('pointerover', { bubbles: true, pointerType: 'touch' })));
  assert.equal(state(), 'collapsed', 'touch does not reveal an overlay');
  await act(async () => first.focus());
  assert.equal(state(), 'expanded', 'keyboard focus reveals');
  await act(async () => second.focus());
  assert.equal(state(), 'expanded', 'focus within keeps the labels visible');
  await act(async () => second.dispatchEvent(new ui.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })));
  assert.equal(state(), 'collapsed', 'Escape collapses even with focus inside');
  assert.equal(ui.window.document.activeElement, second, 'Escape does not discard focus');
  await act(async () => first.focus());
  assert.equal(state(), 'expanded', 'the next focus reveals again');
  await act(async () => first.blur());
  assert.equal(state(), 'collapsed', 'focus leaving collapses');
  await act(async () => second.click());
  assert.deepEqual(chosen, ['Repas'], 'the router still owns selection');
  await ui.unmount();
});

for (const rail of [undefined, 'icon']) for (const layout of ['screen', 'workspace']) test(`${layout}, rail ${rail ?? 'unset'}: the native sidebar default and hover/focus behaviour stay unchanged`, async t => {
  const ui = await render(t, { layout, ...(rail ? { rail } : {}) }, { width: 1440 });
  const { act } = await import('react');
  const panel = ui.container.querySelector('[data-testid=app-sidebar]');
  const sidebar = panel.closest('[data-slot=sidebar]');
  const expected = layout === 'screen' ? 'expanded' : 'collapsed';
  assert.equal(sidebar.getAttribute('data-state'), expected);
  assert.equal(ui.container.querySelector('[data-rail=hover]'), null, 'no overlay wrapper in default mode');
  await act(async () => panel.dispatchEvent(new ui.window.PointerEvent('pointerover', { bubbles: true, pointerType: 'mouse' })));
  await act(async () => panel.querySelector('[data-testid=nav-Jour]').focus());
  assert.equal(sidebar.getAttribute('data-state'), expected, 'hover and focus do not change the default sidebar');
  await act(async () => panel.dispatchEvent(new ui.window.PointerEvent('pointerout', { bubbles: true, pointerType: 'mouse', relatedTarget: ui.window.document.body })));
  assert.equal(sidebar.getAttribute('data-state'), expected);
  await ui.unmount();
});

test('hover rail on a phone keeps the same tab bar and no sidebar', async t => {
  const ui = await render(t, { rail: 'hover', locale: 'fr' });
  assert.equal(ui.container.querySelector('[data-testid=app-sidebar]'), null);
  assert.deepEqual([...ui.container.querySelectorAll('[role=tab]')].map(tab => tab.textContent), ['Jour', 'Semaine', 'Mois', 'Plus']);
  await ui.unmount();
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

test('on a phone the header trigger shows the agent\'s own icon and is named by its label; without them, the sparkles and « Ouvrir l’assistant »', async t => {
  const { createElement: h } = await import('react');
  const Mascot = ({ className }) => h('img', { 'data-testid': 'agent-mascot', className, alt: '' });
  const own = await render(t, { agent: { controller: idleController, icon: Mascot, label: 'Ton coach' }, locale: 'fr' });
  const trigger = own.container.querySelector('[data-testid=agent-trigger]');
  assert.equal(trigger.getAttribute('aria-label'), 'Ton coach');
  assert.ok(trigger.querySelector('[data-testid=agent-mascot]'), 'the agent\'s icon, not the sparkles');
  await own.unmount();
  const plain = await render(t, { agent: agentWith(), locale: 'fr' });
  const fallback = plain.container.querySelector('[data-testid=agent-trigger]');
  assert.equal(fallback.getAttribute('aria-label'), 'Ouvrir l’assistant');
  assert.equal(fallback.querySelector('[data-testid=agent-mascot]'), null);
  assert.ok(fallback.querySelector('svg'), 'the default sparkles');
  await plain.unmount();
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
  assert.equal(row?.getAttribute('data-slot'), 'switch');
  assert.equal(row?.getAttribute('aria-label'), 'Mode sombre');
  const label = row?.parentElement.querySelector('label');
  assert.equal(label?.textContent.trim(), 'Mode sombre');
  assert.equal(label?.htmlFor, row?.parentElement.querySelector('input[type=checkbox]')?.id);
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

test('desktop account theme stays in the native menu keyboard order and closes on selection', async t => {
  const changed = [];
  const ui = await render(t, { account: { name: 'Fictional reviewer', menu: [{ label: 'Settings', onSelect() {} }], signOut() {}, theme: { value: 'light', onChange: value => changed.push(value) } } }, { width: 1440 });
  const { act } = await import('react');
  const key = async (element, value) => act(async () => element.dispatchEvent(new ui.window.KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true })));
  const until = async condition => { for (let attempt = 0; attempt < 40 && !condition(); attempt++) await act(async () => new Promise(resolve => setTimeout(resolve, 25))); assert.ok(condition()); };
  await key(ui.container.querySelector('[data-testid=nav-user]'), 'ArrowDown');
  await until(() => ui.window.document.activeElement?.textContent === 'Settings');
  await key(ui.window.document.activeElement, 'ArrowDown');
  assert.equal(ui.window.document.activeElement?.getAttribute('data-testid'), 'account-theme');
  assert.equal(ui.window.document.activeElement?.getAttribute('role'), 'menuitemcheckbox');
  assert.equal(ui.window.document.activeElement?.getAttribute('aria-checked'), 'false');
  await key(ui.window.document.activeElement, 'Enter');
  assert.deepEqual(changed, ['dark']);
  await until(() => !ui.window.document.querySelector('[role=menu]'));
  await ui.unmount();
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

// The layer's header actions: one layer open (its header is the drawer's on a phone, the dock's on a wide screen), the probe reads the layer's API.
async function openedLayer(t, width, specs, { search = '', state = null, strict = false } = {}) {
  const { createElement: h, useLayoutEffect, act, StrictMode } = await import('react');
  const shell = await bundle('shell-entry.tsx', `export { AppShell } from '${root}${folder}/app-shell.tsx';\nexport { useAgentLayer } from '${root}${folder}/agent-layer.tsx';\n`);
  let latest;
  const Probe = () => { const api = shell.useAgentLayer(); useLayoutEffect(() => { latest = api; }); return null; };
  const window = dom(t, width);
  window.history.replaceState(state, '', `/${search}`);
  const replaced = [];
  const replace = window.history.replaceState.bind(window.history);
  window.history.replaceState = (...args) => { replaced.push(args); return replace(...args); };
  const { createRoot } = await import('react-dom/client');
  const container = window.document.createElement('div');
  window.document.body.append(container);
  const reactRoot = createRoot(container);
  const nav = [{ id: 'Jour', label: 'Jour', icon: Icon, render: () => h(Probe) }];
  const app = h(shell.AppShell, { layout: 'screen', title: 'Forme', nav, route: { id: 'Jour', onChange() {} }, ...specs, locale: 'fr' });
  await act(async () => reactRoot.render(strict ? h(StrictMode, null, app) : app));
  t.after(() => act(async () => reactRoot.unmount()));
  return { window, replaced, latest: () => latest, act, unmount: () => act(async () => reactRoot.unmount()) };
}

for (const [width, agent, input] of [[390, 'coach', 'text'], [1280, 'agent', 'text'], [390, 'coach', 'voice'], [390, 'improve', 'text']]) {
  test(`agent URL at ${width}: ${agent}/${input} opens once, preserves other URL data and state, and never starts the microphone`, async t => {
    const spec = { ...agentWith(), voice: { transcribe: async () => 'Fictional dictation' } };
    const opened = await openedLayer(t, width, { agent: spec, improve: agentWith() }, { search: `?keep=hello%20world&agent=${agent}&open=half&input=${input}#jour`, state: { router: { fictional: 7 } }, strict: true });
    assert.equal(opened.latest().showing, agent === 'improve' ? 'improve' : 'agent');
    assert.equal(opened.latest().state, width === 1280 ? 'open' : input === 'voice' ? 'full' : 'half');
    assert.equal(opened.window.location.search, '?keep=hello+world');
    assert.equal(opened.window.location.hash, '#jour');
    assert.equal(opened.replaced.length, 1, 'StrictMode consumes the URL once');
    assert.deepEqual(opened.replaced[0][0], { router: { fictional: 7 } }, 'replaceState keeps the host state');
    await opened.act(async () => new Promise(done => setTimeout(done, 800)));
    const find = selector => opened.window.document.querySelector(selector);
    // « Améliorer l'app » is the PM panel (spec 2), in flow under the page, not a second chat in the agent layer.
    const composer = find(agent === 'improve' ? '[data-testid=pm-panel]:not([hidden]) [data-testid=composer-input]' : '[data-spec=agent] [data-testid=composer-input]');
    assert.ok(composer?.isConnected, 'the selected composer is mounted in the visible layer');
    if (agent === 'improve') {
      assert.equal(find('[data-spec=improve]'), null, 'no improve chat in the agent layer');
      assert.equal(find('[data-testid=pm-panel]')?.dataset.mode, 'sheet', 'the sheet (C2) opens, never point mode');
    } else if (input === 'text') {
      assert.equal(opened.window.document.activeElement, composer, 'focus remains on the composer after the drawer settles');
      assert.equal(opened.latest().state, width === 1280 ? 'open' : 'full', 'composer focus promotes half to full');
    } else {
      assert.notEqual(opened.window.document.activeElement, composer, 'voice does not raise the keyboard');
      assert.equal(find('[data-testid=agent-talk]')?.dataset.state, 'idle', 'the microphone waits for a press');
    }
    await opened.act(async () => opened.latest().close());
    await opened.act(async () => new Promise(done => setTimeout(done, 600)));
    assert.equal(opened.latest().state, 'closed', 'a rerender never reopens the consumed URL');
    await opened.unmount();
  });
}

for (const [name, specs, search, clean] of [
  ['unknown', { agent: agentWith() }, '?agent=unknown&open=full&input=text&keep=1#jour', '?keep=1'],
  ['missing spec', {}, '?agent=coach&input=text&keep=1#jour', '?keep=1'],
  ['opt-out', { agent: agentWith(), agentLink: false }, '?agent=coach&input=text#jour', '?agent=coach&input=text'],
]) test(`agent URL: ${name} stays closed`, async t => {
  const opened = await openedLayer(t, 390, specs, { search, state: { fictional: true }, strict: true });
  await opened.act(async () => new Promise(done => setTimeout(done, 650)));
  assert.equal(opened.latest().state, 'closed');
  assert.equal(opened.window.location.search, clean);
  assert.equal(opened.window.location.hash, '#jour');
  assert.deepEqual(opened.window.history.state, { fictional: true });
  await opened.unmount();
});

test('agent URL: closing before the drawer settles cancels composer focus', async t => {
  const opened = await openedLayer(t, 390, { agent: agentWith() }, { search: '?agent=coach&input=text', strict: true });
  assert.equal(opened.latest().state, 'full', 'the URL opened the layer');
  await opened.act(async () => opened.latest().close());
  await opened.act(async () => new Promise(done => setTimeout(done, 800)));
  assert.equal(opened.latest().state, 'closed');
  assert.notEqual(opened.window.document.activeElement?.getAttribute('data-testid'), 'composer-input');
  await opened.unmount();
});

async function headerOf(opened, which) {
  await opened.act(async () => opened.latest().open(which, 'half'));
  for (let tries = 0; tries < 40 && !opened.window.document.querySelector('[data-testid=agent-layer-header]'); tries++) await opened.act(async () => new Promise(done => setTimeout(done, 25)));
  return opened.window.document.querySelector('[data-testid=agent-layer-header]');
}

for (const width of [390, 1280]) {
  test(`the layer header actions at ${width}: a button with its label runs onSelect, a href is a link (target and rel only when passed), none when absent`, async t => {
    const calls = [];
    const agent = { ...agentWith(), headerActions: [
      { id: 'go', label: 'Ouvrir la boutique', icon: Icon, onSelect: () => calls.push('go') },
      { id: 'wa', label: 'Discuter avec Max sur WhatsApp', icon: Icon, href: '/whatsapp/open?app=fitness', onSelect: () => calls.push('wa') },
    ] };
    const opened = await openedLayer(t, width, { agent, improve: agentWith() });
    const header = await headerOf(opened, 'agent');
    const button = header.querySelector('[data-testid=agent-layer-action-go]');
    assert.equal(button?.tagName, 'BUTTON');
    assert.equal(button?.getAttribute('aria-label'), 'Ouvrir la boutique');
    assert.equal(button?.getAttribute('title'), 'Ouvrir la boutique', 'the tooltip');
    const link = header.querySelector('[data-testid=agent-layer-action-wa]');
    assert.equal(link?.tagName, 'A');
    assert.equal(link?.getAttribute('href'), '/whatsapp/open?app=fitness');
    assert.equal(link?.hasAttribute('target'), false, 'no target unless the host passes one');
    assert.equal(link?.hasAttribute('rel'), false, 'no rel unless the host passes one');
    await opened.act(async () => button.dispatchEvent(new opened.window.MouseEvent('click', { bubbles: true, cancelable: true })));
    assert.deepEqual(calls, ['go'], 'the click runs onSelect');
    // The product manager is the PM panel (spec 2): its header is ^ and × (C2), never the coach's actions.
    await opened.act(async () => opened.latest().open('improve', 'half'));
    await opened.act(async () => new Promise(done => setTimeout(done, 50)));
    const pm = opened.window.document.querySelector('[data-testid=pm-panel]');
    assert.ok(pm && !pm.hidden, 'the PM sheet opens');
    assert.equal(pm.querySelector('[data-testid^=agent-layer-action-]'), null, 'and not the coach\'s actions');
    await opened.unmount();

    const bare = await openedLayer(t, width, { agent: agentWith() });
    const plain = await headerOf(bare, 'agent');
    assert.ok(plain, 'the header renders');
    assert.equal(plain.querySelector('[data-testid^=agent-layer-action-]'), null, 'nothing renders when there are no actions');
    await bare.unmount();
  });

  test(`the layer header at ${width}: a third action goes in the overflow control, never in the title row`, async t => {
    const three = ['a', 'b', 'c'].map(id => ({ id, label: `Action ${id}`, icon: Icon, onSelect() {} }));
    const opened = await openedLayer(t, width, { agent: { ...agentWith(), headerActions: three } });
    const header = await headerOf(opened, 'agent');
    assert.ok(header.querySelector('[data-testid=agent-layer-action-b]'), 'the second is shown');
    assert.equal(header.querySelector('[data-testid=agent-layer-action-c]'), null, 'the third is not');
    assert.ok(header.querySelector('[data-testid=agent-layer-more]'), 'the overflow control');
    await opened.unmount();
  });
}

test('the phone overflow of the layer header is a link when the third action has an href (target and rel kept)', async t => {
  const three = [
    { id: 'a', label: 'Action a', icon: Icon, onSelect() {} },
    { id: 'b', label: 'Action b', icon: Icon, onSelect() {} },
    { id: 'c', label: 'Inviter', icon: Icon, href: '/invite?app=fitness', target: '_blank', rel: 'noopener', onSelect() {} },
  ];
  const opened = await openedLayer(t, 390, { agent: { ...agentWith(), headerActions: three } });
  const header = await headerOf(opened, 'agent');
  const more = header.querySelector('[data-testid=agent-layer-more]');
  await opened.act(async () => more.dispatchEvent(new opened.window.MouseEvent('click', { bubbles: true, cancelable: true })));
  for (let tries = 0; tries < 40 && !opened.window.document.querySelector('[data-testid=app-sheet] a'); tries++) await opened.act(async () => new Promise(done => setTimeout(done, 25)));
  const link = opened.window.document.querySelector('[data-testid=app-sheet] [data-testid=agent-layer-action-c]');
  assert.equal(link?.tagName, 'A', 'the overflow entry is an anchor');
  assert.equal(link?.getAttribute('href'), '/invite?app=fitness');
  assert.equal(link?.getAttribute('target'), '_blank');
  assert.equal(link?.getAttribute('rel'), 'noopener');
  await opened.unmount();
});

test('the screen header follows an action whose href, target or rel changes alone (the change key covers them)', async t => {
  const { createElement: h, act, useState } = await import('react');
  const { createRoot } = await import('react-dom/client');
  const shell = await bundle('screen-header-entry.tsx', `export { AppShell } from '${root}${folder}/app-shell.tsx';\nexport { useScreenHeader } from '${root}${folder}/header.tsx';\n`);
  const window = dom(t, 390);
  const Screen = ({ href, target, rel }) => { shell.useScreenHeader({ actions: [{ id: 'go', label: 'Ouvrir', icon: Icon, href, target, rel, onSelect() {} }] }); return null; };
  const Host = () => {
    const [link, setLink] = useState({ href: '/a' });
    return h('div', null, h('button', { type: 'button', id: 'change', onClick: () => setLink({ href: '/b', target: '_blank', rel: 'noopener' }) }), h(Screen, link));
  };
  const container = window.document.createElement('div');
  window.document.body.append(container);
  const reactRoot = createRoot(container);
  await act(async () => reactRoot.render(h(shell.AppShell, { layout: 'screen', title: 'Forme', nav: [{ id: 'Jour', label: 'Jour', icon: Icon, render: () => h(Host) }], route: { id: 'Jour', onChange() {} }, locale: 'fr' })));
  const link = () => window.document.querySelector('[data-testid=header-action-go]');
  assert.equal(link()?.getAttribute('href'), '/a');
  await act(async () => window.document.querySelector('#change').dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true })));
  assert.equal(link()?.getAttribute('href'), '/b', 'the new destination shows');
  assert.equal(link()?.getAttribute('target'), '_blank');
  assert.equal(link()?.getAttribute('rel'), 'noopener');
  await act(async () => reactRoot.unmount());
});

test('the screen header: `leading` renders right after the sidebar trigger and before the title; `titleFace: sans` and `dense` change the title face and the row height; defaults are unchanged', async t => {
  const { createElement: h, act } = await import('react');
  const { createRoot } = await import('react-dom/client');
  const shell = await bundle('screen-header-entry.tsx', `export { AppShell } from '${root}${folder}/app-shell.tsx';\nexport { useScreenHeader } from '${root}${folder}/header.tsx';\n`);
  const window = dom(t, 1280);
  const Screen = ({ spec }) => { shell.useScreenHeader(spec); return null; };
  const container = window.document.createElement('div');
  window.document.body.append(container);
  const reactRoot = createRoot(container);
  const show = spec => act(async () => reactRoot.render(h(shell.AppShell, { layout: 'screen', title: 'Forme', nav: [{ id: 'Jour', label: 'Jour', icon: Icon, render: () => h(Screen, { spec }) }], route: { id: 'Jour', onChange() {} }, locale: 'fr' })));
  const q = id => window.document.querySelector(`[data-testid=${id}]`);
  await show({ title: 'Dossier' });
  assert.equal(q('header-leading'), null, 'no leading, no wrapper');
  assert.match(q('screen-header').className, /min-h-14/);
  assert.match(q('header-title').className, /font-display|--font-display/);
  await show({ title: 'Dossier', leading: h('button', { type: 'button', 'data-testid': 'lead' }, 'Cabinet'), titleFace: 'sans', dense: true });
  const header = q('screen-header');
  const order = [...header.querySelectorAll('[data-sidebar=trigger],[data-testid=header-leading],[data-testid=header-title]')].map(el => el.getAttribute('data-sidebar') ?? el.getAttribute('data-testid'));
  assert.deepEqual(order, ['trigger', 'header-leading', 'header-title'], 'the leading slot sits between the trigger and the title');
  assert.ok(q('header-leading').querySelector('[data-testid=lead]'));
  assert.match(header.className, /min-h-12/);
  assert.doesNotMatch(header.className, /min-h-14/);
  assert.match(q('header-title').className, /font-sans/);
  assert.doesNotMatch(q('header-title').className, /font-display/);
  await show({ title: 'Dossier', leading: h('button', { type: 'button', 'data-testid': 'lead2' }, 'Urgences') });
  assert.ok(q('header-leading').querySelector('[data-testid=lead2]'), 'a changed leading node shows');
  await act(async () => reactRoot.unmount());
});

// The composer microphone on a phone: a fake microphone and recorder (the pattern of test/ui/voice-input.test.mjs), the layer open at half.
async function talking(t, snap = 'half', options = {}) {
  const tracks = [], transcribed = [], uploads = [], sends = [];
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'MediaRecorder');
  class FakeRecorder extends EventTarget {
    static isTypeSupported() { return true; }
    constructor() { super(); this.state = 'inactive'; this.mimeType = 'audio/webm'; }
    start() { this.state = 'recording'; }
    stop() { this.state = 'inactive'; const chunk = new Event('dataavailable'); chunk.data = new Blob(['fictional audio'], { type: 'audio/webm' }); this.dispatchEvent(chunk); this.dispatchEvent(new Event('stop')); }
  }
  globalThis.MediaRecorder = FakeRecorder;
  t.after(() => { previous ? Object.defineProperty(globalThis, 'MediaRecorder', previous) : delete globalThis.MediaRecorder; });
  const transcribe = async audio => { transcribed.push(audio); if (options.failTranscribe) throw new Error('Fictional transcription failure'); return 'fictional words'; };
  const controller = Object.create(idleController);
  controller.send = async (...args) => { sends.push(args); return { id: 1 }; };
  const attachments = { upload: async files => { uploads.push(files); return [{ path: `uploads/${files[0].name}`, name: files[0].name }]; } };
  const opened = await openedLayer(t, 390, { agent: { ...agentWith(options.send === 'message' ? { attachments } : undefined), controller, voice: { transcribe, send: options.send ?? 'draft' } } });
  Object.defineProperty(opened.window.navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: async () => {
    if (options.refuseCapture) throw Object.assign(new Error('Fictional microphone refusal'), { name: 'NotAllowedError' });
    const track = { stopped: false, stop() { this.stopped = true; } }; tracks.push(track);
    return { getTracks: () => [track], getAudioTracks: () => [track] };
  } } });
  await opened.act(async () => opened.latest().open('agent', snap));
  const find = selector => opened.window.document.querySelector(selector);
  for (let tries = 0; tries < 200 && !(find('[data-testid=agent-talk]') && find('[data-testid=composer-input]')); tries++) await opened.act(async () => new Promise(done => setTimeout(done, 25)));
  const talk = find('[data-testid=agent-talk]');
  assert.ok(talk && find('[data-testid=composer-input]'), 'the microphone and the composer render');
  const fire = async (node, type, init = {}) => {
    const Pointer = opened.window.PointerEvent ?? opened.window.MouseEvent;
    const event = new Pointer(type, { bubbles: true, cancelable: true, pointerId: 1, ...init });
    await opened.act(async () => { node.dispatchEvent(event); });
    return event;
  };
  const until = async (condition, label) => { for (let tries = 0; tries < 60 && !condition(); tries++) await opened.act(async () => new Promise(done => setTimeout(done, 25))); assert.ok(condition(), label); };
  return { opened, find, get talk() { return find('[data-testid=agent-talk]'); }, fire, until, tracks, transcribed, uploads, sends };
}

for (const snap of ['half', 'full']) test(`the composer microphone at ${snap}: tap replaces editing with the recording row, keeps the snap, and Send finishes`, async t => {
  const ui = await talking(t, snap);
  assert.equal(ui.find('[data-testid=below-composer]'), null, 'no empty footer row');
  await ui.fire(ui.talk, 'click');
  await ui.until(() => ui.talk.dataset.state === 'recording', 'recording');
  assert.equal(ui.find('[data-testid=composer-input]'), null, 'editable row is replaced');
  assert.ok(ui.find('[data-testid=voice-recording-bar]'));
  assert.equal(ui.find('[data-testid=agent-layer]').dataset.state, snap, 'the snap holds');
  await ui.fire(ui.talk, 'click');
  await ui.until(() => ui.transcribed.length === 1, 'Send transcribes');
  assert.equal(ui.tracks[0].stopped, true);
  await ui.until(() => ui.talk.dataset.state === 'idle', 'back to idle');
  assert.equal(ui.find('[data-testid=composer-input]').readOnly, false);
  await ui.opened.unmount();
});

test('the composer microphone: trash discards without transcription', async t => {
  const ui = await talking(t);
  await ui.fire(ui.talk, 'click');
  await ui.until(() => ui.talk.dataset.state === 'recording', 'recording');
  await ui.fire(ui.find('[data-testid=composer-voice-cancel]'), 'click');
  await ui.until(() => ui.talk.dataset.state === 'idle', 'discarded');
  assert.equal(ui.transcribed.length, 0); assert.equal(ui.tracks[0].stopped, true);
  await ui.opened.unmount();
});

test('the composer microphone: single tap starts and Send transcribes', async t => {
  const ui = await talking(t); await ui.fire(ui.talk, 'click');
  await ui.until(() => ui.talk.dataset.state === 'recording', 'recording');
  await ui.fire(ui.talk, 'click'); await ui.until(() => ui.transcribed.length === 1, 'transcribed');
  await ui.opened.unmount();
});

test('one layer at a time on a phone: opening the agent closes the product manager and back', t => oneLayerAt(t, 390));
test('one layer at a time on a wide screen: opening the agent closes the product manager and back', t => oneLayerAt(t, 1280));

for (const width of [390, 1280]) test(`the agent layer's chat at ${width} lists the agent's conversations over a relative, per-agent endpoint (useConversations from pi-chat): History, new, rename`, async t => {
  const { createElement: h, useLayoutEffect, useMemo, useState, act } = await import('react');
  const shell = await bundle('conversations-entry.tsx', `export { AppShell } from '${root}${folder}/app-shell.tsx';\nexport { useAgentLayer } from '${root}${folder}/agent-layer.tsx';\nexport { useConversations } from '${root}registry/pi-chat/use-conversations.ts';\n`);
  const window = dom(t, width);
  const requests = [];
  const rows = [{ id: 1, title: 'Fictional week plan', lastMessage: 'Plan the week', updatedAt: 1, archived: false }, { id: 2, title: 'Fictional groceries', lastMessage: null, updatedAt: 2, archived: false }];
  const fetch = async request => {
    const body = request.method === 'POST' ? await request.json() : undefined;
    requests.push({ url: request.url, method: request.method, body });
    if (new URL(request.url).searchParams.get('op') === 'create') { rows.push({ id: 3, title: null, lastMessage: null, updatedAt: 3, archived: false }); return Response.json({ conversationId: 3 }); }
    return Response.json({ conversations: rows });
  };
  let latest, listed, selected = [];
  const Probe = () => { const api = shell.useAgentLayer(); useLayoutEffect(() => { latest = api; }); return null; };
  const Host = () => {
    const [active, setActive] = useState('1');
    const conversations = shell.useConversations({ endpoint: '_agent/coach/conversations', fetch, activeId: active, onSelect: id => { selected.push(id); setActive(id); } });
    listed = conversations;
    const agent = useMemo(() => agentWith(conversations ? { conversations } : undefined), [conversations]);
    return h(shell.AppShell, { layout: 'screen', title: 'Forme', nav: [{ id: 'Jour', label: 'Jour', icon: Icon, render: () => h(Probe) }], route: { id: 'Jour', onChange() {} }, locale: 'fr', agent });
  };
  const { createRoot } = await import('react-dom/client');
  const container = window.document.createElement('div'); window.document.body.append(container);
  const reactRoot = createRoot(container);
  await act(async () => reactRoot.render(h(Host)));
  for (let tries = 0; tries < 40 && !requests.length; tries++) await act(async () => new Promise(done => setTimeout(done, 25)));
  assert.equal(requests[0].url, 'https://fictional.invalid/_agent/coach/conversations', 'the endpoint is relative to the page and names the agent');
  const find = selector => window.document.querySelector(selector);
  for (let tries = 0; tries < 40 && !listed; tries++) await act(async () => new Promise(done => setTimeout(done, 25)));
  await act(async () => latest.open('agent', 'half'));
  for (let tries = 0; tries < 80 && !find('[data-testid=agent-layer-header]'); tries++) await act(async () => new Promise(done => setTimeout(done, 25)));
  assert.ok(find('[data-testid=agent-layer-header]'), 'the layer is open');
  assert.ok(find('[data-spec=agent] [data-testid=history-open]'), 'the layer\'s chat offers History once the agent has conversations');
  assert.deepEqual(listed.items.map(item => item.title), ['Fictional week plan', 'Fictional groceries'], 'the list the chat shows');
  await act(async () => listed.onNew());
  for (let tries = 0; tries < 40 && !selected.length; tries++) await act(async () => new Promise(done => setTimeout(done, 25)));
  const create = requests.find(request => request.method === 'POST');
  assert.equal(create.url, 'https://fictional.invalid/_agent/coach/conversations?op=create');
  assert.deepEqual(selected, ['3'], 'New selects the conversation it made (the host then opens its controller)');
  await act(async () => listed.rename('3', 'Fictional dinner'));
  assert.deepEqual(requests.filter(request => request.method === 'POST').at(-1), { url: 'https://fictional.invalid/_agent/coach/conversations?op=rename', method: 'POST', body: { conversationId: '3', title: 'Fictional dinner' } });
  await act(async () => reactRoot.unmount());
});

test('agent message mode uses one composer microphone and sends one retained upload with the transcript', async t => {
  const ui = await talking(t, 'half', { send: 'message' });
  assert.equal(ui.find('[data-testid=voice-message-record]'), null, 'no second PiChat microphone');
  const input = ui.find('[data-testid=composer-input]');
  await ui.opened.act(async () => input.focus());
  await ui.fire(ui.talk, 'click');
  assert.equal(ui.find('[data-testid=composer-input]'), null, 'the editable input is replaced while recording');
  await ui.until(() => ui.talk.dataset.state === 'recording', 'recording');
  await ui.fire(ui.talk, 'click');
  await ui.until(() => ui.sends.length === 1, 'one message admitted');
  assert.equal(ui.uploads.length, 1);
  assert.match(ui.sends[0][1].text, /^@uploads\/voice-.*\.webm fictional words$/);
  assert.deepEqual(ui.sends[0][1].restore, { text: 'fictional words' });
  await ui.opened.unmount();
});

test('a message-mode failure from the phone trigger reveals half with explicit actions, never the composer keyboard', async t => {
  const ui = await talking(t, 'half', { send: 'message', failTranscribe: true });
  await ui.opened.act(async () => ui.opened.latest().close());
  const trigger = ui.find('[data-testid=agent-trigger]');
  await ui.fire(trigger, 'pointerdown', { button: 0 });
  await ui.until(() => ui.find('[data-testid=agent-listening]')?.dataset.phase === 'recording', 'recording at peek');
  await ui.fire(trigger, 'pointerup');
  await ui.until(() => ui.find('[data-testid=agent-layer]')?.dataset.state === 'half' && ui.find('[data-testid=voice-retry]'), 'actionable failure reveals half');
  assert.equal(ui.sends.length, 0); assert.equal(ui.uploads.length, 1);
  assert.ok(ui.find('[data-testid=voice-audio-only]')); assert.ok(ui.find('[data-testid=voice-discard]'));
  assert.notEqual(ui.opened.window.document.activeElement, ui.find('[data-testid=composer-input]'));
  await ui.opened.act(async () => ui.opened.window.document.dispatchEvent(new ui.opened.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })));
  await ui.until(() => ui.find('[data-testid=agent-layer]')?.dataset.state === 'peek', 'failure can still be collapsed');
  assert.ok(ui.find('[data-testid=voice-retry]'), 'collapsing does not discard the recording');
  await ui.opened.unmount();
});

for (const loss of ['Escape', 'blur', 'hidden']) for (const started of [false, true]) test(`message-mode trigger ${started ? 'hold' : 'delay'} cancels on ${loss}`, async t => {
  const ui = await talking(t, 'half', { send: 'message' });
  await ui.opened.act(async () => ui.opened.latest().close());
  const trigger = ui.find('[data-testid=agent-trigger]');
  await ui.fire(trigger, 'pointerdown', { button: 0 });
  if (started) await ui.until(() => ui.tracks.length === 1 && ui.find('[data-testid=agent-talk]')?.dataset.state === 'recording', 'the trigger starts its own recording');
  await ui.opened.act(async () => {
    if (loss === 'Escape') trigger.dispatchEvent(new ui.opened.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    else if (loss === 'blur') ui.opened.window.dispatchEvent(new ui.opened.window.Event('blur'));
    else { Object.defineProperty(ui.opened.window.document, 'hidden', { configurable: true, value: true }); ui.opened.window.document.dispatchEvent(new ui.opened.window.Event('visibilitychange')); }
  });
  if (started) await ui.until(() => ui.tracks.every(track => track.stopped), 'loss of the trigger gesture releases its microphone');
  else await ui.opened.act(async () => new Promise(resolve => setTimeout(resolve, 420)));
  await ui.fire(trigger, 'pointerup');
  await ui.opened.act(async () => new Promise(resolve => setTimeout(resolve, 30)));
  assert.equal(ui.uploads.length, 0); assert.equal(ui.transcribed.length, 0); assert.equal(ui.sends.length, 0);
  if (!started) assert.equal(ui.tracks.length, 0, 'a cancelled long-press timer cannot open the microphone later');
  if (loss === 'hidden') Object.defineProperty(ui.opened.window.document, 'hidden', { configurable: true, value: false });
  await ui.opened.unmount();
});

test('a message-mode microphone refusal at peek reveals its problem and survives the ending pointer cancellation', async t => {
  const ui = await talking(t, 'half', { send: 'message', refuseCapture: true });
  await ui.opened.act(async () => ui.opened.latest().close());
  const trigger = ui.find('[data-testid=agent-trigger]');
  await ui.fire(trigger, 'pointerdown', { button: 0 });
  await ui.until(() => ui.find('[data-testid=agent-layer]')?.dataset.state === 'half' && ui.find('[data-testid=agent-voice-problem]'), 'refusal is visible at half');
  await ui.fire(trigger, 'pointercancel');
  assert.match(ui.find('[data-testid=agent-voice-problem]').textContent, /Microphone bloqué/);
  assert.equal(ui.tracks.length, 0); assert.equal(ui.uploads.length, 0); assert.equal(ui.sends.length, 0);
  assert.notEqual(ui.opened.window.document.activeElement, ui.find('[data-testid=composer-input]'));
  await ui.opened.unmount();
});

test('useAgentLayer exposes the same app controller while closed, never the product manager controller', async t => {
  const improve = new Proxy(idleController, {});
  const opened = await openedLayer(t, 390, { agent: agentWith(), improve: { controller: improve } });
  assert.equal(opened.latest().agent, idleController, 'page content borrows the app controller without opening chat');
  assert.equal(opened.latest().state, 'closed');
  await opened.act(async () => opened.latest().open('improve'));
  assert.equal(opened.latest().agent, idleController, 'the product manager never replaces the app agent');
  await opened.unmount();
});

test('a new microphone refusal reveals its error without replacing an older failed voice row', async t => {
  const options = { send: 'message', failTranscribe: true };
  const ui = await talking(t, 'half', options);
  await ui.fire(ui.talk, 'click'); await ui.fire(ui.talk, 'click');
  await ui.until(() => !!ui.find('[data-testid=voice-retry]'), 'the earlier failed recording is retained');
  const old = ui.find('[data-testid=voice-pending]');
  await ui.opened.act(async () => ui.opened.window.document.dispatchEvent(new ui.opened.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })));
  await ui.until(() => ui.find('[data-testid=agent-layer]')?.dataset.state === 'peek', 'the failure can be collapsed');
  options.refuseCapture = true;
  const trigger = ui.find('[data-testid=agent-trigger]'); await ui.fire(trigger, 'pointerdown', { button: 0 });
  await ui.until(() => ui.find('[data-testid=agent-layer]')?.dataset.state === 'half' && ui.find('[data-testid=agent-voice-problem]'), 'the new capture refusal, not the old failed-row identity, reveals half');
  await ui.fire(trigger, 'pointercancel');
  assert.equal(ui.find('[data-testid=voice-pending]'), old);
  assert.equal(ui.uploads.length, 1); assert.equal(ui.sends.length, 0);
  await ui.opened.act(async () => ui.opened.window.document.dispatchEvent(new ui.opened.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })));
  await ui.until(() => ui.find('[data-testid=agent-layer]')?.dataset.state === 'peek', 'the refusal can also be collapsed');
  options.refuseCapture = false;
  await ui.fire(trigger, 'pointerdown', { button: 0 });
  await ui.until(() => ui.tracks.length === 2 && ui.talk.dataset.state === 'recording', 'the microphone can start again');
  assert.equal(ui.find('[data-testid=agent-layer]').dataset.state, 'peek', 'an already revealed older failure never interrupts a new hold');
  await ui.fire(trigger, 'pointercancel');
  assert.equal(ui.find('[data-testid=voice-pending]'), old);
  assert.equal(ui.uploads.length, 1);
  await ui.opened.unmount();
});

test('NavItem.sidebar: the screen on show puts its own content in the shell\'s sidebar, which folds with the icon rail', async t => {
  const { createElement: h } = await import('react');
  const seen = [];
  const items = [
    { id: 'list', label: 'Consultations', icon: Icon, render: () => null, sidebar: ({ collapsed }) => { seen.push(collapsed); return h('p', { 'data-testid': 'own-list' }, collapsed ? 'rail' : 'full'); } },
    { id: 'settings', label: 'Réglages', icon: Icon, render: () => null, sidebar: () => h('p', { 'data-testid': 'own-settings' }, 'settings') },
    { id: 'plain', label: 'Autre', icon: Icon, render: () => null },
  ];
  const ui = await render(t, { nav: items, route: { id: 'list', onChange() {} } }, { width: 1440 });
  const { act } = await import('react');
  const q = id => ui.container.querySelector(`[data-testid=${id}]`);
  assert.equal(q('own-list')?.textContent, 'full', 'the active screen\'s content is in the sidebar, expanded');
  assert.ok(q('own-settings') === null, 'only the screen on show');
  assert.ok(q('sidebar-screen').compareDocumentPosition(q('nav-list')) & ui.window.Node.DOCUMENT_POSITION_FOLLOWING, 'the nav items come after it');
  await act(async () => ui.container.querySelector('[data-sidebar=trigger]').click());
  assert.equal(q('own-list')?.textContent, 'rail', 'folding the shell\'s rail tells the content');
  assert.equal(seen.at(-1), true);
  await ui.unmount();
});

test('compactNav="sheet": a phone has no tab bar; the header\'s leading button opens the sidebar as a sheet, and choosing a screen closes it', async t => {
  const { createElement: h } = await import('react');
  const items = ['Jour', 'Semaine'].map(label => ({ id: label, label, icon: Icon, render: () => null, sidebar: () => h('p', { 'data-testid': 'own-list' }, 'liste') }));
  const chosen = [];
  const ui = await render(t, { compactNav: 'sheet', nav: items, route: { id: 'Jour', onChange: id => chosen.push(id) } });
  const { act } = await import('react');
  const doc = ui.window.document;
  assert.ok(ui.container.querySelector('[role=tablist]') === null, 'no bottom tab bar');
  assert.ok(doc.querySelector('[data-testid=app-sidebar]') === null, 'closed until asked');
  const trigger = ui.container.querySelector('[data-testid=screen-header] [data-sidebar=trigger]');
  assert.ok(trigger, 'the header\'s leading button is the sidebar trigger');
  await act(async () => trigger.click());
  for (let tries = 0; tries < 40 && !doc.querySelector('[data-testid=nav-Semaine]'); tries++) await act(async () => new Promise(done => setTimeout(done, 25)));
  assert.ok(doc.querySelector('[data-testid=nav-Semaine]'), 'the sidebar opens as a sheet with the nav items');
  assert.ok(doc.querySelector('[data-testid=nav-Semaine]').closest('.app-shell'), 'the portaled sheet is inside .app-shell, so the shell\'s button reset reaches its rows');
  assert.equal(doc.querySelector('[data-testid=own-list]')?.textContent, 'liste', 'and the screen\'s own sidebar content');
  await act(async () => doc.querySelector('[data-testid=nav-Semaine]').click());
  assert.deepEqual(chosen, ['Semaine']);
  for (let tries = 0; tries < 40 && doc.querySelector('[data-testid=nav-Semaine]'); tries++) await act(async () => new Promise(done => setTimeout(done, 25)));
  assert.ok(doc.querySelector('[data-testid=nav-Semaine]') === null, 'choosing closes the sheet');
  await ui.unmount();
});

test('compactNav defaults to the tab bar on a phone', async t => {
  const ui = await render(t, {});
  assert.ok(ui.container.querySelector('[role=tablist]'));
  assert.ok(ui.container.querySelector('[data-sidebar=trigger]') === null);
  await ui.unmount();
});
