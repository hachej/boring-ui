import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync } from 'node:fs';
import { build } from 'esbuild';
import { Window } from 'happy-dom';
import { openSqliteWorkspaces } from '../../examples/shared/sqlite-workspaces.mjs';

const later = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
test('revision workspace preserves file drafts, docked and floating chat mounts, and mobile Library navigation', async t => {
  const window = new Window({ url: 'https://fictional.invalid/', settings: { disableIframePageLoading: true } });
  const names = ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node', 'Text', 'DOMParser', 'MutationObserver', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame', 'IS_REACT_ACT_ENVIRONMENT', 'confirm', 'sessionStorage', 'ResizeObserver'];
  const globals = new Map(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  for (const name of names) {
    const value = name === 'window' ? window : name === 'IS_REACT_ACT_ENVIRONMENT' ? true : window[name];
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value: typeof value === 'function' && /^[a-z]/.test(name) ? value.bind(window) : value });
  }
  let measuredWidth = 1200;
  window.HTMLElement.prototype.getBoundingClientRect = () => ({ width: measuredWidth, height: 800, left: 0, right: measuredWidth, top: 0, bottom: 800, x: 0, y: 0 });
  const { createElement, act, useState, useEffect } = await import('react'); const { createRoot } = await import('react-dom/client');
  const out = new URL('../../.cache/file-tree-test/', import.meta.url); mkdirSync(out, { recursive: true });
  const output = new URL('workspace.mjs', out);
  await build({ entryPoints: [new URL('../../registry/pi-app/agent-workspace.tsx', import.meta.url).pathname], outfile: output.pathname, bundle: true, format: 'esm', platform: 'node', jsx: 'automatic', packages: 'external', plugins: [{ name: 'bundle-file-tree-css', setup(builder) { builder.onResolve({ filter: /^@hachej\/boring-ui-kit\/file-tree\.css$/ }, () => ({ path: new URL(import.meta.resolve('@hachej/boring-ui-kit/file-tree.css')).pathname, external: false })); } }] });
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
  const library = () => element.querySelector('[data-testid=workspace-library]');
  assert.ok(library(), 'Library is available without conversations');
  await act(async () => library().click());
  assert.equal(element.querySelector('[data-testid=workspace-library-view]').parentElement.hidden, false);
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

  const { createNativeChatController } = await import('@hachej/boring-ui-kit/native-chat');
  const closed = later(); let watches = 0;
  const chatController = createNativeChatController({ identity: { runtimeId: 'fictional', scopeId: 'fictional', principalId: 'alice' },
    conversation: { id: 1 }, context: { value: () => undefined, toString: () => 'fictional' }, history: false,
    source: { open: async () => { watches++; return { value: { conversation: { id: 1 }, entries: [], docs: {} }, start() {}, closed: closed.promise,
      stop: async () => { closed.resolve({ kind: 'stopped' }); return { kind: 'stopped' }; } }; } },
  });
  t.after(() => chatController.dispose());
  let selected = 0, created = 0;
  const conversations = { items: [{ id: 'one', title: 'Fictional chat' }], activeId: 'one', onSelect: () => { selected++; }, onNew: () => { created++; } };
  const workspace = extra => createElement(AgentWorkspace, { controller: chatController, conversationId: 'one', revisionProvider: binding, ...extra });
  await act(async () => root.render(workspace({ conversations })));
  await act(async () => element.querySelector('[data-testid=workspace-chat-link]').click());
  const composer = element.querySelector('[data-testid=workspace-chat-surface] textarea'); assert.ok(composer, element.textContent);
  await act(async () => {
    Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set.call(composer, 'Keep this draft');
    composer.dispatchEvent(new window.Event('input', { bubbles: true }));
  });
  assert.equal(chatController.getSnapshot().draft.text, 'Keep this draft');
  await act(async () => library().click());
  assert.equal(element.querySelector('[data-testid=workspace-chat-surface]').hidden, true);
  assert.equal(element.querySelector('[data-testid=workspace-chat-surface]').inert, true);
  assert.equal(element.querySelector('[data-testid=workspace-chat-surface] textarea'), composer);
  await act(async () => [...element.querySelectorAll('button')].find(button => button.textContent === 'Back to chat').click());
  assert.equal(element.querySelector('[data-testid=workspace-chat-surface] textarea'), composer);
  assert.equal(composer.value, 'Keep this draft'); assert.equal(watches, 1);
  await act(async () => library().click());
  await act(async () => element.querySelector('[data-testid=conversation-new]').click());
  assert.equal(created, 1); assert.equal(element.querySelector('[data-testid=workspace-chat-surface]').hidden, false);
  await act(async () => library().click());
  await act(async () => [...element.querySelectorAll('button')].find(button => button.textContent.includes('Fictional chat')).click());
  assert.equal(selected, 0, 'choosing active chat only returns to its existing surface');
  assert.equal(element.querySelector('[data-testid=workspace-chat-surface]').hidden, false);

  let floatingMounts = 0, floatingUnmounts = 0;
  function FloatingDraft() {
    const [text, setText] = useState('Local floating draft');
    useEffect(() => { floatingMounts++; return () => { floatingUnmounts++; }; }, []);
    return createElement('textarea', { 'aria-label': 'Floating draft', value: text, onChange: event => setText(event.currentTarget.value) });
  }
  sessionStorage.setItem('floating-proof.panel-width.floating', '1');
  await act(async () => root.render(workspace({ key: 'floating', storageKey: 'floating-proof', floatBelow: 400, defaultOpened: { kind: 'file', path: 'first.html' }, floatingChat: () => createElement(FloatingDraft) })));
  const floatingComposer = element.querySelector('textarea[aria-label="Floating draft"]'); assert.ok(floatingComposer);
  await act(async () => library().click());
  assert.equal(element.querySelector('[data-testid=workspace-chat]').dataset.floating, undefined, 'Library has center width while floating layout is suppressed');
  assert.equal(element.querySelector('textarea[aria-label="Floating draft"]'), floatingComposer);
  assert.equal(floatingUnmounts, 0);
  await act(async () => element.querySelector('[data-testid=workspace-chat-link]').click());
  assert.equal(element.querySelector('textarea[aria-label="Floating draft"]'), floatingComposer);
  assert.equal(floatingComposer.value, 'Local floating draft'); assert.equal(floatingMounts, 1); assert.equal(floatingUnmounts, 0);

  measuredWidth = 375;
  await act(async () => root.render(workspace({ key: 'mobile' })));
  assert.equal(element.querySelector('[data-testid=workspace-library]'), null, 'mobile navigation begins closed');
  await act(async () => element.querySelector('[data-testid=sessions-toggle]').click());
  assert.ok(library());
  await act(async () => library().click());
  assert.equal(element.querySelector('[data-testid=workspace-library]'), null, 'choosing Library closes the drawer');
  assert.equal(element.querySelector('[data-testid=workspace-library-view]').parentElement.hidden, false);

  // libraryPlacement="pane": the Library is a tab of the left pane, beside the conversations; files open in the right panel.
  measuredWidth = 1200;
  const chosen = [], unsavedReports = [];
  const agents = { items: [{ id: 'pm', label: 'PM' }, { id: 'dev', label: 'Developer' }], activeId: 'pm', onSelect: id => { chosen.push(id); } };
  await act(async () => root.render(workspace({ key: 'pane', storageKey: 'pane-proof', conversations, libraryPlacement: 'pane', agents, onUnsavedChange: value => { unsavedReports.push(value); } })));
  assert.equal(element.querySelector('[data-testid=workspace-library]'), null, 'no center Library link in pane placement');
  assert.equal(element.querySelectorAll('[data-testid=sessions-toggle]').length, 1, 'the center holds no second toggle with the Library in the pane');
  assert.equal(element.querySelector('[data-testid=workspace-library-view]'), null);
  const select = element.querySelector('[data-testid=agent-select]'); assert.ok(select, 'two agents show a switcher');
  await act(async () => { select.value = 'dev'; select.dispatchEvent(new window.Event('change', { bubbles: true })); });
  assert.deepEqual(chosen, ['dev']);
  assert.equal(element.querySelector('[data-testid=sessions-tab-conversations]').getAttribute('aria-selected'), 'true');
  await act(async () => element.querySelector('[data-testid=sessions-tab-library]').click());
  for (let n = 0; n < 50 && !element.querySelector('[data-testid=sessions-library] [role=treeitem][data-path="first.html"] button'); n++) await act(async () => new Promise(r => setTimeout(r, 10)));
  await act(async () => element.querySelector('[data-testid=sessions-library] [role=treeitem][data-path="first.html"] button').click());
  assert.equal(element.querySelector('[data-testid=file-viewer]').dataset.path, 'first.html');
  assert.equal(element.querySelector('[data-testid=workspace-chat-surface]').hidden, false, 'the chat stays in the center');
  for (let n = 0; n < 100 && !element.querySelector('[data-testid="viewer-mode-source"]'); n++) await act(async () => new Promise(r => setTimeout(r, 10)));
  await act(async () => element.querySelector('[data-testid="viewer-mode-source"]').click());
  const paneSource = element.querySelector('textarea[aria-label="HTML source"]');
  await act(async () => {
    Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set.call(paneSource, '<p>Pane draft</p>');
    paneSource.dispatchEvent(new window.Event('input', { bubbles: true }));
  });
  assert.equal(unsavedReports.at(-1), true, 'the host hears about unsaved changes');
  globalThis.confirm = () => false;
  const closeButton = element.querySelector('[data-testid=viewer-panel] [data-testid$="-close"]'); assert.ok(closeButton, element.querySelector('[data-testid=viewer-panel]').innerHTML.slice(0, 300));
  await act(async () => closeButton.click());
  assert.equal(element.querySelector('[data-testid=file-viewer]')?.dataset.path, 'first.html', 'keeping the draft keeps the panel open');
  globalThis.confirm = () => true;
  await act(async () => root.render(workspace({ key: 'pane', storageKey: 'pane-proof', conversations, libraryPlacement: 'pane', agents: { ...agents, items: agents.items.slice(0, 1) } })));
  assert.equal(element.querySelector('[data-testid=agent-select]'), null, 'one agent shows no switcher');

  // The tree's words, its Upload and History buttons and its refresh follow the host's `fileTree` options.
  let listings = 0; const list = binding.list;
  const counted = { ...binding, list: async (...args) => { listings++; return list(...args); },
    search: async () => ({ entries: [{ path: 'Maquettes/first.html', kind: 'file', size: 20 }] }) };
  const french = refreshKey => workspace({ key: 'french', storageKey: 'french-proof', revisionProvider: counted, libraryPlacement: 'pane', conversations, locale: 'fr',
    fileTree: { labels: { search: 'Rechercher un document' }, upload: false, history: false, refreshKey } });
  await act(async () => root.render(french(1)));
  // locale: 'fr' translates the pane, the chat and the tree; `labels` still override a word.
  assert.equal(element.querySelector('[data-testid=sessions-tab-library]').textContent, 'Bibliothèque');
  assert.equal(element.querySelector('[data-testid=sessions-tab-conversations]').textContent, 'Conversations');
  assert.match(element.querySelector('[data-testid=workspace-chat-surface] textarea').getAttribute('placeholder'), /^Écrivez à l’agent/);
  await act(async () => element.querySelector('[data-testid=sessions-tab-library]').click());
  for (let n = 0; n < 50 && !element.querySelector('[data-testid=sessions-library] [role=treeitem]'); n++) await act(async () => new Promise(r => setTimeout(r, 10)));
  const pane = element.querySelector('[data-testid=sessions-library]');
  assert.equal(pane.querySelector('[role=tree]').getAttribute('aria-label'), 'Fichiers');
  assert.ok(pane.querySelector('input[aria-label="Rechercher un document"]'));
  assert.ok([...pane.querySelectorAll('button')].some(button => button.textContent === 'Actualiser'));
  assert.equal(pane.querySelector('input[type=file]'), null, 'no Upload with upload: false');
  assert.equal([...pane.querySelectorAll('button')].filter(button => button.textContent === 'History').length, 0, 'no History with history: false');
  const before = listings;
  await act(async () => root.render(french(1)));
  assert.equal(listings, before, 'the same refreshKey does not reload');
  await act(async () => root.render(french(2)));
  assert.ok(listings > before, 'a new refreshKey reloads the tree');
  const input = pane.querySelector('input[aria-label="Rechercher un document"]');
  await act(async () => {
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(input, 'first');
    input.dispatchEvent(new window.Event('input', { bubbles: true }));
  });
  for (let n = 0; n < 50 && !pane.querySelector('[role=treeitem][data-path="Maquettes/first.html"]'); n++) await act(async () => new Promise(r => setTimeout(r, 10)));
  const result = pane.querySelector('[role=treeitem][data-path="Maquettes/first.html"]');
  assert.match(result.textContent, /^first\.htmlMaquettes/, 'a search result shows its name, then its folder');

  // A single-session page (no conversations) keeps the left pane for its Library alone.
  await act(async () => root.render(workspace({ key: 'single', storageKey: 'single-proof', libraryPlacement: 'pane' })));
  assert.equal(element.querySelector('[data-testid=sessions-tab-library]'), null);
  assert.match(element.querySelector('[data-testid=conversations] h2').textContent, /Library/);
  assert.ok(element.querySelector('[data-testid=sessions-library]'));
});
