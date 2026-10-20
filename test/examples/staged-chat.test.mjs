import assert from 'node:assert/strict';
import test from 'node:test';
const { createStagedHost } = await import(process.env.STAGED_HOST_MODULE ?? new URL('../../examples/staged-chat/host.mjs', import.meta.url).href);
const { createNativeChatController } = await import(process.env.NATIVE_CHAT_MODULE ?? '@hachej/boring-ui-kit/native-chat');

for (const failAt of [0, 1, 2]) test(`fictional triage host runs native sequential validated stages (failure ${failAt})`, { timeout: 20000 }, async t => {
  const host = await createStagedHost(); t.after(() => host.close());
  const conversation = host.threads.Questions;
  const controller = createNativeChatController({ conversation, context: host.context, identity: { runtimeId: 'fictional-triage', scopeId: 'Questions', principalId: 'fictional-reader' }, restoreOnError: true });
  t.after(() => controller.dispose()); await controller.connect();
  const question = 'Quelle dose pour un adulte ?';
  const submission = await controller.send('followUp', { text: `${question}${failAt ? `\nÉCHEC ${failAt}` : ''}`, restore: { text: question } });
  const settled = await submission.wait(host.context); await conversation.waitForIdle(host.context);
  const view = await conversation.context(host.context);
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
