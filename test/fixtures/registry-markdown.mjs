import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { Window } from 'happy-dom';
import { createMarkdownController } from '@hachej/boring-ui-kit/markdown';
import { openSqliteWorkspaces } from '../../examples/shared/sqlite-workspaces.mjs';

test('installed registry Markdown wrapper with real React/Tiptap/SQLite (DOM, not browser qualification)', { timeout: 30000 }, async t => {
  const window = new Window({ url: 'https://fictional.invalid/' }), globals = new Map();
  for (const name of ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node', 'Text', 'DOMParser', 'MutationObserver', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame']) {
    globals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value: name === 'window' ? window : typeof window[name] === 'function' && /^[a-z]/.test(name) ? window[name].bind(window) : window[name] });
  }
  globals.set('IS_REACT_ACT_ENVIRONMENT', Object.getOwnPropertyDescriptor(globalThis, 'IS_REACT_ACT_ENVIRONMENT'));
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const { createElement, act } = await import('react');
  const { createRoot } = await import('react-dom/client');
  const { MarkdownEditor } = await import('../../dist/markdown-editor.js');
  const buttonStyle = element => {
    const style = window.getComputedStyle(element);
    return { background: style.backgroundColor, color: style.color, border: style.borderTop, radius: style.borderRadius, padding: style.padding };
  };
  const baselineButton = document.createElement('button'); document.body.append(baselineButton);
  const unrelatedBaseline = buttonStyle(baselineButton); baselineButton.remove();
  const stylesheet = document.createElement('style');
  stylesheet.textContent = await readFile(new URL('../../src/index.css', import.meta.url), 'utf8');
  document.head.append(stylesheet);
  t.after(async () => {
    await window.happyDOM.close();
    for (const [name, descriptor] of globals) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name];
    }
  });
  let sequence = 0;
  async function fixture(t, initial = 'original', options = {}) {
    const provider = openSqliteWorkspaces({ filename: ':memory:', providerId: 'fictional-registry-documents', authorize: () => true });
    const identity = { scopeId: 'fictional-project', principalId: 'editor', initiatorId: 'alice' };
    const target = { resource: { providerId: 'fictional-registry-documents', path: 'notes.md' }, view: { kind: 'published' } };
    let writes = 0;
    const client = {
      read: request => provider.read(request, identity),
      publish: request => { writes++; return provider.publication.publish(request, identity); },
      lookup: operationId => provider.reconciliation.lookup(operationId, identity),
    };
    await provider.publication.publish({ operationId: 'seed', atomicity: 'all-or-nothing', changes: [{ kind: 'create', target, expected: { kind: 'absent' }, bytes: new TextEncoder().encode(initial), mediaType: 'text/markdown' }] }, identity);
    const snapshot = (await client.read({ target, revision: { kind: 'latest' } })).snapshot;
    const controller = createMarkdownController({ source: { kind: 'saved', snapshot }, identity, client, instanceId: `registry-editor-${++sequence}`, epoch: 'page', readOnly: options.readOnly });
    const container = document.createElement('div'); document.body.append(container); const root = createRoot(container);
    let mounted = true;
    const unmount = async () => { if (mounted) { mounted = false; await act(async () => root.unmount()); } };
    t.after(async () => { await unmount(); controller.dispose(); provider.close(); container.remove(); });
    await act(async () => root.render(createElement(MarkdownEditor, { controller, title: 'Fictional registry notes', placeholder: 'Fictional placeholder', ...options.props })));
    const button = label => { const found = [...container.querySelectorAll('button')].find(node => (node.getAttribute('aria-label') || node.textContent) === label); assert.ok(found, label); return found; };
    const click = async label => { await act(async () => button(label).click()); };
    const settled = async () => {
      for (let attempt = 0; attempt < 100 && controller.getSnapshot().save.kind === 'pending'; attempt++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)); });
      assert.equal(controller.getSnapshot().save.kind, 'settled');
    };
    const input = async value => {
      const textarea = container.querySelector('textarea'); assert.ok(textarea);
      await act(async () => {
        Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set.call(textarea, value);
        textarea.dispatchEvent(new window.Event('input', { bubbles: true }));
      });
    };
    const saved = async () => new TextDecoder().decode((await client.read({ target, revision: { kind: 'latest' } })).snapshot.bytes);
    return { provider, identity, target, client, controller, container, unmount, button, click, input, settled, saved, writes: () => writes };
  }

  await t.test('wrapper mount and mode changes preserve exact bytes and forward concrete editor props', async t => {
    // The rich switch needs a document rich editing keeps exactly (a `*  ` list marker would be rewritten, so it opens as source only).
    const source = '# Fictional heading\n\n- original spacing\n\n';
    const f = await fixture(t, source, { props: { initialMode: 'source', className: 'host-custom' } });
    const root = f.container.querySelector('[data-boring="markdown-editor"]');
    assert.ok(root.classList.contains('boring-markdown-recipe')); assert.ok(root.classList.contains('host-custom'));
    if (process.env.BORING_REGISTRY_RESTYLED === 'true') {
      assert.ok(root.classList.contains('host-installed-editor'));
      assert.equal(window.getComputedStyle(root).getPropertyValue('--boring-editor-radius').trim(), '1.25rem');
      assert.equal(window.getComputedStyle(root).borderRadius, '20px');
    }
    assert.equal(f.container.querySelector('textarea').value, source);
    assert.match(f.container.textContent, /Fictional registry notes/);
    await f.click('Markdown source'); assert.ok(f.container.querySelector('[contenteditable="true"]'));
    await f.click('Markdown source');
    assert.equal(f.container.querySelector('textarea').value, source);
    assert.equal(f.controller.getSnapshot().text, source); assert.equal(f.controller.getSnapshot().bufferVersion, 0);
    assert.equal(f.controller.getSnapshot().dirty, false); assert.equal(f.writes(), 0);
  });

  await t.test('source editing and Save publish exact bytes with a real lookup receipt', async t => {
    const f = await fixture(t, 'original', { props: { initialMode: 'source' } });
    const source = 'human draft\n\n  preserve final spaces  \n';
    await f.input(source); assert.equal(f.writes(), 0);
    await f.click('Save'); await f.settled();
    assert.equal(await f.saved(), source); assert.equal(f.writes(), 1);
    const result = f.controller.getSnapshot().save.result;
    assert.equal(result.kind, 'saved');
    const lookup = await f.client.lookup(result.receipt.operationId);
    assert.equal(lookup.kind, 'committed'); assert.deepEqual(lookup.receipt, result.receipt);
    assert.equal(f.controller.getSnapshot().dirty, false);
  });

  await t.test('proposal review stays local until explicit Accept and save', async t => {
    const f = await fixture(t);
    await act(async () => {
      const selection = f.controller.actions.selection();
      const inspection = await f.controller.tools.inspect.invoke(selection.target, { expiresAt: Date.now() + 10000 });
      assert.equal(inspection.kind, 'applied'); assert.equal(inspection.value.text, 'original');
      const result = await f.controller.tools.propose.invoke(selection.target, { expiresAt: Date.now() + 10000, edits: [{ find: 'original', replace: 'reviewed text' }], summary: 'Fictional proposal' });
      assert.equal(result.kind, 'proposed');
    });
    assert.equal(f.container.querySelector('[data-boring="proposal"] h3').textContent, 'Fictional proposal');
    assert.deepEqual([...f.container.querySelectorAll('pre')].map(node => node.textContent), ['original', 'reviewed text']);
    assert.equal(f.writes(), 0); assert.equal(await f.saved(), 'original');
    await f.click('Accept and save'); await f.settled();
    assert.equal(await f.saved(), 'reviewed text'); assert.equal(f.writes(), 1);
  });

  await t.test('stale publication preserves the dirty draft until explicit discard', async t => {
    const f = await fixture(t, 'original', { props: { initialMode: 'source' } });
    const base = f.controller.getSnapshot().base;
    const external = await f.provider.publication.publish({ operationId: 'other-writer', atomicity: 'all-or-nothing', changes: [{ kind: 'replace', target: base.target, bytes: new TextEncoder().encode('remote text'), mediaType: 'text/markdown' }] }, f.identity);
    assert.equal(external.kind, 'committed');
    await f.input('local draft'); await f.click('Save'); await f.settled();
    assert.equal(f.controller.getSnapshot().save.result.kind, 'conflict');
    assert.equal(f.container.querySelector('textarea').value, 'local draft'); assert.equal(await f.saved(), 'remote text');
    await f.click('Check saved version');
    assert.equal(f.controller.getSnapshot().dirty, true); assert.equal(f.container.querySelector('textarea').value, 'local draft');
    await f.click('Discard local changes and reload');
    // The reload is an asynchronous read of the workspace file: wait for it, as a person would.
    for (let attempt = 0; attempt < 100 && f.container.querySelector('textarea').value !== 'remote text'; attempt++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)); });
    assert.equal(f.container.querySelector('textarea').value, 'remote text'); assert.equal(f.controller.getSnapshot().dirty, false);
  });

  await t.test('read-only controller keeps formatting, text input and publication disabled', async t => {
    const f = await fixture(t, 'readonly fiction', { readOnly: true });
    assert.equal(f.button('Heading 1').disabled, true); assert.equal(f.button('Save').disabled, true);
    assert.equal(f.container.querySelector('[contenteditable]').getAttribute('contenteditable'), 'false');
    await f.click('Markdown source'); assert.equal(f.container.querySelector('textarea').readOnly, true);
    assert.equal(f.writes(), 0); assert.equal(await f.saved(), 'readonly fiction');
  });

  await t.test('unmount leaves the borrowed controller usable for a later exact save', async t => {
    const f = await fixture(t);
    await f.unmount(); assert.equal(f.controller.getSnapshot().lifecycle, 'active');
    f.controller.actions.edit('after unmount');
    const result = await f.controller.flush(f.controller.actions.selection());
    assert.equal(result.kind, 'saved'); assert.equal(await f.saved(), 'after unmount'); assert.equal(f.writes(), 1);
  });

  await t.test('installed stylesheet accepts host tokens and a caller class without styling unrelated buttons', async t => {
    const f = await fixture(t, 'styled fiction', { props: { className: 'fictional-host-theme' } });
    const root = f.container.querySelector('[data-boring="markdown-editor"]');
    const override = document.createElement('style');
    override.textContent = '.fictional-host-theme { --background: rgb(12, 34, 56); --foreground: rgb(230, 231, 232); --border: rgb(71, 72, 73); --ring: rgb(91, 92, 93); --boring-editor-diff-add-background: rgb(22, 52, 32); --boring-editor-diff-add-foreground: rgb(210, 250, 220); --boring-editor-diff-remove-background: rgb(62, 22, 32); --boring-editor-diff-remove-foreground: rgb(255, 210, 220); } .fictional-host-theme.boring-markdown-recipe[data-boring="markdown-editor"] { border-radius: 19px; }';
    document.head.append(override); t.after(() => override.remove());
    const outside = document.createElement('button'); outside.textContent = 'Unrelated host button'; document.body.append(outside); t.after(() => outside.remove());
    const styled = window.getComputedStyle(root);
    assert.equal(styled.backgroundColor, 'rgb(12, 34, 56)');
    assert.equal(styled.borderTopColor, 'rgb(71, 72, 73)');
    assert.equal(styled.borderRadius, '19px');
    const inside = window.getComputedStyle(f.button('Save')), unrelated = window.getComputedStyle(outside);
    assert.notEqual(inside.borderTopStyle, unrelated.borderTopStyle);
    assert.deepEqual(buttonStyle(outside), unrelatedBaseline);
    assert.equal(outside.className, '');
    await act(async () => f.controller.actions.propose(f.controller.actions.selection(), [{ find: 'styled fiction', replace: 'reviewed fiction' }], 'Styled review'));
    const added = f.container.querySelector('[data-diff="add"]');
    const removed = f.container.querySelector('[data-diff="remove"]');
    assert.ok(added); assert.ok(removed);
    assert.equal(window.getComputedStyle(added).backgroundColor, 'rgb(22, 52, 32)');
    assert.equal(window.getComputedStyle(added).color, 'rgb(210, 250, 220)');
    assert.equal(window.getComputedStyle(removed).backgroundColor, 'rgb(62, 22, 32)');
    assert.equal(window.getComputedStyle(removed).color, 'rgb(255, 210, 220)');
    assert.equal(f.writes(), 0);
    assert.deepEqual(buttonStyle(outside), unrelatedBaseline);
  });
});
