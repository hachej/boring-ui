import assert from 'node:assert/strict';
import test from 'node:test';
import { Window } from 'happy-dom';
import { openSqliteWorkspaces } from '../../examples/shared/sqlite-workspaces.mjs';

test('HTML viewer structural DOM and resource behavior; HappyDOM does not qualify template inertness, CSP, Trusted Types or network isolation', { timeout: 30000 }, async t => {
  const window = new Window({ url: 'https://fictional.invalid/', settings: {
    enableJavaScriptEvaluation: false, disableJavaScriptFileLoading: true, disableCSSFileLoading: true, disableIframePageLoading: true,
  } });
  const globals = new Map();
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
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  });
  const { createElement, act } = await import('react');
  const { createRoot } = await import('react-dom/client');
  const { createHtmlController } = await import('@hachej/boring-ui-kit/html');
  const { HtmlViewer } = await import('@hachej/boring-ui-kit/html-viewer');
  let sequence = 0;

  async function fixture(t, source = '<p>Original fictional text</p>\n', { readOnly = false, mount = true, publish } = {}) {
    const provider = openSqliteWorkspaces({ filename: ':memory:', providerId: 'fictional-html', authorize: () => true });
    const identity = { scopeId: 'fictional-project', principalId: 'editor', initiatorId: 'alice' };
    const target = { resource: { providerId: 'fictional-html', path: 'document.html' }, view: { kind: 'published' } };
    let writes = 0;
    const client = {
      read: request => provider.read(request, identity),
      publish: request => { writes++; return publish ? publish(request, () => provider.publication.publish(request, identity)) : provider.publication.publish(request, identity); },
      lookup: operationId => provider.reconciliation.lookup(operationId, identity),
    };
    const seeded = await provider.publication.publish({ operationId: 'seed', atomicity: 'all-or-nothing', changes: [{ kind: 'create', target, expected: { kind: 'absent' }, bytes: new TextEncoder().encode(source), mediaType: 'text/html' }] }, identity);
    assert.equal(seeded.kind, 'committed');
    const read = await client.read({ target, revision: { kind: 'latest' } });
    assert.equal(read.kind, 'available');
    const controller = createHtmlController({ identity, source: { kind: 'saved', snapshot: read.snapshot }, client, instanceId: `html-viewer-${++sequence}`, epoch: 'page', readOnly });
    const container = document.createElement('div'); document.body.append(container);
    const root = createRoot(container);
    let mounted = true;
    const render = async (selected = controller) => { await act(async () => root.render(createElement(HtmlViewer, { controller: selected, title: 'Fictional HTML', className: 'host-html' }))); };
    const unmount = async () => { if (mounted) { mounted = false; await act(async () => root.unmount()); } };
    t.after(async () => { await unmount(); controller.dispose(); provider.close(); container.remove(); });
    if (mount) await render();
    const button = label => {
      const found = [...container.querySelectorAll('button')].find(node => (node.getAttribute('aria-label') || node.textContent) === label);
      assert.ok(found, `Missing control: ${label}`); return found;
    };
    const click = async label => { await act(async () => button(label).click()); };
    const input = async value => {
      const textarea = container.querySelector('textarea[aria-label="HTML source"]'); assert.ok(textarea);
      await act(async () => {
        Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set.call(textarea, value);
        textarea.dispatchEvent(new window.Event('input', { bubbles: true }));
      });
    };
    const saved = async () => {
      const result = await client.read({ target, revision: { kind: 'latest' } });
      assert.equal(result.kind, 'available'); return result.snapshot;
    };
    return { controller, client, target, container, render, unmount, button, click, input, saved, writes: () => writes };
  }
  async function until(predicate, message) {
    const deadline = Date.now() + 2000;
    while (!predicate()) {
      assert.ok(Date.now() < deadline, message);
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)); });
    }
  }
  function preview(container) {
    const frame = container.querySelector('iframe'); assert.ok(frame, 'Passive preview iframe must be mounted');
    const source = frame.getAttribute('srcdoc'); assert.ok(source, 'Passive preview must have a reconstructed document');
    return { frame, source, document: new window.DOMParser().parseFromString(source, 'text/html') };
  }

  await t.test('default preview and source toggles preserve the original resource without initialization writes', async t => {
    const source = '<!DOCTYPE html>\n<!-- fictional source -->\n<P class="original">café &amp; spacing  </P>\n';
    const f = await fixture(t, source);
    assert.equal(f.button('HTML preview').getAttribute('aria-pressed'), 'true');
    assert.equal(f.button('HTML source').getAttribute('aria-pressed'), 'false');
    assert.ok(f.container.querySelector('.host-html'));
    assert.match(f.container.textContent, /Fictional HTML/);
    preview(f.container);
    await f.click('HTML source');
    assert.equal(f.container.querySelector('textarea[aria-label="HTML source"]').value, source);
    assert.equal(f.button('HTML source').getAttribute('aria-pressed'), 'true');
    await f.click('HTML preview'); preview(f.container);
    assert.equal(f.controller.getSnapshot().text, source);
    assert.equal(f.controller.getSnapshot().bufferVersion, 0);
    assert.equal(f.controller.getSnapshot().dirty, false);
    assert.equal(f.button('Save').disabled, true);
    assert.equal(f.writes(), 0);
    assert.deepEqual((await f.saved()).bytes, new TextEncoder().encode(source));
  });

  await t.test('srcdoc contains passive formatting and escaped text while stripping attributes and active or foreign subtrees', async t => {
    const source = '<h1 id="location" onclick="fictional()">Fictional heading</h1>'
      + '<p style="background:url(https://assets.example.invalid/style)">Keep <strong>bold</strong> and <em>emphasis</em>.</p>'
      + '<ul class="list"><li data-private="value">A list item</li></ul>'
      + '<a href="https://links.example.invalid/" target="_top">Readable link text</a>'
      + '<p>&lt;img src="https://assets.example.invalid/escaped"&gt; &amp; café</p>'
      + '<script>script_marker</script><style>style_marker</style>'
      + '<iframe src="https://assets.example.invalid/frame">frame_marker</iframe>'
      + '<object data="https://assets.example.invalid/object">object_marker</object>'
      + '<svg><text>svg_marker</text></svg><math><mtext>math_marker</mtext></math>'
      + '<template><p>template_marker</p></template><fictional-element>custom_marker</fictional-element>'
      + '<img src="https://assets.example.invalid/image" onerror="fictional()">'
      + '<base href="https://assets.example.invalid/"><meta http-equiv="refresh" content="0;url=https://assets.example.invalid/">';
    const f = await fixture(t, source), rendered = preview(f.container);
    assert.equal(rendered.frame.getAttribute('sandbox'), '');
    assert.equal(rendered.frame.getAttribute('referrerpolicy'), 'no-referrer');
    assert.equal(rendered.frame.hasAttribute('src'), false);
    const policy = rendered.document.head.firstElementChild;
    assert.equal(policy?.localName, 'meta');
    assert.equal(policy.getAttribute('http-equiv').toLowerCase(), 'content-security-policy');
    assert.match(policy.getAttribute('content'), /default-src\s+'none'/);
    assert.match(policy.getAttribute('content'), /base-uri\s+'none'/);
    assert.match(policy.getAttribute('content'), /form-action\s+'none'/);
    assert.equal(rendered.document.body.querySelector('h1').textContent, 'Fictional heading');
    assert.equal(rendered.document.body.querySelector('strong').textContent, 'bold');
    assert.equal(rendered.document.body.querySelector('em').textContent, 'emphasis');
    assert.equal(rendered.document.body.querySelector('li').textContent, 'A list item');
    assert.match(rendered.document.body.textContent, /Readable link text/);
    assert.match(rendered.document.body.textContent, /<img src="https:\/\/assets.example.invalid\/escaped"> & café/);
    assert.equal(rendered.document.body.querySelector('a,script,style,iframe,object,svg,math,template,img,base,meta,fictional-element'), null);
    assert.doesNotMatch(rendered.document.body.textContent, /(?:script|style|frame|object|svg|math|template|custom)_marker/);
    for (const node of rendered.document.body.querySelectorAll('*')) {
      assert.equal(node.namespaceURI, 'http://www.w3.org/1999/xhtml');
      assert.equal(node.attributes.length, 0, node.outerHTML);
    }
    assert.equal(f.controller.getSnapshot().text, source);
    assert.equal(f.writes(), 0);
    assert.deepEqual((await f.saved()).bytes, new TextEncoder().encode(source));
  });

  await t.test('source editing saves exact original HTML rather than the passive reconstruction', async t => {
    const f = await fixture(t);
    const source = '<!-- retain original -->\n<p DATA-name="original">Human &amp; café  </p>\n<script>source_only_marker</script>\n';
    await f.click('HTML source'); await f.input(source);
    assert.equal(f.controller.getSnapshot().text, source);
    assert.equal(f.writes(), 0);
    await f.click('HTML preview');
    assert.doesNotMatch(preview(f.container).source, /source_only_marker|DATA-name/);
    const selection = f.controller.actions.selection();
    await f.click('Save');
    await until(() => f.controller.getSnapshot().save.kind === 'settled', 'HTML save did not settle');
    const outcome = f.controller.getSnapshot().save.result;
    assert.equal(outcome.kind, 'saved'); assert.deepEqual(outcome.selection, selection);
    assert.deepEqual((await f.saved()).bytes, new TextEncoder().encode(source));
    assert.equal((await f.saved()).mediaType, 'text/html');
    assert.deepEqual(await f.client.lookup(outcome.receipt.operationId), { kind: 'committed', receipt: outcome.receipt });
    assert.equal(f.controller.getSnapshot().dirty, false); assert.equal(f.writes(), 1);
    await f.click('HTML source'); assert.equal(f.container.querySelector('textarea').value, source);
  });

  await t.test('read-only source remains selectable and cannot publish', async t => {
    const source = '<p>Read-only fictional HTML</p>', f = await fixture(t, source, { readOnly: true });
    preview(f.container); await f.click('HTML source');
    const input = f.container.querySelector('textarea');
    assert.equal(input.readOnly, true); assert.equal(input.disabled, false); assert.equal(input.value, source);
    input.focus(); input.setSelectionRange(3, 12);
    assert.deepEqual([input.selectionStart, input.selectionEnd], [3, 12]);
    assert.equal(f.button('Save').disabled, true); await f.click('Save');
    assert.equal(f.writes(), 0); assert.equal(f.controller.getSnapshot().text, source);
  });

  await t.test('replacement disconnects the previous preview and subsequent old-controller edits cannot retarget it', async t => {
    const old = await fixture(t, '<p>Old document</p>'), next = await fixture(t, '<p>New document</p>', { mount: false });
    const previous = preview(old.container).frame;
    await old.render(next.controller);
    assert.equal(previous.isConnected, false);
    assert.match(preview(old.container).document.body.textContent, /New document/);
    await act(async () => old.controller.actions.edit('<p>Late old edit</p>'));
    assert.match(preview(old.container).document.body.textContent, /New document/);
    assert.doesNotMatch(preview(old.container).document.body.textContent, /Late old edit/);
    assert.equal(old.controller.getSnapshot().lifecycle, 'active');
    assert.equal(next.controller.getSnapshot().lifecycle, 'active');
    assert.equal(old.writes(), 0); assert.equal(next.writes(), 0);
  });

  await t.test('unmount removes the preview and leaves the borrowed controller available for a later save', async t => {
    const f = await fixture(t), frame = preview(f.container).frame;
    await f.unmount(); assert.equal(frame.isConnected, false);
    assert.equal(f.controller.getSnapshot().lifecycle, 'active'); assert.equal(f.writes(), 0);
    f.controller.actions.edit('<p>Saved after unmount</p>');
    const result = await f.controller.flush(f.controller.actions.selection());
    assert.equal(result.kind, 'saved');
    assert.equal(new TextDecoder().decode((await f.saved()).bytes), '<p>Saved after unmount</p>');
    assert.equal(f.writes(), 1);
  });

  await t.test('Refresh preserves dirty source until Discard local edits explicitly loads the saved revision', async t => {
    const f = await fixture(t), original = await f.saved();
    await f.click('HTML source'); await f.input('<p>Local draft</p>');
    const external = await f.client.publish({ operationId: 'external', atomicity: 'all-or-nothing', changes: [{ kind: 'replace', target: original.ref, bytes: new TextEncoder().encode('<p>Remote update</p>'), mediaType: 'text/html' }] });
    assert.equal(external.kind, 'committed');
    await f.click('Refresh');
    await until(() => f.controller.getSnapshot().remote !== null, 'Refresh did not expose the remote revision');
    assert.equal(f.container.querySelector('textarea').value, '<p>Local draft</p>');
    await f.click('Discard local edits');
    await until(() => !f.controller.getSnapshot().dirty, 'Discard did not replace the dirty source');
    assert.equal(f.container.querySelector('textarea').value, '<p>Remote update</p>');
    assert.equal(f.writes(), 1);
  });

  await t.test('Reconcile save retains later typing after a lost acknowledgement without replay', async t => {
    const f = await fixture(t, '<p>Original</p>', { publish: async (_request, commit) => { await commit(); throw new Error('Fictional lost HTML acknowledgement'); } });
    await f.click('HTML source'); await f.input('<p>Committed source</p>'); await f.click('Save');
    await until(() => f.controller.getSnapshot().save.kind === 'settled', 'Lost acknowledgement did not settle');
    assert.equal(f.controller.getSnapshot().save.result.kind, 'unknown');
    await f.input('<p>Later local source</p>'); assert.equal(f.button('Save').disabled, true);
    await f.click('Reconcile save');
    await until(() => {
      const save = f.controller.getSnapshot().save;
      return save.kind === 'settled' && save.result.kind === 'saved';
    }, 'Reconciliation did not settle');
    assert.equal(f.container.querySelector('textarea').value, '<p>Later local source</p>');
    assert.equal(f.controller.getSnapshot().dirty, true); assert.equal(f.writes(), 1);
    assert.equal(new TextDecoder().decode((await f.saved()).bytes), '<p>Committed source</p>');
  });

  await t.test('a throwing template parser fails only the preview and preserves editable original source', async t => {
    const source = '<p>Source survives parser failure</p>', create = document.createElement;
    let attempts = 0;
    document.createElement = function (name, options) {
      const element = create.call(this, name, options);
      if (name.toLowerCase() === 'template') Object.defineProperty(element, 'innerHTML', { configurable: true, set() { attempts++; throw new TypeError('Fictional parser sink refusal'); } });
      return element;
    };
    try {
      const f = await fixture(t, source);
      assert.ok(attempts > 0); assert.ok(f.container.querySelector('[role="alert"]'));
      assert.equal(f.container.querySelector('iframe[srcdoc]'), null);
      await f.click('HTML source'); assert.equal(f.container.querySelector('textarea').value, source);
      await f.input('<p>Editable after parser refusal</p>');
      assert.equal(f.controller.getSnapshot().text, '<p>Editable after parser refusal</p>');
      assert.equal(f.controller.getSnapshot().lifecycle, 'active'); assert.equal(f.writes(), 0);
      assert.deepEqual((await f.saved()).bytes, new TextEncoder().encode(source));
    } finally { document.createElement = create; }
  });

  await t.test('a throwing srcdoc setter reports a local preview failure without changing source or controller ownership', async t => {
    const source = '<p>Source survives srcdoc failure</p>';
    const prototype = window.HTMLIFrameElement.prototype, descriptor = Object.getOwnPropertyDescriptor(prototype, 'srcdoc');
    assert.ok(descriptor?.set);
    let attempts = 0;
    Object.defineProperty(prototype, 'srcdoc', { ...descriptor, set() { attempts++; throw new TypeError('Fictional srcdoc sink refusal'); } });
    try {
      const f = await fixture(t, source);
      assert.ok(attempts > 0); assert.ok(f.container.querySelector('[role="alert"]'));
      assert.equal(f.container.querySelector('iframe[srcdoc]'), null);
      await f.click('HTML source'); assert.equal(f.container.querySelector('textarea').value, source);
      assert.equal(f.controller.getSnapshot().lifecycle, 'active'); assert.equal(f.controller.getSnapshot().dirty, false);
      assert.equal(f.writes(), 0); assert.deepEqual((await f.saved()).bytes, new TextEncoder().encode(source));
    } finally { Object.defineProperty(prototype, 'srcdoc', descriptor); }
  });

  for (const [name, source] of [
    ['source length', 'x'.repeat(262145)],
    ['depth', '<div>'.repeat(130) + 'Fictional deep text' + '</div>'.repeat(130)],
    ['node count', '<br>'.repeat(20001)],
    ['output length', '&'.repeat(250000)],
  ]) await t.test(name + ' limit refuses preview while preserving source and publication', async t => {
    const f = await fixture(t, source);
    assert.equal(f.container.querySelector('iframe'), null);
    assert.match(f.container.querySelector('[role="alert"]').textContent, /Preview unavailable/);
    assert.equal(f.writes(), 0);
    await f.click('HTML source');
    assert.equal(f.container.querySelector('textarea').value, source);
    await f.input('<p>Small replacement</p>');
    await f.click('Save');
    await until(() => f.controller.getSnapshot().save.kind === 'settled', 'HTML save after refused preview');
    assert.equal(new TextDecoder().decode((await f.saved()).bytes), '<p>Small replacement</p>');
    await f.click('HTML preview');
    assert.equal(preview(f.container).document.body.querySelector('p').textContent, 'Small replacement');
  });

  await t.test('serialized preformatted content carries a protective newline for browser reparsing', async t => {
    const f = await fixture(t, '<pre><code>  x &amp; y\n</code></pre>');
    assert.match(preview(f.container).source, /<pre>\n<code>  x &amp; y\n<\/code><\/pre>/);
    assert.equal(f.controller.getSnapshot().text, '<pre><code>  x &amp; y\n</code></pre>');
    assert.equal(f.writes(), 0);
  });

  await t.test('server rendering never parses or embeds generated markup and keeps the controller borrowed', async t => {
    const { renderToStaticMarkup } = await import('react-dom/server');
    const f = await fixture(t, '<script>fictional_server_marker</script><p>fictional_private_source</p>', { mount: false });
    const rendered = renderToStaticMarkup(createElement(HtmlViewer, { controller: f.controller }));
    assert.match(rendered, /Preview unavailable/);
    assert.doesNotMatch(rendered, /fictional_server_marker|fictional_private_source|<iframe/);
    assert.equal(f.controller.getSnapshot().lifecycle, 'active');
    assert.equal(f.writes(), 0);
  });

});
