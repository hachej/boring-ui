import assert from 'node:assert/strict';
import test from 'node:test';
import { PublicationNotDispatchedError } from '@hachej/boring-files/publication';
import { openSqliteWorkspaces } from '../../examples/shared/sqlite-workspaces.mjs';
import { createResourceClient, createResourceHandler } from '@hachej/boring-files/remote';

const identity = { scopeId: 'fictional-project', principalId: 'fictional-editor', initiatorId: 'alice' };
const target = (path, view = { kind: 'published' }) => ({ resource: { providerId: 'documents', path }, view });
const latest = path => ({ target: target(path), revision: { kind: 'latest' } });
const exact = (path, revision) => ({ target: target(path), revision: { kind: 'exact', value: revision } });
const create = (operationId, path, bytes, mediaType = 'application/octet-stream') => ({ operationId, atomicity: 'all-or-nothing', changes: [{ kind: 'create', target: target(path), expected: { kind: 'absent' }, bytes, mediaType }] });
const replace = (operationId, ref, bytes, mediaType = 'application/octet-stream') => ({ operationId, atomicity: 'all-or-nothing', changes: [{ kind: 'replace', target: ref, bytes, mediaType }] });
const remove = (operationId, ref) => ({ operationId, atomicity: 'all-or-nothing', changes: [{ kind: 'delete', target: ref }] });

function fixture(t, options = {}) {
  const provider = openSqliteWorkspaces({ filename: ':memory:', providerId: 'documents', authorize: options.authorize ?? (() => true) });
  t.after(() => provider.close());
  let access = { ...identity };
  const handler = createResourceHandler({
    authenticate: async () => access,
    reader: provider,
    publisher: options.publisher ?? provider.publication,
    lookup: provider.reconciliation,
    ...(options.maxRequestBytes === undefined ? {} : { maxRequestBytes: options.maxRequestBytes }),
    ...(options.maxResponseBytes === undefined ? {} : { maxResponseBytes: options.maxResponseBytes }),
  });
  const client = (overrides = {}) => createResourceClient({
    identity,
    endpoint: 'https://fictional.invalid/resources',
    fetch: request => handler(request),
    publication: true,
    reconciliation: true,
    ...overrides,
  });
  return { provider, handler, client, setAccess: value => { access = value; } };
}

test('Fetch transport retains binary bytes, media type and exact history through replace, and relays a refused delete', async t => {
  const { client } = fixture(t);
  const bytes = Uint8Array.of(0, 255, 128, 1);
  const first = await client().publish(create('binary-create', 'image.bin', bytes));
  assert.equal(first.kind, 'committed');
  const before = first.receipt.changes[0].after;
  const read = await client().read(latest('image.bin'));
  assert.equal(read.kind, 'available');
  assert.deepEqual(read.snapshot.bytes, bytes);
  assert.equal(read.snapshot.mediaType, 'application/octet-stream');
  assert.deepEqual(read.snapshot.ref, before);

  const second = await client().publish(replace('binary-replace', before, Uint8Array.of(2, 3)));
  assert.equal(second.kind, 'committed');
  assert.deepEqual((await client().read(latest('image.bin'))).snapshot.bytes, Uint8Array.of(2, 3));
  assert.deepEqual((await client().read(exact('image.bin', before.revision))).snapshot.bytes, bytes);
  // The workspace provider does not delete through publication: the transport carries its refusal, and nothing changes.
  const deleted = await client().publish(remove('binary-delete', second.receipt.changes[0].after));
  assert.equal(deleted.kind, 'unavailable');
  assert.deepEqual((await client().read(latest('image.bin'))).snapshot.bytes, Uint8Array.of(2, 3));
  assert.deepEqual((await client().read(exact('image.bin', before.revision))).snapshot.bytes, bytes);
  assert.equal((await client().lookup('binary-delete')).kind, 'not-found');
});

test('stale replacement, absence conflict and read dependency reject the whole batch', async t => {
  const { client } = fixture(t);
  const created = await client().publish(create('base', 'notes.md', Uint8Array.of(1)));
  const old = created.receipt.changes[0].after;
  const newer = await client().publish(replace('advance', old, Uint8Array.of(2)));
  assert.equal(newer.kind, 'committed');
  const stale = { operationId: 'stale-batch', atomicity: 'all-or-nothing', changes: [
    replace('unused', old, Uint8Array.of(3)).changes[0], create('unused', 'other.md', Uint8Array.of(4)).changes[0],
  ] };
  assert.equal((await client().publish(stale)).kind, 'conflict');
  assert.equal((await client().read(latest('other.md'))).kind, 'missing');
  assert.equal((await client().publish(create('absence', 'notes.md', Uint8Array.of(5)))).kind, 'conflict');
  const dependent = { ...create('dependent', 'summary.md', Uint8Array.of(6)), preconditions: [{ kind: 'revision', target: old }] };
  assert.equal((await client().publish(dependent)).kind, 'conflict');
  assert.equal((await client().read(latest('summary.md'))).kind, 'missing');
  assert.deepEqual((await client().read(latest('notes.md'))).snapshot.ref, newer.receipt.changes[0].after);
});

test('duplicate operation replays one receipt and changed arguments cannot reuse the ID', async t => {
  const { client } = fixture(t);
  const request = create('once', 'notes.md', Uint8Array.of(1, 2));
  const first = await client().publish(request);
  assert.equal(first.kind, 'committed');
  assert.deepEqual(await client().publish(request), first);
  assert.equal((await client().publish(create('once', 'other.md', Uint8Array.of(3)))).kind, 'conflict');
  assert.equal((await client().read(latest('other.md'))).kind, 'missing');
  assert.deepEqual(await client().lookup('once'), first);
});

test('lost publication acknowledgement remains unknown and retained lookup identifies the committed effect', async t => {
  const { handler, client } = fixture(t);
  let delivered = 0;
  const dropped = client({ fetch: async request => { delivered++; await handler(request); throw new Error('Fictional dropped response'); } });
  const outcome = await dropped.publish(create('lost-ack', 'notes.md', Uint8Array.of(9)));
  assert.equal(outcome.kind, 'unknown');
  assert.equal(outcome.operationId, 'lost-ack');
  assert.equal(delivered, 1);
  const recovered = await client().lookup('lost-ack');
  assert.equal(recovered.kind, 'committed');
  assert.deepEqual((await client().read(latest('notes.md'))).snapshot.bytes, Uint8Array.of(9));
});

test('identity mismatch and host path/view policy prevent reading and publishing across boundaries', async t => {
  const { client, setAccess } = fixture(t, { authorize: (_action, selected, access) => selected.resource.path !== 'private.md' && access.scopeId === identity.scopeId });
  const saved = await client().publish(create('authorized', 'notes.md', Uint8Array.of(1)));
  assert.equal(saved.kind, 'committed');
  assert.equal((await client().read(latest('private.md'))).kind, 'denied');
  assert.equal((await client().publish(create('private', 'private.md', Uint8Array.of(2)))).kind, 'denied');
  assert.equal((await client().read({ target: target('notes.md', { kind: 'working', viewId: 'private' }), revision: { kind: 'latest' } })).kind, 'unavailable');
  for (const field of ['scopeId', 'principalId', 'initiatorId']) {
    setAccess({ ...identity, [field]: 'another-actor' });
    assert.equal((await client().read(latest('notes.md'))).kind, 'unavailable');
    assert.equal((await client().publish(create('cross-' + field, 'other.md', Uint8Array.of(3)))).kind, 'unknown');
    assert.equal((await client().lookup('authorized')).kind, 'unknown');
  }
  setAccess({ ...identity });
  assert.deepEqual(await client().lookup('authorized'), saved);
  assert.equal((await client().read(latest('other.md'))).kind, 'missing');
});

test('revocation after provider commit suppresses acknowledgement without erasing native lookup', async t => {
  const revoked = new AbortController();
  const { provider, client, setAccess } = fixture(t, { publisher: {
    publish: async (request, access) => {
      const result = await provider.publication.publish(request, access);
      revoked.abort();
      return result;
    },
  } });
  setAccess({ ...identity, signal: revoked.signal });
  const outcome = await client().publish(create('revoked-ack', 'notes.md', Uint8Array.of(7)));
  assert.equal(outcome.kind, 'unknown');
  setAccess({ ...identity });
  assert.equal((await client().lookup('revoked-ack')).kind, 'committed');
  assert.deepEqual((await client().read(latest('notes.md'))).snapshot.bytes, Uint8Array.of(7));
});

test('request bytes are captured before a caller mutates its input and returned bytes are independent', async t => {
  const { handler, client } = fixture(t);
  const bytes = Uint8Array.of(1, 2, 3);
  let resume;
  const gate = new Promise(resolve => { resume = resolve; });
  const delayed = client({ fetch: async request => { await gate; return handler(request); } });
  const pending = delayed.publish(create('captured', 'notes.md', bytes));
  bytes.fill(0);
  resume();
  assert.equal((await pending).kind, 'committed');
  const read = await client().read(latest('notes.md'));
  assert.deepEqual(read.snapshot.bytes, Uint8Array.of(1, 2, 3));
  read.snapshot.bytes.fill(0);
  assert.deepEqual((await client().read(latest('notes.md'))).snapshot.bytes, Uint8Array.of(1, 2, 3));
});

test('aborted requests and bounded bodies do not publish', async t => {
  const { client, handler } = fixture(t, { maxRequestBytes: 512 });
  const aborted = new AbortController(); aborted.abort();
  await assert.rejects(client().publish(create('pre-aborted', 'notes.md', Uint8Array.of(1)), aborted.signal), PublicationNotDispatchedError);
  assert.equal((await client().lookup('pre-aborted')).kind, 'not-found');
  assert.equal((await client().read(latest('notes.md'), aborted.signal)).kind, 'unavailable');
  assert.equal((await client().publish(create('too-large', 'large.bin', new Uint8Array(900)))).kind, 'unknown');
  assert.equal((await client().read(latest('large.bin'))).kind, 'missing');
  const oversized = new Request('https://fictional.invalid/resources', { method: 'POST', headers: { 'content-type': 'application/json' }, body: 'x'.repeat(900) });
  assert.notEqual((await handler(oversized)).status, 200);
});

test('bounded responses cannot be mistaken for reads or lookup evidence', async t => {
  const { client } = fixture(t);
  assert.equal((await client().publish(create('response-limit', 'notes.md', Uint8Array.of(1)))).kind, 'committed');
  const bounded = client({ maxResponseBytes: 32 });
  assert.equal((await bounded.read(latest('notes.md'))).kind, 'unavailable');
  assert.equal((await bounded.lookup('response-limit')).kind, 'unknown');
  assert.equal((await client().lookup('response-limit')).kind, 'committed');
});

test('malformed and mismatched response envelopes cannot become success or not-found', async t => {
  const { handler, client } = fixture(t);
  const corrupt = client({ fetch: async request => {
    const response = await handler(request);
    const value = await response.json();
    return new Response(JSON.stringify({ ...value, requestId: 'wrong-request' }), { status: 200, headers: { 'content-type': 'application/json' } });
  } });
  assert.equal((await corrupt.read(latest('notes.md'))).kind, 'unavailable');
  assert.equal((await corrupt.publish(create('bad-reply', 'notes.md', Uint8Array.of(4)))).kind, 'unknown');
  assert.equal((await corrupt.lookup('bad-reply')).kind, 'unknown');
  assert.equal((await client().lookup('bad-reply')).kind, 'committed');
  const malformed = client({ fetch: async () => new Response('{', { status: 200 }) });
  assert.equal((await malformed.read(latest('notes.md'))).kind, 'unavailable');
  assert.equal((await malformed.publish(create('never-sent', 'other.md', Uint8Array.of(1)))).kind, 'unknown');
  assert.equal((await client().read(latest('other.md'))).kind, 'missing');
});

test('handler rejects malformed JSON, invalid byte arrays and unsupported methods before effects', async t => {
  const { handler, client } = fixture(t);
  const endpoint = 'https://fictional.invalid/resources';
  assert.notEqual((await handler(new Request(endpoint, { method: 'GET' }))).status, 200);
  assert.notEqual((await handler(new Request(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{' }))).status, 200);
  const invalid = { schema: 'boring-resource', version: 1, requestId: 'invalid-bytes', identity, kind: 'publish', value: create('invalid-bytes', 'notes.md', [256]) };
  assert.notEqual((await handler(new Request(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(invalid) }))).status, 200);
  assert.equal((await client().lookup('invalid-bytes')).kind, 'not-found');
  assert.equal((await client().read(latest('notes.md'))).kind, 'missing');
});

test('authentication denial stops dispatch before a reader observes the request', async () => {
  let reads = 0;
  const handler = createResourceHandler({ authenticate: async () => null, reader: { read: async () => { reads++; return { kind: 'missing' }; } } });
  const client = createResourceClient({ identity, endpoint: 'https://fictional.invalid/resources', fetch: request => handler(request) });
  assert.equal((await client.read(latest('notes.md'))).kind, 'unavailable');
  assert.equal(reads, 0);
});

test('unselected publication and lookup capabilities remain absent on the client', async t => {
  const { client } = fixture(t);
  const reader = client({ publication: false, reconciliation: false });
  assert.equal(typeof reader.read, 'function');
  assert.equal(reader.publish, undefined);
  assert.equal(reader.lookup, undefined);
  // Publishing without a way to reconcile would lock an editor after one lost acknowledgement, so it cannot be constructed.
  assert.throws(() => client({ publication: true, reconciliation: false }), /needs reconciliation/);
});

test('a lost first reply followed by denied HTTP authentication cannot imply no commit', async t => {
  const { handler, client, setAccess } = fixture(t);
  let calls = 0;
  const uncertain = client({ fetch: async request => {
    calls++;
    const response = await handler(request);
    if (calls === 1) { await response.body.cancel(); throw new Error('Lost first acknowledgement'); }
    return response;
  } });
  const request = create('lost-then-denied', 'notes.md', Uint8Array.of(7));
  assert.equal((await uncertain.publish(request)).kind, 'unknown');
  setAccess(null);
  assert.equal((await uncertain.publish(request)).kind, 'unknown');
  assert.equal((await uncertain.lookup(request.operationId)).kind, 'unknown');
  assert.equal(calls, 3);
  setAccess(identity);
  assert.equal((await client().lookup(request.operationId)).kind, 'committed');
});

test('receipt identity, digest and exact transitions must agree with the captured request', async t => {
  const { handler, client } = fixture(t);
  const seed = await client().publish(create('receipt-seed', 'notes.md', Uint8Array.of(1)));
  const cases = [
    receipt => { receipt.operationId = 'other'; },
    receipt => { receipt.argumentDigest = 'other'; },
    receipt => { receipt.principalId = 'other'; },
    receipt => { receipt.scopeId = 'other'; },
    receipt => { receipt.initiatorId = 'other'; },
    receipt => { receipt.changes[0].before.revision = 'other'; },
    receipt => { receipt.changes[0].after.resource.path = 'other.md'; },
    receipt => { receipt.changes.push(receipt.changes[0]); },
  ];
  for (const [index, change] of cases.entries()) {
    const current = await client().read(latest('notes.md'));
    const corrupt = client({ fetch: async request => {
      const response = await handler(request), value = await response.json();
      assert.equal(value.value.kind, 'committed');
      change(value.value.receipt);
      return Response.json(value);
    } });
    const result = await corrupt.publish(replace('bad-receipt-' + index, current.snapshot.ref, Uint8Array.of(index)));
    assert.equal(result.kind, 'unknown');
    assert.equal((await client().lookup('bad-receipt-' + index)).kind, 'committed');
  }
  assert.equal(seed.kind, 'committed');
});

test('a provider cannot disclose a read or receipt for another actor or selected resource', async t => {
  const { provider, client } = fixture(t);
  const seed = await client().publish(create('secret', 'private.md', Uint8Array.of(99)));
  const other = createResourceHandler({ authenticate: async () => identity,
    reader: { read: () => provider.read(latest('private.md'), identity) },
    lookup: { lookup: async () => ({ ...seed, receipt: { ...seed.receipt, principalId: 'other-actor' } }) },
  });
  const remote = client({ fetch: other });
  assert.equal((await remote.read(latest('notes.md'))).kind, 'unavailable');
  assert.equal((await remote.lookup('secret')).kind, 'unknown');
});

test('per-change requests never dispatch and partial acknowledgements remain unqualified', async t => {
  const { handler, client } = fixture(t);
  let calls = 0;
  const remote = client({ fetch: request => { calls++; return handler(request); } });
  await assert.rejects(remote.publish({ ...create('partial', 'notes.md', Uint8Array.of(1)), atomicity: 'per-change' }), PublicationNotDispatchedError);
  assert.equal(calls, 0);
  assert.equal((await client().read(latest('notes.md'))).kind, 'missing');
  const partial = client({ fetch: async request => {
    const response = await handler(request), value = await response.json();
    return Response.json({ ...value, value: { kind: 'partial', operationId: 'partial-ack', items: [{ changeIndex: 0, target: target('notes.md'), outcome: value.value }] } });
  } });
  assert.equal((await partial.publish(create('partial-ack', 'notes.md', Uint8Array.of(2)))).kind, 'unknown');
  assert.equal((await client().lookup('partial-ack')).kind, 'committed');
});

test('abort ends noncooperative Fetch observation and cancels a late body', { timeout: 3000 }, async t => {
  const { client } = fixture(t);
  const started = Promise.withResolvers(), response = Promise.withResolvers(), cancelled = Promise.withResolvers();
  const abort = new AbortController();
  const remote = client({ fetch: () => { started.resolve(); return response.promise; } });
  const pending = remote.publish(create('abort-pending', 'notes.md', Uint8Array.of(1)), abort.signal);
  await started.promise;
  abort.abort();
  assert.equal((await pending).kind, 'unknown');
  response.resolve(new Response(new ReadableStream({ cancel() { cancelled.resolve(); } }), { headers: { 'content-type': 'application/json' } }));
  await cancelled.promise;
  assert.equal((await client().lookup('abort-pending')).kind, 'not-found');
});

test('abort and byte limits cancel pending or oversized response streams', { timeout: 3000 }, async t => {
  const { client } = fixture(t);
  for (const oversized of [false, true]) {
    const pulled = Promise.withResolvers(), cancelled = Promise.withResolvers(), abort = new AbortController();
    const remote = client({ maxResponseBytes: 8, fetch: async () => new Response(new ReadableStream({
      pull(controller) { pulled.resolve(); if (oversized) controller.enqueue(new Uint8Array(9)); },
      cancel() { cancelled.resolve(); },
    }), { headers: { 'content-type': 'application/json' } }) });
    const pending = remote.lookup('pending', abort.signal);
    await pulled.promise;
    if (!oversized) abort.abort();
    assert.equal((await pending).kind, 'unknown');
    await cancelled.promise;
  }
});

test('atomic receipt association uses complete targets rather than an invented ordering contract', async t => {
  const { provider, client } = fixture(t, { publisher: { publish: async (request, access) => {
    const result = await provider.publication.publish(request, access);
    assert.equal(result.kind, 'committed');
    return { ...result, receipt: { ...result.receipt, changes: [...result.receipt.changes].reverse() } };
  } } });
  const request = create('batch-order', 'b.md', Uint8Array.of(1));
  request.changes.push(create('unused', 'a.md', Uint8Array.of(2)).changes[0]);
  const result = await client().publish(request);
  assert.equal(result.kind, 'committed');
  assert.deepEqual(result.receipt.changes.map(change => change.after.resource.path), ['a.md', 'b.md']);
  assert.deepEqual((await client().read(latest('b.md'))).snapshot.bytes, Uint8Array.of(1));
  assert.deepEqual((await client().read(latest('a.md'))).snapshot.bytes, Uint8Array.of(2));
});

test('UTF-8 responses split into single-byte and empty chunks preserve exact data', async t => {
  const { handler, client } = fixture(t);
  const remote = client({ fetch: async request => {
    const response = await handler(request), bytes = new Uint8Array(await response.arrayBuffer());
    let offset = 0, empty = false;
    return new Response(new ReadableStream({ pull(controller) {
      if (offset === bytes.length) return controller.close();
      empty = !empty;
      controller.enqueue(empty ? new Uint8Array() : bytes.subarray(offset, ++offset));
    } }), { status: response.status, headers: response.headers });
  } });
  const bytes = new TextEncoder().encode('Fictional café 🐢');
  assert.equal((await remote.publish(create('chunked', 'notes.md', bytes))).kind, 'committed');
  assert.deepEqual((await remote.read(latest('notes.md'))).snapshot.bytes, bytes);
});

test('a borrowed read-only handler does not gain write or lookup authority from client opt-ins', async t => {
  const { provider, client } = fixture(t);
  await client().publish(create('existing', 'notes.md', Uint8Array.of(1)));
  const handler = createResourceHandler({ authenticate: async () => identity, reader: provider });
  const remote = client({ fetch: handler });
  assert.equal((await remote.read(latest('notes.md'))).kind, 'available');
  assert.equal((await remote.publish(create('unsupported', 'other.md', Uint8Array.of(2)))).kind, 'unknown');
  assert.equal((await remote.lookup('existing')).kind, 'unknown');
  assert.equal((await client().read(latest('other.md'))).kind, 'missing');
  assert.equal((await client().lookup('existing')).kind, 'committed');
});

test('local publication preparation reports non-dispatch without asserting the outcome of reused operation IDs', async t => {
  const f = fixture(t);
  let calls = 0;
  const client = f.client({ maxRequestBytes: 800, fetch: request => { calls++; return f.handler(request); } });
  const first = create('reused-id', 'note.md', new TextEncoder().encode('original'));
  const committed = await client.publish(first);
  assert.equal(committed.kind, 'committed'); assert.equal(calls, 1);
  const large = create('reused-id', 'note.md', new Uint8Array(1000));
  await assert.rejects(client.publish(large), error => error.name === 'PublicationNotDispatchedError' && error.operationId === 'reused-id');
  assert.equal(calls, 1);
  assert.deepEqual(await client.lookup('reused-id'), committed);
  const aborted = new AbortController(); aborted.abort();
  await assert.rejects(client.publish(create('aborted-new', 'other.md', Uint8Array.of(1)), aborted.signal),
    error => error.name === 'PublicationNotDispatchedError' && error.operationId === 'aborted-new');
  assert.equal(calls, 2);
  await assert.rejects(client.publish({ ...first, atomicity: 'per-change' }), error => error.name === 'PublicationNotDispatchedError');
  assert.equal(calls, 2);
});


test('a dispatched callback cannot report local non-dispatch even when it throws the public error type', async t => {
  const f = fixture(t);
  let calls = 0;
  const result = await f.client({ fetch: () => { calls++; throw new PublicationNotDispatchedError('dispatched'); } })
    .publish(create('dispatched', 'note.md', Uint8Array.of(1)));
  assert.equal(calls, 1); assert.equal(result.kind, 'unknown'); assert.equal(result.operationId, 'dispatched');
});


test('a typed error thrown after remote commit remains uncertain and reconciles the real receipt', async t => {
  const f = fixture(t);
  const remote = f.client({ fetch: async request => {
    const response = await f.handler(request);
    await response.body?.cancel();
    throw new PublicationNotDispatchedError('committed-before-error');
  } });
  const result = await remote.publish(create('committed-before-error', 'note.md', Uint8Array.of(1, 2)));
  assert.equal(result.kind, 'unknown');
  assert.equal((await f.client().lookup('committed-before-error')).kind, 'committed');
  assert.deepEqual((await f.client().read(latest('note.md'))).snapshot.bytes, Uint8Array.of(1, 2));
});
