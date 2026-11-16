// A disk workspace's provider reaches its folder only through the no-follow walk (D-2087): a link inside the folder that
// leads out of it is never listed, read or written through the public provider, whatever another writer does meanwhile.
// Fictional files only, in this test's own temporary directory.
import assert from 'node:assert/strict';
import test from 'node:test';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context';
import { createFolderEnv } from '@hachej/boring-execution/folder';
import { createWorkspaceJournal } from '@hachej/boring-files/journal';
import { openNodeConnection } from '@hachej/boring-files/sqlite';
import { blobRevision, createWorkspaceProvider } from '@hachej/boring-files/workspace';

const SECRET = 'fictional secret outside the workspace\n';
const access = { scopeId: 'fictional-project', principalId: 'editor', initiatorId: 'alice' };
const encoder = new TextEncoder();
const target = path => ({ resource: { providerId: 'fictional-workspace', path }, view: { kind: 'published' } });
const latest = path => ({ target: target(path), revision: { kind: 'latest' } });
const create = (operationId, path, text) => ({ operationId, atomicity: 'all-or-nothing', changes: [{ kind: 'create', target: target(path), expected: { kind: 'absent' }, bytes: encoder.encode(text), mediaType: 'text/markdown' }] });
const replace = (operationId, ref, text) => ({ operationId, atomicity: 'all-or-nothing', changes: [{ kind: 'replace', target: ref, bytes: encoder.encode(text), mediaType: 'text/markdown' }] });

/** What a host does: one folder env, one provider over it. */
function open(t) {
  const base = mkdtempSync(join(tmpdir(), 'boring-folder-no-follow-'));
  const root = join(base, 'workspace'), outside = join(base, 'outside');
  mkdirSync(join(root, 'd'), { recursive: true });
  mkdirSync(outside);
  writeFileSync(join(root, 'd', 'f'), 'inside\n');
  writeFileSync(join(root, 'inside.md'), 'inside text');
  writeFileSync(join(outside, 'f'), SECRET);
  writeFileSync(join(outside, 'secret.md'), SECRET);
  const connection = openNodeConnection(join(base, 'journal.sqlite'));
  const env = createFolderEnv({ cwd: root });
  const identity = { providerId: 'fictional-workspace', instanceId: 'disk', incarnation: 'one', viewId: 'view' };
  const provider = createWorkspaceProvider({ identity, fs: env, journal: createWorkspaceJournal(connection) });
  t.after(async () => { await env.cleanup(BACKGROUND_CONTEXT); connection.close(); rmSync(base, { recursive: true, force: true }); });
  return { provider, root, outside, publish: request => provider.publication.publish(request, access) };
}

test('links that lead out of the folder (a file, a directory, a loop) are never listed, read or written through the provider', async t => {
  const { provider, publish, root, outside } = open(t);
  symlinkSync(join(outside, 'secret.md'), join(root, 'escape.md'));
  symlinkSync(outside, join(root, 'away'));
  symlinkSync(join(root, 'loop-b'), join(root, 'loop-a'));
  symlinkSync(join(root, 'loop-a'), join(root, 'loop-b'));

  for (const path of ['escape.md', 'away/secret.md', 'away/f', 'loop-a', 'loop-a/x.md']) {
    const read = await provider.read(latest(path), access);
    assert.notEqual(read.kind, 'available', `${path} was read`);
    assert.equal(read.snapshot, undefined, `${path} returned bytes`);
  }
  const forged = { ...target('escape.md'), revision: await blobRevision(encoder.encode(SECRET)) };
  for (const [name, request] of [
    ['through the file link', replace('through-file', forged, 'overwritten')],
    ['into the directory link', create('into-dir', 'away/new.md', 'must not land')],
    ['below the loop', create('into-loop', 'loop-a/new.md', 'must not land')],
  ]) assert.notEqual((await publish(request)).kind, 'committed', name);

  assert.equal(readFileSync(join(outside, 'secret.md'), 'utf8'), SECRET);
  assert.deepEqual(readdirSync(outside).sort(), ['f', 'secret.md'], 'nothing was created outside');

  const seen = await provider.poll();
  const again = await provider.poll();
  assert.deepEqual([...seen, ...again].map(change => change.path).filter(path => path.startsWith('away') || path.startsWith('escape') || path.startsWith('loop')), [], 'no change was reported through a link');
});

test('a link inside the folder to a file inside it is still read', async t => {
  const { provider, root, outside } = open(t);
  symlinkSync(join(root, 'inside.md'), join(root, 'alias.md'));
  symlinkSync(outside, join(root, 'away'));
  const read = await provider.read(latest('alias.md'), access);
  assert.equal(read.kind, 'available');
  assert.equal(new TextDecoder().decode(read.snapshot.bytes), 'inside text');
  assert.equal(existsSync(join(outside, 'new.md')), false);
});

// The other writer's side: `d` keeps flipping between the real directory and a link to the outside folder.
const SWAPPER = `
const { renameSync, rmSync, lstatSync, symlinkSync } = require('node:fs');
const { join } = require('node:path');
const root = process.argv[1], outside = process.argv[2], until = Date.now() + Number(process.argv[3]);
const at = name => join(root, name);
const tryIt = fn => { try { fn(); } catch {} };
symlinkSync(outside, at('d-link'));
process.stdout.write('ready\\n');
while (Date.now() < until) {
  tryIt(() => { if (lstatSync(at('d')).isDirectory() && lstatSync(at('d-real')).isDirectory()) rmSync(at('d'), { recursive: true, force: true }); });
  tryIt(() => renameSync(at('d'), at('d-real')));
  tryIt(() => renameSync(at('d-link'), at('d')));
  tryIt(() => renameSync(at('d'), at('d-link')));
  tryIt(() => renameSync(at('d-real'), at('d')));
}
`;

test('a directory swapped for an outside link while the provider reads and writes never leaks or changes the outside file', { timeout: 30000 }, async t => {
  const { provider, publish, root, outside } = open(t);
  const swapper = spawn(process.execPath, ['-e', SWAPPER, root, outside, '3000'], { stdio: ['ignore', 'pipe', 'inherit'] });
  t.after(() => { if (swapper.exitCode === null) swapper.kill('SIGKILL'); });
  const exited = new Promise(resolve => swapper.once('exit', resolve));
  await new Promise((resolve, reject) => { swapper.stdout.once('data', resolve); swapper.once('error', reject); });

  let reads = 0, writes = 0, leaked = 0;
  const readUntil = Date.now() + 1400;
  while (Date.now() < readUntil && swapper.exitCode === null) {
    const read = await provider.read(latest('d/f'), access);
    reads++;
    if (read.kind === 'available' && new TextDecoder().decode(read.snapshot.bytes) === SECRET) leaked++;
  }
  const writeUntil = Date.now() + 1400;
  while (Date.now() < writeUntil && swapper.exitCode === null) {
    await publish(create(`w${writes}`, `d/new-${writes}.md`, 'written by the host\n'));
    writes++;
  }
  await exited;

  assert.ok(reads > 20 && writes > 3, `the race ran (${reads} reads, ${writes} writes)`);
  assert.equal(leaked, 0, `no read returned the outside file (${leaked} of ${reads} did)`);
  assert.equal(readFileSync(join(outside, 'f'), 'utf8'), SECRET, 'the outside file was never changed');
  assert.deepEqual(readdirSync(outside).sort(), ['f', 'secret.md'], 'nothing was created outside');
});
