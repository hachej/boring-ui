import assert from 'node:assert/strict';
import test from 'node:test';
import { channelAvatarStates, createFakeChannelSource, createSharedChat } from '@hachej/boring-ui-kit/shared-chat';
import { sharedChatSeed } from '../../examples/shared-chat/seed.mjs';
import { createPdfDemo } from '../../examples/shared-chat/pdf-flow.mjs';

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

test('the fictional PM proxies the work trace and replaces its one request card', async t => {
  const source = createPdfDemo({ manual: true });
  const chat = createSharedChat(source, { conversationId: 'main' }); t.after(() => chat.dispose()); await chat.connect();
  chat.setText('@pm ajoute un export PDF'); await chat.send();
  const messages = () => chat.getSnapshot().shared.messages;
  assert.deepEqual(messages().filter(message => message.author === 'pm').map(message => message.id), ['pdf-doing', 'pdf-plan']);
  assert.equal(messages().find(message => message.id === 'pdf-doing').text, 'Je regarde vos fichiers.');
  source.planReady();
  assert.equal(messages().find(message => message.id === 'pdf-plan').text, 'Je vais ajouter un export PDF.  \nJe prépare une version que vous pourrez essayer.');
  assert.equal(messages().filter(message => message.streaming).length, 0, 'the plan settles before work begins');
  source.build();
  assert.deepEqual(messages().filter(message => message.id.startsWith('pdf-')).map(message => message.id), ['pdf-doing', 'pdf-plan', 'pdf-card']);
  const work = messages().find(message => message.id === 'pdf-plan');
  assert.equal(work.author, 'pm'); assert.equal(work.steps.length, 3);
  assert.deepEqual(messages().filter(message => message.streaming).map(message => message.author), ['pm']);
  assert.deepEqual(chat.getSnapshot().shared.members.filter(member => member.kind === 'agent').map(member => member.id), ['pm']);
  const id = messages().find(message => message.card).id;
  source.finish();
  assert.equal(messages().filter(message => message.card).length, 1);
  assert.equal(messages().find(message => message.card).id, id);
  assert.equal(messages().find(message => message.card).card.line, 'On attend votre essai');
  assert.equal(messages().some(message => message.author === 'worker'), false);
  assert.equal(messages().filter(message => message.streaming).length, 0);
  assert.equal(messages().find(message => message.id === 'pdf-answer'), undefined);
});
