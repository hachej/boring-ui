import assert from 'node:assert/strict';
import test from 'node:test';
import { createHmac } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Harness, MemoryStorage, createRegistry } from '@earendil-works/pi-durable';
import { openNodeSqliteStorage } from '@earendil-works/pi-durable/storage/sqlite/node';
import { createModels, createProvider } from '@earendil-works/pi-ai/models';
import { createAssistantMessageEventStream } from '@earendil-works/pi-ai/utils/event-stream';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import { createChannelGateway, channelRequestId, pendingQuestions, questionAnswer } from '../../examples/whatsapp/channels.ts';
import { createWhatsAppChannel, parseWhatsAppMessages, renderWhatsAppReply, splitWhatsAppText, verifyWhatsAppSignature, whatsAppMarkdown } from '../../examples/whatsapp/channels-whatsapp.ts';
import { createAskUserTool } from '@hachej/boring-agent/ask-user';
import { defineAgent } from '@hachej/boring-agent/agents';
import { createFakeChatModel } from '@hachej/boring-testing/model';

const until = async (label, check) => { const deadline = Date.now() + 8000; while (!(await check())) { assert.ok(Date.now() < deadline, label); await new Promise(resolve => setTimeout(resolve, 10)); } };
const webhook = (messages) => new Request('https://fixture.invalid/channels/fake', { method: 'POST', body: JSON.stringify(messages) });
const message = (messageId, text, address = 'fictional-sender') => ({ channel: 'fake', address, messageId, text, receivedAt: 1 });

/** An in-memory adapter: the request body is the verified message list; sends are recorded. */
function fakeChannel({ failures = 0, retryable = true } = {}) {
  const sent = [], received = [];
  let failing = failures;
  return {
    sent, received,
    adapter: {
      id: 'fake',
      receive: async request => request.headers.get('x-handshake') ? { kind: 'response', response: new Response('handshake') } : { kind: 'messages', messages: await request.json() },
      send: async (address, reply) => { if (failing > 0) { failing -= 1; throw Object.assign(new Error('fictional outage'), { retryable }); } sent.push({ address, reply }); },
      received: async inbound => { received.push(inbound.messageId); },
    },
  };
}

/** A model that asks `args` with `ask_user` first, then answers with the tool result. */
function askingModel(args) {
  const model = { id: 'fictional-asker', name: 'Fictional asker', provider: 'fictional-asker-provider', api: 'fictional-asker-api', baseUrl: 'https://fixture.invalid',
    input: ['text'], reasoning: false, contextWindow: 32768, maxTokens: 1024, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } };
  let calls = 0;
  const stream = (_model, transcript) => {
    const events = createAssistantMessageEventStream();
    const out = { role: 'assistant', content: [], api: model.api, provider: model.provider, model: model.id, timestamp: 1, stopReason: 'stop',
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
    const last = transcript.messages.at(-1);
    events.push({ type: 'start', partial: out });
    if (last?.role !== 'toolResult') {
      calls += 1;
      const toolCall = { type: 'toolCall', id: `call-${calls}`, name: 'ask_user', arguments: args };
      out.content.push(toolCall); out.stopReason = 'toolUse';
      events.push({ type: 'toolcall_start', contentIndex: 0, partial: out }, { type: 'toolcall_end', contentIndex: 0, toolCall, partial: out }, { type: 'done', reason: 'toolUse', message: out });
    } else {
      const text = `Plan uses ${JSON.parse(last.content[0].text).answer}.`;
      out.content.push({ type: 'text', text });
      events.push({ type: 'text_start', contentIndex: 0, partial: out }, { type: 'text_delta', contentIndex: 0, delta: text, partial: out },
        { type: 'text_end', contentIndex: 0, content: text, partial: out }, { type: 'done', reason: 'stop', message: out });
    }
    events.end(out);
    return events;
  };
  const models = createModels();
  models.setProvider(createProvider({ id: model.provider, models: [model], auth: { apiKey: { name: 'Fictional keyless provider', resolve: async () => ({ auth: {} }) } }, api: { stream, streamSimple: stream } }));
  return { models, model: { provider: model.provider, modelId: model.id } };
}

async function plainFixture(t, channel = fakeChannel(), gatewayOptions = {}) {
  const fake = createFakeChatModel();
  const harness = await Harness.open(new MemoryStorage(), { registry: createRegistry(), models: fake.models }, context);
  const conversation = await harness.createConversation({ ownership: { kind: 'ownerless' }, agent: { model: fake.model } }, context);
  const events = [];
  const gateway = createChannelGateway({ harness, context, adapters: [channel.adapter], retryDelaysMs: [1, 1],
    route: async inbound => inbound.address.startsWith('fictional-') ? conversation : null, onEvent: event => events.push(event), ...gatewayOptions });
  t.after(async () => { await gateway.close(); await harness.close(context); });
  return { fake, harness, conversation, gateway, channel, events, handle: gateway.handler('fake') };
}

test('a channel message becomes native input and its answer goes back to the sender', async t => {
  const { fake, conversation, handle, channel } = await plainFixture(t);
  const response = await handle(webhook([message('m1', 'Hello from the phone')]));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { schema: 'boring.channels', version: 1, accepted: 1 });
  // Acknowledged only after admission: the native submission already exists under the provider message ID.
  const record = await conversation.commit(tx => tx.submissionByRequest(conversation.id, channelRequestId({ channel: 'fake', messageId: 'm1' })), context);
  assert.ok(record);
  const call = await fake.nextCall();
  assert.equal(call.transcript.messages.at(-1).content, 'Hello from the phone');
  call.respond('**Hi** there');
  await until('reply sent', () => channel.sent.length === 1);
  assert.deepEqual(channel.sent[0], { address: 'fictional-sender', reply: { kind: 'answer', markdown: '**Hi** there' } });
  assert.deepEqual(channel.received, ['m1']);
  // The same conversation is what the web chat shows.
  const entries = (await conversation.context(context)).entries.flatMap(entry => entry.model ?? []);
  assert.deepEqual(entries.map(entry => entry.role), ['user', 'assistant']);
});

test('redelivery, unknown senders and handshakes never start a second run', async t => {
  const { fake, handle, channel, events } = await plainFixture(t);
  await handle(webhook([message('m1', 'Once')]));
  const again = await handle(webhook([message('m1', 'Once')]));
  assert.deepEqual(await again.json(), { schema: 'boring.channels', version: 1, accepted: 0 });
  const refused = await handle(webhook([message('m2', 'Who am I?', 'stranger')]));
  assert.equal((await refused.json()).accepted, 0);
  const handshake = await handle(new Request('https://fixture.invalid/channels/fake', { headers: { 'x-handshake': '1' } }));
  assert.equal(await handshake.text(), 'handshake');
  (await fake.nextCall()).respond('Only one answer.');
  await until('reply sent', () => channel.sent.length === 1);
  await new Promise(resolve => setTimeout(resolve, 50));
  assert.equal(fake.calls.length, 1);
  assert.equal(channel.sent.length, 1);
  assert.deepEqual(events.map(event => event.kind).filter(kind => kind !== 'delivered'), ['duplicate', 'refused']);
});

test('a message sent while the agent is busy queues natively and gets its own reply', async t => {
  const { fake, handle, channel } = await plainFixture(t);
  await handle(webhook([message('m1', 'First')]));
  const first = await fake.nextCall();
  await handle(webhook([message('m2', 'Second')]));
  first.respond('Answer one.');
  const second = await fake.nextCall();
  assert.equal(second.transcript.messages.at(-1).content, 'Second');
  second.respond('Answer two.');
  await until('both replies', () => channel.sent.length === 2);
  assert.deepEqual(channel.sent.map(sent => sent.reply.markdown), ['Answer one.', 'Answer two.']);
});

test('transient send failures are retried; a permanent failure is reported, not retried', async t => {
  const flaky = await plainFixture(t, fakeChannel({ failures: 2 }));
  await flaky.handle(webhook([message('m1', 'Retry me')]));
  (await flaky.fake.nextCall()).respond('Eventually.');
  await until('retried reply', () => flaky.channel.sent.length === 1);

  const broken = await plainFixture(t, fakeChannel({ failures: 5, retryable: false }));
  await broken.handle(webhook([message('m1', 'Lost')]));
  (await broken.fake.nextCall()).respond('Never sent.');
  await until('undeliverable event', () => broken.events.some(event => event.kind === 'undeliverable'));
  assert.equal(broken.channel.sent.length, 0);
});

test('ask_user questions go to the channel sender and a numbered reply answers them', async t => {
  const asker = askingModel({ question: 'Where do we picnic?', options: ['park', 'lake'] });
  const agent = defineAgent({ id: 'ask', model: asker.model, tools: [createAskUserTool()], instructions: 'Ask, then plan.' });
  const registry = createRegistry(); agent.install(registry);
  const harness = await Harness.open(new MemoryStorage(), { registry, models: asker.models }, context);
  const conversation = await agent.createConversation(harness, context);
  const channel = fakeChannel();
  const gateway = createChannelGateway({ harness, context, adapters: [channel.adapter], route: async () => conversation });
  t.after(async () => { await gateway.close(); await harness.close(context); });
  const handle = gateway.handler('fake');

  await handle(webhook([message('m1', 'Plan a picnic')]));
  await until('question sent', () => channel.sent.length === 1);
  const pending = pendingQuestions((await conversation.context(context)).entries)[0];
  assert.deepEqual(channel.sent[0].reply, { kind: 'question', callId: pending.callId, prompt: 'Where do we picnic?', options: ['park', 'lake'], allowFreeText: false });

  await handle(webhook([message('m2', 'beach')]));
  await until('refusal and question again', () => channel.sent.length === 3);
  assert.equal(channel.sent[1].reply.kind, 'notice');
  assert.equal(channel.sent[2].reply.kind, 'question');

  await handle(webhook([message('m3', '2')]));
  await until('final answer', () => channel.sent.length === 4);
  assert.deepEqual(channel.sent[3].reply, { kind: 'answer', markdown: 'Plan uses lake.' });
  // A redelivered answer is not a new prompt once its question is settled.
  const redelivered = await handle(webhook([message('m3', '2')]));
  assert.equal((await redelivered.json()).accepted, 0);
  await new Promise(resolve => setTimeout(resolve, 50));
  assert.equal(channel.sent.length, 4);
});

test('a question of a browser-started run stays in the browser', async t => {
  const asker = askingModel({ question: 'Which colour?', options: ['red', 'blue'] });
  const agent = defineAgent({ id: 'ask', model: asker.model, tools: [createAskUserTool()], instructions: 'Ask.' });
  const registry = createRegistry(); agent.install(registry);
  const harness = await Harness.open(new MemoryStorage(), { registry, models: asker.models }, context);
  const conversation = await agent.createConversation(harness, context);
  const channel = fakeChannel();
  const gateway = createChannelGateway({ harness, context, adapters: [channel.adapter], route: async () => conversation });
  t.after(async () => { await gateway.close(); await harness.close(context); });
  // Start a channel watch, then let the browser ask.
  await gateway.handler('fake')(webhook([message('m1', 'Ask me')]));
  await until('channel question', () => channel.sent.length === 1);
  await gateway.handler('fake')(webhook([message('m2', 'red')]));
  await until('channel answer', () => channel.sent.length === 2);
  await conversation.submit({ type: 'input', requestId: 'browser-1', content: 'Browser asks' }, context);
  await until('browser question pending', async () => pendingQuestions((await conversation.context(context)).entries).length === 1);
  await new Promise(resolve => setTimeout(resolve, 100));
  assert.equal(channel.sent.length, 2);
});

test('a reply owed before a restart is delivered after it', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'boring-channels-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const filename = join(directory, 'session.sqlite');
  const fake = createFakeChatModel();
  let harness = await Harness.open(await openNodeSqliteStorage(filename), { registry: createRegistry(), models: fake.models }, context);
  const created = await harness.createConversation({ ownership: { kind: 'ownerless' }, agent: { model: fake.model } }, context);
  const id = created.id;
  const first = fakeChannel();
  let gateway = createChannelGateway({ harness, context, adapters: [first.adapter], route: async () => created });
  await gateway.handler('fake')(webhook([message('m1', 'Survive a restart')]));
  await fake.nextCall();
  // The process stops while the model is still answering.
  await gateway.close(); await harness.close(context);

  harness = await Harness.open(await openNodeSqliteStorage(filename), { registry: createRegistry(), models: fake.models }, context);
  const conversation = await harness.conversation(id, context);
  const second = fakeChannel();
  gateway = createChannelGateway({ harness, context, adapters: [second.adapter], route: async () => conversation });
  t.after(async () => { await gateway.close(); await harness.close(context); });
  harness.resume();
  await gateway.start();
  (await fake.nextCall()).respond('Recovered answer.');
  await until('recovered reply', () => second.sent.length === 1);
  assert.deepEqual(second.sent[0], { address: 'fictional-sender', reply: { kind: 'answer', markdown: 'Recovered answer.' } });
  assert.equal(first.sent.length, 0);
});

test('question answers accept the option, its number or free text', () => {
  const question = { callId: 'c', prompt: 'Pick', options: ['park', 'lake'], allowFreeText: true };
  assert.equal(questionAnswer(question, ' Lake '), 'lake');
  assert.equal(questionAnswer(question, '1'), 'park');
  assert.equal(questionAnswer(question, '7'), '7');
  assert.equal(questionAnswer(question, 'the beach'), 'the beach');
});

// WhatsApp Cloud API edge

const secrets = { accessToken: 'fictional-access', appSecret: 'fictional-app-secret', verifyToken: 'fictional-verify', phoneNumberId: '1000' };
const sign = body => `sha256=${createHmac('sha256', secrets.appSecret).update(body).digest('hex')}`;
const envelope = (messages, phoneNumberId = '1000') => JSON.stringify({ object: 'whatsapp_business_account', entry: [{ id: 'waba', changes: [{ field: 'messages', value: { messaging_product: 'whatsapp', metadata: { phone_number_id: phoneNumberId }, messages } }] }] });
function graph() {
  const requests = [];
  let status = 200, error;
  return { requests, fail: (next, body) => { status = next; error = body; },
    fetch: async (url, init) => { requests.push({ url, init, body: JSON.parse(init.body) }); return status === 200 ? Response.json({ messages: [{ id: 'wamid.out' }] }) : Response.json(error ?? {}, { status }); } };
}
const whatsapp = (api, extra = {}) => createWhatsAppChannel({ withCredentials: use => Promise.resolve(use(secrets)), fetch: api.fetch, ...extra });

test('WhatsApp verifies the subscription challenge and the body signature', async () => {
  const channel = whatsapp(graph());
  const ok = await channel.receive(new Request('https://fixture.invalid/wa?hub.mode=subscribe&hub.verify_token=fictional-verify&hub.challenge=42'));
  assert.equal(ok.kind, 'response'); assert.equal(ok.response.status, 200); assert.equal(await ok.response.text(), '42');
  const wrong = await channel.receive(new Request('https://fixture.invalid/wa?hub.mode=subscribe&hub.verify_token=nope&hub.challenge=42'));
  assert.equal(wrong.response.status, 403);
  const body = envelope([{ id: 'wamid.1', from: '15550001', timestamp: '1700000000', type: 'text', text: { body: 'Hi agent' } }]);
  const unsigned = await channel.receive(new Request('https://fixture.invalid/wa', { method: 'POST', body, headers: { 'x-hub-signature-256': sign(body + ' ') } }));
  assert.equal(unsigned.response.status, 401);
  const signed = await channel.receive(new Request('https://fixture.invalid/wa', { method: 'POST', body, headers: { 'x-hub-signature-256': sign(body) } }));
  assert.deepEqual(signed, { kind: 'messages', messages: [{ channel: 'whatsapp', address: '15550001', messageId: 'wamid.1', text: 'Hi agent', receivedAt: 1_700_000_000_000 }] });
  assert.equal(await verifyWhatsAppSignature(new TextEncoder().encode(body), 'sha256=zz', secrets.appSecret), false);
});

test('WhatsApp parsing keeps text and choices, skips statuses, media and other numbers', () => {
  const messages = parseWhatsAppMessages(JSON.parse(envelope([
    { id: 'a', from: '1', type: 'text', text: { body: 'text' } },
    { id: 'b', from: '1', type: 'interactive', interactive: { type: 'button_reply', button_reply: { id: 'lake', title: 'lake' } } },
    { id: 'c', from: '1', type: 'interactive', interactive: { type: 'list_reply', list_reply: { id: 'the long option', title: 'the long option' } } },
    { id: 'd', from: '1', type: 'image', image: { id: 'media' } },
  ])), { phoneNumberId: '1000', receivedAt: 5 });
  assert.deepEqual(messages.map(item => [item.messageId, item.text]), [['a', 'text'], ['b', 'lake'], ['c', 'the long option']]);
  assert.deepEqual(parseWhatsAppMessages(JSON.parse(envelope([{ id: 'x', from: '1', type: 'text', text: { body: 'other' } }], '2000')), { phoneNumberId: '1000' }), []);
  assert.throws(() => parseWhatsAppMessages({ object: 'page' }));
});

test('WhatsApp renders answers, buttons, lists and numbered questions', () => {
  assert.equal(whatsAppMarkdown('# Title\n**bold** and *it*\n[docs](https://example.invalid/x)'), '*Title*\n*bold* and _it_\ndocs (https://example.invalid/x)');
  const buttons = renderWhatsAppReply({ kind: 'question', callId: 'c', prompt: 'Where?', options: ['park', 'lake'], allowFreeText: true });
  assert.equal(buttons[0].interactive.type, 'button');
  assert.deepEqual(buttons[0].interactive.action.buttons.map(button => button.reply.id), ['park', 'lake']);
  assert.equal(buttons[0].interactive.footer.text, 'Or type your own answer.');
  const list = renderWhatsAppReply({ kind: 'question', callId: 'c', prompt: 'Which?', options: ['one', 'two', 'three', 'four'], allowFreeText: false });
  assert.equal(list[0].interactive.type, 'list');
  const numbered = renderWhatsAppReply({ kind: 'question', callId: 'c', prompt: 'Which?', options: ['an option far too long for a list row title', 'b'], allowFreeText: false });
  assert.equal(numbered[0].text.body, 'Which?\n\n1. an option far too long for a list row title\n2. b\n\nReply with a number.');
  const chunks = splitWhatsAppText(`${'a'.repeat(30)}\n\n\`\`\`\n${'b'.repeat(40)}\n\`\`\``, 40);
  assert.ok(chunks.every(chunk => chunk.length <= 40));
  assert.ok(chunks.every(chunk => (chunk.match(/```/g) ?? []).length % 2 === 0));
});

test('WhatsApp sends through the Graph API and classifies failures', async () => {
  const api = graph();
  const channel = whatsapp(api);
  await channel.send('15550001', { kind: 'answer', markdown: 'Hello' });
  assert.equal(api.requests[0].url, 'https://graph.facebook.com/v25.0/1000/messages');
  assert.equal(api.requests[0].init.headers.authorization, 'Bearer fictional-access');
  assert.deepEqual(api.requests[0].body, { messaging_product: 'whatsapp', recipient_type: 'individual', to: '15550001', type: 'text', text: { body: 'Hello', preview_url: false } });
  await channel.received({ channel: 'whatsapp', address: '15550001', messageId: 'wamid.1', text: 'x', receivedAt: 1 });
  assert.deepEqual(api.requests[1].body, { messaging_product: 'whatsapp', status: 'read', message_id: 'wamid.1', typing_indicator: { type: 'text' } });
  api.fail(429);
  await assert.rejects(channel.send('1', { kind: 'notice', text: 'x' }), error => error.retryable === true);
  api.fail(400, { error: { code: 131047 } });
  await assert.rejects(channel.send('1', { kind: 'notice', text: 'x' }), error => error.retryable === false);
  api.fail(400, { error: { code: 131000, is_transient: true } });
  await assert.rejects(channel.send('1', { kind: 'notice', text: 'x' }), error => error.retryable === true);
  assert.equal(whatsapp(api, { typingIndicator: false }).received, undefined);
});

test('a signed WhatsApp webhook drives the gateway end to end', async t => {
  const api = graph();
  const fake = createFakeChatModel();
  const harness = await Harness.open(new MemoryStorage(), { registry: createRegistry(), models: fake.models }, context);
  const conversation = await harness.createConversation({ ownership: { kind: 'ownerless' }, agent: { model: fake.model } }, context);
  const gateway = createChannelGateway({ harness, context, adapters: [whatsapp(api)], route: async inbound => inbound.address === '15550001' ? conversation : null });
  t.after(async () => { await gateway.close(); await harness.close(context); });
  const body = envelope([{ id: 'wamid.9', from: '15550001', type: 'text', text: { body: 'Ping' } }]);
  const response = await gateway.handler('whatsapp')(new Request('https://fixture.invalid/wa', { method: 'POST', body, headers: { 'x-hub-signature-256': sign(body) } }));
  assert.equal(response.status, 200);
  (await fake.nextCall()).respond('Pong');
  await until('reply posted', () => api.requests.some(request => request.body.type === 'text'));
  const sent = api.requests.find(request => request.body.type === 'text');
  assert.deepEqual(sent.body.text, { body: 'Pong', preview_url: false });
  assert.equal(sent.body.to, '15550001');
});

test('a restarted gateway sends the pending question already present when its native watch attaches', async t => {
  const asker = askingModel({ question: 'Where do we picnic?', options: ['park', 'lake'] });
  const agent = defineAgent({ id: 'ask', model: asker.model, tools: [createAskUserTool()], instructions: 'Ask, then plan.' });
  const registry = createRegistry(); agent.install(registry);
  const harness = await Harness.open(new MemoryStorage(), { registry, models: asker.models }, context);
  const conversation = await agent.createConversation(harness, context);
  const firstChannel = fakeChannel();
  let failed = 0;
  const first = createChannelGateway({ harness, context, route: async () => conversation, retryDelaysMs: [], adapters: [{ ...firstChannel.adapter,
    send: async () => { failed++; throw { retryable: false }; },
  }] });
  const recovered = fakeChannel();
  const next = createChannelGateway({ harness, context, route: async () => conversation, adapters: [recovered.adapter] });
  t.after(async () => { await first.close(); await next.close(); await harness.close(context); });
  await first.handler('fake')(webhook([message('quiet-restart', 'Plan a picnic')]));
  await until('initial attempted notification', () => failed === 1);
  await first.close();
  const pending = pendingQuestions((await conversation.context(context)).entries)[0];
  assert.ok(pending);
  await next.start();
  await until('existing pending question delivered', () => recovered.sent.some(item => item.reply.kind === 'question'));
  assert.deepEqual(recovered.sent[0].reply, { kind: 'question', ...pending });
  await next.handler('fake')(webhook([message('quiet-answer', '2')]));
  await until('run resumed', () => recovered.sent.some(item => item.reply.kind === 'answer'));
  assert.equal(recovered.sent.filter(item => item.reply.kind === 'question').length, 1);
  assert.equal(recovered.sent.at(-1).reply.markdown, 'Plan uses lake.');
});
