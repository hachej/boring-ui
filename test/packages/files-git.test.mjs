import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm, readFile, writeFile, mkdir } from 'node:fs/promises';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createGitRepository, GitOperationError } from '@hachej/boring-files/git';
import git from 'isomorphic-git';

async function fixture(t, options = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'boring-git-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const repository = createGitRepository({ fs, directory, author: { name: 'Fictional', email: 'fixture@example.invalid' }, authorize: () => true, ...options });
  return { directory, repository };
}

test('shared repository supports local commits, branches, index removal and exact binary diffs', async t => {
  const { directory, repository: repo } = await fixture(t);
  await repo.init();
  await writeFile(join(directory, 'note'), 'first\n');
  await repo.add('note');
  const first = await repo.commit('first');
  await repo.branch('work'); await repo.checkout('work');
  await writeFile(join(directory, 'note'), Buffer.from([0, 255, 1]));
  let changes = await repo.diff({ kind: 'index' }, { kind: 'worktree' });
  assert.deepEqual(changes.map(change => change.path), ['note']);
  assert.equal(new TextDecoder().decode(changes[0].before.bytes), 'first\n');
  assert.deepEqual(changes[0].after.bytes, new Uint8Array([0, 255, 1]));
  await repo.add('note');
  assert.deepEqual(await repo.diff({ kind: 'index' }, { kind: 'worktree' }), []);
  changes = await repo.diff({ kind: 'tree', ref: first }, { kind: 'index' });
  assert.deepEqual(changes[0].after.bytes, new Uint8Array([0, 255, 1]));
  const second = await repo.commit('second');
  assert.deepEqual((await repo.log()).map(entry => entry.oid), [second, first]);
  assert.deepEqual(await repo.branches(), ['main', 'work']);
  await repo.checkout('main');
  assert.equal(await readFile(join(directory, 'note'), 'utf8'), 'first\n');
  await repo.remove('note');
  assert.equal(await readFile(join(directory, 'note'), 'utf8'), 'first\n');
  assert.equal((await repo.status())[0][3], 0);
});

test('read-only status and diff do not refresh index metadata', async t => {
  const { directory, repository: repo } = await fixture(t);
  await repo.init(); await writeFile(join(directory, 'note'), 'same'); await repo.add('note'); await repo.commit('first');
  const index = join(directory, '.git/index'), before = await readFile(index);
  await writeFile(join(directory, 'note'), 'same');
  await repo.status(); await repo.diff({ kind: 'tree', ref: 'HEAD' }, { kind: 'worktree' });
  assert.deepEqual(await readFile(index), before);
});

test('queued calls recheck authorization and aborted writes have no effects', async t => {
  let allow = true, block;
  const entered = Promise.withResolvers(), release = Promise.withResolvers();
  const { directory, repository: repo } = await fixture(t, { authorize: async operation => {
    if (block === operation) { block = undefined; entered.resolve(); await release.promise; }
    return allow;
  } });
  await repo.init(); await writeFile(join(directory, 'note'), 'keep');
  block = 'status'; const first = repo.status(); await entered.promise;
  const second = repo.add('note'); allow = false; release.resolve();
  for (const operation of [first, second]) await assert.rejects(operation, error => error instanceof GitOperationError && error.effects === 'none');
  allow = true;
  assert.equal((await repo.status())[0][3], 0);
  const abort = new AbortController(); abort.abort();
  await assert.rejects(repo.add('note', abort.signal), error => error.effects === 'none');
  assert.equal((await repo.status())[0][3], 0);
  await repo.add('note');
  assert.equal((await repo.status())[0][3], 2);
});

test('strict grants, late authorization changes and recovery after errors remain explicit', async t => {
  let grant = true, checks = 0;
  const { directory, repository: repo } = await fixture(t, { authorize: () => { checks++; return grant; } });
  for (grant of [undefined, null, 'true', 1, {}, false]) await assert.rejects(repo.init(), error => error.effects === 'none');
  grant = true; await repo.init(); await writeFile(join(directory, 'note'), 'keep');
  const late = createGitRepository({ fs, directory, author: { name: 'Fictional', email: 'fixture@example.invalid' }, authorize: () => ++checks % 2 === 1 });
  checks = 0;
  await assert.rejects(late.add('note'), error => error.effects === 'possible' && /prior Git effects/.test(error.message));
  assert.equal((await repo.status())[0][3], 2);
  await assert.rejects(repo.checkout('missing'), error => error.effects === 'possible');
  assert.equal((await repo.status())[0][0], 'note');
});

test('invalid worktree paths refuse and diff limits report failure without truncated success', async t => {
  const { directory, repository: repo } = await fixture(t, { diffLimits: { files: 1, bytes: 4 } });
  await repo.init();
  for (const path of ['/outside', '../outside', 'dir/../../outside', '.git/config', 'nested/.GIT/config', 'a\\b']) assert.throws(() => repo.add(path), /selected worktree/);
  for (const ref of ['../../outside', 'a..b', 'x.lock']) assert.throws(() => repo.checkout(ref), /Invalid Git reference/);
  await writeFile(join(directory, 'note'), 'oversized');
  await assert.rejects(repo.diff({ kind: 'index' }, { kind: 'worktree' }), /byte limit/);
  await writeFile(join(directory, 'note'), 'a'); await writeFile(join(directory, 'second'), 'b');
  await assert.rejects(repo.diff({ kind: 'index' }, { kind: 'worktree' }), /file limit/);
});

test('directory to file replacement reports the parent addition and child deletion', async t => {
  const { directory, repository: repo } = await fixture(t);
  await repo.init(); await mkdir(join(directory, 'nested')); await writeFile(join(directory, 'nested/note'), 'old');
  await repo.add('.'); await repo.commit('first');
  await rm(join(directory, 'nested'), { recursive: true }); await writeFile(join(directory, 'nested'), 'new');
  const changes = await repo.diff({ kind: 'index' }, { kind: 'worktree' });
  assert.deepEqual(changes.map(change => change.path), ['nested', 'nested/note']);
  assert.equal(changes[0].before, null); assert.equal(changes[1].after, null);
});

test('concurrent callers preserve all staged files through one repository queue', async t => {
  const { directory, repository: repo } = await fixture(t);
  await repo.init();
  const paths = Array.from({ length: 16 }, (_, index) => `note-${index}`);
  await Promise.all(paths.map(path => writeFile(join(directory, path), path)));
  await Promise.all(paths.map(path => repo.add(path)));
  const matrix = await repo.status();
  assert.equal(matrix.length, paths.length);
  assert.ok(matrix.every(row => row[3] === 2));
  await repo.commit('Subject\n\nBody retained');
  assert.equal((await repo.log())[0].commit.message, 'Subject\n\nBody retained\n');
});

test('late cancellation retains possible effects after the real index write', async t => {
  const abort = new AbortController();
  let interrupt = false;
  const backing = { promises: { ...fs.promises, writeFile: async (path, ...args) => {
    await fs.promises.writeFile(path, ...args);
    if (interrupt && path.endsWith('/.git/index')) abort.abort();
  } } };
  const { directory, repository: repo } = await fixture(t, { fs: backing });
  await repo.init(); await writeFile(join(directory, 'note'), 'retained'); interrupt = true;
  await assert.rejects(repo.add('note', abort.signal), error => error.effects === 'possible' && /aborted after execution/.test(error.message));
  assert.equal((await repo.status())[0][3], 2);
});

test('read results are withheld when repository authorization changes after execution', async t => {
  let statusChecks = 0;
  const { directory, repository: repo } = await fixture(t, { authorize: operation => operation !== 'status' || ++statusChecks === 1 });
  await repo.init(); await writeFile(join(directory, 'note'), 'private fixture');
  await assert.rejects(repo.status(), error => error.effects === 'none' && /changed during execution/.test(error.message));
  assert.equal(statusChecks, 2);
});

test('diff refuses real Git submodule entries without fabricating empty file content', async t => {
  const { directory, repository: repo } = await fixture(t);
  await repo.init(); await writeFile(join(directory, 'note'), 'first'); await repo.add('note');
  const oid = await repo.commit('first');
  const empty = await git.writeTree({ fs, dir: directory, tree: [] });
  const submodule = await git.writeTree({ fs, dir: directory, tree: [{ mode: '160000', path: 'module', oid, type: 'commit' }] });
  await assert.rejects(repo.diff({ kind: 'tree', ref: empty }, { kind: 'tree', ref: submodule }), /supports blob entries only/);
});
