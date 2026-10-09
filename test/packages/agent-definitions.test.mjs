import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { defineTool } from '@earendil-works/pi-durable';
import { Type } from '@earendil-works/pi-ai';
import { openSqliteWorkspaces } from '../../examples/shared/sqlite-workspaces.mjs';
import { loadAgentDefinition } from '@hachej/boring-agent/definitions';

const encoder = new TextEncoder();
const source = (instructions = 'Fictional selected instructions', tools = ['alpha']) => JSON.stringify({
  format: 'boring.agent', version: 1, instructions, tools,
});
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const target = path => ({ resource: { providerId: 'definitions', path }, view: { kind: 'published' } });
const access = () => ({ scopeId: 'fictional-team', principalId: 'fictional-member', initiatorId: 'fictional-requester' });
const tool = name => defineTool({ name, description: `Fictional ${name}`, parameters: Type.Object({}), replay: 'unsafe',
  execute: async () => ({ content: [{ type: 'text', text: name }] }) });
const alpha = tool('alpha'), beta = tool('beta');
const available = { alpha: { tool: alpha, implementationVersion: 'alpha-v1' }, beta: { tool: beta, implementationVersion: 'beta-v1' } };
const resolveTool = name => available[name];

async function fixture(t, options = {}) {
  const provider = openSqliteWorkspaces({ filename: ':memory:', providerId: 'definitions', authorize: options.authorize ?? (() => true) });
  t.after(() => provider.close());
  let sequence = 0;
  const publish = async (path, text, mediaType = 'application/json') => {
    const bytes = typeof text === 'string' ? encoder.encode(text) : text;
    const outcome = await provider.publication.publish({ operationId: `seed-${++sequence}`, atomicity: 'all-or-nothing',
      changes: [{ kind: 'create', target: target(path), expected: { kind: 'absent' }, bytes, mediaType }] }, access());
    assert.equal(outcome.kind, 'committed');
    return { ref: outcome.receipt.changes[0].after, bytes };
  };
  const optionsFor = (ref, overrides = {}) => ({ reader: provider, ref, access: access(),
    implementationVersion: 'host-v1', resolveTool, ...overrides });
  return { provider, publish, optionsFor };
}

test('exact published bytes and selected revision determine the returned native change and binding', async t => {
  const f = await fixture(t);
  const first = await f.publish('agent.json', source());
  const loaded = await loadAgentDefinition(f.optionsFor(first.ref));
  assert.equal(loaded.change.instructions, 'Fictional selected instructions');
  assert.deepEqual(loaded.change.tools, [alpha]);
  assert.deepEqual(loaded.binding.ref, first.ref);
  assert.equal(loaded.binding.scopeId, access().scopeId);
  assert.equal(loaded.binding.digest, digest(first.bytes));
  assert.equal(loaded.binding.formatVersion, 1);
  assert.equal(loaded.binding.nativeVersion, 'pi-durable@1.0.1');
  assert.equal(loaded.binding.implementationVersion, 'host-v1');
  assert.deepEqual(loaded.binding.tools, [{ name: 'alpha', implementationVersion: 'alpha-v1' }]);
  const latest = await f.provider.publication.publish({ operationId: 'replace', atomicity: 'all-or-nothing', changes: [{
    kind: 'replace', target: first.ref, bytes: encoder.encode(source('Different latest instructions', ['beta'])),
    mediaType: 'application/json',
  }] }, access());
  assert.equal(latest.kind, 'committed');
  assert.equal((await loadAgentDefinition(f.optionsFor(first.ref))).binding.digest, digest(first.bytes));
  const changed = await loadAgentDefinition(f.optionsFor(latest.receipt.changes[0].after));
  assert.equal(changed.change.instructions, 'Different latest instructions');
  assert.deepEqual(changed.change.tools, [beta]);
  assert.notEqual(changed.binding.digest, loaded.binding.digest);
});

test('empty tool selection produces an explicit empty native tool array', async t => {
  const f = await fixture(t);
  const { ref } = await f.publish('empty.json', source('Instructions only', []));
  let resolves = 0;
  const loaded = await loadAgentDefinition(f.optionsFor(ref, { resolveTool: () => { resolves++; throw new Error('Unexpected resolver call'); } }));
  assert.equal(loaded.change.instructions, 'Instructions only');
  assert.deepEqual(loaded.change.tools, []);
  assert.deepEqual(loaded.binding.tools, []);
  assert.equal(resolves, 0);
});

test('unavailable, denied and malformed resource reads fail without exposing private provider errors', async t => {
  let granted = true;
  const f = await fixture(t, { authorize: () => granted });
  const { ref } = await f.publish('read.json', source());
  granted = false;
  await assert.rejects(loadAgentDefinition(f.optionsFor(ref)));
  granted = true;
  const good = (await f.provider.read({ target: target('read.json'), revision: { kind: 'exact', value: ref.revision } }, access())).snapshot;
  const bad = [
    { kind: 'missing' }, { kind: 'unavailable' },
    { kind: 'available', snapshot: { ...good, ref: { ...good.ref, resource: { ...good.ref.resource, path: 'redirected.json' } } } },
    { kind: 'available', snapshot: { ...good, ref: { ...good.ref, resource: { ...good.ref.resource, providerId: 'other-provider' } } } },
    { kind: 'available', snapshot: { ...good, ref: { ...good.ref, view: { kind: 'working', viewId: 'other-view' } } } },
    { kind: 'available', snapshot: { ...good, ref: { ...good.ref, revision: 'different-revision' } } },
    { kind: 'available', snapshot: { ...good, bytes: 'not binary bytes' } },
  ];
  for (const response of bad) await assert.rejects(loadAgentDefinition(f.optionsFor(ref, { reader: { read: async () => response } })));
  await assert.rejects(loadAgentDefinition(f.optionsFor(ref, { reader: { read: async () => {
    throw new Error('FICTIONAL_PRIVATE_PROVIDER_ERROR');
  } } })), error => !String(error).includes('FICTIONAL_PRIVATE_PROVIDER_ERROR'));
});

test('definition grammar, byte bound, UTF-8 and MIME are enforced before native selection', async t => {
  const f = await fixture(t);
  const malformed = [
    '{', JSON.stringify({ format: 'boring.agent', version: 1, instructions: '', tools: [], executable: 'import private' }),
    JSON.stringify({ format: 'boring.agent', version: 2, instructions: '', tools: [] }),
    JSON.stringify({ format: 'boring.agent', version: 1, instructions: '', tools: ['alpha', 'alpha'] }),
    JSON.stringify({ format: 'boring.agent', version: 1, instructions: '', tools: ['bad\u0000name'] }),
    JSON.stringify({ format: 'boring.agent', version: 1, instructions: '', tools: Array.from({ length: 65 }, (_, index) => `tool-${index}`) }),
    JSON.stringify({ format: 'boring.agent', version: 1, instructions: 3, tools: [] }),
    JSON.stringify({ format: 'boring.agent', version: 1, instructions: '', tools: 'alpha' }),
    JSON.stringify({ format: 'boring.agent', version: 1, instructions: '\ud800', tools: [] }),
  ];
  for (const [index, value] of malformed.entries()) {
    const { ref } = await f.publish(`bad-${index}.json`, value);
    await assert.rejects(loadAgentDefinition(f.optionsFor(ref)));
  }
  const invalidUtf8 = await f.publish('invalid-utf8.json', Uint8Array.of(0xc3, 0x28));
  await assert.rejects(loadAgentDefinition(f.optionsFor(invalidUtf8.ref)));
  const wrongMime = await f.publish('wrong-mime.json', source(), 'text/plain');
  await assert.rejects(loadAgentDefinition(f.optionsFor(wrongMime.ref)));
  const extraParameter = await f.publish('extra-parameter.json', source(), 'application/json; profile=private');
  await assert.rejects(loadAgentDefinition(f.optionsFor(extraParameter.ref)));
  const accepted = await f.publish('mixed-mime.json', source(), ' Application/JSON ; Charset=UTF-8 ');
  assert.equal((await loadAgentDefinition(f.optionsFor(accepted.ref))).change.tools[0], alpha);
  const unicode = '\ufeffFictional 🥔';
  const wellFormed = await f.publish('unicode.json', source(unicode, []));
  assert.equal((await loadAgentDefinition(f.optionsFor(wellFormed.ref))).change.instructions, unicode);
  const small = await f.publish('too-large.json', source());
  await assert.rejects(loadAgentDefinition(f.optionsFor(small.ref, { maxBytes: small.bytes.length - 1 })));
  for (const maxBytes of [0, 1.5, 1048577]) await assert.rejects(loadAgentDefinition(f.optionsFor(small.ref, { maxBytes })));
});

test('resolver rejects unknown, forbidden, misnamed or unversioned tools and current revocation', async t => {
  const f = await fixture(t);
  const { ref } = await f.publish('tools.json', source());
  for (const resolve of [
    () => undefined,
    () => ({ tool: beta, implementationVersion: 'beta-v1' }),
    () => ({ tool: alpha, implementationVersion: '' }),
    () => { throw new Error('FICTIONAL_PRIVATE_RESOLVER_ERROR'); },
  ]) await assert.rejects(loadAgentDefinition(f.optionsFor(ref, { resolveTool: resolve })),
    error => !String(error).includes('FICTIONAL_PRIVATE_RESOLVER_ERROR'));
  const loaded = await loadAgentDefinition(f.optionsFor(ref));
  await assert.rejects(loadAgentDefinition(f.optionsFor(ref, { expectedBinding: loaded.binding, resolveTool: () => undefined })));
  await assert.rejects(loadAgentDefinition(f.optionsFor(ref, { implementationVersion: 'x'.repeat(1025) })));
  await assert.rejects(loadAgentDefinition(f.optionsFor(ref, { resolveTool: () => ({ tool: alpha, implementationVersion: 'x'.repeat(1025) }) })));
});

test('expected binding compares canonical fields, selected scope and current tool versions', async t => {
  const f = await fixture(t);
  const { ref } = await f.publish('binding.json', source());
  const loaded = await loadAgentDefinition(f.optionsFor(ref));
  const reordered = Object.fromEntries(Object.entries(loaded.binding).reverse());
  assert.deepEqual((await loadAgentDefinition(f.optionsFor(ref, { expectedBinding: reordered }))).binding, loaded.binding);
  const mismatches = [
    { ref: { ...ref, revision: 'other' } }, { scopeId: 'other-scope' }, { digest: '0'.repeat(64) },
    { nativeVersion: 'different-native' }, { implementationVersion: 'host-v2' },
    { tools: [{ name: 'alpha', implementationVersion: 'alpha-v2' }] },
  ];
  for (const mismatch of mismatches) await assert.rejects(loadAgentDefinition(f.optionsFor(ref, {
    expectedBinding: { ...loaded.binding, ...mismatch },
  })));
  await assert.rejects(loadAgentDefinition(f.optionsFor(ref, { expectedBinding: loaded.binding,
    resolveTool: () => ({ tool: alpha, implementationVersion: 'alpha-v2' }) })));
});

test('selection copies caller objects and returned bytes before provider and resolver await', async t => {
  const f = await fixture(t);
  const { ref } = await f.publish('capture.json', source());
  const original = (await f.provider.read({ target: target('capture.json'), revision: { kind: 'exact', value: ref.revision } }, access())).snapshot;
  const expectedBinding = structuredClone((await loadAgentDefinition(f.optionsFor(ref))).binding);
  const refInput = structuredClone(ref), accessInput = access(), bytes = original.bytes.slice();
  let readRelease, resolveRelease, observedTarget, observedAccess;
  const reader = { read: async (request, actor) => {
    observedTarget = structuredClone(request); observedAccess = structuredClone(actor);
    await new Promise(resolve => { readRelease = resolve; });
    request.target.resource.path = 'provider-mutated.json'; actor.scopeId = 'provider-mutated';
    return { kind: 'available', snapshot: { ...original, bytes } };
  } };
  const options = f.optionsFor(refInput, { reader, access: accessInput, expectedBinding,
    resolveTool: async () => { await new Promise(resolve => { resolveRelease = resolve; }); return available.alpha; } });
  const pending = loadAgentDefinition(options);
  await Promise.resolve();
  refInput.resource.path = 'caller-mutated.json'; accessInput.scopeId = 'caller-mutated';
  expectedBinding.scopeId = 'caller-mutated';
  options.resolveTool = () => available.beta;
  reader.read = async () => { throw new Error('Reader swapped by caller'); };
  readRelease();
  while (!resolveRelease) await new Promise(resolve => setImmediate(resolve));
  bytes.fill(0);
  resolveRelease();
  const loaded = await pending;
  assert.deepEqual(observedTarget, { target: target('capture.json'), revision: { kind: 'exact', value: ref.revision } });
  assert.equal(observedAccess.scopeId, 'fictional-team');
  assert.equal(loaded.binding.ref.resource.path, 'capture.json');
  assert.equal(loaded.binding.scopeId, 'fictional-team');
  assert.equal(loaded.binding.digest, digest(original.bytes));
  assert.equal(loaded.change.tools[0], alpha);
});

test('abort during read or resolver await refuses a selected definition', async t => {
  const f = await fixture(t);
  const { ref } = await f.publish('abort.json', source());
  for (const stage of ['read', 'resolve']) {
    const controller = new AbortController();
    const reader = { read: async (request, actor) => {
      assert.equal(actor.signal, controller.signal);
      const result = await f.provider.read(request, actor);
      if (stage === 'read') controller.abort();
      return result;
    } };
    const resolve = name => { if (stage === 'resolve') controller.abort(); return resolveTool(name); };
    await assert.rejects(loadAgentDefinition(f.optionsFor(ref, { reader, resolveTool: resolve,
      access: { ...access(), signal: controller.signal } })));
  }
});

test('definition tool resolver retains its options receiver', async t => {
  const f = await fixture(t);
  const { ref } = await f.publish('receiver.json', source());
  const options = f.optionsFor(ref, { permitted: available,
    resolveTool(name) { return this.permitted[name]; } });
  const loaded = await loadAgentDefinition(options);
  assert.deepEqual(loaded.change.tools, [alpha]);
  assert.deepEqual(loaded.binding.tools, [{ name: 'alpha', implementationVersion: 'alpha-v1' }]);
});
