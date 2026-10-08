import assert from 'node:assert/strict';
import test from 'node:test';
import { Window } from 'happy-dom';
import { createMarkdownController } from '@hachej/boring-ui-kit/markdown';
import { openSqliteWorkspaces } from '../../examples/shared/sqlite-workspaces.mjs';

test('Markdown outline and caret retention in a DOM (not browser qualification)', async t => {
  const window = new Window({ url: 'https://fictional.invalid/' });
  const globals = new Map();
  for (const name of ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node', 'Text', 'DOMParser', 'MutationObserver', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame']) {
    globals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    const value = name === 'window' ? window : window[name];
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value: typeof value === 'function' && /^[a-z]/.test(name) ? value.bind(window) : value });
  }
  globals.set('IS_REACT_ACT_ENVIRONMENT', Object.getOwnPropertyDescriptor(globalThis, 'IS_REACT_ACT_ENVIRONMENT'));
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  t.after(async () => {
    await window.happyDOM.close();
    for (const [name, descriptor] of globals) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  });
  const { act, createElement } = await import('react');
  const { createRoot } = await import('react-dom/client');
  const { MarkdownEditor } = await import('@hachej/boring-ui-kit/markdown-editor');
  const raw = '# Overview\n\nOpening prose.\n\n## Details\n\nFirst body.\n\n## Details\n\nSecond body.\n';
  let sequence = 0;

  async function fixture(t, initial = raw) {
    const provider = openSqliteWorkspaces({ filename: ':memory:', providerId: 'navigation-documents', authorize: () => true });
    const target = { resource: { providerId: 'navigation-documents', path: 'notes.md' }, view: { kind: 'published' } };
    const identity = { scopeId: 'fictional', principalId: 'editor', initiatorId: 'alice' };
    let writes = 0;
    const client = {
      read: request => provider.read(request, identity),
      publish: request => { writes++; return provider.publication.publish(request, identity); },
      lookup: operationId => provider.reconciliation.lookup(operationId, identity),
    };
    await provider.publication.publish({ operationId: 'seed', atomicity: 'all-or-nothing', changes: [{ kind: 'create', target, expected: { kind: 'absent' }, bytes: new TextEncoder().encode(initial), mediaType: 'text/markdown' }] }, identity);
    const read = await client.read({ target, revision: { kind: 'latest' } });
    const controller = createMarkdownController({ source: { kind: 'saved', snapshot: read.snapshot }, identity, client, instanceId: `navigation-${++sequence}`, epoch: 'one' });
    const container = document.createElement('div'); document.body.append(container);
    const root = createRoot(container);
    const render = async (selected = controller) => { await act(async () => root.render(createElement(MarkdownEditor, { controller: selected, title: 'Notes' }))); };
    t.after(async () => { await act(async () => root.unmount()); controller.dispose(); provider.close(); container.remove(); });
    await render();
    const button = label => {
      const result = [...container.querySelectorAll('button')].find(node => (node.getAttribute('aria-label') || node.textContent) === label);
      assert.ok(result, `Missing button: ${label}`); return result;
    };
    const click = async label => { await act(async () => button(label).click()); };
    const input = async value => {
      const textarea = container.querySelector('textarea'); assert.ok(textarea);
      await act(async () => {
        Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set.call(textarea, value);
        textarea.dispatchEvent(new window.Event('input', { bubbles: true }));
      });
    };
    return { controller, container, render, button, click, input, writes: () => writes,
      saved: async () => new TextDecoder().decode((await client.read({ target, revision: { kind: 'latest' } })).snapshot.bytes) };
  }
  function outline(container) {
    const nav = container.querySelector('nav[aria-label="Document outline"]');
    assert.ok(nav, 'Document outline is available in rich mode'); return [...nav.querySelectorAll('button')];
  }
  function selectedWithin(element) {
    const selection = window.getSelection();
    return !!selection?.anchorNode && element.contains(selection.anchorNode) && element.contains(selection.focusNode);
  }
  async function waitFor(predicate, message) {
    const deadline = Date.now() + 2000;
    while (!predicate()) {
      assert.ok(Date.now() < deadline, message);
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)); });
    }
  }

  await t.test('H1, H2 and duplicate heading buttons select the intended native heading without changing bytes', async t => {
    const f = await fixture(t);
    const buttons = outline(f.container);
    assert.deepEqual(buttons.map(node => node.textContent), ['Overview', 'Details', 'Details']);
    assert.deepEqual(buttons.map(node => node.getAttribute('aria-label')), ['Go to heading: Overview', 'Go to heading: Details', 'Go to heading: Details']);
    const headings = [...f.container.querySelectorAll('[contenteditable] h1, [contenteditable] h2')];
    assert.deepEqual(headings.map(node => node.tagName), ['H1', 'H2', 'H2']);
    for (let index = 0; index < buttons.length; index++) {
      await act(async () => buttons[index].click());
      await waitFor(() => selectedWithin(headings[index]), 'Native DOM selection did not enter the selected heading');
      assert.equal(document.activeElement, f.container.querySelector('[contenteditable]'));
    }
    assert.equal(f.controller.getSnapshot().text, raw);
    assert.equal(f.controller.getSnapshot().bufferVersion, 0);
    assert.equal(f.controller.getSnapshot().dirty, false);
    assert.equal(await f.saved(), raw);
    assert.equal(f.writes(), 0);
  });

  await t.test('source selection range and direction return after unchanged-buffer mode toggles', async t => {
    const f = await fixture(t);
    await f.click('Markdown source');
    const textarea = f.container.querySelector('textarea');
    textarea.focus(); textarea.setSelectionRange(3, 17, 'backward');
    await f.click('Markdown source');
    await f.click('Markdown source');
    const restored = f.container.querySelector('textarea');
    await waitFor(() => document.activeElement === restored, 'Source editor did not regain focus');
    assert.deepEqual([restored.selectionStart, restored.selectionEnd, restored.selectionDirection], [3, 17, 'backward']);
    assert.equal(restored.value, raw);
    assert.equal(f.controller.getSnapshot().bufferVersion, 0);
    assert.equal(f.writes(), 0);
  });

  await t.test('rich native DOM selection retains its backward range after unchanged source mode', async t => {
    const f = await fixture(t);
    await act(async () => outline(f.container)[2].click());
    const heading = f.container.querySelectorAll('[contenteditable] h2')[1];
    await waitFor(() => selectedWithin(heading), 'Heading navigation did not establish native selection');
    const selection = window.getSelection();
    await act(async () => {
      selection.setBaseAndExtent(heading.firstChild, 6, heading.firstChild, 2);
      document.dispatchEvent(new window.Event('selectionchange'));
      await new Promise(resolve => setTimeout(resolve, 5));
    });
    assert.equal(selection.anchorOffset, 6);
    assert.equal(selection.focusOffset, 2);
    const before = [selection.anchorNode.textContent, selection.anchorOffset, selection.focusNode.textContent, selection.focusOffset];
    await f.click('Markdown source');
    await f.click('Markdown source');
    const restoredHeading = f.container.querySelectorAll('[contenteditable] h2')[1];
    await waitFor(() => selectedWithin(restoredHeading), 'Rich selection did not return to the previous heading');
    const restored = window.getSelection();
    assert.deepEqual([restored.anchorNode.textContent, restored.anchorOffset, restored.focusNode.textContent, restored.focusOffset], before);
    assert.equal(document.activeElement, f.container.querySelector('[contenteditable]'));
    assert.equal(f.controller.getSnapshot().text, raw);
    assert.equal(f.writes(), 0);
  });

  await t.test('source edits recompute the outline and invalidate old rich heading positions', async t => {
    const f = await fixture(t);
    await act(async () => outline(f.container)[2].click());
    await waitFor(() => selectedWithin(f.container.querySelectorAll('[contenteditable] h2')[1]), 'Old heading selection was not established');
    await f.click('Markdown source');
    const changed = '# New title\n\nshort\n';
    await f.input(changed);
    await f.click('Markdown source');
    assert.deepEqual(outline(f.container).map(node => node.textContent), ['New title']);
    const content = f.container.querySelector('[contenteditable]');
    await waitFor(() => selectedWithin(content), 'Changed rich document did not receive a valid native selection');
    assert.equal(content.querySelectorAll('h2').length, 0);
    assert.equal(selectedWithin(content.querySelector('h1')), true);
    assert.equal(window.getSelection().anchorOffset, 0);
    assert.equal(window.getSelection().focusOffset, 0);
    await f.click('Go to heading: New title');
    await waitFor(() => selectedWithin(content.querySelector('h1')), 'New heading button used an obsolete position');
    assert.equal(f.controller.getSnapshot().text, changed);
    assert.equal(f.controller.getSnapshot().dirty, true);
    assert.equal(await f.saved(), raw);
    assert.equal(f.writes(), 0);
  });

  await t.test('whitespace-only source edits keep structurally equal heading targets navigable', async t => {
    const f = await fixture(t);
    const changed = raw.replace('\n\nOpening', '\n\n\nOpening');
    await f.click('Markdown source');
    await f.input(changed);
    await f.click('Markdown source');
    const buttons = outline(f.container);
    assert.deepEqual(buttons.map(node => node.textContent), ['Overview', 'Details', 'Details']);
    await act(async () => buttons[2].click());
    await waitFor(() => selectedWithin(f.container.querySelectorAll('[contenteditable] h2')[1]), 'Structurally equal headings retained an obsolete native document target');
    assert.equal(f.controller.getSnapshot().text, changed);
    assert.equal(f.writes(), 0);
    assert.equal(await f.saved(), raw);
  });

  await t.test('controller replacement removes old headings and does not transfer source bookmarks', async t => {
    const old = await fixture(t);
    const detachedHeading = outline(old.container)[2];
    await old.click('Markdown source');
    old.container.querySelector('textarea').setSelectionRange(15, 22, 'backward');
    await old.click('Markdown source');
    const nextText = '# Next document\n\nA different document with enough text for an unrelated selection.\n';
    const next = await fixture(t, nextText);
    await old.render(next.controller);
    assert.equal(detachedHeading.isConnected, false);
    assert.deepEqual(outline(old.container).map(node => node.textContent), ['Next document']);
    await act(async () => detachedHeading.click());
    await old.click('Go to heading: Next document');
    await waitFor(() => selectedWithin(old.container.querySelector('[contenteditable] h1')), 'Replacement heading did not receive native selection');
    await old.click('Markdown source');
    const textarea = old.container.querySelector('textarea');
    assert.equal(textarea.value, nextText);
    assert.notDeepEqual([textarea.selectionStart, textarea.selectionEnd, textarea.selectionDirection], [15, 22, 'backward']);
    assert.equal(old.controller.getSnapshot().text, raw);
    assert.equal(next.controller.getSnapshot().text, nextText);
    assert.equal(old.writes(), 0); assert.equal(next.writes(), 0);
  });
});
