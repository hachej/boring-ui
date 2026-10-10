import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, rename, rm, symlink, utimes, writeFile, appendFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRemoteShellHandler, createRemoteShellLease } from '@hachej/boring-execution/remote-shell';
import { createRemoteFileSystemHandler, createRemoteFileSystemLease } from '@hachej/boring-execution/remote-files';
import { NodeExecutionEnv } from '@earendil-works/pi-durable/env/node';
import { ExecutionError, FileError, getOrThrow, ok } from '@earendil-works/pi-durable/env';
import { BACKGROUND_CONTEXT as context, withCancel } from '@earendil-works/chord/context';

const identity = { providerId: 'fictional-remote', instanceId: 'machine-1', incarnation: 'generation-1', viewId: 'working-1' };
const endpoint = 'https://fictional.invalid/x';
const window = { maxBytes: 4096, maxLines: 50, minIntervalMs: 10, bytesPerSecond: 1_000_000 };

function failure(result, code) {
  assert.equal(result.ok, false); assert.ok(result.error instanceof FileError, String(result.error)); assert.equal(result.error.code, code, result.error.message);
}
async function until(predicate, message) {
  const deadline = Date.now() + 3000;
  while (!predicate()) { assert.ok(Date.now() < deadline, message); await new Promise(resolve => setTimeout(resolve, 10)); }
}

// ---- shell: Pi's output window and skipped counts ----
test('shell forwards the output window to the native Shell and relays skipped counts in output frames', async t => {
  const seen = [];
  const skipped = { bytes: 123456, newlines: 4000, endsWithNewline: true };
  const shell = {
    cleanup: async () => {},
    exec: async (command, options, ctx) => {
      seen.push(options);
      options.onOutput('kept tail\n', ctx, { stream: 'stdout', skipped });
      options.onOutput('more\n', ctx, { stream: 'stderr' });
      return ok({ exitCode: 0 });
    },
  };
  const access = { identity, context, revoked: new AbortController().signal, supports: { timeout: true, spill: true }, authorize: () => true, shell };
  const handler = createRemoteShellHandler({ authenticate: async () => access });
  const lease = createRemoteShellLease({ identity, endpoint, fetch: handler });
  t.after(() => lease.release(context));
  const chunks = [];
  const result = await lease.environment.exec('ignored', { window, onOutput: (text, _c, info) => chunks.push([text, info]) }, context);
  assert.equal(getOrThrow(result).exitCode, 0);
  assert.deepEqual(seen[0].window, window);
  assert.deepEqual(chunks, [['kept tail\n', { stream: 'stdout', skipped }], ['more\n', { stream: 'stderr' }]]);
});

test('shell refuses a malformed output window before dispatch and a malformed skipped frame as unconfirmed', async t => {
  let calls = 0;
  const access = { identity, context, revoked: new AbortController().signal, supports: { timeout: true, spill: true }, authorize: () => true, shell: { cleanup: async () => {}, exec: async () => { calls++; return ok({ exitCode: 0 }); } } };
  const handler = createRemoteShellHandler({ authenticate: async () => access });
  const lease = createRemoteShellLease({ identity, endpoint, fetch: handler });
  t.after(() => lease.release(context));
  const bad = await lease.environment.exec('x', { window: { ...window, maxBytes: -1 } }, context);
  assert.equal(bad.ok, false); assert.ok(bad.error instanceof ExecutionError); assert.equal(bad.error.code, 'shell_unavailable'); assert.equal(calls, 0);
  const forged = createRemoteShellLease({ identity, endpoint, fetch: async request => {
    const { requestId } = await request.json();
    const lines = [{ type: 'header', schema: 'boring.remote-shell', version: 2, nativeVersion: 'pi-durable@1.1.0', identity }, { type: 'output', text: 'a', stream: 'stdout', skipped: { bytes: -1, newlines: 0, endsWithNewline: false } }]
      .map((frame, sequence) => JSON.stringify({ ...frame, requestId, sequence })).join('\n') + '\n';
    return new Response(lines, { headers: { 'content-type': 'application/x-ndjson' } });
  } });
  t.after(() => forged.release(context));
  const result = await forged.environment.exec('x', { onOutput() {} }, context);
  assert.equal(result.ok, false); assert.equal(result.error.code, 'unknown');
});

test('the shell protocol version moved so an old peer is refused', async () => {
  const handler = createRemoteShellHandler({ authenticate: async () => ({ identity, context, revoked: new AbortController().signal, supports: { timeout: true, spill: true }, authorize: () => true, shell: { cleanup: async () => {}, exec: async () => ok({ exitCode: 0 }) } }) });
  const response = await handler(new Request(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ schema: 'boring.remote-shell', version: 1, nativeVersion: 'pi-durable@1.1.0', requestId: 'r', identity, command: 'x', options: {}, output: false }) }));
  assert.equal(response.status >= 400, true);
});

// ---- files ----
async function fixture(t, { handlerOptions = {}, leaseOptions = {}, authorize = () => true } = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'boring-remote-pi-'));
  const host = new NodeExecutionEnv({ cwd: directory }), revoked = new AbortController(), leases = [];
  const traffic = { requests: [], bytes: 0, frames: 0 };
  const access = {
    identity, filesystemId: host.id, context, revoked: revoked.signal, authorize,
    bindFileSystem: async cwd => { const native = new NodeExecutionEnv({ cwd }); return { identity: { ...identity }, environment: native, ownership: 'borrowed', release: async c => { await native.cleanup(c); } }; },
  };
  const handler = createRemoteFileSystemHandler({ authenticate: async () => access, ...handlerOptions });
  const counting = async request => {
    const body = await request.clone().json(); traffic.requests.push(body.call);
    const response = await handler(request);
    if (!response.body) return response;
    const [forCount, forCaller] = response.body.tee();
    void (async () => { for await (const chunk of forCount) { traffic.bytes += chunk.length; traffic.frames += [...chunk].filter(b => b === 10).length; } })().catch(() => {});
    return new Response(forCaller, { status: response.status, headers: response.headers });
  };
  const lease = () => { const value = createRemoteFileSystemLease({ identity, filesystemId: host.id, cwd: directory, endpoint, fetch: counting, ...leaseOptions }); leases.push(value); return value; };
  t.after(async () => { for (const value of leases) await value.release(context); await host.cleanup(context); await rm(directory, { recursive: true, force: true }); });
  return { directory, lease, traffic, revoked, host };
}

test('a 50-line read of a large remote file transfers only bounded bytes', async t => {
  const f = await fixture(t);
  const lines = Array.from({ length: 400_000 }, (_, i) => `line ${i} ${'x'.repeat(10)}`).join('\n');
  await writeFile(join(f.directory, 'big.txt'), lines);
  const size = Buffer.byteLength(lines);
  assert.ok(size > 8_000_000);
  const fs = f.lease().environment;
  const reader = getOrThrow(await fs.openBinaryReader('big.txt', undefined, context));
  const scan = getOrThrow(await reader.scanLines({ startLine: 1000, endLine: 1050 }, context));
  assert.equal(scan.newlines, 399_999);
  const text = new TextDecoder().decode(getOrThrow(await reader.read(scan.start, scan.end - scan.start, context)));
  assert.equal(text.split('\n').length, 50); assert.ok(text.startsWith('line 1000 '));
  await reader.close(context);
  assert.ok(f.traffic.bytes < 4096, `transferred ${f.traffic.bytes} bytes of ${size}`);
  assert.ok(f.traffic.frames <= 4, `frames ${f.traffic.frames}`);
  assert.deepEqual(f.traffic.requests.map(call => call.method), ['binaryInfo', 'scanLines', 'readRange']);
});

test('positional reads match the native reader, chunk large ranges and report end of file', async t => {
  const f = await fixture(t, { leaseOptions: { maxResponseBytes: 8192 }, handlerOptions: { maxResponseBytes: 8192 } });
  const data = Buffer.from(Array.from({ length: 50_000 }, (_, i) => i % 251));
  await writeFile(join(f.directory, 'bin'), data);
  const remote = getOrThrow(await f.lease().environment.openBinaryReader('bin', undefined, context));
  const native = getOrThrow(await f.host.openBinaryReader('bin', undefined, context));
  for (const [offset, length] of [[0, 10], [49_990, 100], [100, 30_000], [60_000, 5], [0, 0]]) {
    assert.deepEqual(getOrThrow(await remote.read(offset, length, context)), getOrThrow(await native.read(offset, length, context)), `${offset}+${length}`);
  }
  assert.deepEqual(getOrThrow(await remote.info(context)), getOrThrow(await native.info(context)));
  failure(await remote.read(-1, 1, context), 'invalid');
  failure(await remote.scanLines({ startLine: 3, endLine: 3 }, context), 'invalid');
  await remote.close(context); failure(await remote.read(0, 1, context), 'invalid');
  await native.close(context);
});

test('open errors keep Pi FileError codes and the worker refuses a range above its response limit', async t => {
  const f = await fixture(t);
  await mkdir(join(f.directory, 'dir'));
  const fs = f.lease().environment;
  failure(await fs.openBinaryReader('missing', undefined, context), 'not_found');
  failure(await fs.openBinaryReader('dir', undefined, context), 'is_directory');
  await writeFile(join(f.directory, 'real'), 'x'); await symlink('real', join(f.directory, 'link'));
  failure(await fs.openBinaryReader('link', { noFollow: true }, context), 'invalid');
  getOrThrow(await fs.openBinaryReader('link', undefined, context));
  failure(await fs.openDirReader('missing', context), 'not_found');
  failure(await fs.openDirReader('real', context), 'not_directory');
  const small = await fixture(t, { handlerOptions: { maxResponseBytes: 4096 } });
  await writeFile(join(small.directory, 'f'), Buffer.alloc(100_000));
  const reader = getOrThrow(await small.lease().environment.openBinaryReader('f', undefined, context));
  failure(await reader.read(0, 60_000, context), 'invalid');
});

test('a file that changes after it was opened fails the next positional call', async t => {
  const f = await fixture(t);
  const path = join(f.directory, 'doc.txt');
  await writeFile(path, 'one\ntwo\nthree\n');
  const fs = f.lease().environment;
  const reader = getOrThrow(await fs.openBinaryReader('doc.txt', undefined, context));
  assert.equal(new TextDecoder().decode(getOrThrow(await reader.read(0, 3, context))), 'one');
  await appendFile(path, 'four\n');
  failure(await reader.read(0, 3, context), 'invalid');
  failure(await reader.scanLines({ startLine: 0 }, context), 'invalid');
  // replaced by rename with different size
  const other = getOrThrow(await fs.openBinaryReader('doc.txt', undefined, context));
  await writeFile(join(f.directory, 'next'), 'replacement contents'); await rename(join(f.directory, 'next'), path);
  failure(await other.read(0, 3, context), 'invalid');
  // same size, different mtime
  await writeFile(path, 'same-size'); const third = getOrThrow(await fs.openBinaryReader('doc.txt', undefined, context));
  await writeFile(path, 'SAME-SIZE'); await utimes(path, new Date(), new Date(Date.now() + 5000));
  failure(await third.read(0, 3, context), 'invalid');
});

test('directory paging matches the native order, supports pages smaller than the listing and detects a changed directory', async t => {
  const f = await fixture(t);
  await mkdir(join(f.directory, 'd'));
  for (let i = 0; i < 25; i++) await writeFile(join(f.directory, 'd', `file-${i}`), String(i));
  await mkdir(join(f.directory, 'd', 'sub'));
  const fs = f.lease().environment;
  const native = getOrThrow(await f.host.openDirReader('d', context));
  const expected = []; for (;;) { const page = getOrThrow(await native.next(7, context)); expected.push(...page.entries); if (page.done) break; }
  await native.close(context);
  const reader = getOrThrow(await fs.openDirReader('d', context));
  const got = []; let pages = 0;
  for (;;) { const page = getOrThrow(await reader.next(4, context)); pages++; assert.ok(page.entries.length <= 4); got.push(...page.entries); if (page.done) break; }
  assert.deepEqual(got.map(e => e.name), expected.map(e => e.name));
  assert.equal(got.length, 26); assert.ok(pages >= 7);
  failure(await reader.next(0, context), 'invalid');
  await reader.close(context); failure(await reader.next(1, context), 'invalid');
  const live = getOrThrow(await fs.openDirReader('d', context));
  getOrThrow(await live.next(3, context));
  await writeFile(join(f.directory, 'd', 'late'), 'x'); await utimes(join(f.directory, 'd'), new Date(), new Date(Date.now() + 5000));
  failure(await live.next(3, context), 'invalid');
});

test('watch forwards native events, error-free close and abort', async t => {
  const f = await fixture(t);
  await mkdir(join(f.directory, 'w'));
  const fs = f.lease().environment;
  const changes = [];
  const watcher = getOrThrow(await fs.watch([{ path: 'w', recursive: true }], change => changes.push(change), context));
  assert.ok(watcher.mode === 'native' || watcher.mode === 'polling');
  await writeFile(join(f.directory, 'w', 'created.txt'), 'x');
  await until(() => changes.some(change => 'paths' in change && change.paths.some(p => p.includes('created.txt') || p.endsWith('/w'))), 'no change arrived');
  await watcher.close(context);
  const count = changes.length;
  await writeFile(join(f.directory, 'w', 'after-close.txt'), 'x');
  await new Promise(resolve => setTimeout(resolve, 2500));
  assert.equal(changes.length, count);
  await watcher.close(context);
});

test('watch sets up with Pi errors, ends with an error change on revocation and cleans up on lease release', async t => {
  const f = await fixture(t);
  const lease = f.lease(), fs = lease.environment;
  const changes = [];
  const watcher = getOrThrow(await fs.watch([{ path: '.', recursive: true }], change => changes.push(change), context));
  f.revoked.abort();
  await until(() => changes.some(change => 'error' in change), 'revocation did not surface as an error change');
  const error = changes.find(change => 'error' in change).error;
  assert.ok(error instanceof FileError); assert.equal(error.code, 'unknown');
  await watcher.close(context);
  const g = await fixture(t);
  const second = g.lease(), seen = [];
  getOrThrow(await second.environment.watch([{ path: '.' }], change => seen.push(change), context));
  await second.release(context);
  await until(() => seen.some(change => 'error' in change), 'lease release did not stop the watcher');
  failure(await g.lease().environment.watch([{ path: '.' }], () => {}, withCancelled()), 'aborted');
});
function withCancelled() { const cancelled = withCancel(context); cancelled.cancel(); return cancelled.context; }

test('watch is authorized like every other call and refuses without permission', async t => {
  const f = await fixture(t, { authorize: call => call.method !== 'watch' });
  failure(await f.lease().environment.watch([{ path: '.' }], () => {}, context), 'permission_denied');
});

test('the files protocol version moved so an old peer is refused', async t => {
  const f = await fixture(t);
  const handlerResponse = await createRemoteFileSystemHandler({ authenticate: async () => ({ identity, filesystemId: f.host.id, context, revoked: new AbortController().signal, authorize: () => true, bindFileSystem: async () => { throw new Error('unused'); } }) })(
    new Request(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ schema: 'boring.remote-files', version: 2, nativeVersion: 'pi-durable@1.1.0', requestId: 'r', identity, filesystemId: f.host.id, cwd: '.', call: { method: 'exists', args: ['x'] } }) }));
  assert.equal(handlerResponse.status >= 400, true);
});
