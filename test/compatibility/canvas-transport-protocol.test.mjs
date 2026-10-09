import assert from 'node:assert/strict';
import test from 'node:test';
import { createTLSchema } from '@tldraw/tlschema';
import { schema, version, parseOpen, parseEnvelope, parseResult, parseInput, json } from '../../examples/shared/canvas-transport-protocol.mjs';

const target = () => ({ instanceId: 'viewer', epoch: 'epoch', subject: { scopeId: 'fictional', bufferVersion: 0, mountId: 'mount', pageId: 'page:one',
  base: { kind: 'absent', target: { resource: { providerId: 'fictional', path: 'board.canvas' }, view: { kind: 'published' } } } } });

test('canvas transport retains an exact detached target and refuses extra authority fields', () => {
  const value = target();
  const parsed = parseOpen({ schema, version, target: value });
  value.subject.base.target.resource.path = 'changed';
  assert.equal(parsed.target.subject.base.target.resource.path, 'board.canvas');
  assert.throws(() => parseOpen({ schema, version, target: target(), principalId: 'other' }));
  assert.throws(() => parseOpen({ schema, version, target: { ...target(), execute: 'code' } }));
  assert.throws(() => parseOpen({ schema, version: 2, target: target() }));
});

test('canvas transport refuses executable commands, malformed text and oversized selection input', () => {
  assert.throws(() => parseEnvelope({ schema, version, connectionId: 'one', requestId: 'request', command: 'accept', target: target(), input: {} }));
  assert.throws(() => parseInput('select', { expiresAt: 123, shapeIds: ['shape:\uD800'] }));
  assert.throws(() => parseInput('select', { expiresAt: 123, shapeIds: Array(101).fill('shape:one') }));
  assert.throws(() => parseInput('select', { expiresAt: 123.5, shapeIds: [] }));
  assert.throws(() => json({ text: '😀'.repeat(20) }, 40));
});

test('canvas replies cannot claim publication or proposal adoption and retain uncertainty', () => {
  const captured = target();
  assert.deepEqual(parseResult('select', { kind: 'applied' }, captured), { kind: 'applied', value: undefined });
  assert.throws(() => parseResult('select', { kind: 'applied', value: { secret: 'not-an-output' } }, captured));
  assert.throws(() => parseResult('select', { kind: 'proposed', proposalId: 'proposal', base: captured }, captured));
  assert.throws(() => parseResult('propose', { kind: 'saved', receipt: {} }, captured));
  assert.throws(() => parseResult('propose', { kind: 'applied' }, captured));
  const other = target(); other.subject.bufferVersion++;
  assert.throws(() => parseResult('propose', { kind: 'proposed', proposalId: 'proposal', base: other }, captured));
  assert.deepEqual(parseResult('propose', { kind: 'proposed', proposalId: 'proposal', base: captured }, captured), { kind: 'proposed', proposalId: 'proposal', base: captured });
  assert.deepEqual(parseResult('select', { kind: 'unknown', reason: 'Acknowledgement lost' }, captured), { kind: 'unknown', reason: 'Acknowledgement lost' });
});

test('canvas transport parses real native create and update records before delivery', () => {
  const native = createTLSchema();
  const record = native.types.shape.create({ id: 'shape:one', type: 'group', parentId: 'page:one', index: 'a1', props: {} });
  for (const kind of ['create', 'update']) {
    const input = { expiresAt: 123, summary: 'Fictional change', edits: [{ kind, record }] };
    assert.deepEqual(parseInput('propose', input), input);
    assert.throws(() => parseInput('propose', { ...input, edits: [{ kind, record: { ...record, type: 'uninstalled-shape' } }] }));
  }
});
