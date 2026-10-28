import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Harness, MemoryStorage, createRegistry, defineTool, defineExtension } from '@earendil-works/pi-durable';
import { openNodeSqliteStorage } from '@earendil-works/pi-durable/storage/sqlite/node';
import { BACKGROUND_CONTEXT as ctx } from '@earendil-works/chord/context';
import { Type } from '@earendil-works/pi-ai';
import { createModels } from '@earendil-works/pi-ai/models';
import { fauxProvider, fauxAssistantMessage as answer, fauxToolCall } from '@earendil-works/pi-ai/providers/faux';
import { createApprovalExtension } from '@hachej/boring-agent/approval';
import { ACTION_PROVIDER, withActionModels, actionReply } from '@hachej/boring-agent/actions';

const schema = Type.Object({ text: Type.String() }, { additionalProperties: false });
const extraction = (args = { text: 'fictional picnic' }) => answer(fauxToolCall('remember', args), { stopReason: 'toolUse' });
const ref = { provider: 'fictional', modelId: 'full' };
const virtual = { provider: ACTION_PROVIDER, modelId: 'clerk' };
const uncertain = 'Outcome unknown; check before retrying.';
function setup(responses, overrides = {}, options = {}) {
  const provider = fauxProvider({ provider: 'fictional', models: [{ id: 'full' }, { id: 'extract' }], tokensPerSecond: Infinity });
  provider.setResponses(responses);
  const models = createModels(); models.setProvider(provider.provider);
  const decisions = [];
  const action = { model: ref, extraction: { model: { ...ref, modelId: 'extract' }, instructions: 'Extract one new note.', tool: { name: 'remember', description: 'Extract a note.', parameters: schema } },
    decide: async input => { decisions.push(input); return true; }, reply: 'Saved {text}.', uncertainReply: uncertain, ...overrides };
  return { provider, models: withActionModels(models, { ...options, resolve: id => id === 'clerk' ? action : undefined }), action, decisions };
}
async function open(fixture, { storage = new MemoryStorage(), execute, extensions = [], settings } = {}) {
  const writes = [];
  const tool = defineTool({ name: 'remember', description: 'Save note.', parameters: schema, replay: 'safe', execute: execute ?? (async args => { writes.push(args); return { output: [{ type: 'text', text: JSON.stringify(args) }] }; }) });
  const registry = createRegistry();
  const domain = defineExtension({ name: 'fictional.notes', tools: [tool] }); registry.install(domain);
  for (const extension of extensions) registry.install(extension);
  const harness = await Harness.open(storage, { registry, models: fixture.models, settings }, ctx);
  const conversation = await harness.createConversation({ ownership: { kind: 'ownerless' }, agent: { model: virtual, extensions: [domain, ...extensions] } }, ctx);
  return { harness, conversation, writes };
}
const say = async (conversation, content = 'Remember the fictional picnic', requestId) => (await conversation.submit({ type: 'input', content, ...(requestId ? { requestId } : {}) }, ctx)).wait(ctx);
const text = async conversation => (await conversation.context(ctx)).messages.filter(m => m.role === 'assistant').at(-1).content.filter(p => p.type === 'text').map(p => p.text).join('');

test('one extraction, native operation and automatic reply; durable history and duplicate submission after reopen', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'actions-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const file = join(directory, 'native.sqlite');
  const fixture = setup([extraction()]);
  const first = await open(fixture, { storage: await openNodeSqliteStorage(file) });
  const id = first.conversation.id;
  try {
    await say(first.conversation, undefined, 'request-1');
    assert.equal(await text(first.conversation), 'Saved fictional picnic.');
    assert.equal(fixture.provider.state.callCount, 1);
    assert.equal(first.writes.length, 1);
  } finally { await first.harness.close(ctx); }
  fixture.action.decide = async () => false;
  fixture.provider.appendResponses([request => { assert.match(JSON.stringify(request), /Saved fictional picnic/); return answer('Still remembered.'); }]);
  const second = await open(fixture, { storage: await openNodeSqliteStorage(file) });
  try {
    const existing = await second.harness.conversation(id, ctx);
    await say(existing, undefined, 'request-1');
    assert.equal(fixture.provider.state.callCount, 1);
    await say(existing, 'What was saved?');
    assert.equal(await text(existing), 'Still remembered.');
    assert.equal(second.writes.length, 0);
  } finally { await second.harness.close(ctx); }
});

for (const [name, first] of [['invalid arguments', extraction({ wrong: true })], ['multiple calls', answer([fauxToolCall('remember', { text: 'a' }), fauxToolCall('remember', { text: 'b' })], { stopReason: 'toolUse' })], ['refusal', answer('Cannot extract.')]]) {
  test(`${name}: full model before any mutation`, async t => {
    const fixture = setup([first, answer('Please clarify.')]);
    const run = await open(fixture); t.after(() => run.harness.close(ctx));
    await say(run.conversation);
    assert.equal(await text(run.conversation), 'Please clarify.');
    assert.equal(run.writes.length, 0);
    assert.equal(fixture.provider.state.callCount, 2);
  });
}

for (const result of [{ isError: true, output: [{ type: 'text', text: 'Transport lost' }] }, { output: [{ type: 'text', text: '{}' }] }]) {
  test('uncertain write or missing result never asks a model to repeat the operation', async t => {
    const fixture = setup([extraction()]); let writes = 0;
    const run = await open(fixture, { execute: async () => { writes++; return result; } }); t.after(() => run.harness.close(ctx));
    await say(run.conversation);
    assert.equal(await text(run.conversation), uncertain);
    assert.equal(writes, 1); assert.equal(fixture.provider.state.callCount, 1);
  });
}

test('host-confirmed atomic refusal can return to full model', async t => {
  const fixture = setup([extraction(), answer('Please review the existing draft.')], { rejectedWithoutEffect: result => result.details?.rejected === true });
  const run = await open(fixture, { execute: async () => ({ isError: true, details: { rejected: true }, output: [{ type: 'text', text: 'Conflict' }] }) });
  t.after(() => run.harness.close(ctx)); await say(run.conversation);
  assert.equal(await text(run.conversation), 'Please review the existing draft.'); assert.equal(fixture.provider.state.callCount, 2);
});

for (const decide of [async () => false, async () => { throw new Error('offline'); }, async () => new Promise(() => {})]) {
  test('decision refusal, failure or timeout uses full model', async t => {
    const fixture = setup([answer('Full answer.')], { decide, decisionTimeoutMs: 5 });
    const run = await open(fixture); t.after(() => run.harness.close(ctx)); await say(run.conversation);
    assert.equal(await text(run.conversation), 'Full answer.'); assert.equal(fixture.provider.state.callCount, 1); assert.equal(run.writes.length, 0);
  });
}

test('native configuration updates do not hide the last user message; removed tools stay removed', async t => {
  const fixture = setup([answer('First answer.'), answer('Full answer.'), extraction()]);
  const decide = fixture.action.decide; fixture.action.decide = async () => false;
  const run = await open(fixture); t.after(() => run.harness.close(ctx));
  await say(run.conversation, 'Hello');
  fixture.action.decide = decide;
  await run.conversation.configure({ tools: [] }, ctx);
  await say(run.conversation);
  assert.equal(fixture.decisions.length, 0); assert.equal(run.writes.length, 0);
  await run.conversation.configure({ tools: [{ name: 'remember' }], instructions: 'Updated instructions.' }, ctx);
  await say(run.conversation);
  assert.equal(await text(run.conversation), 'Saved fictional picnic.'); assert.equal(run.writes.length, 1);
});

test('native summarization-shaped requests delegate without a decision or extraction', async () => {
  const fixture = setup([answer('Compacted.')]);
  const result = await fixture.models.completeSimple(fixture.models.getModel(ACTION_PROVIDER, 'clerk'), { messages: [
    { role: 'system', content: 'Summarize this conversation.', timestamp: 0 },
    { role: 'user', content: 'Summarize.', timestamp: 0 },
  ] });
  assert.equal(result.content[0].text, 'Compacted.'); assert.equal(fixture.decisions.length, 0);
});

test('reply substitution never invents missing values', () => {
  assert.equal(actionReply('{total} {warnings}', { total: 12, warnings: ['a', 'b'] }), '12 a\nb');
  assert.throws(() => actionReply('{missing}', {}), /Missing/);
});

test('native tool permission gate still blocks the action', async t => {
  const fixture = setup([extraction()]);
  const gate = createApprovalExtension({ tools: {}, unlisted: 'deny' });
  const run = await open(fixture, { extensions: [gate] }); t.after(() => run.harness.close(ctx));
  await say(run.conversation);
  assert.equal(run.writes.length, 0); assert.equal(fixture.provider.state.callCount, 1);
  assert.equal(await text(run.conversation), uncertain);
});

test('extraction must also match the currently registered tool schema', async () => {
  const fixture = setup([extraction(), answer('Please clarify.')]);
  const result = await fixture.models.completeSimple(fixture.models.getModel(ACTION_PROVIDER, 'clerk'), {
    tools: [{ name: 'remember', description: 'Requires a number.', parameters: Type.Object({ text: Type.Number() }) }],
    messages: [{ role: 'user', content: 'Remember picnic.', timestamp: 0 }],
  });
  assert.equal(result.content[0].text, 'Please clarify.'); assert.equal(fixture.provider.state.callCount, 2);
});

test('late decision after timeout cannot trigger extraction', async () => {
  let release, decisionSignal;
  const fixture = setup([answer('Full answer.')], { decisionTimeoutMs: 5, decide: ({ signal }) => {
    decisionSignal = signal; return new Promise(resolve => { release = resolve; });
  } });
  const result = await fixture.models.completeSimple(fixture.models.getModel(ACTION_PROVIDER, 'clerk'), {
    tools: [fixture.action.extraction.tool], messages: [{ role: 'user', content: 'Remember picnic.', timestamp: 0 }],
  });
  assert.equal(result.content[0].text, 'Full answer.'); assert.equal(decisionSignal.aborted, true);
  release(true); await new Promise(resolve => setImmediate(resolve));
  assert.equal(fixture.provider.state.callCount, 1);
});

test('split text parts preserve exact input and tool JSON without inserting characters', async t => {
  const fixture = setup([extraction()]);
  const run = await open(fixture, { execute: async () => ({ output: [
    { type: 'text', text: '{"text":"fictional ' }, { type: 'text', text: 'picnic"}' },
  ] }) });
  t.after(() => run.harness.close(ctx));
  await say(run.conversation, [{ type: 'text', text: 'Remember the fictional ' }, { type: 'text', text: 'picnic' }]);
  assert.equal(fixture.decisions[0].message, 'Remember the fictional picnic');
  assert.equal(await text(run.conversation), 'Saved fictional picnic.');
  assert.equal(fixture.provider.state.callCount, 1);
});

test('unavailable action models preserve native model lookup semantics', () => {
  const fixture = setup([]);
  assert.equal(fixture.models.getModel(ACTION_PROVIDER, 'removed'), undefined);
  fixture.action.model = { ...ref, modelId: 'removed' };
  assert.equal(fixture.models.getModel(ACTION_PROVIDER, 'clerk'), undefined);
});

test('deferred full-model responses can be fetched and cancelled through the adapter', async () => {
  const fixture = setup([answer('Deferred answer.'), answer('Cancelled answer.')], { decide: async () => false });
  const model = fixture.models.getModel(ACTION_PROVIDER, 'clerk');
  const context = { messages: [{ role: 'user', content: 'Hello', timestamp: 0 }] };
  const first = await fixture.models.completeSimple(model, context, { deferred: true });
  assert.equal(first.stopReason, 'deferred');
  const completed = await fixture.models.fetchDeferred(model, first.deferred);
  assert.equal(completed.stopReason, 'stop');
  assert.equal(completed.content[0].text, 'Deferred answer.');
  const second = await fixture.models.completeSimple(model, context, { deferred: true });
  await fixture.models.cancelDeferred(model, second.deferred);
  assert.deepEqual(fixture.provider.state.cancelledDeferred, [second.deferred]);
});

test('a throwing rejection predicate leaves an uncertain reply without another request', async t => {
  const fixture = setup([extraction()], { rejectedWithoutEffect: () => { throw new Error('Unexpected details'); } });
  const run = await open(fixture, { execute: async () => ({ isError: true, output: [{ type: 'text', text: 'Unknown outcome' }] }) });
  t.after(() => run.harness.close(ctx));
  await say(run.conversation);
  assert.equal(await text(run.conversation), uncertain);
  assert.equal(fixture.provider.state.callCount, 1);
});

test('native deferred generation skips extraction and completes through polling', async t => {
  const fixture = setup([answer('Deferred answer.')]);
  const run = await open(fixture, { settings: { stream: { deferred: true } } });
  t.after(() => run.harness.close(ctx));
  await say(run.conversation);
  assert.equal(await text(run.conversation), 'Deferred answer.');
  assert.equal(fixture.decisions.length, 0);
  assert.equal(fixture.provider.state.callCount, 1);
  assert.equal(fixture.provider.state.deferredFetchCount, 1);
  assert.equal(run.writes.length, 0);
});


test('context preparation is lazy: successful action skips it, fallback awaits it and preserves cancellation', async t => {
  let preparations = 0;
  const fixture = setup([extraction(), request => {
    assert.match(JSON.stringify(request), /Prepared fictional history/);
    return answer('Contextual answer.');
  }], {}, { prepareFullContext: async (context, options) => {
    preparations++;
    assert.ok(options.signal instanceof AbortSignal);
    return { ...context, messages: [...context.messages, { role: 'user', content: 'Prepared fictional history', timestamp: 1 }] };
  } });
  const run = await open(fixture); t.after(() => run.harness.close(ctx));
  await say(run.conversation);
  assert.equal(preparations, 0);
  assert.equal(await text(run.conversation), 'Saved fictional picnic.');
  fixture.action.decide = async () => false;
  await say(run.conversation, 'What did I record?');
  assert.equal(preparations, 1);
  assert.equal(await text(run.conversation), 'Contextual answer.');
});

test('failed context preparation never sends the unprepared fallback to a model', async t => {
  const fixture = setup([answer('Must not run')], { decide: async () => false }, {
    prepareFullContext: async () => { throw new Error('memory unavailable'); },
  });
  const run = await open(fixture); t.after(() => run.harness.close(ctx));
  await say(run.conversation);
  assert.equal(fixture.provider.state.callCount, 0);
  assert.equal(run.writes.length, 0);
});
