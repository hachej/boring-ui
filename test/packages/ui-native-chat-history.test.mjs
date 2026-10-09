import assert from 'node:assert/strict';
import test from 'node:test';
import { Harness, MemoryStorage, createRegistry } from '@earendil-works/pi-durable';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import { createNativeChatController } from '@hachej/boring-ui-kit/native-chat';
import { createFakeChatModel } from '@hachej/boring-testing/model';

const identity = { runtimeId: 'fictional-runtime', scopeId: 'fictional-scope', principalId: 'fictional-person' };
const deferred = () => Promise.withResolvers();
const nativeHistory = conversation => ({ id: conversation.id, entries: conversation.entries.bind(conversation) });
async function fixture(t) {
  const fake = createFakeChatModel();
  const harness = await Harness.open(new MemoryStorage(), { registry: createRegistry(), models: fake.models }, context);
  const conversation = await harness.createConversation({ ownership: { kind: 'ownerless' }, agent: { model: fake.model } }, context);
  const controllers = [];
  t.after(async () => { for (const controller of controllers) await controller.dispose(); await harness.close(context); });
  return { harness, conversation, controller: options => {
    const controller = createNativeChatController({ identity, context, conversation, ...options });
    controllers.push(controller); return controller;
  } };
}
async function write(conversation, label) {
  return conversation.submit({ type: 'write', entry: { kind: 'fictional.note', model: [{ role: 'user', content: label, timestamp: 0 }] } }, context);
}
function observe(controller, predicate) {
  if (predicate(controller.getSnapshot())) return Promise.resolve(controller.getSnapshot());
  return new Promise(resolve => {
    const unsubscribe = controller.subscribe(() => {
      const snapshot = controller.getSnapshot();
      if (predicate(snapshot)) { unsubscribe(); resolve(snapshot); }
    });
  });
}
const ids = entries => entries.map(entry => entry.id);
const labels = entries => entries.flatMap(entry => entry.model?.filter(message => message.role === 'user').map(message => message.content) ?? []);

test('native reset keeps an explicit archived page while active view remains the current head', { timeout: 10000 }, async t => {
  const f = await fixture(t);
  await write(f.conversation, 'Fictional first');
  await write(f.conversation, 'Fictional second');
  const before = await f.conversation.context(context);
  await f.conversation.reset('Fictional handoff', context);
  const controller = f.controller();
  await controller.connect();
  const active = controller.getSnapshot().view;
  assert.ok(active.entries.some(entry => entry.kind === 'pi.reset'));
  assert.ok(!labels(active.entries).includes('Fictional first'));
  await controller.loadEarlier();
  const history = controller.getSnapshot().history;
  assert.equal(history.kind, 'ready');
  assert.ok(labels(history.entries).includes('Fictional first'));
  assert.ok(labels(history.entries).includes('Fictional second'));
  assert.ok(history.entries.some(entry => entry.kind === 'pi.reset'));
  assert.deepEqual(ids(history.entries), [...ids(history.entries)].sort((a, b) => a - b));
  assert.deepEqual(ids(controller.getSnapshot().view.entries), ids(active.entries));
  assert.ok(before.entries.every(entry => history.entries.some(archived => archived.id === entry.id)));
  controller.clearHistory();
  assert.equal(controller.getSnapshot().history.kind, 'idle');
  assert.deepEqual(ids(controller.getSnapshot().view.entries), ids(active.entries));
});

test('an empty active conversation returns an exhausted empty history without a native scan', async t => {
  const f = await fixture(t); let scans = 0;
  const controller = f.controller({ history: { id: f.conversation.id, entries: (...args) => {
    scans++; return f.conversation.entries(...args);
  } } });
  await controller.connect();
  assert.deepEqual(controller.getSnapshot().view.entries, []);
  await controller.loadEarlier();
  assert.deepEqual(controller.getSnapshot().history, { kind: 'ready', entries: [], hasMore: false });
  await controller.loadEarlier();
  assert.equal(scans, 0);
});

test('one native page stays bounded and its opaque cursor and inclusive head bound survive new writes', { timeout: 20000 }, async t => {
  const f = await fixture(t);
  for (let index = 0; index < 90; index++) await write(f.conversation, `Fictional entry ${index}`);
  const requests = [], history = { id: f.conversation.id, entries: (...args) => {
    requests.push(args); return f.conversation.entries(...args);
  } };
  const controller = f.controller({ history });
  await controller.connect();
  const activeIds = ids(controller.getSnapshot().view.entries);
  await controller.loadEarlier();
  const first = controller.getSnapshot().history;
  assert.equal(first.kind, 'ready');
  assert.equal(first.entries.length, 40);
  assert.equal(first.hasMore, true);
  assert.deepEqual(ids(first.entries), [...ids(first.entries)].sort((a, b) => a - b));
  assert.equal(requests[0][0].maxEntryId, Math.max(...activeIds));
  assert.equal(requests[0][1], 40);
  assert.equal(requests[0][3], context);
  await write(f.conversation, 'Fictional late append');
  await observe(controller, state => state.view?.entries.some(entry => entry.model?.some(message => message.content === 'Fictional late append')));
  await controller.loadEarlier();
  const second = controller.getSnapshot().history;
  assert.equal(second.entries.length, 40);
  assert.equal(second.hasMore, true);
  assert.equal(requests[1][0].maxEntryId, requests[0][0].maxEntryId);
  assert.deepEqual(requests[1][2], (await f.conversation.entries(requests[0][0], 40, undefined, context)).next);
  assert.ok(!labels(second.entries).includes('Fictional late append'));
  assert.ok(Math.max(...ids(second.entries)) < Math.min(...ids(first.entries)));
  await controller.loadEarlier();
  const third = controller.getSnapshot().history;
  assert.equal(third.kind, 'ready');
  assert.ok(third.entries.length > 0 && third.entries.length <= 40);
  assert.equal(third.hasMore, false);
  assert.equal(requests[2][0].maxEntryId, requests[0][0].maxEntryId);
  assert.ok(Math.max(...ids(third.entries)) < Math.min(...ids(second.entries)));
  assert.ok(labels(controller.getSnapshot().view.entries).includes('Fictional late append'));
});

test('native paging failure retains the last page and retries the identical bound and cursor', { timeout: 15000 }, async t => {
  const f = await fixture(t);
  for (let index = 0; index < 50; index++) await write(f.conversation, `Fictional entry ${index}`);
  const requests = []; let fail = true;
  const controller = f.controller({ history: { id: f.conversation.id, entries: async (...args) => {
    requests.push(args);
    if (requests.length === 2 && fail) { fail = false; throw new Error('Fictional transient history failure'); }
    return f.conversation.entries(...args);
  } } });
  await controller.connect();
  await controller.loadEarlier();
  const first = controller.getSnapshot().history;
  assert.equal(first.kind, 'ready'); assert.equal(first.entries.length, 40);
  await controller.loadEarlier();
  const failed = controller.getSnapshot().history;
  assert.equal(failed.kind, 'error');
  assert.deepEqual(ids(failed.entries), ids(first.entries));
  assert.equal(failed.hasMore, true);
  await controller.loadEarlier();
  const retried = controller.getSnapshot().history;
  assert.equal(retried.kind, 'ready');
  assert.equal(retried.entries.length, 10);
  assert.deepEqual(requests[2][0], requests[1][0]);
  assert.deepEqual(requests[2][2], requests[1][2]);
  assert.equal(requests[2][3], context);
});

test('a fork accepts inherited parent-owned records through the public native history capability', { timeout: 10000 }, async t => {
  const f = await fixture(t);
  await write(f.conversation, 'Fictional inherited first');
  await write(f.conversation, 'Fictional inherited second');
  const parent = await f.conversation.context(context);
  const fork = await f.conversation.fork(parent.entries.at(-1).id, { ownership: { kind: 'ownerless' } }, context);
  const controller = f.controller({ conversation: fork, history: nativeHistory(fork) });
  await controller.connect();
  await controller.loadEarlier();
  const history = controller.getSnapshot().history;
  assert.equal(history.kind, 'ready');
  assert.ok(history.entries.length > 0);
  assert.ok(history.entries.some(entry => entry.conversationId === f.conversation.id && entry.conversationId !== fork.id));
  assert.ok(labels(history.entries).includes('Fictional inherited first'));
});

test('custom source requires explicit matching history capability and does not borrow more access implicitly', { timeout: 10000 }, async t => {
  const f = await fixture(t); await write(f.conversation, 'Fictional private archive');
  let reads = 0;
  const wrapped = { id: f.conversation.id, entries: (...args) => { reads++; return f.conversation.entries(...args); } };
  const source = { open: () => f.conversation.watch(context) };
  const privateView = f.controller({ source });
  await privateView.connect();
  assert.equal(privateView.getSnapshot().history.kind, 'disabled');
  assert.throws(() => privateView.loadEarlier(), /not enabled/);
  assert.equal(reads, 0);
  const explicit = f.controller({ source, history: wrapped });
  await explicit.connect(); await explicit.loadEarlier();
  assert.equal(explicit.getSnapshot().history.kind, 'ready');
  assert.equal(reads, 1);
  assert.throws(() => f.controller({ source, history: { ...wrapped, id: -1 } }));
});

test('a capability identity changed during a delayed native page cannot disclose its entries', { timeout: 10000 }, async t => {
  const f = await fixture(t); await write(f.conversation, 'Fictional protected history');
  const entered = deferred(), release = deferred();
  const capability = { id: f.conversation.id, entries: async (...args) => {
    entered.resolve(); await release.promise; return f.conversation.entries(...args);
  } };
  const controller = f.controller({ history: capability });
  await controller.connect();
  const active = controller.getSnapshot().view;
  const pending = controller.loadEarlier();
  await entered.promise;
  capability.id = -1;
  release.resolve();
  await pending;
  assert.equal(controller.getSnapshot().history.kind, 'error');
  assert.deepEqual(controller.getSnapshot().history.entries, []);
  assert.deepEqual(ids(controller.getSnapshot().view.entries), ids(active.entries));
});

test('a loading subscriber can clear history before the queued native read dispatches', { timeout: 10000 }, async t => {
  const f = await fixture(t); await write(f.conversation, 'Fictional unread history');
  let reads = 0, cleared = false;
  const controller = f.controller({ history: { id: f.conversation.id, entries: (...args) => {
    reads++; return f.conversation.entries(...args);
  } } });
  await controller.connect();
  controller.subscribe(() => {
    if (controller.getSnapshot().history.kind === 'loading' && !cleared) {
      cleared = true; controller.clearHistory();
    }
  });
  await controller.loadEarlier();
  assert.equal(cleared, true);
  assert.equal(reads, 0);
  assert.equal(controller.getSnapshot().history.kind, 'idle');
});

test('overlapping loads coalesce; stale result after clear, head change or disposal cannot replace current view', { timeout: 15000 }, async t => {
  const f = await fixture(t); await write(f.conversation, 'Fictional before reset');
  const gates = [], requested = [], entered = [deferred(), deferred(), deferred()];
  const controller = f.controller({ history: { id: f.conversation.id, entries: (...args) => {
    const gate = deferred(); gates.push(gate); requested.push(args); entered[gates.length - 1]?.resolve();
    return gate.promise;
  } } });
  await controller.connect();
  const first = controller.loadEarlier(), repeated = controller.loadEarlier();
  assert.equal(first, repeated);
  await entered[0].promise;
  assert.equal(gates.length, 1);
  controller.clearHistory();
  gates[0].resolve(await f.conversation.entries(...requested[0]));
  await first;
  assert.equal(controller.getSnapshot().history.kind, 'idle');

  const second = controller.loadEarlier();
  await entered[1].promise;
  assert.equal(gates.length, 2);
  const previousHeadId = controller.getSnapshot().view?.entries[0]?.id;
  const changed = observe(controller, state => state.view?.entries[0]?.id !== previousHeadId);
  await f.conversation.reset('Fictional new head', context);
  await changed;
  gates[1].resolve(await f.conversation.entries(...requested[1]));
  await second;
  assert.notEqual(controller.getSnapshot().history.kind, 'ready');

  const third = controller.loadEarlier();
  await entered[2].promise;
  assert.equal(gates.length, 3);
  const disposing = controller.dispose();
  gates[2].resolve(await f.conversation.entries(...requested[2]));
  await third; await disposing;
  assert.equal(controller.getSnapshot().disposed, true);
  assert.notEqual(controller.getSnapshot().history.kind, 'ready');
});

test('repeated, oversized and duplicate native pages refuse instead of looping or rendering more than 40', { timeout: 10000 }, async t => {
  const f = await fixture(t); await write(f.conversation, 'Fictional first'); await write(f.conversation, 'Fictional second');
  const real = await f.conversation.entries({}, 40, undefined, context);
  for (const page of [
    { items: [real.items[0], real.items[0]], next: { cursor: 'duplicate' } },
    { items: Array.from({ length: 41 }, () => real.items[0]), next: { cursor: 'oversized' } },
  ]) {
    const controller = f.controller({ history: { id: f.conversation.id, entries: async () => page } });
    await controller.connect(); await controller.loadEarlier();
    assert.equal(controller.getSnapshot().history.kind, 'error');
    assert.ok(controller.getSnapshot().history.entries.length <= 40);
  }
  let calls = 0;
  const repeated = f.controller({ history: { id: f.conversation.id, entries: async () => {
    calls++;
    return { items: real.items, next: { opaque: 'same-page' } };
  } } });
  await repeated.connect();
  await repeated.loadEarlier();
  const first = repeated.getSnapshot().history;
  assert.equal(first.kind, 'ready');
  await repeated.loadEarlier();
  assert.equal(repeated.getSnapshot().history.kind, 'error');
  assert.deepEqual(ids(repeated.getSnapshot().history.entries), ids(first.entries));
  assert.equal(calls, 2);
});
