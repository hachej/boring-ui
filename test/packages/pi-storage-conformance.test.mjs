// Pi's own Storage conformance suite (`createStorageConformance`, what `registerStorageConformance` registers with Vitest), run
// against every Pi Storage this repository ships or configures. Boring ships no Storage implementation of its own: each target is
// Pi's `SqliteStorage` over a database Boring opens or provides.
//   - `openPiStorage` (shared/pi-storage.mjs): node:sqlite opened with Boring's pragmas, on the local-disk and network-file-system presets.
//   - `openBrowserSqlite` (@hachej/boring-browser/sqlite): Boring's `SqliteDatabase` over SQLite Wasm (memory fallback in Node; OPFS needs a browser).
//   - Durable Object SQLite: Pi's `openDurableObjectSqliteStorage` on a SQLite-backed Durable Object in workerd (miniflare), the
//     storage a Durable Object host such as the Factory agent service uses.
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createStorageConformance } from '@earendil-works/pi-durable/testing';
import { SqliteStorage } from '@earendil-works/pi-durable/storage/sqlite';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import { sqliteSettings } from '@hachej/boring-files/sqlite';
import { openBrowserSqlite } from '@hachej/boring-browser/sqlite';
import { build } from 'esbuild';
import { openPiStorage, PI_LOCAL_DISK } from '../../shared/pi-storage.mjs';

// Pi's assertions interface, over node:assert.
const assertions = {
  ok: (value, message) => assert.ok(value, message),
  strictEqual: (actual, expected) => assert.strictEqual(actual, expected),
  deepEqual: (actual, expected) => assert.deepStrictEqual(actual, expected),
  partialDeepEqual: (actual, expected) => assert.partialDeepStrictEqual(actual, expected),
  greaterThan: (actual, expected) => assert.ok(actual > expected, `${actual} > ${expected}`),
  rejects: (operation, messageIncludes) => assert.rejects(operation, error => String(error?.message).includes(messageIncludes)),
};

const onDisk = settings => async use => {
  const directory = await mkdtemp(join(tmpdir(), 'boring-pi-storage-'));
  const storage = await openPiStorage(join(directory, 'session.sqlite'), settings);
  try { await use(storage); } finally { await storage.close(context); await rm(directory, { recursive: true, force: true }); }
};
let browserDatabases = 0;
const browser = async use => {
  const storage = await SqliteStorage.open(await openBrowserSqlite(`/conformance-${++browserDatabases}.sqlite`));
  try { await use(storage); } finally { await storage.close(context); }
};

const storages = [
  { name: 'openPiStorage, local disk (PI_LOCAL_DISK)', withStorage: onDisk(PI_LOCAL_DISK) },
  { name: 'openPiStorage, network file system preset', withStorage: onDisk(sqliteSettings.networkFilesystem) },
  { name: 'openBrowserSqlite (SQLite Wasm, memory fallback)', withStorage: browser },
];

for (const storage of storages) {
  test(`Pi storage conformance: ${storage.name}`, { concurrency: false }, async t => {
    for (const entry of createStorageConformance({ assertions, withStorage: storage.withStorage })) await t.test(entry.name, () => entry.run());
  });
}

test('Pi storage conformance: Durable Object SQLite (workerd via miniflare)', { concurrency: false, timeout: 300_000 }, async t => {
  // miniflare exactly as the pinned wrangler resolves it; no second copy.
  const { Miniflare, convertV4MiniflareOptions } = createRequire(createRequire(import.meta.url).resolve('wrangler/package.json'))('miniflare');
  const bundle = await build({
    entryPoints: [fileURLToPath(new URL('../fixtures/pi-storage-durable-object-worker.mjs', import.meta.url))],
    bundle: true, write: false, format: 'esm', platform: 'browser', conditions: ['workerd', 'worker', 'browser'], external: ['cloudflare:*', 'node:*'], logLevel: 'silent',
  });
  const miniflare = new Miniflare(convertV4MiniflareOptions({ workers: [{
    name: 'pi-storage-conformance', modules: true, script: bundle.outputFiles[0].text, compatibilityDate: '2026-10-01', compatibilityFlags: ['nodejs_compat'],
    durableObjects: { CONFORMANCE: { className: 'Conformance', useSQLite: true } },
  }] }));
  t.after(() => miniflare.dispose());
  const names = await (await miniflare.dispatchFetch('http://conformance/cases')).json();
  assert.equal(names.length, createStorageConformance({ assertions, withStorage: async () => {} }).length, 'the worker runs the whole suite');
  for (const name of names) {
    await t.test(name, async () => {
      const result = await (await miniflare.dispatchFetch(`http://conformance/run?case=${encodeURIComponent(name)}`)).json();
      assert.ok(result.ok, result.error);
    });
  }
});
