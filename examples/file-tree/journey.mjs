import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { build } from 'esbuild';
import { launch, q } from '@hachej/boring-testing/browser';
import { webRequest, sendWebResponse } from '@hachej/boring-files/node-http';
import { openFileTreeHost } from './host.mjs';

const evidence = resolve('.cache/evidence/file-tree-browser'); mkdirSync(evidence, { recursive: true });
const directory = mkdtempSync(join(tmpdir(), 'boring-file-tree-browser-'));
const report = { status: 'running', steps: [] };
let host, server, browser;
const record = () => writeFileSync(join(evidence, 'journey.json'), JSON.stringify(report, null, 2));
const step = async (name, action) => { const item = { name, status: 'running' }; report.steps.push(item); record(); await action(); item.status = 'passed'; record(); console.log(name); };
const row = path => `[role="treeitem"][data-path=${JSON.stringify(path)}]`;
const ready = (scope = 'first') => browser.until('file tree ready', `window.fileTreeFixture?.ready && window.fileTreeFixture.provider.identity.scopeId===${JSON.stringify(scope)} && document.querySelector('[role="treeitem"][data-path="docs"]')`);
try {
  host = await openFileTreeHost({ filename: join(directory, 'workspace.sqlite') });
  const bundle = await build({ entryPoints: [new URL('./view.jsx', import.meta.url).pathname], bundle: true, write: false, platform: 'browser', format: 'esm', metafile: true, define: { 'process.env.NODE_ENV': '"production"' } });
  assert.ok(!Object.keys(bundle.metafile.inputs).some(path => /packages\/files\/dist\/(?:workspace|sqlite|revision-handler)|pi-durable\//.test(path)), 'Browser bundle excludes server storage and Pi runtime');
  const html = '<!doctype html><meta name="viewport" content="width=device-width"><title>File tree</title><style>body{font:16px system-ui;max-width:900px;margin:24px}button,input{font:inherit;margin:4px;padding:6px}ul{list-style:none}button:focus,li:focus{outline:2px solid blue}pre{white-space:pre-wrap}section{border:1px solid #ddd;margin:12px 0;padding:12px}</style><div id="root"></div><script type="module" src="/view.js"></script>';
  server = createServer(async (incoming, outgoing) => {
    try {
      const abort = new AbortController();
      outgoing.on('close', () => { if (!outgoing.writableFinished) abort.abort(); });
      const request = await webRequest(incoming, new URL(incoming.url, `http://${incoming.headers.host}`), { signal: abort.signal });
      if (!request) { await sendWebResponse(new Response(null, { status: 413 }), outgoing); return; }
      const path = new URL(request.url).pathname;
      const response = path === '/api/workspace' ? await host.handler(request) : path === '/view.js' ? new Response(bundle.outputFiles[0].contents, { headers: { 'content-type': 'text/javascript' } }) : new Response(html, { headers: { 'content-type': 'text/html' } });
      await sendWebResponse(response, outgoing);
    } catch { outgoing.statusCode = 500; outgoing.end(); }
  });
  await new Promise((yes, no) => { server.once('error', no); server.listen(0, '127.0.0.1', yes); });
  browser = await launch(`http://127.0.0.1:${server.address().port}`, { evidence }); await ready();
  await step('default filtering, folder expansion and keyboard open', async () => {
    for (const path of ['node_modules', 'dist', 'debug.log']) assert.equal(await browser.evaluate(`!!${q(row(path))}`), false);
    await browser.click(q(`${row('docs')} button`));
    await browser.until('notes visible', `!!${q(row('docs/notes.md'))}`);
    await browser.evaluate(`${q(row('docs/notes.md'))}.focus()`); await browser.press('Enter');
    assert.equal(await browser.evaluate(`${q('output[aria-label="Opened file"]')}.textContent`), 'docs/notes.md');
  });
  await step('filename search powers the actual mention picker', async () => {
    await browser.type(q('input[aria-label="File mention"]'), '@notes');
    await browser.until('mention result', `!!${q('[data-testid="mention-item"]')}`);
    await browser.click(q('[data-testid="mention-item"]'));
    assert.equal(await browser.evaluate(`${q('output[aria-label="Selected mention"]')}.textContent`), 'docs/notes.md');
  });
  await step('binary upload publishes once and duplicate refuses', async () => {
    const file = join(directory, 'sample.bin'); writeFileSync(file, Buffer.from([0, 1, 255, 128]));
    await browser.attachFiles(q('input[aria-label="Upload files"]'), [file]);
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
    await browser.until('reconciliation button', "[...document.querySelectorAll('button')].some(b=>b.textContent==='Check upload status')");
    const attempts = await browser.evaluate('window.fileTreeFixture.publishCalls');
    await browser.click("[...document.querySelectorAll('button')].find(b=>b.textContent==='Check upload status')");
    await browser.until('reconciled upload', `${q('ul[aria-label="Uploads"]')}.lastElementChild.textContent.includes('Saved')`);
    assert.equal(host.storage.workspace('first').saves('uploads/recovery.txt').length, 1);
    assert.equal(await browser.evaluate('window.fileTreeFixture.publishCalls'), attempts, 'receipt lookup must not republish');
  });
  await step('retained history reads exact content without an editor mutation', async () => {
    const provider = host.storage.workspace('first');
    const previous = await provider.read({ target: host.target('docs/notes.md'), revision: { kind: 'latest' } }, host.access('first'));
    assert.equal(previous.kind, 'available');
    assert.equal((await host.publish('first', 'fictional-agent-edit', [{ kind: 'replace', target: previous.snapshot.ref, bytes: new TextEncoder().encode('# Agent changed notes\n'), mediaType: 'text/markdown' }])).kind, 'committed');
    await browser.click(q('button[aria-label="History of docs/notes.md"]'));
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
    await browser.until('integrated files', `!!${q(row('first.html'))}`);
    await browser.click(q('summary'));
    await browser.click(q(`${row('first.html')} button`));
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
  assert.deepEqual(browser.problems, []); report.status = 'passed';
} catch (error) { report.status = 'failed'; report.error = String(error.stack ?? error); throw error; }
finally { record(); await browser?.close(); await new Promise(resolve => server ? server.close(resolve) : resolve()); host?.close(); rmSync(directory, { recursive: true, force: true }); }
