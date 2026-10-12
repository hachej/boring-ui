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
  // `gate` holds every listing while set; `fail` makes the next listing throw.
  const stats = { active: 0, peak: 0, gate: undefined, fail: false };
  const counted = { ...fs, listDir: async (...args) => {
    stats.active++; stats.peak = Math.max(stats.peak, stats.active);
    try {
      if (stats.gate) await stats.gate;
      if (stats.fail) { stats.fail = false; throw new Error('fictional listing failure'); }
      return await fs.listDir(...args);
    } finally { stats.active--; }
  } };
  const provider = createWorkspaceProvider({ fs: counted, journal: createWorkspaceJournal(db), identity: { providerId: 'files', instanceId: 'fictional', incarnation: fs.incarnation, viewId: 'published' }, watchLingerMs: 10 });
  const write = async (path, text) => assert.equal((await fs.writeFile(`/workspace/${path}`, text, BACKGROUND_CONTEXT)).ok, true);
  const remove = async path => assert.equal((await fs.remove(`/workspace/${path}`, undefined, BACKGROUND_CONTEXT)).ok, true);
  const names = async (query, options = {}) => (await provider.catalog.search({ query, ...options }, access)).entries.map(entry => entry.path);
  const namesAs = async (query, controller) => (await provider.catalog.search({ query }, { ...access, signal: controller.signal })).entries.map(entry => entry.path);
  t.after(() => { stats.gate = undefined; provider.close(); db.close(); rmSync(directory, { force: true, recursive: true }); });
  return { provider, write, remove, names, namesAs, stats };
}

/** Holds every listing until the returned `release` is called. */
function hold(stats) {
  const { promise, resolve } = Promise.withResolvers();
  stats.gate = promise;
  return () => { stats.gate = undefined; resolve(); };
}

async function until(condition) {
  for (let n = 0; n < 500 && !condition(); n++) await new Promise(resolve => setTimeout(resolve, 2));
  assert.ok(condition(), 'the condition never held');
}

test('search ranks a basename that starts with the query first, then one containing it, then a match in the directories only', async t => {
  const { write, names } = fixture(t);
  for (const path of ['docs/guide/intro.md', 'guide.md', 'zz/readme-guide.md', 'guide/a.md']) await write(path, 'x');
  assert.deepEqual(await names('guide'), ['guide.md', 'zz/readme-guide.md', 'docs/guide/intro.md', 'guide/a.md']);
});

test('equally ranked matches are ordered by path even when the traversal finds them in another order', async t => {
  const { write, names } = fixture(t);
  // Written in reverse path order: the traversal visits them as written, so only the path tie-break yields the order below.
  for (const path of ['guide/guide.md', 'guide.md', 'z/guide.md', 'a/guide.md']) await write(path, 'x');
  assert.deepEqual(await names('guide'), ['a/guide.md', 'guide.md', 'guide/guide.md', 'z/guide.md']);
});

test('pages across an equally ranked group in path order, one item at a time', async t => {
  const { provider, write } = fixture(t);
  for (const path of ['z/guide.md', 'guide/guide.md', 'a/guide.md', 'guide.md']) await write(path, 'x');
  const seen = [];
  let cursor;
  do {
    const page = await provider.catalog.search({ query: 'guide', limit: 1, ...(cursor ? { cursor } : {}) }, access);
    seen.push(...page.entries.map(entry => entry.path));
    cursor = page.cursor;
  } while (cursor);
  assert.deepEqual(seen, ['a/guide.md', 'guide.md', 'guide/guide.md', 'z/guide.md']);
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

test('a traversal that throws does not block the next search', async t => {
  const { write, names, stats } = fixture(t);
  await write('one.md', 'x');
  stats.fail = true;
  await assert.rejects(names('one'), /fictional listing failure/);
  assert.deepEqual(await names('one'), ['one.md']);
});

test('an active search that is aborted does not block the next search', async t => {
  const { write, names, namesAs, stats } = fixture(t);
  await write('one.md', 'x');
  const release = hold(stats);
  const controller = new AbortController();
  const active = namesAs('one', controller);
  await until(() => stats.active > 0);
  controller.abort();
  release();
  await assert.rejects(active);
  assert.deepEqual(await names('one'), ['one.md']);
});

test('a waiter cancelled between two successful searches does not block the search after it', async t => {
  const { write, names, namesAs, stats } = fixture(t);
  await write('one.md', 'x');
  assert.deepEqual(await names('one'), ['one.md']);
  const release = hold(stats);
  const running = names('one');
  await until(() => stats.active > 0);
  const controller = new AbortController();
  const waiter = namesAs('one', controller);
  controller.abort();
  release();
  assert.deepEqual(await running, ['one.md']);
  await assert.rejects(waiter);
  assert.deepEqual(await names('one'), ['one.md']);
});
