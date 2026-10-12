// Search is one cached path index per provider: ranked basename-first, rebuilt only when the change feed reports something new.
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
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function fixture(t, catalog) {
  const directory = mkdtempSync(join(tmpdir(), 'boring-search-index-'));
  const db = openNodeConnection(join(directory, 'files.sqlite'));
  const fs = openSqliteFileSystem({ connection: db, workspace: 'fictional', cwd: '/workspace' });
  const stats = { listings: 0, active: 0, peak: 0 };
  const counted = { ...fs, listDir: async (...args) => {
    stats.listings++; stats.active++; stats.peak = Math.max(stats.peak, stats.active);
    try { return await fs.listDir(...args); } finally { stats.active--; }
  } };
  const provider = createWorkspaceProvider({ fs: counted, journal: createWorkspaceJournal(db), identity: { providerId: 'files', instanceId: 'fictional', incarnation: fs.incarnation, viewId: 'published' }, watchLingerMs: 10, ...(catalog ? { catalog } : {}) });
  const write = async (path, text) => assert.equal((await fs.writeFile(`/workspace/${path}`, text, BACKGROUND_CONTEXT)).ok, true);
  const remove = async path => assert.equal((await fs.remove(`/workspace/${path}`, undefined, BACKGROUND_CONTEXT)).ok, true);
  const dir = async path => assert.equal((await fs.createDir(`/workspace/${path}`, { recursive: true }, BACKGROUND_CONTEXT)).ok, true);
  const names = async (query, options = {}) => (await provider.catalog.search({ query, ...options }, access)).entries.map(entry => entry.path);
  t.after(() => { provider.close(); db.close(); rmSync(directory, { force: true, recursive: true }); });
  return { provider, write, remove, dir, names, stats };
}

/** Read the feed in the background until a write of the probe is reported: from then on the watcher is armed. */
async function listen(t, provider, write) {
  const events = [], abort = new AbortController();
  t.after(() => abort.abort());
  void (async () => { for await (const event of provider.changes({ signal: abort.signal }, access)) events.push(event); })().catch(error => { events.error = error; });
  const reported = path => events.some(event => event.kind === 'change' && event.path === path);
  for (let n = 0; n < 50; n++) {
    await write(`probe-${n}.md`, 'probe');
    for (let waited = 0; waited < 300; waited += 20) {
      if (reported(`probe-${n}.md`)) return events;
      await sleep(20);
    }
  }
  throw new Error(`the change feed never reported a write: ${events.error?.message ?? 'no event'}`);
}

async function until(events, path) {
  for (let waited = 0; !events.some(event => event.kind === 'change' && event.path === path); waited += 10) {
    if (waited > 3000) throw new Error(`no change event for ${path}`);
    await sleep(10);
  }
}

test('search ranks a basename that starts with the query first, then one containing it, then a match in the directories only', async t => {
  const { write, names } = fixture(t);
  for (const path of ['docs/guide/intro.md', 'guide.md', 'zz/readme-guide.md', 'guide/a.md']) await write(path, 'x');
  assert.deepEqual(await names('guide'), ['guide.md', 'zz/readme-guide.md', 'docs/guide/intro.md', 'guide/a.md']);
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

test('without a live change feed nothing is cached: a write that no event reports is found at once', async t => {
  const { write, names, stats } = fixture(t);
  assert.deepEqual(await names('late'), []);
  const before = stats.listings;
  await write('late.md', 'x');
  assert.deepEqual(await names('late'), ['late.md']);
  assert.ok(stats.listings > before, 'each search walks the tree again');
});

test('with a live change feed the index is reused until the feed reports a change', async t => {
  const { provider, write, names, stats } = fixture(t);
  const events = await listen(t, provider, write);
  await write('one.md', 'x');
  await until(events, 'one.md');
  assert.deepEqual(await names('one'), ['one.md']);
  const built = stats.listings;
  assert.deepEqual(await names('one'), ['one.md']);
  assert.equal(stats.listings, built, 'the second search reuses the index');
  await write('two.md', 'x');
  await until(events, 'two.md');
  assert.deepEqual(await names('two'), ['two.md'], 'the change event rebuilds the index');
});

test('a file under node_modules that is deleted is not returned by the next search (the catalog with defaults:false lists it)', async t => {
  const { provider, write, remove, names } = fixture(t, { defaults: false });
  await listen(t, provider, write);
  await write('node_modules/example.js', 'x');
  assert.deepEqual(await names('example'), ['node_modules/example.js']);
  await remove('node_modules/example.js');
  assert.deepEqual(await names('example'), [], 'the watcher does not cover node_modules, so the deletion must not be served from the index');
});

test('a change to .git/info/exclude changes what the next search returns', async t => {
  const { provider, write, dir, names } = fixture(t);
  const events = await listen(t, provider, write);
  await dir('.git/info');
  await write('.git/info/exclude', '# no rules yet\n');
  await write('ignored-by-rule.md', 'x');
  await until(events, 'ignored-by-rule.md');
  assert.deepEqual(await names('ignored-by-rule'), ['ignored-by-rule.md']);
  await write('.git/info/exclude', 'ignored-by-rule.md\n');
  assert.deepEqual(await names('ignored-by-rule'), [], 'the exclude rule applies to the next search');
});

test('a file deleted through the file system is not returned by the next search, before its change event is processed', async t => {
  const { provider, write, remove, names } = fixture(t);
  const events = await listen(t, provider, write);
  await write('gone.md', 'x');
  await until(events, 'gone.md');
  assert.deepEqual(await names('gone'), ['gone.md']);
  await remove('gone.md');
  assert.deepEqual(await names('gone'), []);
  await until(events, 'gone.md');
  assert.deepEqual(await names('gone'), []);
});

test('searches that overlap a change share one traversal at a time, and the last one sees every write', async t => {
  const { provider, write, dir, names, stats } = fixture(t);
  const events = await listen(t, provider, write);
  for (let n = 0; n < 30; n++) { await dir(`deep/d${n}`); await write(`deep/d${n}/f.md`, 'x'); }
  await until(events, 'deep/d29/f.md');
  assert.deepEqual((await names('f')).length, 30);
  stats.peak = 0;
  const searches = [];
  for (let n = 0; n < 4; n++) {
    searches.push(names('burst'));
    await write(`burst-${n}.md`, 'x');
  }
  await Promise.all(searches);
  assert.equal(stats.peak, 1, 'no two traversals run at once');
  assert.deepEqual((await names('burst')).sort(), ['burst-0.md', 'burst-1.md', 'burst-2.md', 'burst-3.md']);
});
