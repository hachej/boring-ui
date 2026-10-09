import assert from 'node:assert/strict';
import test from 'node:test';
import { Window } from 'happy-dom';
import { createMarkdownController } from '@hachej/boring-ui-kit/markdown';
import { openSqliteWorkspaces } from '../../examples/shared/sqlite-workspaces.mjs';
import { marked } from 'marked';

test('React/Tiptap Markdown editor public output (DOM environment, not browser qualification)', async t => {
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
  let sequence = 0;
  async function fixture(t, initial = 'original', options = {}) {
    const provider = openSqliteWorkspaces({ filename: ':memory:', providerId: 'fictional-documents', authorize: () => true });
    const target = { resource: { providerId: 'fictional-documents', path: 'notes.md' }, view: { kind: 'published' } };
    const identity = { scopeId: 'fictional-project', principalId: 'editor', initiatorId: 'alice' };
    let writes = 0;
    const client = {
      read: request => provider.read(request, identity),
      publish: request => { writes++; return options.publish ? options.publish(request, () => provider.publication.publish(request, identity)) : provider.publication.publish(request, identity); },
      lookup: operationId => provider.reconciliation.lookup(operationId, identity),
    };
    await provider.publication.publish({ operationId: 'seed', atomicity: 'all-or-nothing', changes: [{ kind: 'create', target, expected: { kind: 'absent' }, bytes: new TextEncoder().encode(initial), mediaType: 'text/markdown' }] }, identity);
    const snapshot = (await client.read({ target, revision: { kind: 'latest' } })).snapshot;
    const selectedTarget = options.newDocument ? { ...target, resource: { ...target.resource, path: 'new.md' } } : target;
    const controller = createMarkdownController({ source: options.newDocument ? { kind: 'new', target: selectedTarget } : { kind: 'saved', snapshot }, identity, client, instanceId: `editor-${++sequence}`, epoch: 'page', readOnly: options.readOnly });
    const container = document.createElement('div'); document.body.append(container);
    const root = createRoot(container);
    const render = async (selected = controller) => { await act(async () => { root.render(createElement(MarkdownEditor, { controller: selected, title: 'Notes', ...(options.props ?? {}) })); }); };
    await render();
    t.after(async () => { await act(async () => root.unmount()); controller.dispose(); provider.close(); container.remove(); });
    const button = label => { const found = [...container.querySelectorAll('button')].find(node => (node.getAttribute('aria-label') || node.textContent) === label); assert.ok(found, label); return found; };
    const click = async label => { await act(async () => button(label).click()); };
    const settled = async () => {
      for (let attempt = 0; attempt < 100 && controller.getSnapshot().save.kind === 'pending'; attempt++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)); });
      assert.notEqual(controller.getSnapshot().save.kind, 'pending', 'publication must settle');
    };
    const input = async value => {
      const textarea = container.querySelector('textarea'); assert.ok(textarea);
      await act(async () => {
        Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set.call(textarea, value);
        textarea.dispatchEvent(new window.Event('input', { bubbles: true }));
      });
    };
    return { controller, client, target: selectedTarget, container, root, render, button, click, input, settled, writes: () => writes, saved: async () => new TextDecoder().decode((await client.read({ target: selectedTarget, revision: { kind: 'latest' } })).snapshot.bytes) };
  }

  await t.test('mount and rich/source switches preserve exact bytes without a publication', async t => {
    const raw = '# title\n\nplain *emphasis* and **strong**\n\n- one\n- two\n';
    const f = await fixture(t, raw);
    assert.ok(f.container.querySelector('[contenteditable="true"]'));
    assert.equal(f.controller.getSnapshot().bufferVersion, 0);
    await f.click('Markdown source');
    assert.equal(f.container.querySelector('textarea').value, raw);
    await f.click('Markdown source');
    assert.equal(f.controller.getSnapshot().text, raw);
    assert.equal(f.controller.getSnapshot().dirty, false);
    assert.equal(f.writes(), 0);
  });

  await t.test('a document rich editing cannot keep exactly opens as source with a notice and no rich controls', async t => {
    const raw = '---\ntitle: Fictional\n---\n\n# title\n\n<div class="note">raw <b>html</b></div>\n\nA footnote[^1] and a [reference link][site].\n\n[^1]: Fictional note.\n\n[site]: https://fictional.invalid/\n';
    const f = await fixture(t, raw);
    assert.equal(f.container.querySelector('section').dataset.mode, 'source');
    assert.equal(f.container.querySelector('[contenteditable]'), null, 'no rich surface');
    assert.equal(f.container.querySelector('[role="toolbar"]'), null, 'no formatting toolbar');
    assert.equal(f.container.querySelector('textarea').value, raw);
    const notice = f.container.querySelector('[data-testid="markdown-source-only"]');
    assert.match(notice.textContent, /front matter, raw HTML, footnotes, reference-style links/);
    assert.equal(f.button('Markdown source').disabled, true, 'the rich switch is unavailable');
    assert.equal(f.controller.getSnapshot().dirty, false);
    // An unrelated source edit saves exactly: the constructs are untouched.
    const edited = raw.replace('# title', '# retitled');
    await f.input(edited);
    await f.click('Save'); await f.settled();
    assert.equal(await f.saved(), edited);
    assert.equal(f.writes(), 1);
  });

  await t.test('rich safety is a real round trip: named constructs and rewritten formatting are refused, supported ones are not', async () => {
    assert.deepEqual(checkMarkdownRichSafety('# A\n\n[x](https://fictional.invalid/) ![i](https://fictional.invalid/i.png)\n\n- [x] a\n- [ ] b\n\n| a   | b   |\n| --- | --- |\n| 1   | 2   |\n'), { safe: true });
    assert.deepEqual(checkMarkdownRichSafety(''), { safe: true });
    assert.deepEqual(checkMarkdownRichSafety('a\n\n\n\nb\n'), { safe: true }, 'blank-line runs are insignificant');
    assert.deepEqual(checkMarkdownRichSafety('<!-- c -->\n'), { safe: false, reasons: ['raw HTML'] });
    assert.deepEqual(checkMarkdownRichSafety('x[^1]\n\n[^1]: n\n').reasons, ['footnotes']);
    assert.deepEqual(checkMarkdownRichSafety('a\r\nb\r\n').reasons, ['Windows line endings']);
    assert.deepEqual(checkMarkdownRichSafety('# A\nText directly under a heading.\n## B\nMore.\n'), { safe: true }, 'a heading without blank lines around it is the same document');
    assert.deepEqual(checkMarkdownRichSafety('# Notes & Highlights\n\nFish & chips, 5 < 6.\n'), { safe: true }, 'an ampersand is not rewritten as an entity');
    assert.deepEqual(checkMarkdownRichSafety('# Notes\n\n- A first point that wraps\n  onto an indented second line.\n- Second point.\n  Wrapped as well.\n\n1. Numbered and\n   wrapped.\n'), { safe: true }, 'an indented line continuing a list item is the same paragraph');
    assert.equal(checkMarkdownRichSafety('- parent\n  - nested\n').safe, true, 'nesting the serialiser keeps is safe');
    assert.deepEqual(checkMarkdownRichSafety('Several situations:\n- an unpaid invoice,\n- a payment not yet matched.\n'), { safe: true }, 'a list may interrupt the paragraph above it');
    assert.equal(checkMarkdownRichSafety('- tight\n- list\n').safe, true);
    assert.equal(checkMarkdownRichSafety('- parent\n    - nested deeper than the serialiser writes\n').safe, false, 'a rewritten nesting indentation is still refused');
    const rewritten = checkMarkdownRichSafety('* item\n* item\n');
    assert.equal(rewritten.safe, false);
    assert.match(rewritten.reasons[0], /rewrite/);
    assert.equal(checkMarkdownRichSafety('```\nkeep\n\n\n\nblank runs in code\n```\n').safe, true);
    // GFM tables keep the text they were written in, padded or not.
    for (const table of ['|a|b|\n|-|-|\n|1|2|\n', '| L | C | R |\n|:---|:---:|---:|\n| 1 | 2 | 3 |\n', 'a | b\n--- | ---\n1 | 2\n',
      '| a | b |\n|---|---|\n| **bold** `code` | [link](https://fictional.invalid/) _it_ |\n', '| a | b |\n|---|---|\n| x \\| y | `p|q` |\n',
      '| a | b |\n|---|---|\n|  | 2 |\n| 1 |  |\n']) assert.deepEqual(checkMarkdownRichSafety(table), { safe: true }, table);
  });

  await t.test('an unpadded aligned table opens rich, survives an edit elsewhere byte for byte, and an edited table is valid aligned GFM', async t => {
    const raw = '# Stock\n\n|Item|Qty|Note|\n|:--|:-:|--:|\n|Tea|2|`a\\|b`|\n|Jam||[shop](https://fictional.invalid/) _soon_|\n\nEnd.\n';
    const f = await fixture(t, raw);
    assert.equal(f.container.querySelector('section').dataset.mode, 'rich');
    assert.equal(f.container.querySelectorAll('[contenteditable] table tr').length, 3);
    // The caret starts at the beginning of a loaded document, so the title is the line that changes.
    const edited = raw.replace('# Stock', '## Stock');
    await f.click('Heading 2');
    assert.equal(f.controller.getSnapshot().text, edited, 'the table is written back exactly');
    await f.click('Save'); await f.settled();
    assert.equal(await f.saved(), edited);
    // The caret at the start of a document that is a table sits in its first cell: adding a row rewrites that table only.
    const last = await fixture(t, '|L|C|R|\n|:-|:-:|-:|\n|a|`x`|[l](https://fictional.invalid/)|\n');
    await last.click('Add table row');
    const table = marked.lexer(last.controller.getSnapshot().text).find(token => token.type === 'table');
    assert.ok(table, 'still a GFM table');
    assert.deepEqual(table.align, ['left', 'center', 'right']);
    assert.deepEqual(table.rows.map(row => row.map(cell => cell.text)), [['', '', ''], ['a', '`x`', '[l](https://fictional.invalid/)']]);
  });

  await t.test('a rich edit keeps tables, links, images and task lists byte for byte and Save publishes only the edit', async t => {
    const raw = '# Plan\n\nSee [the site](https://fictional.invalid/page "Site") and ![alt text](https://fictional.invalid/pic.png "Pic") here.\n\n- [x] done\n- [ ] todo\n\n| Name | Qty |\n| ---- | --- |\n| Tea  | 2   |\n\n> quoted\n\n---\n\nEnd with ==marked== text.\n';
    const f = await fixture(t, raw);
    assert.equal(f.container.querySelector('section').dataset.mode, 'rich');
    assert.ok(f.container.querySelector('[contenteditable] table'), 'the table is a real table');
    assert.ok(f.container.querySelector('[contenteditable] a[href="https://fictional.invalid/page"]'));
    assert.ok(f.container.querySelector('[contenteditable] input[type="checkbox"]'), 'task items have checkboxes');
    assert.equal(f.container.querySelector('[contenteditable] img'), null, 'a remote image is never loaded');
    assert.equal(f.container.querySelector('[contenteditable] [data-boring-image="inert"]').textContent, 'alt text');
    // The caret starts at the beginning of the document, so the title is the line that changes.
    const edited = raw.replace('# Plan', '## Plan');
    await f.click('Heading 2');
    assert.equal(f.controller.getSnapshot().text, edited);
    assert.equal(f.controller.getSnapshot().dirty, true);
    await f.click('Save'); await f.settled();
    assert.equal(await f.saved(), edited);
  });

  await t.test('toggling a format twice is a no-op: not dirty, same bytes, nothing published', async t => {
    const raw = '# Plan\n\n- [x] done\n\n| Name | Qty |\n| ---- | --- |\n| Tea  | 2   |\n\nEnd.\n';
    const f = await fixture(t, raw);
    for (const label of ['Quote', 'Bold']) { await f.click(label); await f.click(label); }
    assert.equal(f.controller.getSnapshot().text, raw);
    assert.equal(f.controller.getSnapshot().dirty, false);
    assert.equal(f.button('Save').disabled, true);
    assert.equal(f.writes(), 0);
  });

  await t.test('a host bar can drive the editor: no built-in header, controlled mode, safety reported, images only through the resolver', async t => {
    const seen = [], modes = [];
    const raw = '![logo](pics/logo.png)\n\nbody\n';
    const f = await fixture(t, raw, { props: { header: false, mode: 'rich', onModeChange: mode => modes.push(mode), onRichSafety: safety => seen.push(safety.safe), resolveImage: source => source === 'pics/logo.png' ? 'blob:fictional-logo' : undefined } });
    assert.equal(f.container.querySelector('header'), null);
    assert.equal(f.container.querySelector('[contenteditable] img').getAttribute('src'), 'blob:fictional-logo');
    assert.equal(seen.at(-1), true);
    await f.render();
    await act(async () => { f.root.render(createElement(MarkdownEditor, { controller: f.controller, title: 'Notes', header: false, mode: 'source' })); });
    assert.equal(f.container.querySelector('textarea').value, raw);
    assert.deepEqual(modes, []);
  });

  await t.test('source input saves the exact selection through real SQLite publication', async t => {
    const f = await fixture(t);
    await f.click('Markdown source');
    await f.input('human draft\n\n');
    assert.equal(f.controller.getSnapshot().text, 'human draft\n\n');
    assert.equal(f.container.querySelector('[role="status"]').textContent, 'Unsaved changes');
    await f.click('Save');
    await f.settled();
    assert.equal(await f.saved(), 'human draft\n\n');
    assert.equal(f.writes(), 1);
    assert.equal(f.container.querySelector('[role="status"]').textContent, 'Saved');
  });

  await t.test('formatting controls produce a genuine rich edit without saving implicitly', async t => {
    const f = await fixture(t);
    await f.click('Heading 1');
    assert.match(f.controller.getSnapshot().text, /^# original/);
    assert.equal(f.controller.getSnapshot().dirty, true);
    assert.equal(f.writes(), 0);
    await f.click('Save');
    await f.settled();
    assert.match(await f.saved(), /^# original/);
  });

  await t.test('new-document source input publishes with absence and a real revision', async t => {
    const f = await fixture(t, '', { newDocument: true });
    await f.click('Markdown source'); await f.input('new document');
    await f.click('Save'); await f.settled();
    assert.equal(await f.saved(), 'new document');
    assert.equal(f.controller.getSnapshot().save.result.receipt.changes[0].before, null);
    assert.equal(f.controller.getSnapshot().base.kind, 'revision');
  });

  await t.test('lost acknowledgement exposes reconciliation and does not blindly repeat publication', async t => {
    const f = await fixture(t, 'original', { publish: async (request, commit) => { await commit(); throw new Error('fictional lost acknowledgement'); } });
    await f.click('Markdown source'); await f.input('committed');
    await f.click('Save'); await f.settled();
    assert.equal(f.container.querySelector('[role="status"]').textContent, 'Save unconfirmed');
    assert.equal(f.button('Save').disabled, true);
    await f.input('newer draft');
    await f.click('Check save outcome'); await f.settled();
    assert.equal(f.controller.getSnapshot().text, 'newer draft');
    assert.equal(await f.saved(), 'committed');
    assert.equal(f.writes(), 1);
    assert.equal(f.controller.getSnapshot().dirty, true);
  });

  await t.test('stale publication keeps dirty input until explicit discard', async t => {
    const f = await fixture(t);
    const base = f.controller.getSnapshot().base;
    await f.client.publish({ operationId: 'other-writer', atomicity: 'all-or-nothing', changes: [{ kind: 'replace', target: base.target, bytes: new TextEncoder().encode('remote text'), mediaType: 'text/markdown' }] });
    await f.click('Markdown source'); await f.input('local draft');
    await f.click('Save'); await f.settled();
    assert.equal(f.container.querySelector('[role="status"]').textContent, 'Changed elsewhere');
    assert.equal(f.container.querySelector('textarea').value, 'local draft');
    await f.click('Check saved version');
    assert.equal(f.container.querySelector('textarea').value, 'local draft');
    await f.click('Discard local changes and reload');
    // The reload is an asynchronous read of the workspace file: wait for it, as a person would.
    for (let attempt = 0; attempt < 100 && f.container.querySelector('textarea').value !== 'remote text'; attempt++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)); });
    assert.equal(f.container.querySelector('textarea').value, 'remote text');
    assert.equal(f.controller.getSnapshot().dirty, false);
  });

  await t.test('HTML clipboard paste cannot add executable elements or asset requests', async t => {
    const f = await fixture(t);
    const content = f.container.querySelector('[contenteditable]');
    await act(async () => {
      content.focus();
      const clipboardData = new window.DataTransfer();
      clipboardData.setData('text/html', '<p>pasted fiction<script>fictional()</script><img src="https://fictional.invalid/asset"><a href="javascript:fictional()">bad link</a></p>');
      clipboardData.setData('text/plain', 'pasted fiction bad link');
      content.dispatchEvent(new window.ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData }));
    });
    assert.match(f.controller.getSnapshot().text, /pasted fiction/);
    assert.equal(content.querySelector('script,img,iframe,[onclick],[onerror]'), null);
    for (const anchor of content.querySelectorAll('a[href]')) assert.doesNotMatch(anchor.getAttribute('href'), /^(javascript|data):/i);
    assert.equal(f.writes(), 0);
  });

  await t.test('proposal review and human acceptance invoke the concrete controller', async t => {
    const f = await fixture(t);
    await act(async () => f.controller.actions.propose(f.controller.actions.selection(), [{ find: 'original', replace: 'reviewed' }], 'Fictional suggestion'));
    assert.equal(f.container.querySelector('[data-boring="proposal"] h3').textContent, 'Fictional suggestion');
    assert.deepEqual([...f.container.querySelectorAll('pre')].map(node => node.textContent), ['original', 'reviewed']);
    assert.equal(f.writes(), 0);
    await f.click('Accept and save');
    await f.settled();
    assert.equal(await f.saved(), 'reviewed');
    assert.equal(f.writes(), 1);
  });

  await t.test('late save acknowledgement preserves newer input and current controller selection', async t => {
    const committed = Promise.withResolvers(), release = Promise.withResolvers();
    const f = await fixture(t, 'original', { publish: async (request, commit) => { const result = await commit(); committed.resolve(); await release.promise; return result; } });
    await f.click('Markdown source'); await f.input('selected');
    await f.click('Save'); await committed.promise;
    await f.input('newer input');
    const other = await fixture(t, 'another document');
    await f.render(other.controller);
    await act(async () => { release.resolve(); await new Promise(resolve => setTimeout(resolve, 10)); });
    assert.equal(f.controller.getSnapshot().text, 'newer input');
    assert.equal(f.controller.getSnapshot().dirty, true);
    assert.equal(await f.saved(), 'selected');
    assert.match(f.container.textContent, /another document/);
    assert.equal(other.controller.getSnapshot().bufferVersion, 0);
    await act(async () => f.root.unmount());
    assert.equal(other.controller.getSnapshot().lifecycle, 'active');
    assert.equal(f.controller.getSnapshot().lifecycle, 'active');
  });

  await t.test('read-only and disposed controllers disable edit/save controls', async t => {
    const f = await fixture(t, '[published](https://fictional.invalid/)', { readOnly: true });
    assert.equal(f.button('Heading 1').disabled, true);
    assert.equal(f.button('Save').disabled, true);
    assert.equal(f.container.querySelector('[contenteditable]').getAttribute('contenteditable'), 'false');
    const anchor = f.container.querySelector('a');
    for (const type of ['click', 'auxclick']) {
      const event = new window.MouseEvent(type, { bubbles: true, cancelable: true, button: type === 'auxclick' ? 1 : 0 });
      await act(async () => anchor.dispatchEvent(event));
      assert.equal(event.defaultPrevented, true, `${type} must not navigate`);
    }
    await f.click('Markdown source');
    assert.equal(f.container.querySelector('textarea').readOnly, true);
    assert.equal(f.writes(), 0);
    await act(async () => f.controller.dispose());
    assert.equal(f.container.querySelector('[role="status"]').textContent, 'Closed');
  });

  await t.test('raw HTML opens as source, executable links and assets stay inert, and the host parser is unchanged', async t => {
    const defaults = marked.defaults;
    const html = '<strong onclick="fictional()">literal</strong>\n\n<script>fictional()</script>\n\n<img src="https://fictional.invalid/asset" onerror="fictional()">\n';
    const raw = await fixture(t, html);
    assert.equal(raw.container.querySelector('section').dataset.mode, 'source');
    assert.equal(raw.container.querySelector('[contenteditable]'), null);
    assert.equal(raw.container.querySelector('script,img,iframe'), null);
    assert.equal(raw.controller.getSnapshot().text, html);
    assert.equal(raw.controller.getSnapshot().dirty, false);
    const safe = await fixture(t, '[safe](https://fictional.invalid/)\n\n![remote](https://fictional.invalid/asset)\n');
    const content = safe.container.querySelector('[contenteditable]');
    assert.equal(content.querySelector('script,img,iframe,[onclick],[onerror]'), null);
    for (const anchor of content.querySelectorAll('a[href]')) assert.match(anchor.getAttribute('href'), /^(https:|$)/);
    assert.equal(content.querySelector('a[href="https://fictional.invalid/"]').textContent, 'safe');
    assert.equal(content.querySelector('[data-boring-image="inert"]').getAttribute('aria-label'), 'remote');
    assert.equal(safe.controller.getSnapshot().dirty, false);
    assert.equal(marked.defaults, defaults);
    assert.equal(marked.lexer('<strong>host parser</strong>')[0].tokens[0].type, 'html');
  });
});
