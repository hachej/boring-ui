import assert from 'node:assert/strict';
import test from 'node:test';
import { Window } from 'happy-dom';
import { build } from 'esbuild';

const forbidden = /@tiptap|tldraw|pdfjs|@hachej\/boring-(?:files|agent|execution)|@earendil-works|(?:^|\/)resources\.js|controller|text-buffer|node:/;

test('ArtifactViewer public entry has a lightweight browser import graph', async () => {
  const result = await build({ stdin: { contents: "export { ArtifactViewer } from '@hachej/boring-ui-kit/artifact-viewer';", resolveDir: process.cwd() }, bundle: true, platform: 'browser', format: 'esm', write: false, metafile: true });
  const inputs = Object.keys(result.metafile.inputs);
  assert.ok(inputs.some(path => path.endsWith('/dist/artifact-viewer.js')));
  assert.ok(inputs.some(path => path.endsWith('/dist/passive-html.js')));
  for (const path of inputs) assert.doesNotMatch(path, forbidden);
  const kit = inputs.filter(path => path.includes('boring-ui-kit/dist/') || path.includes('packages/ui/dist/'));
  assert.equal(kit.length, 2, 'Only the viewer and shared passive allowlist may enter this entry');
});

test('ArtifactViewer renders fictional artifacts without resource controllers; DOM structure is not browser CSP or PDF qualification', async t => {
  const window = new Window({ url: 'https://fictional.invalid/', settings: { enableJavaScriptEvaluation: false, disableJavaScriptFileLoading: true, disableCSSFileLoading: true, disableIframePageLoading: true } });
  const globals = new Map();
  for (const name of ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node', 'Text', 'DOMParser', 'MutationObserver', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame']) {
    globals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    const value = name === 'window' ? window : window[name];
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value: typeof value === 'function' && /^[a-z]/.test(name) ? value.bind(window) : value });
  }
  globals.set('IS_REACT_ACT_ENVIRONMENT', Object.getOwnPropertyDescriptor(globalThis, 'IS_REACT_ACT_ENVIRONMENT'));
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const originalCreate = URL.createObjectURL, originalRevoke = URL.revokeObjectURL;
  const made = new Map(), revoked = [];
  URL.createObjectURL = blob => { const url = `blob:fictional-artifact-${made.size + 1}`; made.set(url, blob); return url; };
  URL.revokeObjectURL = url => { revoked.push(url); };
  t.after(async () => {
    URL.createObjectURL = originalCreate; URL.revokeObjectURL = originalRevoke;
    await window.happyDOM.close();
    for (const [name, descriptor] of globals) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  });
  const { createElement, act, StrictMode } = await import('react');
  const { createRoot } = await import('react-dom/client');
  const { ArtifactViewer } = await import('@hachej/boring-ui-kit/artifact-viewer');
  async function fixture(t, props, strict = false) {
    const container = document.createElement('div'); document.body.append(container);
    const root = createRoot(container);
    let mounted = true;
    const render = async next => { await act(async () => root.render(strict ? createElement(StrictMode, null, createElement(ArtifactViewer, next)) : createElement(ArtifactViewer, next))); };
    const unmount = async () => { if (mounted) { mounted = false; await act(async () => root.unmount()); } };
    t.after(async () => { await unmount(); container.remove(); });
    await render(props);
    return { container, render, unmount };
  }
  function preview(container) {
    const frame = container.querySelector('iframe'); assert.ok(frame, 'Passive preview iframe must be mounted');
    assert.equal(frame.getAttribute('sandbox'), '');
    assert.equal(frame.getAttribute('referrerpolicy'), 'no-referrer');
    assert.equal(frame.hasAttribute('src'), false);
    const source = frame.getAttribute('srcdoc'); assert.ok(source);
    const parsed = new window.DOMParser().parseFromString(source, 'text/html');
    const policy = parsed.head.firstElementChild;
    assert.equal(policy?.getAttribute('http-equiv').toLowerCase(), 'content-security-policy');
    assert.match(policy.getAttribute('content'), /default-src\s+'none'/);
    assert.match(policy.getAttribute('content'), /base-uri\s+'none'/);
    assert.match(policy.getAttribute('content'), /form-action\s+'none'/);
    return { frame, source, document: parsed };
  }
  function assertPassive(parsed) {
    assert.equal(parsed.body.querySelector('a,script,style,iframe,object,svg,math,template,img,base,meta,form,input'), null);
    for (const node of parsed.body.querySelectorAll('*')) assert.equal(node.attributes.length, 0, node.outerHTML);
    assert.doesNotMatch(parsed.body.textContent, /fictional_active_marker/);
  }

  await t.test('Markdown uses passive formatting, GFM and escaped code without active HTML or navigation', async t => {
    const content = '# Fictional guide\n\n**Strong** and [passive link](https://links.example.invalid/)\n\n|A|B|\n|---|---|\n|one|two|\n\n```js\n<script>literal code</script>\n```\n\n<script>fictional_active_marker</script>\n<img src="https://assets.example.invalid/" onerror="fictional_active_marker">';
    const f = await fixture(t, { name: 'guide.md', mimeType: ' TEXT/MARKDOWN; charset=UTF-8 ', content, className: 'host-artifact' });
    assert.ok(f.container.querySelector('.host-artifact'));
    const rendered = preview(f.container); assertPassive(rendered.document);
    assert.equal(rendered.frame.title, 'guide.md');
    assert.equal(rendered.document.querySelector('h1').textContent, 'Fictional guide');
    assert.equal(rendered.document.querySelector('strong').textContent, 'Strong');
    assert.equal(rendered.document.querySelector('td').textContent, 'one');
    assert.equal(rendered.document.querySelector('code').textContent, '<script>literal code</script>\n');
    assert.match(rendered.document.body.textContent, /passive link/);
    assert.equal(f.container.querySelector('button,textarea'), null);
  });

  await t.test('HTML XSS fixture strips scripts, handlers, external assets and navigation through the public entry', async t => {
    const content = '<h2 onclick="fictional_active_marker()" style="color:red">Fictional HTML</h2><p>Keep <em>formatting</em></p>'
      + '<script>fictional_active_marker</script><a href="javascript:fictional_active_marker()" target="_top">Passive label</a>'
      + '<img src="data:image/png;base64,AA==" onerror="fictional_active_marker()"><form action="https://fictional.invalid/"><input></form>'
      + '<svg><script>fictional_active_marker</script></svg><iframe src="https://fictional.invalid/"></iframe><meta http-equiv="refresh" content="0;url=https://fictional.invalid/">';
    const f = await fixture(t, { name: 'mock.html', mimeType: 'text/html', content: new TextEncoder().encode(content) });
    const rendered = preview(f.container); assertPassive(rendered.document);
    assert.equal(rendered.document.querySelector('h2').textContent, 'Fictional HTML');
    assert.equal(rendered.document.querySelector('em').textContent, 'formatting');
    assert.match(rendered.document.body.textContent, /Passive label/);
  });

  await t.test('Markdown parsing does not inherit or mutate the host singleton options', async t => {
    const { marked } = await import('marked');
    const previous = marked.defaults.breaks;
    marked.setOptions({ breaks: true });
    try {
      const f = await fixture(t, { name: 'private.md', mimeType: 'text/markdown', content: 'Fictional first line\nsecond line' });
      assert.equal(preview(f.container).document.querySelector('br'), null);
      assert.equal(marked.defaults.breaks, true);
    } finally { marked.setOptions({ breaks: previous }); }
  });

  await t.test('filename fallback renders Markdown and HTML when the MIME is generic', async t => {
    const f = await fixture(t, { name: 'GUIDE.MD', mimeType: 'application/octet-stream', content: new TextEncoder().encode('# Fallback guide') });
    assert.equal(preview(f.container).document.querySelector('h1').textContent, 'Fallback guide');
    await f.render({ name: 'guide.htm', mimeType: '', content: '<p>Fallback HTML</p>' });
    assert.equal(preview(f.container).document.querySelector('p').textContent, 'Fallback HTML');
  });

  await t.test('code and text are escaped preformatted UTF-8, including BOM, with no highlighter', async t => {
    const content = '\uFEFFconst fictional = "<script>literal</script>";\n  café\n';
    const f = await fixture(t, { name: 'fixture.ts', mimeType: 'text/plain', content: new TextEncoder().encode(content) });
    assert.equal(f.container.querySelector('pre').textContent, content);
    assert.equal(f.container.querySelector('script,iframe,code'), null);
    await f.render({ name: 'empty.txt', mimeType: 'text/plain', content: '' });
    assert.equal(f.container.querySelector('pre').textContent, '');
  });

  await t.test('invalid UTF-8, NUL and binary-only inputs refuse a fabricated text preview', async t => {
    const f = await fixture(t, { name: 'broken.txt', mimeType: 'text/plain', content: new Uint8Array([0xc3, 0x28]) });
    for (const props of [
      { name: 'broken.txt', mimeType: 'text/plain', content: new Uint8Array([0xc3, 0x28]) },
      { name: 'binary.dat', mimeType: 'application/octet-stream', content: new Uint8Array([65, 0, 66]) },
      { name: 'binary.mp4', mimeType: 'video/mp4', content: new TextEncoder().encode('not a text preview') },
    ]) {
      await f.render(props);
      assert.equal(f.container.querySelector('pre,iframe,img'), null);
      assert.match(f.container.textContent, /unavailable/i);
    }
  });

  await t.test('URL-only text, Markdown and HTML never embed unsanitized host documents', async t => {
    const f = await fixture(t, { name: 'document.html', mimeType: 'text/html', url: 'https://fictional.invalid/untrusted' });
    for (const [name, mimeType] of [['document.html', 'text/html'], ['guide.md', 'text/markdown'], ['code.js', 'text/javascript']]) {
      await f.render({ name, mimeType, url: 'https://fictional.invalid/untrusted' });
      assert.equal(f.container.querySelector('iframe,img,pre'), null);
      assert.match(f.container.textContent, /unavailable/i);
    }
  });

  await t.test('PDF bytes use a sandboxed native frame and own only their object URLs across retarget and teardown', async t => {
    const content = new TextEncoder().encode('%PDF-1.4\n% fictional fixture\n%%EOF');
    const f = await fixture(t, { name: 'fictional.pdf', mimeType: 'application/pdf', content }, true);
    const frame = f.container.querySelector('iframe'); assert.ok(frame);
    assert.equal(frame.title, 'fictional.pdf'); assert.equal(frame.getAttribute('sandbox'), '');
    assert.equal(frame.getAttribute('referrerpolicy'), 'no-referrer');
    const first = frame.getAttribute('src'); assert.ok(made.has(first));
    assert.equal(made.get(first).type, 'application/pdf');
    assert.deepEqual(new Uint8Array(await made.get(first).arrayBuffer()), content);
    await f.render({ name: 'new.pdf', mimeType: 'application/pdf', content: new TextEncoder().encode('%PDF-1.4\n% second fixture') });
    const next = f.container.querySelector('iframe').getAttribute('src');
    assert.notEqual(next, first); assert.ok(revoked.includes(first));
    await f.render({ name: 'borrowed.pdf', mimeType: 'application/pdf', url: 'https://fictional.invalid/borrowed.pdf' });
    assert.ok(revoked.includes(next));
    assert.equal(f.container.querySelector('iframe').getAttribute('src'), 'https://fictional.invalid/borrowed.pdf');
    await f.unmount();
    assert.equal(revoked.includes('https://fictional.invalid/borrowed.pdf'), false);
    for (const [url] of made) assert.ok(revoked.includes(url), 'Every owned URL must be revoked');
  });

  await t.test('images accept string or bytes with a borrowed URL fallback and no stale source after retargeting', async t => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><text>Fictional image</text></svg>';
    const f = await fixture(t, { name: 'fictional.svg', mimeType: 'image/svg+xml', content: svg, url: 'https://fictional.invalid/ignored.svg' });
    const image = f.container.querySelector('img'); assert.ok(image); assert.equal(image.alt, 'fictional.svg');
    const first = image.getAttribute('src'); assert.equal(await made.get(first).text(), svg);
    await f.render({ name: 'fictional.png', mimeType: 'image/png', content: new Uint8Array([137, 80, 78, 71]) });
    const next = f.container.querySelector('img').getAttribute('src'); assert.notEqual(next, first); assert.ok(revoked.includes(first));
    await f.render({ name: 'borrowed.png', mimeType: 'image/png', url: 'https://fictional.invalid/borrowed.png' });
    assert.equal(f.container.querySelector('img').getAttribute('src'), 'https://fictional.invalid/borrowed.png'); assert.ok(revoked.includes(next));
    await f.render({ name: 'missing.png', mimeType: 'image/png' });
    assert.equal(f.container.querySelector('img,iframe'), null);
    await f.unmount(); assert.equal(revoked.includes('https://fictional.invalid/borrowed.png'), false);
  });

  await t.test('media URLs refuse executable or mismatched data schemes without revoking borrowed URLs', async t => {
    const f = await fixture(t, { name: 'safe.png', mimeType: 'image/png', url: '/fictional.png' });
    assert.equal(f.container.querySelector('img').getAttribute('src'), '/fictional.png');
    for (const [name, mimeType, url] of [
      ['bad.png', 'image/png', 'javascript:fictional()'],
      ['bad.pdf', 'application/pdf', 'data:text/html,<script>fictional()</script>'],
      ['bad.png', 'image/png', 'file:///fictional.png'],
    ]) {
      await f.render({ name, mimeType, url });
      assert.equal(f.container.querySelector('img,iframe'), null); assert.match(f.container.textContent, /unavailable/i);
      assert.equal(revoked.includes(url), false);
    }
    await f.render({ name: 'inline.png', mimeType: 'image/png', url: 'data:image/png;base64,AA==' });
    assert.equal(f.container.querySelector('img').getAttribute('src'), 'data:image/png;base64,AA==');
  });

  await t.test('optional trusted PDF renderer receives the current source without importing pdfjs', async t => {
    const seen = [];
    const renderPdf = props => { seen.push(props); return createElement('span', { 'data-host-pdf': true }, props.name + ':' + props.url); };
    const f = await fixture(t, { name: 'host.pdf', mimeType: 'application/pdf', url: 'https://fictional.invalid/host.pdf', renderPdf });
    assert.equal(f.container.querySelector('iframe'), null);
    assert.match(f.container.querySelector('[data-host-pdf]').textContent, /host\.pdf:https:/);
    assert.equal(seen.at(-1).url, 'https://fictional.invalid/host.pdf');
    await f.render({ name: 'new.pdf', mimeType: 'application/pdf', content: new TextEncoder().encode('%PDF-1.4'), renderPdf });
    assert.equal(seen.at(-1).name, 'new.pdf'); assert.ok(made.has(seen.at(-1).url));
  });

  await t.test('preview limits refuse locally and recover on replacement without retaining an old frame', async t => {
    const f = await fixture(t, { name: 'large.html', mimeType: 'text/html', content: 'x'.repeat(262145) });
    assert.equal(f.container.querySelector('iframe'), null); assert.match(f.container.textContent, /unavailable/i);
    await f.render({ name: 'small.html', mimeType: 'text/html', content: '<p>Small fictional replacement</p>' });
    const frame = preview(f.container).frame;
    await f.render({ name: 'missing.html', mimeType: 'text/html' });
    assert.equal(frame.isConnected, false); assert.equal(f.container.querySelector('iframe'), null);
  });

  await t.test('server rendering never embeds unparsed HTML or allocates an object URL', async () => {
    const { renderToStaticMarkup } = await import('react-dom/server');
    const count = made.size;
    const rendered = renderToStaticMarkup(createElement(ArtifactViewer, { name: 'server.html', mimeType: 'text/html', content: '<script>fictional_active_marker</script>' }));
    assert.doesNotMatch(rendered, /fictional_active_marker|<iframe/);
    renderToStaticMarkup(createElement(ArtifactViewer, { name: 'server.pdf', mimeType: 'application/pdf', content: new Uint8Array([37, 80, 68, 70]) }));
    assert.equal(made.size, count);
  });
});
