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
    const composer = find(`[data-spec=${agent === 'improve' ? 'improve' : 'agent'}] [data-testid=composer-input]`);
    assert.ok(composer?.isConnected, 'the selected composer is mounted in the visible layer');
    if (input === 'text') {
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
    const opened = await openedLayer(t, width, { agent, improve: { ...agentWith(), headerActions: [{ id: 'ask', label: 'Demander', icon: Icon, onSelect: () => calls.push('ask') }] } });
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
    const improve = await headerOf(opened, 'improve');
    assert.ok(improve.querySelector('[data-testid=agent-layer-action-ask]'), 'the product manager has its own actions');
    assert.equal(improve.querySelector('[data-testid=agent-layer-action-go]'), null, 'and not the coach\'s');
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

// The composer microphone on a phone: a fake microphone and recorder (the pattern of test/ui/voice-input.test.mjs), the layer open at half.
async function talking(t, snap = 'half') {
  const tracks = [], transcribed = [];
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'MediaRecorder');
  class FakeRecorder extends EventTarget {
    static isTypeSupported() { return true; }
    constructor() { super(); this.state = 'inactive'; this.mimeType = 'audio/webm'; }
    start() { this.state = 'recording'; }
    stop() { this.state = 'inactive'; const chunk = new Event('dataavailable'); chunk.data = new Blob(['fictional audio'], { type: 'audio/webm' }); this.dispatchEvent(chunk); this.dispatchEvent(new Event('stop')); }
  }
  globalThis.MediaRecorder = FakeRecorder;
  t.after(() => { previous ? Object.defineProperty(globalThis, 'MediaRecorder', previous) : delete globalThis.MediaRecorder; });
  const transcribe = async audio => { transcribed.push(audio); return 'fictional words'; };
  const opened = await openedLayer(t, 390, { agent: { ...agentWith(), voice: { transcribe, send: 'draft' } } });
  Object.defineProperty(opened.window.navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: async () => {
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
  return { opened, find, talk, fire, until, tracks, transcribed };
}

for (const snap of ['half', 'full']) test(`the composer microphone at ${snap}: a press keeps focus where it was, a browser pointercancel while recording keeps the audio, the composer takes no focus and the snap holds`, async t => {
  const ui = await talking(t, snap);
  const input = ui.find('[data-testid=composer-input]');
  const down = await ui.fire(ui.talk, 'pointerdown', { button: 0 });
  assert.equal(down.defaultPrevented, true, 'pressing the microphone cannot move focus (no keyboard opens or closes)');
  assert.equal((await ui.fire(ui.talk, 'mousedown', { button: 0 })).defaultPrevented, true, 'nor does the compatibility mousedown');
  await ui.until(() => ui.talk.dataset.state === 'recording', 'recording');
  assert.equal(input.readOnly, true, 'the composer is read-only while recording');
  assert.equal(input.getAttribute('inputmode'), 'none', 'and asks for no keyboard');
  const before = ui.find('[data-testid=agent-layer]').dataset.state;
  await ui.opened.act(async () => input.focus());
  await ui.fire(input, 'focusin');
  assert.equal(ui.find('[data-testid=agent-layer]').dataset.state, before, 'focusing the composer while recording does not change the snap');
  await ui.fire(ui.talk, 'pointercancel');
  await ui.until(() => ui.transcribed.length === 1, 'a browser pointercancel finishes the recording: the audio is transcribed');
  assert.equal(ui.tracks[0].stopped, true, 'the microphone is released');
  await ui.until(() => ui.talk.dataset.state === 'idle', 'back to idle');
  assert.equal(input.readOnly, false, 'the composer is editable again');
  assert.equal(input.hasAttribute('inputmode'), false, 'with its own inputmode back');
  await ui.opened.unmount();
});

test('the composer microphone: sliding more than 24px off the button still cancels (nothing is transcribed)', async t => {
  const ui = await talking(t);
  await ui.fire(ui.talk, 'pointerdown', { button: 0, clientX: 0, clientY: 0 });
  await ui.until(() => ui.talk.dataset.state === 'recording', 'recording');
  await ui.fire(ui.talk, 'pointermove', { clientX: 400, clientY: 400 });
  await ui.until(() => ui.talk.dataset.state === 'idle', 'the slide off cancelled');
  await ui.fire(ui.talk, 'pointerup');
  assert.equal(ui.transcribed.length, 0, 'a cancelled recording is not transcribed');
  assert.equal(ui.tracks[0].stopped, true, 'the microphone is released');
  await ui.opened.unmount();
});

test('the composer microphone: a release (pointerup) still sends the audio for transcription', async t => {
  const ui = await talking(t);
  await ui.fire(ui.talk, 'pointerdown', { button: 0 });
  await ui.until(() => ui.talk.dataset.state === 'recording', 'recording');
  await ui.fire(ui.talk, 'pointerup');
  await ui.until(() => ui.transcribed.length === 1, 'transcribed');
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
