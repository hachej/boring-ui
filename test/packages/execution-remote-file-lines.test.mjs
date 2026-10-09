import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRemoteFileSystemHandler, createRemoteFileSystemLease } from '@hachej/boring-execution/remote-files';
import { NodeExecutionEnv } from '@earendil-works/pi-durable/env/node';
import { FileError, getOrThrow } from '@earendil-works/pi-durable/env';
import { BACKGROUND_CONTEXT as context, withCancel } from '@earendil-works/chord/context';

const identity = { providerId: 'fictional-remote-files', instanceId: 'machine-1', incarnation: 'generation-1', viewId: 'working-1' };
const endpoint = 'https://fictional.invalid/files';
function failure(result, code) {
  assert.equal(result.ok, false); assert.ok(result.error instanceof FileError);
  if (code !== undefined) assert.equal(result.error.code, code);
}
async function until(predicate, message) {
  const deadline = Date.now() + 2000;
  while (!predicate()) { assert.ok(Date.now() < deadline, message); await new Promise(resolve => setTimeout(resolve, 5)); }
}
async function promptly(promise) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Operation waited for nonsettling transport cancellation')), 1000); })]);
  } finally { clearTimeout(timer); }
}
async function fixture(t, { contents = 'first\nsecond\nlast', beforeBinding, afterOpen, afterRead, beforeClose, handlerOptions = {} } = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'boring-remote-lines-'));
  await writeFile(join(directory, 'lines'), contents); await writeFile(join(directory, 'empty'), '');
  const host = new NodeExecutionEnv({ cwd: directory }), revoked = new AbortController(), bindings = [], leases = [];
  const access = {
    identity, filesystemId: host.id, context, revoked: revoked.signal, authorize: () => true,
    bindFileSystem: async (cwd, bindingContext) => {
      const native = new NodeExecutionEnv({ cwd }), record = { cwd, native, identity: { ...identity }, reads: 0, closes: 0, releases: 0, readers: [], bindingContext };
      bindings.push(record);
      const open = native.openTextLineReader.bind(native);
      native.openTextLineReader = async (path, openContext) => {
        const result = await open(path, openContext);
        if (afterOpen) await afterOpen(record, result);
        if (!result.ok) return result;
        record.readers.push(result.value);
        return { ok: true, value: {
          readLine: async readContext => {
            record.reads++; const line = await result.value.readLine(readContext);
            if (afterRead) await afterRead(record, line, readContext);
            return line;
          },
          close: async closeContext => { record.closes++; if (beforeClose) await beforeClose(record); await result.value.close(closeContext); },
        } };
      };
      if (beforeBinding) await beforeBinding(record);
      return { identity: record.identity, environment: native, ownership: 'borrowed', release: async releaseContext => { record.releases++; await native.cleanup(releaseContext); } };
    },
  };
  const handler = createRemoteFileSystemHandler({ authenticate: async () => access, ...handlerOptions });
  const lease = (options = {}) => {
    const value = createRemoteFileSystemLease({ identity, filesystemId: host.id, cwd: directory, endpoint, fetch: handler, ...options });
    leases.push(value); return value;
  };
  t.after(async () => {
    for (const value of leases) await value.release(context);
    for (const record of bindings) for (const reader of record.readers) await reader.close(context);
    await host.cleanup(context); await rm(directory, { recursive: true, force: true });
  });
  return { directory, host, access, handler, lease, bindings, revoked };
}

test('Fetch loopback preserves native strict LF lines, empty lines, CRLF and an unclosed final line', { timeout: 5000 }, async t => {
  const f = await fixture(t, { contents: '\nalpha\r\nβeta\nlast' }), fs = f.lease().environment;
  const reader = getOrThrow(await fs.openTextLineReader('lines', context));
  assert.deepEqual(getOrThrow(await reader.readLine(context)), { text: '', terminated: true });
  assert.deepEqual(getOrThrow(await reader.readLine(context)), { text: 'alpha\r', terminated: true });
  assert.deepEqual(getOrThrow(await reader.readLine(context)), { text: 'βeta', terminated: true });
  assert.deepEqual(getOrThrow(await reader.readLine(context)), { text: 'last', terminated: false });
  assert.equal(getOrThrow(await reader.readLine(context)), undefined);
  assert.equal(getOrThrow(await reader.readLine(context)), undefined);
  await until(() => f.bindings[0].releases === 1, 'EOF did not release the bound facade');
  assert.equal(f.bindings[0].closes, 1); await reader.close(context); await reader.close(context);
  assert.equal(f.bindings[0].closes, 1); assert.equal(f.bindings[0].releases, 1);
  const empty = getOrThrow(await fs.openTextLineReader('empty', context));
  assert.equal(getOrThrow(await empty.readLine(context)), undefined); await empty.close(context);
  await until(() => f.bindings[1].releases === 1, 'Empty reader did not release its facade');
  assert.equal(f.bindings[1].closes, 1);
});

test('opening context cancellation detaches after success and does not close the returned native reader', { timeout: 5000 }, async t => {
  const entered = Promise.withResolvers(), release = Promise.withResolvers(); t.after(() => release.resolve());
  const f = await fixture(t, { afterRead: async record => { if (record.reads === 1) { entered.resolve(); await release.promise; } } });
  const opening = withCancel(context), reader = getOrThrow(await f.lease().environment.openTextLineReader('lines', opening.context));
  opening.cancel(); const pending = reader.readLine(context); await entered.promise; release.resolve();
  assert.deepEqual(getOrThrow(await pending), { text: 'first', terminated: true });
  assert.deepEqual(getOrThrow(await reader.readLine(context)), { text: 'second', terminated: true });
  await reader.close(context); await until(() => f.bindings[0].releases === 1, 'Explicit close did not release the facade');
  assert.equal(f.bindings[0].closes, 1);
});

test('aborting a readLine wait retains its pending frame for the next read without reopening', { timeout: 5000 }, async t => {
  const entered = Promise.withResolvers(), release = Promise.withResolvers(); t.after(() => release.resolve());
  const f = await fixture(t, { afterRead: async record => { if (record.reads === 1) { entered.resolve(); await release.promise; } } });
  let requests = 0;
  const reader = getOrThrow(await f.lease({ fetch: request => { requests++; return f.handler(request); } }).environment.openTextLineReader('lines', context));
  const wait = withCancel(context), pending = reader.readLine(wait.context); await entered.promise;
  wait.cancel(); failure(await pending, 'aborted'); assert.equal(f.bindings[0].closes, 0); assert.equal(f.bindings[0].releases, 0);
  release.resolve();
  assert.deepEqual(getOrThrow(await reader.readLine(context)), { text: 'first', terminated: true });
  assert.deepEqual(getOrThrow(await reader.readLine(context)), { text: 'second', terminated: true });
  assert.equal(requests, 1); assert.equal(f.bindings.length, 1);
  await reader.close(context); await until(() => f.bindings[0].releases === 1, 'Retried reader did not release the facade');
  assert.equal(f.bindings[0].closes, 1);
});

test('a pre-aborted readLine leaves the first line available to a live context', { timeout: 5000 }, async t => {
  const f = await fixture(t), reader = getOrThrow(await f.lease().environment.openTextLineReader('lines', context));
  const wait = withCancel(context); wait.cancel(); failure(await reader.readLine(wait.context), 'aborted');
  assert.deepEqual(getOrThrow(await reader.readLine(context)), { text: 'first', terminated: true }); await reader.close(context);
});

test('closing or releasing one borrowed facade interrupts its reader without affecting another facade', { timeout: 5000 }, async t => {
  const entered = Promise.withResolvers(), release = Promise.withResolvers(); t.after(() => release.resolve());
  const f = await fixture(t, { afterRead: async record => { if (record === f.bindings[0] && record.reads === 1) { entered.resolve(); await release.promise; } } });
  const left = f.lease(), right = f.lease();
  const a = getOrThrow(await left.environment.openTextLineReader('lines', context));
  const b = getOrThrow(await right.environment.openTextLineReader('lines', context));
  const pending = a.readLine(context); await entered.promise;
  await left.release(context); failure(await pending); release.resolve();
  await until(() => f.bindings[0].releases === 1, 'Lease release did not clean up its binding');
  await a.close(context); await left.environment.cleanup(context); await left.release(context);
  assert.equal(f.bindings[0].closes, 1); assert.equal(f.bindings[0].releases, 1);
  assert.deepEqual(getOrThrow(await b.readLine(context)), { text: 'first', terminated: true });
  assert.equal(getOrThrow(await f.host.readTextFile('lines', context)), 'first\nsecond\nlast');
  await b.close(context); await until(() => f.bindings[1].releases === 1, 'Second reader did not close');
  assert.equal(f.bindings[1].closes, 1); failure(await left.environment.openTextLineReader('lines', context));
});

test('an aborted open releases a binding that arrives late without opening a native reader', { timeout: 5000 }, async t => {
  const entered = Promise.withResolvers(), release = Promise.withResolvers(); t.after(() => release.resolve());
  const f = await fixture(t, { beforeBinding: async () => { entered.resolve(); await release.promise; } });
  const call = withCancel(context), pending = f.lease().environment.openTextLineReader('lines', call.context);
  await entered.promise; call.cancel(); const failed = await pending; failure(failed, 'aborted');
  assert.match(failed.error.message, /aborted.*effects may remain/); release.resolve();
  await until(() => f.bindings[0].releases === 1, 'Late binding was leaked');
  assert.equal(f.bindings[0].readers.length, 0); assert.equal(f.bindings[0].closes, 0); assert.equal(f.bindings[0].releases, 1);
});

test('explicit reader close interrupts a pending read and leaves its filesystem facade usable', { timeout: 5000 }, async t => {
  const entered = Promise.withResolvers(), release = Promise.withResolvers(); t.after(() => release.resolve());
  const f = await fixture(t, { afterRead: async record => { if (record.reads === 1) { entered.resolve(); await release.promise; } } });
  const fs = f.lease().environment, reader = getOrThrow(await fs.openTextLineReader('lines', context));
  const pending = reader.readLine(context); await entered.promise; await reader.close(context); failure(await pending); release.resolve();
  await until(() => f.bindings[0].releases === 1, 'Reader close did not release its binding');
  assert.equal(f.bindings[0].closes, 1); await reader.close(context); assert.equal(f.bindings[0].releases, 1);
  assert.equal(getOrThrow(await fs.readTextFile('lines', context)), 'first\nsecond\nlast');
});

test('host revocation withholds a pending line and closes its native reader and binding', { timeout: 5000 }, async t => {
  const entered = Promise.withResolvers(), release = Promise.withResolvers(); t.after(() => release.resolve());
  const f = await fixture(t, { afterRead: async record => { if (record.reads === 1) { entered.resolve(); await release.promise; } } });
  const reader = getOrThrow(await f.lease().environment.openTextLineReader('lines', context));
  const pending = reader.readLine(context); await entered.promise; f.revoked.abort(); release.resolve();
  failure(await pending); await until(() => f.bindings[0].releases === 1, 'Revoked stream did not release its binding');
  assert.equal(f.bindings[0].closes, 1); await reader.close(context); assert.equal(f.bindings[0].releases, 1);
});

test('a native missing-file error survives opening and releases the temporary binding', { timeout: 5000 }, async t => {
  const f = await fixture(t), result = await f.lease().environment.openTextLineReader('missing', context);
  failure(result, 'not_found'); assert.match(result.error.path, /missing$/);
  await until(() => f.bindings[0].releases === 1, 'Failed open leaked its binding');
  assert.equal(f.bindings[0].closes, 0); assert.equal(f.bindings[0].readers.length, 0);
});

test('a paused consumer does not eagerly drain the native line reader', { timeout: 5000 }, async t => {
  const f = await fixture(t, { contents: Array.from({ length: 1000 }, (_, index) => `fictional-${index}\n`).join('') });
  const reader = getOrThrow(await f.lease().environment.openTextLineReader('lines', context));
  await new Promise(resolve => setTimeout(resolve, 20));
  const reads = f.bindings[0].reads; assert.ok(reads < 1000, 'Opening drained all native lines before consumer demand');
  await new Promise(resolve => setTimeout(resolve, 20)); assert.equal(f.bindings[0].reads, reads, 'Native reader kept advancing without consumer demand');
  assert.deepEqual(getOrThrow(await reader.readLine(context)), { text: 'fictional-0', terminated: true });
  await reader.close(context); await until(() => f.bindings[0].releases === 1, 'Paused reader did not release its binding');
  assert.equal(f.bindings[0].closes, 1);
});

for (const boundary of ['handler', 'client']) {
  test(`${boundary} frame limit rejects an oversized native line without reporting EOF or truncated success`, { timeout: 5000 }, async t => {
    const f = await fixture(t, { contents: 'x'.repeat(4096) + '\n', handlerOptions: { maxFrameBytes: boundary === 'handler' ? 1024 : 16384 } });
    const opened = await f.lease(boundary === 'client' ? { maxFrameBytes: 1024 } : {}).environment.openTextLineReader('lines', context);
    if (opened.ok) { failure(await opened.value.readLine(context)); await opened.value.close(context); } else failure(opened);
    await until(() => f.bindings[0].releases === 1, 'Oversized line leaked its binding'); assert.equal(f.bindings[0].closes, 1);
  });
}

test('an opened-envelope frame limit still closes the already opened native reader exactly once', { timeout: 5000 }, async t => {
  const f = await fixture(t, { handlerOptions: { maxFrameBytes: 16 } });
  failure(await f.lease().environment.openTextLineReader('lines', context));
  await until(() => f.bindings[0].releases === 1, 'Oversized opening frame leaked its binding');
  assert.equal(f.bindings[0].readers.length, 1); assert.equal(f.bindings[0].closes, 1);
});

test('actual native frames decode when transport chunks split UTF-8 characters and JSON boundaries', { timeout: 5000 }, async t => {
  const f = await fixture(t, { contents: 'βeta\r\n最後' });
  const fs = f.lease({ fetch: async request => {
    const response = await f.handler(request), bytes = new Uint8Array(await response.arrayBuffer()); let offset = 0;
    return new Response(new ReadableStream({ pull(controller) {
      if (offset === bytes.length) controller.close(); else controller.enqueue(bytes.slice(offset, ++offset));
    } }), { headers: response.headers });
  } }).environment;
  const reader = getOrThrow(await fs.openTextLineReader('lines', context));
  assert.deepEqual(getOrThrow(await reader.readLine(context)), { text: 'βeta\r', terminated: true });
  assert.deepEqual(getOrThrow(await reader.readLine(context)), { text: '最後', terminated: false });
  assert.equal(getOrThrow(await reader.readLine(context)), undefined); await reader.close(context);
  assert.equal(f.bindings[0].closes, 1); assert.equal(f.bindings[0].releases, 1);
});

test('malformed, unbound, truncated and prematurely ended native frame streams cannot become successful EOF', { timeout: 10000 }, async t => {
  const f = await fixture(t);
  const mutations = [
    frames => frames.slice(0, -1),
    frames => [{ ...frames[0], filesystemId: 'different-namespace' }, ...frames.slice(1)],
    frames => [{ ...frames[0], identity: { ...identity, incarnation: 'replacement' } }, ...frames.slice(1)],
    frames => frames.map((frame, index) => index === 1 ? { ...frame, sequence: 99 } : frame),
    frames => frames.map((frame, index) => index === 1 ? { ...frame, requestId: 'another-reader' } : frame),
    frames => frames.map((frame, index) => index === 1 ? { ...frame, result: { ok: true, value: { text: 'fictional', terminated: 'true' } } } : frame),
    frames => frames.map((frame, index) => index === 1 ? { ...frame, result: { ok: true, value: null } } : frame),
    frames => [frames[0], { ...frames.at(-1), sequence: 1 }, ...frames.slice(1)],
    frames => [...frames, { ...frames.at(-1), sequence: frames.length }],
  ];
  for (const mutate of mutations) {
    const fs = f.lease({ fetch: async request => {
      const response = await f.handler(request), frames = (await response.text()).trimEnd().split('\n').map(line => JSON.parse(line));
      assert.equal(frames[0].type, 'opened'); assert.equal(frames.at(-1).type, 'end');
      return new Response(mutate(frames).map(frame => JSON.stringify(frame)).join('\n') + '\n', { headers: response.headers });
    } }).environment;
    const opened = await fs.openTextLineReader('lines', context);
    if (!opened.ok) { failure(opened); continue; }
    let failed = false;
    for (let index = 0; index < 10; index++) {
      const line = await opened.value.readLine(context);
      if (!line.ok) { failure(line); failed = true; break; }
      assert.notEqual(line.value, undefined, 'Malformed stream was accepted as EOF');
    }
    assert.equal(failed, true); await opened.value.close(context);
  }
  for (const record of f.bindings) { assert.equal(record.closes, 1); assert.equal(record.releases, 1); }
});

test('an unterminated final frame and invalid UTF-8 fail as transport errors', { timeout: 5000 }, async t => {
  const f = await fixture(t);
  for (const invalidUtf8 of [false, true]) {
    const fs = f.lease({ fetch: async request => {
      const response = await f.handler(request), text = await response.text();
      return new Response(invalidUtf8 ? Uint8Array.of(255, 10) : text.slice(0, -1), { headers: response.headers });
    } }).environment;
    const opened = await fs.openTextLineReader('lines', context);
    if (!opened.ok) { failure(opened); continue; }
    for (let index = 0; index < 4; index++) {
      const line = await opened.value.readLine(context);
      if (index < 3) assert.ok(line.ok && line.value !== undefined); else failure(line);
    }
    await opened.value.close(context);
  }
});

for (const method of ['openTextLineReader', 'readTextFile']) {
  test(`${method} returns unknown promptly when an invalid response cannot finish cancellation`, { timeout: 5000 }, async t => {
    const f = await fixture(t), cancelled = Promise.withResolvers();
    const fs = f.lease({ maxResponseBytes: 16, fetch: async () => new Response(new ReadableStream({
      start(controller) { controller.enqueue(new TextEncoder().encode(method === 'openTextLineReader' ? '{"type":"not-opened"}\n' : ' '.repeat(64))); },
      cancel() { cancelled.resolve(); return new Promise(() => {}); },
    }), { headers: { 'content-type': method === 'openTextLineReader' ? 'application/x-ndjson' : 'application/json' } }) }).environment;
    failure(await promptly(fs[method]('lines', context)), 'unknown');
    await promptly(cancelled.promise); assert.equal(f.bindings.length, 0);
  });
}

test('revocation and stream cancellation during EOF cleanup close once and release only after native close settles', { timeout: 5000 }, async t => {
  const entered = Promise.withResolvers(), release = Promise.withResolvers(); t.after(() => release.resolve());
  const f = await fixture(t, { contents: '', beforeClose: async () => { entered.resolve(); await release.promise; } });
  const lease = f.lease(), reader = getOrThrow(await lease.environment.openTextLineReader('lines', context));
  const pending = reader.readLine(context); await entered.promise;
  assert.equal(f.bindings[0].closes, 1); assert.equal(f.bindings[0].releases, 0);
  f.revoked.abort(); const closing = reader.close(context), releasing = lease.release(context);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.bindings[0].closes, 1); assert.equal(f.bindings[0].releases, 0, 'Binding was released while its native reader was still closing');
  release.resolve(); await Promise.all([closing, releasing]); failure(await pending);
  await until(() => f.bindings[0].releases === 1, 'Settled native close did not release its binding');
  await reader.close(context); assert.equal(f.bindings[0].closes, 1); assert.equal(f.bindings[0].releases, 1);
});

for (const changed of ['namespace', 'cwd', 'identity']) {
  test(`a native open error arriving after binding ${changed} changes cannot be disclosed under the original binding`, { timeout: 5000 }, async t => {
    const entered = Promise.withResolvers(), release = Promise.withResolvers(); t.after(() => release.resolve());
    let nativeError;
    const f = await fixture(t, { afterOpen: async (_record, result) => { nativeError = result; entered.resolve(); await release.promise; } });
    const pending = f.lease().environment.openTextLineReader('missing', context); await entered.promise; failure(nativeError, 'not_found');
    const record = f.bindings[0];
    if (changed === 'namespace') record.native.id = 'fictional:replacement';
    else if (changed === 'cwd') record.native.cwd = join(f.directory, 'replacement');
    else record.identity.incarnation = 'replacement-generation';
    release.resolve(); const result = await pending; failure(result, 'unknown'); assert.equal(result.error.path, undefined);
    await until(() => record.releases === 1, 'Changed binding was not released');
    assert.equal(record.readers.length, 0); assert.equal(record.closes, 0); assert.equal(record.releases, 1);
  });
}

test('synchronous revocation from native reader close cannot release its facade before that close settles', { timeout: 5000 }, async t => {
  const eof = Promise.withResolvers(), beginClose = Promise.withResolvers(), closing = Promise.withResolvers(), release = Promise.withResolvers();
  t.after(() => { beginClose.resolve(); release.resolve(); });
  const f = await fixture(t, { contents: '',
    afterRead: async (_record, result) => {
      assert.equal(getOrThrow(result), undefined); eof.resolve(); await beginClose.promise;
    },
    beforeClose: () => { f.revoked.abort(); closing.resolve(); return release.promise; },
  });
  const reader = getOrThrow(await f.lease().environment.openTextLineReader('lines', context)), pending = reader.readLine(context);
  await eof.promise; beginClose.resolve(); await closing.promise;
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.bindings[0].closes, 1); assert.equal(f.bindings[0].releases, 0, 'Reentrant close released the facade before native close settled');
  release.resolve(); failure(await pending);
  await until(() => f.bindings[0].releases === 1, 'Native close completion did not release its binding');
  await reader.close(context); assert.equal(f.bindings[0].closes, 1); assert.equal(f.bindings[0].releases, 1);
});

for (const phase of ['before-read', 'after-read']) {
  for (const changed of ['namespace', 'cwd', 'identity']) {
    test(`a ${phase} policy callback changing binding ${changed} cannot disclose a stale-bound line`, { timeout: 5000 }, async t => {
      const entered = Promise.withResolvers(), release = Promise.withResolvers(); t.after(() => release.resolve());
      const f = await fixture(t); let streaming = false;
      const expectedReads = phase === 'before-read' ? 0 : 1;
      f.access.authorize = async () => {
        const record = f.bindings[0];
        if (!streaming || !record || record.reads !== expectedReads) return true;
        entered.resolve(); await release.promise;
        if (changed === 'namespace') record.native.id = 'fictional:replacement';
        else if (changed === 'cwd') record.native.cwd = join(f.directory, 'replacement');
        else record.identity.incarnation = 'replacement-generation';
        return true;
      };
      const fs = f.lease({ fetch: async request => { const response = await f.handler(request); streaming = true; return response; } }).environment;
      const reader = getOrThrow(await fs.openTextLineReader('lines', context)), pending = reader.readLine(context);
      await entered.promise; assert.equal(f.bindings[0].reads, expectedReads); release.resolve();
      failure(await pending, 'unknown'); assert.equal(f.bindings[0].reads, expectedReads);
      await until(() => f.bindings[0].releases === 1, 'Policy-mutated binding was not released');
      assert.equal(f.bindings[0].closes, 1); await reader.close(context); assert.equal(f.bindings[0].releases, 1);
    });
  }
}
