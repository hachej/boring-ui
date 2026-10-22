import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { Window } from 'happy-dom';

// PlacedAgentWorkspace (registry/placed-agent): the Agent tab and the collapsed agent over ONE controller. Wide: the collapsed agent is a
// floating AmbientChat; the page keeps its node and its open view, and the draft (held by the controller) follows. Phone: never the ambient
// overlay; inside an app shell the same controller becomes the shell's drawer, outside one the agent stays a page.
const root = fileURLToPath(new URL('../../', import.meta.url));
let bundles = 0;
async function load() {
  const out = `${root}.cache/placed-agent-test`;
  mkdirSync(out, { recursive: true });
  const outfile = `${out}/bundle.mjs`;
  await build({ stdin: { contents: "export { PlacedAgentWorkspace, usePlacedAgent } from './placed-agent/placed-agent-workspace.tsx';\nexport { AppShell } from './app-shell/app-shell.tsx';\n", resolveDir: `${root}registry`, loader: 'ts' },
    outfile, bundle: true, format: 'esm', platform: 'node', jsx: 'automatic', packages: 'external', tsconfig: `${root}tsconfig.json`, alias: { '@': `${root}examples/app-shell` }, loader: { '.css': 'empty' },
    plugins: [{ name: 'file-tree-css', setup(builder) { builder.onResolve({ filter: /^@hachej\/boring-ui-kit\/file-tree\.css$/ }, () => ({ path: new URL(import.meta.resolve('@hachej/boring-ui-kit/file-tree.css')).pathname, external: false })); } }], logLevel: 'silent' });
  return import(`${pathToFileURL(outfile).href}?fresh=${++bundles}`);
}

async function page(t, width) {
  const window = new Window({ url: 'https://fictional.invalid/', settings: { disableIframePageLoading: true } });
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
  const names = ['window', 'document', 'navigator', 'history', 'location', 'HTMLElement', 'Element', 'Node', 'Text', 'DOMParser', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame', 'matchMedia', 'getSelection', 'MutationObserver', 'ResizeObserver',
    'Event', 'CustomEvent', 'EventTarget', 'KeyboardEvent', 'MouseEvent', 'PointerEvent', 'FocusEvent', 'DOMRect', 'sessionStorage', 'localStorage', 'confirm', 'addEventListener', 'removeEventListener', 'innerWidth', 'innerHeight', 'IS_REACT_ACT_ENVIRONMENT'];
  const saved = new Map(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  for (const name of names) {
    const value = name === 'window' ? window : name === 'IS_REACT_ACT_ENVIRONMENT' ? true : window[name];
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value: typeof value === 'function' && /^[a-z]/.test(name) ? value.bind(window) : value });
  }
  window.HTMLElement.prototype.getBoundingClientRect = () => ({ width, height: 800, left: 0, right: width, top: 0, bottom: 800, x: 0, y: 0 });
  const { createElement: h, act } = await import('react');
  const { createRoot } = await import('react-dom/client');
  const { createNativeChatController } = await import('@hachej/boring-ui-kit/native-chat');
  const lib = await load();
  const element = window.document.createElement('div');
  window.document.body.append(element);
  const root = createRoot(element);
  const controller = createNativeChatController({ identity: { runtimeId: 'fictional', scopeId: 'fictional', principalId: 'alice' },
    conversation: { id: 1 }, context: { value: () => undefined, toString: () => 'fictional' }, history: false,
    source: { open: async () => ({ value: { conversation: { id: 1 }, entries: [], docs: {} }, start() {}, closed: new Promise(() => {}), stop: async () => ({ kind: 'stopped' }) }) } });
  t.after(async () => {
    await act(async () => root.unmount());
    controller.dispose();
    await window.happyDOM.close();
    for (const [name, descriptor] of saved) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name]; }
  });
  const props = (extra = {}) => ({ controller, conversationId: 'one', storageKey: 'fictional.agent', resources: { endpoint: 'https://fictional.invalid/files', fetch: async () => new Response('{}', { status: 404 }), identity: { principalId: 'alice', scopeId: 'fictional', initiatorId: 'alice' } },
    defaultOpened: { kind: 'note' }, panels: { note: () => h('div', { 'data-testid': 'host-note' }, 'Fictional weekly note') }, ...extra });
  const q = selector => window.document.querySelector(selector);
  const settle = async ready => { for (let n = 0; n < 200 && !ready(); n++) await act(async () => new Promise(done => setTimeout(done, 25))); return ready(); };
  const click = target => act(async () => target.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true })));
  return { window, h, act, root, controller, lib, props, q, settle, click, render: node => act(async () => root.render(node)) };
}

test('wide: collapsing floats the same conversation, the page keeps its node, open view and draft, and expand returns', { timeout: 120000 }, async t => {
  const p = await page(t, 1440);
  await p.render(p.h(p.lib.PlacedAgentWorkspace, p.props()));
  await p.settle(() => p.q('[data-testid=placed-collapse]'));
  const composer = p.q('[data-testid=placed-agent] [data-testid=composer-input]'), note = p.q('[data-testid=host-note]');
  assert.ok(composer && note, 'the page shows its chat and its open view');
  assert.equal(p.q('[data-boring=ambient-chat]'), null, 'no floating chat while the page is on show');
  await p.act(async () => p.controller.setText('Résume la semaine'));
  await p.click(p.q('[data-testid=placed-collapse]'));
  assert.equal(p.q('[data-testid=placed-agent]').dataset.mode, 'ambient');
  const floating = p.q('[data-boring=ambient-chat]');
  assert.ok(floating && floating.parentElement === p.window.document.body, 'a floating AmbientChat over the app');
  assert.equal(floating.querySelector('[data-testid=composer-input]').value, 'Résume la semaine', 'the draft follows (one controller)');
  assert.equal(p.window.localStorage.getItem('fictional.agent.placement'), 'ambient', 'the placement is remembered');
  assert.ok(p.q('[data-testid=placed-agent]').hidden, 'the page is hidden, not unmounted');
  await p.click(p.q('[data-testid=ambient-dock]'));
  assert.equal(p.q('[data-testid=placed-agent]').dataset.mode, 'tab');
  assert.equal(p.q('[data-boring=ambient-chat]'), null);
  assert.ok(p.q('[data-testid=placed-agent] [data-testid=composer-input]') === composer, 'the page keeps its exact composer');
  assert.ok(p.q('[data-testid=host-note]') === note, 'the open view survived the round trip');
  assert.equal(composer.value, 'Résume la semaine');
  assert.equal(p.window.localStorage.getItem('fictional.agent.placement'), 'tab');
});

test('wide: a remembered placement is restored on load, and placement="tab" is a plain AgentWorkspace', { timeout: 120000 }, async t => {
  const p = await page(t, 1440);
  p.window.localStorage.setItem('fictional.agent.placement', 'ambient');
  await p.render(p.h(p.lib.PlacedAgentWorkspace, p.props()));
  assert.ok(await p.settle(() => p.q('[data-boring=ambient-chat]')), 'reload restores the floating chat');
  await p.render(p.h(p.lib.PlacedAgentWorkspace, p.props({ placement: 'tab', key: 'tab' })));
  await p.settle(() => p.q('[data-testid=placed-agent]'));
  assert.equal(p.q('[data-testid=placed-agent]').dataset.mode, 'tab');
  assert.equal(p.q('[data-boring=ambient-chat]'), null, 'tab only: never floats, whatever was remembered');
  assert.equal(p.q('[data-testid=placed-collapse]'), null, 'tab only: no collapse action');
});

test('phone outside an app shell: tab+ambient behaves as tab, never the ambient overlay', { timeout: 120000 }, async t => {
  const p = await page(t, 390);
  p.window.localStorage.setItem('fictional.agent.placement', 'ambient');
  await p.render(p.h(p.lib.PlacedAgentWorkspace, p.props()));
  await p.settle(() => p.q('[data-testid=placed-agent] [data-testid=composer-input]'));
  assert.equal(p.q('[data-testid=placed-agent]').dataset.mode, 'tab');
  assert.equal(p.q('[data-boring=ambient-chat]'), null);
  assert.equal(p.q('[data-testid=placed-collapse]'), null, 'nothing to collapse to');
});

test('phone inside an app shell: collapse lends the same controller to the shell drawer at peek (one drawer), expand returns to the tab', { timeout: 120000 }, async t => {
  const p = await page(t, 390);
  const Icon = () => null;
  const changes = [];
  const nav = [{ id: 'agent', label: 'Agent', icon: Icon, render: () => p.h(p.lib.PlacedAgentWorkspace, p.props({ onCollapsedChange: collapsed => changes.push(collapsed) })) },
    { id: 'approvals', label: 'Approvals', icon: Icon, render: () => null }];
  await p.render(p.h(p.lib.AppShell, { layout: 'screen', title: 'Fictional AP', nav, route: { id: 'agent', onChange() {} } }));
  await p.settle(() => p.q('[data-testid=placed-collapse]'));
  assert.equal(p.q('[data-testid=agent-layer]'), null, 'no drawer before the first collapse');
  await p.act(async () => p.controller.setText('Résume la semaine'));
  await p.click(p.q('[data-testid=placed-collapse]'));
  assert.ok(await p.settle(() => p.q('[data-testid=agent-layer]')), 'the shell drawer opens');
  assert.deepEqual(changes, [true]);
  assert.equal(p.window.document.querySelectorAll('[data-testid=agent-layer]').length, 1, 'exactly one chat drawer');
  assert.equal(p.q('[data-testid=agent-layer]').dataset.state, 'peek');
  assert.equal(p.q('[data-boring=ambient-chat]'), null, 'never the ambient overlay on a phone');
  assert.ok(p.q('[data-testid=screen-header]') && p.q('[data-testid=tabbar]'), 'the header and the tab bar are still there');
  assert.equal(p.q('[data-testid=agent-layer] [data-testid=composer-input]').value, 'Résume la semaine', 'the drawer shows the same draft');
  // Focusing the composer takes the drawer to full, where the title row (and the expand action) show.
  await p.act(async () => p.q('[data-testid=agent-layer] [data-testid=composer-input]').dispatchEvent(new p.window.FocusEvent('focusin', { bubbles: true })));
  assert.ok(await p.settle(() => p.q('[data-testid=agent-layer-action-expand]')), 'the expand action is in the drawer title row');
  await p.click(p.q('[data-testid=agent-layer-action-expand]'));
  assert.deepEqual(changes, [true, false]);
  assert.equal(p.q('[data-testid=placed-agent]').dataset.mode, 'tab');
  assert.ok(await p.settle(() => !p.q('[data-testid=agent-layer]') || p.q('[data-testid=agent-layer]').dataset.state === 'closed'), 'the drawer is given back');
});
