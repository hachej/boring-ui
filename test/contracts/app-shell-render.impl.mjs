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
async function openedLayer(t, width, specs) {
  const { createElement: h, useLayoutEffect, act } = await import('react');
  const shell = await bundle('shell-entry.tsx', `export { AppShell } from '${root}${folder}/app-shell.tsx';\nexport { useAgentLayer } from '${root}${folder}/agent-layer.tsx';\n`);
  let latest;
  const Probe = () => { const api = shell.useAgentLayer(); useLayoutEffect(() => { latest = api; }); return null; };
  const window = dom(t, width);
  const { createRoot } = await import('react-dom/client');
  const container = window.document.createElement('div');
  window.document.body.append(container);
  const reactRoot = createRoot(container);
  const nav = [{ id: 'Jour', label: 'Jour', icon: Icon, render: () => h(Probe) }];
  await act(async () => reactRoot.render(h(shell.AppShell, { layout: 'screen', title: 'Forme', nav, route: { id: 'Jour', onChange() {} }, ...specs, locale: 'fr' })));
  return { window, latest: () => latest, act, unmount: () => act(async () => reactRoot.unmount()) };
}

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

test('one layer at a time on a phone: opening the agent closes the product manager and back', t => oneLayerAt(t, 390));
test('one layer at a time on a wide screen: opening the agent closes the product manager and back', t => oneLayerAt(t, 1280));

for (const width of [390, 1280]) test(`the agent layer's chat at ${width} lists the agent's conversations over a relative, per-agent endpoint (useConversations from pi-chat): select, new`, async t => {
  const { createElement: h, useLayoutEffect, useState, act } = await import('react');
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
  let latest, selected = [];
  const Probe = () => { const api = shell.useAgentLayer(); useLayoutEffect(() => { latest = api; }); return null; };
  const Host = () => {
    const [active, setActive] = useState('1');
    const conversations = shell.useConversations({ endpoint: '_agent/coach/conversations', fetch, activeId: active, onSelect: id => { selected.push(id); setActive(id); } });
    return h(shell.AppShell, { layout: 'screen', title: 'Forme', nav: [{ id: 'Jour', label: 'Jour', icon: Icon, render: () => h(Probe) }], route: { id: 'Jour', onChange() {} }, locale: 'fr',
      agent: agentWith(conversations ? { conversations } : undefined) });
  };
  const { createRoot } = await import('react-dom/client');
  const container = window.document.createElement('div'); window.document.body.append(container);
  const reactRoot = createRoot(container);
  await act(async () => reactRoot.render(h(Host)));
  for (let tries = 0; tries < 40 && !requests.length; tries++) await act(async () => new Promise(done => setTimeout(done, 25)));
  assert.equal(requests[0].url, 'https://fictional.invalid/_agent/coach/conversations', 'the endpoint is relative to the page and names the agent');
  await act(async () => latest.open('agent', 'half'));
  const find = selector => window.document.querySelector(selector);
  for (let tries = 0; tries < 40 && !find('[data-testid=history-open]'); tries++) await act(async () => new Promise(done => setTimeout(done, 25)));
  await act(async () => find('[data-testid=history-open]').dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true })));
  for (let tries = 0; tries < 40 && !find('[data-testid=conversation-row]'); tries++) await act(async () => new Promise(done => setTimeout(done, 25)));
  const titles = [...window.document.querySelectorAll('[data-testid=conversation-row]')].map(row => row.textContent);
  assert.ok(titles.some(text => text.includes('Fictional week plan')) && titles.some(text => text.includes('Fictional groceries')), `the list shows the agent's conversations: ${titles}`);
  await act(async () => find('[data-testid=conversation-new]').dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true })));
  for (let tries = 0; tries < 40 && !selected.length; tries++) await act(async () => new Promise(done => setTimeout(done, 25)));
  const create = requests.find(request => request.method === 'POST');
  assert.equal(create.url, 'https://fictional.invalid/_agent/coach/conversations?op=create');
  assert.deepEqual(selected, ['3'], 'New selects the conversation it made (the host then opens its controller)');
  await act(async () => reactRoot.unmount());
});
