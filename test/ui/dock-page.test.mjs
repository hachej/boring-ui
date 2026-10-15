import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync } from 'node:fs';
import { build } from 'esbuild';
import { Window } from 'happy-dom';

test('page replaces the main area without remounting either child, remembers placement, and leads on a phone', async t => {
  const window = new Window({ url: 'https://fictional.invalid/' });
  const names = ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node', 'Text', 'MutationObserver', 'IS_REACT_ACT_ENVIRONMENT', 'sessionStorage', 'ResizeObserver'];
  const globals = new Map(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  for (const name of names) Object.defineProperty(globalThis, name, { configurable: true, writable: true, value: name === 'window' ? window : name === 'IS_REACT_ACT_ENVIRONMENT' ? true : window[name] });
  let size = 1440;
  window.HTMLElement.prototype.getBoundingClientRect = () => ({ width: size, height: 900, left: 0, right: size, top: 0, bottom: 900, x: 0, y: 0 });
  const { createElement: h, act, useEffect } = await import('react');
  const { createRoot } = await import('react-dom/client');
  const out = new URL('../../.cache/dock-page/', import.meta.url); mkdirSync(out, { recursive: true });
  const output = new URL('dock.mjs', out);
  await build({ entryPoints: [new URL('../../registry/dock/dock.tsx', import.meta.url).pathname], outfile: output.pathname, bundle: true, format: 'esm', platform: 'node', jsx: 'automatic', packages: 'external' });
  const { Dock, DockLayout, DockMain, useDock } = await import(output.href);
  const element = window.document.createElement('div'); window.document.body.append(element); const root = createRoot(element);
  t.after(async () => { await act(async () => root.unmount()); await window.happyDOM.close(); for (const [name, descriptor] of globals) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name]; } });
  let api, mounts = 0, unmounts = 0;
  function Controls() { api = useDock('agent'); return null; }
  function Conversation() { useEffect(() => { mounts++; return () => { unmounts++; }; }, []); return h('textarea', { defaultValue: 'Unsent draft' }); }
  const page = key => h(DockLayout, { key, storageKey: 'page-proof' }, h(Controls), h(Dock, { id: 'agent', side: 'left', floatable: true, narrowBelow: 720 }, h(Conversation)), h(DockMain, {}, h('input', { defaultValue: 'App draft' })));
  await act(async () => root.render(page('wide')));
  const conversation = element.querySelector('textarea'), app = element.querySelector('input');
  assert.equal(typeof api.setPlacement, 'function', 'useDock exposes page placement');
  for (const placement of ['page', 'floating', 'docked', 'page']) {
    await act(async () => api.setPlacement(placement));
    assert.equal(element.querySelector('[data-dock=agent]').dataset.placement, placement);
    assert.equal(element.querySelector('[data-boring=dock-main]').hidden, placement === 'page');
    assert.equal(element.querySelector('[data-boring=dock-main]').inert, placement === 'page');
    assert.equal(element.querySelector('textarea'), conversation);
    assert.equal(element.querySelector('input'), app);
    assert.equal(conversation.value, 'Unsent draft');
    assert.equal(mounts, 1); assert.equal(unmounts, 0);
  }
  assert.equal(element.querySelector('[data-testid=dock-divider-agent]'), null, 'page has no resize divider');
  size = 390;
  await act(async () => root.render(page('phone')));
  assert.equal(api.placement, 'page', 'page is restored and wins over narrow floating');
  await act(async () => api.float()); assert.equal(api.placement, 'floating');
  await act(async () => api.setPlacement('page')); assert.equal(api.placement, 'page');
  await act(async () => api.setOpen(false)); assert.equal(api.placement, 'closed');
  assert.equal(element.querySelector('[data-boring=dock-main]').hidden, false);
});
