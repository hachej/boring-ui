import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

// The live-preview store (registry/live-preview/store.ts): pure functions over an injected storage, so the expiry, the release key and
// the storage-throw rules are proven without a DOM. The provider and the components are proven in live-preview-render.impl.mjs.
const root = fileURLToPath(new URL('../../', import.meta.url));
const out = `${root}.cache/live-preview-store-test`;
mkdirSync(out, { recursive: true });
const outfile = `${out}/store.mjs`;
await build({ entryPoints: [`${root}registry/live-preview/store.ts`], outfile, bundle: true, format: 'esm', platform: 'node', logLevel: 'silent' });
writeFileSync(`${out}/package.json`, '{"type":"module"}');
const store = await import(`${pathToFileURL(outfile).href}`);

const HOUR = 60 * 60 * 1000;
const memory = () => { const map = new Map(); return { map, getItem: k => map.has(k) ? map.get(k) : null, setItem: (k, v) => map.set(k, String(v)), removeItem: k => map.delete(k) }; };
const broken = () => { throw new Error('storage is blocked'); };
const blocked = { getItem: broken, setItem: broken, removeItem: broken };

test('the lifetime is two hours, counted from creation', () => {
  assert.equal(store.PREVIEW_TTL_MS, 2 * HOUR);
});

test('an overlay stays for two hours and is gone at the second hour from its creation', () => {
  const storage = memory();
  const t0 = 1_000_000;
  assert.equal(store.writeOverlays(storage, 'app', 'sha1', [{ key: 'app.home.card', source: 'src/Card.tsx', createdAt: t0 }]), true);
  assert.equal(store.readOverlays(storage, 'app', 'sha1', t0 + 2 * HOUR - 1).length, 1, 'still shown just before two hours');
  assert.deepEqual(store.readOverlays(storage, 'app', 'sha1', t0 + 2 * HOUR), [], 'expired at two hours');
  assert.equal(storage.map.size, 1, 'the expired entry is still in storage until the next write');
  store.writeOverlays(storage, 'app', 'sha1', store.readOverlays(storage, 'app', 'sha1', t0 + 2 * HOUR));
  assert.equal(storage.map.size, 0, 'an empty list removes the key');
});

test('a release change drops the overlays: they are keyed by app and release', () => {
  const storage = memory();
  store.writeOverlays(storage, 'app', 'sha1', [{ key: 'a', source: 'src/A.tsx', createdAt: 0 }]);
  assert.deepEqual(store.readOverlays(storage, 'app', 'sha2', 1), [], 'a new release reads its own (empty) key');
  assert.equal(store.readOverlays(storage, 'app', 'sha1', 1).length, 1, 'the old release is untouched, not served');
});

test('overlays of another app never mix in', () => {
  const storage = memory();
  store.writeOverlays(storage, 'app-a', 'sha1', [{ key: 'a', source: 'src/A.tsx', createdAt: 0 }]);
  assert.deepEqual(store.readOverlays(storage, 'app-b', 'sha1', 1), []);
});

test('a storage that throws is safe: reads are empty, writes report false, nothing throws', () => {
  assert.deepEqual(store.readOverlays(blocked, 'app', 'sha1', 1), []);
  assert.equal(store.writeOverlays(blocked, 'app', 'sha1', [{ key: 'a', source: 's', createdAt: 1 }]), false);
  assert.deepEqual(store.readOverlays(undefined, 'app', 'sha1', 1), [], 'no storage at all (no window) is also safe');
});

test('corrupt stored data is ignored, not thrown', () => {
  const storage = memory();
  storage.setItem(store.storageKey('app', 'sha1'), '{not json');
  assert.deepEqual(store.readOverlays(storage, 'app', 'sha1', 1), []);
  storage.setItem(store.storageKey('app', 'sha1'), '{"a":1}');
  assert.deepEqual(store.readOverlays(storage, 'app', 'sha1', 1), []);
});

test('the storage key names the app, the release and boring.preview', () => {
  assert.equal(store.storageKey('app', 'sha1'), 'boring.preview:app:sha1');
});

test('an entry keeps the tool call id it came from', () => {
  const storage = memory();
  store.writeOverlays(storage, 'app', 'sha1', [{ key: 'a', source: 's', createdAt: 0, previewId: 'call-7' }]);
  assert.equal(store.readOverlays(storage, 'app', 'sha1', 1)[0].previewId, 'call-7');
});

test('the next expiry is the earliest overlay end, or undefined with none', () => {
  assert.equal(store.nextExpiry([], 0), undefined);
  assert.equal(store.nextExpiry([{ key: 'a', source: 's', createdAt: 100 }, { key: 'b', source: 's', createdAt: 50 }], 0), 50 + 2 * HOUR);
});
