import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createRemoteFileSystemHandler, createRemoteFileSystemLease } from '@hachej/boring-execution/remote-files';
import { NodeExecutionEnv } from '@earendil-works/pi-durable/env/node';
import { FileError, getOrThrow } from '@earendil-works/pi-durable/env';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import { Harness, MemoryStorage, createRegistry, defineExtension, defineTool, ToolResultEntry } from '@earendil-works/pi-durable';
import { createModels } from '@earendil-works/pi-ai/models';
import { Type } from 'typebox';
import { admitDocumentTool } from '../fixtures/native-document.mjs';

const identity = { providerId: 'fictional-files', instanceId: 'machine-1', incarnation: 'generation-1', viewId: 'working-1' };
const endpoint = 'https://fictional.invalid/files';
const deferred = () => Promise.withResolvers();
const failure = (result, code) => {
  assert.equal(result.ok, false);
  assert.ok(result.error instanceof FileError);
  if (code) assert.equal(result.error.code, code);
};

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'boring-remote-files-'));
  const native = new NodeExecutionEnv({ cwd: directory, shellPath: '/bin/bash', shellEnv: { PATH: '/usr/bin:/bin' } });
  const revoked = new AbortController(), bindings = [], leases = [];
  let releases = 0;
  const access = {
    identity, filesystemId: native.id, context, revoked: revoked.signal,
    authorize: () => true,
    bindFileSystem: async (cwd, bindingContext) => {
      const facade = new NodeExecutionEnv({ cwd, shellPath: '/bin/bash', shellEnv: { PATH: '/usr/bin:/bin' } });
      bindings.push({ cwd, context: bindingContext, facade });
      return { identity, environment: facade, ownership: 'borrowed', release: async releaseContext => {
        releases++; await facade.cleanup(releaseContext);
      } };
    },
  };
  const handler = createRemoteFileSystemHandler({ authenticate: async () => access });
  const lease = (overrides = {}) => {
    const value = createRemoteFileSystemLease({ identity, filesystemId: native.id, cwd: directory, endpoint, fetch: handler, ...overrides });
    leases.push(value); return value;
  };
  t.after(async () => {
    for (const value of leases) await value.release(context);
    await native.cleanup(context);
    await rm(directory, { recursive: true, force: true });
  });
  return { directory, native, access, handler, lease, revoked, bindings, releases: () => releases };
}

test('real Node namespace preserves native file methods, binary bytes and FileError results', { timeout: 15000 }, async t => {
  const f = await fixture(t), fs = f.lease().environment;
  assert.equal(fs.id, f.native.id);
  assert.equal(fs.cwd, f.directory);
  assert.equal(getOrThrow(await fs.absolutePath('nested/data.bin', context)), join(f.directory, 'nested/data.bin'));
  assert.equal(getOrThrow(await fs.joinPath(['nested', 'data.bin'], context)), join('nested', 'data.bin'));
  getOrThrow(await fs.createDir('nested', { recursive: true }, context));
  const original = Uint8Array.of(0, 255, 10, 13);
  getOrThrow(await fs.writeFile('nested/data.bin', original, context));
  original[0] = 99;
  assert.deepEqual(getOrThrow(await fs.readBinaryFile('nested/data.bin', context)), Uint8Array.of(0, 255, 10, 13));
  getOrThrow(await fs.appendFile('nested/data.bin', Uint8Array.of(1, 2), context));
  assert.deepEqual(getOrThrow(await fs.readBinaryFile('nested/data.bin', context)), Uint8Array.of(0, 255, 10, 13, 1, 2));
  getOrThrow(await fs.truncateFile('nested/data.bin', 3, context));
  getOrThrow(await fs.flushFile('nested/data.bin', context));
  assert.deepEqual(getOrThrow(await fs.readBinaryFile('nested/data.bin', context)), Uint8Array.of(0, 255, 10));
  getOrThrow(await fs.renameFile('nested/data.bin', 'nested/renamed.bin', context));
  assert.equal(getOrThrow(await fs.exists('nested/data.bin', context)), false);
  assert.equal(getOrThrow(await fs.exists('nested/renamed.bin', context)), true);
  const info = getOrThrow(await fs.fileInfo('nested/renamed.bin', context));
  assert.equal(info.kind, 'file'); assert.equal(info.size, 3);
  assert.ok(getOrThrow(await fs.listDir('nested', context)).some(item => item.name === 'renamed.bin'));
  assert.equal(getOrThrow(await fs.canonicalPath('nested/renamed.bin', context)), join(f.directory, 'nested/renamed.bin'));
  failure(await fs.readTextFile('missing.txt', context), 'not_found');
  getOrThrow(await fs.writeFile('nested/note.txt', 'one\ntwo\n', context));
  assert.equal(getOrThrow(await fs.readTextFile('nested/note.txt', context)), 'one\ntwo\n');
  assert.deepEqual(getOrThrow(await fs.readTextLines('nested/note.txt', { maxLines: 1 }, context)), ['one']);
  getOrThrow(await fs.remove('nested/renamed.bin', undefined, context));
  assert.equal(getOrThrow(await fs.exists('nested/renamed.bin', context)), false);
  const tempDir = getOrThrow(await fs.createTempDir('fictional-', context));
  const tempFile = getOrThrow(await fs.createTempFile({ prefix: 'fictional-', suffix: '.txt' }, context));
  t.after(() => Promise.all([rm(tempDir, { recursive: true, force: true }), rm(dirname(tempFile), { recursive: true, force: true })]));
  assert.equal(getOrThrow(await fs.exists(tempFile, context)), true);
  assert.equal(f.releases(), f.bindings.length, 'each bound native facade is released once');
});

test('mutable client cwd is captured per call before asynchronous authorization', { timeout: 10000 }, async t => {
  const f = await fixture(t), left = join(f.directory, 'left'), right = join(f.directory, 'right');
  await Promise.all([mkdir(left), mkdir(right)]);
  const entered = deferred(), proceed = deferred(), authorized = [];
  f.access.authorize = async (call, cwd) => { authorized.push({ call, cwd }); entered.resolve(); await proceed.promise; return true; };
  const fs = f.lease().environment;
  fs.cwd = left;
  const pending = fs.writeFile('draft.txt', 'left text', context);
  await entered.promise;
  fs.cwd = right;
  proceed.resolve();
  getOrThrow(await pending);
  assert.equal(await readFile(join(left, 'draft.txt'), 'utf8'), 'left text');
  assert.equal(getOrThrow(await fs.exists('draft.txt', context)), false);
  assert.ok(authorized.every(value => value.cwd === left || value.cwd === right));
  assert.equal(f.bindings[0].cwd, left);
  assert.equal(f.native.cwd, f.directory);
});

test('remote files and a borrowed native Shell see the same backing namespace', async t => {
  const f = await fixture(t), fs = f.lease().environment;
  assert.equal(getOrThrow(await f.native.exec('printf shell > shared.txt', undefined, context)).exitCode, 0);
  assert.equal(getOrThrow(await fs.readTextFile('shared.txt', context)), 'shell');
  getOrThrow(await fs.writeFile('shared.txt', 'files', context));
  assert.equal(getOrThrow(await f.native.exec('test "$(cat shared.txt)" = files', undefined, context)).exitCode, 0);
  assert.equal(await readFile(join(f.directory, 'shared.txt'), 'utf8'), 'files');
});

test('native ToolTask uses the remote FileSystem directly without a Shell or environment factory', { timeout: 15000 }, async t => {
  const f = await fixture(t), lease = f.lease();
  const registry = createRegistry();
  registry.install(defineExtension({ name: 'fictional.remote-files', tools: [defineTool({
    name: 'remote_file_write', description: 'Write a fictional workspace file', parameters: Type.Object({ text: Type.String() }), replay: 'unsafe',
    execute: async (args, api, ctx) => {
      assert.equal(api.env, undefined);
      getOrThrow(await lease.environment.writeFile('tool.txt', args.text, ctx));
      api.output(getOrThrow(await lease.environment.readTextFile('tool.txt', ctx)));
      return {};
    },
  })] }));
  const harness = await Harness.open(new MemoryStorage(), { registry, models: createModels() }, context);
  t.after(() => harness.close(context));
  const conversation = await harness.root(context);
  const taskId = await admitDocumentTool(conversation, { text: 'fictional native output' }, 'remote_file_write');
  const terminal = await harness.waitForTask(taskId, context);
  assert.equal(terminal.state.outcome.status, 'completed');
  const entry = await conversation.commit(tx => tx.entry(ToolResultEntry, terminal.state.outcome.result.entryId), context);
  assert.equal(entry.model[0].isError, false);
  assert.equal(entry.model[0].content[0].text, 'fictional native output');
  assert.equal(await readFile(join(f.directory, 'tool.txt'), 'utf8'), 'fictional native output');
});

test('authentication, workspace identity, namespace and strict authorization refuse before native effects', async t => {
  const f = await fixture(t);
  const denied = createRemoteFileSystemHandler({ authenticate: async () => null });
  failure(await f.lease({ fetch: denied }).environment.writeFile('denied.txt', 'no', context));
  for (const key of ['providerId', 'instanceId', 'incarnation', 'viewId'])
    failure(await f.lease({ identity: { ...identity, [key]: 'different' } }).environment.writeFile('denied.txt', 'no', context));
  failure(await f.lease({ filesystemId: 'different-filesystem' }).environment.writeFile('denied.txt', 'no', context));
  f.access.authorize = () => false;
  failure(await f.lease().environment.writeFile('denied.txt', 'no', context));
  f.access.authorize = () => 'true';
  failure(await f.lease().environment.writeFile('denied.txt', 'no', context));
  assert.equal((await f.native.exists('denied.txt', context)).value, false);
  assert.equal(f.releases(), f.bindings.length);
});

test('lost acknowledgement after append reports unknown and does not retry an uncertain effect', async t => {
  const f = await fixture(t); await writeFile(join(f.directory, 'effects.txt'), 'before');
  let requests = 0;
  const lease = f.lease({ fetch: async request => {
    requests++;
    const response = await f.handler(request);
    await response.text();
    throw new Error('Fictional reply lost after append');
  } });
  const result = await lease.environment.appendFile('effects.txt', '-once', context);
  failure(result, 'unknown');
  assert.equal(await readFile(join(f.directory, 'effects.txt'), 'utf8'), 'before-once');
  assert.equal(requests, 1);
  assert.equal(f.bindings.length, 1);
  assert.equal(f.releases(), 1);
});

test('malformed transport response cannot become a successful native mutation', async t => {
  const f = await fixture(t);
  const lease = f.lease({ fetch: async () => new Response('{not-json', { headers: { 'content-type': 'application/json' } }) });
  failure(await lease.environment.writeFile('bad.txt', 'not written', context));
  assert.equal((await f.native.exists('bad.txt', context)).value, false);
  assert.equal(f.bindings.length, 0);
});

test('releasing one borrowed lease leaves the other lease and native provider usable', async t => {
  const f = await fixture(t), first = f.lease(), second = f.lease();
  getOrThrow(await first.environment.writeFile('shared.txt', 'first', context));
  await first.release(context);
  failure(await first.environment.writeFile('shared.txt', 'closed', context));
  assert.equal(getOrThrow(await second.environment.readTextFile('shared.txt', context)), 'first');
  getOrThrow(await second.environment.writeFile('shared.txt', 'second', context));
  assert.equal(getOrThrow(await f.native.readTextFile('shared.txt', context)), 'second');
});
