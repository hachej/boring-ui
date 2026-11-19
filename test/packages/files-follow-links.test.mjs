// followLinks: listing, search and polling over a disk workspace walk symbolic links that stay inside the root, and nothing else.
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NodeExecutionEnv } from '@earendil-works/pi-durable/env/node';
import { openNodeConnection } from '@hachej/boring-files/sqlite';
import { createWorkspaceJournal } from '@hachej/boring-files/journal';
import { createWorkspaceProvider } from '@hachej/boring-files/workspace';

const access = { scopeId: 'fictional-project', principalId: 'editor', initiatorId: 'alice' };
const encoder = new TextEncoder(), decoder = new TextDecoder();
const target = path => ({ resource: { providerId: 'fictional-workspace', path }, view: { kind: 'published' } });
const latest = path => ({ target: target(path), revision: { kind: 'latest' } });
const create = (operationId, path, text) => ({ operationId, atomicity: 'all-or-nothing', changes: [{ kind: 'create', target: target(path), expected: { kind: 'absent' }, bytes: encoder.encode(text), mediaType: 'text/markdown' }] });
const replace = (operationId, ref, text) => ({ operationId, atomicity: 'all-or-nothing', changes: [{ kind: 'replace', target: ref, bytes: encoder.encode(text), mediaType: 'text/markdown' }] });

function fixture(t, followLinks) {
  const directory = mkdtempSync(join(tmpdir(), 'boring-follow-'));
  const root = join(directory, 'workspace'), outside = join(directory, 'outside');
  mkdirSync(root); mkdirSync(outside);
  writeFileSync(join(outside, 'secret.md'), 'outside secret');
  mkdirSync(join(root, 'real')); mkdirSync(join(root, 'real', 'deep'));
  writeFileSync(join(root, 'real', 'doc.md'), 'real doc');
  writeFileSync(join(root, 'real', 'deep', 'note.md'), 'deep note');
  writeFileSync(join(root, 'top.md'), 'top');
  symlinkSync(join(root, 'real'), join(root, 'near'));
  symlinkSync(join(root, 'top.md'), join(root, 'alias.md'));
  symlinkSync(outside, join(root, 'away'));
  symlinkSync(join(outside, 'secret.md'), join(root, 'escape.md'));
  symlinkSync(join(root, 'nowhere'), join(root, 'dangling'));
  symlinkSync(root, join(root, 'real', 'loop'));
  const db = openNodeConnection(join(directory, 'journal.sqlite'));
  t.after(() => { db.close?.(); rmSync(directory, { recursive: true, force: true }); });
  const identity = { providerId: 'fictional-workspace', instanceId: 'disk', incarnation: 'one', viewId: 'view' };
  const provider = createWorkspaceProvider({ identity, fs: new NodeExecutionEnv({ cwd: root }), journal: createWorkspaceJournal(db), ...(followLinks === undefined ? {} : { followLinks }) });
  const publish = request => provider.publication.publish(request, access);
  const paths = async () => (await provider.catalog.search({ query: '.md', limit: 500 }, access)).entries.map(entry => entry.path).sort();
  return { provider, publish, root, outside, paths };
}

const everything = ['alias.md', 'near/deep/note.md', 'near/doc.md', 'real/deep/note.md', 'real/doc.md', 'top.md'];

test('by default a listing does not follow links', async t => {
  const { paths } = fixture(t);
  assert.deepEqual(await paths(), ['real/deep/note.md', 'real/doc.md', 'top.md']);
});

test('followLinks lists and finds files under a linked directory, once per path, ignoring escaping, dangling and looping links', async t => {
  const { provider, paths } = fixture(t, true);
  assert.deepEqual(await paths(), everything);
  const listed = await provider.catalog.list({ directory: 'near' }, access);
  assert.deepEqual(listed.entries.map(entry => entry.path).sort(), ['near/deep', 'near/doc.md', 'near/loop']);
  assert.equal(listed.entries.find(entry => entry.path === 'near/doc.md').size, 8);
});

test('followLinks polling reports files under a link and never one outside the root', async t => {
  const { provider, root, outside } = fixture(t, true);
  await provider.poll();
  writeFileSync(join(root, 'real', 'doc.md'), 'edited');
  writeFileSync(join(outside, 'secret.md'), 'edited outside');
  const changed = (await provider.poll()).map(change => change.path).sort();
  assert.deepEqual(changed, ['near/doc.md', 'real/doc.md']);
});

test('through a followed link: read works, a write below it lands in the real folder, the link itself and an escaping one are refused', async t => {
  const { provider, publish, root, outside } = fixture(t, true);
  assert.equal(decoder.decode((await provider.read(latest('near/doc.md'), access)).snapshot.bytes), 'real doc');
  assert.equal((await publish(create('below-link', 'near/new.md', 'inside'))).kind, 'committed');
  assert.equal(readFileSync(join(root, 'real', 'new.md'), 'utf8'), 'inside');
  const alias = await provider.read(latest('alias.md'), access);
  assert.equal((await publish(replace('onto-link', alias.snapshot.ref, 'changed'))).kind, 'denied');
  assert.equal(readFileSync(join(root, 'top.md'), 'utf8'), 'top');
  assert.equal((await provider.read(latest('away/secret.md'), access)).kind, 'denied');
  assert.equal((await provider.read(latest('escape.md'), access)).kind, 'denied');
  assert.equal((await publish(create('into-away', 'away/new.md', 'no'))).kind, 'denied');
  assert.equal((await publish(create('onto-dangling', 'dangling/x.md', 'no'))).kind, 'denied');
  assert.equal(readFileSync(join(outside, 'secret.md'), 'utf8'), 'outside secret');
});

test('a chain of links deeper than the cap ends the walk without a throw', async t => {
  const { paths, root } = fixture(t, true);
  let previous = join(root, 'real');
  for (let index = 0; index < 40; index++) {
    const folder = join(root, `hop${index}`);
    mkdirSync(folder);
    symlinkSync(previous, join(folder, 'next'));
    previous = folder;
  }
  const found = await paths();
  assert.ok(found.includes('real/doc.md'));
});
