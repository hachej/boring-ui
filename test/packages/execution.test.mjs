import { createGitRepository } from '@hachej/boring-files/git';
import assert from 'node:assert/strict';
import test from 'node:test';
import { createVirtualWorkspace } from '@hachej/boring-execution/virtual';
import { createVirtualGitFs, installVirtualGitCommand } from '@hachej/boring-execution/virtual-git';
import { BACKGROUND_CONTEXT as context, withCancel } from '@earendil-works/chord/context';
import { getOrThrow } from '@earendil-works/pi-durable/env';
import { Harness, MemoryStorage, createRegistry, defineExtension, ToolResultEntry } from '@earendil-works/pi-durable';
import { createModels } from '@earendil-works/pi-ai/models';
import { createWriteTool, createReadTool, createEditTool } from '@earendil-works/pi-durable/tools';
import git from 'isomorphic-git';
import { admitDocumentTool } from '../fixtures/native-document.mjs';
import { runCaptured } from '../../scripts/run-captured.mjs';

const author = { name: 'Fictional author', email: 'author@example.invalid', timestamp: 1, timezoneOffset: 0 };
const acquire = (workspace, cwd = '/repo') => workspace.acquire({ operationId: 'fixture-acquisition', input: { cwd } }, context);
function fixture(t, files = { '/repo/note.txt': 'original\n' }) {
  const workspace = createVirtualWorkspace({ providerId: 'fictional-scratch', files });
  t.after(() => workspace.dispose()); return workspace;
}

test('native file access, direct Bash and Git share one view and preserve binary bytes', async t => {
  const workspace = fixture(t);
  const { environment: env } = await acquire(workspace);
  const shell = workspace.createBash({ cwd: '/repo' });
  getOrThrow(await env.writeFile('note.txt', 'native bytes\n', context));
  assert.equal((await shell.exec('cat note.txt')).stdout, 'native bytes\n');
  assert.equal((await shell.exec('printf "shell bytes\\n" > note.txt')).exitCode, 0);
  assert.equal(getOrThrow(await env.readTextFile('note.txt', context)), 'shell bytes\n');
  const bytes = new Uint8Array([0, 255, 128]);
  getOrThrow(await env.writeFile('binary', bytes, context)); bytes[0] = 33;
  const read = getOrThrow(await env.readBinaryFile('binary', context)); read[1] = 0;
  assert.deepEqual(await workspace.filesystem.readFileBuffer('/repo/binary'), new Uint8Array([0, 255, 128]));
  const repo = { fs: createVirtualGitFs(workspace.filesystem), dir: '/repo' };
  await git.init({ ...repo, defaultBranch: 'main' });
  await git.add({ ...repo, filepath: '.' });
  const commit = await git.commit({ ...repo, author, message: 'Fictional shared view' });
  assert.equal((await git.log(repo))[0].oid, commit);
  assert.deepEqual((await git.readBlob({ ...repo, oid: commit, filepath: 'binary' })).blob, new Uint8Array([0, 255, 128]));
  getOrThrow(await env.writeFile('note.txt', 'changed', context));
  assert.equal(await git.status({ ...repo, filepath: 'note.txt' }), '*modified');
});

test('concurrent cwd facades share identity without sharing cwd or cleanup', async t => {
  const workspace = fixture(t, { '/a/note': 'a', '/b/note': 'b' });
  const [left, right] = await Promise.all([acquire(workspace, '/a'), acquire(workspace, '/b')]);
  assert.equal(left.environment.id, right.environment.id);
  assert.deepEqual(left.identity, right.identity);
  assert.deepEqual(await Promise.all([left.environment.readTextFile('note', context), right.environment.readTextFile('note', context)]), [{ ok: true, value: 'a' }, { ok: true, value: 'b' }]);
  left.environment.cwd = '/b';
  right.environment.cwd = '/a';
  assert.equal(getOrThrow(await left.environment.readTextFile('note', context)), 'b');
  await left.release(context); await left.release(context);
  assert.equal((await left.environment.writeFile('note', 'must not write', context)).error.code, 'invalid');
  assert.equal(getOrThrow(await right.environment.readTextFile('note', context)), 'a');
  workspace.dispose();
  assert.equal((await right.environment.readTextFile('note', context)).error.code, 'invalid');
  await assert.rejects(acquire(workspace, '/a'), /disposed/);
});

test('separate workspaces capture mutable seed bytes and retain distinct namespaces', async t => {
  const bytes = new Uint8Array([1, 2]);
  const first = fixture(t, { '/repo/data': bytes }), second = fixture(t, { '/repo/data': bytes });
  bytes[0] = 9;
  const a = (await acquire(first)).environment, b = (await acquire(second)).environment;
  assert.notEqual(a.id, b.id);
  getOrThrow(await a.writeFile('data', new Uint8Array([3]), context));
  assert.deepEqual(getOrThrow(await b.readBinaryFile('data', context)), new Uint8Array([1, 2]));
});

test('native paths preserve symlink identity, canonical targets and LF termination', async t => {
  const workspace = fixture(t, { '/repo/lines': 'a\r\nb\nlast', '/repo/empty': '' });
  await workspace.filesystem.symlink('/repo/lines', '/repo/link');
  const env = (await acquire(workspace)).environment;
  assert.equal(getOrThrow(await env.fileInfo('link', context)).kind, 'symlink');
  assert.equal(getOrThrow(await env.canonicalPath('link', context)), '/repo/lines');
  assert.equal(getOrThrow(await env.absolutePath('../repo/lines', context)), '/repo/lines');
  assert.equal(getOrThrow(await env.joinPath(['a', '..', 'b'], context)), 'b');
  assert.ok(getOrThrow(await env.listDir('.', context)).some(item => item.name === 'link' && item.kind === 'symlink'));
  const reader = getOrThrow(await env.openTextLineReader('lines', context));
  assert.deepEqual(getOrThrow(await reader.readLine(context)), { text: 'a\r', terminated: true });
  assert.deepEqual(getOrThrow(await reader.readLine(context)), { text: 'b', terminated: true });
  assert.deepEqual(getOrThrow(await reader.readLine(context)), { text: 'last', terminated: false });
  assert.equal(getOrThrow(await reader.readLine(context)), undefined);
  await reader.close(context);
  assert.equal((await reader.readLine(context)).error.code, 'invalid');
  assert.deepEqual(getOrThrow(await env.readTextLines('lines', { maxLines: 2 }, context)), ['a\r', 'b']);
  assert.deepEqual(getOrThrow(await env.readTextLines('missing', { maxLines: 0 }, context)), []);
  assert.deepEqual(getOrThrow(await env.readTextLines('empty', undefined, context)), []);
  getOrThrow(await env.writeFile('terminated', 'one\n', context));
  assert.deepEqual(getOrThrow(await env.readTextLines('terminated', undefined, context)), ['one']);
  assert.equal((await env.fileInfo('missing', context)).error.code, 'not_found');
  assert.equal((await env.readTextFile('.', context)).error.code, 'is_directory');
});

test('temporary files are distinct and private; ordinary scratch operations need no receipts', async t => {
  const workspace = fixture(t), env = (await acquire(workspace)).environment;
  const paths = await Promise.all(Array.from({ length: 12 }, () => env.createTempFile({ prefix: 'fixture-', suffix: '.bin' }, context)));
  assert.equal(new Set(paths.map(getOrThrow)).size, 12);
  for (const result of paths) assert.equal((await workspace.filesystem.stat(getOrThrow(result))).mode & 0o777, 0o600);
  const directory = getOrThrow(await env.createTempDir('fixture-', context));
  assert.equal((await workspace.filesystem.stat(directory)).mode & 0o777, 0o700);
  assert.equal((await env.createTempFile({ prefix: '../escape' }, context)).error.code, 'invalid');
  getOrThrow(await env.createDir('nested/child', { recursive: true }, context));
  getOrThrow(await env.writeFile('nested/child/data', 'a', context));
  getOrThrow(await env.appendFile('nested/child/data', 'b', context));
  assert.equal(getOrThrow(await env.readTextFile('nested/child/data', context)), 'ab');
  getOrThrow(await env.remove('nested', { recursive: true }, context));
  assert.equal(getOrThrow(await env.exists('nested', context)), false);
});

test('append and removal follow directory aliases without replacing symlink targets', async t => {
  const workspace = fixture(t, { '/repo/target/value': 'original' });
  await workspace.filesystem.symlink('/repo/target', '/repo/alias');
  await workspace.filesystem.symlink('target/value', '/repo/link');
  const env = (await acquire(workspace)).environment;
  getOrThrow(await env.appendFile('link', '-one', context));
  getOrThrow(await env.appendFile('alias/value', '-two', context));
  assert.equal(getOrThrow(await env.readTextFile('target/value', context)), 'original-one-two');
  const fs = createVirtualGitFs(workspace.filesystem).promises;
  await fs.writeFile('/repo/target/git-file', 'remove');
  await fs.unlink('/repo/alias/git-file');
  assert.equal(await workspace.filesystem.exists('/repo/target/git-file'), false);
  getOrThrow(await env.remove('alias/value', undefined, context));
  assert.equal(await workspace.filesystem.exists('/repo/target/value'), false);
  assert.equal(getOrThrow(await env.fileInfo('link', context)).kind, 'symlink');
});

test('unqualified rename/truncate/flush refuse before effects and cannot clobber competing writes', async t => {
  const workspace = fixture(t, { '/repo/source': 'AAAA', '/repo/directory/child': 'kept' });
  const env = (await acquire(workspace)).environment;
  assert.equal((await env.renameFile('source', 'directory', context)).error.code, 'not_supported');
  assert.equal(getOrThrow(await env.fileInfo('directory', context)).kind, 'directory');
  assert.equal(getOrThrow(await env.readTextFile('directory/child', context)), 'kept');
  const [truncated, written] = await Promise.all([env.truncateFile('source', 2, context), env.writeFile('source', 'ZZZZ', context)]);
  assert.equal(truncated.error.code, 'not_supported'); assert.equal(written.ok, true);
  assert.equal(getOrThrow(await env.readTextFile('source', context)), 'ZZZZ');
  assert.equal((await env.flushFile('source', context)).error.code, 'not_supported');
});

test('native shell options work with buffered output so the stock bash tool runs; direct Bash stays useful', async t => {
  const workspace = fixture(t), env = (await acquire(workspace)).environment;
  const chunks = [];
  // Output arrives once per stream, after the command ends, naming its stream (Pi 1.0.3); spill thresholds are accepted and nothing is spilled.
  assert.deepEqual(getOrThrow(await env.exec('echo out; echo diagnostic >&2', { onOutput: (text, _context, info) => chunks.push(`${info.stream}:${text}`), spill: { afterBytes: 1, afterLines: 1 }, timeout: 5 }, context)), { exitCode: 0 });
  assert.deepEqual(chunks, ['stdout:out\n', 'stderr:diagnostic\n']);
  // Pi's argv form runs exactly those words, without the shell splitting them.
  const argv = [];
  assert.deepEqual(getOrThrow(await env.exec(['printf', '%s|', "it's", 'two words', '$HOME'], { onOutput: text => argv.push(text) }, context)), { exitCode: 0 });
  assert.deepEqual(argv, ["it's|two words|$HOME|"]);
  assert.equal((await env.exec('sleep 5', { timeout: 0.05 }, context)).error.code, 'timeout');
  assert.equal((await env.exec('echo x', { onOutput: () => { throw new Error('listener failed'); } }, context)).error.code, 'callback_error');
  assert.equal(getOrThrow(await env.readTextFile('note.txt', context)), 'original\n');
  assert.deepEqual(getOrThrow(await env.exec('echo changed > note.txt', undefined, context)), { exitCode: 0 });
  const output = await workspace.createBash({ cwd: '/repo' }).exec('cat note.txt; echo diagnostic >&2');
  assert.equal(output.stdout, 'changed\n'); assert.equal(output.stderr, 'diagnostic\n');
  const cancelled = withCancel(context); cancelled.cancel();
  assert.equal((await env.writeFile('note.txt', 'denied', cancelled.context)).error.code, 'aborted');
  assert.equal((await env.exec('echo denied > note.txt', undefined, cancelled.context)).error.code, 'aborted');
  assert.equal(getOrThrow(await env.readTextFile('note.txt', context)), 'changed\n');
});

test('Git I/O captures bytes, preserves symlinks and refuses wrong deletion kinds', async t => {
  const workspace = fixture(t), fs = createVirtualGitFs(workspace.filesystem).promises;
  const bytes = new Uint8Array([0, 255]); await fs.writeFile('/repo/binary', bytes); bytes[0] = 7;
  assert.deepEqual(await fs.readFile('/repo/binary'), new Uint8Array([0, 255]));
  await fs.mkdir('/repo/empty');
  await assert.rejects(fs.unlink('/repo/empty'), { code: 'EISDIR' });
  await assert.rejects(fs.rmdir('/repo/binary'), { code: 'ENOTDIR' });
  await fs.symlink('binary', '/repo/link');
  assert.equal((await fs.lstat('/repo/link')).isSymbolicLink(), true);
  assert.equal(await fs.readlink('/repo/link'), 'binary');
  await fs.unlink('/repo/link');
  assert.deepEqual(await fs.readFile('/repo/binary'), new Uint8Array([0, 255]));
  await assert.rejects(fs.readFile('/repo/missing'), { code: 'ENOENT' });
});

test('installed local Git commands share Bash changes, direct history and branch checkout', async t => {
  const workspace = fixture(t), env = (await acquire(workspace)).environment;
  const shell = workspace.createBash({ cwd: '/repo' });
  installVirtualGitCommand({ bash: shell, repository: createGitRepository({ fs: createVirtualGitFs(workspace.filesystem), directory: '/repo', author, authorize: () => true }) });
  for (const command of ['git init', 'git add note.txt', 'git commit -m initial', 'git branch feature', 'git checkout feature', 'echo feature > note.txt', 'git add note.txt', 'git commit -m feature']) {
    const result = await shell.exec(command); assert.equal(result.exitCode, 0, `${command}: ${result.stderr}`);
  }
  assert.equal(JSON.parse((await shell.exec('git log')).stdout).length, 2);
  assert.equal(getOrThrow(await env.readTextFile('note.txt', context)), 'feature\n');
  assert.equal((await shell.exec('git checkout main')).exitCode, 0);
  assert.equal(getOrThrow(await env.readTextFile('note.txt', context)), 'original\n');
  assert.equal(JSON.parse((await shell.exec('git status')).stdout)[0][2], 1);
  for (const command of ['git push', 'git reset --hard', 'git commit --amend', 'git checkout main extra']) assert.equal((await shell.exec(command)).exitCode, 126, command);
});

test('actual native read/write/edit ToolTasks execute against the virtual environment', { timeout: 15000 }, async t => {
  const workspace = fixture(t), leases = [];
  const registry = createRegistry(); registry.install(defineExtension({ name: 'fictional.virtual-files', tools: [createWriteTool(), createReadTool(), createEditTool()] }));
  const harness = await Harness.open(new MemoryStorage(), { registry, models: createModels(), env: async () => { const lease = await acquire(workspace); leases.push(lease); return lease.environment; } }, context);
  t.after(async () => { await harness.close(context); for (const lease of leases) await lease.release(context); });
  const conversation = await harness.root(context);
  for (const [name, args] of [['write', { path: 'created.txt', content: 'native tool text' }], ['edit', { path: 'created.txt', edits: [{ oldText: 'tool', newText: 'edited' }] }], ['read', { path: 'created.txt' }]]) {
    const taskId = await admitDocumentTool(conversation, args, name);
    const terminal = await harness.waitForTask(taskId, context);
    assert.equal(terminal.state.outcome.status, 'completed');
    const entry = await conversation.commit(tx => tx.entry(ToolResultEntry, terminal.state.outcome.result.entryId), context);
    assert.equal(entry.model[0].isError, false);
    if (name === 'read') assert.match(entry.model[0].content[0].text, /native edited text/);
  }
  assert.equal((await workspace.createBash({ cwd: '/repo' }).exec('cat created.txt')).stdout, 'native edited text');
});

test('virtual commands never fall back to a native process or default network transport', () => {
  const result = runCaptured(process.execPath, [new URL('../fixtures/virtual-no-fallback.mjs', import.meta.url).pathname], { timeout: 30000 });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /native calls=0; network calls=0/);
});

test('native, Bash and Git mutations follow shared directory and final symlinks', async t => {
  const workspace = fixture(t), backing = workspace.filesystem;
  await backing.symlink('/repo', '/alias');
  await backing.symlink('note.txt', '/repo/link');
  await backing.symlink('new.txt', '/repo/dangling');
  const env = (await acquire(workspace, '/alias')).environment;
  getOrThrow(await env.writeFile('link', 'native', context));
  assert.equal(await backing.readFile('/repo/note.txt'), 'native');
  assert.equal((await backing.lstat('/repo/link')).isSymbolicLink, true);
  const shell = workspace.createBash({ cwd: '/alias' });
  assert.equal((await shell.exec('printf shell > link; printf created > dangling')).exitCode, 0);
  assert.equal(await backing.readFile('/repo/note.txt'), 'shell');
  assert.equal(await backing.readFile('/repo/new.txt'), 'created');
  assert.equal((await backing.lstat('/repo/dangling')).isSymbolicLink, true);
  getOrThrow(await env.createDir('nested/child', { recursive: true }, context));
  assert.equal((await backing.stat('/repo/nested/child')).isDirectory, true);
  assert.equal((await env.createDir('note.txt/child', { recursive: true }, context)).error.code, 'not_directory');
  const fs = createVirtualGitFs(backing).promises;
  await fs.writeFile('/alias/link', 'git');
  assert.equal(await backing.readFile('/repo/note.txt'), 'git');
  await fs.mkdir('/alias/git-dir');
  await fs.rmdir('/alias/git-dir');
  await fs.unlink('/alias/dangling');
  assert.equal(await backing.readFile('/repo/new.txt'), 'created');
  await backing.createExclusive('/alias/private', { mode: 0o600, directory: false });
  assert.equal((await backing.stat('/repo/private')).mode & 0o777, 0o600);
  await assert.rejects(backing.createExclusive('/alias/private', { mode: 0o600, directory: false }), /EEXIST/);
  await backing.symlink('loop-b', '/repo/loop-a');
  await backing.symlink('loop-a', '/repo/loop-b');
  await assert.rejects(backing.writeFile('/alias/loop-a', 'never'), /ELOOP/);
  await assert.rejects(backing.mv('/repo/note.txt', '/repo/nested'), /ENOTSUP/);
  assert.equal(await backing.readFile('/repo/note.txt'), 'git');
});

test('mutations refuse directory corruption and preserve copy destination aliases', async t => {
  const workspace = fixture(t, { '/repo/nested/child': 'retained', '/repo/source': 'copied', '/repo/target': 'original' });
  const env = (await acquire(workspace)).environment, fs = workspace.filesystem;
  for (const method of ['writeFile', 'appendFile']) {
    assert.equal((await env[method]('nested', 'corruption', context)).error.code, 'is_directory');
    assert.equal(getOrThrow(await env.fileInfo('nested', context)).kind, 'directory');
    assert.equal(getOrThrow(await env.readTextFile('nested/child', context)), 'retained');
  }
  await fs.symlink('target', '/repo/link');
  assert.equal((await env.createDir('link', { recursive: true }, context)).error.code, 'not_directory');
  await fs.cp('/repo/source', '/repo/link');
  assert.equal((await fs.lstat('/repo/link')).isSymbolicLink, true);
  assert.equal(await fs.readFile('/repo/target'), 'copied');
  await assert.rejects(fs.cp('/repo/nested', '/repo/new', { recursive: true }), /ENOTSUP/);
  assert.equal(await fs.exists('/repo/new'), false);
});

test('virtual SQLite repository: seeded, git-enabled native env over the SQLite file system; every write lands in SQLite at once and a reopen sees changes, deletions and empty folders (node:sqlite here; a browser passes openBrowserSqliteConnection)', async t => {
  const { openVirtualRepository } = await import('@hachej/boring-execution/virtual-sqlite');
  const { openNodeConnection } = await import('@hachej/boring-files/sqlite');
  const { openSqliteFileSystem } = await import('@hachej/boring-files/sqlite-filesystem');
  const { mkdtempSync, rmSync } = await import('node:fs');
  const { join } = await import('node:path');
  const { tmpdir } = await import('node:os');
  const directory = mkdtempSync(join(tmpdir(), 'boring-virtual-sqlite-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  let db;
  const open = () => {
    db = openNodeConnection(join(directory, 'workspace.sqlite'));
    const fs = openSqliteFileSystem({ connection: db, workspace: 'fictional', cwd: '/repo' });
    return openVirtualRepository({ fs, root: '/repo', seed: { 'README.md': '# Fictional\n', 'src/a.txt': 'a\n' }, seedMessage: 'Seed', author: { name: 'Fictional', email: 'f@example.invalid' }, context });
  };
  // Everything is read through Pi's native env; its shell has git bound to the same repository.
  const sh = async (repo, command) => { let output = ''; const result = getOrThrow(await repo.env.exec(command, { onOutput: text => { output += text; } }, context)); return { output, exitCode: result.exitCode }; };
  const listed = async repo => (await sh(repo, 'find . -type f -not -path "./.git/*" | sort')).output.trim().split('\n');
  let repo = await open();
  try {
    assert.deepEqual(await listed(repo), ['./README.md', './src/a.txt']);
    assert.equal(getOrThrow(await repo.env.readTextFile('README.md', context)), '# Fictional\n');
    assert.deepEqual((await repo.repository.log()).map(entry => entry.commit.message.trim()), ['Seed']);
    const changed = await sh(repo, 'echo changed > src/a.txt && mkdir -p empty/inner && rm README.md && git log');
    assert.equal(changed.exitCode, 0); assert.match(changed.output, /Seed/);
    assert.equal((await sh(repo, 'git branch')).output, 'main\n');
    // Already in SQLite, before any close: the rows are the files.
    const rows = db.all("SELECT path, kind FROM boring_workspace_files WHERE workspace = 'fictional' AND path NOT LIKE '/repo/.git%' ORDER BY path").map(row => `${row.kind} ${row.path}`);
    assert.deepEqual(rows, ['directory /repo', 'directory /repo/empty', 'directory /repo/empty/inner', 'directory /repo/src', 'file /repo/src/a.txt']);
    assert.equal(new TextDecoder().decode(db.get("SELECT bytes FROM boring_workspace_files WHERE path = '/repo/src/a.txt'").bytes), 'changed\n');
    assert.equal((await sh(repo, 'ln -s src/a.txt link')).exitCode, 1, 'links are refused, not faked');
    await repo.close(); db.close?.();
    repo = await open();
    assert.deepEqual(await listed(repo), ['./src/a.txt'], 'the deletion is restored');
    assert.equal(getOrThrow(await repo.env.readTextFile('src/a.txt', context)), 'changed\n');
    assert.equal((await sh(repo, 'ls empty')).output, 'inner\n', 'the empty folder is restored');
    assert.deepEqual((await repo.repository.log()).map(entry => entry.commit.message.trim()), ['Seed'], 'history is restored, not re-seeded');
    assert.equal((await sh(repo, 'git status')).exitCode, 0);
  } finally { await repo.close(); db.close?.(); }
});

// ---- AWS Code Interpreter environment: the real AWS SDK client against the offline fake (examples/aws/fake-code-interpreter.mjs).
async function codeInterpreterFixture(t, users = ['user-a', 'user-b']) {
  const { mkdtempSync, mkdirSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { createCodeInterpreterEnv, efsUserLayout } = await import('@hachej/boring-execution/aws-code-interpreter');
  const { startFakeCodeInterpreter } = await import('../../examples/aws/fake-code-interpreter.mjs');
  const efs = mkdtempSync(join(tmpdir(), 'boring-efs-'));
  const arn = user => `arn:aws:elasticfilesystem:us-east-1:000000000000:access-point/fsap-${user}`;
  const fake = await startFakeCodeInterpreter({ accessPoints: Object.fromEntries(users.map(user => [arn(user), join(efs, 'users', user)])) });
  t.after(() => fake.close());
  const client = await fake.client();
  const open = (user, uid, session, extra = {}, startExtra = {}) => {
    const layout = efsUserLayout({ userId: user, uid, runtimeMountPath: efs });
    mkdirSync(layout.runtime.root, { recursive: true });
    return createCodeInterpreterEnv({ client, codeInterpreterIdentifier: fake.codeInterpreterIdentifier, id: layout.namespaceId, pollIntervalMs: 20, ...extra,
      session: session ?? { start: { ...startExtra, filesystemConfigurations: [layout.filesystemConfiguration({ accessPointArn: arn(user), fileSystemArn: 'arn:aws:elasticfilesystem:us-east-1:000000000000:file-system/fs-0' })] } },
      mount: { path: layout.interpreter.mountPath, root: layout.runtime.root } });
  };
  return { fake, arn, open, efsUserLayout };
}

test('Code Interpreter env: file tools and interpreter commands share one folder; output, exit codes, timeout, abort and loss map to native results', { timeout: 30000 }, async t => {
  const { fake, open } = await codeInterpreterFixture(t);
  const interpreter = open('user-a', 2001, undefined, { renew: 'manual' }), env = interpreter.env;
  assert.equal(interpreter.sessionId(), undefined, 'the session starts on the first command, not before');
  getOrThrow(await env.writeFile('notes/plan.md', 'draft\n', context));
  let output = '';
  const ran = getOrThrow(await env.exec('cat notes/plan.md && echo reviewed >> notes/plan.md && pwd && echo warn >&2 && exit 4', { onOutput: text => { output += text; } }, context));
  assert.equal(ran.exitCode, 4);
  assert.equal(output, 'draft\n/mnt/workspace\nwarn\n');
  assert.equal(getOrThrow(await env.readTextFile('/mnt/workspace/notes/plan.md', context)), 'draft\nreviewed\n');
  assert.deepEqual(getOrThrow(await env.listDir('notes', context)).map(entry => entry.path), ['/mnt/workspace/notes/plan.md']);
  assert.equal(getOrThrow(await env.exec('test "$GREETING" = hi && test "$(basename "$PWD")" = notes', { env: { GREETING: 'hi' }, cwd: 'notes' }, context)).exitCode, 0);
  const timedOut = await env.exec('sleep 5', { timeout: 0.2 }, context);
  assert.equal(timedOut.ok ? 'ok' : timedOut.error.code, 'timeout');
  const cancelled = withCancel(context);
  setTimeout(() => cancelled.cancel(), 100);
  const aborted = await env.exec('sleep 5', {}, cancelled.context);
  assert.equal(aborted.ok ? 'ok' : aborted.error.code, 'aborted');
  assert.equal(fake.calls.filter(call => call.name === 'stopTask').length, 2, 'timeout and abort both request stopTask');
  // renew: 'manual' (the old behaviour): the service ends the session, commands report it, nothing restarts on its own, renew() is the owner's explicit choice.
  const first = interpreter.sessionId();
  fake.expire(first);
  const gone = await env.exec('true', {}, context);
  assert.equal(gone.ok ? 'ok' : gone.error.code, 'shell_unavailable');
  assert.equal(interpreter.lost(), true);
  assert.equal(getOrThrow(await env.readTextFile('notes/plan.md', context)), 'draft\nreviewed\n', 'files on the mount outlive the session');
  const stillGone = await env.exec('true', {}, context);
  assert.equal(stillGone.ok ? 'ok' : stillGone.error.code, 'shell_unavailable', 'manual mode never restarts by itself');
  assert.equal(interpreter.renew(), true);
  assert.equal(getOrThrow(await env.exec('cat notes/plan.md', {}, context)).exitCode, 0);
  assert.notEqual(interpreter.sessionId(), first);
  // Releasing a consumer's view never stops the session; the owner's stop() does, once.
  await env.cleanup(context);
  assert.equal(fake.calls.filter(call => call.operation === 'StopCodeInterpreterSession').length, 0);
  await interpreter.stop(context); await interpreter.stop(context);
  assert.equal(fake.calls.filter(call => call.operation === 'StopCodeInterpreterSession').length, 1);
  const stopped = await env.exec('true', {}, context);
  assert.equal(stopped.ok ? 'ok' : stopped.error.code, 'shell_unavailable');
  // A borrowed session is used as is and never stopped here.
  const owner = open('user-a', 2001);
  getOrThrow(await owner.env.exec('true', {}, context));
  const borrowed = open('user-a', 2001, { sessionId: owner.sessionId() });
  assert.equal(borrowed.owned, false);
  assert.equal(getOrThrow(await borrowed.env.exec('cat notes/plan.md', {}, context)).exitCode, 0);
  // A borrowed session is always manual, whatever renew says: the owner of the session decides.
  const borrowedAuto = open('user-a', 2001, { sessionId: owner.sessionId() }, { renew: 'auto' });
  fake.expire(owner.sessionId());
  for (let i = 0; i < 2; i++) { const dead = await borrowedAuto.env.exec('true', {}, context); assert.equal(dead.ok ? 'ok' : dead.error.code, 'shell_unavailable'); }
  assert.equal(borrowedAuto.renew(), false);
  await borrowed.stop(context);
  assert.equal(fake.calls.filter(call => call.operation === 'StopCodeInterpreterSession').length, 1);
});

const starts = fake => fake.calls.filter(call => call.operation === 'StartCodeInterpreterSession').length;
const codeOf = result => result.ok ? 'ok' : result.error.code;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

test('Code Interpreter env (renew auto): a session lost mid-turn fails that command once, and the next command starts a new session with no host call', { timeout: 30000 }, async t => {
  const { fake, open } = await codeInterpreterFixture(t);
  const interpreter = open('user-a', 2001), env = interpreter.env;
  getOrThrow(await env.writeFile('kept.txt', 'kept\n', context));
  assert.equal(getOrThrow(await env.exec('true', {}, context)).exitCode, 0);
  const first = interpreter.sessionId();
  const running = env.exec('sleep 5', {}, context);
  await delay(200); fake.expire(first);
  assert.equal(codeOf(await running), 'shell_unavailable', 'the running command is reported, never replayed');
  assert.equal(starts(fake), 1, 'no session was started behind the failing command');
  assert.equal(interpreter.lost(), true);
  assert.equal(getOrThrow(await env.exec('cat kept.txt', {}, context)).exitCode, 0, 'the next command works without renew()');
  assert.notEqual(interpreter.sessionId(), first);
  assert.equal(interpreter.lost(), false);
  assert.equal(starts(fake), 2);
});

test('Code Interpreter env (renew auto): expiry under concurrent and background commands fails each of them once and starts exactly one new session', { timeout: 30000 }, async t => {
  const { fake, open } = await codeInterpreterFixture(t);
  const interpreter = open('user-a', 2001), env = interpreter.env;
  getOrThrow(await env.exec('true', {}, context));
  const first = interpreter.sessionId();
  // Two long commands, as the harness's background tasks and a foreground call would be.
  const background = [env.exec('sleep 5', {}, context), env.exec('sleep 5', {}, context)];
  await delay(200); fake.expire(first);
  assert.deepEqual((await Promise.all(background)).map(codeOf), ['shell_unavailable', 'shell_unavailable']);
  // Two commands arrive together afterwards: one session, shared.
  const next = await Promise.all([env.exec('true', {}, context), env.exec('true', {}, context)]);
  assert.deepEqual(next.map(codeOf), ['ok', 'ok']);
  assert.equal(starts(fake), 2);
});

test('Code Interpreter env (renew auto): a session is rotated before its time to live, never under a running command, and the old one is stopped', { timeout: 30000 }, async t => {
  const { fake, open } = await codeInterpreterFixture(t);
  const interpreter = open('user-a', 2001, undefined, { rotateMarginSeconds: 1 }, { sessionTimeoutSeconds: 2 }), env = interpreter.env;
  getOrThrow(await env.writeFile('kept.txt', 'kept\n', context));
  getOrThrow(await env.exec('true', {}, context));
  const first = interpreter.sessionId();
  const long = env.exec('sleep 1.6; echo done', { onOutput: () => {} }, context);
  await delay(1200); // older than ttl - margin, but a command runs
  assert.equal(getOrThrow(await env.exec('true', {}, context)).exitCode, 0);
  assert.equal(interpreter.sessionId(), first, 'no rotation while a command is running');
  assert.equal(getOrThrow(await long).exitCode, 0, 'the running command was not interrupted');
  assert.equal(starts(fake), 1);
  assert.equal(getOrThrow(await env.exec('cat kept.txt', {}, context)).exitCode, 0);
  assert.notEqual(interpreter.sessionId(), first, 'rotated before the next command');
  assert.equal(starts(fake), 2);
  await delay(100);
  assert.ok(fake.calls.some(call => call.operation === 'StopCodeInterpreterSession' && call.sessionId === first), 'the old session is stopped best-effort');
  assert.equal(fake.sessions.get(first).live, false);
});

// A client around the fake that can fail on demand: Start (after `startDelayMs`) and getTask with a transport error.
function flaky(inner) {
  const state = { failStart: false, failPoll: false, startDelayMs: 0, starts: 0 };
  return { state, send: async (command, ...rest) => {
    const name = command.constructor.name;
    if (name === 'StartCodeInterpreterSessionCommand') {
      state.starts++;
      if (state.startDelayMs) await delay(state.startDelayMs);
      if (state.failStart) throw Object.assign(new Error('fictional start outage'), { name: 'ServiceUnavailableException' });
    }
    if (name === 'InvokeCodeInterpreterCommand' && state.failPoll && command.input.name === 'getTask') throw Object.assign(new Error('fictional network reset'), { name: 'NetworkError' });
    return inner.send(command, ...rest);
  } };
}
const stoppedSessions = fake => fake.calls.filter(call => call.operation === 'StopCodeInterpreterSession').map(call => call.sessionId);

test('Code Interpreter env (renew auto): a command whose outcome is unknown keeps its session: no rotation, no stop, and nothing is replayed', { timeout: 30000 }, async t => {
  const { fake, open } = await codeInterpreterFixture(t);
  const client = flaky(await fake.client());
  const interpreter = open('user-a', 2001, undefined, { client, rotateMarginSeconds: 1 }, { sessionTimeoutSeconds: 2 }), env = interpreter.env;
  getOrThrow(await env.exec('true', {}, context));
  const first = interpreter.sessionId();
  client.state.failPoll = true;
  const unknown = await env.exec('sleep 1.5; echo ran >> ran.txt', {}, context);
  assert.equal(codeOf(unknown), 'unknown', 'the transport failure is reported, not retried');
  client.state.failPoll = false;
  await delay(1200); // older than ttl - margin, while the remote task may still run
  assert.equal(getOrThrow(await env.exec('true', {}, context)).exitCode, 0);
  assert.equal(interpreter.sessionId(), first, 'an unresolved task blocks rotation');
  assert.equal(client.state.starts, 1);
  await delay(900);
  assert.deepEqual(stoppedSessions(fake), [], 'the session running the unresolved task is not stopped');
  assert.equal(getOrThrow(await env.readTextFile('ran.txt', context)), 'ran\n', 'the task finished once, on its own session');
});

test('Code Interpreter env (renew auto): a failed rotation keeps the old session for every command, backs off, and stop() still disposes the old session', { timeout: 30000 }, async t => {
  const { fake, open } = await codeInterpreterFixture(t);
  const client = flaky(await fake.client());
  const interpreter = open('user-a', 2001, undefined, { client, rotateMarginSeconds: 1 }, { sessionTimeoutSeconds: 2 }), env = interpreter.env;
  getOrThrow(await env.exec('true', {}, context));
  const first = interpreter.sessionId();
  await delay(1100); // due for rotation
  client.state.failStart = true; client.state.startDelayMs = 200;
  // The command that triggers the rotation and one that arrives during it both succeed on the old session.
  const together = await Promise.all([env.exec('true', {}, context), delay(50).then(() => env.exec('true', {}, context))]);
  assert.deepEqual(together.map(codeOf), ['ok', 'ok']);
  assert.equal(interpreter.sessionId(), first);
  assert.equal(client.state.starts, 2, 'one rotation attempt');
  client.state.startDelayMs = 0;
  for (let i = 0; i < 4; i++) assert.equal(codeOf(await env.exec('true', {}, context)), 'ok');
  assert.equal(client.state.starts, 2, 'no new Start on every following command');
  await delay(1100);
  assert.equal(codeOf(await env.exec('true', {}, context)), 'ok');
  assert.equal(client.state.starts, 3, 'one retry after the backoff');
  // stop() while a rotation is failing disposes the old session.
  await delay(1100);
  client.state.startDelayMs = 200;
  const pending = env.exec('true', {}, context);
  await delay(50);
  await interpreter.stop(context);
  await pending;
  assert.deepEqual(stoppedSessions(fake), [first], 'the old session is stopped by stop(), once');
  assert.equal(fake.sessions.get(first).live, false);
});

test('Code Interpreter env: only listed session-ended errors count as loss; permission errors do not', { timeout: 15000 }, async t => {
  const { createCodeInterpreterEnv, SESSION_ENDED_ERRORS } = await import('@hachej/boring-execution/aws-code-interpreter');
  assert.ok(SESSION_ENDED_ERRORS.length > 0);
  const make = failure => {
    const client = { send: async command => {
      if (command.constructor.name === 'StartCodeInterpreterSessionCommand') return { sessionId: 'fictional-session' };
      throw Object.assign(new Error(failure.message), { name: failure.name });
    } };
    return createCodeInterpreterEnv({ client, codeInterpreterIdentifier: 'fictional', id: 'ns', session: { start: {} }, mount: { path: '/mnt/workspace', root: process.cwd() } });
  };
  const denied = make({ name: 'AccessDeniedException', message: 'session terminated' });
  assert.equal(codeOf(await denied.env.exec('true', {}, context)), 'shell_unavailable');
  assert.equal(denied.lost(), false, 'a permission error is not a lost session');
  const ended = make({ name: 'ValidationException', message: 'The session has been terminated' });
  assert.equal(codeOf(await ended.env.exec('true', {}, context)), 'shell_unavailable');
  assert.equal(ended.lost(), true);
  const invalid = make({ name: 'ValidationException', message: 'Invalid command argument' });
  assert.notEqual(codeOf(await invalid.env.exec('true', {}, context)), 'shell_unavailable');
  assert.equal(invalid.lost(), false);
});

test('Code Interpreter env: two users never see each other\'s folders (own access point, confined file tools, symlinks included)', { timeout: 30000 }, async t => {
  const { fake, arn, open, efsUserLayout } = await codeInterpreterFixture(t);
  const a = open('user-a', 2001).env, b = open('user-b', 2002).env;
  getOrThrow(await a.writeFile('secret.md', 'only for user a\n', context));
  getOrThrow(await b.exec('true', {}, context));
  assert.deepEqual(fake.calls.filter(call => call.operation === 'StartCodeInterpreterSession').map(call => call.filesystemConfigurations[0].efsConfiguration.accessPointArn), [arn('user-b')]);
  assert.deepEqual(getOrThrow(await b.listDir('.', context)), []);
  for (const path of ['../user-a/secret.md', '/mnt/workspace/../workspace/../efs/users/user-a/secret.md', '/tmp/x']) {
    const read = await b.readTextFile(path, context);
    assert.equal(read.ok ? 'read' : read.error.code, 'permission_denied', path);
  }
  // Links made in the interpreter that point at the other folder (as this host resolves them) are refused, dangling or not.
  getOrThrow(await b.exec('ln -s ../user-a/secret.md near && ln -s ../user-a/new.md dangling && ln -s ../user-a linked', {}, context));
  for (const path of ['near', 'linked/secret.md']) { const read = await b.readTextFile(path, context); assert.equal(read.ok ? 'read' : read.error.code, 'permission_denied', path); }
  for (const path of ['dangling', 'linked/new.md']) { const write = await b.writeFile(path, 'x', context); assert.equal(write.ok ? 'written' : write.error.code, 'permission_denied', path); }
  const canonical = await b.canonicalPath('near', context);
  assert.equal(canonical.ok ? canonical.value : canonical.error.code, 'permission_denied');
  assert.equal(getOrThrow(await b.fileInfo('near', context)).kind, 'symlink', 'the link itself is visible; its target is not');
  assert.equal(getOrThrow(await a.exists('new.md', context)), false);
  assert.equal(getOrThrow(await a.readTextFile('secret.md', context)), 'only for user a\n');
  // The layout is pure and refuses anything that could name another folder.
  for (const userId of ['..', 'a/b', 'A', '', '.hidden', 'x'.repeat(65)]) assert.throws(() => efsUserLayout({ userId, uid: 2001 }), TypeError, userId);
  assert.throws(() => efsUserLayout({ userId: 'user-a', uid: 0 }), TypeError);
  const layout = efsUserLayout({ userId: 'user-a', uid: 2001 });
  assert.deepEqual([layout.accessPoint.rootDirectory, layout.runtime.root, layout.runtime.journal, layout.harnessFile('main'), layout.interpreter.mountPath],
    ['/boring/users/user-a', '/mnt/efs/users/user-a', '/mnt/efs/state/user-a/journal.sqlite', '/mnt/efs/state/user-a/main.pi.sqlite', '/mnt/workspace']);
  assert.throws(() => layout.harnessFile('../b'), TypeError);
});

test('errors leaving a virtual workspace are bounded: no stack frames reach a tool result, and the text stays under MAX_ERROR_CHARS', { timeout: 15000 }, async t => {
  const { MAX_ERROR_CHARS } = await import('@hachej/boring-execution/virtual');
  const { createBashTool } = await import('@earendil-works/pi-durable/tools');
  const { toolResultText } = await import('../fixtures/native-document.mjs');
  const { FileError, err } = await import('@earendil-works/pi-durable/env');
  // A host failure with a long stack inside its message, as a backing that wraps another error's stack would report it.
  const deep = n => { if (!n) { const inner = new Error('fictional backing failed'); return `${inner.message}\n${String(inner.stack).split('\n').slice(1).join('\n')}${'\n    at fictionalFrame (/host/fictional/backing.js:1:1)'.repeat(400)}`; } return deep(n - 1); };
  const stacked = deep(50);
  assert.ok(stacked.length > 10_000 && /^\s+at /m.test(stacked), 'the fixture error carries a long host stack');
  // The workspace keeps its files in a Pi FileSystem (here another virtual workspace's env) whose reads of broken.txt fail with it.
  const backing = fixture(t, { '/repo/note.txt': 'original\n', '/repo/broken.txt': 'unreadable\n' }), inner = (await acquire(backing)).environment;
  const failing = path => String(path).endsWith('broken.txt');
  const fs = new Proxy(inner, { get: (target, key) => key === 'readBinaryFile' || key === 'readTextFile'
    ? (path, ...rest) => failing(path) ? Promise.resolve(err(new FileError('unknown', stacked, path))) : target[key](path, ...rest) : target[key] });
  // Git's host policy callback throws the same error.
  const workspace = createVirtualWorkspace({ providerId: 'fictional-bounded', fs, onBash: bash => installVirtualGitCommand({ bash,
    repository: createGitRepository({ fs: createVirtualGitFs(bash.fs), directory: '/repo', author, authorize: () => { throw new Error(stacked); } }) }) });
  t.after(() => workspace.dispose());
  const leases = [];
  const registry = createRegistry(); registry.install(defineExtension({ name: 'fictional.bounded-errors', tools: [createBashTool(), createReadTool()] }));
  const harness = await Harness.open(new MemoryStorage(), { registry, models: createModels(), env: async () => { const lease = await acquire(workspace); leases.push(lease); return lease.environment; } }, context);
  t.after(async () => { await harness.close(context); for (const lease of leases) await lease.release(context); });
  const conversation = await harness.root(context);
  // just-bash's own commands word their errors themselves (cat says "No such file or directory"); Git and the native tools pass the message on.
  for (const [name, args, said] of [['read', { path: 'broken.txt' }, /fictional backing failed/], ['bash', { command: 'cat broken.txt' }, /cat: broken.txt/], ['bash', { command: 'git init' }, /fictional backing failed/]]) {
    const { isError, text } = await toolResultText(harness, conversation, await admitDocumentTool(conversation, args, name));
    const label = `${name} ${JSON.stringify(args)}`;
    assert.equal(isError, true, `${label}: ${text.slice(0, 200)}`);
    assert.match(text, said, label);
    assert.doesNotMatch(text, /^\s+at /m, `${label} shows no stack frames`);
    assert.ok(text.length < MAX_ERROR_CHARS + 500, `${label} is bounded: ${text.length} characters`);
  }
  const direct = await (await acquire(workspace)).environment.readTextFile('broken.txt', context);
  assert.equal(direct.ok, false);
  assert.ok(direct.error.message.length <= MAX_ERROR_CHARS && !/^\s+at /m.test(direct.error.message), 'the native environment\'s own error is bounded too');
});

test('AWS example: a workspace is busy only for live work of its own user', async () => {
  const { hasLiveWork } = await import('../../examples/aws/live-work.mjs');
  const owners = { c1: 'alice', c2: 'bob', c3: 'bob' };
  const userOf = async id => owners[id];
  const task = conversationId => ({ record: { conversationId } });
  const submission = conversationId => ({ conversationId });
  assert.equal(await hasLiveWork({ tasks: [], submissions: [] }, 'alice', userOf), false);
  assert.equal(await hasLiveWork(undefined, 'alice', userOf), false);
  assert.equal(await hasLiveWork({ tasks: [task('c2')], submissions: [] }, 'alice', userOf), false, "bob's task does not keep alice's workspace open");
  assert.equal(await hasLiveWork({ tasks: [task('c2')], submissions: [] }, 'bob', userOf), true);
  assert.equal(await hasLiveWork({ tasks: [task('c1')], submissions: [submission('c3')] }, 'bob', userOf), true, 'an unsettled submission counts');
  assert.equal(await hasLiveWork({ tasks: [task('c1')], submissions: [] }, 'bob', userOf), false);
  assert.equal(await hasLiveWork({ tasks: [task('unknown')], submissions: [] }, 'alice', userOf), false);
});
