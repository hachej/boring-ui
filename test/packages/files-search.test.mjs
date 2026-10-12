// Filename search: basename-first ranking, one fresh traversal per search, and one traversal at a time.
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context';
import { openNodeConnection } from '@hachej/boring-files/sqlite';
import { openSqliteFileSystem } from '@hachej/boring-files/sqlite-filesystem';
import { createWorkspaceJournal } from '@hachej/boring-files/journal';
import { createWorkspaceProvider } from '@hachej/boring-files/workspace';

const access = { principalId: 'fictional-person', scopeId: 'fictional-scope', initiatorId: 'fictional-person' };

function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'boring-search-'));
  const db = openNodeConnection(join(directory, 'files.sqlite'));
  const fs = openSqliteFileSystem({ connection: db, workspace: 'fictional', cwd: '/workspace' });
  const stats = { active: 0, peak: 0 };
  const counted = { ...fs, listDir: async (...args) => {
    stats.active++; stats.peak = Math.max(stats.peak, stats.active);
    try { return await fs.listDir(...args); } finally { stats.active--; }
  } };
  const provider = createWorkspaceProvider({ fs: counted, journal: createWorkspaceJournal(db), identity: { providerId: 'files', instanceId: 'fictional', incarnation: fs.incarnation, viewId: 'published' }, watchLingerMs: 10 });
  const write = async (path, text) => assert.equal((await fs.writeFile(`/workspace/${path}`, text, BACKGROUND_CONTEXT)).ok, true);
  const remove = async path => assert.equal((await fs.remove(`/workspace/${path}`, undefined, BACKGROUND_CONTEXT)).ok, true);
  const names = async (query, options = {}) => (await provider.catalog.search({ query, ...options }, access)).entries.map(entry => entry.path);
  t.after(() => { provider.close(); db.close(); rmSync(directory, { force: true, recursive: true }); });
  return { provider, write, remove, names, stats };
}

test('search ranks a basename that starts with the query first, then one containing it, then a match in the directories only', async t => {
  const { write, names } = fixture(t);
  for (const path of ['docs/guide/intro.md', 'guide.md', 'zz/readme-guide.md', 'guide/a.md']) await write(path, 'x');
  assert.deepEqual(await names('guide'), ['guide.md', 'zz/readme-guide.md', 'docs/guide/intro.md', 'guide/a.md']);
});

test('equally ranked matches are ordered by path, so the order is deterministic', async t => {
  const { write, names } = fixture(t);
  for (const path of ['b/guide-b.md', 'a/guide-a.md', 'c/guide-c.md']) await write(path, 'x');
  assert.deepEqual(await names('guide'), ['a/guide-a.md', 'b/guide-b.md', 'c/guide-c.md']);
});

test('search pages through the ranked order with a cursor', async t => {
  const { provider, write } = fixture(t);
  for (const path of ['docs/guide/intro.md', 'guide.md', 'zz/readme-guide.md', 'guide/a.md']) await write(path, 'x');
  const first = await provider.catalog.search({ query: 'guide', limit: 2 }, access);
  assert.deepEqual(first.entries.map(entry => entry.path), ['guide.md', 'zz/readme-guide.md']);
  assert.ok(first.cursor);
  const second = await provider.catalog.search({ query: 'guide', limit: 2, cursor: first.cursor }, access);
  assert.deepEqual(second.entries.map(entry => entry.path), ['docs/guide/intro.md', 'guide/a.md']);
  assert.equal(second.cursor, undefined);
});

test('a write is found by the next search at once, and a deleted file is not returned by the next search', async t => {
  const { write, remove, names } = fixture(t);
  assert.deepEqual(await names('late'), []);
  await write('late.md', 'x');
  assert.deepEqual(await names('late'), ['late.md']);
  await remove('late.md');
  assert.deepEqual(await names('late'), []);
});

test('overlapping searches run one traversal at a time, and each sees the writes made before its call', async t => {
  const { write, names, stats } = fixture(t);
  await write('first.md', 'x');
  const early = names('md');
  await write('second.md', 'x');
  await early;
  const late = names('md');
  const burst = [names('md'), names('md'), names('md')];
  assert.deepEqual((await late).sort(), ['first.md', 'second.md']);
  for (const result of await Promise.all(burst)) assert.deepEqual(result.sort(), ['first.md', 'second.md']);
  assert.equal(stats.peak, 1, 'no two traversals list directories at once');
});
