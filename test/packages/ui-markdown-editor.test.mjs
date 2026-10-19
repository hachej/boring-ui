import assert from 'node:assert/strict';
import test from 'node:test';
import { Window } from 'happy-dom';
import { createMarkdownController } from '@hachej/boring-ui-kit/markdown';
import { openSqliteWorkspaces } from '../../shared/sqlite-workspaces.mjs';
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
    const render = async (selected = controller) => { await act(async () => { root.render(createElement(MarkdownEditor, { controller: selected, title: 'Notes', autosave: false, ...(options.props ?? {}) })); }); };
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

  await t.test('the owner document with a legacy nbsp-only trailing paragraph reopens rich and never writes nbsp again', async t => {
    const raw = '# Hello\n\nHow are you ?\n\n&nbsp;\n';
    const f = await fixture(t, raw);
    assert.equal(f.container.querySelector('section').dataset.mode, 'rich');
    await f.click('Heading 2'); await f.click('Save'); await f.settled();
    assert.equal(await f.saved(), '## Hello\n\nHow are you ?\n');
    await f.render();
    assert.equal(f.container.querySelector('section').dataset.mode, 'rich');
  });

  await t.test('editor-produced Markdown is idempotent after one pass and stays rich across a corpus', async t => {
    const corpus = [
      '# Heading\n\nA paragraph.\n', 'First paragraph.\n\nSecond paragraph.\n',
      '- first\n- second\n', '- parent\n  - child\n    - grandchild\n', '1. first\n2. second\n',
      '- [ ] next\n- [x] done\n', '> A quote\n>\n> Another paragraph.\n',
      '```ts\nconst fictional = 1;\n\n```\n', '|A|B|\n|-|-|\n|1|2|\n',
      '[Fictional](https://fictional.invalid/) and **bold**, *italic*, `code`.\n',
      '\n\nStart.\n', 'First.\n\n&nbsp;\n\nSecond.\n', 'End.\n\n&nbsp;\n\n&nbsp;\n',
      'A hard break  \nthen more.\n', '# Hello\n\nHow are you ?\n\n&nbsp;\n',
    ];
    for (const markdown of corpus) {
      const f = await fixture(t, markdown);
      assert.equal(f.container.querySelector('section').dataset.mode, 'rich', markdown);
      // Native undo restores the parsed document; its update runs the real renderer's serializer.
      await f.click('Heading 1');
      const undo = async fixture => act(async () => fixture.container.querySelector('[contenteditable]').dispatchEvent(new window.KeyboardEvent('keydown', { key: 'z', code: 'KeyZ', keyCode: 90, ctrlKey: true, bubbles: true, cancelable: true })));
      await undo(f);
      const once = f.controller.getSnapshot().text;
      assert.doesNotMatch(once, /^\s*&nbsp;\s*$/m, markdown);
      assert.equal(checkMarkdownRichSafety(once).safe, true, once);
      const again = await fixture(t, once);
      assert.equal(again.container.querySelector('section').dataset.mode, 'rich', once);
      await again.click('Heading 1'); await undo(again);
      assert.equal(again.controller.getSnapshot().text, once, `stable serialization: ${JSON.stringify(markdown)}`);
    }
  });

  await t.test('desktop formatting is pinned by default and selection formatting remains an option', async t => {
    const f = await fixture(t, 'original text\n');
    assert.ok(f.container.querySelector('.boring-markdown-toolbar [aria-label="Bold"]'), 'desktop toolbar is visible by default');
    assert.equal(f.container.querySelector('[aria-label="Pin formatting toolbar"]'), null, 'the header has no pin button: the formattingToolbar prop decides');
    assert.equal(f.writes(), 0);
  });

  await t.test('every automatic flush leaves an untouched new buffer absent; explicit Ctrl+S can create it', async t => {
    for (const trigger of ['blur', 'visibilitychange', 'pagehide', 'navigation', 'unmount']) {
      let flush;
      const f = await fixture(t, '', { newDocument: true, props: { initialMode: 'source', autosave: { delayMs: 20 }, onAutosaveChange: next => { flush = next; } } });
      assert.equal(f.controller.getSnapshot().bufferVersion, 0);
      await act(async () => {
        await new Promise(resolve => setTimeout(resolve, 35));
        if (trigger === 'blur') f.container.querySelector('textarea').dispatchEvent(new window.FocusEvent('focusout', { bubbles: true }));
        else if (trigger === 'visibilitychange') { Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' }); document.dispatchEvent(new window.Event('visibilitychange')); }
        else if (trigger === 'pagehide') window.dispatchEvent(new window.Event('pagehide'));
        else if (trigger === 'navigation') await flush();
        else f.root.render(null);
        await new Promise(resolve => setTimeout(resolve, 20));
      });
      Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
      assert.equal(f.writes(), 0, `${trigger}: an automatic flush does not publish version zero`);
      assert.equal((await f.client.read({ target: f.target, revision: { kind: 'latest' } })).kind, 'missing');
      if (trigger === 'unmount') await f.render();
      await act(async () => f.container.querySelector('textarea').dispatchEvent(new window.KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true, cancelable: true })));
      await f.settled();
      assert.equal(f.writes(), 1, 'an explicit save still creates an empty document');
      assert.equal(await f.saved(), '');
    }
  });

  await t.test('autosave debounces edits once, hides Save, and keeps the exact persisted text', async t => {
    const f = await fixture(t, 'original', { props: { initialMode: 'source', autosave: { delayMs: 250 } } });
    assert.equal([...f.container.querySelectorAll('button')].find(button => button.textContent === 'Save'), undefined);
    await f.input('one'); await f.input('two'); await f.input('final');
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 350)); });
    assert.equal(f.writes(), 1);
    assert.equal(await f.saved(), 'final');
    assert.equal(f.controller.getSnapshot().dirty, false);
    assert.match(f.container.querySelector('[role=status]').textContent, /Saved/);
  });

  await t.test('default autosave waits about 1200ms and visibilitychange flushes immediately', async t => {
    const f = await fixture(t, 'original', { props: { initialMode: 'source', autosave: true } });
    await f.input('default delay');
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 950)); });
    assert.equal(f.writes(), 0, 'the default does not save early');
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 400)); });
    assert.equal(f.writes(), 1); assert.equal(await f.saved(), 'default delay');
    await f.input('saved when hidden');
    const descriptor = Object.getOwnPropertyDescriptor(document, 'visibilityState');
    try {
      Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
      await act(async () => { document.dispatchEvent(new window.Event('visibilitychange')); await new Promise(resolve => setTimeout(resolve, 20)); });
      await f.settled(); assert.equal(await f.saved(), 'saved when hidden');
    } finally {
      if (descriptor) Object.defineProperty(document, 'visibilityState', descriptor); else delete document.visibilityState;
    }
  });

  await t.test('autosave queues edits during a flush and Ctrl+S never starts a competing write', async t => {
    const started = Promise.withResolvers(), release = Promise.withResolvers();
    let active = 0, maxActive = 0, calls = 0;
    const f = await fixture(t, 'original', { props: { initialMode: 'source', autosave: true }, publish: async (request, commit) => {
      calls++; active++; maxActive = Math.max(active, maxActive);
      const result = await commit();
      if (calls === 1) { started.resolve(); await release.promise; }
      active--; return result;
    } });
    const shortcut = async () => act(async () => { f.container.querySelector('textarea').dispatchEvent(new window.KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true, cancelable: true })); });
    await f.input('first'); await shortcut(); await started.promise;
    assert.equal(f.container.querySelector('[role=status]').textContent, 'Saving…');
    await f.input('second'); await shortcut();
    assert.equal(f.writes(), 1);
    await act(async () => { release.resolve(); await new Promise(resolve => setTimeout(resolve, 50)); });
    await f.settled();
    assert.equal(f.writes(), 2); assert.equal(maxActive, 1);
    assert.equal(await f.saved(), 'second'); assert.equal(f.controller.getSnapshot().dirty, false);
  });

  await t.test('autosave conflicts pause typing, blur and hide saves until explicit resolution, retaining the buffer', async t => {
    const f = await fixture(t, 'original', { props: { initialMode: 'source', autosave: { delayMs: 100 } } });
    await f.client.publish({ operationId: 'agent-write', atomicity: 'all-or-nothing', changes: [{ kind: 'replace', target: f.controller.getSnapshot().base.target, bytes: new TextEncoder().encode('agent text'), mediaType: 'text/markdown' }] });
    await f.input('human draft');
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 200)); });
    assert.equal(f.controller.getSnapshot().save.result.kind, 'conflict');
    await f.input('newer human draft');
    await act(async () => { f.container.querySelector('textarea').dispatchEvent(new window.FocusEvent('focusout', { bubbles: true })); window.dispatchEvent(new window.Event('pagehide')); await new Promise(resolve => setTimeout(resolve, 200)); });
    assert.equal(f.writes(), 2, 'one agent write and one refused autosave, no retries');
    assert.equal(f.container.querySelector('textarea').value, 'newer human draft');
    assert.equal(await f.saved(), 'agent text');
    await f.click('Discard local changes and reload');
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
    await f.input('resolved edit');
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 200)); });
    assert.equal(await f.saved(), 'resolved edit');
  });

  await t.test('refused and unavailable autosaves stop without losing the draft', async t => {
    for (const kind of ['denied', 'unavailable']) {
      const f = await fixture(t, 'original', { props: { initialMode: 'source', autosave: { delayMs: 80 } }, publish: async () => ({ kind, reason: 'Fictional refusal' }) });
      await f.input('kept draft');
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 160)); });
      await f.input('kept newer draft');
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 160)); });
      assert.equal(f.writes(), 1); assert.equal(f.controller.getSnapshot().text, 'kept newer draft');
      assert.match(f.container.textContent, /Fictional refusal/);
      assert.equal(await f.saved(), 'original');
    }
  });

  await t.test('explicit refresh resolves a temporary refusal and resumes autosave without replacing the buffer', async t => {
    let available = false;
    const f = await fixture(t, 'original', { props: { initialMode: 'source', autosave: { delayMs: 100 } }, publish: (request, commit) => available ? commit() : Promise.resolve({ kind: 'unavailable', reason: 'Fictional offline provider' }) });
    await f.input('retained edit');
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 180)); });
    assert.equal(f.writes(), 1); assert.equal(await f.saved(), 'original');
    available = true;
    await act(async () => { await f.controller.actions.refresh(); await new Promise(resolve => setTimeout(resolve, 180)); });
    assert.equal(await f.saved(), 'retained edit'); assert.equal(f.writes(), 2);
    assert.doesNotMatch(f.container.textContent, /Fictional offline provider/);
  });

  await t.test('blur, page hide, unmount and switching controllers flush before the idle delay', async t => {
    for (const trigger of ['blur', 'hide', 'unmount', 'switch']) {
      const f = await fixture(t, 'original', { props: { initialMode: 'source', autosave: true } });
      await f.input(`saved on ${trigger}`);
      assert.equal(f.writes(), 0);
      if (trigger === 'switch') {
        const other = await fixture(t, 'other file'); await f.render(other.controller);
        assert.equal(other.writes(), 0);
      } else await act(async () => {
        if (trigger === 'blur') f.container.querySelector('textarea').dispatchEvent(new window.FocusEvent('focusout', { bubbles: true }));
        else if (trigger === 'hide') window.dispatchEvent(new window.Event('pagehide'));
        else f.root.unmount();
        await new Promise(resolve => setTimeout(resolve, 30));
      });
      await f.settled();
      assert.equal(await f.saved(), `saved on ${trigger}`); assert.equal(f.writes(), 1);
    }
  });

  await t.test('opt-out never automatically flushes and read-only documents never publish', async t => {
    const f = await fixture(t, 'original', { props: { initialMode: 'source', autosave: false } });
    await f.input('manual draft');
    await act(async () => { f.container.querySelector('textarea').dispatchEvent(new window.FocusEvent('focusout', { bubbles: true })); window.dispatchEvent(new window.Event('pagehide')); await new Promise(resolve => setTimeout(resolve, 1300)); });
    assert.equal(f.writes(), 0); assert.equal(await f.saved(), 'original');
    await f.click('Save'); await f.settled(); assert.equal(await f.saved(), 'manual draft');
    const readonly = await fixture(t, 'reference', { readOnly: true, props: { initialMode: 'source', autosave: { delayMs: 10 } } });
    await act(async () => { readonly.container.querySelector('textarea').dispatchEvent(new window.FocusEvent('focusout', { bubbles: true })); window.dispatchEvent(new window.Event('pagehide')); await new Promise(resolve => setTimeout(resolve, 50)); });
    assert.equal(readonly.writes(), 0);
  });

  await t.test('selection formatting formats the native selection without a write', async t => {
    let tools;
    const f = await fixture(t, 'original text\n', { props: { formattingToolbar: 'selection', onMountedTools: value => { tools = value; } } });
    assert.ok(f.container.querySelector('.boring-markdown-toolbar') === null, 'no permanent formatting row by default');
    assert.equal(document.querySelector('.boring-markdown-bubble'), null, 'no menu before a text selection');
    const target = tools.getTarget();
    await act(async () => {
      const result = await tools.select.invoke(target, { expiresAt: Date.now() + 5000, selection: { kind: 'rich', anchor: 1, head: 9 } });
      assert.equal(result.kind, 'applied');
    });
    const deadline = Date.now() + 2000;
    while (!document.querySelector('.boring-markdown-bubble')) {
      assert.ok(Date.now() < deadline, 'the native selection menu must open');
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); });
    }
    const bubble = document.querySelector('.boring-markdown-bubble');
    assert.equal(bubble.getAttribute('role'), 'toolbar');
    const bold = bubble.querySelector('[aria-label="Bold"]');
    assert.ok(bold);
    await act(async () => bold.click());
    assert.equal(f.controller.getSnapshot().text, '**original** text\n');
    assert.equal(f.writes(), 0, 'formatting does not publish');
    assert.equal(f.container.querySelector('[aria-label="Pin formatting toolbar"]'), null, 'no pin button: the host chose selection formatting');
    await f.click('Markdown source');
    assert.equal(document.querySelector('.boring-markdown-bubble'), null, 'source mode has no rich menu');
    assert.equal(f.writes(), 0);
  });

  await t.test('a phone never mounts the pinned toolbar, even when the host requests it', async t => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'matchMedia');
    Object.defineProperty(globalThis, 'matchMedia', { configurable: true, value: query => ({ matches: query === '(max-width: 640px)', addEventListener() {}, removeEventListener() {} }) });
    try {
      const f = await fixture(t, 'phone text\n', { props: { formattingToolbar: 'pinned' } });
      assert.ok(f.container.querySelector('.boring-markdown-toolbar') === null, 'no pinned row on phone');
      assert.equal([...f.container.querySelectorAll('button')].find(button => button.getAttribute('aria-label') === 'Pin formatting toolbar'), undefined);
      assert.ok(f.container.querySelector('[contenteditable="true"]'));
      assert.equal(f.writes(), 0);
    } finally {
      if (descriptor) Object.defineProperty(globalThis, 'matchMedia', descriptor); else delete globalThis.matchMedia;
    }
  });

  await t.test('a phone docks the full formatting row above the keyboard while the rich surface has focus', async t => {
    const mediaDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'matchMedia');
    const viewportDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'visualViewport');
    const innerHeight = Object.getOwnPropertyDescriptor(globalThis, 'innerHeight');
    const listeners = new Set();
    const viewport = { offsetTop: 0, height: 844, addEventListener: (_, listener) => listeners.add(listener), removeEventListener: (_, listener) => listeners.delete(listener) };
    Object.defineProperty(globalThis, 'matchMedia', { configurable: true, value: query => ({ matches: query === '(max-width: 640px)' || query === '(pointer: coarse)', addEventListener() {}, removeEventListener() {} }) });
    Object.defineProperty(globalThis, 'visualViewport', { configurable: true, value: viewport });
    Object.defineProperty(globalThis, 'innerHeight', { configurable: true, value: 844 });
    try {
      let tools;
      const f = await fixture(t, 'phone text\n', { props: { formattingToolbar: 'pinned', onMountedTools: value => { tools = value; } } });
      const dock = () => document.querySelector('[data-testid="markdown-dock"]');
      assert.equal(dock(), null, 'reading shows no bar');
      const surface = f.container.querySelector('[contenteditable="true"]');
      await act(async () => { surface.focus(); });
      assert.ok(dock(), 'focusing the editor shows the bar');
      assert.equal(dock().getAttribute('role'), 'toolbar');
      for (const label of ['Bold', 'Italic', 'Strikethrough', 'Highlight', 'Code', 'Heading 1', 'Heading 2', 'Heading 3', 'Bullet list', 'Numbered list', 'Task list', 'Quote', 'Code block', 'Link', 'Table', 'Horizontal rule']) {
        assert.ok(dock().querySelector(`[aria-label="${label}"]`), label);
      }
      assert.equal(dock().style.bottom, '0px', 'docked at the bottom with no keyboard');
      await act(async () => { viewport.height = 544; for (const listener of listeners) listener(); });
      assert.equal(dock().style.bottom, '300px', 'the bar sits directly above the keyboard');
      assert.ok(dock().hasAttribute('data-keyboard'));
      await act(async () => {
        const result = await tools.select.invoke(tools.getTarget(), { expiresAt: Date.now() + 5000, selection: { kind: 'rich', anchor: 1, head: 6 } });
        assert.equal(result.kind, 'applied');
      });
      await act(async () => dock().querySelector('[aria-label="Bold"]').click());
      assert.equal(f.controller.getSnapshot().text, '**phone** text\n');
      assert.equal(f.writes(), 0, 'formatting does not publish');
      await act(async () => { surface.blur(); });
      assert.equal(dock(), null, 'the bar hides when the keyboard closes');
      await act(async () => { surface.focus(); });
      assert.ok(dock());
      await f.click('Markdown source');
      assert.equal(dock(), null, 'source mode has no bar');
    } finally {
      for (const [name, descriptor] of [['matchMedia', mediaDescriptor], ['visualViewport', viewportDescriptor], ['innerHeight', innerHeight]]) {
        if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name];
      }
    }
  });

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
    const f = await fixture(t, raw, { props: { formattingToolbar: 'pinned' } });
    assert.equal(f.container.querySelector('section').dataset.mode, 'rich');
    assert.equal(f.container.querySelectorAll('[contenteditable] table tr').length, 3);
    // The caret starts at the beginning of a loaded document, so the title is the line that changes.
    const edited = raw.replace('# Stock', '## Stock');
    await f.click('Heading 2');
    assert.equal(f.controller.getSnapshot().text, edited, 'the table is written back exactly');
    await f.click('Save'); await f.settled();
    assert.equal(await f.saved(), edited);
    // The caret at the start of a document that is a table sits in its first cell: adding a row rewrites that table only.
    const last = await fixture(t, '|L|C|R|\n|:-|:-:|-:|\n|a|`x`|[l](https://fictional.invalid/)|\n', { props: { formattingToolbar: 'pinned' } });
    await last.click('Add table row');
    const table = marked.lexer(last.controller.getSnapshot().text).find(token => token.type === 'table');
    assert.ok(table, 'still a GFM table');
    assert.deepEqual(table.align, ['left', 'center', 'right']);
    assert.deepEqual(table.rows.map(row => row.map(cell => cell.text)), [['', '', ''], ['a', '`x`', '[l](https://fictional.invalid/)']]);
  });

  await t.test('a rich edit keeps tables, links, images and task lists byte for byte and Save publishes only the edit', async t => {
    const raw = '# Plan\n\nSee [the site](https://fictional.invalid/page "Site") and ![alt text](https://fictional.invalid/pic.png "Pic") here.\n\n- [x] done\n- [ ] todo\n\n| Name | Qty |\n| ---- | --- |\n| Tea  | 2   |\n\n> quoted\n\n---\n\nEnd with ==marked== text.\n';
    const f = await fixture(t, raw, { props: { formattingToolbar: 'pinned' } });
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
    const f = await fixture(t, raw, { props: { formattingToolbar: 'pinned' } });
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
    const f = await fixture(t, 'original', { props: { formattingToolbar: 'pinned' } });
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
    const f = await fixture(t, '[published](https://fictional.invalid/)', { readOnly: true, props: { formattingToolbar: 'pinned' } });
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
