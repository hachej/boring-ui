import assert from 'node:assert/strict';
import test from 'node:test';
import { Window } from 'happy-dom';
import { openSqliteWorkspaces } from '../../examples/shared/sqlite-workspaces.mjs';

test('experience Keep controls with real React/json-render/SQLite in HappyDOM; no browser or full experience qualification', { timeout: 30000 }, async t => {
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
  const { ExperienceDocument } = await import('@hachej/boring-ui-kit/experience/document-viewer');
  const { createExperienceDocumentController } = await import('@hachej/boring-ui-kit/experience/document');
  const { createHtmlController } = await import('@hachej/boring-ui-kit/html');
  const originalCell = '<p>Fictional borrowed document</p>\n';
  let sequence = 0;
  function layout(title = 'Original layout', type = 'stack', source = 'fixed') {
    return {
      format: 'boring.experience', version: 1, name: 'fictional-layout', title, source,
      kinds: { [`boring/${type}`]: 1, 'boring/cell': 1, 'fictional/document': 1 }, root: 'root',
      elements: {
        root: { type: `boring/${type}`, props: type === 'grid' ? { columns: 2 } : {}, children: ['document'] },
        document: { type: 'boring/cell', props: { ref: 'fictional/document' } },
      },
    };
  }
  async function fixture(t, { descriptor = layout(), newDocument = false, readOnly = false, mount = true, publish } = {}) {
    const provider = openSqliteWorkspaces({ filename: ':memory:', providerId: 'fictional-keep', authorize: () => true });
    const identity = { scopeId: 'fictional-project', principalId: 'editor', initiatorId: 'alice' };
    const target = { resource: { providerId: provider.providerId, path: 'layout.json' }, view: { kind: 'published' } };
    const cellTarget = { resource: { providerId: provider.providerId, path: 'notes.html' }, view: { kind: 'published' } };
    const seed = async (target, source, mediaType) => {
      const result = await provider.publication.publish({ operationId: 'seed-' + target.resource.path, atomicity: 'all-or-nothing', changes: [{ kind: 'create', target, expected: { kind: 'absent' }, bytes: new TextEncoder().encode(source), mediaType }] }, identity);
      assert.equal(result.kind, 'committed');
      const read = await provider.read({ target, revision: { kind: 'latest' } }, identity); assert.equal(read.kind, 'available'); return read.snapshot;
    };
    const cellSnapshot = await seed(cellTarget, originalCell, 'text/html');
    let writes = 0, cellWrites = 0;
    const client = {
      read: request => provider.read(request, identity),
      publish: request => { writes++; return publish ? publish(request, () => provider.publication.publish(request, identity)) : provider.publication.publish(request, identity); },
      lookup: operationId => provider.reconciliation.lookup(operationId, identity),
    };
    const cell = createHtmlController({ identity, source: { kind: 'saved', snapshot: cellSnapshot }, instanceId: `host-cell-${++sequence}`, epoch: 'page', client: {
      ...client, publish: request => { cellWrites++; return provider.publication.publish(request, identity); },
    } });
    function DocumentCell() {
      const state = useSyncExternalStore(cell.subscribe, cell.getSnapshot, cell.getSnapshot);
      return h('label', null, 'Cell source', h('textarea', { 'aria-label': 'Cell source', value: state.text, readOnly: state.readOnly || state.lifecycle !== 'active', onChange: event => cell.actions.edit(event.currentTarget.value) }));
    }
    const cells = [{ ref: 'fictional/document', kind: 'fictional/document', version: 1, render: DocumentCell }];
    const source = newDocument ? { kind: 'new', target, descriptor } : { kind: 'saved', snapshot: await seed(target, JSON.stringify(descriptor) + '\n', 'application/json') };
    const canView = () => true;
    const controller = createExperienceDocumentController({ identity, source, client, cells, canView, instanceId: `layout-${++sequence}`, epoch: 'page', readOnly });
    const container = document.createElement('div'); document.body.append(container); const root = createRoot(container);
    let mounted = true;
    const render = async (selected = controller, registered = cells) => {
      await act(async () => root.render(h(ExperienceDocument, { controller: selected, cells: registered, canView, title: 'Fictional layout document', className: 'host-layout-document' })));
    };
    const unmount = async () => { if (mounted) { mounted = false; await act(async () => root.unmount()); } };
    t.after(async () => { await unmount(); controller.dispose(); cell.dispose(); provider.close(); container.remove(); });
    if (mount) await render();
    const button = label => {
      const found = [...container.querySelectorAll('button')].find(node => node.textContent === label);
      assert.ok(found, `Missing control: ${label}`); return found;
    };
    const click = async label => { await act(async () => button(label).click()); };
    const offer = async descriptor => {
      let result;
      await act(async () => { result = controller.actions.propose(controller.actions.selection(), descriptor); });
      assert.equal(result.kind, 'proposed'); return result.proposalId;
    };
    const inputCell = async value => {
      const textarea = container.querySelector('textarea[aria-label="Cell source"]'); assert.ok(textarea);
      await act(async () => {
        Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set.call(textarea, value);
        textarea.dispatchEvent(new window.Event('input', { bubbles: true }));
      });
    };
    const saved = () => client.read({ target, revision: { kind: 'latest' } });
    const external = async descriptor => {
      const read = await saved(); assert.equal(read.kind, 'available');
      return provider.publication.publish({ operationId: `external-${++sequence}`, atomicity: 'all-or-nothing', changes: [{ kind: 'replace', target: read.snapshot.ref, bytes: new TextEncoder().encode(JSON.stringify(descriptor) + '\n'), mediaType: 'application/json' }] }, identity);
    };
    const displayed = () => container.querySelector('[data-boring="experience"]')?.getAttribute('aria-label');
    return { controller, cell, client, cells, target, container, render, unmount, button, click, offer, inputCell, saved, external, displayed, writes: () => writes, cellWrites: () => cellWrites };
  }
  async function until(predicate, message) {
    const deadline = Date.now() + 2000;
    while (!predicate()) {
      assert.ok(Date.now() < deadline, message);
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)); });
    }
  }
  async function settled(f) { await until(() => f.controller.getSnapshot().save.kind === 'settled', 'Keep did not settle'); return f.controller.getSnapshot().save.result; }
  async function savedLayout(f) {
    const read = await f.saved(); assert.equal(read.kind, 'available');
    assert.equal(read.snapshot.mediaType, 'application/json'); return JSON.parse(new TextDecoder().decode(read.snapshot.bytes));
  }

  await t.test('an initial derived layout stays an absent draft until Keep captures it as a fixed document', async t => {
    const f = await fixture(t, { newDocument: true, descriptor: layout('Initial derived layout', 'row', 'derived') });
    assert.equal(f.displayed(), 'Initial derived layout');
    assert.ok(f.container.querySelector('.host-layout-document'));
    assert.equal(f.controller.getSnapshot().dirty, true); assert.equal(f.writes(), 0); assert.equal((await f.saved()).kind, 'missing');
    const selected = f.controller.actions.selection();
    await f.click('Keep this layout'); const result = await settled(f);
    assert.equal(result.kind, 'saved'); assert.deepEqual(result.selection, selected);
    assert.equal(result.receipt.changes[0].kind, 'create'); assert.equal(result.receipt.changes[0].before, null);
    assert.equal((await savedLayout(f)).source, 'fixed'); assert.equal((await savedLayout(f)).title, 'Initial derived layout');
    assert.deepEqual(await f.client.lookup(result.receipt.operationId), { kind: 'committed', receipt: result.receipt });
    assert.equal(f.writes(), 1); assert.equal(f.cellWrites(), 0); assert.equal(f.button('Keep this layout').disabled, true);
  });

  await t.test('offer, local adoption and Keep are separate controls while the borrowed cell keeps its dirty text', async t => {
    const f = await fixture(t), current = f.controller.getSnapshot(), cellDraft = '<p>Unsaved cell work</p>';
    await f.inputCell(cellDraft); const textarea = f.container.querySelector('textarea');
    const id = await f.offer(layout('Proposed review', 'grid', 'derived'));
    assert.equal(f.controller.getSnapshot().proposal.id, id);
    assert.equal(f.controller.getSnapshot().text, current.text); assert.equal(f.controller.getSnapshot().bufferVersion, current.bufferVersion);
    assert.equal(f.displayed(), 'Original layout'); assert.equal(f.container.querySelector('textarea'), textarea);
    assert.equal(f.button('Keep this layout').disabled, true); assert.equal(f.writes(), 0); assert.equal(f.cellWrites(), 0);
    await f.click('Use proposed layout');
    assert.equal(f.displayed(), 'Proposed review'); assert.ok(f.container.querySelector('[data-boring="experience-grid"]'));
    assert.equal(f.controller.getSnapshot().proposal, null); assert.equal(f.controller.getSnapshot().dirty, true);
    assert.equal(f.container.querySelector('textarea').value, cellDraft); assert.equal(f.cell.getSnapshot().dirty, true);
    assert.equal((await savedLayout(f)).title, 'Original layout'); assert.equal(f.writes(), 0);
    const selected = f.controller.actions.selection();
    await f.click('Keep this layout'); const result = await settled(f);
    assert.equal(result.kind, 'saved'); assert.deepEqual(result.selection, selected);
    assert.equal((await savedLayout(f)).title, 'Proposed review'); assert.equal((await savedLayout(f)).source, 'fixed');
    assert.equal(f.writes(), 1); assert.equal(f.cellWrites(), 0); assert.equal(f.cell.getSnapshot().text, cellDraft);
  });

  await t.test('Dismiss proposed layout removes only the offer and never changes the selected document', async t => {
    const f = await fixture(t), before = f.controller.getSnapshot();
    await f.offer(layout('Discarded proposal', 'grid', 'derived')); await f.click('Dismiss proposed layout');
    assert.equal(f.controller.getSnapshot().proposal, null); assert.equal(f.controller.getSnapshot().text, before.text);
    assert.equal(f.controller.getSnapshot().bufferVersion, before.bufferVersion); assert.equal(f.displayed(), 'Original layout');
    assert.equal(f.container.querySelector('[aria-label="Proposed layout"]'), null);
    assert.equal(f.writes(), 0); assert.equal(f.cellWrites(), 0);
  });

  await t.test('a conflicting Keep retains the adopted draft until Refresh and Discard local layout explicitly load the saved document', async t => {
    const f = await fixture(t);
    await f.offer(layout('Local draft', 'grid', 'derived')); await f.click('Use proposed layout');
    assert.equal((await f.external(layout('Remote layout', 'row'))).kind, 'committed');
    await f.click('Keep this layout'); assert.equal((await settled(f)).kind, 'conflict');
    assert.equal(f.displayed(), 'Local draft'); assert.equal((await savedLayout(f)).title, 'Remote layout');
    await f.click('Refresh layout');
    await until(() => f.controller.getSnapshot().remote !== null, 'Refresh did not expose the remote layout');
    assert.equal(f.displayed(), 'Local draft'); assert.equal(f.controller.getSnapshot().dirty, true);
    await f.click('Discard local layout');
    await until(() => !f.controller.getSnapshot().dirty, 'Discard did not load the saved layout');
    assert.equal(f.displayed(), 'Remote layout'); assert.ok(f.container.querySelector('[data-boring="experience-row"]'));
    assert.equal(f.writes(), 1); assert.equal(f.cellWrites(), 0);
  });

  await t.test('an offer based on an earlier saved revision remains inspectable but its stale adoption cannot change the refreshed layout', async t => {
    const f = await fixture(t), id = await f.offer(layout('Stale offer', 'grid', 'derived'));
    assert.equal((await f.external(layout('Refreshed base', 'row'))).kind, 'committed');
    await f.click('Refresh layout');
    await until(() => f.displayed() === 'Refreshed base', 'Clean refresh did not display the new saved layout');
    assert.equal(f.controller.getSnapshot().proposal.id, id);
    await f.click('Use proposed layout');
    assert.ok(f.container.querySelector('[role="alert"]')); assert.equal(f.displayed(), 'Refreshed base');
    assert.equal(f.controller.getSnapshot().proposal.id, id); assert.equal(f.writes(), 0);
    await f.click('Dismiss proposed layout'); assert.equal(f.controller.getSnapshot().proposal, null);
  });

  await t.test('Reconcile keep acknowledges the captured layout without replaying or overwriting a later adopted layout', async t => {
    const f = await fixture(t, { publish: async (_request, commit) => { await commit(); throw new Error('Fictional lost Keep acknowledgement'); } });
    await f.offer(layout('Committed review', 'grid', 'derived')); await f.click('Use proposed layout'); await f.click('Keep this layout');
    assert.equal((await settled(f)).kind, 'unknown'); assert.equal(f.button('Keep this layout').disabled, true);
    await f.offer(layout('Later local review', 'row', 'derived')); await f.click('Use proposed layout');
    assert.equal(f.displayed(), 'Later local review'); assert.equal(f.button('Keep this layout').disabled, true);
    await f.click('Reconcile keep');
    await until(() => { const save = f.controller.getSnapshot().save; return save.kind === 'settled' && save.result.kind === 'saved'; }, 'Keep reconciliation did not settle');
    assert.equal(f.displayed(), 'Later local review'); assert.equal(f.controller.getSnapshot().dirty, true);
    assert.equal((await savedLayout(f)).title, 'Committed review'); assert.equal(f.writes(), 1); assert.equal(f.cellWrites(), 0);
  });

  await t.test('a late Keep acknowledgement preserves a newer adopted layout and a subsequent unadopted offer', async t => {
    const committed = Promise.withResolvers(), release = Promise.withResolvers(); t.after(() => release.resolve());
    const f = await fixture(t, { publish: async (_request, commit) => { const result = await commit(); committed.resolve(); await release.promise; return result; } });
    await f.offer(layout('Captured layout', 'grid', 'derived')); await f.click('Use proposed layout');
    const selected = f.controller.actions.selection(); await f.click('Keep this layout'); await committed.promise;
    assert.equal(f.button('Keep this layout').disabled, true);
    await f.offer(layout('Newer selected layout', 'row', 'derived')); await f.click('Use proposed layout');
    const id = await f.offer(layout('Still only offered', 'grid', 'derived'));
    assert.equal(f.displayed(), 'Newer selected layout');
    await act(async () => release.resolve()); const result = await settled(f);
    assert.equal(result.kind, 'saved'); assert.deepEqual(result.selection, selected);
    assert.equal(f.displayed(), 'Newer selected layout'); assert.equal(f.controller.getSnapshot().dirty, true);
    assert.equal(f.controller.getSnapshot().proposal.id, id); assert.equal((await savedLayout(f)).title, 'Captured layout');
    await f.click('Use proposed layout');
    assert.ok(f.container.querySelector('[role="alert"]')); assert.equal(f.displayed(), 'Newer selected layout');
    assert.equal(f.writes(), 1); assert.equal(f.cellWrites(), 0);
  });

  await t.test('equal-version controller replacement immediately displays and keeps B while a late A acknowledgement stays with A', async t => {
    const committed = Promise.withResolvers(), release = Promise.withResolvers(); t.after(() => release.resolve());
    const old = await fixture(t, { newDocument: true, descriptor: layout('Layout A'), publish: async (_request, commit) => { const result = await commit(); committed.resolve(); await release.promise; return result; } });
    const next = await fixture(t, { newDocument: true, descriptor: layout('Layout B', 'grid'), mount: false });
    assert.equal(old.controller.getSnapshot().bufferVersion, 0); assert.equal(next.controller.getSnapshot().bufferVersion, 0);
    await old.click('Keep this layout'); await committed.promise;
    await old.render(next.controller, next.cells);
    assert.equal(old.displayed(), 'Layout B'); assert.ok(old.container.querySelector('[data-boring="experience-grid"]'));
    assert.equal(old.button('Keep this layout').disabled, false); assert.equal(next.writes(), 0);
    await old.click('Keep this layout'); assert.equal((await settled(next)).kind, 'saved');
    assert.equal((await savedLayout(next)).title, 'Layout B'); assert.equal(next.writes(), 1);
    await act(async () => release.resolve()); assert.equal((await settled(old)).kind, 'saved');
    assert.equal(old.displayed(), 'Layout B'); assert.equal((await savedLayout(old)).title, 'Layout A'); assert.equal(old.writes(), 1);
    for (const controller of [old.controller, old.cell, next.controller, next.cell]) assert.equal(controller.getSnapshot().lifecycle, 'active');
  });

  await t.test('read-only layout controls refuse mutation without taking ownership of the cell controller', async t => {
    const f = await fixture(t, { readOnly: true });
    assert.equal(f.button('Keep this layout').disabled, true); await f.click('Keep this layout');
    const offered = f.controller.actions.propose(f.controller.actions.selection(), layout('Forbidden layout', 'grid', 'derived'));
    assert.equal(offered.kind, 'denied'); assert.equal(f.container.querySelector('[aria-label="Proposed layout"]'), null);
    assert.equal(f.displayed(), 'Original layout'); assert.equal(f.writes(), 0);
    await f.unmount(); assert.equal(f.controller.getSnapshot().lifecycle, 'active'); assert.equal(f.cell.getSnapshot().lifecycle, 'active');
    assert.equal(f.cellWrites(), 0);
  });

  await t.test('unmount leaves both adopted layout and dirty host cell available for independent explicit saves', async t => {
    const f = await fixture(t), cellDraft = '<p>Cell survives closing the layout</p>';
    await f.inputCell(cellDraft); await f.offer(layout('Adopted before close', 'grid', 'derived')); await f.click('Use proposed layout');
    await f.unmount(); assert.equal(f.container.childElementCount, 0);
    assert.equal(f.controller.getSnapshot().lifecycle, 'active'); assert.equal(f.cell.getSnapshot().lifecycle, 'active');
    assert.equal(f.controller.getSnapshot().dirty, true); assert.equal(f.cell.getSnapshot().dirty, true);
    assert.equal(f.writes(), 0); assert.equal(f.cellWrites(), 0);
    assert.equal((await f.controller.flush(f.controller.actions.selection())).kind, 'saved');
    assert.equal((await savedLayout(f)).title, 'Adopted before close'); assert.equal(f.cell.getSnapshot().dirty, true);
    const result = await f.cell.flush(f.cell.actions.selection()); assert.equal(result.kind, 'saved');
    const read = await f.client.read({ target: result.ref, revision: { kind: 'exact', value: result.ref.revision } });
    assert.equal(read.kind, 'available'); assert.deepEqual(read.snapshot.bytes, new TextEncoder().encode(cellDraft));
    assert.equal(f.writes(), 1); assert.equal(f.cellWrites(), 1);
  });
});
