import assert from 'node:assert/strict';
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { Harness, createRegistry, defineDoc } from '@earendil-works/pi-durable';
import { openNodeSqliteStorage } from '@earendil-works/pi-durable/storage/sqlite/node';
import { createModels, createProvider } from '@earendil-works/pi-ai/models';
import { createAssistantMessageEventStream } from '@earendil-works/pi-ai/utils/event-stream';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import { createChannelGateway, pendingQuestions } from '../../examples/whatsapp/channels.ts';
import { answerUserQuestion, createAskUserTool } from '@hachej/boring-agent/ask-user';
import { defineAgent } from '@hachej/boring-agent/agents';

const [directory, phase, boundary] = process.argv.slice(2);
const keepAlive = setInterval(() => {}, 1000);
const until = async check => { const deadline = Date.now() + 10000; while (!await check()) { assert.ok(Date.now() < deadline, 'channel checkpoint timeout'); await delay(5); } };
const model = { id: 'fictional', name: 'Fictional', provider: 'fictional', api: 'fictional', baseUrl: 'https://fixture.invalid', input: ['text'], reasoning: false, contextWindow: 32768, maxTokens: 1024, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } };
const stream = (_model, transcript) => {
  const events = createAssistantMessageEventStream();
  const answered = transcript.messages.at(-1)?.role === 'toolResult';
  const part = answered ? { type: 'text', text: 'Received your answer.' } : { type: 'toolCall', id: 'fixture-call', name: 'ask_user', arguments: { question: 'Fictional picnic?', options: ['park', 'lake'] } };
  const message = { role: 'assistant', content: [part], api: model.api, provider: model.provider, model: model.id, timestamp: 1, stopReason: answered ? 'stop' : 'toolUse', usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
  events.push({ type: 'start', partial: message });
  events.push({ type: 'done', reason: message.stopReason, message });
  events.end(message);
  return events;
};
const models = createModels();
models.setProvider(createProvider({ id: model.provider, models: [model], auth: { apiKey: { name: 'Fictional keyless', resolve: async () => ({ auth: {} }) } }, api: { stream, streamSimple: stream } }));
const agent = defineAgent({ id: 'ask', model: { provider: model.provider, modelId: model.id }, tools: [createAskUserTool()], instructions: 'Ask.' });
const registry = createRegistry(); agent.install(registry);
const harness = await Harness.open(await openNodeSqliteStorage(join(directory, 'native.sqlite')), { registry, models }, context);
const conversation = phase === 'hold' ? await agent.createConversation(harness, context)
  : await harness.conversation(JSON.parse(readFileSync(join(directory, 'ready.json'), 'utf8')).conversationId, context);
const sent = [];
const ready = reply => writeFileSync(join(directory, 'ready.json'), JSON.stringify({ conversationId: conversation.id, questionId: reply.callId }));
const adapter = {
  id: 'fictional', receive: async request => ({ kind: 'messages', messages: await request.json() }),
  send: async (address, reply) => {
    if (phase === 'hold' && reply.kind === 'question' && boundary === 'before-send') { ready(reply); await new Promise(() => {}); }
    appendFileSync(join(directory, 'external.jsonl'), JSON.stringify({ address, reply, phase }) + '\n');
    sent.push(reply);
    if (phase === 'hold' && reply.kind === 'question' && boundary === 'after-send') { ready(reply); await new Promise(() => {}); }
  },
};
const gateway = createChannelGateway({ harness, context, adapters: [adapter], route: async () => conversation });
if (phase === 'hold') {
  const response = await gateway.handler('fictional')(new Request('https://fixture.invalid/channel', { method: 'POST', body: JSON.stringify([{ channel: 'fictional', address: 'fictional-sender', messageId: 'message-one', text: 'Plan a picnic.', receivedAt: 1 }]) }));
  assert.equal(response.status, 200);
  if (boundary === 'after-ack') {
    const outbox = defineDoc({ kind: 'boring.channels.outbox', version: 1, scope: 'session', initial: () => ({ items: [], answers: [] }) });
    await until(async () => (await harness.snapshot(outbox, context))?.items.some(item => item.asked.length > 0));
    ready(sent.find(reply => reply.kind === 'question'));
  }
  await new Promise(() => {});
} else {
  harness.resume();
  await gateway.start();
  if (boundary !== 'after-ack') await until(() => sent.some(reply => reply.kind === 'question'));
  const { questionId } = JSON.parse(readFileSync(join(directory, 'ready.json'), 'utf8'));
  await until(async () => (await answerUserQuestion(conversation, questionId, 'lake', context)).kind === 'answered');
  await until(() => sent.some(reply => reply.kind === 'answer'));
  assert.equal(pendingQuestions((await conversation.context(context)).entries).length, 0);
  await gateway.close(); await harness.close(context); clearInterval(keepAlive);
}
