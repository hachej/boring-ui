import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { build } from 'esbuild';
import { Harness, createRegistry, defineExtension } from '@earendil-works/pi-durable';
import { openNodeSqliteStorage } from '@earendil-works/pi-durable/storage/sqlite/node';
import { createModels } from '@earendil-works/pi-ai/models';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import { createResourceHandler } from '@hachej/boring-files/remote';
import { launch } from '@hachej/boring-testing/browser';
import { openSqliteWorkspaces } from '../examples/shared/sqlite-workspaces.mjs';
import { createTaskListTools } from '../examples/shared/task-list-tools.mjs';
import { serializeTaskList, taskListMediaType } from '../registry/task-list-viewer/task-list-document.ts';
import { admitDocumentTool, toolResultText } from '../test/fixtures/native-document.mjs';

const evidence = resolve(process.env.TASK_LIST_EVIDENCE ?? '.cache/evidence/task-list-browser');
mkdirSync(evidence, { recursive: true });
const directory = mkdtempSync(join(tmpdir(), 'boring-task-list-browser-'));
const report = { status: 'running', steps: [], native: [] };
const identity = { scopeId: 'fictional', principalId: 'browser', initiatorId: 'journey' };
const target = { resource: { providerId: 'tasks', path: 'tasks.json' }, view: { kind: 'published' } };
const notesTarget = { resource: { providerId: 'notes', path: 'notes.md' }, view: { kind: 'published' } };
let denied = false, writes = 0, notesWrites = 0, browser, server, origin, harness, conversation;
const files = openSqliteWorkspaces({ filename: join(directory, 'tasks.sqlite'), providerId: 'tasks', authorize: action => !denied || action === 'read' || action === 'lookup' });
const notes = openSqliteWorkspaces({ filename: join(directory, 'notes.sqlite'), providerId: 'notes' });
const read = async (provider = files, selected = target) => { const result = await provider.read({ target: selected, revision: { kind: 'latest' } }, identity); assert.equal(result.kind, 'available'); return result.snapshot; };
const doc = async () => JSON.parse(new TextDecoder().decode((await read()).bytes));
const run = body => browser.evaluate(`(async () => { const j = window.taskList; ${body} })()`);
const button = label => `[...document.querySelector('[data-boring="task-list-viewer"]').querySelectorAll('button')].find(button => button.textContent === ${JSON.stringify(label)})`;
const check = () => browser.click('document.querySelector("[data-boring=task-list-viewer] input[type=checkbox]")');
const settled = kind => browser.until(`task save ${kind}`, `window.taskList.state().save.kind === 'settled' && window.taskList.state().save.result.kind === ${JSON.stringify(kind)}`);
const step = async (name, action) => { const item = { name, status: 'running' }; report.steps.push(item); try { await action(); item.status = 'passed'; } catch (error) { item.status = 'failed'; item.error = String(error); throw error; } };
const native = async args => { const id = await admitDocumentTool(conversation, args, 'edit_task_list'); const outcome = await toolResultText(harness, conversation, id); const result = JSON.parse(outcome.text); report.native.push({ id, result }); return result; };
async function external(operations) { const snapshot = await read(); return native({ expected: { kind: 'revision', revision: snapshot.ref.revision }, operations }); }
try {
  await step('bundle real custom viewer and Markdown without native/server code', async () => {
    const result = await build({ entryPoints: ['test/fixtures/task-list-browser.jsx'], outdir: directory, entryNames: 'fixture', bundle: true, platform: 'browser', format: 'esm', metafile: true, define: { 'process.env.NODE_ENV': '"production"' } });
    assert.deepEqual(Object.keys(result.metafile.inputs).filter(path => /pi-durable|packages\/(agent|execution)\/|sqlite|task-list-tools|node:fs/.test(path)), []);
    writeFileSync(join(evidence, 'bundle.json'), JSON.stringify(result.metafile, null, 2));
  });
  await step('real SQLite resources and native tools save before browser exists', async () => {
    const initial = { kind: 'fictional.task-list', version: 1, items: [{ id: 'one', title: 'Fictional task', completed: false }] };
    for (const [provider, selected, text, mediaType] of [[files, target, serializeTaskList(initial), taskListMediaType], [notes, notesTarget, '# Independent fictional notes\n', 'text/markdown']]) {
      const seeded = await provider.publication.publish({ operationId: 'seed', atomicity: 'all-or-nothing', changes: [{ kind: 'create', target: selected, expected: { kind: 'absent' }, bytes: new TextEncoder().encode(text), mediaType }] }, identity);
      assert.equal(seeded.kind, 'committed');
    }
    const registry = createRegistry();
    const extension = defineExtension({ name: 'fictional.task-list.native', tools: createTaskListTools({ namespace: 'task-browser', resolve: async () => ({ bindingId: 'tasks-original', reader: files, publisher: files.publication, lookup: files.reconciliation, target, access: identity }) }) });
    registry.install(extension);
    harness = await Harness.open(await openNodeSqliteStorage(join(directory, 'native.sqlite')), { registry, models: createModels() }, context);
    conversation = await harness.root(context); await conversation.configure({ extensions: [extension] }, context);
    assert.equal((await external([{ kind: 'rename', id: 'one', title: 'Headless saved task' }])).kind, 'saved');
    assert.equal((await doc()).items[0].title, 'Headless saved task');
  });
  await step('authenticated HTTP resource bridge and actual Chromium', async () => {
    const authenticate = async request => request.headers.get('authorization') === 'Bearer fictional-browser' && request.headers.get('origin') === origin ? identity : null;
    const handlers = new Map([['/tasks', createResourceHandler({ authenticate, reader: files, lookup: files.reconciliation, publisher: { publish: (request, access) => { writes++; return files.publication.publish(request, access); } } })],
      ['/notes', createResourceHandler({ authenticate, reader: notes, lookup: notes.reconciliation, publisher: { publish: (request, access) => { notesWrites++; return notes.publication.publish(request, access); } } })]]);
    server = createServer(async (incoming, outgoing) => {
      const cancellation = new AbortController(); outgoing.on('close', () => { if (!outgoing.writableEnded) cancellation.abort(); });
      try {
        const url = new URL(incoming.url, origin);
        if (handlers.has(url.pathname)) {
          const chunks = []; let size = 0;
          for await (const chunk of incoming) { size += chunk.length; if (size > 1024 * 1024) { outgoing.writeHead(413).end(); return; } chunks.push(chunk); }
          const request = new Request(url, { method: incoming.method, headers: incoming.headers, signal: cancellation.signal, ...(incoming.method === 'POST' ? { body: Buffer.concat(chunks) } : {}) });
          const response = await handlers.get(url.pathname)(request);
          if (!outgoing.destroyed) { outgoing.writeHead(response.status, Object.fromEntries(response.headers)); outgoing.end(Buffer.from(await response.arrayBuffer())); }
        } else if (url.pathname === '/fixture.js' || url.pathname === '/fixture.css') {
          outgoing.writeHead(200, { 'content-type': url.pathname.endsWith('.js') ? 'text/javascript' : 'text/css' }); outgoing.end(readFileSync(join(directory, url.pathname.slice(1))));
        } else if (url.pathname === '/') { outgoing.writeHead(200, { 'content-type': 'text/html' }); outgoing.end('<!doctype html><title>Fictional tasks</title><div id="root"></div><script type="module" src="/fixture.js"></script>'); }
        else outgoing.writeHead(404).end();
      } catch (error) { if (!outgoing.destroyed) outgoing.writeHead(500).end(String(error)); }
    });
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    origin = `http://127.0.0.1:${server.address().port}`; browser = await launch(origin, { evidence });
    await browser.until('custom viewer mounted', '!!window.taskList?.fixture'); assert.equal(writes, 0); assert.equal(notesWrites, 0);
  });
  await step('real checkbox draft then explicit save receipt and reload', async () => {
    const before = await read(); await check(); assert.equal(writes, 0); assert.deepEqual(await read(), before);
    await browser.click(button('Save')); await settled('saved'); assert.equal(writes, 1); assert.equal((await doc()).items[0].completed, true);
    const receipt = await run('return j.state().save.result.receipt;'); assert.deepEqual((await files.reconciliation.lookup(receipt.operationId, identity)).receipt, receipt);
    await browser.reload(); await browser.until('reloaded saved checkbox', 'window.taskList?.fixture && document.querySelector("[data-boring=task-list-viewer] input[type=checkbox]").checked');
  });
  await step('native concurrent save cannot overwrite or absorb human dirty draft', async () => {
    await check(); const draft = await run('return j.state().text;');
    assert.equal((await external([{ kind: 'rename', id: 'one', title: 'Other writer' }])).kind, 'saved');
    await browser.click(button('Refresh')); await browser.until('remote conflict visible', '!!window.taskList.state().remote'); assert.equal(await run('return j.state().text;'), draft);
    await browser.click(button('Save')); await settled('conflict'); assert.equal(await run('return j.state().text;'), draft); assert.equal((await doc()).items[0].title, 'Other writer');
    await browser.click(button('Discard')); await browser.until('discard adopts remote', '!window.taskList.state().dirty && window.taskList.state().document.items[0].title === "Other writer"');
  });
  await step('late save acknowledgement preserves a newer draft', async () => {
    await check(); await run('j.faults.hold = true;'); await browser.click(button('Save'));
    await browser.until('publication acknowledgement held', 'window.taskList.faults.held'); await check(); const draft = await run('return j.state().text;'); await run('j.release();'); await settled('saved');
    assert.equal(await run('return j.state().text;'), draft); assert.equal(await run('return j.state().dirty;'), true); assert.equal((await doc()).items[0].completed, false);
    await browser.click(button('Refresh')); await browser.click(button('Discard')); await browser.until('draft explicitly discarded', '!window.taskList.state().dirty');
  });
  await step('denial and lost acknowledgement are visible; reconciliation never republishes', async () => {
    await check(); denied = true; await browser.click(button('Save')); await settled('denied'); assert.equal(await run('return j.state().dirty;'), true);
    denied = false; await run('j.faults.lost = true;'); await browser.click(button('Save')); await settled('unknown'); const count = writes;
    await browser.click(button('Reconcile')); await settled('saved'); assert.equal(writes, count); assert.equal((await doc()).items[0].completed, true);
  });
  await step('readonly and stale target refuse local changes', async () => {
    await run('await j.mount(true);'); assert.equal(await run('return document.querySelector("[data-boring=task-list-viewer] input[type=checkbox]").disabled;'), true);
    assert.equal(await run('return j.fixture.controller.actions.edit(j.fixture.controller.actions.selection(), [{kind:"remove",id:"one"}]).kind;'), 'denied');
    await run('await j.mount(); const old=j.fixture.controller.actions.selection(); j.fixture.controller.actions.edit(old,[{kind:"set-completed",id:"one",completed:false}]); return j.fixture.controller.actions.edit(old,[{kind:"remove",id:"one"}]).kind;').then(value => assert.equal(value, 'stale'));
  });
  await step('failed attachments and viewer collisions leave installed instances intact', async () => {
    const checked = await run('return j.compositionChecks();'); assert.deepEqual(checked.keys, ['fictional.task-list']); assert.equal(checked.failures.length, 3); assert.deepEqual(checked.rolledBack, ['disposed']); assert.equal(checked.taskActive, 'active'); assert.equal(checked.notesActive, 'active');
  });
  await step('custom viewer removal and provider denial leave Markdown provider usable', async () => {
    const before = await read(); denied = true; await run('await j.detachTasks(); j.fixture.markdown.actions.edit("# Independent still works\\n"); return j.fixture.markdown.flush(j.fixture.markdown.actions.selection());').then(value => assert.equal(value.kind, 'saved'));
    assert.equal(notesWrites, 1); assert.deepEqual(await read(), before); assert.equal(await run('return j.fixture.markdown.getSnapshot().lifecycle;'), 'active');
    assert.equal((await external([{ kind: 'rename', id: 'one', title: 'Denied native' }])).kind, 'denied');
  });
  assert.deepEqual(browser.problems.filter(problem => problem.startsWith('exception:')), []); await browser.screenshot('task-list-independent-notes.png'); report.status = 'passed';
} catch (error) { report.status = 'failed'; report.error = String(error); process.exitCode = 1; console.error(error); }
finally {
  if (browser) { await run('j.release();').catch(() => {}); report.browserProblems = browser.problems; await browser.close(); }
  if (server?.listening) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  if (harness) await harness.close(context); files.close(); notes.close(); rmSync(directory, { recursive: true, force: true });
  writeFileSync(join(evidence, 'report.json'), JSON.stringify(report, null, 2)); console.log(`Task-list browser journey ${report.status}: ${evidence}`);
}
