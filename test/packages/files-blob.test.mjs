import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BLOB_POINTER_MAX_BYTES, BLOB_POINTER_MEDIA_TYPE, BLOB_POINTER_SUFFIX, DEFAULT_BLOB_BASE, blobItemOf, checkBlobBase, isBlobPointerPath,
  parseBlobPointer, resolveBlobPointer, withBlobPointers,
} from '@hachej/boring-files/blob';
import { openSqliteWorkspaces } from '../../shared/sqlite-workspaces.mjs';
import { pointer, pointerBytes } from '../fixtures/blob-bytes.mjs';

test('blob pointer constants: media type, suffix, default base', () => {
  assert.equal(BLOB_POINTER_MEDIA_TYPE, 'application/vnd.boring.blob+json');
  assert.equal(BLOB_POINTER_SUFFIX, '.blob.json');
  assert.equal(DEFAULT_BLOB_BASE, '/_files/');
  assert.equal(isBlobPointerPath('photos/cat.heic.blob.json'), true);
  assert.equal(isBlobPointerPath('photos/CAT.BLOB.JSON'), true);
  assert.equal(isBlobPointerPath('photos/.blob.json'), false, 'a bare suffix names nothing');
  assert.equal(isBlobPointerPath('photos.blob.json/readme.md'), false);
});

test('a valid pointer parses from bytes or text to exactly its fields', () => {
  assert.deepEqual(parseBlobPointer(pointerBytes()), pointer());
  assert.deepEqual(parseBlobPointer(JSON.stringify(pointer({ extra: 'ignored' }))), pointer(), 'unknown fields are dropped, not returned');
  assert.deepEqual(parseBlobPointer(JSON.stringify(pointer({ size: 0 }))), pointer({ size: 0 }));
});

test('invalid pointers are undefined: fields, types, hex, size, name, size of the input, encoding', () => {
  const invalid = [
    pointer({ id: '' }), pointer({ id: 7 }), pointer({ id: 'a\nb' }),
    pointer({ sha256: 'a'.repeat(63) }), pointer({ sha256: 'A'.repeat(64) }), pointer({ sha256: 'g'.repeat(64) }),
    pointer({ size: -1 }), pointer({ size: 1.5 }), pointer({ size: 2 ** 53 }), pointer({ size: '12' }),
    pointer({ type: 'image' }), pointer({ type: 'image/heic; charset=x' }), pointer({ type: '' }),
    pointer({ name: 'photos/cat.heic' }), pointer({ name: 'photos\\cat.heic' }), pointer({ name: '..' }), pointer({ name: '' }), pointer({ name: 'a\u0000b' }),
    pointer({ 'boring:blob': 0 }), pointer({ 'boring:blob': '1' }), pointer({ 'boring:blob': 1.5 }),
  ];
  for (const value of invalid) assert.equal(parseBlobPointer(JSON.stringify(value)), undefined, JSON.stringify(value));
  const { name, ...missing } = pointer(); void name;
  assert.equal(parseBlobPointer(JSON.stringify(missing)), undefined, 'a missing field');
  for (const input of ['', 'null', '[]', '"text"', '{', 'not json']) assert.equal(parseBlobPointer(input), undefined, input);
  assert.equal(parseBlobPointer(Uint8Array.from([0xff, 0xfe, 0x7b, 0x7d])), undefined, 'not UTF-8');
  const padded = JSON.stringify({ ...pointer(), padding: 'x'.repeat(BLOB_POINTER_MAX_BYTES) });
  assert.equal(parseBlobPointer(padded), undefined, 'a large input is never a pointer');
  assert.equal(parseBlobPointer(new TextEncoder().encode(padded)), undefined);
});

test('a higher version is a distinct unsupported result, whatever its other fields', () => {
  assert.deepEqual(parseBlobPointer(JSON.stringify({ 'boring:blob': 2, id: 'future', anything: true })), { kind: 'unsupported-version', version: 2 });
  assert.deepEqual(resolveBlobPointer(JSON.stringify({ 'boring:blob': 3 })), { kind: 'unsupported-version', version: 3 });
});

test('the blob URL is the checked base plus the encoded id; any other base is refused', () => {
  assert.deepEqual(blobItemOf(pointer()), { name: 'cat.heic', size: 3_456_789, type: 'image/heic', url: '/_files/blob%2Ffictional-cat%2001' });
  assert.deepEqual(resolveBlobPointer(pointerBytes(), '/api/blobs/'), { kind: 'blob', item: { name: 'cat.heic', size: 3_456_789, type: 'image/heic', url: '/api/blobs/blob%2Ffictional-cat%2001' } });
  for (const base of ['/_files/', '/a/b?id=']) assert.equal(checkBlobBase(base), base);
  for (const base of ['https://cdn.fictional.invalid/', 'http:/x/', '//cdn.fictional.invalid/', '/\\cdn.fictional.invalid/', '_files/', '', 'javascript:alert(1)//', '/a b/', '/a\n/']) {
    assert.throws(() => checkBlobBase(base), TypeError, JSON.stringify(base));
    assert.throws(() => resolveBlobPointer(pointerBytes(), base), TypeError, JSON.stringify(base));
  }
});

test('withBlobPointers: a listing shows each pointer under its item, read once through the same provider', async t => {
  const store = openSqliteWorkspaces({ filename: ':memory:', providerId: 'fictional', authorize: () => true }); t.after(() => store.close());
  const identity = { scopeId: 'fictional', principalId: 'alice', initiatorId: 'alice' };
  const locate = path => ({ resource: { providerId: 'fictional', path }, view: { kind: 'published' } });
  const files = { 'uploads/cat.heic.blob.json': pointerBytes(), 'uploads/future.blob.json': new TextEncoder().encode('{"boring:blob":2}'),
    'uploads/broken.blob.json': new TextEncoder().encode('{"boring:blob":1}'), 'uploads/notes.md': new TextEncoder().encode('# Notes') };
  for (const [path, bytes] of Object.entries(files)) {
    await store.publication.publish({ operationId: path, atomicity: 'all-or-nothing', changes: [{ kind: 'create', target: locate(path), expected: { kind: 'absent' }, bytes, mediaType: 'application/json' }] }, identity);
  }
  const reads = [];
  const entries = Object.entries(files).map(([path, bytes]) => ({ path, kind: 'file', size: bytes.length }));
  const provider = { identity, locate, read: (request, signal) => { reads.push(request.target.resource.path); return store.read(request, identity); },
    list: async () => ({ entries }), search: async () => ({ entries: entries.slice(0, 1) }), history: async () => [], publish: async () => { throw new Error('unused'); }, lookup: async () => { throw new Error('unused'); } };
  const listed = await withBlobPointers(provider).list({});
  assert.deepEqual(listed.entries.map(entry => entry.blob), [
    { name: 'cat.heic', size: 3_456_789, type: 'image/heic', url: '/_files/blob%2Ffictional-cat%2001' },
    { kind: 'unsupported-version', version: 2 },
    undefined,
    undefined,
  ]);
  assert.deepEqual(reads.sort(), ['uploads/broken.blob.json', 'uploads/cat.heic.blob.json', 'uploads/future.blob.json'], 'only pointer files are read');
  assert.equal((await withBlobPointers(provider, '/blobs/').search({ query: 'cat' })).entries[0].blob.url, '/blobs/blob%2Ffictional-cat%2001');
  assert.throws(() => withBlobPointers(provider, 'https://cdn.fictional.invalid/'), TypeError);
  const read = await withBlobPointers(provider).read({ target: locate('uploads/cat.heic.blob.json'), revision: { kind: 'latest' } });
  assert.deepEqual(read.snapshot.bytes, pointerBytes(), 'a read still returns the pointer bytes');
});
