import assert from 'node:assert/strict';
import test from 'node:test';
import { channelAvatarStates, createFakeChannelSource, createSharedChat } from '@hachej/boring-ui-kit/shared-chat';
import { sharedChatSeed } from '../../examples/shared-chat/seed.mjs';

test('the exported lifecycle table maps only the platform state ids; neutral has no indicator', () => {
  assert.deepEqual(channelAvatarStates, {
    building: 'working', executing: 'working', checks: 'working', asked: 'thinking',
    question: 'waiting', answer: 'waiting', review: 'waiting', preview: 'waiting',
    platform: 'blocked', fixing: 'blocked', live: 'done', declined: 'neutral',
  });
});

test('indexed step events replace the same message and survive a source history read', async t => {
  const source = createFakeChannelSource(sharedChatSeed);
  const chat = createSharedChat(source, { conversationId: 'main' }); t.after(() => chat.dispose()); await chat.connect();
  const plan = { id: 'plan', conversationId: 'main', author: 'pm', at: '2026-10-20T12:00:00Z', text: 'Plan', streaming: true };
  source.emit({ type: 'message', message: plan });
  source.emit({ type: 'step', messageId: plan.id, conversationId: 'main', index: 0, step: { label: 'Lire', status: 'running' } });
  source.emit({ type: 'step', messageId: plan.id, conversationId: 'main', index: 0, step: { label: 'Lu', detail: 'fictional detail', status: 'done' } });
  source.emit({ type: 'step', messageId: plan.id, conversationId: 'main', index: 1, step: { label: 'Vérifier', status: 'failed' } });
  const message = chat.getSnapshot().shared.messages.find(message => message.id === plan.id);
  assert.deepEqual(message.steps, [{ label: 'Lu', detail: 'fictional detail', status: 'done' }, { label: 'Vérifier', status: 'failed' }]);
  assert.equal(chat.getSnapshot().shared.messages.filter(message => message.id === plan.id).length, 1);
  assert.deepEqual((await source.history('main', { limit: 60 })).messages.find(message => message.id === plan.id).steps, message.steps);
});

test('replyTo is captured with the outbox payload, not a later composer selection', async t => {
  const source = createFakeChannelSource(sharedChatSeed);
  const chat = createSharedChat(source, { conversationId: 'main' }); t.after(() => chat.dispose()); await chat.connect();
  source.setStatus('offline'); chat.setText('Follow up'); chat.setReplyTo('six');
  const sending = chat.send(); await new Promise(resolve => setTimeout(resolve, 10));
  chat.setText('A later draft'); chat.setReplyTo('seven'); source.setStatus('live');
  await sending;
  assert.deepEqual(source.sends.map(input => input.replyTo), ['six', 'six']);
  assert.equal(chat.getSnapshot().shared.replyTo, 'seven');
  assert.equal(chat.getSnapshot().draft.text, 'A later draft');
  assert.equal(chat.getSnapshot().shared.messages.find(message => message.clientId === source.sends[0].clientId).replyTo, 'six');
});
