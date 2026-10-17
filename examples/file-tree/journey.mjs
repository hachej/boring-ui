import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { build } from 'esbuild';
import { launch, q } from '@hachej/boring-testing/browser';
import { webRequest, sendWebResponse } from '@hachej/boring-files/node-http';
import { openFileTreeHost } from './host.mjs';
import { buildTailwind } from '../../lab/studio/tailwind.mjs';

const evidence = resolve('.cache/evidence/file-tree-browser'); mkdirSync(evidence, { recursive: true });
const directory = mkdtempSync(join(tmpdir(), 'boring-file-tree-browser-'));
const report = { status: 'running', steps: [] };
let host, server, browser;
const record = () => writeFileSync(join(evidence, 'journey.json'), JSON.stringify(report, null, 2));
const step = async (name, action) => { const item = { name, status: 'running' }; report.steps.push(item); record(); await action(); item.status = 'passed'; record(); console.log(name); };
const row = path => `[role="treeitem"][data-path=${JSON.stringify(path)}]`;
const ready = (scope = 'first') => browser.until('file tree ready', `window.fileTreeFixture?.ready && window.fileTreeFixture.provider.identity.scopeId===${JSON.stringify(scope)} && !!document.querySelector('[role="treeitem"][data-path="docs"]')`);
try {
  host = await openFileTreeHost({ filename: join(directory, 'workspace.sqlite') });
  const bundle = await build({ entryPoints: [new URL('./view.jsx', import.meta.url).pathname], bundle: true, write: false, outfile: join(directory, 'view.js'), platform: 'browser', format: 'esm', jsx: 'automatic', metafile: true, define: { 'process.env.NODE_ENV': '"production"' } });
  assert.ok(!Object.keys(bundle.metafile.inputs).some(path => /packages\/files\/dist\/(?:workspace|sqlite|revision-handler)|pi-durable\//.test(path)), 'Browser bundle excludes server storage and Pi runtime');
  const css = [await buildTailwind(), ...bundle.outputFiles.filter(file => file.path.endsWith('.css')).map(file => file.text)].join('\n');
  const html = '<!doctype html><meta name="viewport" content="width=device-width"><title>File tree</title><link rel="stylesheet" href="/view.css"><style>body{font:16px system-ui;margin:0}main{padding:16px}main>button,main>section{margin:8px}main>h1{font-size:20px}</style><div id="root"></div><script type="module" src="/view.js"></script>';
  server = createServer(async (incoming, outgoing) => {
    try {
      const abort = new AbortController();
      outgoing.on('close', () => { if (!outgoing.writableFinished) abort.abort(); });
      const request = await webRequest(incoming, new URL(incoming.url, `http://${incoming.headers.host}`), { signal: abort.signal });
      if (!request) { await sendWebResponse(new Response(null, { status: 413 }), outgoing); return; }
      const path = new URL(request.url).pathname;
      const response = path === '/api/workspace' ? await host.handler(request) : path === '/view.css' ? new Response(css, { headers: { 'content-type': 'text/css' } }) : path === '/view.js' ? new Response(bundle.outputFiles.find(file => file.path.endsWith('view.js')).contents, { headers: { 'content-type': 'text/javascript' } }) : new Response(html, { headers: { 'content-type': 'text/html' } });
      await sendWebResponse(response, outgoing);
    } catch { outgoing.statusCode = 500; outgoing.end(); }
  });
  await new Promise((yes, no) => { server.once('error', no); server.listen(0, '127.0.0.1', yes); });
  browser = await launch(`http://127.0.0.1:${server.address().port}`, { evidence }); await browser.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false }); await ready();
  await step('default filtering, folder expansion and keyboard open', async () => {
    for (const path of ['node_modules', 'dist', 'debug.log']) assert.equal(await browser.evaluate(`!!${q(row(path))}`), false);
    await browser.click(q(`${row('docs')} button`));
    await browser.until('notes visible', `!!${q(row('docs/notes.md'))}`);
    assert.equal(await browser.evaluate(`getComputedStyle(${q('.file-tree-row-button')}).height`), '48px');
    assert.equal(await browser.evaluate(`getComputedStyle(${q('.file-tree-row-button svg')}).width`), '16px');
    assert.equal(await browser.evaluate(`getComputedStyle(${q('[data-slot=sidebar-menu-sub]')}).paddingLeft`), '10px');
    await browser.evaluate(`${q(row('docs/notes.md'))}.focus()`); await browser.press('Enter');
    assert.equal(await browser.evaluate(`${q('output[aria-label="Opened file"]')}.textContent`), 'docs/notes.md');
  });
  await step('filename search powers the actual mention picker', async () => {
    await browser.type(q('input[aria-label="File mention"]'), '@notes');
    await browser.until('mention result', `!!${q('[data-testid="mention-item"]')}`);
    await browser.click(q('[data-testid="mention-item"]'));
    await browser.until('mention selected', `${q('output[aria-label="Selected mention"]')}.textContent==='docs/notes.md'`);
    assert.equal(await browser.evaluate(`${q('output[aria-label="Selected mention"]')}.textContent`), 'docs/notes.md');
  });
  await step('binary upload publishes once and duplicate refuses', async () => {
    const file = join(directory, 'sample.bin'); writeFileSync(file, Buffer.from([0, 1, 255, 128]));
    await browser.evaluate('window.fileTreeFixture.holdNextPublish=true');
    await browser.attachFiles(q('input[aria-label="Upload files"]'), [file]);
    await browser.until('pending upload has a row and spinner', `!!${q('[role=treeitem][data-path="uploads/sample.bin"][data-upload-state=pending] [data-upload-spinner]')}`);
    assert.equal(await browser.evaluate(`${q('[role=treeitem][data-path="uploads/sample.bin"]')}.getAttribute('aria-busy')`), 'true');
    await browser.evaluate('window.fileTreeFixture.releasePublish()');
    await browser.until('upload saved', `${q('ul[aria-label="Uploads"]')}.textContent.includes('Saved')`);
    const read = await host.storage.workspace('first').read({ target: host.target('uploads/sample.bin'), revision: { kind: 'latest' } }, host.access('first'));
    assert.equal(read.kind, 'available'); assert.deepEqual([...read.snapshot.bytes], [0, 1, 255, 128]);
    await browser.attachFiles(q('input[aria-label="Upload files"]'), [file]);
    await browser.until('duplicate refused', `${q('ul[aria-label="Uploads"]')}.querySelectorAll('li').length===2 && !${q('ul[aria-label="Uploads"]')}.textContent.includes('Uploading')`);
    assert.equal(host.storage.workspace('first').saves('uploads/sample.bin').length, 1);
  });
  await step('lost acknowledgement reconciles without a second publication', async () => {
    const file = join(directory, 'recovery.txt'); writeFileSync(file, 'fictional recovery');
    await browser.evaluate('window.fileTreeFixture.dropNextPublish=true');
    await browser.attachFiles(q('input[aria-label="Upload files"]'), [file]);
    await browser.until('inline unconfirmed upload with Retry', `!!${q('[role=treeitem][data-path="uploads/recovery.txt"] button[data-upload-retry][aria-label="Check upload status"]')}`);
    assert.match(await browser.evaluate(`${q('[role=treeitem][data-path="uploads/recovery.txt"] [data-upload-error]')}.textContent`), /unconfirmed/);
    const attempts = await browser.evaluate('window.fileTreeFixture.publishCalls');
    await browser.click(q('[role=treeitem][data-path="uploads/recovery.txt"] button[data-upload-retry]'));
    await browser.until('reconciled upload', `${q('ul[aria-label="Uploads"]')}.lastElementChild.textContent.includes('Saved')`);
    assert.equal(host.storage.workspace('first').saves('uploads/recovery.txt').length, 1);
    assert.equal(await browser.evaluate('window.fileTreeFixture.publishCalls'), attempts, 'receipt lookup must not republish');
  });
  await step('retained history reads exact content without an editor mutation', async () => {
    const provider = host.storage.workspace('first');
    const previous = await provider.read({ target: host.target('docs/notes.md'), revision: { kind: 'latest' } }, host.access('first'));
    assert.equal(previous.kind, 'available');
    assert.equal((await host.publish('first', 'fictional-agent-edit', [{ kind: 'replace', target: previous.snapshot.ref, bytes: new TextEncoder().encode('# Agent changed notes\n'), mediaType: 'text/markdown' }])).kind, 'committed');
    await browser.click(q('button[aria-label="Actions for docs/notes.md"]'));
    await browser.click(q('[role=menuitem][data-action=history]'));
    await browser.until('history revisions', `${q('section[aria-label="History of docs/notes.md"]')}?.querySelectorAll('li button').length===2`);
    await browser.click(`${q('section[aria-label="History of docs/notes.md"]')}.querySelectorAll('li button')[1]`);
    await browser.until('exact old revision', `${q('[data-testid="file-history-preview"]')}?.dataset.revision===${JSON.stringify(previous.snapshot.ref.revision)}`);
    assert.match(await browser.evaluate(`${q('[data-testid="file-history-preview"]')}.textContent`), /first workspace/);
  });
  await step('workspace switch fences a delayed old listing', async () => {
    await browser.evaluate('window.fileTreeFixture.holdNextList=true');
    await browser.click("[...document.querySelectorAll('button')].find(b=>b.textContent==='Refresh')");
    await browser.until('old listing held', 'typeof window.fileTreeFixture.releaseList==="function"');
    await browser.click("[...document.querySelectorAll('button')].find(b=>b.textContent==='Switch workspace')"); await ready('second');
    await browser.evaluate('window.fileTreeFixture.releaseList()');
    await browser.click(q(`${row('docs')} button`));
    await browser.until('new workspace notes', `!!${q(row('docs/notes.md'))}`);
    const text = await browser.evaluate("window.fileTreeFixture.provider.read({target:window.fileTreeFixture.provider.locate('docs/notes.md'),revision:{kind:'latest'}}).then(r=>new TextDecoder().decode(r.snapshot.bytes))");
    assert.match(text, /second workspace/); assert.equal(await browser.evaluate(`!!${q(row('uploads'))}`), false);
    assert.equal(await browser.evaluate(`!!${q('[data-testid="file-history-preview"]')}`), false);
  });
  await step('integrated workspace protects a dirty editor during tree navigation', async () => {
    await browser.click("[...document.querySelectorAll('button')].find(b=>b.textContent==='Open integrated workspace')");
    await browser.until('library navigation', `!!${q('[data-testid=workspace-library]')}`);
    await browser.click(q('[data-testid=workspace-library]'));
    await browser.until('library center', `!!${q('[data-testid=workspace-library-view]')}`);
    await browser.click(q(`${row('first.html')} button`));
    await browser.until('three-column library layout', `(() => { const left=${q('[data-testid=conversations]')}?.getBoundingClientRect(), center=${q('[data-testid=workspace-library-view]')}?.getBoundingClientRect(), right=${q('[data-testid=workspace-panel]')}?.getBoundingClientRect(); return left && center && right && left.width>0 && center.width>200 && right.width>200 && left.right<=center.left+1 && center.right<=right.left+1; })()`);
    await browser.until('editor source mode', `!!${q('[data-testid="viewer-mode-source"]')}`);
    await browser.click(q('[data-testid="viewer-mode-source"]'));
    await browser.type(q('textarea[aria-label="HTML source"]'), '<p>Unsaved browser draft</p>');
    await browser.evaluate('window.confirm=()=>false');
    await browser.click(q(`${row('second.html')} button`));
    assert.equal(await browser.evaluate(`${q('[data-testid="file-viewer"]')}.dataset.path`), 'first.html');
    assert.match(await browser.evaluate(`${q('textarea[aria-label="HTML source"]')}.value`), /Unsaved browser draft/);
    await browser.evaluate('window.confirm=()=>true');
    await browser.click(q(`${row('second.html')} button`));
    await browser.until('second editor', `${q('[data-testid="file-viewer"]')}?.dataset.path==='second.html'`);
    const unchanged = await host.storage.workspace('second').read({ target: host.target('first.html'), revision: { kind: 'latest' } }, host.access('second'));
    assert.equal(new TextDecoder().decode(unchanged.snapshot.bytes), '<p>First file</p>');
  });
  await step('side Library column beside the viewer: desktop and a 390x844 phone sheet', async () => {
    const tab = await browser.openTab(`http://127.0.0.1:${server.address().port}/?side=1`);
    const shot = async name => writeFileSync(join(evidence, name), Buffer.from((await tab.send('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
    const click = selector => tab.evaluate(`${q(selector)}.click()`);
    const box = selector => `(() => { const r = ${q(selector)}.getBoundingClientRect(); return { x: r.x, right: r.right, width: r.width, height: r.height }; })()`;
    try {
      await tab.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
      await tab.until('integrated workspace', `!!${q('[data-testid=workspace-library]')}`);
      assert.equal(await tab.evaluate(`${q('[data-dock=library]')}.dataset.placement`), 'closed', 'the Library column starts closed');
      await click('[data-testid=workspace-library]');
      await tab.until('column alone at the right edge', `${q('[data-dock=library]')}.dataset.placement === 'docked' && !!${q(row('first.html'))} && !${q('[data-testid=viewer-panel]')}`);
      const alone = await tab.evaluate(box('[data-dock=library]'));
      const workspaceEdge = (await tab.evaluate(box('[data-boring=agent-workspace]'))).right;
      assert.ok(Math.abs(alone.right - workspaceEdge) < 2, `the column is at the workspace's right edge: ${JSON.stringify(alone)} in ${workspaceEdge}`);
      await click(`${row('first.html')} button`);
      await tab.until('viewer left of the column', `(() => { const v = ${q('[data-testid=workspace-panel]')}?.getBoundingClientRect(), l = ${q('[data-dock=library]')}.getBoundingClientRect(); return !!v && v.right <= l.x + 2 && l.width > 200 && ${q('[data-dock=library]')}.dataset.placement === 'docked'; })()`);
      await new Promise(resolve => setTimeout(resolve, 400));
      await shot('library-side-desktop.png');
      assert.equal(await tab.evaluate(`${q('[data-testid="file-viewer"]')}.dataset.path`), 'first.html');
      assert.equal(await tab.evaluate(`${q('[data-testid=viewer-library]')}.getAttribute('aria-pressed')`), 'true');
      await click('[data-testid=viewer-library]');
      await tab.until('column closed from the viewer bar', `${q('[data-dock=library]')}.dataset.placement === 'closed' && ${q('[data-testid=workspace-library]')}.getAttribute('aria-pressed') === 'false'`);
      assert.equal(await tab.evaluate(`${q('[data-testid="file-viewer"]')}.dataset.path`), 'first.html', 'the viewer is untouched');
      await click('[data-testid=workspace-library]');
      await tab.until('column reopened from the left pane', `${q('[data-dock=library]')}.dataset.placement === 'docked'`);
      await tab.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
      await tab.until('phone layout', `innerWidth === 390 && ${q('[data-boring=agent-workspace]')}.dataset.sessions === 'closed'`);
      // The open column becomes a full-screen sheet on a phone.
      await tab.until('Library sheet', `${q('[data-dock=library]')}.dataset.placement === 'sheet'`);
      assert.deepEqual(await tab.evaluate(box('[data-dock=library]')), { x: 0, right: 390, width: 390, height: 844 }, 'a full-screen sheet');
      await shot('library-side-phone-sheet.png');
      await click(`${row('second.html')} button`);
      await tab.until('sheet closed, viewer shown', `${q('[data-dock=library]')}.dataset.placement === 'closed' && ${q('[data-testid="file-viewer"]')}?.dataset.path === 'second.html'`);
      await click('[data-testid=viewer-library]');
      await tab.until('sheet again from the viewer bar', `${q('[data-dock=library]')}.dataset.placement === 'sheet'`);
      await click('[data-testid=workspace-library-side] button[aria-label="Close Library"]');
      await tab.until('sheet closed by its button', `${q('[data-dock=library]')}.dataset.placement === 'closed'`);
      await shot('library-side-phone-viewer.png');
    } finally { await tab.close(); }
  });
  await step('side Library never clips the viewer (~800 and ~1024 px) and leaves a full-screen viewer', async () => {
    const tab = await browser.openTab(`http://127.0.0.1:${server.address().port}/?side=1`);
    const click = selector => tab.evaluate(`${q(selector)}.click()`);
    const box = selector => `(() => { const e = ${q(selector)}; if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x, right: r.right, width: r.width }; })()`;
    const metrics = width => tab.send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false });
    try {
      await metrics(1440);
      await tab.until('integrated workspace', `!!${q('[data-testid=workspace-library]')}`);
      await click('[data-testid=workspace-library]');
      await tab.until('tree', `!!${q(row('first.html'))}`);
      await click(`${row('first.html')} button`);
      await tab.until('viewer', `!!${q('[data-testid=file-viewer]')}`);
      // Library docked or a sheet: when docked, the chat and the viewer keep their minimums and the viewer's bar is not clipped.
      const fits = `(() => { const lib = ${q('[data-dock=library]')}, v = ${q('[data-testid=workspace-panel]')}, c = ${q('[data-testid=workspace-chat]')}, bar = ${q('[data-testid=viewer-bar]')};
        if (lib.dataset.placement === 'sheet') return 'sheet'; if (lib.dataset.placement !== 'docked') return 'closed';
        const vr = v.getBoundingClientRect(), cr = c.getBoundingClientRect(), lr = lib.getBoundingClientRect();
        return vr.width >= 360 && cr.width >= 330 && vr.right <= lr.x + 2 && bar.scrollWidth <= bar.clientWidth + 1 ? 'docked' : 'clipped ' + JSON.stringify({ viewer: vr.width, chat: cr.width, lib: lr.width }); })()`;
      for (const [width, expected] of [[1440, 'docked'], [1056, 'sheet'], [832, 'sheet']]) {
        await metrics(width);
        await tab.until(`layout at ${width}`, `innerWidth === ${width}`);
        await new Promise(resolve => setTimeout(resolve, 500));
        assert.equal(await tab.evaluate(fits), expected, `Library layout at ${width}px`);
      }
      // Full screen: opening the Library from the viewer bar leaves full screen, so the column is reachable.
      await metrics(1440);
      await tab.until('wide again', `innerWidth === 1440 && ${q('[data-dock=library]')}.dataset.placement === 'docked'`);
      await click('[data-testid=viewer-library]');
      await tab.until('column closed', `${q('[data-dock=library]')}.dataset.placement === 'closed'`);
      await click('[data-testid=viewer-more]');
      await tab.until('fullscreen menu action', `!!${q('[data-testid=viewer-fullscreen]')}`);
      await click('[data-testid=viewer-fullscreen]');
      await tab.until('full screen', `${q('[data-testid=workspace-panel]')}.dataset.fullscreen === 'true'`);
      await click('[data-testid=viewer-library]');
      await tab.until('reachable column', `${q('[data-testid=workspace-panel]')}.dataset.fullscreen === 'false' && ${q('[data-dock=library]')}.dataset.placement === 'docked'`);
      const edge = await tab.evaluate(`(() => { const r = ${q('[data-dock=library]')}.getBoundingClientRect(); const hit = document.elementFromPoint(r.x + r.width / 2, r.y + 60); return !!hit && ${q('[data-dock=library]')}.contains(hit); })()`);
      assert.equal(edge, true, 'the open Library column is the topmost element at its position');
    } finally { await tab.close(); }
  });
  await step('portable tree works in a detached page without workspace or sidebar context', async () => {
    const detached = await browser.openTab(`http://127.0.0.1:${server.address().port}/?detached=1`);
    try {
      await detached.until('detached tree', `!!${q(row('docs'))}`);
      assert.equal(await detached.evaluate(`!!${q('[data-boring="agent-workspace"]')}`), false);
      await detached.evaluate(`${q(row('docs'))}.focus()`);
      await detached.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 });
      await detached.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 });
      await detached.until('detached notes', `!!${q(row('docs/notes.md'))}`);
      assert.equal(await detached.evaluate(`getComputedStyle(${q('.file-tree-row-button')}).height`), '48px');
      await detached.evaluate(`${q(row('docs/notes.md'))}.focus()`);
      await detached.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
      await detached.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
      await detached.until('detached file opened', `${q('output[aria-label="Opened file"]')}.textContent==='docs/notes.md'`);
      assert.equal(await detached.evaluate(`${q('output[aria-label="Opened file"]')}.textContent`), 'docs/notes.md');
    } finally { await detached.close(); }
    assert.equal(await browser.evaluate('window.fileTreeFixture.provider.identity.scopeId'), 'second');
    assert.equal((await host.storage.workspace('first').read({ target: host.target('docs/notes.md'), revision: { kind: 'latest' } }, host.access('first'))).kind, 'available');
  });
  await step('plain nested search results keep filename and parent on one visible line', async () => {
    const plain = await browser.openTab(`http://127.0.0.1:${server.address().port}/?detached&plain`);
    try {
      await plain.send('Emulation.setDeviceMetricsOverride', { width: 360, height: 800, deviceScaleFactor: 1, mobile: true });
      await plain.until('plain search', `!!${q('input[type=search]')}`);
      await plain.evaluate(`${q('input[type=search]')}.focus()`);
      await plain.send('Input.insertText', { text: 'notes' });
      await plain.until('nested result', `!!${q('[data-path="docs/notes.md"] .file-tree-parent')}`);
      const layout = await plain.evaluate(`(() => { const row=${q('[data-path="docs/notes.md"]')}, copy=row.querySelector('.file-tree-copy'), name=row.querySelector('.file-tree-name').getBoundingClientRect(), parent=row.querySelector('.file-tree-parent').getBoundingClientRect(); return { direction:getComputedStyle(copy).flexDirection, nameWidth:name.width, parentWidth:parent.width, aligned:Math.abs(name.y+name.height/2-parent.y-parent.height/2)<1, ordered:name.right<=parent.left+1 }; })()`);
      assert.equal(layout.direction, 'row'); assert.ok(layout.aligned && layout.ordered && layout.nameWidth>0 && layout.parentWidth>0, JSON.stringify(layout));
    } finally { await plain.close(); }
  });
  assert.deepEqual(browser.problems, []); report.status = 'passed';
} catch (error) { report.status = 'failed'; report.error = String(error.stack ?? error); throw error; }
finally { record(); await browser?.close(); await new Promise(resolve => server ? server.close(resolve) : resolve()); host?.close(); rmSync(directory, { recursive: true, force: true }); }
