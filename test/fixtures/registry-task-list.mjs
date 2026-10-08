import assert from 'node:assert/strict';
import test from 'node:test';
import { Window } from 'happy-dom';
import { openSqliteWorkspaces } from '../../examples/shared/sqlite-workspaces.mjs';

// The installer bundles these exports from its CLI-installed source. The local
// runner uses the same entry contract, never private package implementations.
const modulePath = process.env.TASK_LIST_REGISTRY_MODULE ?? '../../dist/task-list-viewer.js';

test('task-list installed renderer edits, saves, reconciles and borrows its controller (DOM evidence)', { timeout: 30000 }, async t => {
  const window = new Window({ url: 'https://fictional.invalid/' }), globals = new Map();
  let cleanup = async () => {};
  for (const name of ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node', 'Text', 'MutationObserver', 'getComputedStyle']) {
    globals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value: name === 'window' ? window : name === 'getComputedStyle' ? window.getComputedStyle.bind(window) : window[name] });
  }
  globals.set('IS_REACT_ACT_ENVIRONMENT', Object.getOwnPropertyDescriptor(globalThis, 'IS_REACT_ACT_ENVIRONMENT')); globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  t.after(async () => { await cleanup(); await window.happyDOM.close(); for (const [name, descriptor] of globals) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name]; } });
  const { createElement, act } = await import('react'), { createRoot } = await import('react-dom/client');
  const { TaskListViewer, createTaskListController, serializeTaskList, taskListMediaType } = await import(modulePath);
  const provider = openSqliteWorkspaces({ filename: ':memory:', providerId: 'fictional-task-registry', authorize: action => action !== 'read' || !readDenied });
  const identity = { scopeId: 'fictional', principalId: 'editor', initiatorId: 'alice' };
  const target = { resource: { providerId: provider.providerId, path: 'tasks.json' }, view: { kind: 'published' } };
  let writes = 0, loseReply = false, denied = false, readDenied = false, readUnavailable = false, releaseRead, holdRead = false, loseBeforeEffect = false;
  const extraControllers = [];
  const client = { read: async request => {
    if (holdRead) { holdRead = false; await new Promise(resolve => { releaseRead = resolve; }); return { kind: 'denied', reason: 'Old controller late refusal' }; }
    if (readUnavailable) return { kind: 'unavailable', reason: 'Provider temporarily unavailable' };
    return provider.read(request, identity);
  }, lookup: id => provider.reconciliation.lookup(id, identity), publish: async request => {
    writes++; if (loseBeforeEffect) { loseBeforeEffect = false; throw new Error('Lost dispatch with no publication effect'); }
    if (denied) return { kind: 'denied', reason: 'Fictional current policy' };
    const result = await provider.publication.publish(request, identity); if (loseReply) { loseReply = false; throw new Error('Lost reply'); } return result;
  } };
  const initial = { kind: 'fictional.task-list', version: 1, items: [{ id: 'one', title: 'Fictional task', completed: false }] };
  await provider.publication.publish({ operationId: 'seed', atomicity: 'all-or-nothing', changes: [{ kind: 'create', target, expected: { kind: 'absent' }, mediaType: taskListMediaType, bytes: new TextEncoder().encode(serializeTaskList(initial)) }] }, identity);
  const snapshot = (await client.read({ target, revision: { kind: 'latest' } })).snapshot;
  const controller = createTaskListController({ identity, source: { kind: 'saved', snapshot }, client, instanceId: 'registry', epoch: 'page' });
  const container = document.createElement('div'); document.body.append(container); const root = createRoot(container);
  cleanup = async () => { await act(async () => root.unmount()); await controller.dispose(); for (const extra of extraControllers) await extra.dispose(); provider.close(); };
  await act(async () => root.render(createElement(TaskListViewer, { controller, title: 'Installed fictional tasks', className: 'host-task-list' })));
  const button = label => { const found = [...container.querySelectorAll('button')].find(node => node.textContent === label); assert.ok(found, label); return found; };
  const click = async label => act(async () => button(label).click());
  const check = async () => act(async () => container.querySelector('input[type=checkbox]').click());
  const settle = async () => { for (let i = 0; i < 100 && controller.getSnapshot().save.kind === 'pending'; i++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)); }); assert.equal(controller.getSnapshot().save.kind, 'settled'); };
  const read = async () => JSON.parse(new TextDecoder().decode((await client.read({ target, revision: { kind: 'latest' } })).snapshot.bytes));
  assert.equal(writes, 0); assert.ok(container.querySelector('.boring-task-list-recipe.host-task-list'));
  if (process.env.BORING_REGISTRY_RESTYLED === 'true') assert.ok(container.querySelector('.host-installed-task-list'));
  await check(); assert.equal(writes, 0); assert.equal((await read()).items[0].completed, false);
  await click('Save'); await settle(); assert.equal(controller.getSnapshot().save.result.kind, 'saved'); assert.equal((await read()).items[0].completed, true);
  const receipt = controller.getSnapshot().save.result.receipt; assert.deepEqual((await client.lookup(receipt.operationId)).receipt, receipt);
  await check(); denied = true; await click('Save'); await settle(); assert.equal(controller.getSnapshot().save.result.kind, 'denied'); assert.equal(controller.getSnapshot().dirty, true);
  denied = false; loseReply = true; await click('Save'); await settle(); assert.equal(controller.getSnapshot().save.result.kind, 'unknown'); assert.match(container.textContent, /unknown/);
  const before = writes; await click('Reconcile'); await settle(); assert.equal(controller.getSnapshot().save.result.kind, 'saved'); assert.equal(writes, before); assert.equal((await read()).items[0].completed, false);
  const selection = controller.actions.selection(); await check(); assert.equal(controller.actions.edit(selection, [{ kind: 'remove', id: 'one' }]).kind, 'stale');
  await click('Remove'); // No unlabelled Remove selector ambiguity with a one-row list.
  assert.equal(controller.getSnapshot().document.items.length, 0); assert.equal(writes, before);
  const remote = await client.read({ target, revision: { kind: 'latest' } });
  const other = await provider.publication.publish({ operationId: 'other', atomicity: 'all-or-nothing', changes: [{ kind: 'replace', target: remote.snapshot.ref, mediaType: taskListMediaType, bytes: new TextEncoder().encode(serializeTaskList({ ...initial, items: [{ ...initial.items[0], title: 'Other writer' }] })) }] }, identity);
  assert.equal(other.kind, 'committed'); await click('Save'); await settle(); assert.equal(controller.getSnapshot().save.result.kind, 'conflict'); assert.equal(controller.getSnapshot().document.items.length, 0);
  await click('Refresh'); for (let i = 0; i < 100 && !controller.getSnapshot().remote; i++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)); }); assert.ok(controller.getSnapshot().remote); await click('Discard'); for (let i = 0; i < 100 && controller.getSnapshot().dirty; i++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)); }); assert.equal(controller.getSnapshot().dirty, false); assert.equal(controller.getSnapshot().document.items[0].title, 'Other writer');
  await act(async () => {
    const input = container.querySelector('input:not([type=checkbox])');
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(input, 'Added by human');
    input.dispatchEvent(new window.Event('input', { bubbles: true }));
  });
  await act(async () => container.querySelector('form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })));
  assert.equal(controller.getSnapshot().document.items.length, 2); assert.equal(controller.getSnapshot().document.items[1].title, 'Added by human');
  await click('Save'); await settle(); assert.equal(controller.getSnapshot().save.result.kind, 'saved'); assert.equal((await read()).items.length, 2);
  const waitFor = async predicate => { for (let i = 0; i < 100 && !predicate(); i++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)); }); assert.ok(predicate()); };
  await check(); const abandonedDraft = controller.getSnapshot().text, savedBeforeUnknown = await read();
  loseBeforeEffect = true; await click('Save'); await settle(); assert.equal(controller.getSnapshot().save.result.kind, 'unknown');
  const unknownId = controller.getSnapshot().save.result.operationId, attemptedWrites = writes;
  assert.equal((await client.lookup(unknownId)).kind, 'not-found'); await click('Reconcile'); await settle(); assert.equal(controller.getSnapshot().save.result.kind, 'unknown'); assert.equal(writes, attemptedWrites);
  await click('Abandon save'); await waitFor(() => controller.getSnapshot().save.kind === 'idle');
  assert.equal(controller.getSnapshot().text, abandonedDraft); assert.equal(controller.getSnapshot().dirty, true); assert.equal(writes, attemptedWrites); assert.deepEqual(await read(), savedBeforeUnknown);
  await click('Save'); await settle(); assert.equal(controller.getSnapshot().save.result.kind, 'saved'); assert.equal(writes, attemptedWrites + 1); assert.notEqual(controller.getSnapshot().save.result.receipt.operationId, unknownId); assert.equal(controller.getSnapshot().dirty, false);

  readDenied = true; await click('Refresh'); await waitFor(() => container.querySelector('[role=alert]')?.textContent.includes('Read is not authorized'));
  assert.match(container.querySelector('[role=alert]').textContent, /denied/); assert.equal(controller.getSnapshot().dirty, false);
  readDenied = false; readUnavailable = true; await click('Refresh'); await waitFor(() => container.querySelector('[role=alert]')?.textContent.includes('Provider temporarily unavailable'));
  assert.match(container.querySelector('[role=alert]').textContent, /unavailable/); readUnavailable = false;
  await act(async () => {
    const input = container.querySelector('input:not([type=checkbox])');
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(input, 'Private draft from A');
    input.dispatchEvent(new window.Event('input', { bubbles: true }));
  });
  const replacement = createTaskListController({ identity, source: { kind: 'saved', snapshot: (await client.read({ target, revision: { kind: 'latest' } })).snapshot }, client, instanceId: 'replacement', epoch: 'page' });
  extraControllers.push(replacement);
  holdRead = true; await click('Refresh'); await waitFor(() => typeof releaseRead === 'function');
  await act(async () => root.render(createElement(TaskListViewer, { controller: replacement })));
  assert.equal(container.querySelector('input:not([type=checkbox])').value, ''); assert.equal(container.querySelector('[role=alert]'), null); assert.equal(button('Add task').disabled, true);
  const replacementBefore = replacement.getSnapshot().text;
  await act(async () => container.querySelector('form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })));
  assert.equal(replacement.getSnapshot().text, replacementBefore); assert.doesNotMatch(container.textContent, /Private draft from A/);
  await act(async () => { releaseRead(); await new Promise(resolve => setTimeout(resolve, 10)); });
  assert.doesNotMatch(container.textContent, /Old controller late refusal/); assert.equal(replacement.getSnapshot().text, replacementBefore);
  // Returning to the original controller starts another form incarnation.
  await act(async () => root.render(createElement(TaskListViewer, { controller })));
  assert.equal(container.querySelector('input:not([type=checkbox])').value, ''); assert.equal(container.querySelector('[role=alert]'), null);
  const readonly = createTaskListController({ identity, source: { kind: 'saved', snapshot: (await client.read({ target, revision: { kind: 'latest' } })).snapshot }, client, instanceId: 'readonly', epoch: 'page', readOnly: true });
  await act(async () => root.render(createElement(TaskListViewer, { controller: readonly })));
  assert.equal(container.querySelector('input[type=checkbox]').disabled, true); assert.equal(button('Save').disabled, true);
  assert.equal(readonly.actions.edit(readonly.actions.selection(), [{ kind: 'remove', id: 'one' }]).kind, 'denied');
  await act(async () => root.render(null)); await readonly.dispose(); assert.equal(controller.getSnapshot().lifecycle, 'active'); assert.equal((await client.read({ target, revision: { kind: 'latest' } })).kind, 'available');
});
