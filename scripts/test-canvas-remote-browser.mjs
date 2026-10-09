import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { build } from 'esbuild';
import { Harness, createRegistry, defineExtension } from '@earendil-works/pi-durable';
import { openNodeSqliteStorage } from '@earendil-works/pi-durable/storage/sqlite/node';
import { Type } from '@earendil-works/pi-ai';
import { createModels } from '@earendil-works/pi-ai/models';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import { createPresentationTool } from '@hachej/boring-agent/presentation';
import { createTLSchema, DocumentRecordType, PageRecordType, TLDOCUMENT_ID, toRichText } from '@tldraw/tlschema';
import { createResourceHandler } from '@hachej/boring-files/remote';
import { canvasMediaType } from '@hachej/boring-ui-kit/canvas-document';
import { launch } from '@hachej/boring-testing/browser';
import { createCanvasTransport } from '../examples/shared/canvas-transport-server.mjs';
import { openSqliteWorkspaces } from '../examples/shared/sqlite-workspaces.mjs';
import { admitDocumentTool, toolResultText } from '../test/fixtures/native-document.mjs';
import { runCaptured } from './run-captured.mjs';

const evidence = resolve(process.env.CANVAS_REMOTE_EVIDENCE ?? '.cache/evidence/canvas-remote-browser');
mkdirSync(evidence, { recursive: true });
const directory = mkdtempSync(join(tmpdir(), 'boring-canvas-remote-browser-'));
const report = { status: 'running', steps: [], nativeResults: [] };
const access = { scopeId: 'fictional', principalId: 'browser', initiatorId: 'journey' };
const target = { resource: { providerId: 'fictional', path: 'board.canvas' }, view: { kind: 'published' } };
const files = openSqliteWorkspaces({ filename: join(directory, 'canvas.sqlite'), providerId: 'fictional' });
const registry = createRegistry(), activePolls = new Map(), bindings = new Map();
let browser, server, harness, conversation, bridge, origin, revocation = new AbortController(), publications = 0, lastPublication;
const step = async (name, action) => {
  const item = { name, status: 'running' }; report.steps.push(item);
  try { await action(); item.status = 'passed'; }
  catch (error) { item.status = 'failed'; item.error = String(error); throw error; }
};
const saved = async () => {
  const read = await files.read({ target, revision: { kind: 'latest' } }, access);
  assert.equal(read.kind, 'available'); return read.snapshot;
};
const document = async () => JSON.parse(new TextDecoder().decode((await saved()).bytes));
const run = body => browser.evaluate(`(async () => { const j = window.canvasRemote; ${body} })()`);
const ready = () => browser.until('actual mounted canvas', '!!(window.canvasRemote?.fixture.tools?.getTarget() && window.canvasRemote.fixture.editor)');
const button = label => `[...document.querySelectorAll('button')].find(button => button.textContent.trim() === ${JSON.stringify(label)})`;
async function pollReady(id) {
  const until = Date.now() + 5000;
  while (!activePolls.has(id)) { assert.ok(Date.now() < until, 'Browser has a live serial poll'); await delay(10); }
}
async function attach() {
  const previous = await run('return j.fixture.transport?.id ?? null;');
  await browser.click(button('Connect agent'));
  await browser.until('explicit mounted connection opened', `window.canvasRemote.fixture.transport && window.canvasRemote.fixture.transport.id !== ${JSON.stringify(previous)} && document.getElementById("connection").textContent.startsWith("Connected")`);
  const selected = await run('return { id: j.fixture.transport.id, target: j.fixture.transport.target };');
  const connection = bridge.getConnection(selected.id);
  assert.ok(connection); assert.deepEqual(connection.target, selected.target);
  const names = {};
  const tools = ['select', 'propose'].map(command => {
    const name = `remote_canvas_${command}_${connection.id.replaceAll('-', '')}`;
    names[command] = name;
    return createPresentationTool({ name, description: `Fictional ${command} on one captured mounted canvas`,
      parameters: command === 'select' ? Type.Object({ shapeIds: Type.Array(Type.String()) }, { additionalProperties: false })
        : Type.Object({ edits: Type.Array(Type.Any()), summary: Type.String() }, { additionalProperties: false }),
      command: connection[command], target: connection.target, prepareInput: args => ({ ...args, expiresAt: Date.now() + 30000 }),
      authorize: (_input, captured, api) => api.conversationId === conversation.id && !revocation.signal.aborted && captured.subject.scopeId === access.scopeId,
      formatResult: result => ({ content: [{ type: 'text', text: JSON.stringify(result) }] }),
    });
  });
  const extension = defineExtension({ name: `fixture.remote.${connection.id}`, tools });
  registry.install(extension);
  bindings.set(connection.id, { connection, names, extension });
  await conversation.configure({ extensions: [...bindings.values()].map(binding => binding.extension) }, context);
  await pollReady(connection.id);
  return bindings.get(connection.id);
}
async function native(binding, command, args, live = true) {
  if (live) await pollReady(binding.connection.id);
  const id = await admitDocumentTool(conversation, args, binding.names[command]);
  const outcome = await toolResultText(harness, conversation, id);
  const result = JSON.parse(outcome.text);
  assert.equal(outcome.isError, !['applied', 'proposed'].includes(result.kind));
  report.nativeResults.push({ id, name: binding.names[command], result });
  return result;
}
async function proposal(binding, summary) {
  const record = await run('return { ...j.fixture.store.get(j.shapeId), y: j.fixture.store.get(j.shapeId).y + 100 };');
  return native(binding, 'propose', { edits: [{ kind: 'update', record }], summary });
}
async function unchanged(before, count) {
  assert.deepEqual(await saved(), before);
  assert.equal(publications, count);
}
try {
  const head = runCaptured('git', ['rev-parse', 'HEAD']); assert.equal(head.status, 0); report.head = head.stdout.trim();
  report.dirty = runCaptured('git', ['status', '--short']).stdout.trim();
  await step('build browser client and editor without native kernel or server modules', async () => {
    const result = await build({ entryPoints: ['test/fixtures/canvas-remote-browser.jsx'], outdir: directory, entryNames: 'fixture', bundle: true,
      platform: 'browser', format: 'esm', metafile: true, define: { 'process.env.NODE_ENV': '"production"' } });
    const forbidden = Object.keys(result.metafile.inputs).filter(path => /pi-durable|packages\/(agent|execution)\/|canvas-transport-server|sqlite|node:fs/.test(path));
    assert.deepEqual(forbidden, []);
    writeFileSync(join(evidence, 'bundle.json'), JSON.stringify(result.metafile, null, 2));
  });
  await step('native SQLite runtime and authenticated resource/presentation endpoints', async () => {
    const schema = createTLSchema(), records = [DocumentRecordType.create({ id: TLDOCUMENT_ID }), PageRecordType.create({ id: 'page:one', name: 'One', index: 'a1' }),
      schema.types.shape.create({ id: 'shape:reviewed', type: 'geo', parentId: 'page:one', index: 'a1', x: 40, y: 50, props: {
        geo: 'rectangle', dash: 'solid', url: '', w: 180, h: 100, growY: 0, scale: 1, flipX: false, flipY: false,
        labelColor: 'black', color: 'black', fill: 'semi', size: 'm', font: 'sans', align: 'middle', verticalAlign: 'middle', richText: toRichText('Fictional reviewed shape'),
      } })];
    for (const record of records) schema.types[record.typeName].validate(record);
    const seed = await files.publication.publish({ operationId: 'fictional-remote-seed', atomicity: 'all-or-nothing', changes: [{ kind: 'create', target,
      expected: { kind: 'absent' }, mediaType: canvasMediaType, bytes: new TextEncoder().encode(JSON.stringify({ schema: schema.serialize(), store: Object.fromEntries(records.map(record => [record.id, record])) })) }] }, access);
    assert.equal(seed.kind, 'committed');
    harness = await Harness.open(await openNodeSqliteStorage(join(directory, 'native.sqlite')), { registry, models: createModels() }, context);
    conversation = await harness.root(context);
    bridge = createCanvasTransport({ timeoutMs: 30000, authenticate: async request => {
      if (request.method === 'POST' && request.headers.get('origin') !== origin) return null;
      const token = request.headers.get('authorization');
      if (!['Bearer fictional-browser', 'Bearer fictional-other'].includes(token)) return null;
      return { identity: { runtimeId: 'fictional-native', conversationId: String(conversation.id), scopeId: access.scopeId,
        principalId: token === 'Bearer fictional-browser' ? access.principalId : 'other-browser' }, revoked: revocation.signal };
    }, authorize: ({ identity, target: selected }) => identity.principalId === access.principalId && selected.subject.scopeId === access.scopeId });
    const resources = createResourceHandler({ authenticate: async request => request.headers.get('authorization') === 'Bearer fictional-browser'
      && request.headers.get('origin') === origin && !revocation.signal.aborted ? access : null,
    reader: files, lookup: files.reconciliation, publisher: { publish: async (request, granted) => {
      publications++; lastPublication = await files.publication.publish(request, granted); return lastPublication;
    } } });
    server = createServer(async (incoming, outgoing) => {
      const cancellation = new AbortController();
      outgoing.on('close', () => { if (!outgoing.writableEnded) cancellation.abort(); });
      try {
        const url = new URL(incoming.url, origin);
        if (url.pathname === '/resources' || url.pathname === '/canvas') {
          const chunks = []; let size = 0;
          for await (const chunk of incoming) { size += chunk.length; if (size > 65536) { outgoing.writeHead(413).end(); return; } chunks.push(chunk); }
          const request = new Request(url, { method: incoming.method, headers: incoming.headers, signal: cancellation.signal,
            ...(incoming.method === 'POST' ? { body: Buffer.concat(chunks) } : {}) });
          const id = url.searchParams.get('connectionId');
          const pending = (url.pathname === '/resources' ? resources : bridge.handle)(request);
          if (url.pathname === '/canvas' && url.searchParams.get('op') === 'poll') {
            let ended = false;
            const settled = () => { ended = true; if (activePolls.get(id) === request) activePolls.delete(id); };
            void pending.then(settled, settled);
            await new Promise(resolve => setImmediate(resolve));
            if (!ended) activePolls.set(id, request);
          }
          const response = await pending;
          if (!outgoing.destroyed) { outgoing.writeHead(response.status, Object.fromEntries(response.headers)); outgoing.end(Buffer.from(await response.arrayBuffer())); }
        } else if (url.pathname === '/fixture.js' || url.pathname === '/fixture.css') {
          outgoing.writeHead(200, { 'content-type': url.pathname.endsWith('.js') ? 'text/javascript' : 'text/css' }); outgoing.end(readFileSync(join(directory, url.pathname.slice(1))));
        } else if (url.pathname === '/') {
          outgoing.writeHead(200, { 'content-type': 'text/html' }); outgoing.end('<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1"><title>Remote native canvas</title><link rel="stylesheet" href="/fixture.css"><style>body{margin:0}button{min-height:36px}</style><div id="root"></div><script type="module" src="/fixture.js"></script>');
        } else outgoing.writeHead(404).end();
      } catch (error) { if (!outgoing.destroyed) outgoing.writeHead(500).end(String(error)); }
    });
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    origin = `http://127.0.0.1:${server.address().port}`;
    assert.ok(process.env.CHROMIUM, 'Set CHROMIUM to a Chromium binary');
    browser = await launch(origin, { evidence }); await ready();
    assert.equal(publications, 0);
  });
  let binding;
  await step('remote native selection applies to actual browser and never publishes', async () => {
    binding = await attach(); const before = await saved(), count = publications;
    const result = await native(binding, 'select', { shapeIds: ['shape:reviewed'] });
    assert.equal(result.kind, 'applied');
    assert.deepEqual(await run('return j.fixture.editor.getSelectedShapeIds();'), ['shape:reviewed']);
    assert.equal(await run('return j.effects.select;'), 1);
    await unchanged(before, count); await browser.screenshot('native-selection.png');
  });
  await step('remote proposal waits for real human dismiss and accept; receipt survives reload', async () => {
    const before = await saved(), count = publications;
    assert.equal((await proposal(binding, 'Dismiss this remote proposal')).kind, 'proposed');
    await browser.until('proposal card visible', 'document.body.innerText.includes("Dismiss this remote proposal")');
    await unchanged(before, count);
    await browser.click(button('Dismiss')); await browser.until('proposal dismissed', '!window.canvasRemote.state().proposals.length');
    assert.equal((await proposal(binding, 'Accept this remote proposal')).kind, 'proposed');
    await unchanged(before, count); await browser.screenshot('remote-proposal.png');
    await browser.click(button('Accept and save'));
    await browser.until('human acceptance saved', 'window.canvasRemote.state().save.kind === "settled" && window.canvasRemote.state().save.result.kind === "saved"');
    assert.equal(publications, count + 1); assert.equal(lastPublication.kind, 'committed');
    assert.equal((await saved()).ref.revision, lastPublication.receipt.changes[0].after.revision);
    assert.equal((await document()).store['shape:reviewed'].y, 150);
    await run('await j.mount();'); await ready();
    assert.equal(await run('return j.fixture.store.get(j.shapeId).y;'), 150);
    binding = await attach();
  });
  await step('delivered command becomes stale after dirty edit and old registration never retargets', async () => {
    const before = await saved(), count = publications, effects = await run('return j.effects.select;');
    await run('j.faults.pauseDelivery = true;');
    const pending = native(binding, 'select', { shapeIds: [] });
    await browser.until('command delivered but browser invocation gated', 'window.canvasRemote.faults.deliveryHeld');
    await run('j.move(77); j.resumeDelivery();');
    assert.equal((await pending).kind, 'stale');
    assert.equal(await run('return j.effects.select;'), effects); await unchanged(before, count);
    const retired = binding; await run('await j.mount();'); await ready(); binding = await attach();
    assert.notEqual(binding.connection.id, retired.connection.id);
    assert.equal((await native(retired, 'select', { shapeIds: [] }, false)).kind, 'unavailable');
    assert.equal(await run('return j.effects.select;'), effects);
  });
  await step('native read-only canvas refuses remote proposal without publication', async () => {
    const before = await saved(), count = publications, effects = await run('return j.effects.propose;');
    await run('j.fixture.editor.updateInstanceState({ isReadonly: true });');
    assert.equal((await proposal(binding, 'Read-only remote proposal')).kind, 'denied');
    assert.equal(await run('return j.effects.propose;'), effects); await unchanged(before, count);
    await run('j.fixture.editor.updateInstanceState({ isReadonly: false });');
  });
  await step('different actor and cross-origin responses cannot affect original connection', async () => {
    const before = await saved(), count = publications;
    const foreign = await fetch(`${origin}/canvas?op=poll&connectionId=${binding.connection.id}`, { headers: { authorization: 'Bearer fictional-other' } });
    assert.equal(foreign.status, 403);
    const foreignReply = await fetch(`${origin}/canvas?op=result`, { method: 'POST', headers: { authorization: 'Bearer fictional-other', origin, 'content-type': 'application/json' },
      body: JSON.stringify({ schema: 'boring.canvas-presentation', version: 1, connectionId: binding.connection.id, requestId: 'fictional-foreign-request', result: { kind: 'applied' } }) });
    assert.equal(foreignReply.status, 403);
    const crossOrigin = await fetch(`${origin}/canvas?op=result`, { method: 'POST', headers: { authorization: 'Bearer fictional-browser', origin: 'https://fictional-attacker.invalid', 'content-type': 'application/json' }, body: '{}' });
    assert.equal(crossOrigin.status, 401);
    await unchanged(before, count);
    assert.equal((await native(binding, 'select', { shapeIds: [] })).kind, 'applied');
  });
  await step('lost acknowledgement is unknown and explicit reattachment never replays', async () => {
    const before = await saved(), count = publications, effects = await run('return j.effects.select;');
    await run('j.faults.dropReply = true;');
    assert.equal((await native(binding, 'select', { shapeIds: ['shape:reviewed'] })).kind, 'unknown');
    assert.equal(await run('return j.effects.select;'), effects + 1);
    assert.deepEqual(await run('return j.fixture.editor.getSelectedShapeIds();'), ['shape:reviewed']);
    await run('await j.fixture.transport.closed;'); const previous = binding;
    binding = await attach(); assert.notEqual(binding.connection.id, previous.connection.id);
    assert.equal(await run('return j.effects.select;'), effects + 1);
    assert.equal((await native(previous, 'select', { shapeIds: [] }, false)).kind, 'unavailable');
    assert.equal(await run('return j.effects.select;'), effects + 1); await unchanged(before, count);
  });
  await step('current authorization revoked after browser effect yields unknown', async () => {
    const before = await saved(), count = publications, effects = await run('return j.effects.select;');
    await run('j.faults.pauseReply = true;');
    const pending = native(binding, 'select', { shapeIds: [] });
    await browser.until('effect completed before acknowledgement admission', 'window.canvasRemote.faults.replyHeld');
    revocation.abort(); await run('j.resumeReply();');
    assert.equal((await pending).kind, 'unknown');
    assert.equal(await run('return j.effects.select;'), effects + 1); await unchanged(before, count);
    revocation = new AbortController(); await run('await j.fixture.transport.closed;'); binding = await attach();
    assert.equal(await run('return j.effects.select;'), effects + 1);
  });
  await step('transport detach preserves borrowed controller/editor and leaves old tools unavailable', async () => {
    const before = await run('return { instanceId: j.fixture.controller.actions.selection().target.instanceId, document: j.state().document };');
    await run('await j.detach();');
    assert.equal((await native(binding, 'select', { shapeIds: [] }, false)).kind, 'unavailable');
    assert.deepEqual(await run('return { instanceId: j.fixture.controller.actions.selection().target.instanceId, document: j.state().document };'), before);
    assert.equal(await run('return j.fixture.editor.isDisposed;'), false);
  });
  assert.deepEqual(browser.problems.filter(problem => problem.startsWith('exception:')), []);
  report.status = 'passed';
} catch (error) { report.status = 'failed'; report.error = String(error); process.exitCode = 1; console.error(error); }
finally {
  if (browser) {
    await run('j.resumeDelivery(); j.resumeReply(); await j.detach();').catch(() => {});
    report.browserProblems = browser.problems; await browser.close();
  }
  bridge?.close();
  if (server?.listening) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  if (harness) await harness.close(context);
  files.close(); rmSync(directory, { recursive: true, force: true });
  writeFileSync(join(evidence, 'report.json'), JSON.stringify(report, null, 2));
  console.log(`Canvas remote journey ${report.status}: ${evidence}`);
}
