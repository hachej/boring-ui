import assert from 'node:assert/strict';
import test from 'node:test';
import { Window } from 'happy-dom';
import { openSqliteWorkspaces } from '../../examples/shared/sqlite-workspaces.mjs';

test('fixed and derived experiences with real React/json-render/SQLite in HappyDOM; no browser or full experience qualification', { timeout: 30000 }, async t => {
  const window = new Window({ url: 'https://fictional.invalid/' }), globals = new Map();
  for (const name of ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node', 'Text', 'DOMParser', 'MutationObserver', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame']) {
    globals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    const value = name === 'window' ? window : window[name];
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value: typeof value === 'function' && /^[a-z]/.test(name) ? value.bind(window) : value });
  }
  globals.set('IS_REACT_ACT_ENVIRONMENT', Object.getOwnPropertyDescriptor(globalThis, 'IS_REACT_ACT_ENVIRONMENT'));
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  t.after(async () => {
    await window.happyDOM.close();
    for (const [name, descriptor] of globals) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name];
    }
  });
  const { createElement: h, act, useSyncExternalStore } = await import('react');
  const { createRoot } = await import('react-dom/client');
  const { Experience, ExperienceRenderer } = await import('@hachej/boring-ui-kit/experience');
  const { validateExperience } = await import('@hachej/boring-ui-kit/experience/compose');
  const { createHtmlController } = await import('@hachej/boring-ui-kit/html');
  let sequence = 0;
  const original = '<p>Original fictional document</p>\n';
  function layout(type = 'stack', source = 'fixed') {
    return {
      format: 'boring.experience', version: 1, name: 'fictional-layout', title: 'Fictional workspace', source,
      kinds: { [`boring/${type}`]: 1, 'boring/cell': 1, 'fictional/document': 1 },
      root: 'root', elements: {
        root: { type: `boring/${type}`, props: type === 'grid' ? { columns: 2, gap: 'large' } : {}, children: ['document'] },
        document: { type: 'boring/cell', props: { ref: 'fictional/document' } },
      },
    };
  }
  async function fixture(t, { descriptor = layout(), embedded = false, readOnly = false, canView = () => true } = {}) {
    const provider = openSqliteWorkspaces({ filename: ':memory:', providerId: 'fictional-experience', authorize: () => true });
    const identity = { scopeId: 'fictional-project', principalId: 'editor', initiatorId: 'alice' };
    const target = { resource: { providerId: provider.providerId, path: 'notes.html' }, view: { kind: 'published' } };
    let writes = 0, renders = 0;
    const client = {
      read: request => provider.read(request, identity),
      publish: request => { writes++; return provider.publication.publish(request, identity); },
      lookup: operationId => provider.reconciliation.lookup(operationId, identity),
    };
    const seeded = await provider.publication.publish({ operationId: 'seed', atomicity: 'all-or-nothing', changes: [{ kind: 'create', target, expected: { kind: 'absent' }, bytes: new TextEncoder().encode(original), mediaType: 'text/html' }] }, identity);
    assert.equal(seeded.kind, 'committed');
    const read = await client.read({ target, revision: { kind: 'latest' } }); assert.equal(read.kind, 'available');
    const controller = createHtmlController({ identity, source: { kind: 'saved', snapshot: read.snapshot }, client, instanceId: `experience-document-${++sequence}`, epoch: 'page', readOnly });
    function DocumentCell() {
      renders++;
      const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
      const unavailable = state.readOnly || state.lifecycle !== 'active';
      return h('section', { 'aria-label': 'Fictional document cell' },
        h('label', null, 'Document source', h('textarea', { 'aria-label': 'Document source', value: state.text, readOnly: unavailable, onChange: event => controller.actions.edit(event.currentTarget.value) })),
        h('button', { type: 'button', disabled: unavailable || !state.dirty || state.save.kind === 'pending', onClick: () => { void controller.flush(controller.actions.selection()); } }, 'Save document'));
    }
    const cells = [{ ref: 'fictional/document', kind: 'fictional/document', version: 1, render: DocumentCell }];
    const container = document.createElement('div'); document.body.append(container);
    const root = createRoot(container);
    let mounted = true, props = { descriptor, cells, canView, className: 'host-experience' };
    const render = async (changes = {}) => {
      props = { ...props, ...changes };
      await act(async () => root.render(embedded
        ? h('main', null, h('h1', null, 'Existing fictional app'), h(Experience, props), h('button', { type: 'button' }, 'Unrelated host action'))
        : h(Experience, props)));
    };
    const unmount = async () => { if (mounted) { mounted = false; await act(async () => root.unmount()); } };
    t.after(async () => { await unmount(); controller.dispose(); provider.close(); container.remove(); });
    await render();
    const button = label => {
      const found = [...container.querySelectorAll('button')].find(node => node.textContent === label);
      assert.ok(found, `Missing button: ${label}`); return found;
    };
    const click = async label => { await act(async () => button(label).click()); };
    const input = async value => {
      const textarea = container.querySelector('textarea[aria-label="Document source"]'); assert.ok(textarea);
      await act(async () => {
        Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set.call(textarea, value);
        textarea.dispatchEvent(new window.Event('input', { bubbles: true }));
      });
    };
    const saved = async () => {
      const result = await client.read({ target, revision: { kind: 'latest' } });
      assert.equal(result.kind, 'available'); return result.snapshot;
    };
    return { controller, client, cells, container, render, unmount, button, click, input, saved, writes: () => writes, renders: () => renders };
  }
  async function until(predicate, message) {
    const deadline = Date.now() + 2000;
    while (!predicate()) {
      assert.ok(Date.now() < deadline, message);
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)); });
    }
  }

  await t.test('an initially unavailable descriptor can be offered after host access becomes available', async t => {
    let visible = false;
    const f = await fixture(t, { canView: () => visible });
    assert.equal(f.container.querySelector('textarea'), null);
    assert.equal(f.renders(), 0);
    visible = true;
    await f.render();
    assert.equal(f.container.querySelector('textarea'), null);
    await f.click('Use proposed layout');
    assert.equal(f.container.querySelector('textarea').value, original);
    assert.equal(f.writes(), 0);
  });

  await t.test('one fixed descriptor renders independently and inside an existing app with the same resource semantics', async t => {
    const descriptor = layout();
    for (const embedded of [false, true]) {
      const f = await fixture(t, { descriptor, embedded });
      const experience = f.container.querySelector('[data-boring="experience"]');
      assert.equal(experience.getAttribute('aria-label'), 'Fictional workspace');
      assert.ok(experience.classList.contains('host-experience'));
      const stack = experience.querySelector('[data-boring="experience-stack"]'); assert.ok(stack);
      assert.equal(stack.style.flexDirection, 'column'); assert.equal(stack.style.gap, '1rem');
      assert.equal(stack.querySelector('textarea').value, original);
      assert.equal(f.renders() > 0, true); assert.equal(f.writes(), 0);
      if (embedded) {
        assert.equal(f.container.querySelector('main > h1').textContent, 'Existing fictional app');
        assert.equal(f.button('Unrelated host action').closest('[data-boring="experience"]'), null);
      }
      const draft = '<p>Edited through a host cell</p>\n';
      await f.input(draft); assert.equal(f.controller.getSnapshot().dirty, true); assert.equal(f.writes(), 0);
      const selection = f.controller.actions.selection();
      await f.click('Save document');
      await until(() => f.controller.getSnapshot().save.kind === 'settled', 'Host cell save did not settle');
      const result = f.controller.getSnapshot().save.result;
      assert.equal(result.kind, 'saved'); assert.deepEqual(result.selection, selection);
      assert.deepEqual((await f.saved()).bytes, new TextEncoder().encode(draft));
      assert.deepEqual(await f.client.lookup(result.receipt.operationId), { kind: 'committed', receipt: result.receipt });
      assert.equal(f.writes(), 1);
    }
  });

  await t.test('derived row and grid descriptors drive the installed native layout components without writes', async t => {
    for (const type of ['row', 'grid']) {
      const f = await fixture(t, { descriptor: layout(type, 'derived') });
      const element = f.container.querySelector(`[data-boring="experience-${type}"]`); assert.ok(element);
      assert.equal(element.querySelector('textarea').value, original);
      if (type === 'row') { assert.equal(element.style.display, 'flex'); assert.equal(element.style.flexWrap, 'wrap'); }
      else { assert.equal(element.style.display, 'grid'); assert.equal(element.style.gridTemplateColumns, 'repeat(2, minmax(0px, 1fr))'); }
      assert.equal(f.writes(), 0); assert.equal(f.controller.getSnapshot().dirty, false);
    }
  });

  await t.test('a read-only borrowed document remains read-only inside a visible cell', async t => {
    const f = await fixture(t, { readOnly: true });
    const input = f.container.querySelector('textarea'); assert.equal(input.readOnly, true); assert.equal(input.disabled, false);
    assert.equal(f.button('Save document').disabled, true);
    input.focus(); input.setSelectionRange(3, 11); assert.deepEqual([input.selectionStart, input.selectionEnd], [3, 11]);
    await f.click('Save document');
    assert.equal(f.controller.getSnapshot().text, original); assert.equal(f.controller.getSnapshot().dirty, false);
    assert.equal(f.writes(), 0); assert.deepEqual((await f.saved()).bytes, new TextEncoder().encode(original));
  });

  await t.test('initially denied visibility refuses the descriptor before invoking any host renderer', async t => {
    const f = await fixture(t, { canView: () => false });
    assert.equal(f.container.querySelector('[role="alert"]').textContent, 'Experience unavailable');
    assert.equal(f.container.querySelector('textarea'), null); assert.equal(f.renders(), 0); assert.equal(f.writes(), 0);
    assert.equal(f.controller.getSnapshot().lifecycle, 'active');
  });

  await t.test('host rerender revokes a live cell without invoking it and restores its borrowed dirty buffer on a later grant', async t => {
    let allowed = true;
    const f = await fixture(t, { canView: () => allowed });
    const draft = '<p>Retained private draft</p>';
    await f.input(draft);
    const before = f.renders(); allowed = false; await f.render();
    assert.equal(f.renders(), before);
    assert.equal(f.container.querySelector('textarea'), null);
    assert.match(f.container.textContent, /Cell unavailable/);
    assert.doesNotMatch(f.container.textContent, /Retained private draft/);
    assert.equal(f.controller.getSnapshot().text, draft); assert.equal(f.controller.getSnapshot().dirty, true);
    assert.equal(f.controller.getSnapshot().lifecycle, 'active'); assert.equal(f.writes(), 0);
    allowed = true; await f.render();
    assert.equal(f.container.querySelector('textarea').value, draft); assert.ok(f.renders() > before);
    assert.equal(f.writes(), 0); assert.deepEqual((await f.saved()).bytes, new TextEncoder().encode(original));
  });

  await t.test('missing, duplicate, version-changed or throwing live registrations never invoke an unavailable cell', async t => {
    const f = await fixture(t), before = f.renders();
    for (const cells of [[], [f.cells[0], f.cells[0]], [{ ...f.cells[0], version: 2 }]]) {
      await f.render({ cells });
      assert.equal(f.container.querySelector('textarea'), null); assert.match(f.container.textContent, /Cell unavailable/);
      assert.equal(f.renders(), before); assert.equal(f.writes(), 0);
    }
    await f.render({ cells: f.cells, canView: () => { throw new Error('Fictional host visibility failure'); } });
    assert.equal(f.container.querySelector('textarea'), null); assert.match(f.container.textContent, /Cell unavailable/);
    assert.equal(f.renders(), before); assert.equal(f.controller.getSnapshot().lifecycle, 'active');
  });

  await t.test('a proposed phase layout waits for explicit adoption and keeps the dirty document through reparenting', async t => {
    const f = await fixture(t), draft = '<p>Unsaved work before phase change</p>';
    await f.input(draft);
    const textarea = f.container.querySelector('textarea'), proposed = layout('grid', 'derived');
    proposed.name = 'fictional-review'; proposed.title = 'Review phase';
    await f.render({ descriptor: proposed });
    assert.ok(f.container.querySelector('[data-boring="experience-stack"]'));
    assert.equal(f.container.querySelector('[data-boring="experience-grid"]'), null);
    assert.equal(f.container.querySelector('textarea'), textarea);
    assert.equal(f.container.querySelector('[data-boring="experience"]').getAttribute('aria-label'), 'Fictional workspace');
    assert.ok(f.button('Use proposed layout')); assert.equal(f.writes(), 0);
    await f.click('Use proposed layout');
    assert.equal(f.container.querySelector('[data-boring="experience-stack"]'), null);
    assert.ok(f.container.querySelector('[data-boring="experience-grid"]'));
    assert.equal(f.container.querySelector('[data-boring="experience"]').getAttribute('aria-label'), 'Review phase');
    assert.equal([...f.container.querySelectorAll('button')].some(button => button.textContent === 'Use proposed layout'), false);
    assert.equal(f.container.querySelector('textarea').value, draft);
    assert.equal(f.controller.getSnapshot().text, draft); assert.equal(f.controller.getSnapshot().dirty, true);
    assert.equal(f.controller.getSnapshot().lifecycle, 'active'); assert.equal(f.writes(), 0);
    assert.deepEqual((await f.saved()).bytes, new TextEncoder().encode(original));
    await f.click('Save document');
    await until(() => !f.controller.getSnapshot().dirty, 'Adopted cell did not save its existing draft');
    assert.equal(f.writes(), 1); assert.deepEqual((await f.saved()).bytes, new TextEncoder().encode(draft));
  });

  await t.test('invalid proposals retain the current controls and cannot introduce actions, state or executable renderers', async t => {
    const f = await fixture(t), textarea = f.container.querySelector('textarea');
    await f.input('<p>Keep this draft</p>');
    let invoked = 0;
    const proposals = [
      { ...layout('grid', 'derived'), state: { approved: true } },
      { ...layout('grid', 'derived'), source: 'unknown' },
      { ...layout('grid', 'derived'), render: () => { invoked++; } },
    ];
    const action = layout('grid', 'derived'); action.elements.document.on = { press: { action: 'setState', params: { path: '/approved', value: true } } }; proposals.push(action);
    const binding = layout('grid', 'derived'); binding.elements.document.props.ref = { $state: '/cell' }; proposals.push(binding);
    const missing = layout('grid', 'derived'); missing.elements.document.props.ref = 'fictional/missing'; proposals.push(missing);
    for (const descriptor of proposals) {
      await f.render({ descriptor });
      assert.match(f.container.querySelector('[role="alert"]').textContent, /current layout has been retained/);
      assert.equal(f.container.querySelector('textarea'), textarea); assert.equal(textarea.value, '<p>Keep this draft</p>');
      assert.ok(f.container.querySelector('[data-boring="experience-stack"]'));
      assert.equal(f.container.querySelector('[data-boring="experience-grid"]'), null);
      assert.equal([...f.container.querySelectorAll('button')].some(button => button.textContent === 'Use proposed layout'), false);
      assert.equal(f.writes(), 0); assert.equal(invoked, 0);
    }
    assert.equal(f.controller.getSnapshot().dirty, true);
    assert.deepEqual((await f.saved()).bytes, new TextEncoder().encode(original));
  });

  await t.test('unmount removes presentation and leaves the borrowed dirty controller usable for exact publication', async t => {
    const f = await fixture(t), draft = '<p>Save after experience closes</p>';
    await f.input(draft); await f.unmount();
    assert.equal(f.container.childElementCount, 0);
    assert.equal(f.controller.getSnapshot().lifecycle, 'active'); assert.equal(f.controller.getSnapshot().dirty, true); assert.equal(f.writes(), 0);
    const selected = f.controller.actions.selection(), result = await f.controller.flush(selected);
    assert.equal(result.kind, 'saved'); assert.deepEqual(result.selection, selected);
    assert.deepEqual((await f.saved()).bytes, new TextEncoder().encode(draft)); assert.equal(f.writes(), 1);
  });
  await t.test('public renderer displays an already adopted descriptor without another acceptance layer', async () => {
    const container = document.createElement('div'); document.body.append(container);
    const root = createRoot(container);
    let permitted = true;
    const cells = [{ ref: 'fixture/card', kind: 'fixture/card', version: 1, render: () => h('p', null, 'Visible fixture') }];
    const descriptor = validateExperience({ format: 'boring.experience', version: 1, name: 'fixture', source: 'fixed',
      kinds: { 'boring/cell': 1, 'fixture/card': 1 }, root: 'card', elements: { card: { type: 'boring/cell', props: { ref: 'fixture/card' }, children: [] } },
    }, { cells, canView: () => true });
    try {
      await act(async () => root.render(h(ExperienceRenderer, { descriptor, cells, canView: () => permitted })));
      assert.equal(container.textContent, 'Visible fixture'); assert.equal(container.querySelector('button'), null);
      permitted = false;
      await act(async () => root.render(h(ExperienceRenderer, { descriptor, cells, canView: () => permitted })));
      assert.equal(container.textContent, 'Cell unavailable');
    } finally { await act(async () => root.unmount()); container.remove(); }
  });

});
