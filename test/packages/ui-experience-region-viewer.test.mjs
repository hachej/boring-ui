import assert from 'node:assert/strict';
import test from 'node:test';
import { Window } from 'happy-dom';
import { openSqliteWorkspaces } from '../../examples/shared/sqlite-workspaces.mjs';

test('generated region controls with real native composition/React/SQLite in HappyDOM; no browser qualification', { timeout: 30000 }, async t => {
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
  const { composeExperienceRegion } = await import('@hachej/boring-ui-kit/experience/regions');
  const { createHtmlController } = await import('@hachej/boring-ui-kit/html');
  const encode = text => new TextEncoder().encode(text);
  let sequence = 0;
  const layout = () => ({
    format: 'boring.experience', version: 1, name: 'fictional-regions', title: 'Fictional review', source: 'fixed',
    kinds: { 'boring/stack': 1, 'boring/row': 1, 'boring/grid': 1, 'boring/generated': 1, 'boring/cell': 1, 'fictional/document': 1 }, root: 'page',
    elements: {
      page: { type: 'boring/stack', props: {}, children: ['fixed', 'region'] },
      fixed: { type: 'boring/cell', props: { ref: 'fictional/fixed' }, children: [] },
      region: { type: 'boring/generated', props: { region: 'review', candidates: ['fictional/old', 'fictional/new'], maxElements: 8, minWidth: 180, regenerate: ['request', 'phase'] }, children: ['old'] },
      old: { type: 'boring/cell', props: { ref: 'fictional/old' }, children: [] },
    },
  });
  async function fixture(t, { onRegenerate, readOnly = false, layoutRoot = 'layout_row' } = {}) {
    const provider = openSqliteWorkspaces({ filename: ':memory:', providerId: 'fictional-region-dom', authorize: () => true });
    const identity = { scopeId: 'fictional-project', principalId: 'editor', initiatorId: 'alice' };
    const target = { resource: { providerId: provider.providerId, path: 'page.json' }, view: { kind: 'published' } };
    const cellTarget = { resource: { providerId: provider.providerId, path: 'notes.html' }, view: { kind: 'published' } };
    const seed = async (target, source, mediaType) => {
      const result = await provider.publication.publish({ operationId: 'seed-' + target.resource.path, atomicity: 'all-or-nothing', changes: [{ kind: 'create', target, expected: { kind: 'absent' }, bytes: encode(source), mediaType }] }, identity);
      assert.equal(result.kind, 'committed');
      const read = await provider.read({ target, revision: { kind: 'latest' } }, identity); assert.equal(read.kind, 'available'); return read.snapshot;
    };
    let writes = 0, cellWrites = 0, requests = 0;
    const client = { read: request => provider.read(request, identity), publish: request => { writes++; return provider.publication.publish(request, identity); }, lookup: id => provider.reconciliation.lookup(id, identity) };
    const cell = createHtmlController({ identity, instanceId: `fixed-cell-${++sequence}`, epoch: 'page',
      source: { kind: 'saved', snapshot: await seed(cellTarget, '<p>Fictional fixed notes</p>\n', 'text/html') },
      client: { ...client, publish: request => { cellWrites++; return provider.publication.publish(request, identity); } },
    });
    function FixedCell() {
      const state = useSyncExternalStore(cell.subscribe, cell.getSnapshot, cell.getSnapshot);
      return h('label', null, 'Fixed notes', h('textarea', { 'aria-label': 'Fixed notes', value: state.text,
        onChange: event => cell.actions.edit(event.currentTarget.value) }));
    }
    const cells = [
      { ref: 'fictional/fixed', kind: 'fictional/document', version: 1, render: FixedCell },
      { ref: 'fictional/old', kind: 'fictional/document', version: 1, render: () => h('p', { 'data-cell': 'old' }, 'Saved default arrangement') },
      { ref: 'fictional/new', kind: 'fictional/document', version: 1, render: () => h('p', { 'data-cell': 'new' }, 'Generated review arrangement') },
    ], canView = () => true;
    const controller = createExperienceDocumentController({ identity, instanceId: `region-layout-${++sequence}`, epoch: 'page', client, cells, canView, readOnly,
      source: { kind: 'saved', snapshot: await seed(target, JSON.stringify(layout(), null, 2) + '\n', 'application/json') },
    });
    const compose = async (request, evaluate) => {
      const abort = new AbortController(); t.after(() => abort.abort());
      const snapshots = [];
      for await (const snapshot of composeExperienceRegion({ descriptor: controller.getSnapshot().descriptor, region: request.region, trigger: request.trigger,
        definition: { name: 'fictional-regions', intents: { review: 'Arrange the review document.' }, kinds: [{ kind: 'fictional/document', description: 'Review document', metadata: { role: ['review'] } }] },
        candidates: [{ ref: 'fictional/new', metadata: { role: 'review' } }], cells, canView, intent: 'review', signal: abort.signal,
        limits: { maxElements: 8, maxDepth: 4, maxEvaluations: 4 }, evaluate: evaluate ?? (async ({ questions }) => ({
          answers: Object.fromEntries(Object.entries(questions).map(([name, question]) => {
            const offered = Object.keys(question.criteria);
            return [name, { choice: name === 'root' ? layoutRoot : offered.find(key => key.startsWith('use:')) ?? offered[0] }];
          })),
        })),
      })) snapshots.push(snapshot);
      return snapshots;
    };
    const regenerate = async request => {
      requests++;
      if (onRegenerate) return onRegenerate(request, { controller, compose });
      const snapshots = await compose(request), final = snapshots.at(-1); assert.equal(final.kind, 'final');
      assert.equal(controller.actions.proposeRegion(request, final.descriptor).kind, 'proposed');
    };
    const container = document.createElement('div'); document.body.append(container); const root = createRoot(container); let mounted = true;
    const render = async () => { await act(async () => root.render(h(ExperienceDocument, { controller, cells, canView, onRegenerate: regenerate }))); };
    const unmount = async () => { if (mounted) { mounted = false; await act(async () => root.unmount()); } };
    t.after(async () => { await unmount(); controller.dispose(); cell.dispose(); provider.close(); container.remove(); });
    await render();
    const button = label => { const node = [...container.querySelectorAll('button')].find(node => node.textContent === label); assert.ok(node, `Missing control: ${label}`); return node; };
    const click = async label => { await act(async () => button(label).click()); };
    const input = async value => {
      const node = container.querySelector('textarea[aria-label="Fixed notes"]'); assert.ok(node);
      await act(async () => {
        Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set.call(node, value);
        node.dispatchEvent(new window.Event('input', { bubbles: true }));
      });
      return node;
    };
    const saved = async () => { const read = await client.read({ target, revision: { kind: 'latest' } }); assert.equal(read.kind, 'available'); return read.snapshot; };
    return { controller, cell, client, container, render, unmount, button, click, input, saved, compose, writes: () => writes, cellWrites: () => cellWrites, requests: () => requests };
  }
  async function until(predicate, message) {
    const deadline = Date.now() + 2000;
    while (!predicate()) { assert.ok(Date.now() < deadline, message); await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)); }); }
  }

  await t.test('request, adoption and Pin are separate while a focused fixed editor keeps its identity and dirty source', async t => {
    const f = await fixture(t), original = f.controller.getSnapshot().text, draft = '<p>Unsaved fixed notes</p>';
    assert.ok(f.container.querySelector('[data-cell="old"]')); assert.equal(f.requests(), 0);
    await f.render(); assert.equal(f.requests(), 0);
    const textarea = await f.input(draft);
    await f.click('Regenerate review'); await until(() => f.controller.getSnapshot().proposal !== null, 'Region request did not offer a result');
    assert.equal(f.requests(), 1); assert.equal(f.controller.getSnapshot().text, original);
    assert.ok(f.container.querySelector('[data-cell="old"]')); assert.equal(f.container.querySelector('[data-cell="new"]'), null);
    assert.equal(f.writes(), 0); assert.equal(f.cellWrites(), 0);
    textarea.focus(); textarea.setSelectionRange(3, 12);
    await f.click('Use proposed region');
    assert.equal(f.container.querySelector('textarea'), textarea); assert.equal(document.activeElement, textarea);
    assert.equal(textarea.selectionStart, 3); assert.equal(textarea.selectionEnd, 12); assert.equal(textarea.value, draft);
    assert.ok(f.container.querySelector('[data-cell="new"]')); assert.equal(f.container.querySelector('[data-cell="old"]'), null);
    assert.equal(f.container.querySelector('[data-cell="new"]').closest('[data-boring="experience-cell"]').style.minWidth, '180px');
    assert.equal(parseFloat(textarea.closest('[data-boring="experience-cell"]').style.minWidth), 0);
    assert.equal(f.cell.getSnapshot().dirty, true); assert.equal(f.cellWrites(), 0); assert.equal(f.writes(), 0);
    assert.deepEqual((await f.saved()).bytes, encode(original));
    const selected = f.controller.actions.selection(); await f.click('Pin this region');
    await until(() => f.controller.getSnapshot().save.kind === 'settled', 'Pin did not settle');
    const result = f.controller.getSnapshot().save.result; assert.equal(result.kind, 'saved'); assert.deepEqual(result.selection, selected);
    const saved = await f.saved(); assert.deepEqual(saved.ref, result.ref); assert.deepEqual(saved.bytes, encode(f.controller.getSnapshot().text));
    assert.equal(JSON.parse(new TextDecoder().decode(saved.bytes)).source, 'fixed');
    assert.deepEqual(await f.client.lookup(result.receipt.operationId), { kind: 'committed', receipt: result.receipt });
    assert.equal(f.container.querySelector('textarea'), textarea); assert.equal(f.cell.getSnapshot().text, draft);
    assert.equal(f.writes(), 1); assert.equal(f.cellWrites(), 0);
  });

  await t.test('a phase result stays offered until explicit adoption and dismissing it keeps the default', async t => {
    const f = await fixture(t), before = f.controller.getSnapshot().text;
    let request;
    await act(async () => { request = f.controller.actions.beginRegion(f.controller.actions.selection(), 'review', 'phase'); });
    assert.equal(request.kind, 'applied');
    const snapshots = await f.compose(request.value), final = snapshots.at(-1); assert.equal(final.kind, 'final');
    await act(async () => { assert.equal(f.controller.actions.proposeRegion(request.value, final.descriptor).kind, 'proposed'); });
    assert.equal(f.requests(), 0); assert.ok(f.container.querySelector('[data-cell="old"]'));
    assert.equal(f.container.querySelector('[data-cell="new"]'), null);
    await f.click('Dismiss proposed region'); assert.equal(f.controller.getSnapshot().proposal, null);
    assert.equal(f.controller.getSnapshot().text, before); assert.ok(f.container.querySelector('[data-cell="old"]')); assert.equal(f.writes(), 0);
  });

  await t.test('a generated grid applies the region minimum width to its tracks and cells', async t => {
    const f = await fixture(t, { layoutRoot: 'layout_grid' });
    await f.click('Regenerate review'); await until(() => f.controller.getSnapshot().proposal !== null, 'No generated grid offer');
    await f.click('Use proposed region');
    const grid = f.container.querySelector('[data-boring="experience-region"] [data-boring="experience-grid"]'); assert.ok(grid);
    assert.match(grid.style.gridTemplateColumns, /minmax\(180px,\s*1fr\)/);
    assert.equal(grid.querySelector('[data-boring="experience-cell"]').style.minWidth, '180px'); assert.equal(f.writes(), 0);
  });

  await t.test('failed host regeneration keeps the saved default and fixed editor mounted', async t => {
    const f = await fixture(t, { onRegenerate: async () => { throw new Error('Fictional regeneration failure'); } });
    const textarea = await f.input('<p>Retained despite failure</p>'), before = f.controller.getSnapshot().text;
    await f.click('Regenerate review'); await until(() => f.container.querySelector('[role="alert"]'), 'Host failure was not reported');
    assert.equal(f.requests(), 1); assert.equal(f.controller.getSnapshot().proposal, null); assert.equal(f.controller.getSnapshot().text, before);
    assert.equal(f.container.querySelector('textarea'), textarea); assert.equal(textarea.value, '<p>Retained despite failure</p>');
    assert.ok(f.container.querySelector('[data-cell="old"]')); assert.equal(f.writes(), 0); assert.equal(f.cellWrites(), 0);
  });

  await t.test('a second request at the same base keeps its offer when the older host callback finishes last', async t => {
    const calls = [];
    const f = await fixture(t, { onRegenerate: async (request, { controller, compose }) => {
      const release = Promise.withResolvers(), done = Promise.withResolvers(), call = { request, release, done };
      calls.push(call); await release.promise;
      try {
        const snapshots = await compose(request), final = snapshots.at(-1); assert.equal(final.kind, 'final');
        call.result = controller.actions.proposeRegion(request, final.descriptor);
      } finally { done.resolve(); }
    } });
    t.after(() => { for (const call of calls) call.release.resolve(); });
    await f.click('Regenerate review'); await f.click('Regenerate review');
    assert.equal(calls.length, 2); assert.deepEqual(calls[0].request.base, calls[1].request.base);
    await act(async () => { calls[1].release.resolve(); await calls[1].done.promise; });
    assert.equal(calls[1].result.kind, 'proposed'); const current = f.controller.getSnapshot().proposal.id;
    await act(async () => { calls[0].release.resolve(); await calls[0].done.promise; });
    assert.equal(calls[0].result.kind, 'stale'); assert.equal(f.controller.getSnapshot().proposal.id, current);
    assert.ok(f.container.querySelector('[data-cell="old"]')); assert.equal(f.writes(), 0);
    await f.click('Use proposed region'); assert.ok(f.container.querySelector('[data-cell="new"]')); assert.equal(f.writes(), 0);
  });

  await t.test('read-only request controls cannot call the host or publish a region', async t => {
    const f = await fixture(t, { readOnly: true });
    assert.equal(f.button('Regenerate review').disabled, true); await f.click('Regenerate review');
    assert.equal(f.requests(), 0); assert.equal(f.controller.getSnapshot().proposal, null); assert.equal(f.writes(), 0);
    assert.ok(f.container.querySelector('[data-cell="old"]')); assert.equal(f.cell.getSnapshot().lifecycle, 'active');
  });

  await t.test('closing an adopted region leaves both borrowed controllers usable and never saves fixed cell edits implicitly', async t => {
    const f = await fixture(t), draft = '<p>Fixed host notes survive closing</p>'; await f.input(draft);
    await f.click('Regenerate review'); await until(() => f.controller.getSnapshot().proposal !== null, 'No region offer');
    await f.click('Use proposed region'); const selected = f.controller.actions.selection(); await f.unmount();
    assert.equal(f.container.childElementCount, 0); assert.equal(f.controller.getSnapshot().lifecycle, 'active'); assert.equal(f.cell.getSnapshot().lifecycle, 'active');
    assert.equal(f.writes(), 0); assert.equal(f.cellWrites(), 0); assert.equal(f.cell.getSnapshot().dirty, true);
    assert.equal((await f.controller.actions.pin(selected)).kind, 'saved'); assert.equal(f.cell.getSnapshot().dirty, true);
    const result = await f.cell.flush(f.cell.actions.selection()); assert.equal(result.kind, 'saved');
    const read = await f.client.read({ target: result.ref, revision: { kind: 'exact', value: result.ref.revision } });
    assert.equal(read.kind, 'available'); assert.deepEqual(read.snapshot.bytes, encode(draft)); assert.equal(f.writes(), 1); assert.equal(f.cellWrites(), 1);
  });
});
