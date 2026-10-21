import assert from 'node:assert/strict';
import test from 'node:test';
import { AssistantEntry } from '@earendil-works/pi-durable';
import { fauxAssistantMessage } from '@earendil-works/pi-ai/providers/faux';
const { createStagedHost, withDemoFailure } = await import(process.env.STAGED_HOST_MODULE ?? new URL('../../examples/staged-chat/host.mjs', import.meta.url).href);
const { createNativeChatController } = await import(process.env.NATIVE_CHAT_MODULE ?? '@hachej/boring-ui-kit/native-chat');

for (const failAt of [0, 1, 2]) test(`fictional triage host runs native sequential validated stages (failure ${failAt})`, { timeout: 20000 }, async t => {
  const host = await createStagedHost(); t.after(() => host.close());
  const conversation = host.threads.Questions;
  const controller = createNativeChatController({ conversation: withDemoFailure(conversation, () => failAt), context: host.context, identity: { runtimeId: 'fictional-triage', scopeId: 'Questions', principalId: 'fictional-reader' }, restoreOnError: true });
  t.after(() => controller.dispose()); await controller.connect();
  const question = 'Quelle dose pour un adulte ?';
  const submission = await controller.send('followUp', { text: question, restore: { text: question } });
  const settled = await submission.wait(host.context); await conversation.waitForIdle(host.context);
  const view = await conversation.context(host.context);
  const input = view.entries.find(entry => entry.kind === 'fictional.triage.question');
  assert.equal(input.model[0].content, question);
  assert.equal(input.data.failAt, failAt);
  const stages = view.entries.filter(entry => entry.kind === 'fictional.triage.stage');
  assert.deepEqual(stages.map(entry => [entry.data.stage, entry.data.state]), failAt === 0 ? [[1, 'running'], [1, 'validated'], [2, 'running'], [2, 'validated'], [3, 'running'], [3, 'validated']] : failAt === 1 ? [[1, 'running'], [1, 'failed']] : [[1, 'running'], [1, 'validated'], [2, 'running'], [2, 'failed']]);
  assert.equal(new Set(stages.map(entry => entry.data.taskId)).size, failAt || 3);
  const text = view.entries.flatMap(entry => entry.model ?? []).flatMap(message => message.role === 'assistant' ? message.content.filter(part => part.type === 'text').map(part => part.text) : []).join('\n');
  assert.equal(settled.status, failAt ? 'unanswered' : 'done');
  const coordinatorText = view.messages.flatMap(message => message.role === 'assistant' ? message.content.filter(part => part.type === 'text').map(part => part.text) : []).join('\n');
  assert.doesNotMatch(coordinatorText, /Note de triage fictive|::meta/, 'native context edits keep stage display rounds out of the coordinator’s model context');
  if (failAt === 1) {
    await new Promise(resolve => setTimeout(resolve, 30));
    assert.equal(controller.getSnapshot().draft.text, question); assert.equal(text, '');
  } else {
    assert.match(text, /Note de triage fictive/);
    assert.equal(controller.getSnapshot().draft.text, '');
    if (failAt === 2) assert.doesNotMatch(text, /Contrôle fictif/);
    else assert.match(text, /Synthèse fictive/);
  }
  assert.equal((await host.threads.Senior.context(host.context)).entries.length, 0);
});

test('coalesced native inputs share retained staged text without restoring either question', { timeout: 20000 }, async t => {
  const host = await createStagedHost({ settings: { followUpMode: 'all' } });
  const conversation = host.threads.Questions;
  let failAt = 0;
  const controller = createNativeChatController({ conversation: withDemoFailure(conversation, () => failAt), context: host.context, identity: { runtimeId: 'fictional-triage', scopeId: 'Questions', principalId: 'fictional-reader' }, restoreOnError: true });
  t.after(async () => { await controller.dispose(); await host.close(); });
  await controller.connect();
  controller.setText('Initial fictional question'); const first = await controller.send();
  controller.setText('Second fictional question'); const second = await controller.send();
  failAt = 2;
  const third = await controller.send('followUp', { text: 'Third fictional question', restore: { text: 'Third fictional question' } });
  const outcomes = await Promise.all([first.wait(host.context), second.wait(host.context), third.wait(host.context)]);
  await conversation.waitForIdle(host.context); await new Promise(resolve => setTimeout(resolve, 100));
  assert.deepEqual(outcomes.map(item => item.status), ['done', 'unanswered', 'unanswered']);
  const entries = (await conversation.context(host.context)).entries.filter(entry => entry.id > outcomes[1].entry);
  assert.ok(entries.some(entry => entry.model?.some(message => message.role === 'assistant' && message.content.some(part => part.type === 'text' && part.text.includes('Note de triage fictive')))));
  assert.equal(controller.getSnapshot().draft.text, '', 'a shared answer prevents restoration for every input of that run');
});

test('an empty interrupted-attempt entry is not the final native error boundary', { timeout: 20000 }, async t => {
  const host = await createStagedHost(), conversation = host.threads.Questions;
  const controller = createNativeChatController({ conversation: withDemoFailure(conversation, () => 2), context: host.context, identity: { runtimeId: 'fictional-triage', scopeId: 'Questions', principalId: 'fictional-reader' }, restoreOnError: true });
  t.after(async () => { await controller.dispose(); await host.close(); });
  await controller.connect();
  const submission = await controller.send('followUp', { text: 'Fictional later failure' });
  const witness = await conversation.commit(async tx => {
    const entry = await tx.appendEntry(AssistantEntry, conversation.id, { model: [fauxAssistantMessage([], { stopReason: 'aborted' })] });
    await tx.appendEntry(conversation.id, { kind: 'fictional.interrupted-attempt', edits: [{ target: entry.id, action: 'omit' }] });
    return entry.id;
  }, host.context);
  assert.equal((await submission.wait(host.context)).status, 'unanswered');
  await conversation.waitForIdle(host.context); await new Promise(resolve => setTimeout(resolve, 100));
  const text = (await conversation.context(host.context)).entries.find(entry => entry.model?.some(message => message.role === 'assistant' && message.content.some(part => part.type === 'text' && part.text.includes('Note de triage fictive'))));
  assert.ok(text && text.id > witness, 'the public native transcript contains later answer text after the empty witness');
  assert.equal(controller.getSnapshot().draft.text, '', 'an intermediate empty attempt cannot hide later answer text');
});
