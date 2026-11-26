// Stale missing-path lookups on EFS: the host's NFS client keeps a negative dentry for a path a command in the interpreter just
// created, until the parent directory is revalidated. The Code Interpreter env must not report that miss while a command ran
// lately: it revalidates the parent (opens and reads it) and looks again. The files layer here is a fake with that behaviour;
// the env, the interpreter client (the real SDK against the offline fake) and the commands are the public ones. Fictional files.
// Not provable on real EFS from here: only a deploy on AWS proves the cause and the fix (HOST-RECIPE-AWS.md).
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { BACKGROUND_CONTEXT as context, withCancel } from '@earendil-works/chord/context';
import { FileError, err, ok, getOrThrow } from '@earendil-works/pi-durable/env';
import { createCodeInterpreterEnv } from '@hachej/boring-execution/aws-code-interpreter';
import { startFakeCodeInterpreter } from '../../examples/hosts/aws/fake-code-interpreter.mjs';

const FILE = '/mnt/workspace/out/result.txt';
const info = path => ({ name: 'result.txt', path, kind: 'file', size: 3, mtimeMs: 0 });

/**
 * A mounted-files layer behind a stale negative dentry: the file "exists" (a command created it) but every lookup says
 * not_found until the parent directory was read (`revalidated`) or `visibleAt` passed (the attribute cache expired).
 */
function staleFiles({ exists = true, visibleAfterMs, denied = false } = {}) {
  const state = { calls: [], revalidations: 0, createdAt: 0 };
  const visible = () => exists && (state.revalidations > 0 || (visibleAfterMs !== undefined && Date.now() - state.createdAt >= visibleAfterMs));
  const lookup = (name, value) => async path => {
    state.calls.push(name);
    if (denied) return err(new FileError('permission_denied', 'denied', path));
    return visible() ? ok(value(path)) : err(new FileError('not_found', 'no such file', path));
  };
  const files = {
    readTextFile: lookup('readTextFile', () => 'abc'),
    readBinaryFile: lookup('readBinaryFile', () => new Uint8Array([97])),
    readTextLines: lookup('readTextLines', () => ({ lines: ['abc'] })),
    openTextLineReader: lookup('openTextLineReader', () => ({})),
    openBinaryReader: lookup('openBinaryReader', () => ({})),
    fileInfo: lookup('fileInfo', info),
    listDir: lookup('listDir', path => [info(path)]),
    canonicalPath: lookup('canonicalPath', path => path),
    exists: async path => { state.calls.push('exists'); return denied ? err(new FileError('permission_denied', 'denied', path)) : ok(visible()); },
    // The parent exists; opening it is what revalidates.
    openDirReader: async path => {
      state.calls.push(`openDirReader ${path}`);
      if (!path.endsWith('/out')) return err(new FileError('not_found', 'no such directory', path));
      return ok({ next: async () => { state.revalidations++; return ok({ entries: [], done: true }); }, close: async () => ok(undefined) });
    },
    writeFile: async path => { state.calls.push('writeFile'); return err(new FileError('not_found', 'no parent', path)); },
    createDir: async path => { state.calls.push('createDir'); return err(new FileError('not_found', 'no parent', path)); },
    renameFile: async path => { state.calls.push('renameFile'); return err(new FileError('not_found', 'no source', path)); },
    absolutePath: async path => ok(path), joinPath: async parts => ok(parts.join('/')),
    watch: async () => err(new FileError('not_supported', 'no')),
  };
  return { files, state };
}

async function open(t, layer, extra = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'boring-stale-miss-'));
  const arn = 'arn:aws:elasticfilesystem:us-east-1:000000000000:access-point/fsap-stale';
  const fake = await startFakeCodeInterpreter({ accessPoints: { [arn]: directory } });
  t.after(() => fake.close());
  const interpreter = createCodeInterpreterEnv({
    client: await fake.client(), codeInterpreterIdentifier: fake.codeInterpreterIdentifier, id: 'efs:/fictional', pollIntervalMs: 10,
    session: { start: { filesystemConfigurations: [{ efsConfiguration: { accessPointArn: arn, fileSystemArn: 'arn:aws:elasticfilesystem:us-east-1:000000000000:file-system/fs-0', mountPath: '/mnt/workspace' } }] } }, mount: { path: '/mnt/workspace', root: directory }, mountedFiles: layer.files, ...extra,
  });
  t.after(() => interpreter.stop(context).catch(() => undefined));
  const ran = async (command = 'true') => { const result = await interpreter.env.exec(command, {}, context); assert.ok(result.ok, 'the command ran'); layer.state.createdAt = Date.now(); return result; };
  return { env: interpreter.env, ran };
}

test('a path a command just created is found: the parent is revalidated, then the lookup repeats (every read operation)', { timeout: 20000 }, async t => {
  for (const [name, call, check] of [
    ['readTextFile', env => env.readTextFile(FILE, context), value => assert.equal(value, 'abc')],
    ['readBinaryFile', env => env.readBinaryFile(FILE, context), value => assert.equal(value[0], 97)],
    ['fileInfo', env => env.fileInfo(FILE, context), value => assert.equal(value.path, FILE)],
    ['exists', env => env.exists(FILE, context), value => assert.equal(value, true)],
    ['listDir', env => env.listDir(FILE, context), value => assert.equal(value.length, 1)],
    ['canonicalPath', env => env.canonicalPath(FILE, context), value => assert.equal(value, FILE)],
  ]) {
    const layer = staleFiles();
    const { env, ran } = await open(t, layer);
    await ran();
    check(getOrThrow(await call(env)));
    assert.ok(layer.state.revalidations > 0, `${name}: the parent directory was opened and read`);
  }
});

test('with no revalidation the lookup is repeated until the attribute cache expires (a window of ms after the command)', { timeout: 20000 }, async t => {
  const layer = staleFiles({ visibleAfterMs: 400 });
  layer.files.openDirReader = async path => err(new FileError('permission_denied', 'cannot read the parent', path)); // revalidation impossible
  const { env, ran } = await open(t, layer);
  await ran();
  assert.equal(getOrThrow(await env.readTextFile(FILE, context)), 'abc');
  assert.ok(layer.state.calls.filter(call => call === 'readTextFile').length > 2, 'looked again with backoff');
});

test('a failed command still opens the window', { timeout: 20000 }, async t => {
  const layer = staleFiles();
  const { env, ran } = await open(t, layer);
  assert.equal(getOrThrow(await ran('exit 3')).exitCode, 3);
  assert.equal(getOrThrow(await env.readTextFile(FILE, context)), 'abc');
});

test('outside the window (no recent command) a miss is answered at once, without revalidating', { timeout: 20000 }, async t => {
  const layer = staleFiles();
  const never = await open(t, layer);
  const before = Date.now(), result = await never.env.readTextFile(FILE, context);
  assert.equal(result.ok ? 'ok' : result.error.code, 'not_found');
  assert.ok(Date.now() - before < 200, 'no added latency');
  assert.equal(layer.state.revalidations, 0);
  assert.equal(layer.state.calls.length, 1, 'one lookup, no retry');

  const aged = staleFiles(), old = await open(t, aged, { staleMissWindowMs: 150 });
  await old.ran(); await delay(300);
  const late = await old.env.fileInfo(FILE, context);
  assert.equal(late.ok ? 'ok' : late.error.code, 'not_found');
  assert.equal(aged.state.calls.length, 1, 'the window had ended: no retry');
});

test('a path that really is missing is reported not_found once the window ends', { timeout: 20000 }, async t => {
  const layer = staleFiles({ exists: false });
  const { env, ran } = await open(t, layer, { staleMissWindowMs: 300 });
  await ran();
  const before = Date.now(), result = await env.readTextFile(FILE, context);
  assert.equal(result.ok ? 'ok' : result.error.code, 'not_found');
  assert.ok(Date.now() - before < 1500, 'bounded by the window');
  assert.ok(layer.state.calls.filter(call => call === 'readTextFile').length > 1, 'it did look again');
});

test('staleMissWindowMs: 0 disables the retry', { timeout: 20000 }, async t => {
  const layer = staleFiles();
  const { env, ran } = await open(t, layer, { staleMissWindowMs: 0 });
  await ran();
  const result = await env.readTextFile(FILE, context);
  assert.equal(result.ok ? 'ok' : result.error.code, 'not_found');
  assert.deepEqual(layer.state.calls, ['readTextFile']);
});

test('an abort stops the retrying at once', { timeout: 20000 }, async t => {
  const layer = staleFiles({ exists: false });
  const { env, ran } = await open(t, layer, { staleMissWindowMs: 10_000 });
  await ran();
  const cancelled = withCancel(context);
  setTimeout(() => cancelled.cancel(), 100);
  const before = Date.now(), result = await env.readTextFile(FILE, cancelled.context);
  assert.equal(result.ok, false);
  assert.ok(Date.now() - before < 1500, 'did not wait for the window');
});

test('only not_found is retried: a permission error is answered at once', { timeout: 20000 }, async t => {
  const layer = staleFiles({ denied: true });
  const { env, ran } = await open(t, layer);
  await ran();
  const result = await env.readTextFile(FILE, context);
  assert.equal(result.ok ? 'ok' : result.error.code, 'permission_denied');
  assert.deepEqual(layer.state.calls, ['readTextFile']);
});

test('writes are never retried', { timeout: 20000 }, async t => {
  const layer = staleFiles({ exists: false });
  const { env, ran } = await open(t, layer);
  await ran();
  assert.equal((await env.writeFile(FILE, 'x', context)).ok, false);
  assert.equal((await env.createDir('/mnt/workspace/a/b', { recursive: false }, context)).ok, false);
  assert.equal((await env.renameFile(FILE, `${FILE}.2`, context)).ok, false);
  assert.deepEqual(layer.state.calls, ['writeFile', 'createDir', 'renameFile']);
});
