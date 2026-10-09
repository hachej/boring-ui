import assert from 'node:assert/strict';
import test from 'node:test';
import { Window } from 'happy-dom';
import { openSqliteWorkspaces } from '../../examples/shared/sqlite-workspaces.mjs';

test('native composition and Keep controls with React/json-render/SQLite in HappyDOM; no browser or full experience qualification', { timeout: 30000 }, async t => {
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
  const { composeExperience } = await import('@hachej/boring-ui-kit/experience/compose');
  const { ExperienceDocument } = await import('@hachej/boring-ui-kit/experience/document-viewer');
  const { createExperienceDocumentController } = await import('@hachej/boring-ui-kit/experience/document');
  const { createHtmlController } = await import('@hachej/boring-ui-kit/html');
  let sequence = 0;
  function layout(title = 'Original layout', type = 'stack') {
    return {
      format: 'boring.experience', version: 1, name: 'fictional-layout', title, source: 'fixed',
      kinds: { [`boring/${type}`]: 1, 'boring/cell': 1, 'fictional/document': 1 }, root: 'root',
      elements: {
        root: { type: `boring/${type}`, props: {}, children: ['document'] },
        document: { type: 'boring/cell', props: { ref: 'fictional/document' } },
      },
    };
  }
  const selectDocument = async request => ({
    answers: Object.fromEntries(Object.entries(request.questions).map(([name, question]) => {
      const offered = Object.keys(question.criteria);
      return [name, { choice: name === 'root' ? 'layout_stack' : offered.find(key => key.startsWith('use:')) ?? offered[0] }];
    })),
  });
  async function fixture(t) {
    const provider = openSqliteWorkspaces({ filename: ':memory:', providerId: 'fictional-composition', authorize: () => true });
    const identity = { scopeId: 'fictional-project', principalId: 'editor', initiatorId: 'alice' };
    const target = { resource: { providerId: provider.providerId, path: 'layout.json' }, view: { kind: 'published' } };
    const cellTarget = { resource: { providerId: provider.providerId, path: 'notes.html' }, view: { kind: 'published' } };
    const seed = async (target, source, mediaType) => {
      const result = await provider.publication.publish({ operationId: 'seed-' + target.resource.path, atomicity: 'all-or-nothing', changes: [{ kind: 'create', target, expected: { kind: 'absent' }, bytes: new TextEncoder().encode(source), mediaType }] }, identity);
      assert.equal(result.kind, 'committed');
      const read = await provider.read({ target, revision: { kind: 'latest' } }, identity);
      assert.equal(read.kind, 'available'); return read.snapshot;
    };
    let writes = 0, cellWrites = 0;
    const client = {
      read: request => provider.read(request, identity),
      publish: request => { writes++; return provider.publication.publish(request, identity); },
      lookup: operationId => provider.reconciliation.lookup(operationId, identity),
    };
    const cell = createHtmlController({ identity, instanceId: `host-cell-${++sequence}`, epoch: 'page',
      source: { kind: 'saved', snapshot: await seed(cellTarget, '<p>Fictional borrowed document</p>\n', 'text/html') },
      client: { ...client, publish: request => { cellWrites++; return provider.publication.publish(request, identity); } },
    });
    function DocumentCell() {
      const state = useSyncExternalStore(cell.subscribe, cell.getSnapshot, cell.getSnapshot);
      return h('label', null, 'Cell source', h('textarea', { 'aria-label': 'Cell source', value: state.text,
        readOnly: state.readOnly || state.lifecycle !== 'active', onChange: event => cell.actions.edit(event.currentTarget.value) }));
    }
    const cells = [{ ref: 'fictional/document', kind: 'fictional/document', version: 1, render: DocumentCell }], canView = () => true;
    const controller = createExperienceDocumentController({ identity, instanceId: `layout-${++sequence}`, epoch: 'page', client, cells, canView,
      source: { kind: 'saved', snapshot: await seed(target, JSON.stringify(layout()) + '\n', 'application/json') },
    });
    const container = document.createElement('div'); document.body.append(container); const root = createRoot(container);
    let mounted = true;
    const unmount = async () => { if (mounted) { mounted = false; await act(async () => root.unmount()); } };
    t.after(async () => { await unmount(); controller.dispose(); cell.dispose(); provider.close(); container.remove(); });
    await act(async () => root.render(h(ExperienceDocument, { controller, cells, canView, title: 'Fictional layout document' })));
    const button = label => {
      const found = [...container.querySelectorAll('button')].find(node => node.textContent === label);
      assert.ok(found, `Missing control: ${label}`); return found;
    };
    const click = async label => { await act(async () => button(label).click()); };
    const offer = async (base, descriptor) => {
      let result;
      await act(async () => { result = controller.actions.propose(base, descriptor); });
      return result;
    };
    const inputCell = async value => {
      const textarea = container.querySelector('textarea[aria-label="Cell source"]'); assert.ok(textarea);
      await act(async () => {
        Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set.call(textarea, value);
        textarea.dispatchEvent(new window.Event('input', { bubbles: true }));
      });
    };
    const start = (evaluate = selectDocument) => {
      const abort = new AbortController(); t.after(() => abort.abort());
      const stream = composeExperience({ cells, canView, evaluate, signal: abort.signal,
        definition: { name: 'fictional-generated', title: 'Generated review', intents: { review: 'Arrange the document for review.' },
          kinds: [{ kind: 'fictional/document', description: 'Editable document', metadata: { role: ['document'] } }] },
        candidates: [{ ref: 'fictional/document', metadata: { role: 'document' } }], intent: 'review',
        fallback: controller.getSnapshot().descriptor, limits: { maxElements: 8, maxDepth: 4, maxEvaluations: 4 },
      });
      return { stream, abort };
    };
    const saved = async () => {
      const read = await client.read({ target, revision: { kind: 'latest' } }); assert.equal(read.kind, 'available');
      assert.equal(read.snapshot.mediaType, 'application/json');
      return { snapshot: read.snapshot, descriptor: JSON.parse(new TextDecoder().decode(read.snapshot.bytes)) };
    };
    const displayed = () => container.querySelector('[data-boring="experience"]')?.getAttribute('aria-label');
    return { controller, cell, client, container, button, click, offer, inputCell, start, saved, displayed, unmount, writes: () => writes, cellWrites: () => cellWrites };
  }
  async function collect(stream) { const snapshots = []; for await (const snapshot of stream) snapshots.push(snapshot); return snapshots; }

  await t.test('native generated output stays an offer until adoption and Keep saves a fixed revision with its receipt', async t => {
    const f = await fixture(t), base = f.controller.actions.selection(), before = f.controller.getSnapshot();
    const draft = '<p>Unsaved host document work</p>'; await f.inputCell(draft);
    const textarea = f.container.querySelector('textarea'), snapshots = []; let evaluations = 0;
    const { stream } = f.start(request => { evaluations++; return selectDocument(request); });
    for await (const snapshot of stream) {
      snapshots.push(snapshot);
      assert.equal(f.displayed(), 'Original layout'); assert.equal(f.controller.getSnapshot().text, before.text);
      assert.equal(f.controller.getSnapshot().proposal, null); assert.equal(f.container.querySelector('textarea'), textarea);
      assert.equal(f.writes(), 0); assert.equal(f.cellWrites(), 0);
    }
    assert.ok(evaluations > 0); assert.equal(snapshots[0].reason, 'pending');
    assert.ok(snapshots.some(snapshot => snapshot.kind === 'partial'));
    const final = snapshots.at(-1); assert.equal(final.kind, 'final'); assert.equal(final.descriptor.source, 'generated');
    assert.equal((await f.offer(base, final.descriptor)).kind, 'proposed');
    assert.equal(f.displayed(), 'Original layout'); assert.equal(f.button('Keep this layout').disabled, true);
    assert.equal(f.controller.getSnapshot().bufferVersion, before.bufferVersion);
    assert.equal(f.controller.getSnapshot().proposal.descriptor.source, 'generated');
    await f.click('Use proposed layout');
    assert.equal(f.displayed(), 'Generated review'); assert.ok(f.container.querySelector('[data-boring="experience-stack"]'));
    assert.equal(f.controller.getSnapshot().descriptor.source, 'fixed'); assert.equal(f.controller.getSnapshot().dirty, true);
    assert.equal(f.container.querySelector('textarea').value, draft); assert.equal(f.cell.getSnapshot().dirty, true);
    assert.equal((await f.saved()).descriptor.title, 'Original layout'); assert.equal(f.writes(), 0); assert.equal(f.cellWrites(), 0);
    const selected = f.controller.actions.selection(); await f.click('Keep this layout');
    const deadline = Date.now() + 2000;
    while (f.controller.getSnapshot().save.kind !== 'settled') {
      assert.ok(Date.now() < deadline, 'Keep did not settle');
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)); });
    }
    const result = f.controller.getSnapshot().save.result; assert.equal(result.kind, 'saved'); assert.deepEqual(result.selection, selected);
    const saved = await f.saved(); assert.equal(saved.descriptor.source, 'fixed'); assert.equal(saved.descriptor.title, 'Generated review');
    assert.deepEqual(saved.snapshot.ref, result.ref); assert.equal(result.receipt.changes[0].kind, 'replace');
    assert.deepEqual(await f.client.lookup(result.receipt.operationId), { kind: 'committed', receipt: result.receipt });
    assert.equal(f.writes(), 1); assert.equal(f.cellWrites(), 0); assert.equal(f.cell.getSnapshot().text, draft);
    assert.equal(f.controller.getSnapshot().dirty, false); assert.equal(f.button('Keep this layout').disabled, true);
  });

  await t.test('late native composition cannot offer against a captured base after another layout is adopted', async t => {
    const f = await fixture(t), base = f.controller.actions.selection();
    const entered = Promise.withResolvers(), release = Promise.withResolvers(); t.after(() => release.resolve());
    const { stream } = f.start(async request => { entered.resolve(); await release.promise; return selectDocument(request); });
    const pending = collect(stream); await entered.promise;
    assert.equal((await f.offer(base, layout('Later local layout', 'row'))).kind, 'proposed'); await f.click('Use proposed layout');
    const local = f.controller.getSnapshot(); assert.equal(f.displayed(), 'Later local layout');
    release.resolve(); const final = (await pending).at(-1); assert.equal(final.kind, 'final');
    assert.equal((await f.offer(base, final.descriptor)).kind, 'stale');
    assert.equal(f.displayed(), 'Later local layout'); assert.ok(f.container.querySelector('[data-boring="experience-row"]'));
    assert.equal(f.controller.getSnapshot().text, local.text); assert.equal(f.controller.getSnapshot().bufferVersion, local.bufferVersion);
    assert.equal(f.controller.getSnapshot().proposal, null); assert.equal((await f.saved()).descriptor.title, 'Original layout');
    assert.equal(f.writes(), 0); assert.equal(f.cellWrites(), 0);
  });

  await t.test('native evaluator failure leaves the displayed layout and dirty borrowed document unchanged', async t => {
    const f = await fixture(t), before = f.controller.getSnapshot(), draft = '<p>Draft survives evaluator failure</p>';
    await f.inputCell(draft); let evaluations = 0;
    const { stream } = f.start(async () => { evaluations++; throw new Error('Fictional evaluator unavailable'); });
    const snapshots = await collect(stream), final = snapshots.at(-1);
    assert.equal(evaluations, 1); assert.equal(final.kind, 'default'); assert.equal(final.reason, 'unavailable');
    assert.equal(final.descriptor.title, 'Original layout'); assert.equal(f.displayed(), 'Original layout');
    assert.equal(f.controller.getSnapshot().text, before.text); assert.equal(f.controller.getSnapshot().proposal, null);
    assert.equal(f.container.querySelector('textarea').value, draft); assert.equal(f.cell.getSnapshot().dirty, true);
    assert.equal(f.writes(), 0); assert.equal(f.cellWrites(), 0);
  });

  await t.test('cancelling a native composition with a pending evaluator keeps the current layout selected', async t => {
    const f = await fixture(t), entered = Promise.withResolvers(), release = Promise.withResolvers(); t.after(() => release.resolve());
    const before = f.controller.getSnapshot(); let evaluations = 0;
    const { stream, abort } = f.start(async request => { evaluations++; entered.resolve(); await release.promise; return selectDocument(request); });
    const pending = collect(stream); await entered.promise; abort.abort();
    const snapshots = await pending, final = snapshots.at(-1);
    assert.equal(evaluations, 1); assert.equal(final.kind, 'default'); assert.equal(final.reason, 'cancelled');
    assert.equal(f.displayed(), 'Original layout'); assert.equal(f.controller.getSnapshot().text, before.text);
    assert.equal(f.controller.getSnapshot().proposal, null); assert.equal(f.button('Keep this layout').disabled, true);
    release.resolve(); await Promise.resolve();
    assert.equal(f.writes(), 0); assert.equal(f.cellWrites(), 0);
  });

  await t.test('host cancellation on unmount leaves borrowed controllers active and the dirty cell independently saveable', async t => {
    const f = await fixture(t), draft = '<p>Host document survives closing composition</p>'; await f.inputCell(draft);
    const entered = Promise.withResolvers(), release = Promise.withResolvers(); t.after(() => release.resolve());
    const { stream, abort } = f.start(async request => { entered.resolve(); await release.promise; return selectDocument(request); });
    const pending = collect(stream); await entered.promise; await f.unmount(); abort.abort();
    const final = (await pending).at(-1); assert.equal(final.kind, 'default'); assert.equal(final.reason, 'cancelled');
    assert.equal(f.container.childElementCount, 0); assert.equal(f.controller.getSnapshot().lifecycle, 'active');
    assert.equal(f.cell.getSnapshot().lifecycle, 'active'); assert.equal(f.cell.getSnapshot().text, draft); assert.equal(f.cell.getSnapshot().dirty, true);
    assert.equal(f.controller.getSnapshot().proposal, null); assert.equal(f.writes(), 0); assert.equal(f.cellWrites(), 0);
    const result = await f.cell.flush(f.cell.actions.selection()); assert.equal(result.kind, 'saved');
    const read = await f.client.read({ target: result.ref, revision: { kind: 'exact', value: result.ref.revision } });
    assert.equal(read.kind, 'available'); assert.deepEqual(read.snapshot.bytes, new TextEncoder().encode(draft));
    assert.equal(f.writes(), 0); assert.equal(f.cellWrites(), 1); assert.equal((await f.saved()).descriptor.title, 'Original layout');
  });
});
