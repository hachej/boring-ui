// The Spaces block through its public entry, rendered in happy-dom over a fictional host's transport.
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { Window } from 'happy-dom';

const project = fileURLToPath(new URL('../../', import.meta.url));
const out = `${project}.cache/spaces-render-test`;
mkdirSync(out, { recursive: true });
writeFileSync(`${out}/entry.tsx`, `export * from '${project}registry/spaces/index.ts';\n`);
const outfile = `${out}/spaces.mjs`;
await build({ entryPoints: [`${out}/entry.tsx`], outfile, bundle: true, format: 'esm', platform: 'node', jsx: 'automatic', packages: 'external', alias: { '@': `${project}examples/app-shell` }, logLevel: 'silent' });

const NAMES = ['window', 'document', 'navigator', 'localStorage', 'HTMLElement', 'HTMLInputElement', 'HTMLSelectElement', 'Element', 'Node', 'Event', 'EventTarget', 'KeyboardEvent', 'MouseEvent', 'PointerEvent', 'MutationObserver', 'ResizeObserver', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame', 'DocumentFragment', 'ShadowRoot', 'SVGElement', 'HTMLIFrameElement', 'matchMedia'];
const SPACES = [{ id: 'a', kind: 'project', title: 'Alpha', role: 'manager' }, { id: 'b', kind: 'project', title: 'Beta', role: 'guest' }];
const ROLES = [{ id: 'manager', label: 'Manager', manage: true }, { id: 'guest', label: 'Guest' }];
const VIEW = { space: { ...SPACES[0], orphaned: false }, members: [{ person: 'me', name: 'Me', role: 'manager' }, { person: 'other', name: 'Other', role: 'guest' }], access: [{ by: 'admin', at: '2026-01-02T03:04:05.000Z', reason: 'Fictional support', write: false, until: '2026-01-03T00:00:00.000Z' }] };

async function fixture(t, { url = 'https://fictional.invalid/', refuse = {} } = {}) {
  const window = new Window({ url });
  const saved = new Map(NAMES.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  for (const name of NAMES) {
    const value = name === 'window' ? window : typeof window[name] === 'function' && !/^[A-Z]/.test(name) ? window[name].bind(window) : window[name];
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  }
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const { createElement: h, act, StrictMode, useState } = await import('react');
  const { createRoot } = await import('react-dom/client');
  const block = await import(pathToFileURL(outfile).href);
  const calls = [];
  const transport = async (operation, input) => {
    calls.push({ operation, input });
    if (refuse[operation]) throw Object.assign(new Error('Raw host words'), { code: refuse[operation] });
    if (operation === 'spaces.list') return { spaces: SPACES };
    if (operation === 'spaces.create') return { space: SPACES[1] };
    if (operation === 'spaces.get') return VIEW;
    if (operation === 'invites.accept') return { space: SPACES[1] };
    if (operation === 'members.invite') return { invite: { token: 'fict token', expiresAt: '2026-01-09T00:00:00.000Z' } };
    return {};
  };
  let api;
  const seen = {};
  function Page({ view, me = 'me' }) {
    api = block.useSpaces({ kind: 'project', transport });
    const [open, setOpen] = useState(true);
    seen.open = open;
    return h('main', null,
      h(block.SpaceSwitcher, { label: 'Projects', spaces: api.spaces ?? [], current: api.current, onSelect: api.select }),
      view && h(block.MembersSheet, { open, onOpenChange: setOpen, view, roles: ROLES, me,
        onInvite: (email, role) => api.invite('a', email, role), onSetRole: (person, role) => api.setRole('a', person, role), onRemove: person => api.remove('a', person), onLeave: () => api.leave('a') }));
  }
  const mount = window.document.createElement('div');
  window.document.body.append(mount);
  const root = createRoot(mount);
  const settle = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
  const render = async props => { await act(async () => root.render(h(StrictMode, null, h(Page, props)))); await settle(); };
  const find = selector => window.document.querySelector(selector);
  const click = async node => { await act(async () => { node.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true })); }); await settle(); };
  t.after(async () => {
    await act(async () => root.unmount());
    for (const [name, descriptor] of saved) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name]; }
    await window.happyDOM.close();
  });
  return { window, calls, render, settle, find, click, act, api: () => api };
}

test('useSpaces lists a kind, picks the first, remembers a choice per kind, and create carries an idempotency key', async t => {
  const ui = await fixture(t);
  await ui.render({});
  assert.deepEqual(ui.calls[0], { operation: 'spaces.list', input: { kind: 'project' } });
  assert.equal(ui.api().current.id, 'a');
  assert.match(ui.find('[data-testid=space-switcher-trigger]').textContent, /Alpha/);
  await ui.act(async () => ui.api().select('b'));
  await ui.settle();
  assert.equal(ui.api().current.id, 'b');
  assert.equal(ui.window.localStorage.getItem('space:project'), 'b');
  await ui.act(async () => { await ui.api().create('New'); });
  const created = ui.calls.find(call => call.operation === 'spaces.create');
  assert.equal(created.input.kind, 'project');
  assert.equal(created.input.title, 'New');
  assert.ok(created.input.idempotencyKey);
});

test('an invitation in the address is accepted once under Strict Mode, opened, and removed from the address', async t => {
  const ui = await fixture(t, { url: 'https://fictional.invalid/page?invite=one-time&keep=1' });
  await ui.render({});
  assert.equal(ui.calls.filter(call => call.operation === 'invites.accept').length, 1);
  assert.equal(ui.window.location.search, '?keep=1');
  assert.equal(ui.api().current.id, 'b');
});

test('a refused list shows the words for its code, not the raw error', async t => {
  const ui = await fixture(t, { refuse: { 'spaces.list': 'manage' } });
  await ui.render({});
  assert.equal(ui.api().error, 'Only a manager of this space can do this.');
});

test('SpaceSwitcher asks for a choice without a current space and offers each space', async t => {
  const ui = await fixture(t);
  await ui.render({});
  await ui.act(async () => ui.api().select('missing'));
  await ui.settle();
  assert.match(ui.find('[data-testid=space-switcher-trigger]').textContent, /Choose: projects/);
  await ui.click(ui.find('[data-testid=space-switcher-trigger]'));
  assert.match(ui.find('[data-testid=space-b]').textContent, /Beta/);
  await ui.click(ui.find('[data-testid=space-b]'));
  assert.equal(ui.api().current.id, 'b');
});

test('MembersSheet: a manager changes roles, removes others, invites and leaves through the host', async t => {
  const ui = await fixture(t);
  await ui.render({ view: VIEW });
  assert.equal(ui.find('[data-testid=member-me] button'), null, 'never offered to remove themselves');
  assert.match(ui.find('[data-testid=admin-access]').textContent, /Fictional support/);
  await ui.click(ui.find('[data-testid=member-other] button[aria-label=Remove]'));
  assert.deepEqual({ ...ui.calls.at(-1).input, idempotencyKey: undefined }, { space: 'a', person: 'other', idempotencyKey: undefined });
  assert.equal(ui.calls.at(-1).operation, 'members.remove');
  const select = ui.find('[data-testid=member-other] select');
  await ui.act(async () => {
    Object.getOwnPropertyDescriptor(ui.window.HTMLSelectElement.prototype, 'value').set.call(select, 'manager');
    select.dispatchEvent(new ui.window.Event('change', { bubbles: true }));
  });
  await ui.settle();
  assert.equal(ui.calls.at(-1).operation, 'members.setRole');
  assert.equal(ui.calls.at(-1).input.role, 'manager');
  const email = ui.find('[data-testid=invite-email]');
  await ui.act(async () => {
    Object.getOwnPropertyDescriptor(ui.window.HTMLInputElement.prototype, 'value').set.call(email, 'someone@example.invalid');
    email.dispatchEvent(new ui.window.Event('input', { bubbles: true }));
  });
  await ui.act(async () => { email.closest('form').dispatchEvent(new ui.window.Event('submit', { bubbles: true, cancelable: true })); });
  await ui.settle();
  assert.equal(ui.calls.at(-1).operation, 'members.invite');
  assert.equal(ui.calls.at(-1).input.email, 'someone@example.invalid');
  assert.equal(ui.calls.at(-1).input.role, 'guest', 'the first role that does not manage');
  assert.match(ui.find('[data-testid=invite-link]').textContent, /\?invite=fict%20token/);
  await ui.click(ui.find('[data-testid=leave-space]'));
  assert.equal(ui.calls.at(-1).operation, 'members.leave');
});

test('MembersSheet: a guest sees neither the invite form, the controls nor the administrator accesses', async t => {
  const ui = await fixture(t);
  await ui.render({ view: { ...VIEW, space: { ...SPACES[1], orphaned: false } } });
  assert.equal(ui.find('[data-testid=invite-email]'), null);
  assert.equal(ui.find('[data-testid=member-other] select'), null);
  assert.equal(ui.find('[data-testid=member-other] button'), null);
  assert.equal(ui.find('[data-testid=admin-access]'), null);
  assert.ok(ui.find('[data-testid=leave-space]'));
});

test('MembersSheet shows the words for a refusal', async t => {
  const ui = await fixture(t, { refuse: { 'members.leave': 'last-manager' } });
  await ui.render({ view: VIEW });
  await ui.click(ui.find('[data-testid=leave-space]'));
  assert.match(ui.find('[data-testid=members-error]').textContent, /at least one manager/);
});

test('the block names nothing of one app', () => {
  const folder = `${project}registry/spaces`;
  for (const name of readdirSync(folder)) assert.doesNotMatch(readFileSync(`${folder}/${name}`, 'utf8'), /dossier|collecte|comptable/i, name);
});
