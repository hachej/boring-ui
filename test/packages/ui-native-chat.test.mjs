import assert from 'node:assert/strict';
import test from 'node:test';
import { Harness, MemoryStorage, createRegistry } from '@earendil-works/pi-durable';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
const { createNativeChatController } = await import(process.env.NATIVE_CHAT_MODULE ?? '@hachej/boring-ui-kit/native-chat');
import { createFakeChatModel, createScriptedModel } from '@hachej/boring-testing/model';

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

async function errorFixture(t, turns, options = {}) {
  const scripted = createScriptedModel({ generic: [{ match: /[\s\S]*/, turns: () => turns }] });
  const harness = await Harness.open(new MemoryStorage(), { registry: createRegistry(), models: scripted.models }, context);
  const conversation = await harness.createConversation({ ownership: { kind: 'ownerless' }, agent: { model: scripted.model } }, context);
  const { wrap, ...nativeOptions } = options;
  const controller = createNativeChatController({ identity, context, conversation: wrap ? wrap(conversation) : conversation, ...nativeOptions });
  t.after(async () => { await controller.dispose(); await harness.close(context); });
  await controller.connect();
  return { harness, conversation, controller };
}

test('opt-in native restoration returns an empty failed question with its restore payload ahead of late typing', { timeout: 10000 }, async t => {
  const f = await errorFixture(t, [{ error: 'Fictional first-stage failure', delay: 40 }], { restoreOnError: true });
  const image = { id: 'restore-image', name: 'fictional.png', content: { type: 'image', data: png, mimeType: 'image/png' } };
  f.controller.setText('Quelle dose pour un adulte ?');
  const submission = await f.controller.send('followUp', { text: 'Quelle dose pour un adulte ?\nPrivate fictional context', restore: { text: 'Quelle dose pour un adulte ?', attachments: [image] } });
  f.controller.setText('Brouillon suivant');
  const restored = observe(f.controller, state => state.draft.text.startsWith('Quelle dose pour un adulte ?'));
  assert.equal((await submission.wait(context)).status, 'unanswered');
  await Promise.race([restored, new Promise(resolve => setTimeout(resolve, 3000))]);
  assert.equal(f.controller.getSnapshot().draft.text, 'Quelle dose pour un adulte ?\nBrouillon suivant');
  assert.equal(f.controller.getSnapshot().draft.attachments[0].content.data, png);
  assert.equal(f.controller.getSnapshot().send.kind, 'admitted', 'restoration is not a retry or admission failure');
  assert.equal(userContent(await transcript(f.conversation)).length, 1);
});

test('restoration stays opt-in and never restores after answer text, cancellation, or disposal', { timeout: 10000 }, async t => {
  const disabled = await errorFixture(t, [{ error: 'Fictional failure' }]);
  disabled.controller.setText('Do not restore by default'); const first = await disabled.controller.send(); await first.wait(context); await disabled.conversation.waitForIdle(context);
  assert.equal(disabled.controller.getSnapshot().draft.text, '');
  const partial = await errorFixture(t, [{ text: 'Earlier stage remains.', tools: [{ name: 'fictional_missing_tool', args: {} }] }, { error: 'Fictional later stage failed' }], { restoreOnError: true });
  partial.controller.setText('Keep the earlier answer'); const second = await partial.controller.send(); await second.wait(context); await partial.conversation.waitForIdle(context);
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(partial.controller.getSnapshot().draft.text, '');
  assert.ok((await transcript(partial.conversation)).some(message => message.role === 'assistant' && message.content.some(part => part.type === 'text' && part.text === 'Earlier stage remains.')));
  const cancelled = await errorFixture(t, [{ text: 'Too late', delay: 500 }], { restoreOnError: true });
  cancelled.controller.setText('Cancelled question'); const third = await cancelled.controller.send(); await cancelled.controller.stop(); await third.wait(context);
  assert.equal(cancelled.controller.getSnapshot().draft.text, '');
  const disposed = await errorFixture(t, [{ error: 'Fictional delayed failure', delay: 40 }], { restoreOnError: true });
  disposed.controller.setText('Closed viewer'); const fourth = await disposed.controller.send(); await disposed.controller.dispose(); const before = disposed.controller.getSnapshot(); await fourth.wait(context);
  assert.equal(disposed.controller.getSnapshot(), before);
});

test('restoration bounds its transcript read before a later independent answer', { timeout: 10000 }, async t => {
  const reading = deferred(), release = deferred(); let held = false;
  const f = await errorFixture(t, [turn => turn.user === 'Later input' ? 'Unrelated later answer' : { error: 'Fictional first-stage failure' }], { restoreOnError: true,
    wrap: conversation => boundary(conversation, { entries: async (...args) => {
      if (args[0].minEntryId !== undefined && !held) { held = true; reading.resolve(); await release.promise; }
      return conversation.entries(...args);
    } }) });
  f.controller.setText('Restore only this question'); const first = await f.controller.send(); await first.wait(context);
  await Promise.race([reading.promise, new Promise(resolve => setTimeout(resolve, 3000))]);
  assert.equal(held, true, 'restoration checks the failed input’s native transcript');
  f.controller.setText('Later input'); const second = await f.controller.send(); await second.wait(context); await f.conversation.waitForIdle(context);
  release.resolve(); await new Promise(resolve => setTimeout(resolve, 50));
  assert.equal(f.controller.getSnapshot().draft.text, 'Restore only this question', 'a later answer cannot suppress restoration of the earlier empty failure');
});

test('concurrent recovery observes a failed native request only once', { timeout: 10000 }, async t => {
  const lookupStarted = deferred(), releaseLookup = deferred(), retryStarted = deferred(), releaseAck = deferred();
  let original, submits = 0, lookups = 0;
  const f = await errorFixture(t, [{ error: 'Fictional empty failure' }], { restoreOnError: true,
    wrap: conversation => boundary(conversation, {
      submit: async (draft, ctx) => {
        submits++; const submission = await conversation.submit(draft, ctx);
        if (submits === 1) { original = submission; throw new Error('Fictional acknowledgement lost'); }
        retryStarted.resolve(); await releaseAck.promise; return submission;
      },
      commit: async (change, ctx) => { if (++lookups === 1) { lookupStarted.resolve(); await releaseLookup.promise; } return conversation.commit(change, ctx); },
    }) });
  f.controller.setText('Restore this question once'); await f.controller.send(); await original.wait(context);
  const reconciled = f.controller.reconcile(); await lookupStarted.promise;
  const retried = f.controller.retrySameRequest(); await retryStarted.promise;
  const restored = observe(f.controller, state => state.draft.text === 'Restore this question once');
  releaseLookup.resolve(); await reconciled; await restored;
  await new Promise(resolve => setTimeout(resolve, 30));
  releaseAck.resolve(); await retried; await new Promise(resolve => setTimeout(resolve, 100));
  assert.equal(f.controller.getSnapshot().draft.text, 'Restore this question once');
  assert.equal(submits, 2); assert.equal(userContent(await transcript(f.conversation)).length, 1);
});

test('late acknowledgements cannot mutate a disposed controller or abort its native work', { timeout: 10000 }, async t => {
  for (const lost of [false, true]) {
    const f = await fixture(t), admitted = deferred(), release = deferred(); let original;
    const controller = f.controller({ restoreOnError: true, conversation: boundary(f.conversation, { submit: async (draft, ctx) => {
      original = await f.conversation.submit(draft, ctx); admitted.resolve(); await release.promise;
      if (lost) throw new Error('Fictional acknowledgement lost after disposal');
      return original;
    } }) });
    controller.setText('Fictional delayed acknowledgement'); const sending = controller.send(); await admitted.promise;
    const call = await f.fake.nextCall(); await controller.dispose(); const disposed = controller.getSnapshot();
    release.resolve(); await sending;
    assert.equal(controller.getSnapshot(), disposed); assert.equal(call.signal.aborted, false);
    call.respond('Native work still finishes'); await original.wait(context); await f.conversation.waitForIdle(context);
  }
});

test('hidden marker text still prevents native restoration', { timeout: 10000 }, async t => {
  const f = await errorFixture(t, [{ text: '::meta {"fictional":true}', tools: [{ name: 'fictional_missing_tool', args: {} }] }, { error: 'Fictional later failure' }], { restoreOnError: true });
  f.controller.setText('Question with native text'); const submission = await f.controller.send(); await submission.wait(context); await f.conversation.waitForIdle(context);
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(f.controller.getSnapshot().draft.text, '', 'presentation filtering cannot redefine whether native answer text exists');
});

test('restoration reconciles a lost native acknowledgement without replaying the request', { timeout: 10000 }, async t => {
  let original, submits = 0;
  const f = await errorFixture(t, [{ error: 'Fictional first-stage error', delay: 60 }], { restoreOnError: true,
    wrap: conversation => boundary(conversation, { submit: async (draft, ctx) => { submits++; original = await conversation.submit(draft, ctx); throw new Error('Fictional acknowledgement lost'); } }) });
  f.controller.setText('Restore the original question'); await f.controller.send();
  assert.equal(f.controller.getSnapshot().send.kind, 'unknown');
  f.controller.setText('Later question'); await f.controller.reconcile();
  const restored = observe(f.controller, state => state.draft.text.startsWith('Restore the original question'));
  await original.wait(context); await Promise.race([restored, new Promise(resolve => setTimeout(resolve, 3000))]);
  assert.equal(f.controller.getSnapshot().draft.text, 'Restore the original question\nLater question');
  assert.equal(submits, 1);
});
