import assert from 'node:assert/strict';
import test from 'node:test';
import { Harness, MemoryStorage, createRegistry } from '@earendil-works/pi-durable';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import { createNativeChatController } from '@hachej/boring-ui-kit/native-chat';
import { createFakeChatModel } from '@hachej/boring-testing/model';

const identity = { runtimeId: 'fictional-runtime', scopeId: 'fictional-scope', principalId: 'fictional-person' };
const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aJ1sAAAAASUVORK5CYII=';
function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }
function boundary(conversation, overrides) {
  return new Proxy(conversation, { get: (target, key) => {
    if (Object.hasOwn(overrides, key)) return overrides[key];
    const value = Reflect.get(target, key); return typeof value === 'function' ? value.bind(target) : value;
  } });
}
async function fixture(t) {
  const fake = createFakeChatModel();
  const harness = await Harness.open(new MemoryStorage(), { registry: createRegistry(), models: fake.models }, context);
  const conversation = await harness.createConversation({ ownership: { kind: 'ownerless' }, agent: { model: fake.model } }, context);
  const controllers = [];
  t.after(async () => { for (const controller of controllers) await controller.dispose(); await harness.close(context); });
  return { fake, harness, conversation, controller: options => {
    const controller = createNativeChatController({ identity, context, conversation, ...options }); controllers.push(controller); return controller;
  } };
}
async function transcript(conversation) {
  return (await conversation.context(context)).entries.flatMap(entry => entry.model ?? []);
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
const userContent = messages => messages.filter(message => message.role === 'user').map(message => message.content);

test('native chat submits the selected immutable draft and preserves edits made during validation', { timeout: 10000 }, async t => {
  const f = await fixture(t), gate = deferred(); let selected;
  const controller = f.controller({ beforeSubmit: value => { selected = value; return gate.promise; } });
  const attachment = { id: 'fictional-image', name: 'fixture.png', content: { type: 'image', data: png, mimeType: 'image/png' } };
  controller.setText('Selected message'); controller.setAttachments([attachment]);
  const sending = controller.send();
  assert.equal(controller.getSnapshot().send.kind, 'validating');
  controller.setText('Late draft'); controller.setAttachments([]); attachment.content.data = 'changed outside controller';
  assert.equal(selected.text, 'Selected message'); assert.equal(selected.attachments[0].content.data, png);
  gate.resolve(undefined);
  const submission = await sending;
  assert.ok(submission); assert.equal(controller.getSnapshot().send.kind, 'admitted');
  assert.equal(controller.getSnapshot().draft.text, 'Late draft');
  assert.deepEqual(controller.getSnapshot().draft.attachments, []);
  const call = await f.fake.nextCall();
  assert.deepEqual(userContent(call.transcript.messages), [[{ type: 'text', text: 'Selected message' }, { type: 'image', data: png, mimeType: 'image/png' }]]);
  call.respond('Fictional response'); await submission.wait(context); await f.conversation.waitForIdle(context);
  assert.equal((await transcript(f.conversation)).find(message => message.role === 'assistant').content[0].text, 'Fictional response');
});

test('native chat validation refusal admits no input and retains the draft', { timeout: 10000 }, async t => {
  const f = await fixture(t); const controller = f.controller({ beforeSubmit: async () => 'Selected document could not flush' });
  controller.setText('Keep this draft');
  assert.equal(await controller.send(), undefined);
  assert.deepEqual(controller.getSnapshot().send, { kind: 'blocked', reason: 'Selected document could not flush' });
  assert.equal(controller.getSnapshot().draft.text, 'Keep this draft');
  assert.deepEqual(userContent(await transcript(f.conversation)), []); assert.equal(f.fake.calls.length, 0);
});

test('lost acknowledgement reconciles the native request without duplicate admission or lost late edits', { timeout: 10000 }, async t => {
  const f = await fixture(t); const submitted = []; let original;
  const wrapped = boundary(f.conversation, { submit: async (draft, ctx) => {
    submitted.push(structuredClone(draft)); original = await f.conversation.submit(draft, ctx); throw new Error('Fictional acknowledgement lost');
  } });
  const controller = f.controller({ conversation: wrapped }); controller.setText('Original selected input');
  assert.equal(await controller.send(), undefined); assert.equal(controller.getSnapshot().send.kind, 'unknown');
  controller.setText('Late unsent input');
  await assert.rejects(controller.send(), /Reconcile/);
  const record = await controller.reconcile();
  assert.equal(record.id, original.id); assert.equal(record.requestId, submitted[0].requestId);
  assert.equal(controller.getSnapshot().send.kind, 'admitted');
  assert.equal(controller.getSnapshot().draft.text, 'Late unsent input'); assert.equal(submitted.length, 1);
  const call = await f.fake.nextCall(); call.respond('Acknowledged by lookup');
  await original.wait(context); await f.conversation.waitForIdle(context);
  assert.deepEqual(userContent(await transcript(f.conversation)), ['Original selected input']); assert.equal(f.fake.calls.length, 1);
});

test('retry after a lost acknowledgement reuses the exact native request and original content', { timeout: 10000 }, async t => {
  const f = await fixture(t), submitted = []; let original;
  const wrapped = boundary(f.conversation, { submit: async (draft, ctx) => {
    submitted.push(structuredClone(draft)); const value = await f.conversation.submit(draft, ctx);
    if (submitted.length === 1) { original = value; throw new Error('Fictional acknowledgement lost'); }
    return value;
  } });
  const controller = f.controller({ conversation: wrapped }); controller.setText('Captured input');
  await controller.send('steer'); controller.setText('New unsent input');
  const retried = await controller.retrySameRequest();
  assert.equal(retried.id, original.id); assert.deepEqual(submitted[1], submitted[0]);
  assert.equal(submitted[1].whenBusy, 'steer'); assert.equal(submitted[1].content, 'Captured input');
  assert.equal(controller.getSnapshot().draft.text, 'New unsent input');
  const call = await f.fake.nextCall(); call.respond('Only one generation'); await retried.wait(context); await f.conversation.waitForIdle(context);
  assert.deepEqual(userContent(await transcript(f.conversation)), ['Captured input']); assert.equal(f.fake.calls.length, 1);
});

test('an uncertain pre-admission failure retains one request until an explicit retry', { timeout: 10000 }, async t => {
  const f = await fixture(t), submitted = [];
  const wrapped = boundary(f.conversation, { submit: async (draft, ctx) => {
    submitted.push(structuredClone(draft)); if (submitted.length === 1) throw new Error('Fictional connection failed before call');
    return f.conversation.submit(draft, ctx);
  } });
  const controller = f.controller({ conversation: wrapped }); controller.setText('Retry this selection');
  await controller.send(); assert.equal(await controller.reconcile(), undefined); assert.equal(controller.getSnapshot().send.kind, 'unknown');
  controller.setText('Different unsent draft'); const retried = await controller.retrySameRequest();
  assert.deepEqual(submitted[1], submitted[0]);
  const call = await f.fake.nextCall(); call.respond('Admitted on retry'); await retried.wait(context); await f.conversation.waitForIdle(context);
  assert.deepEqual(userContent(await transcript(f.conversation)), ['Retry this selection']);
  assert.equal(controller.getSnapshot().draft.text, 'Different unsent draft');
});

test('multiple subscribers share one native watch; disposing a viewer preserves the task and another viewer', { timeout: 10000 }, async t => {
  const f = await fixture(t); let opens = 0;
  const source = { open: () => { opens++; return f.conversation.watch(context); } };
  const first = f.controller({ source }), second = f.controller();
  const unsubscribeA = first.subscribe(() => {}), unsubscribeB = first.subscribe(() => {});
  await Promise.all([first.connect(), first.connect(), second.connect()]); assert.equal(opens, 1);
  first.setText('A task survives the first viewer'); const submission = await first.send(); const call = await f.fake.nextCall();
  await first.dispose(); unsubscribeA(); unsubscribeB();
  assert.equal(call.signal.aborted, false); assert.equal(first.getSnapshot().disposed, true);
  const observed = observe(second, state => state.view?.entries.some(entry => entry.model?.some(message => message.role === 'assistant' && message.content.some(item => item.type === 'text' && item.text === 'Still running'))));
  call.respond('Still running'); await submission.wait(context); await f.conversation.waitForIdle(context); await observed;
  assert.equal(second.getSnapshot().connection.kind, 'connected');
  second.setText('The borrowed Harness still works'); const next = await second.send();
  (await f.fake.nextCall()).respond('Second real native run'); await next.wait(context); await f.conversation.waitForIdle(context);
  assert.equal(f.fake.calls.length, 2);
});

test('stop reports intent until the native abort finishes and confirms the ordinary scope is idle', { timeout: 10000 }, async t => {
  const f = await fixture(t), gate = deferred(); let abortCalls = 0;
  const wrapped = boundary(f.conversation, { abort: async ctx => { abortCalls++; await gate.promise; await f.conversation.abort(ctx); } });
  const controller = f.controller({ conversation: wrapped }); controller.setText('Wait for stop'); await controller.send();
  const call = await f.fake.nextCall(); const stopping = controller.stop(); const repeated = controller.stop();
  assert.equal(controller.getSnapshot().stop, 'requested'); assert.equal(call.signal.aborted, false);
  gate.resolve(); await stopping; await repeated; await call.aborted;
  assert.equal(abortCalls, 1); assert.equal(controller.getSnapshot().stop, 'confirmed');
  await f.conversation.waitForIdle(context); assert.equal(call.signal.aborted, true);
});

test('a failed stop acknowledgement remains unconfirmed and does not invent cancellation', { timeout: 10000 }, async t => {
  const f = await fixture(t);
  const wrapped = boundary(f.conversation, { abort: async () => { throw new Error('Fictional stop transport failed'); } });
  const controller = f.controller({ conversation: wrapped }); controller.setText('Still active'); const submission = await controller.send();
  const call = await f.fake.nextCall(); await assert.rejects(controller.stop(), /stop transport failed/);
  assert.equal(controller.getSnapshot().stop, 'unconfirmed'); assert.equal(call.signal.aborted, false);
  call.respond('Completed after uncertain stop'); await submission.wait(context); await f.conversation.waitForIdle(context);
});

test('late native acknowledgement cannot clear text entered while submission is in flight', { timeout: 10000 }, async t => {
  const f = await fixture(t), acknowledgement = deferred(), admitted = deferred();
  const wrapped = boundary(f.conversation, { submit: async (draft, ctx) => {
    const submission = await f.conversation.submit(draft, ctx); admitted.resolve(); await acknowledgement.promise; return submission;
  } });
  const controller = f.controller({ conversation: wrapped }); controller.setText('Sent selection');
  const sending = controller.send(); await admitted.promise;
  assert.equal(controller.getSnapshot().send.kind, 'submitting'); controller.setText('Typed before acknowledgement');
  acknowledgement.resolve(); const submission = await sending;
  assert.equal(controller.getSnapshot().send.kind, 'admitted'); assert.equal(controller.getSnapshot().draft.text, 'Typed before acknowledgement');
  const call = await f.fake.nextCall(); assert.deepEqual(userContent(call.transcript.messages), ['Sent selection']);
  call.respond('Late acknowledgement fixture'); await submission.wait(context); await f.conversation.waitForIdle(context);
});

test('disposal releases a watch acquired late without aborting its native conversation', { timeout: 10000 }, async t => {
  const f = await fixture(t), acquired = deferred(), releaseOpen = deferred(); let stops = 0;
  const controller = f.controller({ source: { open: async () => {
    const watch = await f.conversation.watch(context); acquired.resolve(); await releaseOpen.promise;
    return boundary(watch, { stop: () => { stops++; return watch.stop(); } });
  } } });
  controller.setText('Run while a watch opens'); const submission = await controller.send(); const call = await f.fake.nextCall();
  const opening = controller.connect(); await acquired.promise;
  const disposing = controller.dispose(); releaseOpen.resolve(); await opening; await disposing;
  assert.equal(stops, 1); assert.equal(controller.getSnapshot().disposed, true); assert.equal(call.signal.aborted, false);
  call.respond('Finished after late watch cleanup'); await submission.wait(context); await f.conversation.waitForIdle(context);
});

test('reentrant disposal shares one cleanup promise and closes its native watch once', { timeout: 10000 }, async t => {
  const f = await fixture(t); let stops = 0, reentered = false, reentrantDisposal;
  const controller = f.controller({ source: { open: async () => {
    const watch = await f.conversation.watch(context);
    return boundary(watch, { stop: () => { stops++; return watch.stop(); } });
  } } });
  await controller.connect();
  controller.subscribe(() => {
    if (controller.getSnapshot().disposed && !reentered) { reentered = true; reentrantDisposal = controller.dispose(); }
  });
  const disposal = controller.dispose();
  assert.equal(reentrantDisposal, disposal); await disposal; assert.equal(stops, 1);
});

test('uncertain retries revalidate the captured draft and retain the original request after refusal', { timeout: 10000 }, async t => {
  const f = await fixture(t), submitted = [], validated = []; let denial;
  const controller = f.controller({ beforeSubmit: async selected => { validated.push(selected.text); return denial; },
    conversation: boundary(f.conversation, { submit: async (draft, ctx) => {
      submitted.push(structuredClone(draft));
      if (submitted.length === 1) throw new Error('Fictional failure before admission');
      return f.conversation.submit(draft, ctx);
    } }) });
  controller.setText('Selected original'); await controller.send(); controller.setText('Later unsent text');
  const requestId = controller.getSnapshot().send.attempt.requestId;
  denial = 'Selected resource is no longer writable';
  await assert.rejects(controller.retrySameRequest(), /no longer writable/);
  assert.equal(submitted.length, 1); assert.equal(controller.getSnapshot().send.kind, 'unknown');
  assert.equal(controller.getSnapshot().send.attempt.requestId, requestId);
  assert.equal(controller.getSnapshot().draft.text, 'Later unsent text');
  denial = undefined;
  const first = controller.retrySameRequest(), second = controller.retrySameRequest();
  assert.equal(first, second);
  const admission = await first;
  assert.deepEqual(submitted[0], submitted[1]);
  assert.deepEqual(validated, ['Selected original', 'Selected original', 'Selected original']);
  (await f.fake.nextCall()).respond('Admitted with the original identity');
  await admission.wait(context); await f.conversation.waitForIdle(context);
  assert.deepEqual(userContent(await transcript(f.conversation)), ['Selected original']);
});

test('a listener disposing at submission intent prevents a new native admission', { timeout: 10000 }, async t => {
  const f = await fixture(t); const controller = f.controller();
  controller.setText('Do not admit after disposal');
  controller.subscribe(() => { if (controller.getSnapshot().send.kind === 'submitting') void controller.dispose(); });
  assert.equal(await controller.send(), undefined); await controller.dispose();
  assert.equal(controller.getSnapshot().disposed, true);
  assert.equal(f.fake.calls.length, 0); assert.deepEqual(userContent(await transcript(f.conversation)), []);
});

test('late validation refusal does not change a disposed presentation or admit native work', { timeout: 10000 }, async t => {
  for (const reject of [false, true]) {
    const f = await fixture(t), gate = deferred();
    const controller = f.controller({ beforeSubmit: async () => { await gate.promise; if (reject) throw new Error('Fictional validation error'); return 'Fictional validation refusal'; } });
    controller.setText('Draft at teardown'); const sending = controller.send();
    await controller.dispose(); const disposed = controller.getSnapshot();
    gate.resolve(); await sending;
    assert.equal(controller.getSnapshot(), disposed);
    assert.deepEqual(userContent(await transcript(f.conversation)), []); assert.equal(f.fake.calls.length, 0);
  }
});
