import assert from 'node:assert/strict';
import test from 'node:test';
import { Window } from 'happy-dom';
import { createMarkdownController } from '@hachej/boring-ui-kit/markdown';
import { openSqliteWorkspaces } from '../../examples/shared/sqlite-workspaces.mjs';

test('mounted Markdown proposal review preserves exact text and conditional acceptance', { timeout: 30000 }, async t => {
  const window = new Window({ url: 'https://fictional.invalid/' });
  const globals = new Map();
  for (const name of ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node', 'Text', 'DOMParser', 'MutationObserver', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame']) {
    globals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    const value = name === 'window' ? window : window[name];
    Object.defineProperty(globalThis, name, { configurable: true, writable: true,
      value: typeof value === 'function' && /^[a-z]/.test(name) ? value.bind(window) : value });
  }
  globals.set('IS_REACT_ACT_ENVIRONMENT', Object.getOwnPropertyDescriptor(globalThis, 'IS_REACT_ACT_ENVIRONMENT'));
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  t.after(async () => {
    await window.happyDOM.close();
    for (const [name, descriptor] of globals) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  });
  const { act, createElement } = await import('react');
  const { createRoot } = await import('react-dom/client');
  const { MarkdownEditor } = await import('@hachej/boring-ui-kit/markdown-editor');
  let sequence = 0;

  async function fixture(t, before, { readOnly = false } = {}) {
    const id = ++sequence, providerId = `fictional-proposals-${id}`;
    const provider = openSqliteWorkspaces({ filename: ':memory:', providerId, authorize: () => true });
    const target = { resource: { providerId, path: 'notes.md' }, view: { kind: 'published' } };
    const identity = { scopeId: 'fictional-project', principalId: 'editor', initiatorId: 'alice' };
    const seeded = await provider.publication.publish({ operationId: `seed-${id}`, atomicity: 'all-or-nothing',
      changes: [{ kind: 'create', target, expected: { kind: 'absent' }, bytes: new TextEncoder().encode(before), mediaType: 'text/markdown' }] }, identity);
    assert.equal(seeded.kind, 'committed');
    const snapshot = (await provider.read({ target, revision: { kind: 'latest' } }, identity)).snapshot;
    let writes = 0;
    const client = {
      read: request => provider.read(request, identity),
      publish: request => { writes++; return provider.publication.publish(request, identity); },
      lookup: operationId => provider.reconciliation.lookup(operationId, identity),
    };
    const controller = createMarkdownController({ source: { kind: 'saved', snapshot }, identity, client,
      instanceId: `proposal-editor-${id}`, epoch: 'page', readOnly });
    const container = document.createElement('div'); document.body.append(container);
    const root = createRoot(container);
    t.after(async () => { await act(async () => root.unmount()); controller.dispose(); provider.close(); container.remove(); });
    await act(async () => root.render(createElement(MarkdownEditor, { controller, title: 'Notes' })));
    const review = () => container.querySelector('[data-boring="proposal"]');
    const button = label => {
      const found = [...container.querySelectorAll('button')].find(node => (node.getAttribute('aria-label') || node.textContent) === label);
      assert.ok(found, `Missing ${label}`);
      return found;
    };
    const click = async label => { await act(async () => button(label).click()); };
    const propose = async after => {
      assert.ok(before.length > 0, 'public text edit requires nonempty find text');
      let outcome;
      await act(async () => { outcome = controller.actions.propose(controller.actions.selection(), [{ find: before, replace: after }], 'Fictional text revision'); });
      assert.equal(outcome.kind, 'proposed');
      assert.ok(review());
      await act(async () => review().querySelector('summary').click());
      assert.equal(review().querySelector('details').open, true);
      return outcome;
    };
    const saved = async () => {
      const read = await client.read({ target, revision: { kind: 'latest' } });
      assert.equal(read.kind, 'available');
      return new TextDecoder('utf-8', { fatal: true }).decode(read.snapshot.bytes);
    };
    const settled = async () => {
      for (let attempt = 0; attempt < 100 && controller.getSnapshot().save.kind === 'pending'; attempt++)
        await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)); });
      assert.notEqual(controller.getSnapshot().save.kind, 'pending');
    };
    return { controller, container, provider, identity, review, button, click, propose, saved, settled, writes: () => writes };
  }

  function visibleRows(review) { return [...review.querySelectorAll('[data-diff="same"], [data-diff="add"], [data-diff="remove"]')]; }
  function reconstruct(rows, side) {
    return rows.filter(row => row.getAttribute('data-diff') !== (side === 'before' ? 'add' : 'remove'))
      .map(row => {
        const text = row.querySelector('[data-diff-text]');
        assert.ok(text, 'every row has an exact text span');
        const ending = row.getAttribute('data-line-ending');
        assert.ok(ending === 'lf' || ending === 'none', 'every row declares its line ending');
        return text.textContent + (ending === 'lf' ? '\n' : '');
      }).join('');
  }
  async function expandAll(review) {
    for (;;) {
      const fold = [...review.querySelectorAll('button[data-diff-fold]')].find(button => button.textContent.startsWith('Show '));
      if (!fold) return;
      assert.match(fold.textContent, /Show \d+ unchanged lines/);
      await act(async () => fold.click());
    }
  }
  async function assertExactRows(f, before, after) {
    const review = f.review();
    assert.ok(review, 'proposal review is mounted');
    await expandAll(review);
    const rows = visibleRows(review);
    assert.equal(reconstruct(rows, 'before'), before);
    assert.equal(reconstruct(rows, 'after'), after);
    assert.equal(f.writes(), 0, 'review and context expansion never publish');
    return rows;
  }

  for (const [kind, before, after] of [
    ['insert', 'alpha\ngamma\n', 'alpha\nbeta\ngamma\n'],
    ['delete', 'alpha\nbeta\ngamma\n', 'alpha\ngamma\n'],
    ['replace', 'alpha\nbeta\ngamma\n', 'alpha\nBETA\ngamma\n'],
    ['duplicate lines', 'repeat\nrepeat\nend\n', 'repeat\ninserted\nrepeat\nend\n'],
  ]) {
    await t.test(`${kind} rows reconstruct both sides`, async t => {
      const f = await fixture(t, before);
      await f.propose(after);
      const rows = await assertExactRows(f, before, after);
      assert.ok(rows.some(row => row.getAttribute('data-diff') === (kind === 'delete' ? 'remove' : 'add')));
      assert.equal(await f.saved(), before);
    });
  }

  await t.test('LF, CRLF, Unicode, missing trailing newline and an empty after side retain exact bytes', async t => {
    for (const [before, after] of [
      ['one\r\ntwo\r\n', 'one\r\nδelta\r\nlast'],
      ['line\n', 'line'],
      ['line', 'line\n'],
      ['line\r\n', 'line\n'],
      ['line\n', 'line\r\n'],
      ['line\r', 'line\r\n'],
      ['\n', ''],
      ['first\r\nsecond\nthird\r', 'first\nsecond\r\nthird\r'],
      ['🍊 café\n', '🍊 café\n新しい\n'],
      ['remove me', ''],
    ]) {
      const f = await fixture(t, before);
      await f.propose(after);
      const rows = await assertExactRows(f, before, after);
      if (after === '') assert.equal(rows.filter(row => row.getAttribute('data-diff') !== 'remove').length, 0);
      if (before === 'line\n' && after === 'line') assert.ok(rows.some(row => row.getAttribute('data-line-ending') === 'none'));
      if (before === 'line\n' && after === 'line\r\n') {
        const marker = rows.find(row => row.getAttribute('data-diff') === 'add')?.querySelector('[data-diff-crlf]');
        assert.match(marker?.textContent || '', /CRLF line ending/);
      }
    }
  });

  await t.test('markup stays literal text in review rows', async t => {
    const before = '<script>fictional()</script>\n';
    const after = '<img src=x onerror=fictional()>\n';
    const f = await fixture(t, before);
    await f.propose(after);
    await assertExactRows(f, before, after);
    assert.equal(f.review().querySelector('script,img,iframe,[onerror]'), null);
    assert.match(f.review().textContent, /<img src=x onerror=fictional\(\)>/);
  });

  await t.test('long unchanged context folds and expands without hiding changed lines', async t => {
    const prefix = Array.from({ length: 24 }, (_, index) => `before ${index}\n`).join('');
    const suffix = Array.from({ length: 24 }, (_, index) => `after ${index}\n`).join('');
    const before = `${prefix}old center\n${suffix}`, after = `${prefix}new center\n${suffix}`;
    const f = await fixture(t, before);
    await f.propose(after);
    const review = f.review(), folds = [...review.querySelectorAll('button[data-diff-fold]')];
    assert.ok(folds.length > 0, 'long unchanged run has a fold control');
    assert.ok(visibleRows(review).some(row => row.getAttribute('data-diff') === 'remove' && row.querySelector('[data-diff-text]').textContent === 'old center'));
    assert.ok(visibleRows(review).some(row => row.getAttribute('data-diff') === 'add' && row.querySelector('[data-diff-text]').textContent === 'new center'));
    await assertExactRows(f, before, after);
  });

  await t.test('large comparison shows a truthful coarse changed block', async t => {
    const before = Array.from({ length: 502 }, (_, index) => `old ${index}\n`).join('');
    const after = Array.from({ length: 502 }, (_, index) => `new ${index}\n`).join('');
    const f = await fixture(t, before);
    await f.propose(after);
    assert.match(f.review().querySelector('[data-diff-fallback]')?.textContent || '', /Detailed line alignment unavailable/);
    const rows = await assertExactRows(f, before, after);
    assert.equal(rows.filter(row => row.getAttribute('data-diff') === 'remove').length, 502);
    assert.equal(rows.filter(row => row.getAttribute('data-diff') === 'add').length, 502);
  });

  await t.test('only Accept publishes the exact after bytes and a real receipt', async t => {
    const before = 'base\n', after = 'changed\n';
    const f = await fixture(t, before);
    await f.propose(after);
    await assertExactRows(f, before, after);
    assert.equal(await f.saved(), before);
    await f.click('Accept and save');
    await f.settled();
    assert.equal(f.writes(), 1);
    assert.equal(await f.saved(), after);
    const save = f.controller.getSnapshot().save;
    assert.equal(save.kind, 'settled');
    assert.equal(save.result.kind, 'saved');
    assert.ok(save.result.receipt.changes[0].after.revision);
    assert.deepEqual(await f.provider.reconciliation.lookup(save.result.receipt.operationId, f.identity), { kind: 'committed', receipt: save.result.receipt });
  });

  await t.test('newer human text prevents stale proposal acceptance', async t => {
    const f = await fixture(t, 'base\n');
    await f.propose('proposal\n');
    await act(async () => f.controller.actions.edit('human draft\n'));
    await f.click('Accept and save');
    assert.equal(f.controller.getSnapshot().text, 'human draft\n');
    assert.equal(await f.saved(), 'base\n');
    assert.equal(f.writes(), 0);
  });

  await t.test('read-only controller refuses proposals and has no acceptance path', async t => {
    const f = await fixture(t, 'base\n', { readOnly: true });
    let result;
    await act(async () => { result = f.controller.actions.propose(f.controller.actions.selection(), [{ find: 'base', replace: 'changed' }], 'Denied'); });
    assert.equal(result.kind, 'denied');
    assert.equal(f.review(), null);
    assert.equal(f.writes(), 0);
  });
});
