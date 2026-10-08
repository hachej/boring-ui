import assert from 'node:assert/strict';
import test from 'node:test';
import { Window } from 'happy-dom';
import { Harness, MemoryStorage, createRegistry, defineExtension } from '@earendil-works/pi-durable';
import { createPresentationTool } from '@hachej/boring-agent/presentation';
import { createModels } from '@earendil-works/pi-ai/models';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import { Type } from '@earendil-works/pi-ai';
import { openSqliteWorkspaces } from '../../examples/shared/sqlite-workspaces.mjs';
import { createMarkdownController } from '@hachej/boring-ui-kit/markdown';
import { admitDocumentTool, documentToolResult } from '../fixtures/native-document.mjs';

test('native ToolTask uses a captured mounted Markdown target without owning the editor or Harness', { timeout: 20000 }, async t => {
  const window = new Window({ url: 'https://fictional.invalid/' });
  const globals = new Map();
  for (const name of ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node', 'Text', 'DOMParser', 'MutationObserver', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame']) {
    globals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, writable: true,
      value: name === 'window' ? window : typeof window[name] === 'function' && /^[a-z]/.test(name) ? window[name].bind(window) : window[name] });
  }
  globals.set('IS_REACT_ACT_ENVIRONMENT', Object.getOwnPropertyDescriptor(globalThis, 'IS_REACT_ACT_ENVIRONMENT'));
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const { createElement, act } = await import('react');
  const { createRoot } = await import('react-dom/client');
  const { MarkdownEditor } = await import('@hachej/boring-ui-kit/markdown-editor');
  const provider = openSqliteWorkspaces({ filename: ':memory:', providerId: 'fictional-native-markdown', authorize: () => true });
  const resource = { resource: { providerId: 'fictional-native-markdown', path: 'notes.md' }, view: { kind: 'published' } };
  const identity = { scopeId: 'fictional-project', principalId: 'editor', initiatorId: 'alice' };
  const markdown = '# Repeat\n\nA paragraph\n\n# Repeat\n\nSecond paragraph';
  await provider.publication.publish({ operationId: 'seed-native-mounted', atomicity: 'all-or-nothing',
    changes: [{ kind: 'create', target: resource, expected: { kind: 'absent' }, bytes: new TextEncoder().encode(markdown), mediaType: 'text/markdown' }] }, identity);
  const snapshot = (await provider.read({ target: resource, revision: { kind: 'latest' } }, identity)).snapshot;
  const controller = createMarkdownController({ source: { kind: 'saved', snapshot }, identity,
    client: { read: request => provider.read(request, identity), publish: request => provider.publication.publish(request, identity),
      lookup: operationId => provider.reconciliation.lookup(operationId, identity) }, instanceId: 'native-editor', epoch: 'page' });
  const container = document.createElement('div'); document.body.append(container);
  const root = createRoot(container);
  let harness;
  t.after(async () => {
    await act(async () => root.unmount());
    if (harness) await harness.close(context);
    controller.dispose(); provider.close(); container.remove();
    await window.happyDOM.close();
    for (const [name, descriptor] of globals) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  });
  const handles = [];
  const mounted = tools => { if (tools) handles.push(tools); };
  await act(async () => root.render(createElement(MarkdownEditor, { key: 'first', controller, onMountedTools: mounted })));
  const first = handles.at(-1), captured = first?.getTarget();
  assert.ok(captured, 'actual rich editor is mounted and current');
  const browserFrame = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = callback => browserFrame(time => act(() => callback(time)));
  let initialSelection;
  act(() => { initialSelection = first.revealHeading.invoke(captured, { index: 0, expiresAt: Date.now() + 5000 }); });
  assert.equal((await initialSelection).kind, 'applied');
  const original = await first.inspect.invoke(captured, { expiresAt: Date.now() + 5000 });
  assert.equal(original.kind, 'applied');
  assert.deepEqual(original.value.headings.map(item => [item.index, item.text]), [[0, 'Repeat'], [1, 'Repeat']]);
  assert.equal(original.value.dirty, false);

  const commandResults = [];
  let observedCommand;
  const tool = createPresentationTool({ name: 'navigate_markdown', description: 'Navigate fictional mounted notes',
    parameters: Type.Object({ index: Type.Integer({ minimum: 0 }) }),
    target: captured,
    command: { ...first.revealHeading, invoke: async (...args) => {
      const result = await first.revealHeading.invoke(...args);
      commandResults.push(result);
      observedCommand?.resolve(result);
      return result;
    } },
    prepareInput: args => ({ index: args.index, expiresAt: Date.now() + 5000 }),
    authorize: (_input, _target, api) => api.conversationId === conversation.id,
    formatResult: result => ({ content: [{ type: 'text', text: JSON.stringify(result) }] }),
  });
  const registry = createRegistry(); registry.install(defineExtension({ name: 'fixture.mounted-markdown', tools: [tool] }));
  harness = await Harness.open(new MemoryStorage(), { registry, models: createModels() }, context);
  const conversation = await harness.root(context);
  const run = async index => documentToolResult(harness, conversation,
    await admitDocumentTool(conversation, { index }, 'navigate_markdown'));
  let firstRunPending;
  act(() => { firstRunPending = run(1); });
  const firstRun = await firstRunPending;
  assert.equal(firstRun.entry.model[0].isError, false);
  assert.equal(firstRun.result.kind, 'applied');
  const rich = container.querySelector('[contenteditable]');
  assert.equal(document.activeElement, rich);
  assert.equal(container.querySelectorAll('h1').length, 2);
  assert.equal(rich.querySelectorAll('h1')[1].textContent, 'Repeat');
  const selected = await first.inspect.invoke(captured, { expiresAt: Date.now() + 5000 });
  assert.equal(selected.kind, 'applied');
  assert.equal(selected.value.currentSelection.kind, 'rich');
  assert.ok(selected.value.currentSelection.anchor > original.value.currentSelection.anchor);
  const domAnchor = window.getSelection().anchorNode;
  assert.ok((domAnchor.nodeType === 1 ? domAnchor : domAnchor.parentElement).closest('h1') === rich.querySelectorAll('h1')[1], 'DOM anchor belongs to second heading');
  assert.equal(controller.getSnapshot().text, markdown);
  assert.equal(controller.getSnapshot().dirty, false);

  window.requestAnimationFrame = browserFrame;
  const queued = new Map(), scheduledCallbacks = []; let frameId = 0;
  const frameScheduled = Promise.withResolvers();
  const requestAnimationFrame = window.requestAnimationFrame.bind(window);
  const cancelAnimationFrame = window.cancelAnimationFrame.bind(window);
  window.requestAnimationFrame = callback => { const id = ++frameId; queued.set(id, callback); scheduledCallbacks.push(callback); frameScheduled.resolve(); return id; };
  window.cancelAnimationFrame = id => { queued.delete(id); };
  try {
    const before = selected.value.currentSelection;
    const beforeDom = { anchorNode: window.getSelection().anchorNode, anchorOffset: window.getSelection().anchorOffset,
      focusNode: window.getSelection().focusNode, focusOffset: window.getSelection().focusOffset, activeElement: document.activeElement };
    observedCommand = Promise.withResolvers();
    const pendingTask = await admitDocumentTool(conversation, { index: 0 }, 'navigate_markdown');
    await frameScheduled.promise;
    assert.equal(queued.size, 1);
    assert.equal(await harness.abortTask(pendingTask, context), 'marked');
    assert.equal((await observedCommand.promise).kind, 'denied', 'native cancellation reaches the presentation command');
    assert.equal(commandResults.at(-1).kind, 'denied');
    assert.equal(queued.size, 0, 'native abort cancels the pending presentation frame');
    for (const callback of scheduledCallbacks) callback(Date.now());
    assert.deepEqual((await first.inspect.invoke(captured, { expiresAt: Date.now() + 5000 })).value.currentSelection, before);
    assert.ok(window.getSelection().anchorNode === beforeDom.anchorNode && window.getSelection().anchorOffset === beforeDom.anchorOffset
      && window.getSelection().focusNode === beforeDom.focusNode && window.getSelection().focusOffset === beforeDom.focusOffset
      && document.activeElement === beforeDom.activeElement, 'native abort leaves DOM selection and focus unchanged');
    assert.equal((await harness.waitForTask(pendingTask, context)).state.outcome.status, 'aborted');
  } finally {
    window.requestAnimationFrame = requestAnimationFrame;
    window.cancelAnimationFrame = cancelAnimationFrame;
  }

  await act(async () => root.render(createElement(MarkdownEditor, { key: 'second', controller, onMountedTools: mounted })));
  const second = handles.at(-1), fresh = second.getTarget();
  assert.ok(fresh);
  assert.notEqual(fresh.subject.mountId, captured.subject.mountId);
  assert.equal(first.getTarget(), null);
  assert.equal((await second.revealHeading.invoke(captured, { index: 0, expiresAt: Date.now() + 5000 })).kind, 'stale');
  assert.equal((await run(0)).result.kind, 'unavailable', 'registered native tool keeps the old handle and target');
  assert.equal(controller.getSnapshot().lifecycle, 'active');
  await act(async () => root.unmount());
  assert.equal(controller.getSnapshot().lifecycle, 'active');
  await conversation.configure({ instructions: 'Borrowed native conversation survives viewer close' }, context);
  assert.equal((await run(0)).result.kind, 'unavailable');
  assert.equal((await provider.read({ target: resource, revision: { kind: 'latest' } }, identity)).kind, 'available');
});
