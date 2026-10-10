// Pi's own ExecutionEnv conformance suite (`@earendil-works/pi-durable/testing`), run against every environment Boring builds:
// the virtual env (just-bash), the SQLite file system under a virtual env, remote-shell + remote-files over their in-process
// handlers, and the AWS Code Interpreter adapter against its offline fake. A case an environment fails is NOT skipped or weakened:
// it is listed in KNOWN_FAILURES below and runs as a node:test `todo`, so the failure stays visible in every run.
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createEnvConformance } from '@earendil-works/pi-durable/testing';
import { NodeExecutionEnv } from '@earendil-works/pi-durable/env/node';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import { createVirtualWorkspace } from '@hachej/boring-execution/virtual';
import { createRemoteShellHandler, createRemoteShellLease } from '@hachej/boring-execution/remote-shell';
import { createRemoteFileSystemHandler, createRemoteFileSystemLease } from '@hachej/boring-execution/remote-files';
import { createCodeInterpreterEnv } from '@hachej/boring-execution/aws-code-interpreter';
import { openNodeConnection } from '@hachej/boring-files/sqlite';
import { openSqliteFileSystem } from '@hachej/boring-files/sqlite-filesystem';
import { startFakeCodeInterpreter } from '../../examples/aws/fake-code-interpreter.mjs';

// Pi's assertions interface, over node:assert.
const assertions = {
  ok: (value, message) => assert.ok(value, message),
  strictEqual: (actual, expected) => assert.strictEqual(actual, expected),
  deepEqual: (actual, expected) => assert.deepStrictEqual(actual, expected),
  partialDeepEqual: (actual, expected) => assert.partialDeepStrictEqual(actual, expected),
  greaterThan: (actual, expected) => assert.ok(actual > expected, `${actual} > ${expected}`),
  rejects: (operation, messageIncludes) => assert.rejects(operation, error => String(error?.message).includes(messageIncludes)),
};

const identity = { providerId: 'fictional-conformance', instanceId: 'machine-1', incarnation: 'generation-1', viewId: 'working-1' };
const nativeOptions = directory => ({ cwd: directory, shellPath: '/bin/bash', shellEnv: { PATH: '/usr/bin:/bin' } });
const scratch = async prefix => mkdtemp(join(tmpdir(), prefix));

/** Each provider calls `use(env)` once with an env whose cwd is a fresh, empty, writable directory, then cleans up. */
const providers = {
  virtual: async use => {
    const workspace = createVirtualWorkspace({ providerId: 'fictional-virtual' });
    try {
      const root = (await workspace.acquire({ operationId: 'root', input: { cwd: '/' } }, context)).environment;
      await root.createDir('/work', { recursive: true }, context);
      const env = (await workspace.acquire({ operationId: 'work', input: { cwd: '/work' } }, context)).environment;
      await use(env);
    } finally { workspace.dispose(); }
  },
  sqlite: async use => {
    const directory = await scratch('boring-conformance-sqlite-');
    const connection = openNodeConnection(join(directory, 'files.sqlite'));
    // The SQLite file system has no shell, and the suite's cases need one: it runs under the virtual env, which is how Boring uses it.
    const workspace = createVirtualWorkspace({ providerId: 'fictional-sqlite', fs: openSqliteFileSystem({ connection, workspace: 'fictional', cwd: '/work' }) });
    try { await use((await workspace.acquire({ operationId: 'work', input: { cwd: '/work' } }, context)).environment); }
    finally { workspace.dispose(); connection.close?.(); await rm(directory, { recursive: true, force: true }); }
  },
  'remote-shell + remote-files': async use => {
    const directory = await scratch('boring-conformance-remote-');
    const native = new NodeExecutionEnv(nativeOptions(directory));
    const revoked = new AbortController();
    const shellHandler = createRemoteShellHandler({ authenticate: async () => ({ identity, context, revoked: revoked.signal, supports: { timeout: true, spill: true }, authorize: () => true, shell: native }) });
    const filesHandler = createRemoteFileSystemHandler({ authenticate: async () => ({ identity, filesystemId: native.id, context, revoked: revoked.signal, authorize: () => true,
      bindFileSystem: async cwd => { const facade = new NodeExecutionEnv(nativeOptions(cwd)); return { identity, environment: facade, ownership: 'borrowed', release: facade.cleanup.bind(facade) }; } }) });
    const shell = createRemoteShellLease({ identity, endpoint: 'https://fictional.invalid/shell', fetch: shellHandler });
    const files = createRemoteFileSystemLease({ identity, filesystemId: native.id, cwd: directory, endpoint: 'https://fictional.invalid/files', fetch: filesHandler });
    try {
      // Pi's ExecutionEnv is a FileSystem and a Shell: the two leases are the two halves of one remote workspace.
      const env = new Proxy(files.environment, { get: (target, key) => key === 'exec' ? shell.environment.exec.bind(shell.environment)
        : key === 'cleanup' ? async ctx => { await shell.environment.cleanup(ctx); await target.cleanup(ctx); } : target[key] });
      await use(env);
    } finally { await shell.release(context); await files.release(context); await native.cleanup(context); await rm(directory, { recursive: true, force: true }); }
  },
};

let fake, accessPoints;
const awsProvider = async use => {
  accessPoints ??= {};
  fake ??= await startFakeCodeInterpreter({ accessPoints });
  const directory = await scratch('boring-conformance-aws-');
  const arn = `arn:aws:elasticfilesystem:us-east-1:000000000000:access-point/fsap-${directory.split('-').pop()}`;
  accessPoints[arn] = directory;
  const interpreter = createCodeInterpreterEnv({ client: await fake.client(), codeInterpreterIdentifier: fake.codeInterpreterIdentifier, id: `efs:${directory}`, pollIntervalMs: 20,
    session: { start: { filesystemConfigurations: [{ efsConfiguration: { accessPointArn: arn, fileSystemArn: 'arn:aws:elasticfilesystem:us-east-1:000000000000:file-system/fs-0', mountPath: '/mnt/workspace' } }] } },
    mount: { path: '/mnt/workspace', root: directory } });
  try { await use(interpreter.env); }
  finally { await interpreter.stop(context); delete accessPoints[arn]; await rm(directory, { recursive: true, force: true }); }
};

const environments = [
  { name: 'virtual (just-bash)', withEnv: providers.virtual },
  // The SQLite file system keeps no links.
  { name: 'SQLite file system (under the virtual env)', withEnv: providers.sqlite, symlinks: false },
  { name: 'remote-shell + remote-files (in-process handlers)', withEnv: providers['remote-shell + remote-files'] },
  { name: 'aws-code-interpreter (offline fake)', withEnv: awsProvider },
];

/** Cases a Boring env fails today, by environment name then case name. Each runs as a `todo` so the failure stays visible. */
const watchNames = [
  "watch reports a missing file's creation, changes, replacement and removal", 'watch reports a missing target whose ancestors are created', 'watch follows directories created together with their contents',
  'watch keeps watching a path whose parent is renamed and recreated', 'watch skips excluded entries and reports a rename out of them', 'watch keeps recursive coverage where a non-recursive target overlaps',
  'watch follows a directory replaced at the same path', 'watch stops reporting once closed', 'watch reports changes to the file a watched symbolic link points to'];
const noWatch = why => Object.fromEntries(watchNames.map(name => [name, why]));
const DIR_SNAPSHOT = { 'directory reader skips entries removed during enumeration': 'TODO(remote protocol lane): the directory reader lists a snapshot taken when it opens (fs-readers.ts snapshotReaders), so entries removed afterwards are still returned' };
const ARGV_SPAWN = { 'argv exec reports missing programs and empty argv as spawn errors': 'TODO(remote protocol lane): argv commands run through a shell (shellCommand in fs-readers.ts), so a missing program is exit 127 and an empty argv runs nothing, never spawn_error' };
const SYMLINK_READER = { 'binary reader follows symlinks unless noFollow refuses the final one': 'TODO(remote protocol lane): the snapshot binary reader (fs-readers.ts) refuses a symbolic link with "Not a regular file" instead of following it' };
const KNOWN_FAILURES = {
  'virtual (just-bash)': { ...noWatch('watch is not_supported by the virtual env (the suite has no option to skip watch cases)'), ...DIR_SNAPSHOT, ...ARGV_SPAWN, ...SYMLINK_READER },
  'SQLite file system (under the virtual env)': { ...noWatch('watch is not_supported by the virtual env; the SQLite file system itself polls but the virtual env does not expose it'), ...DIR_SNAPSHOT, ...ARGV_SPAWN },
  'remote-shell + remote-files (in-process handlers)': { ...noWatch('TODO(remote protocol lane): remote-files has no watch call'), ...DIR_SNAPSHOT, ...ARGV_SPAWN, ...SYMLINK_READER,
    'windowed exec keeps the exact tail and counts what it skips': 'TODO(remote protocol lane): the remote shell protocol rejects the output window option ("Invalid remote shell request")' },
  'aws-code-interpreter (offline fake)': { ...ARGV_SPAWN },
};

test.after(async () => { await fake?.close(); });

for (const environment of environments) {
  const known = KNOWN_FAILURES[environment.name] ?? {};
  const cases = createEnvConformance({ assertions, withEnv: environment.withEnv, ...(environment.symlinks === undefined ? {} : { symlinks: environment.symlinks }) });
  test(`Pi env conformance: ${environment.name}`, { concurrency: false }, async t => {
    for (const entry of cases) {
      await t.test(entry.name, { timeout: entry.timeoutMs ?? 30_000, ...(known[entry.name] ? { todo: known[entry.name] } : {}) }, () => entry.run());
    }
  });
}
