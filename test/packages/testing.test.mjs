import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import { connect } from 'node:net';
import { createScriptedModel, createFakeChatModel, answeredGenerically, launch, insecureUrl, q, qa, startIdleProxy, withSubmitFaults } from '@hachej/boring-testing';

const user = content => ({ role: 'user', content, timestamp: 1 });
const toolResult = (call, text) => ({ role: 'toolResult', toolCallId: call.id, toolName: call.name, content: [{ type: 'text', text }], isError: false, timestamp: 1 });

test('scripted model: prompt rules answer with tool calls, streamed chunks, priced usage, failures and misses', async () => {
  const misses = [];
  const seen = [];
  const { models, model, definitions } = createScriptedModel({ misses,
    models: [{ id: 'fictional-scripted', cost: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0 } }],
    script: {
      'Plan the picnic': [
        { reasoning: 'Look first.', tools: [{ name: 'read', args: { path: 'notes.md' } }] },
        ctx => { seen.push(ctx.last); return { text: { chunks: ['Bring ', 'a ', ctx.last.json.item], ms: 1 }, usage: { input: 10, output: 20 } }; },
      ],
      'Break please': [{ error: 'Fictional outage' }],
    } });
  assert.deepEqual(model, { provider: 'scripted', modelId: 'fictional-scripted' });
  const chosen = definitions[0];
  const first = await models.complete(chosen, { messages: [user('Plan the picnic')] });
  assert.equal(first.stopReason, 'toolUse');
  assert.deepEqual(first.content.map(part => part.type), ['thinking', 'toolCall']);
  const call = first.content[1];
  assert.deepEqual([call.name, call.arguments], ['read', { path: 'notes.md' }]);

  const events = [];
  const stream = models.stream(chosen, { messages: [user('Plan the picnic'), first, toolResult(call, '{"item":"thermos"}')] });
  for await (const event of stream) events.push(event);
  const second = await stream.result();
  assert.deepEqual(events.filter(event => event.type === 'text_delta').map(event => event.delta), ['Bring ', 'a ', 'thermos']);
  assert.equal(second.content.at(-1).text, 'Bring a thermos');
  assert.equal(seen[0].name, 'read');
  assert.deepEqual(second.usage.cost, { input: 10 / 1e6, output: 40 / 1e6, cacheRead: 0, cacheWrite: 0, total: 50 / 1e6 }, 'priced at the model rates');

  const failed = await models.complete(chosen, { messages: [user('Break please')] });
  assert.deepEqual([failed.stopReason, failed.errorMessage], ['error', 'Fictional outage']);
  assert.ok(answeredGenerically('Reply with exactly: PICNIC-OK'));
  assert.equal((await models.complete(chosen, { messages: [user('Reply with exactly: PICNIC-OK')] })).content[0].text, 'PICNIC-OK');
  assert.deepEqual(misses, []);
  const missed = await models.complete(chosen, { messages: [user('Something unscripted')] });
  assert.match(missed.content[0].text, /no script answers "Something unscripted"/);
  assert.equal(misses.length, 1);
});

test('scripted model: Stop aborts a slow answer between chunks', async () => {
  const { models, definitions } = createScriptedModel({ script: { 'Tell a story': [{ text: { chunks: ['One. ', 'Two. ', 'Three. '], ms: 200 } }] } });
  const controller = new AbortController();
  const stream = models.stream(definitions[0], { messages: [user('Tell a story')] }, { signal: controller.signal });
  for await (const event of stream) if (event.type === 'text_delta') controller.abort();
  const result = await stream.result();
  assert.equal(result.stopReason, 'aborted');
  assert.equal(result.content[0].text, 'One. ');
});

test('fake chat model: each call waits for the test to append and respond', async () => {
  const fake = createFakeChatModel({ cost: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0 } });
  const chosen = fake.models.getModel(fake.model.provider, fake.model.modelId);
  const stream = fake.models.stream(chosen, { messages: [user('Hello')] });
  const call = await fake.nextCall();
  assert.equal(call.transcript.messages.at(-1).content, 'Hello');
  call.append('Hi ');
  call.respond('there', { input: 3, output: 4 });
  const result = await stream.result();
  assert.equal(result.content[0].text, 'Hi there');
  assert.equal(result.usage.cost.total, 11 / 1e6);
  assert.throws(() => call.append('late'), /already ended/);

  const controller = new AbortController();
  const aborted = fake.models.stream(chosen, { messages: [user('Hello again')] }, { signal: controller.signal });
  const second = await fake.nextCall();
  controller.abort();
  await second.aborted;
  assert.equal((await aborted.result()).stopReason, 'aborted');
  assert.equal(fake.calls.length, 2);
});

test('submit faults: refuse before the handler, hold the answer, pass everything else', async () => {
  const handled = [];
  const { handler, faults } = withSubmitFaults(async request => { handled.push(new URL(request.url).searchParams.get('op')); return new Response('ok'); }, { message: 'Fictional refusal' });
  faults.refuse = 1;
  const refused = await handler(new Request('http://fictional.invalid/api/chat?op=submit', { method: 'POST' }));
  assert.equal(refused.status, 402);
  assert.deepEqual(await refused.json(), { reason: 'submission-refused', message: 'Fictional refusal' });
  assert.deepEqual(handled, [], 'a refused submit never reaches the handler');
  faults.delayMs = 120;
  const started = Date.now();
  assert.equal(await (await handler(new Request('http://fictional.invalid/api/chat?op=submit', { method: 'POST' }))).text(), 'ok');
  assert.ok(Date.now() - started >= 100, 'the answer is held');
  await handler(new Request('http://fictional.invalid/api/chat?op=watch'));
  assert.deepEqual(handled, ['submit', 'watch']);
});

test('idle proxy: forwards requests and closes connections silent for the idle timeout', async t => {
  const server = createServer((request, response) => response.end('fictional'));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const proxy = await startIdleProxy({ target: `http://127.0.0.1:${server.address().port}`, idleMs: 150 });
  t.after(() => proxy.close());
  assert.equal(await (await fetch(proxy.url, { headers: { connection: 'close' } })).text(), 'fictional');
  const socket = connect(proxy.port, '127.0.0.1');
  const closed = new Promise(resolve => socket.on('close', resolve));
  await closed;
  assert.ok(proxy.stats.idleClosed >= 1);
  assert.ok(proxy.stats.connections >= 2);
});

test('browser driver: expression helpers, the insecure origin and a clear error without a browser', async () => {
  assert.equal(q('[data-testid=x]'), 'document.querySelector("[data-testid=x]")');
  assert.equal(qa('li'), '[...document.querySelectorAll("li")]');
  assert.equal(insecureUrl('http://127.0.0.1:4000/'), 'http://insecure.test:4000/');
  await assert.rejects(launch('about:blank', { chromium: '' }), /Set CHROMIUM/);
});
