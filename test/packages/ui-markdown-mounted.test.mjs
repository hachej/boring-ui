import assert from 'node:assert/strict';
import test from 'node:test';
import { Window } from 'happy-dom';
import { createMarkdownController } from '@hachej/boring-ui-kit/markdown';
import { openSqliteWorkspaces } from '../../examples/shared/sqlite-workspaces.mjs';

test('mounted Markdown commands use the live React/Tiptap editor and exact resource', async t => {
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
  const original = '# Overview\n\nSome prose.\n\n## Details\n\nFirst body.\n\n## Details\n\nSecond body.\n';
  let sequence = 0;

  async function waitFor(predicate, message) {
    const deadline = Date.now() + 2000;
    while (!predicate()) {
      assert.ok(Date.now() < deadline, message);
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)); });
    }
  }
  async function fixture(t, { text = original, readOnly = false, shadow = false } = {}) {
    const providerId = `mounted-${++sequence}`;
    const provider = openSqliteWorkspaces({ filename: ':memory:', providerId, authorize: () => true });
    const target = { resource: { providerId, path: 'notes.md' }, view: { kind: 'published' } };
    const identity = { scopeId: 'fictional', principalId: 'writer', initiatorId: 'alice' };
    await provider.publication.publish({ operationId: `seed-${sequence}`, atomicity: 'all-or-nothing', changes: [{ kind: 'create', target, expected: { kind: 'absent' }, bytes: new TextEncoder().encode(text), mediaType: 'text/markdown' }] }, identity);
    let writes = 0;
    const client = {
      read: request => provider.read(request, identity),
      publish: request => { writes++; return provider.publication.publish(request, identity); },
      lookup: id => provider.reconciliation.lookup(id, identity),
    };
    const read = await client.read({ target, revision: { kind: 'latest' } });
    const controller = createMarkdownController({ source: { kind: 'saved', snapshot: read.snapshot }, identity, client, instanceId: `viewer-${sequence}`, epoch: 'one', readOnly });
    const container = document.createElement('div');
    const host = shadow ? document.createElement('div') : container;
    document.body.append(host);
    if (shadow) host.attachShadow({ mode: 'open' }).append(container);
    const root = createRoot(container);
    const delivered = [];
    let callback = tools => { delivered.push(tools); };
    const render = async (selected = controller, selectedCallback = callback) => {
      await act(async () => { root.render(createElement(MarkdownEditor, { controller: selected, title: 'Notes', onMountedTools: selectedCallback })); });
    };
    await render();
    const tools = () => delivered.filter(Boolean).at(-1);
    await waitFor(() => tools()?.getTarget(), 'Mounted tools did not become ready');
    const button = label => [...container.querySelectorAll('button')].find(node => (node.getAttribute('aria-label') || node.textContent) === label);
    const click = async label => { const node = button(label); assert.ok(node, `Missing ${label}`); await act(async () => node.click()); };
    t.after(async () => { await act(async () => root.unmount()); controller.dispose(); provider.close(); host.remove(); });
    return { controller, container, root, delivered, tools, render, button, click, writes: () => writes, identity, target,
      changeCallback: next => { callback = next; },
      saved: async () => new TextDecoder('utf-8', { ignoreBOM: true }).decode((await client.read({ target, revision: { kind: 'latest' } })).snapshot.bytes) };
  }
  const expiresAt = () => Date.now() + 10_000;
  const inspect = (tools, target) => tools.inspect.invoke(target, { expiresAt: expiresAt() });
  const invoke = async (command, target, input, signal) => {
    let result;
    await act(async () => { result = await command.invoke(target, input, signal); });
    return result;
  };
  function holdFrames() {
    const request = window.requestAnimationFrame;
    const cancel = window.cancelAnimationFrame;
    const frames = new Map();
    let next = 1;
    window.requestAnimationFrame = callback => { const id = next++; frames.set(id, callback); return id; };
    window.cancelAnimationFrame = id => { frames.delete(id); };
    return { frames, fire: () => {
      const [id, callback] = frames.entries().next().value;
      frames.delete(id);
      callback(Date.now());
    }, restore: () => { window.requestAnimationFrame = request; window.cancelAnimationFrame = cancel; } };
  }

  await t.test('duplicate headings reveal exact native positions and inspect live rich selection without writes', async t => {
    const f = await fixture(t);
    const tools = f.tools();
    const target = tools.getTarget();
    assert.ok(target);
    const found = await inspect(tools, target);
    assert.equal(found.kind, 'applied');
    assert.deepEqual(found.value.headings.map(value => [value.index, value.level, value.text]), [[0, 1, 'Overview'], [1, 2, 'Details'], [2, 2, 'Details']]);
    assert.deepEqual(found.value.selection, f.controller.actions.selection());
    assert.equal(found.value.dirty, false);
    assert.equal(found.value.currentSelection.kind, 'rich');
    assert.equal(found.value.currentSelection.anchor, found.value.currentSelection.head);
    assert.equal(found.value.text, '');
    const headings = [...f.container.querySelectorAll('[contenteditable] h1, [contenteditable] h2')];
    for (const index of [2, 0, 1]) {
      const result = await invoke(tools.revealHeading, target, { expiresAt: expiresAt(), index });
      assert.equal(result.kind, 'applied');
      assert.ok(headings[index].contains(window.getSelection().anchorNode));
      assert.equal(document.activeElement, f.container.querySelector('[contenteditable]'));
    }
    const after = await inspect(tools, target);
    assert.equal(after.kind, 'applied');
    assert.equal(after.value.currentSelection.kind, 'rich');
    assert.equal(after.value.text, '');
    const outside = document.createElement('span');
    outside.textContent = 'Outside';
    document.body.append(outside);
    t.after(() => outside.remove());
    for (const selection of [{ kind: 'rich', anchor: 6, head: 2 }, { kind: 'rich', anchor: 2, head: 6 }]) {
      for (let repeat = 0; repeat < 2; repeat++) {
        assert.equal((await invoke(tools.select, target, { expiresAt: expiresAt(), selection })).kind, 'applied');
        const chosen = await inspect(tools, target);
        assert.deepEqual(chosen.value.currentSelection, selection);
        assert.equal(chosen.value.text, 'verv');
        const dom = window.getSelection();
        assert.ok(headings[0].contains(dom.anchorNode));
        assert.ok(headings[0].contains(dom.focusNode));
        assert.deepEqual([dom.anchorOffset, dom.focusOffset], [selection.anchor - 1, selection.head - 1]);
        if (repeat === 0) {
          f.button('Markdown source').focus();
          dom.setBaseAndExtent(outside.firstChild, 0, outside.firstChild, 7);
          assert.deepEqual((await inspect(tools, target)).value.currentSelection, selection);
        }
      }
    }
    assert.equal(f.controller.getSnapshot().text, original);
    assert.equal(f.controller.getSnapshot().dirty, false);
    assert.equal(f.controller.getSnapshot().bufferVersion, 0);
    assert.equal(f.writes(), 0);
    assert.equal(await f.saved(), original);
  });

  await t.test('source selection preserves backward direction and invalidates rich handle and target', async t => {
    const f = await fixture(t);
    const richTools = f.tools();
    const richTarget = richTools.getTarget();
    await f.click('Markdown source');
    await waitFor(() => f.tools() !== richTools && f.tools()?.getTarget()?.subject.mode === 'source', 'Source tools did not mount');
    const tools = f.tools();
    const target = tools.getTarget();
    assert.equal((await inspect(richTools, richTarget)).kind, 'unavailable');
    assert.equal((await inspect(tools, richTarget)).kind, 'stale');
    assert.equal((await tools.revealHeading.invoke(target, { expiresAt: expiresAt(), index: 0 })).kind, 'unavailable');
    const textarea = f.container.querySelector('textarea');
    const selection = { kind: 'source', start: 3, end: 17, direction: 'backward' };
    assert.equal((await invoke(tools.select, target, { expiresAt: expiresAt(), selection })).kind, 'applied');
    assert.deepEqual([textarea.selectionStart, textarea.selectionEnd, textarea.selectionDirection], [3, 17, 'backward']);
    const found = await inspect(tools, target);
    assert.equal(found.kind, 'applied');
    assert.deepEqual(found.value.currentSelection, selection);
    assert.equal(found.value.text, original.slice(3, 17));
    assert.deepEqual(found.value.headings, []);
    assert.equal((await tools.select.invoke(target, { expiresAt: expiresAt(), selection: { kind: 'rich', anchor: 1, head: 1 } })).kind, 'denied');
    assert.equal(f.writes(), 0);
    assert.equal(await f.saved(), original);
  });

  await t.test('readonly presentation remains usable, while malformed, expired, cancelled and misbound requests fail', async t => {
    const f = await fixture(t, { readOnly: true });
    const tools = f.tools();
    const target = tools.getTarget();
    const outside = document.createElement('span');
    outside.textContent = 'Outside';
    document.body.append(outside);
    t.after(() => outside.remove());
    f.button('Markdown source').focus();
    window.getSelection().setBaseAndExtent(outside.firstChild, 0, outside.firstChild, 7);
    assert.equal((await invoke(tools.revealHeading, target, { expiresAt: expiresAt(), index: 1 })).kind, 'applied');
    const heading = f.container.querySelector('[contenteditable] h2');
    assert.ok(heading.contains(window.getSelection().anchorNode));
    assert.ok(heading.contains(window.getSelection().focusNode));
    assert.equal(document.activeElement, f.container.querySelector('[contenteditable]'));
    assert.equal((await inspect(tools, target)).kind, 'applied');
    for (const selection of [{ kind: 'rich', anchor: 2, head: 6 }, { kind: 'rich', anchor: 6, head: 2 }]) {
      for (let repeat = 0; repeat < 2; repeat++) {
        assert.equal((await invoke(tools.select, target, { expiresAt: expiresAt(), selection })).kind, 'applied');
        assert.deepEqual((await inspect(tools, target)).value.currentSelection, selection);
        const dom = window.getSelection();
        const title = f.container.querySelector('[contenteditable] h1');
        assert.ok(title.contains(dom.anchorNode));
        assert.ok(title.contains(dom.focusNode));
        assert.deepEqual([dom.anchorOffset, dom.focusOffset], [selection.anchor - 1, selection.head - 1]);
        if (repeat === 0) {
          f.button('Markdown source').focus();
          dom.setBaseAndExtent(outside.firstChild, 0, outside.firstChild, 7);
          assert.deepEqual((await inspect(tools, target)).value.currentSelection, selection);
        }
      }
    }
    assert.equal((await tools.inspect.invoke(target, { expiresAt: Date.now() - 1 })).kind, 'stale');
    const signal = AbortSignal.abort();
    assert.equal((await tools.inspect.invoke(target, { expiresAt: expiresAt() }, signal)).kind, 'denied');
    const changes = [
      { ...target, instanceId: 'other' },
      { ...target, epoch: 'other' },
      { ...target, subject: { ...target.subject, scopeId: 'other' } },
      { ...target, subject: { ...target.subject, bufferVersion: target.subject.bufferVersion + 1 } },
      { ...target, subject: { ...target.subject, mountId: 'other' } },
      { ...target, subject: { ...target.subject, projectionId: 'other' } },
      { ...target, subject: { ...target.subject, mode: 'source' } },
      { ...target, subject: { ...target.subject, base: { ...target.subject.base, target: { ...target.subject.base.target, revision: 'other' } } } },
      { ...target, subject: { ...target.subject, base: { ...target.subject.base, target: { ...target.subject.base.target, view: { kind: 'working', viewId: 'other' } } } } },
      { ...target, subject: { ...target.subject, base: { ...target.subject.base, target: { ...target.subject.base.target, resource: { providerId: 'other', path: 'notes.md' } } } } },
    ];
    for (const wrong of changes) assert.equal((await inspect(tools, wrong)).kind, 'stale');
    assert.throws(() => tools.inspect.input.parse({ expiresAt: 'tomorrow' }), TypeError);
    assert.throws(() => tools.select.input.parse({ expiresAt: expiresAt(), selection: { kind: 'rich', anchor: -1, head: 1 } }), TypeError);
    assert.throws(() => tools.revealHeading.input.parse({ expiresAt: expiresAt(), index: -1 }), TypeError);
    assert.equal(f.controller.getSnapshot().dirty, false);
    assert.equal(f.writes(), 0);
  });

  await t.test('callback changes retain mount identity, same-controller remount invalidates the old handle', async t => {
    const f = await fixture(t);
    const first = f.tools();
    const target = first.getTarget();
    const nextDelivery = [];
    f.changeCallback(value => { f.delivered.push(value); nextDelivery.push(value); });
    await f.render();
    assert.equal(nextDelivery.at(-1), first);
    assert.deepEqual(first.getTarget(), target);
    await act(async () => f.root.render(null));
    assert.equal(first.getTarget(), null);
    assert.equal((await inspect(first, target)).kind, 'unavailable');
    await f.render();
    const second = f.tools();
    assert.notEqual(second, first);
    assert.notEqual(second.getTarget().subject.mountId, target.subject.mountId);
    assert.equal((await inspect(second, target)).kind, 'stale');
    assert.equal((await inspect(second, second.getTarget())).kind, 'applied');
  });

  await t.test('dirty buffer invalidates captured target, and commands never publish', async t => {
    const f = await fixture(t);
    const tools = f.tools();
    const old = tools.getTarget();
    await act(async () => f.controller.actions.edit('# Changed\n\nNew body.\n'));
    assert.equal((await inspect(tools, old)).kind, 'stale');
    await waitFor(() => tools.getTarget()?.subject.bufferVersion === 1, 'Changed document was not projected');
    const current = tools.getTarget();
    const found = await inspect(tools, current);
    assert.equal(found.kind, 'applied');
    assert.equal(found.value.selection.target.subject.bufferVersion, 1);
    assert.equal(found.value.selection.target.subject.base.target.revision, f.controller.getSnapshot().base.target.revision);
    assert.equal(found.value.dirty, true);
    assert.equal(found.value.headings[0].text, 'Changed');
    assert.equal(f.controller.getSnapshot().dirty, true);
    assert.equal(f.writes(), 0);
    assert.equal(await f.saved(), original);
  });

  await t.test('pending native frame captures input, then abort, expiry and unmount settle without selection effects', async t => {
    const f = await fixture(t);
    await f.click('Markdown source');
    const tools = f.tools();
    const target = tools.getTarget();
    const input = f.container.querySelector('textarea');
    const held = holdFrames();
    try {
      const selection = { kind: 'source', start: 3, end: 9, direction: 'backward' };
      const request = { expiresAt: expiresAt(), selection };
      const selected = tools.select.invoke(target, request);
      assert.equal(held.frames.size, 1);
      selection.start = 0; selection.end = 1; selection.direction = 'forward';
      request.expiresAt = Date.now() - 1;
      held.fire();
      assert.equal((await selected).kind, 'applied');
      assert.deepEqual([input.selectionStart, input.selectionEnd, input.selectionDirection], [3, 9, 'backward']);

      const aborted = new AbortController();
      const cancellation = tools.select.invoke(target, { expiresAt: expiresAt(), selection: { kind: 'source', start: 1, end: 2, direction: 'forward' } }, aborted.signal);
      assert.equal(held.frames.size, 1);
      aborted.abort();
      assert.equal((await cancellation).kind, 'denied');
      assert.equal(held.frames.size, 0);
      assert.deepEqual([input.selectionStart, input.selectionEnd], [3, 9]);

      const expiring = tools.select.invoke(target, { expiresAt: Date.now() + 20, selection: { kind: 'source', start: 1, end: 2, direction: 'forward' } });
      assert.equal(held.frames.size, 1);
      assert.equal((await expiring).kind, 'stale');
      assert.equal(held.frames.size, 0);
      assert.deepEqual([input.selectionStart, input.selectionEnd], [3, 9]);

      const detached = tools.select.invoke(target, { expiresAt: expiresAt(), selection: { kind: 'source', start: 1, end: 2, direction: 'forward' } });
      assert.equal(held.frames.size, 1);
      await act(async () => f.root.render(null));
      assert.equal((await detached).kind, 'unavailable');
      assert.equal(held.frames.size, 0);
      assert.equal(f.writes(), 0);
    } finally { held.restore(); }
  });

  await t.test('reentrant focus disposal and a changed buffer prevent queued selection', async t => {
    const f = await fixture(t);
    await f.click('Markdown source');
    const tools = f.tools();
    const target = tools.getTarget();
    const input = f.container.querySelector('textarea');
    const held = holdFrames();
    try {
      const stale = tools.select.invoke(target, { expiresAt: expiresAt(), selection: { kind: 'source', start: 2, end: 5, direction: 'forward' } });
      await act(async () => f.controller.actions.edit('# Different\n'));
      held.fire();
      assert.equal((await stale).kind, 'stale');
      assert.notDeepEqual([input.selectionStart, input.selectionEnd], [2, 5]);
      await waitFor(() => tools.getTarget()?.subject.bufferVersion === 1, 'New source buffer did not project');
      const current = tools.getTarget();
      const focus = input.focus.bind(input);
      input.focus = options => { f.controller.dispose(); return focus(options); };
      const closing = tools.select.invoke(current, { expiresAt: expiresAt(), selection: { kind: 'source', start: 2, end: 5, direction: 'forward' } });
      await act(async () => held.fire());
      assert.equal((await closing).kind, 'unavailable');
      assert.notDeepEqual([input.selectionStart, input.selectionEnd], [2, 5]);
      assert.equal(f.writes(), 0);
    } finally { held.restore(); }
  });

  await t.test('source selection works inside a shadow root without publishing', async t => {
    const f = await fixture(t, { shadow: true });
    await f.click('Markdown source');
    const tools = f.tools();
    const target = tools.getTarget();
    const selected = { kind: 'source', start: 2, end: 8, direction: 'backward' };
    assert.equal((await invoke(tools.select, target, { expiresAt: expiresAt(), selection: selected })).kind, 'applied');
    const input = f.container.querySelector('textarea');
    assert.equal(input.getRootNode().activeElement, input);
    assert.deepEqual((await inspect(tools, target)).value.currentSelection, selected);
    assert.equal(f.writes(), 0);
    assert.equal(await f.saved(), original);
  });
});
