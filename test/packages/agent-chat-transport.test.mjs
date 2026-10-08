import assert from 'node:assert/strict';
import test from 'node:test';
import { Harness, MemoryStorage, createRegistry, defineTool, UserEntry } from '@earendil-works/pi-durable';
import { Type } from '@earendil-works/pi-ai';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import { createChatTransportHandler } from '@hachej/boring-agent/chat-transport';
import { defineAgent, parseSkill, createSkillsExtension } from '@hachej/boring-agent/agents';
import { createRemoteChat } from '@hachej/boring-ui-kit/remote-chat';
import { createNativeChatController } from '@hachej/boring-ui-kit/native-chat';
import { createModels, createProvider } from '@earendil-works/pi-ai/models';
import { createAssistantMessageEventStream } from '@earendil-works/pi-ai/utils/event-stream';
import { createFakeChatModel } from '@hachej/boring-testing/model';

const identity = { runtimeId: 'fictional-runtime', scopeId: 'fictional-scope', principalId: 'fictional-person' };
const endpoint = 'https://fixture.invalid/chat';
const json = { 'content-type': 'application/json' };
const until = async (label, check) => { const deadline = Date.now() + 5000; while (!check()) { assert.ok(Date.now() < deadline, label); await new Promise(resolve => setTimeout(resolve, 10)); } };
const texts = view => view.entries.flatMap(entry => entry.model ?? []).filter(message => message.role === 'assistant')
  .flatMap(message => message.content.filter(part => part.type === 'text').map(part => part.text));

async function fixture(t, access = {}) {
  const fake = createFakeChatModel();
  const harness = await Harness.open(new MemoryStorage(), { registry: createRegistry(), models: fake.models }, context);
  const conversation = await harness.createConversation({ ownership: { kind: 'ownerless' }, agent: { model: fake.model } }, context);
  const handler = createChatTransportHandler({ authenticate: async request =>
    request.headers.get('authorization') === 'Bearer fictional-token' ? { conversation, context, ...access } : null });
  const fetch = request => { const headers = new Headers(request.headers); headers.set('authorization', 'Bearer fictional-token'); return handler(new Request(request, { headers })); };
  t.after(() => harness.close(context));
  return { fake, harness, conversation, handler, fetch };
}

test('remote chat drives the unchanged native chat controller through the transport', async t => {
  const { fake, conversation, fetch: served } = await fixture(t);
  let watches = 0;
  const fetch = request => { if (new URL(request.url).searchParams.get('op') === 'watch') watches++; return served(request); };
  const remote = await createRemoteChat({ endpoint, fetch, pollMs: 10 });
  assert.equal(remote.conversation.id, conversation.id);
  const controller = createNativeChatController({ identity, ...remote });
  t.after(() => controller.dispose());
  await controller.connect();
  assert.equal(watches, 1, 'the identity probe is the controller\'s watch: the transcript crosses the wire once');
  assert.equal(controller.getSnapshot().connection.kind, 'connected');
  controller.setText('Describe the fictional document.');
  const submission = await controller.send();
  assert.equal(controller.getSnapshot().send.kind, 'admitted');
  const call = await fake.nextCall();
  call.append('Streaming ');
  await until('streamed text reaches the remote view', () => JSON.stringify(controller.getSnapshot().view?.docs ?? {}).includes('Streaming '));
  call.respond('answer.');
  assert.equal((await submission.wait(remote.context)).status, 'done');
  await until('settled assistant entry', () => texts(controller.getSnapshot().view).includes('Streaming answer.'));
  // The replica rebuilt from native operation batches equals the authoritative native view.
  const native = await conversation.watch(context);
  t.after(() => native.stop());
  await until('replica converges', () => JSON.stringify(controller.getSnapshot().view) === JSON.stringify(native.value));
});

test('remote stop aborts the native generation and reload restores the transcript', async t => {
  const { fake, conversation, fetch } = await fixture(t);
  const first = createNativeChatController({ identity, ...await createRemoteChat({ endpoint, fetch }) });
  await first.connect();
  first.setText('Write something long.');
  await first.send();
  const call = await fake.nextCall();
  call.append('Partial ');
  await first.stop();
  assert.equal(first.getSnapshot().stop, 'confirmed');
  await call.aborted;
  await conversation.waitForIdle(context);
  await first.dispose();
  // A second browser session sees the same durable history, including the user's message.
  const second = createNativeChatController({ identity, ...await createRemoteChat({ endpoint, fetch }) });
  t.after(() => second.dispose());
  await second.connect();
  const users = second.getSnapshot().view.entries.flatMap(entry => entry.model ?? []).filter(message => message.role === 'user');
  assert.equal(users.length, 1);
  const page = await (await createRemoteChat({ endpoint, fetch })).conversation.entries({}, 10, undefined, context);
  assert.ok(page.items.length >= 1);
});

test('transport refuses unauthenticated, revoked and disallowed callers and projects views', async t => {
  const revoked = new AbortController();
  const { handler, fetch, fake } = await fixture(t, { revoked: revoked.signal, allow: operation => operation !== 'abort',
    project: view => ({ ...view, entries: view.entries.map(entry => ({ ...entry, model: (entry.model ?? []).map(message => message.role === 'user' ? { ...message, content: '[hidden]' } : message) })) }) });
  assert.equal((await handler(new Request(`${endpoint}?op=watch`))).status, 401);
  assert.equal((await fetch(new Request(`${endpoint}?op=nothing`))).status, 404);
  assert.equal((await fetch(new Request(`${endpoint}?op=submit`, { method: 'POST', headers: json, body: '{"requestId":"","content":""}' }))).status, 400);
  assert.equal((await fetch(new Request(`${endpoint}?op=abort`, { method: 'POST', headers: json, body: '{}' }))).status, 403);
  const controller = createNativeChatController({ identity, ...await createRemoteChat({ endpoint, fetch }) });
  t.after(() => controller.dispose());
  await controller.connect();
  controller.setText('Private fictional request');
  await controller.send();
  (await fake.nextCall()).respond('Visible reply');
  await until('projected reply', () => texts(controller.getSnapshot().view).includes('Visible reply'));
  assert.ok(!JSON.stringify(controller.getSnapshot().view.entries).includes('Private fictional request'));
  // History and submission lookup are projected like the watch: raw conversation data never leaves the host when `project` is set.
  const history = await fetch(new Request(`${endpoint}?op=entries&limit=50`));
  assert.equal(history.status, 200);
  const historyText = JSON.stringify(await history.json());
  assert.ok(historyText.includes('[hidden]') && historyText.includes('Visible reply'), 'history is a projected page');
  assert.ok(!historyText.includes('Private fictional request'), 'history does not return what the live view redacts');
  const requestId = controller.getSnapshot().send.attempt.requestId;
  const lookedUp = await (await fetch(new Request(`${endpoint}?op=submission&requestId=${encodeURIComponent(requestId)}`))).json();
  assert.equal(lookedUp.record?.requestId, requestId, 'the submission record is still found by its request ID');
  assert.ok(!('detail' in lookedUp.record), 'a projected submission record carries no free-form detail');
  // The body guard: a POST must be JSON (a cross-site form cannot send that), and an oversized body is refused while it is read.
  assert.equal((await fetch(new Request(`${endpoint}?op=abort`, { method: 'POST', body: '{}' }))).status, 415);
  assert.equal((await fetch(new Request(`${endpoint}?op=submit`, { method: 'POST', headers: json, body: 'x'.repeat(8_388_609) }))).status, 413);
  assert.equal((await fetch(new Request(`${endpoint}?op=submit`, { method: 'POST', headers: json, body: '{not json' }))).status, 400);
  revoked.abort();
  await until('revocation closes the watch', () => controller.getSnapshot().connection.kind === 'closed');
  assert.equal((await fetch(new Request(`${endpoint}?op=watch`))).status, 403);
});

test('the watch heartbeats while idle and the remote chat reopens a dropped or silent stream without duplicates', async t => {
  const fake = createFakeChatModel();
  const harness = await Harness.open(new MemoryStorage(), { registry: createRegistry(), models: fake.models }, context);
  t.after(() => harness.close(context));
  const conversation = await harness.createConversation({ ownership: { kind: 'ownerless' }, agent: { model: fake.model } }, context);
  let open = 0;
  const handler = createChatTransportHandler({ heartbeatMs: 40, authenticate: async () => ({ conversation, context }) });
  // Raw stream: proxy-safe headers, the first heartbeat right after the view, then heartbeats while idle; cancelling stops them.
  const raw = await handler(new Request(`${endpoint}?op=watch`));
  assert.equal(raw.headers.get('cache-control'), 'no-store, no-transform');
  assert.equal(raw.headers.get('x-accel-buffering'), 'no');
  const reader = raw.body.pipeThrough(new TextDecoderStream()).getReader();
  let text = '';
  while (text.split('\n').length < 4) text += (await reader.read()).value;
  const lines = text.split('\n').slice(0, 3).map(line => JSON.parse(line));
  assert.deepEqual(lines.map(line => line.kind), ['view', 'heartbeat', 'heartbeat']);
  assert.equal(lines[1].intervalMs, 40);
  await reader.cancel();

  // A fetch that lets the test cut the current watch (a proxy closing it) or freeze it (a proxy dropping it silently).
  const watches = [];
  const fetch = async request => {
    const response = await handler(request);
    if (new URL(request.url).searchParams.get('op') !== 'watch') return response;
    open++;
    let cut, frozen = false;
    const body = response.body.pipeThrough(new TransformStream({
      start: controller => { cut = () => controller.error(new TypeError('Fictional proxy closed the connection')); },
      transform: (chunk, controller) => { if (!frozen) controller.enqueue(chunk); },
    }));
    watches.push({ cut: () => cut(), freeze: () => { frozen = true; } });
    return new Response(body, { headers: response.headers });
  };
  const remote = await createRemoteChat({ endpoint, fetch, reconnect: { baseDelayMs: 10, maxDelayMs: 40 } });
  const controller = createNativeChatController({ identity, ...remote });
  t.after(() => controller.dispose());
  await controller.connect();
  const states = [];
  controller.subscribe(() => { const kind = controller.getSnapshot().connection.kind; if (states.at(-1) !== kind) states.push(kind); });
  await new Promise(resolve => setTimeout(resolve, 200));
  assert.equal(open, 1, 'an idle stream with heartbeats is not reopened');

  watches.at(-1).cut();
  await until('reopened after a drop', () => open === 2 && controller.getSnapshot().connection.kind === 'connected');
  watches.at(-1).freeze();
  await until('reopened after 2.5 silent heartbeat intervals', () => open === 3 && controller.getSnapshot().connection.kind === 'connected');
  assert.deepEqual(states, ['reconnecting', 'connected', 'reconnecting', 'connected'], 'the controller reports reconnecting honestly');

  controller.setText('Still there?');
  await controller.send();
  (await fake.nextCall()).respond('Fictional reply after reconnects.');
  await until('the reply arrives once', () => texts(controller.getSnapshot().view).includes('Fictional reply after reconnects.'));
  assert.equal(texts(controller.getSnapshot().view).filter(item => item === 'Fictional reply after reconnects.').length, 1);
  assert.equal(controller.getSnapshot().view.entries.flatMap(entry => entry.model ?? []).filter(message => message.role === 'user').length, 1);

  // Dispose stops reopening: a drop after it opens nothing.
  await controller.dispose();
  watches.at(-1).cut();
  await new Promise(resolve => setTimeout(resolve, 100));
  assert.equal(open, 3);
});

test('defineAgent maps data to native extensions, agent configuration and on-demand skills', async t => {
  const fake = createFakeChatModel();
  const echo = defineTool({ name: 'echo', description: 'Echo text.', parameters: Type.Object({ text: Type.String() }), replay: 'safe',
    execute: async args => ({ content: [{ type: 'text', text: args.text }] }) });
  const skill = parseSkill('---\nname: fictional-letter\ndescription: "Write a fictional letter"\n---\nAlways sign as the Fictional Clinic.\n');
  assert.deepEqual(skill, { name: 'fictional-letter', description: 'Write a fictional letter', body: 'Always sign as the Fictional Clinic.' });
  assert.throws(() => parseSkill('no front matter'), TypeError);
  assert.throws(() => createSkillsExtension('x', [skill, skill]), /Duplicate skill/);
  assert.throws(() => defineAgent({ id: 'Bad Id', model: fake.model }), /Invalid agent id/);
  const writer = defineAgent({ id: 'writer', model: fake.model, instructions: 'You write fictional letters.', tools: [echo], skills: [skill] });
  const reviewer = defineAgent({ id: 'reviewer', model: fake.model, instructions: 'You review only.' });
  assert.deepEqual(writer.extensions.map(extension => extension.name), ['agent.writer', 'agent.writer.skills']);
  assert.equal(reviewer.extensions.length, 0);
  const registry = createRegistry();
  writer.install(registry); reviewer.install(registry);
  const harness = await Harness.open(new MemoryStorage(), { registry, models: fake.models }, context);
  t.after(() => harness.close(context));
  const [writing, reviewing] = [await writer.createConversation(harness, context), await reviewer.createConversation(harness, context)];
  await writing.submit({ type: 'input', requestId: 'w', content: 'hello' }, context);
  const writerCall = await fake.nextCall();
  const prompt = JSON.stringify(writerCall.transcript);
  assert.match(prompt, /You write fictional letters/); assert.match(prompt, /fictional-letter: Write a fictional letter/);
  assert.match(prompt, /message that starts with \/<skill-name>[^"]*call load_skill for that skill first/);
  assert.deepEqual(writer.skills, [{ name: 'fictional-letter', description: 'Write a fictional letter' }]);
  assert.ok(!prompt.includes('Always sign as the Fictional Clinic'), 'skill bodies stay out of the prompt until loaded');
  const added = call => call.transcript.messages.flatMap(message => message.toolsAdded ?? []).map(tool => tool.name).sort();
  assert.deepEqual(added(writerCall), ['echo', 'load_skill']);
  writerCall.respond('ok');
  await reviewing.submit({ type: 'input', requestId: 'r', content: 'hello' }, context);
  const reviewerCall = await fake.nextCall();
  assert.match(JSON.stringify(reviewerCall.transcript), /You review only/);
  assert.deepEqual(added(reviewerCall), [], 'agents do not see each other\'s tools');
  reviewerCall.respond('ok');
  const loader = writer.extensions[1].tools[0];
  assert.equal((await loader.execute({ name: 'fictional-letter' })).content[0].text, 'Always sign as the Fictional Clinic.');
  assert.match((await loader.execute({ name: 'missing' })).content[0].text, /Unknown skill/);
});

// Two local models that answer at once with their own ID, so a test can see which model served a request.
function twoModels() {
  const base = { api: 'fictional-two-api', provider: 'fictional-two-provider', baseUrl: 'https://fixture.invalid', input: ['text'], reasoning: true, contextWindow: 32768, maxTokens: 1024,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } };
  const list = [{ ...base, id: 'fictional-small', name: 'Small' }, { ...base, id: 'fictional-large', name: 'Large' }];
  const stream = model => {
    const events = createAssistantMessageEventStream();
    const message = { role: 'assistant', content: [{ type: 'text', text: `served by ${model.id}` }], api: model.api, provider: model.provider, model: model.id, timestamp: 1, stopReason: 'stop',
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
    queueMicrotask(() => { events.push({ type: 'start', partial: message }); events.push({ type: 'done', reason: 'stop', message }); events.end(message); });
    return events;
  };
  const models = createModels();
  models.setProvider(createProvider({ id: base.provider, models: list, auth: { apiKey: { name: 'Fictional keyless provider', resolve: async () => ({ auth: {} }) } }, api: { stream: (m) => stream(m), streamSimple: (m) => stream(m) } }));
  return { models, ref: id => ({ provider: base.provider, modelId: id }) };
}

test('configure changes the conversation agent through the host, which owns the allow-list', async t => {
  const { models, ref } = twoModels();
  const harness = await Harness.open(new MemoryStorage(), { registry: createRegistry(), models }, context);
  t.after(() => harness.close(context));
  const conversation = await harness.createConversation({ ownership: { kind: 'ownerless' }, agent: { model: ref('fictional-small'), thinkingLevel: 'low' } }, context);
  const allowed = new Set(['fictional-small', 'fictional-large']), levels = new Set(['low', 'high']);
  const attempts = [];
  const configure = async change => {
    attempts.push(change);
    if (change.model && !allowed.has(change.model.modelId)) return { kind: 'refused', reason: 'model-not-offered' };
    if (change.thinkingLevel && !levels.has(change.thinkingLevel)) return { kind: 'refused', reason: 'level-not-offered' };
    await conversation.configure({ ...(change.model ? { model: change.model } : {}), ...(change.thinkingLevel ? { thinkingLevel: change.thinkingLevel } : {}) }, context);
    return { kind: 'configured' };
  };
  const handler = createChatTransportHandler({ authenticate: async request => request.headers.get('authorization') === 'Bearer fictional-token'
    ? { conversation, context, configure, allow: operation => operation !== 'abort' } : null });
  const fetch = request => { const headers = new Headers(request.headers); headers.set('authorization', 'Bearer fictional-token'); return handler(new Request(request, { headers })); };
  const remote = await createRemoteChat({ endpoint, fetch, pollMs: 10 });
  const controller = createNativeChatController({ identity, ...remote });
  t.after(() => controller.dispose());
  await controller.connect();
  const agent = () => controller.getSnapshot().view.docs['pi.agent'];
  assert.equal(agent().model.modelId, 'fictional-small');
  const served = () => texts(controller.getSnapshot().view);

  assert.deepEqual(await remote.configure({ model: ref('fictional-large'), thinkingLevel: 'high' }), { kind: 'configured' });
  await until('the remote view shows the change', () => agent().model.modelId === 'fictional-large' && agent().thinkingLevel === 'high');
  controller.setText('Which model?');
  await (await controller.send()).wait(remote.context);
  await until('the next request used the new model', () => served().includes('served by fictional-large'));

  // A refused change leaves the agent untouched, and so does a malformed one.
  assert.deepEqual(await remote.configure({ model: ref('fictional-forbidden') }), { kind: 'refused', reason: 'model-not-offered' });
  assert.deepEqual(await remote.configure({ thinkingLevel: 'max' }), { kind: 'refused', reason: 'level-not-offered' });
  assert.equal((await fetch(new Request(`${endpoint}?op=configure`, { method: 'POST', headers: json, body: '{}' }))).status, 400);
  assert.equal((await fetch(new Request(`${endpoint}?op=configure`, { method: 'POST', headers: json, body: '{"model":{"provider":1}}' }))).status, 400);
  assert.equal(attempts.length, 3, 'malformed calls never reach the host');
  assert.equal(agent().model.modelId, 'fictional-large'); assert.equal(agent().thinkingLevel, 'high');
  controller.setText('Again?');
  await (await controller.send()).wait(remote.context);
  await until('still served by the previous choice', () => served().filter(text => text === 'served by fictional-large').length === 2);

  assert.equal((await handler(new Request(`${endpoint}?op=configure`, { method: 'POST', headers: json, body: '{"thinkingLevel":"low"}' }))).status, 401);
  assert.equal(attempts.length, 3);
});

test('configure is refused when allow says no and not supported without a host function', async t => {
  const refusing = await fixture(t, { configure: async () => ({ kind: 'configured' }), allow: operation => operation !== 'configure' });
  const body = JSON.stringify({ thinkingLevel: 'low' });
  assert.equal((await refusing.fetch(new Request(`${endpoint}?op=configure`, { method: 'POST', headers: json, body }))).status, 403);
  const plain = await fixture(t);
  const response = await plain.fetch(new Request(`${endpoint}?op=configure`, { method: 'POST', headers: json, body }));
  assert.equal(response.status, 404);
  assert.equal((await response.json()).reason, 'not-supported');
  assert.equal((await plain.handler(new Request(`${endpoint}?op=configure`, { method: 'POST', headers: json, body }))).status, 401);
  await assert.rejects((await createRemoteChat({ endpoint, fetch: plain.fetch })).configure({ thinkingLevel: 'low' }), /not-supported/);
});


test('projected chat cannot bypass its projection through raw history', async t => {
  const { conversation, fetch } = await fixture(t, { project: view => ({ ...view, entries: [] }) });
  await conversation.commit(tx => tx.appendEntry(UserEntry, conversation.id, {
    model: [{ role: 'user', content: 'FICTIONAL_PRIVATE_MARKER', timestamp: 1 }],
  }), context);
  const watch = await fetch(new Request(`${endpoint}?op=watch`));
  const reader = watch.body.getReader();
  try {
    assert.ok(!new TextDecoder().decode((await reader.read()).value).includes('FICTIONAL_PRIVATE_MARKER'));
    const history = await fetch(new Request(`${endpoint}?op=entries&limit=10`));
    assert.equal(history.status, 200);
    assert.ok(!(await history.text()).includes('FICTIONAL_PRIVATE_MARKER'));
  } finally { await reader.cancel(); }
  const trusted = createChatTransportHandler({ authenticate: async () => ({ conversation, context }) });
  const history = await trusted(new Request(`${endpoint}?op=entries&limit=10`));
  assert.equal(history.status, 200);
  assert.match(await history.text(), /FICTIONAL_PRIVATE_MARKER/);
});

for (const operation of ['submit', 'answer', 'configure', 'withdraw', 'abort']) {
  test(`transport refuses ${operation} revoked while its authorization is pending`, async t => {
    const revoked = new AbortController();
    const started = Promise.withResolvers(), release = Promise.withResolvers();
    let called = 0;
    const { conversation, fetch } = await fixture(t, { revoked: revoked.signal,
      allow: async () => { started.resolve(); await release.promise; return true; },
      answer: async () => { called++; return {}; }, configure: async () => { called++; return {}; }, abortSubmission: async () => { called++; return 'withdrawn'; },
    });
    const input = { requestId: 'revoked-input', content: 'fictional message', callId: 'fictional-call', answer: 'yes', thinkingLevel: 'low', submissionId: 123 };
    const response = fetch(new Request(`${endpoint}?op=${operation}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) }));
    await started.promise;
    revoked.abort(); release.resolve();
    assert.equal((await response).status, 403);
    assert.equal(called, 0);
    const record = await conversation.commit(tx => tx.submissionByRequest(conversation.id, input.requestId), context);
    assert.equal(record, undefined);
  });
}

for (const operation of ['submit', 'answer', 'configure', 'withdraw']) {
  test(`transport refuses ${operation} revoked while reading its body`, async t => {
    const revoked = new AbortController();
    let called = 0, release;
    const { conversation, fetch } = await fixture(t, { revoked: revoked.signal,
      answer: async () => { called++; return {}; }, configure: async () => { called++; return {}; }, abortSubmission: async () => { called++; return 'withdrawn'; },
    });
    const input = { requestId: 'revoked-body', content: 'fictional message', callId: 'fictional-call', answer: 'yes', thinkingLevel: 'low', submissionId: 123 };
    const stream = new ReadableStream({ start(controller) {
      release = () => { controller.enqueue(new TextEncoder().encode(JSON.stringify(input))); controller.close(); };
    } });
    const response = fetch(new Request(`${endpoint}?op=${operation}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: stream, duplex: 'half' }));
    await new Promise(resolve => setImmediate(resolve));
    revoked.abort(); release();
    assert.equal((await response).status, 403);
    assert.equal(called, 0);
    const record = await conversation.commit(tx => tx.submissionByRequest(conversation.id, input.requestId), context);
    assert.equal(record, undefined);
  });
}

for (const revokeDuringProjection of [false, true]) {
  test(`watch drops undisclosed frames on revocation${revokeDuringProjection ? ' during projection' : ''}`, async () => {
    const revoked = new AbortController(), closed = Promise.withResolvers();
    let push;
    const projected = [];
    const watch = {
      value: { entries: [], docs: {} }, closed: closed.promise,
      start: callback => { push = callback; },
      stop: async () => { closed.resolve({ reason: 'stopped' }); },
    };
    const handler = createChatTransportHandler({ authenticate: async () => ({
      conversation: { watch: async () => watch }, context, revoked: revoked.signal,
      project: view => {
        projected.push({ view, revoked: revoked.signal.aborted });
        if (revokeDuringProjection) revoked.abort();
        return view;
      },
    }) });
    const response = await handler(new Request(`${endpoint}?op=watch`));
    const reader = response.body.getReader();
    const first = await reader.read();
    if (!revokeDuringProjection) {
      assert.match(new TextDecoder().decode(first.value), /"kind":"view"/);
      void push({ entries: ['FIRST'], docs: {} }, []);
      void push({ entries: ['SECRET_AFTER_REVOKE'], docs: {} }, []);
      revoked.abort();
    }
    let remaining = revokeDuringProjection ? new TextDecoder().decode(first.value) : '';
    for (;;) { const next = await reader.read(); if (next.done) break; remaining += new TextDecoder().decode(next.value); }
    assert.doesNotMatch(remaining, /"kind":"view"|SECRET_AFTER_REVOKE/);
    assert.equal(projected.length, 1);
    assert.ok(projected.every(item => !item.revoked), 'no projection runs after revocation');
  });
}

test('revocation while host prepares mentions prevents native submission', async t => {
  const entered = Promise.withResolvers(), release = Promise.withResolvers(), revoked = new AbortController();
  const f = await fixture(t, { revoked: revoked.signal, prepareInput: async value => {
    entered.resolve(); await release.promise; return value;
  } });
  const response = f.fetch(new Request(`${endpoint}?op=submit`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ requestId: 'prepared-revoked', content: '@fictional.md' }) }));
  await entered.promise;
  revoked.abort(); release.resolve();
  assert.equal((await response).status, 403);
  const record = await f.conversation.commit(tx => tx.submissionByRequest(f.conversation.id, 'prepared-revoked'), context);
  assert.equal(record, undefined);
  assert.equal(f.fake.calls.length, 0);
});
