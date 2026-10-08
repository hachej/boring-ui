import assert from 'node:assert/strict';
import test from 'node:test';
import { createArtifactDescriptor, parseArtifact } from '@hachej/boring-agent/artifacts';

test('parseArtifact accepts a built descriptor and rejects malformed ones', () => {
  const good = createArtifactDescriptor({ id: 'abc123', title: 'Fictional', type: 'code', mediaType: 'text/plain', language: 'python',
    target: { resource: { providerId: 'documents', path: 'artifacts/abc123.py' }, view: { kind: 'published' } }, revision: 'r1', ordinal: 2 });
  assert.equal(good.schema, 'boring.artifact');
  assert.deepEqual(parseArtifact(JSON.parse(JSON.stringify(good))), good);
  assert.notEqual(parseArtifact(good), good, 'a fresh copy');
  const bad = [undefined, null, 'x', [], {}, { ...good, schema: 'other' }, { ...good, version: 2 }, { ...good, id: '' }, { ...good, id: '../x' }, { ...good, title: ' ' }, { ...good, type: 'pdf' },
    { ...good, mediaType: 'nope' }, { ...good, language: 7 }, { ...good, revision: '' }, { ...good, ordinal: 0 }, { ...good, ordinal: 1.5 }, { ...good, ordinal: '1' }, { ...good, extra: true },
    { ...good, target: { resource: { providerId: 'documents' }, view: { kind: 'published' } } }, { ...good, target: { resource: good.target.resource, view: { kind: 'working' } } },
    { ...good, target: { resource: good.target.resource, view: { kind: 'published', extra: 1 } } }, { ...good, target: { ...good.target, extra: 1 } }];
  for (const value of bad) assert.equal(parseArtifact(value), undefined, JSON.stringify(value));
  assert.throws(() => createArtifactDescriptor({ ...good, ordinal: 0 }), /Invalid artifact descriptor/);
  assert.ok(parseArtifact({ ...good, target: { resource: good.target.resource, view: { kind: 'working', viewId: 'v' } } }));
});
