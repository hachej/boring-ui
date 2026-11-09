import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync } from 'node:fs';
import { build } from 'esbuild';
import { Window } from 'happy-dom';

// D-1930: WorkspaceBar `command.kind` is History, the Library, a new conversation, or a host panel id. A host panel opens through the same path as a click
// (onOpenChange(true), onOpen once), the same panel asked again with a new `n` closes it, an unknown id does nothing, and it works with the bar `hidden` (bar=0).
// History, the Library and New keep their behaviour: a repeat does not close them. Everything is compared as booleans and strings (a failing assert on a happy-dom element looks like a runner crash).
test('WorkspaceBar command: a host panel id opens and closes that panel; the built-in kinds are unchanged', { timeout: 120000 }, async t => {
  const window = new Window({ url: 'https://fictional.invalid/', settings: { disableIframePageLoading: true } });
  const names = ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node', 'Text', 'DOMParser', 'MutationObserver', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame', 'ResizeObserver', 'sessionStorage', 'localStorage', 'matchMedia', 'IS_REACT_ACT_ENVIRONMENT'];
  const globals = new Map(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  for (const name of names) {
    const value = name === 'window' ? window : name === 'IS_REACT_ACT_ENVIRONMENT' ? true : window[name];
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value: typeof value === 'function' && /^[a-z]/.test(name) ? value.bind(window) : value });
  }
  window.HTMLElement.prototype.getBoundingClientRect = () => ({ width: 1440, height: 800, left: 0, right: 1440, top: 0, bottom: 800, x: 0, y: 0 });
  const { createElement, act } = await import('react'); const { createRoot } = await import('react-dom/client');
  const out = new URL('../../.cache/workspace-bar-command/', import.meta.url); mkdirSync(out, { recursive: true });
  const output = new URL('workspace-bar.mjs', out);
  await build({ entryPoints: [new URL('../../registry/pi-app/workspace-bar.tsx', import.meta.url).pathname], outfile: output.pathname, bundle: true, format: 'esm', platform: 'node', jsx: 'automatic', packages: 'external', tsconfig: new URL('../../tsconfig.json', import.meta.url).pathname, loader: { '.css': 'empty' } });
  const { WorkspaceBar } = await import(output.href);
  const element = document.createElement('div'); document.body.append(element); const root = createRoot(element);
  t.after(async () => {
    await act(async () => root.unmount()); await window.happyDOM.close();
    for (const [name, descriptor] of globals) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name]; }
  });
  const q = selector => document.querySelector(selector);
  const settle = async ready => { for (let n = 0; n < 200 && !ready(); n++) await act(async () => new Promise(resolve => setTimeout(resolve, 10))); };
  const wait = () => act(async () => new Promise(resolve => setTimeout(resolve, 50)));
  const shown = id => q(`[data-testid=workspace-${id}]`) !== null;
  const Icon = props => createElement('svg', props);
  let mounts = 0;

  for (const hidden of [true, false]) {
    const label = hidden ? 'hidden (bar=0)' : 'drawn bar';
    const fresh = () => {
      const log = { opened: 0, changes: [], created: 0 };
      const key = `bar-${mounts++}`;
      const panels = [{ id: 'tasks', label: 'Tasks', icon: Icon, onOpen() { log.opened++; }, onOpenChange(open) { log.changes.push(open); }, content: () => createElement('div', { 'data-testid': 'tasks-body' }, 'Fictional tasks') }];
      const conversations = { items: [{ id: 'one', title: 'Fictional plan' }], activeId: 'one', onSelect() {}, onNew() { log.created++; } };
      const render = command => act(async () => root.render(createElement(WorkspaceBar, { key, title: 'Fictional', conversations, library: () => createElement('div', { 'data-testid': 'library-body' }, 'Fictional library'), panels, narrow: false, hidden, command })));
      return { log, render };
    };

    await t.test(`${label}: a host panel id opens the panel once, like a click, and the same panel with a new n closes it`, async () => {
      const { log, render } = fresh();
      await render(undefined);
      await render({ kind: 'tasks', n: 1 });
      await settle(() => shown('tasks'));
      assert.equal(shown('tasks'), true, 'the panel is open');
      assert.equal(log.opened, 1, 'onOpen called once');
      assert.equal(JSON.stringify(log.changes), '[true]', 'onOpenChange(true)');
      await render({ kind: 'tasks', n: 1 });
      assert.equal(shown('tasks'), true, 'the same request again changes nothing');
      assert.equal(log.opened, 1, 'onOpen is not called again');
      await render({ kind: 'tasks', n: 2 });
      await settle(() => !shown('tasks'));
      assert.equal(shown('tasks'), false, 'a new request closes it');
      assert.equal(JSON.stringify(log.changes), '[true,false]', 'onOpenChange(false)');
      assert.equal(log.opened, 1, 'closing does not call onOpen');
      await render({ kind: 'tasks', n: 3 });
      await settle(() => shown('tasks'));
      assert.equal(shown('tasks'), true, 'and a third request opens it again');
      assert.equal(log.opened, 2, 'onOpen on the second opening');
    });

    await t.test(`${label}: an unknown id does nothing`, async () => {
      const { log, render } = fresh();
      await render(undefined);
      await render({ kind: 'nothing-here', n: 1 });
      await wait();
      assert.equal(shown('tasks') || shown('history') || shown('library'), false, 'nothing opened');
      assert.equal(log.opened + log.changes.length + log.created, 0, 'no callback fired');
    });

    await t.test(`${label}: history, library and new keep their behaviour (a repeat does not close them)`, async () => {
      const { log, render } = fresh();
      await render(undefined);
      await render({ kind: 'history', n: 1 });
      await settle(() => shown('history'));
      assert.equal(shown('history'), true, 'History opens');
      await render({ kind: 'history', n: 2 });
      await wait();
      assert.equal(shown('history'), true, 'a repeat does not close History');
      await render({ kind: 'library', n: 3 });
      await settle(() => shown('library'));
      assert.equal(shown('library'), true, 'the Library opens');
      await render({ kind: 'library', n: 4 });
      await wait();
      assert.equal(shown('library'), true, 'a repeat does not close the Library');
      await render({ kind: 'new', n: 5 });
      assert.equal(log.created, 1, 'New starts a conversation');
      assert.equal(log.opened + log.changes.length, 0, 'the host panel was not touched');
    });
  }
});
