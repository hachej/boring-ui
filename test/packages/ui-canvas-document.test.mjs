import assert from 'node:assert/strict';
import test from 'node:test';
import { createTLSchema, DocumentRecordType, PageRecordType, TLDOCUMENT_ID, createShapeId, createBindingId, toRichText, defaultBindingSchemas } from '@tldraw/tlschema';
import { applyCanvasEdits, parseCanvasDocument, canvasMediaType } from '@hachej/boring-ui-kit/canvas-document';

const schema = createTLSchema();
const page = PageRecordType.create({ id: PageRecordType.createId('one'), name: 'One', index: 'a1' });
const secondPage = PageRecordType.create({ id: PageRecordType.createId('two'), name: 'Two', index: 'a2' });
const group = (name, parentId = page.id) => schema.types.shape.create({ id: createShapeId(name), type: 'group', parentId, index: 'a1', props: {} });
const arrow = name => schema.types.shape.create({ id: createShapeId(name), type: 'arrow', parentId: page.id, index: 'a2', props: {
  kind: 'arc', elbowMidPoint: 0.5, dash: 'solid', size: 'm', fill: 'none', color: 'black', labelColor: 'black', bend: 0,
  start: { x: 0, y: 0 }, end: { x: 50, y: 50 }, arrowheadStart: 'none', arrowheadEnd: 'arrow', richText: toRichText(''), labelPosition: 0.5, font: 'sans', scale: 1,
} });
const binding = (name, from, to, terminal = 'start') => schema.types.binding.create({ id: createBindingId(name), type: 'arrow', fromId: from.id, toId: to.id,
  props: { terminal, normalizedAnchor: { x: 0.5, y: 0.5 }, isExact: false, isPrecise: false, snap: 'none' } });
const document = (...records) => ({ schema: schema.serialize(), store: Object.fromEntries([
  DocumentRecordType.create({ id: TLDOCUMENT_ID, name: 'Fictional document' }), page, ...records,
].map(record => [record.id, record])) });

test('headless canvas create/update/remove uses exact native records and leaves inputs untouched', () => {
  assert.equal(canvasMediaType, 'application/vnd.tldraw+json');
  const original = document(), initial = structuredClone(original), box = group('box');
  const created = applyCanvasEdits(original, [{ kind: 'create', record: box }], schema);
  assert.equal(created.kind, 'applied');
  assert.deepEqual(original, initial);
  box.x = 999;
  assert.equal(created.document.store[box.id].x, 0);
  const replacement = { ...created.document.store[box.id], x: 30, meta: { fictional: true } };
  const changed = applyCanvasEdits(created.document, [{ kind: 'update', record: replacement }], schema);
  assert.equal(changed.kind, 'applied');
  assert.deepEqual(changed.document.store[box.id], replacement);
  assert.equal(created.document.store[box.id].x, 0);
  const removed = applyCanvasEdits(changed.document, [{ kind: 'remove', id: box.id }], schema);
  assert.equal(removed.kind, 'applied');
  assert.deepEqual(removed.document, original);
});

test('canvas batch allows forward parent/binding references and preserves unrelated records', () => {
  const parent = group('parent'), child = group('child', parent.id), line = arrow('line'), link = binding('link', line, child);
  const result = applyCanvasEdits(document(), [link, child, line, parent].map(record => ({ kind: 'create', record })), schema);
  assert.equal(result.kind, 'applied');
  const unbound = applyCanvasEdits(result.document, [{ kind: 'remove', id: link.id }], schema);
  assert.equal(unbound.kind, 'applied');
  assert.equal(unbound.document.store[link.id], undefined);
  assert.deepEqual(unbound.document.store[line.id], line);
  assert.deepEqual(unbound.document.store[child.id], child);
});

test('canvas removal closes over nested descendants and connected arrows in either record order', () => {
  const parent = group('parent'), child = group('child', parent.id), outside = group('outside'), unrelated = group('unrelated');
  const line = arrow('line'), first = binding('start', line, child), last = binding('end', line, outside, 'end');
  for (const records of [[parent, child, outside, unrelated, line, first, last], [last, first, line, unrelated, outside, child, parent]]) {
    const source = document(...records), before = structuredClone(source);
    const result = applyCanvasEdits(source, [{ kind: 'remove', id: parent.id }], schema);
    assert.equal(result.kind, 'applied');
    for (const removed of [parent, child, line, first, last]) assert.equal(result.document.store[removed.id], undefined);
    for (const retained of [outside, unrelated]) assert.deepEqual(result.document.store[retained.id], retained);
    assert.deepEqual(source, before);
    const arrowOnly = applyCanvasEdits(source, [{ kind: 'remove', id: line.id }], schema);
    assert.equal(arrowOnly.kind, 'applied');
    assert.deepEqual(arrowOnly.document.store[child.id], child);
    assert.deepEqual(arrowOnly.document.store[outside.id], outside);
  }
});

test('canvas malformed graph and schema refuse without normalization', () => {
  const child = group('child'), line = arrow('line'), first = binding('start', line, child);
  const invalid = [
    [document({ ...child, parentId: createShapeId('missing') }), /parent/],
    [document({ ...child, parentId: child.id }), /cycle/],
    [document(group('a', createShapeId('b')), group('b', createShapeId('a'))), /cycle/],
    [document(first), /binding/],
    [document(child, line, first, binding('duplicate', line, child)), /duplicate/],
    [document(secondPage, { ...child, parentId: secondPage.id }, line, first), /cross pages/],
    [document(child, line, binding('wrong-origin', child, line)), /binding/],
    [{ ...document(), store: {} }, /document record/],
    [{ ...document(), schema: { ...schema.serialize(), sequences: {} } }, /migration/],
    [{ ...document(child), store: { ...document().store, 'shape:wrong': child } }, /identity/],
  ];
  for (const [input, pattern] of invalid) {
    const before = structuredClone(input);
    assert.throws(() => parseCanvasDocument(input, schema), pattern);
    assert.deepEqual(input, before);
  }
});

test('canvas rejected batches never partially edit their source', () => {
  const existing = group('existing'), parent = group('parent'), child = group('child', parent.id);
  const source = document(existing, parent, child), before = structuredClone(source);
  const cases = [
    [],
    [{ kind: 'create', record: existing }],
    [{ kind: 'update', record: group('absent') }],
    [{ kind: 'remove', id: createShapeId('absent') }],
    [{ kind: 'remove', id: page.id }],
    [{ kind: 'create', record: group('new') }, { kind: 'remove', id: createShapeId('new') }],
    [{ kind: 'update', record: { ...existing, x: 'invalid' } }],
    [{ kind: 'update', record: { ...existing, parentId: createShapeId('missing') } }],
    [{ kind: 'remove', id: parent.id }, { kind: 'update', record: { ...child, x: 12 } }],
    [{ kind: 'update', record: { ...existing, x: 4 }, extra: true }],
    [{ kind: 'unknown' }],
  ];
  for (const edits of cases) {
    assert.equal(applyCanvasEdits(source, edits, schema).kind, 'rejected', JSON.stringify(edits));
    assert.deepEqual(source, before);
  }
});

test('canvas edits retain the host schema rather than substituting default native validators', () => {
  const host = createTLSchema({ bindings: { ...defaultBindingSchemas, fictional: { props: {} } } });
  const source = { ...document(group('host')), schema: host.serialize() };
  assert.deepEqual(parseCanvasDocument(source, host), source);
  const result = applyCanvasEdits(source, [{ kind: 'update', record: { ...source.store['shape:host'], x: 25 } }], host);
  assert.equal(result.kind, 'applied');
  assert.deepEqual(result.document.schema, host.serialize());
  assert.throws(() => parseCanvasDocument(source, schema), /migration/);
  const unsupported = host.types.binding.create({ id: createBindingId('custom'), type: 'fictional', fromId: 'shape:host', toId: 'shape:host', props: {} });
  assert.equal(applyCanvasEdits(source, [{ kind: 'create', record: unsupported }], host).kind, 'rejected');
});

test('binding updates and explicit unbinding participate in one final canvas graph', () => {
  const a = group('a'), b = group('b'), c = group('c'), line = arrow('line');
  const start = binding('start', line, a), end = binding('end', line, b, 'end');
  const source = document(a, b, c, line, start, end), before = structuredClone(source);
  const changed = applyCanvasEdits(source, [{ kind: 'update', record: { ...start, toId: c.id } }], schema);
  assert.equal(changed.kind, 'applied');
  assert.equal(changed.document.store[start.id].toId, c.id);
  assert.equal(applyCanvasEdits(source, [{ kind: 'update', record: { ...start, props: { ...start.props, terminal: 'end' } } }], schema).kind, 'rejected');
  const remote = group('remote', secondPage.id), multiplePages = document(a, b, c, line, start, end, secondPage, remote);
  assert.equal(applyCanvasEdits(multiplePages, [{ kind: 'update', record: { ...start, toId: remote.id } }], schema).kind, 'rejected');
  const detached = applyCanvasEdits(source, [{ kind: 'remove', id: a.id }, { kind: 'remove', id: start.id }], schema);
  assert.equal(detached.kind, 'applied');
  assert.equal(detached.document.store[a.id], undefined);
  assert.equal(detached.document.store[start.id], undefined);
  assert.deepEqual(detached.document.store[line.id], line);
  assert.deepEqual(detached.document.store[end.id], end);
  assert.deepEqual(source, before);
});
