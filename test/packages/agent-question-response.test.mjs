import assert from 'node:assert/strict';
import test from 'node:test';
import { Harness, MemoryStorage, createRegistry } from '@earendil-works/pi-durable';
import { createModels } from '@earendil-works/pi-ai/models';
import { BACKGROUND_CONTEXT as background, createContextKey, withContextValue } from '@earendil-works/chord/context';
import { createQuestions } from '@hachej/boring-agent/questions';
import { createQuestionResponseHandler } from '@hachej/boring-agent/question-response';

const actorKey = createContextKey('fictional authenticated human');
async function fixture(t) {
  const policy = { allowed: true, current: true, now: Date.now() };
  const context = withContextValue(actorKey, { principalId: 'fictional-human', scopeId: 'cabinet' }, background);
  const questions = createQuestions({ runtimeId: 'original-runtime', authorize: (_ref, _action, ctx) => policy.allowed ? ctx.value(actorKey) : undefined,
    isCurrent: () => policy.current, now: () => policy.now });
  const registry = createRegistry(); registry.install(questions.extension);
  const harness = await Harness.open(new MemoryStorage(), { registry, models: createModels() }, background);
  t.after(() => harness.close(background));
  const conversation = await harness.root(background);
  const ref = await conversation.commit(tx => questions.admit(tx, { conversationId: conversation.id, questionId: 'format', scopeId: 'cabinet',
    subjectDigest: 'draft-one', policyVersion: 'policy-one', expiresAt: new Date(policy.now + 60_000).toISOString(), prompt: 'Private fictional prompt', choices: ['brief', 'detailed'] }, { kind: 'conversation' }, context), context);
  const revoked = new AbortController();
  const access = { conversation, questions, context, ref, revoked: revoked.signal };
  const authenticateHuman = async request => request.headers.get('authorization') === 'Bearer fictional-test-token' ? access : null;
  const handler = createQuestionResponseHandler({ authenticateHuman });
  const body = overrides => ({ schema: 'boring.question-response', version: 1, target: ref, resolutionId: 'response-one', answer: 'brief', ...overrides });
  const request = (overrides, init = {}) => new Request('https://fictional.invalid/questions/format', {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer fictional-test-token' }, body: JSON.stringify(body(overrides)), ...init,
  });
  const state = async () => (await harness.snapshot(questions.documents, questions.documentKey(ref), background)).question.state;
  return { policy, context, questions, harness, conversation, ref, access, revoked, authenticateHuman, handler, body, request, state };
}

test('authenticated response resolves the original native question once and preserves its human identity', async t => {
  const f = await fixture(t);
  const response = await f.handler(f.request());
  assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store');
  const result = await response.json();
  assert.deepEqual(result.decision, { kind: 'resolved', resolutionId: 'response-one', answer: 'brief' });
  assert.equal(JSON.stringify(result).includes('Private fictional prompt'), false);
  assert.equal((await f.state()).resolution.responderId, 'fictional-human');
  assert.equal((await f.harness.waitForTask(f.ref.taskId, background)).state.outcome.result.answer, 'brief');
  assert.equal((await f.handler(f.request())).status, 200);
  assert.equal((await f.handler(f.request({ resolutionId: 'different', answer: 'detailed' }))).status, 409);
  assert.equal((await f.state()).resolution.resolutionId, 'response-one');
});

test('wire identity and human context cannot replace the original native commit policy', async t => {
  const f = await fixture(t);
  assert.equal((await f.handler(f.request(undefined, { headers: { 'content-type': 'application/json' } }))).status, 401);
  for (const key of Object.keys(f.ref)) {
    assert.equal((await f.handler(f.request({ target: { ...f.ref, [key]: 'foreign' } }))).status, 409, key);
  }
  assert.equal((await f.handler(f.request({ principalId: 'forged-human' }))).status, 400);
  assert.equal((await f.handler(f.request({ answer: 'not-offered' }))).status, 409);
  f.access.context = background;
  assert.equal((await f.handler(f.request())).status, 403);
  f.access.context = f.context;
  f.policy.allowed = false;
  assert.equal((await f.handler(f.request())).status, 403);
  f.policy.allowed = true; f.policy.current = false;
  assert.equal((await f.handler(f.request())).status, 409);
  assert.equal((await f.state()).kind, 'pending');
});

test('bounded JSON parsing rejects streamed overflow, malformed UTF-8 and unexpected shapes before mutation', async t => {
  const f = await fixture(t);
  assert.equal((await f.handler(f.request(undefined, { method: 'PUT' }))).status, 405);
  assert.equal((await f.handler(f.request(undefined, { headers: { 'content-type': 'text/plain' } }))).status, 415);
  for (const body of ['null', '{}', '{', new Uint8Array([0xff])]) assert.equal((await f.handler(f.request(undefined, { body }))).status, 400);
  let cancelled = false;
  const stream = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(9)); }, cancel() { cancelled = true; } });
  const bounded = createQuestionResponseHandler({ authenticateHuman: f.authenticateHuman, maxBodyBytes: 8 });
  assert.equal((await bounded(f.request(undefined, { body: stream, duplex: 'half' }))).status, 413);
  assert.equal(cancelled, true); assert.equal((await f.state()).kind, 'pending');
  assert.throws(() => createQuestionResponseHandler({ authenticateHuman: f.authenticateHuman, maxBodyBytes: Infinity }), /positive/);
});

test('a host-selected commit conversation must match the bound original reference', async t => {
  const f = await fixture(t);
  let called = false;
  f.access.conversation = { id: f.ref.conversationId + 1, commit: () => { called = true; throw new Error('must not enter'); } };
  assert.equal((await f.handler(f.request())).status, 403);
  assert.equal(called, false); assert.equal((await f.state()).kind, 'pending');
});

test('revocation during native resolution rolls back; late revocation preserves committed evidence', async t => {
  const before = await fixture(t);
  before.access.questions = { resolve: async (...args) => {
    const decision = await before.questions.resolve(...args); before.revoked.abort(); return decision;
  } };
  assert.equal((await before.handler(before.request())).status, 503);
  assert.equal((await before.state()).kind, 'pending');
  const after = await fixture(t);
  after.access.conversation = { id: after.conversation.id, commit: async (...args) => {
    const result = await after.conversation.commit(...args); after.revoked.abort(); return result;
  } };
  const response = await after.handler(after.request());
  assert.equal(response.status, 503);
  assert.equal((await response.json()).kind, 'resolution-not-confirmed');
  assert.equal((await after.state()).kind, 'resolved');
  after.access.conversation = after.conversation;
  after.access.revoked = new AbortController().signal;
  assert.equal((await after.handler(after.request())).status, 200);
});

test('aborted body reads and pre-revoked requests cannot resolve; expiry remains native', async t => {
  const f = await fixture(t), controller = new AbortController();
  const stream = new ReadableStream({ pull() { controller.abort(); } });
  assert.equal((await f.handler(f.request(undefined, { body: stream, duplex: 'half', signal: controller.signal }))).status, 403);
  assert.equal((await f.state()).kind, 'pending');
  f.revoked.abort();
  assert.equal((await f.handler(f.request())).status, 403);
  f.access.revoked = new AbortController().signal; f.policy.now += 60_001;
  const expired = await f.handler(f.request());
  assert.equal(expired.status, 409); assert.equal((await expired.json()).decision.kind, 'expired');
});

test('overflow responds even when the request source never acknowledges cancellation', { timeout: 2000 }, async t => {
  const f = await fixture(t);
  let cancelled = false;
  const stream = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(9)); }, cancel() { cancelled = true; return new Promise(() => {}); } });
  const handler = createQuestionResponseHandler({ authenticateHuman: f.authenticateHuman, maxBodyBytes: 8 });
  assert.equal((await handler(f.request(undefined, { body: stream, duplex: 'half' }))).status, 413);
  assert.equal(cancelled, true);
  assert.equal((await f.state()).kind, 'pending');
});
