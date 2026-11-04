import assert from 'node:assert/strict';
import test from 'node:test';
import { Window } from 'happy-dom';
import { createMarkdownController } from '@hachej/boring-ui-kit/markdown';
import { openSqliteWorkspaces } from '../../shared/sqlite-workspaces.mjs';

// Two mounted editors over two real controllers on one provider stand in for two browser tabs of one note.
test('Markdown editor conflicts, revision receipt, cross-tab refresh and size limit (DOM environment, not browser qualification)', async t => {
  const window = new Window({ url: 'https://fictional.invalid/' });
  const globals = new Map();
  for (const name of ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node', 'Text', 'DOMParser', 'MutationObserver', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame']) {
    globals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value: name === 'window' ? window : typeof window[name] === 'function' && /^[a-z]/.test(name) ? window[name].bind(window) : window[name] });
  }
  globals.set('IS_REACT_ACT_ENVIRONMENT', Object.getOwnPropertyDescriptor(globalThis, 'IS_REACT_ACT_ENVIRONMENT'));
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const { createElement, act } = await import('react');
  const { createRoot } = await import('react-dom/client');
  const { MarkdownEditor, checkMarkdownRichSafety } = await import('@hachej/boring-ui-kit/markdown-editor');
  t.after(async () => {
    await window.happyDOM.close();
    for (const [name, descriptor] of globals) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  });

  const identity = { scopeId: 'fictional-project', principalId: 'editor', initiatorId: 'alice' };
  const encode = text => new TextEncoder().encode(text);
  let sequence = 0;
  const wait = (ms = 20) => act(async () => { await new Promise(resolve => setTimeout(resolve, ms)); });
  const until = async (condition, label, attempts = 1000) => {
    for (let attempt = 0; attempt < attempts && !condition(); attempt++) await wait(10);
    assert.ok(condition(), `timed out: ${label}`);
  };

  async function note(t, initial) {
    const id = ++sequence;
    const provider = openSqliteWorkspaces({ filename: ':memory:', providerId: 'fictional-documents', authorize: () => true });
    const target = { resource: { providerId: 'fictional-documents', path: `note-${id}.md` }, view: { kind: 'published' } };
    let writes = 0, reads = 0, external = 0;
    let beforePublish;
    const client = {
      read: request => { reads++; return provider.read(request, identity); },
      publish: async request => {
        writes++;
        if (beforePublish) { const run = beforePublish; beforePublish = undefined; await run(); }
        return provider.publication.publish(request, identity);
      },
      lookup: operationId => provider.reconciliation.lookup(operationId, identity),
    };
    await provider.publication.publish({ operationId: `seed-${id}`, atomicity: 'all-or-nothing', changes: [{ kind: 'create', target, expected: { kind: 'absent' }, bytes: encode(initial), mediaType: 'text/markdown' }] }, identity);
    const latest = async () => (await provider.read({ target, revision: { kind: 'latest' } }, identity)).snapshot;
    const saved = async () => new TextDecoder().decode((await latest()).bytes);
    /** A writer outside the editors: another device, an agent. */
    const writeElsewhere = async text => {
      const ref = (await latest()).ref;
      const result = await provider.publication.publish({ operationId: `external-${id}-${++external}`, atomicity: 'all-or-nothing', changes: [{ kind: 'replace', target: ref, bytes: encode(text), mediaType: 'text/markdown' }] }, identity);
      assert.equal(result.kind, 'committed');
      return result.receipt.changes[0].after.revision;
    };
    const deleteElsewhere = async () => {
      const result = await provider.publication.publish({ operationId: `external-${id}-${++external}`, atomicity: 'all-or-nothing', changes: [{ kind: 'delete', target: (await latest()).ref }] }, identity);
      assert.equal(result.kind, 'committed');
    };
    const tabs = [];
    const openTab = async (props = {}) => {
      const controller = createMarkdownController({ source: { kind: 'saved', snapshot: await latest() }, identity, client, instanceId: `tab-${id}-${tabs.length}`, epoch: 'page' });
      const container = document.createElement('div'); document.body.append(container);
      const root = createRoot(container);
      const render = async next => { await act(async () => { root.render(createElement(MarkdownEditor, { controller, title: 'Notes', autosave: false, initialMode: 'source', ...next })); }); };
      await render(props);
      const buttons = () => [...container.querySelectorAll('button,input[type=radio],summary')];
      const button = label => { const found = buttons().find(node => (node.getAttribute('aria-label') || node.textContent) === label); assert.ok(found, `control "${label}"`); return found; };
      const click = async label => { await act(async () => { button(label).click(); }); };
      const input = async value => {
        const textarea = container.querySelector('textarea'); assert.ok(textarea, 'source box');
        await act(async () => {
          Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set.call(textarea, value);
          textarea.dispatchEvent(new window.Event('input', { bubbles: true }));
        });
      };
      const settled = () => until(() => controller.getSnapshot().save.kind !== 'pending', 'publication settles');
      const save = async () => { await click(props.locale === 'fr' ? 'Enregistrer' : 'Save'); await settled(); };
      const strip = () => container.querySelector('[data-boring="conflict-choices"]');
      const receipt = () => container.querySelector('[data-testid="markdown-save-receipt"]');
      const text = () => controller.getSnapshot().text;
      const unmount = () => act(async () => root.unmount());
      const tab = { controller, container, render, unmount, button, buttons, click, input, save, settled, strip, receipt, text, revision: () => controller.getSnapshot().base.target.revision };
      tabs.push(tab);
      t.after(async () => { await act(async () => root.unmount()); controller.dispose(); container.remove(); });
      return tab;
    };
    t.after(() => provider.close());
    return { openTab, saved, latest, writeElsewhere, deleteElsewhere, writes: () => writes, reads: () => reads, beforeNextPublish: run => { beforePublish = run; } };
  }

  /** A tab whose save was just refused because someone else wrote first. */
  async function conflicted(t, options = {}) {
    const n = await note(t, 'original\n');
    const tab = await n.openTab(options.props);
    const remoteRevision = await n.writeElsewhere('remote\n');
    await tab.input('local\n');
    await tab.save();
    assert.equal(tab.controller.getSnapshot().save.result?.kind, 'conflict');
    return { n, tab, remoteRevision };
  }

  /** Nothing the reader could not undo happened: same text, same base, same buffer. */
  const frozen = tab => { const { text, base, bufferVersion, dirty, remote } = tab.controller.getSnapshot(); return JSON.stringify({ text, base, bufferVersion, dirty, remote }); };

  await t.test('a conflict result shows the ConflictChoices strip with exactly the three actions', async t => {
    const { tab } = await conflicted(t);
    assert.ok(tab.strip(), 'the strip is drawn');
    const names = [...tab.strip().querySelectorAll('button')].map(node => node.textContent);
    assert.deepEqual(names, ['Keep mine', 'Take theirs', 'Review diff']);
    assert.equal(tab.container.querySelector('[role="status"]').textContent, 'Changed elsewhere');
    assert.equal(tab.text(), 'local\n', 'the local text is kept');
  });

  await t.test('no conflict, no strip', async t => {
    const n = await note(t, 'original\n');
    const tab = await n.openTab();
    assert.equal(tab.strip() === null, true);
    await tab.input('edited\n'); await tab.save();
    assert.equal(tab.strip() === null, true);
  });

  await t.test('Keep mine rebases onto the new revision and saves the local text', async t => {
    const { n, tab, remoteRevision } = await conflicted(t);
    const results = [];
    await tab.render({ onSaveResult: result => results.push(result) });
    await tab.click('Keep mine');
    await until(() => tab.controller.getSnapshot().save.result?.kind === 'saved', 'keep mine saves');
    assert.equal(await n.saved(), 'local\n');
    const result = tab.controller.getSnapshot().save.result;
    assert.equal(result.receipt.changes[0].before.revision, remoteRevision, 'the write replaced the revision the person saw');
    assert.equal(tab.controller.getSnapshot().dirty, false);
    assert.equal(tab.controller.getSnapshot().remote, null);
    assert.equal(tab.strip() === null, true, 'the strip closes');
    assert.equal(tab.container.querySelector('[role="status"]').textContent, 'Saved');
    assert.equal(results.at(-1)?.kind, 'saved', 'the host hears about the save');
  });

  await t.test('Keep mine after the remote moved again is a new conflict, never an overwrite', async t => {
    const { n, tab } = await conflicted(t);
    const seen = tab.controller.getSnapshot().base.target.revision;
    const moved = await n.writeElsewhere('remote again\n');
    const writes = n.writes();
    await tab.click('Keep mine');
    await until(() => tab.controller.getSnapshot().remote?.target.revision === moved, 'the new revision is noticed');
    assert.equal(n.writes(), writes, 'nothing was published');
    assert.equal(await n.saved(), 'remote again\n', 'the other write survives');
    assert.equal(tab.text(), 'local\n', 'the local text survives');
    assert.equal(tab.controller.getSnapshot().base.target.revision, seen, 'the base did not move');
    assert.ok(tab.strip(), 'the strip stays');
    assert.ok(tab.container.textContent.includes('The saved document changed again. Nothing was saved.'), 'the person is told');
    // The second click is a decision about the revision now known.
    await tab.click('Keep mine');
    await until(() => tab.controller.getSnapshot().save.result?.kind === 'saved', 'the second click saves');
    assert.equal(await n.saved(), 'local\n');
    assert.equal(tab.controller.getSnapshot().save.result.receipt.changes[0].before.revision, moved);
  });

  await t.test('a write landing between the Keep mine read and its publish is refused by the conditional write', async t => {
    const { n, tab } = await conflicted(t);
    n.beforeNextPublish(() => n.writeElsewhere('late remote\n'));
    await tab.click('Keep mine');
    await until(() => tab.controller.getSnapshot().save.result?.kind === 'conflict' && n.writes() > 1, 'the conditional write refuses');
    assert.equal(await n.saved(), 'late remote\n', 'never an overwrite');
    assert.equal(tab.text(), 'local\n');
    assert.ok(tab.strip(), 'a new conflict');
  });

  await t.test('Keep mine under autosave writes once and autosave resumes', async t => {
    const n = await note(t, 'original\n');
    const tab = await n.openTab({ autosave: { delayMs: 30 } });
    await n.writeElsewhere('remote\n');
    await tab.input('local\n');
    await until(() => tab.controller.getSnapshot().save.result?.kind === 'conflict', 'autosave is refused');
    await wait(80);
    assert.equal(n.writes(), 1, 'the refusal pauses autosave');
    await tab.click('Keep mine');
    await until(() => tab.controller.getSnapshot().save.result?.kind === 'saved', 'keep mine saves');
    await wait(80);
    assert.equal(n.writes(), 2, 'one write, no competing autosave');
    assert.equal(await n.saved(), 'local\n');
    await tab.input('later\n');
    await until(() => tab.controller.getSnapshot().save.kind === 'settled' && !tab.controller.getSnapshot().dirty, 'autosave resumes');
    assert.equal(await n.saved(), 'later\n');
  });

  await t.test('Take theirs discards local changes and loads the remote content', async t => {
    const { n, tab, remoteRevision } = await conflicted(t);
    const writes = n.writes();
    await tab.click('Take theirs');
    await until(() => tab.text() === 'remote\n', 'the remote text loads');
    assert.equal(tab.container.querySelector('textarea').value, 'remote\n');
    assert.equal(tab.revision(), remoteRevision);
    assert.equal(tab.controller.getSnapshot().dirty, false);
    assert.equal(tab.strip() === null, true);
    assert.equal(n.writes(), writes, 'nothing was published');
    assert.equal(await n.saved(), 'remote\n');
  });

  await t.test('Review diff shows both sides without changing anything', async t => {
    const { n, tab } = await conflicted(t);
    const before = frozen(tab), writes = n.writes();
    const diff = () => tab.container.querySelector('[data-boring="conflict-choices"] [data-boring="proposal-diff"]');
    assert.equal(diff() === null, true, 'closed until asked for');
    await tab.click('Review diff');
    await until(() => diff() !== null, 'the diff opens');
    assert.deepEqual([...diff().querySelectorAll('[data-diff="remove"] [data-diff-text]')].map(node => node.textContent), ['remote'], 'what the saved version has');
    assert.deepEqual([...diff().querySelectorAll('[data-diff="add"] [data-diff-text]')].map(node => node.textContent), ['local'], 'what my text has');
    assert.equal(diff().getAttribute('aria-label'), 'Differences between the saved version and your text');
    assert.equal(frozen(tab), before, 'text, base and buffer are untouched');
    assert.equal(n.writes(), writes, 'nothing was published');
    assert.equal(await n.saved(), 'remote\n');
    assert.equal(tab.button('Review diff').getAttribute('aria-expanded'), 'true');
    await tab.click('Review diff');
    assert.equal(diff() === null, true, 'the second click closes it');
    assert.equal(frozen(tab), before);
    // The choices still work afterwards.
    await tab.click('Keep mine');
    await until(() => tab.controller.getSnapshot().save.result?.kind === 'saved', 'keep mine saves');
    assert.equal(await n.saved(), 'local\n');
  });

  await t.test('a remote that was deleted can only be recreated on purpose', async t => {
    const n = await note(t, 'original\n');
    const tab = await n.openTab();
    await n.deleteElsewhere();
    await tab.input('local\n');
    await tab.save();
    assert.equal(tab.controller.getSnapshot().save.result?.kind, 'conflict');
    assert.ok(tab.strip(), 'the strip is drawn');
    await tab.click('Keep mine');
    await until(() => tab.controller.getSnapshot().remote?.kind === 'absent', 'the deletion is noticed');
    assert.equal(n.writes(), 1, 'the first click only finds out');
    assert.ok(tab.strip().textContent.includes('The saved document was deleted. Keep mine creates it again.'));
    assert.equal(tab.button('Take theirs').disabled, true, 'there is nothing to take');
    assert.equal(tab.text(), 'local\n');
    await tab.click('Keep mine');
    await until(() => tab.controller.getSnapshot().save.result?.kind === 'saved', 'the second click recreates it');
    assert.equal(await n.saved(), 'local\n');
    assert.equal(tab.strip() === null, true);
  });

  await t.test('the strip and its messages follow the locale and the labels', async t => {
    const { tab } = await conflicted(t, { props: { locale: 'fr' } });
    assert.deepEqual([...tab.strip().querySelectorAll('button')].map(node => node.textContent), ['Garder la mienne', 'Prendre la leur', 'Voir les différences']);
    assert.ok(tab.strip().textContent.includes('Le document enregistré a changé. Votre texte local a été conservé.'));
    await tab.click('Voir les différences');
    await until(() => tab.strip().querySelector('[data-boring="proposal-diff"]') !== null, 'the diff opens');
    assert.equal(tab.strip().querySelector('[data-boring="proposal-diff"]').getAttribute('aria-label'), 'Différences entre la version enregistrée et votre texte');
    const overridden = await conflicted(t, { props: { labels: { keepMine: 'Mine', takeTheirs: 'Theirs', reviewDiff: 'Compare' } } });
    assert.deepEqual([...overridden.tab.strip().querySelectorAll('button')].map(node => node.textContent), ['Mine', 'Theirs', 'Compare']);
    const moved = await conflicted(t, { props: { locale: 'fr' } });
    await moved.n.writeElsewhere('encore\n');
    await moved.tab.click('Garder la mienne');
    await until(() => moved.tab.container.textContent.includes('Le document enregistré a encore changé. Rien n’a été enregistré.'), 'French moved-again notice');
  });

  await t.test('the saved revision receipt appears after a save and updates on each save', async t => {
    const n = await note(t, 'original\n');
    const tab = await n.openTab();
    assert.equal(tab.receipt() === null, true, 'no receipt before a save');
    await tab.input('first\n'); await tab.save();
    const first = tab.revision();
    assert.equal(tab.receipt()?.dataset.revision, first);
    assert.ok(tab.receipt().textContent.includes(first.slice(0, 8)), 'the receipt names the revision');
    await tab.input('second\n'); await tab.save();
    const second = tab.revision();
    assert.notEqual(second, first);
    assert.equal(tab.receipt()?.dataset.revision, second, 'it follows each save');
    assert.ok(tab.receipt().textContent.startsWith('Saved revision'));
    const french = await n.openTab({ locale: 'fr' });
    await french.input('troisième\n'); await french.save();
    assert.ok(french.receipt()?.textContent.startsWith('Révision enregistrée'));
    const bare = await n.openTab({ header: false });
    await bare.input('fourth\n');
    await act(async () => { await bare.controller.flush(bare.controller.actions.selection()); });
    assert.equal(bare.receipt()?.dataset.revision, bare.revision(), 'a host bar without the built-in header still gets it');
  });

  await t.test('the receipt stays through the next save instead of flickering, and leaves on a refresh', async t => {
    const n = await note(t, 'original\n');
    const tab = await n.openTab({ crossTabRefresh: false });
    await tab.input('first\n'); await tab.save();
    let release;
    n.beforeNextPublish(() => new Promise(resolve => { release = resolve; }));
    await tab.input('second\n');
    await tab.click('Save');
    await until(() => release !== undefined, 'the next save is in flight');
    assert.ok(tab.receipt(), 'still there while saving');
    release(); await tab.settled();
    assert.equal(tab.receipt()?.dataset.revision, tab.revision());
    await n.writeElsewhere('third\n');
    await act(async () => { await tab.controller.actions.refresh(); });
    assert.equal(tab.text(), 'third\n');
    assert.equal(tab.receipt() === null, true, 'the receipt is about this tab’s own save');
  });

  await t.test('a save in tab A refreshes a clean tab B through the existing path, once, with no text on the wire', async t => {
    const Native = globalThis.BroadcastChannel;
    assert.equal(typeof Native, 'function', 'this runtime has BroadcastChannel');
    const posted = [];
    globalThis.BroadcastChannel = class extends Native { postMessage(message) { posted.push(message); super.postMessage(message); } };
    t.after(() => { globalThis.BroadcastChannel = Native; });
    const n = await note(t, 'original\n');
    const a = await n.openTab(), b = await n.openTab();
    await a.input('from a secret words\n'); await a.save();
    await until(() => b.text() === 'from a secret words\n', 'tab B refreshes');
    assert.equal(b.revision(), a.revision(), 'to the new revision');
    assert.equal(b.controller.getSnapshot().dirty, false);
    assert.equal(b.container.querySelector('textarea').value, 'from a secret words\n');
    assert.equal(b.strip() === null, true);
    await wait(60);
    assert.equal(posted.length, 1, 'a refresh never pokes back');
    assert.deepEqual(Object.keys(posted[0]), ['revision']);
    assert.equal(posted[0].revision, a.revision());
    assert.equal(JSON.stringify(posted).includes('secret'), false, 'no document text');
    assert.equal(n.writes(), 1, 'tab B wrote nothing');
    await a.input('again\n'); await a.save();
    await until(() => b.text() === 'again\n', 'each save pokes');
    await wait(60);
    assert.equal(posted.length, 2);
    assert.equal(n.writes(), 2);
  });

  await t.test('a poke at the revision a tab already has does not even read, and garbage is ignored', async t => {
    const Native = globalThis.BroadcastChannel;
    const names = [];
    globalThis.BroadcastChannel = class extends Native { constructor(name) { super(name); names.push(name); } };
    t.after(() => { globalThis.BroadcastChannel = Native; });
    const n = await note(t, 'original\n');
    const a = await n.openTab(), b = await n.openTab();
    await a.input('one\n'); await a.save();
    await until(() => b.text() === 'one\n', 'tab B refreshes');
    await wait(30);
    const reads = n.reads();
    assert.equal(new Set(names).size, 1, 'both tabs of one note share one channel');
    assert.equal(names[0].includes('one'), false);
    const late = new Native(names[0]);
    t.after(() => late.close());
    late.postMessage({ revision: b.revision() });
    await wait(40);
    assert.equal(n.reads(), reads);
    for (const junk of [null, 'text', { revision: 7 }, {}]) late.postMessage(junk);
    await wait(40);
    assert.equal(n.reads(), reads);
    assert.equal(b.text(), 'one\n');
  });

  await t.test('notes do not poke each other', async t => {
    const first = await note(t, 'original\n'), second = await note(t, 'other\n');
    const a = await first.openTab(); await second.openTab();
    const reads = second.reads();
    await a.input('from a\n'); await a.save();
    await wait(40);
    assert.equal(second.reads(), reads);
  });

  await t.test('a tab with unsaved edits gets the conflict flow, not an overwrite', async t => {
    const n = await note(t, 'original\n');
    const a = await n.openTab(), b = await n.openTab();
    await b.input('unsaved in b\n');
    const writes = n.writes();
    await a.input('from a\n'); await a.save();
    await until(() => b.strip() !== null, 'tab B shows the conflict flow');
    assert.equal(b.text(), 'unsaved in b\n');
    assert.equal(b.controller.getSnapshot().dirty, true);
    assert.equal(b.controller.getSnapshot().remote?.target.revision, a.revision());
    assert.equal(b.container.querySelector('[role="status"]').textContent, 'Changed elsewhere');
    assert.equal(n.writes(), writes + 1, 'only tab A wrote');
    assert.equal(await n.saved(), 'from a\n');
    await b.click('Keep mine');
    await until(() => b.controller.getSnapshot().save.result?.kind === 'saved', 'tab B keeps its text on purpose');
    await until(() => a.text() === 'unsaved in b\n', 'and tab A follows');
    assert.equal(a.strip() === null, true);
  });

  await t.test('autosave never fires after the poke raised a conflict', async t => {
    const n = await note(t, 'original\n');
    const a = await n.openTab({ crossTabRefresh: true }), b = await n.openTab({ autosave: { delayMs: 150 } });
    await b.input('unsaved in b\n');
    await a.input('from a\n'); await a.save();
    await until(() => b.strip() !== null, 'the poke arrives inside the autosave delay');
    await wait(250);
    assert.equal(n.writes(), 1, 'tab B did not try to write');
    assert.equal(b.text(), 'unsaved in b\n');
  });

  await t.test('without BroadcastChannel the editor behaves as before, with no errors', async t => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'BroadcastChannel');
    const faults = [];
    const onFault = error => faults.push(error);
    process.on('unhandledRejection', onFault); process.on('uncaughtException', onFault);
    t.after(() => { Object.defineProperty(globalThis, 'BroadcastChannel', descriptor); process.off('unhandledRejection', onFault); process.off('uncaughtException', onFault); });
    delete globalThis.BroadcastChannel;
    assert.equal(typeof globalThis.BroadcastChannel, 'undefined');
    const n = await note(t, 'original\n');
    const a = await n.openTab(), b = await n.openTab();
    await a.input('from a\n'); await a.save();
    assert.equal(a.controller.getSnapshot().save.result.kind, 'saved');
    await wait(40);
    assert.equal(b.text(), 'original\n', 'no refresh without the channel');
    await b.input('from b\n'); await b.save();
    assert.equal(b.controller.getSnapshot().save.result.kind, 'conflict', 'the conditional write still protects the note');
    assert.equal(await n.saved(), 'from a\n');

    for (const Broken of [
      class { constructor() { throw new Error('SecurityError'); } },
      class { addEventListener() {} removeEventListener() {} close() { throw new Error('close failed'); } postMessage() { throw new Error('DataCloneError'); } },
    ]) {
      Object.defineProperty(globalThis, 'BroadcastChannel', { configurable: true, writable: true, value: Broken });
      const broken = await note(t, 'original\n');
      const tab = await broken.openTab();
      await tab.input('kept\n'); await tab.save();
      assert.equal(tab.controller.getSnapshot().save.result.kind, 'saved', Broken.name);
      assert.equal(await broken.saved(), 'kept\n');
    }
    await wait(20);
    assert.deepEqual(faults.map(String), []);
  });

  await t.test('with the poke disabled the tabs do not talk', async t => {
    const Native = globalThis.BroadcastChannel;
    let opened = 0;
    globalThis.BroadcastChannel = class extends Native { constructor(name) { super(name); opened++; } };
    t.after(() => { globalThis.BroadcastChannel = Native; });
    const n = await note(t, 'original\n');
    const a = await n.openTab({ crossTabRefresh: false }), b = await n.openTab({ crossTabRefresh: false });
    assert.equal(opened, 0, 'no channel is opened');
    const reads = n.reads();
    await a.input('from a\n'); await a.save();
    await wait(40);
    assert.equal(b.text(), 'original\n');
    assert.equal(n.reads(), reads);
    await b.input('from b\n'); await b.save();
    assert.equal(b.controller.getSnapshot().save.result.kind, 'conflict');
    assert.ok(b.strip(), 'the conflict flow is the same');
  });

  await t.test('a failing read on a poke stays quiet, and a closed tab stops listening', async t => {
    const faults = [];
    const onFault = error => faults.push(error);
    process.on('unhandledRejection', onFault);
    t.after(() => process.off('unhandledRejection', onFault));
    const n = await note(t, 'original\n');
    const a = await n.openTab(), b = await n.openTab();
    const offline = createMarkdownController({ source: { kind: 'saved', snapshot: await n.latest() }, identity, instanceId: 'offline', epoch: 'page', client: { read: async () => { throw new Error('offline'); }, publish: async () => ({ kind: 'unavailable', reason: 'offline' }) } });
    const container = document.createElement('div'); document.body.append(container);
    const root = createRoot(container);
    await act(async () => { root.render(createElement(MarkdownEditor, { controller: offline, title: 'Offline', autosave: false, initialMode: 'source' })); });
    t.after(async () => { await act(async () => root.unmount()); offline.dispose(); container.remove(); });
    await a.input('from a\n'); await a.save();
    await until(() => b.text() === 'from a\n', 'tab B refreshes');
    await wait(30);
    assert.deepEqual(faults.map(String), []);
    assert.equal(offline.getSnapshot().text, 'original\n');
    await b.unmount();
    const reads = n.reads();
    await a.input('again\n'); await a.save();
    await wait(40);
    assert.equal(n.reads(), reads, 'nobody is left to read');
  });

  await t.test('a note over the size limit opens in source mode and cannot switch to rich mode', async t => {
    const seen = [];
    const n = await note(t, `# Fictional\n\n${'lorem ipsum '.repeat(200)}\n`);
    const tab = await n.openTab({ initialMode: 'rich', richSizeLimit: 1024, onRichSafety: safety => seen.push(safety) });
    const section = tab.container.querySelector('section');
    assert.equal(section.dataset.mode, 'source');
    const notice = tab.container.querySelector('[data-testid="markdown-source-only"]');
    assert.ok(notice?.textContent.includes('too large'), 'a visible reason');
    assert.equal(seen.at(-1)?.safe, false);
    await tab.click('More actions');
    assert.equal(tab.button('Formatted').disabled, true);
    await tab.click('Formatted');
    assert.equal(section.dataset.mode, 'source', 'the switch does nothing');
    assert.equal(tab.controller.getSnapshot().dirty, false, 'opening it changes nothing');
    await tab.input(`${tab.text()}more\n`); await tab.save();
    assert.equal(tab.controller.getSnapshot().save.result.kind, 'saved', 'it still saves');
  });

  await t.test('the limit counts bytes, and a note under it is unchanged', async t => {
    const n = await note(t, '# Fictional\n\nA short note.\n');
    const small = await n.openTab({ initialMode: 'rich', richSizeLimit: 1024 });
    assert.equal(small.container.querySelector('section').dataset.mode, 'rich');
    assert.equal(small.container.querySelector('[data-testid="markdown-source-only"]') === null, true);
    await small.click('More actions');
    assert.equal(small.button('Formatted').disabled, false);
    const multibyte = await note(t, 'é'.repeat(600));
    const wide = await multibyte.openTab({ initialMode: 'rich', richSizeLimit: 1024 });
    assert.equal(wide.container.querySelector('section').dataset.mode, 'source', '600 characters, 1200 bytes');
    const exact = await note(t, 'x'.repeat(1024));
    assert.equal((await exact.openTab({ initialMode: 'rich', richSizeLimit: 1024 })).container.querySelector('section').dataset.mode, 'rich', 'at the limit is under it');
    const verdict = checkMarkdownRichSafety('x'.repeat(2048), { maxBytes: 1024 });
    assert.equal(verdict.safe, false);
    assert.equal(checkMarkdownRichSafety('x'.repeat(1024), { maxBytes: 1024 }).safe, true);
    assert.equal(checkMarkdownRichSafety('x'.repeat(1_100_000)).safe, false, 'the default limit needs no option');
  });

  await t.test('a note edited back under the limit can go rich, with the current text', async t => {
    const n = await note(t, 'y'.repeat(2048));
    const tab = await n.openTab({ initialMode: 'rich', richSizeLimit: 1024 });
    assert.equal(tab.container.querySelector('section').dataset.mode, 'source');
    await tab.input('# Short now\n');
    await until(() => tab.container.querySelector('section').dataset.mode === 'rich', 'rich comes back');
    assert.ok(tab.container.querySelector('[contenteditable]')?.textContent.includes('Short now'));
  });

  await t.test('the size notice is translated', async t => {
    const n = await note(t, 'z'.repeat(2048));
    const tab = await n.openTab({ locale: 'fr', richSizeLimit: 1024 });
    assert.ok(tab.container.querySelector('[data-testid="markdown-source-only"]')?.textContent.includes('trop volumineux'));
  });

  await t.test('a fictional 1 MB note across two tabs: save, refresh, and all three conflict choices', async t => {
    const line = index => `Line ${index} of a fictional cedar forest survey, with nothing true in it.\n`;
    let big = '# Fictional survey\n\n';
    for (let index = 0; big.length < 1_048_576; index++) big += line(index);
    assert.ok(encode(big).byteLength >= 1_000_000);
    const n = await note(t, big);
    const a = await n.openTab({ initialMode: 'rich' }), b = await n.openTab({ initialMode: 'rich' });
    assert.equal(a.container.querySelector('section').dataset.mode, 'source', 'a note this size opens as source');
    assert.equal(b.container.querySelector('section').dataset.mode, 'source');
    assert.ok(a.container.querySelector('[data-testid="markdown-source-only"]'));

    // Save in one tab, refresh in the other.
    let current = `${big}A from tab A.\n`;
    await a.input(current); await a.save();
    assert.equal(a.receipt()?.dataset.revision, a.revision());
    await until(() => b.text() === current, 'tab B refreshes the whole note');
    assert.equal(b.revision(), a.revision());

    const conflict = async (mine, theirs) => {
      await b.input(mine);
      await a.input(theirs); await a.save();
      await until(() => b.strip() !== null, 'tab B shows the choices');
      assert.equal(b.text() === mine, true, 'tab B keeps its text');
      assert.equal((await n.saved()) === theirs, true, 'tab A’s save stands');
    };

    // Keep mine.
    const keepMine = `${current}B keeps this.\n`, keepTheirs = `${current}A wrote this first.\n`;
    await conflict(keepMine, keepTheirs);
    await b.click('Keep mine');
    await until(() => b.controller.getSnapshot().save.result?.kind === 'saved', 'keep mine saves');
    assert.equal((await n.saved()) === keepMine, true);
    await until(() => a.text() === keepMine, 'tab A follows');
    assert.equal(a.strip() === null, true);
    current = keepMine;

    // Take theirs.
    const dropped = `${current}B drops this.\n`, taken = `${current}A wins this one.\n`;
    await conflict(dropped, taken);
    await b.click('Take theirs');
    await until(() => b.text() === taken, 'take theirs loads the remote note');
    assert.equal(b.controller.getSnapshot().dirty, false);
    assert.equal((await n.saved()) === taken, true);
    assert.equal(b.strip() === null, true);
    current = taken;

    // Review diff, then still free to choose.
    const reviewed = `${current}B wonders about this.\n`, other = `${current}A wrote that.\n`;
    await conflict(reviewed, other);
    const before = frozen(b), writes = n.writes();
    await b.click('Review diff');
    await until(() => b.strip().querySelector('[data-boring="proposal-diff"]') !== null, 'the diff opens');
    const diff = b.strip().querySelector('[data-boring="proposal-diff"]');
    assert.deepEqual([...diff.querySelectorAll('[data-diff="remove"] [data-diff-text]')].map(node => node.textContent), ['A wrote that.']);
    assert.deepEqual([...diff.querySelectorAll('[data-diff="add"] [data-diff-text]')].map(node => node.textContent), ['B wonders about this.']);
    assert.equal(frozen(b) === before, true, 'nothing changed');
    assert.equal(n.writes(), writes);
    assert.equal((await n.saved()) === other, true);
    await b.click('Take theirs');
    await until(() => b.text() === other, 'the choice still works');
    assert.equal(a.text() === other && b.revision() === a.revision(), true, 'both tabs agree');
  });
});
