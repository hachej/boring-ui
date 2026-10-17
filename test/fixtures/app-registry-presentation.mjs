// Copied into each isolated app consumer and bundled against its CLI-installed source.
// DOM behavior only; the workspace and app-shell journeys own browser geometry and gestures.
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';

const window = new Window({ url: 'https://fictional.invalid/', width: 390, height: 844 });
for (const name of ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node', 'Text', 'DOMParser', 'MutationObserver', 'ResizeObserver', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame', 'matchMedia']) {
  Object.defineProperty(globalThis, name, { configurable: true, writable: true, value: name === 'window' ? window : typeof window[name] === 'function' && /^[a-z]/.test(name) ? window[name].bind(window) : window[name] });
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { createElement: h, act } = await import('react');
const { createRoot } = await import('react-dom/client');
const { ViewerActions, ViewerVersions, ConversationFiles, FileTree, HistoryColumnToggle, useHistoryColumn } = await import('./presentation-components.mjs');
const container = document.createElement('div'); document.body.append(container);
const root = createRoot(container);
const find = id => { const node = document.querySelector(`[data-testid="${id}"]`); assert.ok(node, id); return node; };
const click = id => act(async () => find(id).click());
const key = (node, key) => act(async () => node.dispatchEvent(new window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })));
const render = element => act(async () => root.render(element));
try {
  let selected;
  await render(h(ViewerActions, { label: 'Document actions', icon: '…', items: [
    { id: 'blocked', label: 'Unavailable', disabled: true, onSelect() { throw new Error('disabled action'); } },
    { id: 'current', label: 'Current', checked: true, onSelect: () => { selected = 'current'; } },
    { id: 'older', label: 'Older', checked: false, onSelect: () => { selected = 'older'; } },
    { id: 'copy', label: 'Copy', onSelect: () => { selected = 'copy'; } },
  ] }, h('p', { 'data-testid': 'menu-child' }, 'Retained versions')));
  await key(find('viewer-menu'), 'ArrowDown');
  const popup = find('viewer-menu-list');
  assert.equal(container.contains(popup), false, 'viewer menu escapes its clipped container');
  assert.equal(find('menu-child').textContent, 'Retained versions');
  assert.equal(document.activeElement === find('viewer-menu-current'), true, 'first enabled choice gets native initial focus');
  assert.equal(find('viewer-menu-current').getAttribute('role'), 'menuitemradio');
  assert.equal(find('viewer-menu-copy').getAttribute('role'), 'menuitem');
  await key(document.activeElement, 'ArrowDown');
  assert.equal(document.activeElement === find('viewer-menu-older'), true);
  await key(document.activeElement, 'End');
  assert.equal(document.activeElement === find('viewer-menu-copy'), true);
  await key(document.activeElement, 'Home');
  assert.equal(document.activeElement === find('viewer-menu-blocked'), true, 'Base UI keeps disabled rows discoverable with Home');
  await key(document.activeElement, 'Enter');
  assert.equal(selected, undefined, 'a disabled row never invokes its action');
  await key(document.activeElement, 'ArrowDown');
  assert.equal(document.activeElement === find('viewer-menu-current'), true);
  await key(document.activeElement, 'Escape');
  assert.equal(document.querySelector('[data-testid="viewer-menu-list"]') === null, true, 'Escape dismisses the native menu');
  assert.equal(document.activeElement === find('viewer-menu'), true);
  await click('viewer-menu'); await click('viewer-menu-copy');
  assert.equal(selected, 'copy');
  // Tab's browser-default focus traversal is driven in the workspace-app browser journey.
  await click('viewer-menu');
  await act(async () => { document.body.dispatchEvent(new window.PointerEvent('pointerdown', { bubbles: true, button: 0, pointerType: 'mouse' })); await new Promise(resolve => setTimeout(resolve, 20)); });
  assert.equal(document.querySelector('[data-testid="viewer-menu-list"]') === null, true, 'outside press dismisses the menu');

  const savedAt = Date.now() - 120000;
  const savedVersions = [{ id: 'v2', label: 'Second', latest: true, savedAt, source: 'publish' }, { id: 'v1', label: 'First', savedAt: savedAt - 180000, source: 'agent' }];
  await render(h(ViewerVersions, { versions: savedVersions, current: 'v1', onSelect: id => { selected = id; } }));
  await click('viewer-versions');
  const versions = [...document.querySelectorAll('[data-testid="viewer-versions-item"]')];
  assert.equal(versions.length, 2);
  assert.equal(versions[1].getAttribute('aria-checked'), 'true');
  assert.match(versions[1].textContent, /Current/);
  const viewerRows = versions.map(row => ({ label: row.querySelector('.truncate').textContent, author: row.querySelector('[data-testid=viewer-versions-description]').textContent }));
  assert.deepEqual(viewerRows, [{ label: '2 min ago', author: 'You' }, { label: '5 min ago', author: 'Agent' }]);
  await act(async () => versions[0].click());
  assert.equal(selected, 'v2');

  // Phone viewer controls can contain the version menu inside the overflow menu.
  selected = undefined;
  await render(h(ViewerActions, { label: 'Phone actions', icon: '…', items: [] }, h(ViewerVersions, {
    versions: [{ id: 'v2', label: 'Second' }, { id: 'v1', label: 'First' }], current: 'v1', onSelect: id => { selected = id; },
  })));
  await click('viewer-menu'); await click('viewer-versions');
  await key(document.activeElement, 'Home');
  const nested = document.querySelector('[data-testid="viewer-versions-list"] [data-item="v2"]');
  assert.equal(document.activeElement === nested, true, 'nested menu alone owns its arrow-key focus');
  await act(async () => {
    nested.dispatchEvent(new window.PointerEvent('pointerdown', { bubbles: true, button: 0, pointerType: 'mouse' }));
    nested.click();
  });
  assert.equal(selected, 'v2', 'a portalled child choice survives the parent outside-press handler');
  assert.ok(document.querySelector('[data-testid="viewer-menu-list"]'), 'interacting with child controls does not discard their parent');

  let opened = 0;
  await render(h(ConversationFiles, { files: [{ id: 'notes', name: 'notes.md', open: () => { opened++; } }] }));
  await click('conversation-files');
  const drawer = find('conversation-files-list');
  assert.equal(drawer.getAttribute('data-slot'), 'drawer-popup', 'phone uses the declared drawer rather than the desktop popover');
  assert.ok(drawer.querySelector('[data-slot="drawer-swipe-handle"]'), 'the declared swipe handle is present');
  await click('conversation-file');
  assert.equal(opened, 1, 'file selection invokes the existing host callback once');
  assert.equal(find('conversation-files').getAttribute('aria-expanded'), 'false');
  let historyReads = 0, libraryClosed = 0, fileOpened;
  const provider = {
    identity: { principalId: 'fictional', initiatorId: 'fictional', scopeId: 'fictional' },
    workspace: { providerId: 'fictional', instanceId: 'one', incarnation: 'one', viewId: 'published' },
    locate: path => ({ resource: { providerId: 'fictional', path }, view: { kind: 'published' } }),
    list: async () => ({ entries: [{ path: 'fictional.md', kind: 'file', size: 12 }] }), search: async () => ({ entries: [] }),
    history: async () => { historyReads++; return savedVersions.map(version => ({ revision: version.id, savedAt: version.savedAt, source: version.source })); },
    read: async () => ({ kind: 'missing' }), publish: async () => ({ kind: 'unavailable', reason: 'fictional read-only fixture' }), lookup: async () => ({ kind: 'not-found' }),
  };
  await render(h(FileTree, { revisionProvider: provider, refresh: false, onClose: () => { libraryClosed++; }, onOpen: path => { fileOpened = path; } }));
  assert.equal(container.querySelector('[data-file-upload]').getAttribute('data-slot'), 'button', 'Upload is the CLI-installed consumer shadcn Button');
  assert.equal(container.querySelector('[data-file-close]').getAttribute('data-slot'), 'button', 'Close is the consumer Button too');
  const trigger = container.querySelector('[data-file-more]'); assert.ok(trigger);
  assert.equal(trigger.tagName, 'BUTTON'); assert.equal(trigger.querySelector('button'), null, 'one real trigger button, not nested primitives');
  await key(trigger, 'ArrowDown');
  const fileMenu = document.querySelector('[data-boring="file-actions"]'); assert.ok(fileMenu);
  assert.equal(fileMenu.getAttribute('data-slot'), 'dropdown-menu-content', 'the consumer shadcn dropdown built-in owns menu presentation');
  assert.deepEqual([...fileMenu.querySelectorAll('[role=menuitem]')].map(item => item.textContent), ['Open', 'Version history', 'Download']);
  await key(document.activeElement, 'Escape');
  assert.equal(Boolean(document.querySelector('[data-boring="file-actions"]')), false);
  await key(trigger, 'ArrowDown');
  await act(async () => document.querySelector('[data-action=history]').click());
  assert.equal(historyReads, 1, 'installed menu opens actual version history');
  const libraryRows = [...container.querySelectorAll('[data-testid=file-history-versions-item]')];
  assert.deepEqual(libraryRows.map(row => ({ label: row.querySelector('.truncate').textContent, author: row.querySelector('[data-testid=file-history-versions-description]').textContent })), viewerRows, 'Library and viewer use the same version rows');
  assert.match(libraryRows[0].textContent, /Current/);
  assert.equal(libraryRows[0].getAttribute('data-slot'), 'button', 'history selections use the consumer shadcn Button');
  await key(trigger, 'ArrowDown');
  await act(async () => document.querySelector('[data-action=open]').click());
  assert.equal(fileOpened, 'fictional.md');
  await act(async () => container.querySelector('[data-file-close]').click());
  assert.equal(libraryClosed, 1);
  const detached = new Window({ url: 'https://fictional.invalid/detached' });
  const detachedContainer = detached.document.createElement('div'); detached.document.body.append(detachedContainer);
  const detachedRoot = createRoot(detachedContainer);
  try {
    await act(async () => detachedRoot.render(h(ViewerActions, { label: 'Detached document actions', icon: '…', testId: 'detached-menu', items: [{ id: 'copy', label: 'Copy', onSelect: () => { selected = 'detached-copy'; } }] })));
    await act(async () => detached.document.querySelector('[data-testid=detached-menu]').click());
    assert.equal(!!detached.document.querySelector('[data-testid=detached-menu-list]'), true, 'the consumer portal stays in the trigger owner document');
    assert.equal(!!document.querySelector('[data-testid=detached-menu-list]'), false, 'a detached viewer never places its actions in the opener');
    await act(async () => detached.document.querySelector('[data-testid=detached-menu-copy]').click());
    assert.equal(selected, 'detached-copy');
  } finally {
    await act(async () => detachedRoot.unmount()); await detached.happyDOM.close();
  }
  // The History column as the consumer installed it: a pane wide enough gets History as the column's toggle; a floating one keeps the popover.
  const conversations = { items: [{ id: 'one', title: 'Fictional plan' }, { id: 'two', title: 'Fictional notes' }], activeId: 'one', onSelect() {}, onNew() {} };
  const measure = window.HTMLElement.prototype.getBoundingClientRect;
  window.HTMLElement.prototype.getBoundingClientRect = () => ({ width: 1024, height: 700, left: 0, right: 1024, top: 0, bottom: 700, x: 0, y: 0 });
  try {
    const Pane = ({ floating }) => {
      const history = useHistoryColumn({ id: 'pane-history', storageKey: 'consumer.history-column', conversations, enabled: !floating, title: 'Conversations' });
      return h('div', { ref: history.ref }, history.column, history.toggle ? h(HistoryColumnToggle, { toggle: history.toggle }) : h('p', { 'data-testid': 'history-popover-fallback' }));
    };
    await render(h(Pane, { floating: false }));
    assert.equal(find('chat-action-history').getAttribute('aria-expanded'), 'false');
    assert.equal(find('chat-action-history').getAttribute('aria-controls'), 'pane-history');
    await click('chat-action-history');
    assert.equal(find('chat-action-history').getAttribute('aria-expanded'), 'true');
    assert.equal(find('history-column').id, 'pane-history');
    assert.equal(find('history-column').querySelectorAll('[data-testid=conversation-row]').length, 2, 'the column lists the conversations with the consumer sidebar parts');
    await render(h(Pane, { floating: true }));
    find('history-popover-fallback');
    assert.equal(document.querySelector('[data-testid=history-column]'), null, 'a floating pane keeps the popover');
  } finally { window.HTMLElement.prototype.getBoundingClientRect = measure; }
  console.log('PASS: installed consumer Button/dropdown, owner-document menus, keyboard/radio/history, Library Open/Close, phone files drawer and the History column');
} finally {
  await act(async () => root.unmount());
  await window.happyDOM.close();
}
