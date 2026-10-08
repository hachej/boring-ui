import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync } from 'node:fs';
import { build } from 'esbuild';
import { Window } from 'happy-dom';
import { openSqliteWorkspaces } from '../../examples/shared/sqlite-workspaces.mjs';

const later = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
test('revision workspace fences old file reads and asks before a tree click discards a dirty document', async t => {
  const window = new Window({ url: 'https://fictional.invalid/', settings: { disableIframePageLoading: true } });
  const names = ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node', 'Text', 'DOMParser', 'MutationObserver', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame', 'IS_REACT_ACT_ENVIRONMENT', 'confirm'];
  const globals = new Map(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  for (const name of names) {
    const value = name === 'window' ? window : name === 'IS_REACT_ACT_ENVIRONMENT' ? true : window[name];
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value: typeof value === 'function' && /^[a-z]/.test(name) ? value.bind(window) : value });
  }
  const { createElement, act } = await import('react'); const { createRoot } = await import('react-dom/client');
  const out = new URL('../../.cache/file-tree-test/', import.meta.url); mkdirSync(out, { recursive: true });
  const output = new URL('workspace.mjs', out);
  await build({ entryPoints: [new URL('../../registry/pi-app/agent-workspace.tsx', import.meta.url).pathname], outfile: output.pathname, bundle: true, format: 'esm', platform: 'node', jsx: 'automatic', packages: 'external' });
  const { AgentWorkspace, FileViewer } = await import(output.href);
  const element = window.document.createElement('div'); window.document.body.append(element); const root = createRoot(element);
  t.after(async () => {
    await act(async () => root.unmount()); await window.happyDOM.close();
    for (const [name, descriptor] of globals) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name]; }
  });
  const locate = path => ({ resource: { providerId: 'fictional', path }, view: { kind: 'published' } });
  const identity = { scopeId: 'fictional', principalId: 'alice', initiatorId: 'alice' };
  const slow = later();
  const available = text => ({ kind: 'available', snapshot: { ref: { ...locate('same.txt'), revision: text }, mediaType: 'text/plain', bytes: new TextEncoder().encode(text) } });
  const viewer = client => createElement(FileViewer, { path: 'same.txt', locator: locate('same.txt'), options: { client, identity }, onClose() {} });
  await act(async () => root.render(viewer({ read: () => slow.promise })));
  await act(async () => root.render(viewer({ read: async () => available('Current workspace') })));
  assert.match(element.textContent, /Current workspace/);
  await act(async () => { slow.resolve(available('Private previous workspace')); await slow.promise; });
  assert.doesNotMatch(element.textContent, /Private previous workspace/);
  assert.match(element.textContent, /Current workspace/);

  const store = openSqliteWorkspaces({ filename: ':memory:', providerId: 'fictional', authorize: () => true }); t.after(() => store.close());
  const binding = { identity, workspace: { providerId: 'fictional', instanceId: 'one', incarnation: 'one', viewId: 'one' }, locate,
    read: request => store.read(request, identity), publish: request => store.publication.publish(request, identity), lookup: id => store.reconciliation.lookup(id, identity),
    list: async () => ({ entries: ['first.html', 'second.html'].map(path => ({ path, kind: 'file', size: 20 })) }), search: async () => ({ entries: [] }), history: async () => [],
  };
  for (const path of ['first.html', 'second.html']) await binding.publish({ operationId: path, atomicity: 'all-or-nothing', changes: [{ kind: 'create', target: locate(path), expected: { kind: 'absent' }, bytes: new TextEncoder().encode('<p>Original</p>'), mediaType: 'text/html' }] });
  await act(async () => root.render(createElement(AgentWorkspace, { controller: undefined, conversationId: undefined, revisionProvider: binding })));
  const clickFile = path => element.querySelector(`[role=treeitem][data-path="${path}"] button`);
  assert.ok(clickFile('first.html'));
  await act(async () => clickFile('first.html').click());
  for (let n = 0; n < 100 && !element.querySelector('[data-testid="viewer-mode-source"]'); n++) await act(async () => new Promise(r => setTimeout(r, 10)));
  const source = element.querySelector('[data-testid="viewer-mode-source"]'); assert.ok(source, element.textContent);
  await act(async () => source.click());
  const textarea = element.querySelector('textarea[aria-label="HTML source"]'); assert.ok(textarea);
  await act(async () => {
    Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set.call(textarea, '<p>Unsaved local draft</p>');
    textarea.dispatchEvent(new window.Event('input', { bubbles: true }));
  });
  let confirmations = 0;
  globalThis.confirm = () => { confirmations++; return false; };
  await act(async () => clickFile('second.html').click());
  assert.equal(confirmations, 1); assert.equal(element.querySelector('[data-testid=file-viewer]').dataset.path, 'first.html');
  assert.equal(element.querySelector('textarea').value, '<p>Unsaved local draft</p>');
  globalThis.confirm = () => { confirmations++; return true; };
  await act(async () => clickFile('second.html').click());
  assert.equal(confirmations, 2); assert.equal(element.querySelector('[data-testid=file-viewer]').dataset.path, 'second.html');
});
