import assert from 'node:assert/strict';
import test from 'node:test';
import { validateExperience } from '@hachej/boring-ui-kit/experience/compose';

const cell = { ref: 'fictional/notes', kind: 'fictional/document', version: 2 };
const access = (overrides = {}) => ({ cells: [cell], canView: () => true, ...overrides });
const descriptor = (overrides = {}) => ({
  format: 'boring.experience', version: 1, name: 'fictional-page', source: 'fixed',
  kinds: { 'boring/stack': 1, 'boring/cell': 1, 'fictional/document': 2 },
  root: 'page', elements: {
    page: { type: 'boring/stack', props: {}, children: ['notes'] },
    notes: { type: 'boring/cell', props: { ref: cell.ref }, children: [] },
  }, ...overrides,
});

test('fixed and derived descriptors validate with native layout props and detached defaults', () => {
  for (const source of ['fixed', 'derived', 'generated']) {
    const input = descriptor({ source });
    const output = validateExperience(input, access());
    assert.equal(output.source, source);
    assert.equal(output.elements.page.props.gap, 'medium');
    assert.deepEqual(output.elements.notes.children, []);
    assert.notEqual(output, input);
    assert.notEqual(output.elements, input.elements);
    assert.notEqual(output.elements.page, input.elements.page);
    input.elements.notes.props.ref = 'other/private';
    input.elements.page.children.pop();
    assert.equal(output.elements.notes.props.ref, cell.ref);
    assert.deepEqual(output.elements.page.children, ['notes']);
    assert.ok(Object.isFrozen(output));
    assert.ok(Object.isFrozen(output.kinds));
    assert.ok(Object.isFrozen(output.elements));
    assert.ok(Object.isFrozen(output.elements.page));
    assert.ok(Object.isFrozen(output.elements.page.props));
    assert.ok(Object.isFrozen(output.elements.page.children));
    assert.throws(() => { output.elements.notes.props.ref = 'other/private'; }, TypeError);
  }
});

test('installed kinds, versions and exact props bound every rendered element', () => {
  const row = descriptor({
    kinds: { 'boring/row': 1, 'boring/cell': 1, 'fictional/document': 2 },
    elements: { page: { type: 'boring/row', props: { gap: 'large' }, children: ['notes'] }, notes: { type: 'boring/cell', props: { ref: cell.ref } } },
  });
  assert.equal(validateExperience(row, access()).elements.page.props.gap, 'large');
  const grid = descriptor({
    kinds: { 'boring/grid': 1, 'boring/cell': 1, 'fictional/document': 2 },
    elements: { page: { type: 'boring/grid', props: { columns: 4 }, children: ['notes'] }, notes: { type: 'boring/cell', props: { ref: cell.ref } } },
  });
  assert.equal(validateExperience(grid, access()).elements.page.props.columns, 4);
  for (const bad of [
    { ...grid, elements: { ...grid.elements, page: { ...grid.elements.page, props: { columns: 5 } } } },
    { ...grid, elements: { ...grid.elements, page: { ...grid.elements.page, props: { columns: 1.5 } } } },
    { ...grid, elements: { ...grid.elements, page: { ...grid.elements.page, props: { columns: 2, secret: 'fictional record' } } } },
    descriptor({ kinds: { 'boring/stack': 2, 'boring/cell': 1, 'fictional/document': 2 } }),
    descriptor({ kinds: { 'boring/stack': 1, 'boring/cell': 1, 'fictional/document': 3 } }),
    descriptor({ elements: { page: { type: 'boring/unknown', props: {}, children: ['notes'] }, notes: { type: 'boring/cell', props: { ref: cell.ref } } } }),
  ]) assert.throws(() => validateExperience(bad, access()));
});

test('viewer visibility is required as literal true and registration cannot collide or cross namespace', () => {
  for (const answer of [false, undefined, 1, 'true', Promise.resolve(true)]) {
    assert.throws(() => validateExperience(descriptor(), access({ canView: () => answer })));
  }
  assert.throws(() => validateExperience(descriptor(), access({ cells: [] })));
  assert.throws(() => validateExperience(descriptor(), access({ cells: [cell, { ...cell }] })));
  assert.throws(() => validateExperience(descriptor(), access({ cells: [cell, { ref: 'fictional/other', kind: cell.kind, version: 3 }] })));
  assert.throws(() => validateExperience(descriptor(), access({ cells: [{ ...cell, kind: 'boring/stack' }] })));
  assert.throws(() => validateExperience(descriptor(), access({ cells: [{ ...cell, ref: 'fictional/other/notes' }] })));
  assert.throws(() => validateExperience(descriptor({ elements: { page: { type: 'boring/stack', props: {}, children: ['notes'] }, notes: { type: 'boring/cell', props: { ref: 'other/notes' } } } }), access()));
});

test('descriptor input cannot carry data, actions, state expressions or future fields', () => {
  const base = descriptor();
  for (const field of ['on', 'watch', 'repeat', 'visible', 'state', 'slots']) {
    const changed = structuredClone(base);
    changed.elements.notes[field] = field === 'on' ? { click: { action: 'submit' } } : { $state: '/apps/fictional/private' };
    assert.throws(() => validateExperience(changed, access()), field);
  }
  for (const field of ['state', 'initialState', 'generated', 'metadata']) {
    assert.throws(() => validateExperience({ ...base, [field]: { private: 'fictional data' } }, access()), field);
  }
  for (const props of [
    { ref: cell.ref, value: 'fictional record content' },
    { ref: { $state: '/apps/fictional/private' } },
    { ref: 'fictional/notes', onClick: 'submit' },
  ]) {
    const changed = structuredClone(base);
    changed.elements.notes.props = props;
    assert.throws(() => validateExperience(changed, access()));
  }
  assert.throws(() => validateExperience({ ...base, source: 'unknown' }, access()));
  assert.throws(() => validateExperience({ ...base, version: 2 }, access()));
  assert.throws(() => validateExperience({ ...base, format: 'other' }, access()));
});

test('validation traverses a connected, bounded tree and enforces cell use limits', () => {
  const duplicate = descriptor({ elements: {
    page: { type: 'boring/stack', props: {}, children: ['notes', 'again'] },
    notes: { type: 'boring/cell', props: { ref: cell.ref } },
    again: { type: 'boring/cell', props: { ref: cell.ref } },
  } });
  assert.throws(() => validateExperience(duplicate, access()));
  assert.equal(validateExperience(duplicate, access({ cells: [{ ...cell, maxUses: 2 }] })).elements.again.props.ref, cell.ref);
  assert.throws(() => validateExperience(duplicate, access({ cells: [{ ...cell, maxUses: 0 }] })));
  assert.throws(() => validateExperience(descriptor({ root: 'missing' }), access()));
  assert.throws(() => validateExperience(descriptor({ elements: { ...descriptor().elements, detached: { type: 'boring/stack', props: {} } } }), access()));
  assert.throws(() => validateExperience(descriptor({ elements: { page: { type: 'boring/stack', props: {}, children: ['page'] }, notes: descriptor().elements.notes } }), access()));
  assert.throws(() => validateExperience(descriptor({ elements: { page: { type: 'boring/stack', props: {}, children: ['notes', 'notes'] }, notes: descriptor().elements.notes } }), access()));
  assert.throws(() => validateExperience(descriptor({ elements: { page: { type: 'boring/cell', props: { ref: cell.ref }, children: ['notes'] }, notes: descriptor().elements.notes } }), access()));
  const deep = descriptor();
  deep.elements = { notes: deep.elements.notes };
  for (let n = 25; n >= 0; n--) deep.elements[`level_${n}`] = { type: 'boring/stack', props: {}, children: [n === 25 ? 'notes' : `level_${n + 1}`] };
  deep.root = 'level_0';
  assert.throws(() => validateExperience(deep, access()));
  const many = descriptor();
  many.elements.page.children = Array.from({ length: 200 }, (_, n) => `item_${n}`);
  for (let n = 0; n < 200; n++) many.elements[`item_${n}`] = { type: 'boring/stack', props: {} };
  delete many.elements.notes;
  assert.throws(() => validateExperience(many, access()));
});

test('inherited Object.prototype names cannot become descriptor or element identities', () => {
  for (const inherited of ['constructor', 'toString', '__proto__']) {
    assert.throws(() => validateExperience(descriptor({ name: inherited }), access()));
    const changed = descriptor();
    changed.root = inherited;
    changed.elements = Object.fromEntries([
      [inherited, { type: 'boring/stack', props: {}, children: ['notes'] }],
      ['notes', changed.elements.notes],
    ]);
    assert.throws(() => validateExperience(changed, access()));
    const child = descriptor();
    child.elements.page.children = [inherited];
    child.elements = Object.fromEntries([
      ['page', child.elements.page],
      [inherited, { type: 'boring/cell', props: { ref: cell.ref } }],
    ]);
    assert.throws(() => validateExperience(child, access()));
  }
});

test('validation is read-only: visibility is queried, cell renderers and operations are not invoked', () => {
  let checks = 0, renders = 0;
  const registered = { ...cell, render: () => { renders++; throw new Error('rendered during validation'); } };
  const result = validateExperience(descriptor(), access({ cells: [registered], canView: ref => { checks++; assert.equal(ref, cell.ref); return true; } }));
  assert.equal(result.elements.notes.props.ref, cell.ref);
  assert.equal(checks, 1);
  assert.equal(renders, 0);
});
