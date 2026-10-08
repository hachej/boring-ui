import assert from 'node:assert/strict';
import { runCaptured } from './run-captured.mjs';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { build } from 'esbuild';
import { createTLSchema, DocumentRecordType, PageRecordType, TLDOCUMENT_ID } from '@tldraw/tlschema';
import { createResourceHandler } from '@hachej/boring-files/remote';
import { canvasMediaType } from '@hachej/boring-ui-kit/canvas-document';
import { launch } from '@hachej/boring-testing/browser';
import { openSqliteWorkspaces } from '../examples/shared/sqlite-workspaces.mjs';

const evidence = resolve(process.env.CANVAS_PROPOSALS_EVIDENCE ?? '.cache/evidence/canvas-proposals-browser');
mkdirSync(evidence, { recursive: true });
const directory = mkdtempSync(join(tmpdir(), 'boring-canvas-proposals-browser-'));
const report = { status: 'running', steps: [] };
const git = args => {
  const result = runCaptured('git', args);
  assert.equal(result.status, 0, result.stderr || result.error?.message);
  assert.equal(result.error, undefined);
  return result.stdout.trim();
};
const access = { scopeId: 'fictional', principalId: 'browser', initiatorId: 'journey' };
const target = { resource: { providerId: 'fictional', path: 'board.canvas' }, view: { kind: 'published' } };
const files = openSqliteWorkspaces({ filename: join(directory, 'canvas.sqlite'), providerId: 'fictional' });
let server, browser, publications = 0, release, delayed = false, failPublication = false;
const saved = async () => { const result = await files.read({ target, revision: { kind: 'latest' } }, access); assert.equal(result.kind, 'available'); return result.snapshot; };
const document = async () => JSON.parse(new TextDecoder().decode((await saved()).bytes));
const step = async (name, action) => {
  const item = { name, status: 'running' }; report.steps.push(item);
  try { await action(); item.status = 'passed'; } catch (error) { item.status = 'failed'; item.error = String(error); throw error; }
};
const ready = () => browser.until('native canvas and proposal controller', 'window.canvasProposals?.fixture.editor && Array.isArray(window.canvasProposals.state().proposals)');
const run = body => browser.evaluate(`(async () => { const j = window.canvasProposals; ${body} })()`);
const reload = async () => {
  const previous = await run('return j.fixture.controller.actions.selection().target.instanceId;');
  await browser.reload();
  await browser.until('reloaded canvas has a new mounted controller', `window.canvasProposals?.fixture.editor && window.canvasProposals.fixture.controller.actions.selection().target.instanceId !== ${JSON.stringify(previous)}`);
  await ready();
};
const button = label => `[...document.querySelectorAll('button')].find(button => button.textContent.trim() === ${JSON.stringify(label)})`;
const propose = async (kind, summary) => {
  const previous = (await saved()).ref.revision, count = publications;
  const result = await run(`return j.propose(${JSON.stringify(kind)}, ${JSON.stringify(summary)});`);
  assert.equal(result.kind, 'proposed');
  const card = `[...document.querySelectorAll('[data-boring=canvas-proposal]')].find(card => card.querySelector('h3')?.textContent === ${JSON.stringify(summary)})`;
  await browser.until('proposal summary rendered', `!!(${card})`);
  await browser.click(`${card}?.querySelector('details > summary')`);
  await browser.until('review shows affected native shape identity', `${card}?.innerText.includes('shape:reviewed')`);
  assert.equal(await browser.evaluate(`!!${card}?.querySelector('table')`), true, 'review uses changed-field rows');
  assert.equal((await saved()).ref.revision, previous); assert.equal(publications, count);
};
const accept = async () => {
  const count = publications;
  await browser.click(button('Accept and save'));
  await browser.until('accepted proposal saved', 'window.canvasProposals.state().save.kind === "settled" && window.canvasProposals.state().save.result.kind === "saved"');
  assert.equal(publications, count + 1);
};
try {
  report.head = git(['rev-parse', 'HEAD']);
  report.dirty = git(['status', '--short']);
  await step('build browser fixture without kernel or server filesystem', async () => {
    assert.ok(process.env.CHROMIUM, 'Set CHROMIUM to a Chromium binary');
    const result = await build({ entryPoints: ['test/fixtures/canvas-proposals-browser.jsx'], outdir: directory, entryNames: 'fixture', bundle: true, platform: 'browser', format: 'esm', metafile: true, define: { 'process.env.NODE_ENV': '"production"' } });
    assert.ok(Object.keys(result.metafile.inputs).every(path => !/pi-kernel|pi-durable|packages\/(agent|execution)\/|sqlite|node:fs/.test(path)));
    writeFileSync(join(evidence, 'bundle.json'), JSON.stringify(result.metafile, null, 2));
  });
  await step('seed SQLite and launch authenticated resource endpoint', async () => {
    const schema = createTLSchema(), records = [DocumentRecordType.create({ id: TLDOCUMENT_ID }), PageRecordType.create({ id: PageRecordType.createId('one'), name: 'One', index: 'a1' })];
    const seed = await files.publication.publish({ operationId: 'fictional-seed', atomicity: 'all-or-nothing', changes: [{ kind: 'create', target, expected: { kind: 'absent' }, mediaType: canvasMediaType,
      bytes: new TextEncoder().encode(JSON.stringify({ schema: schema.serialize(), store: Object.fromEntries(records.map(record => [record.id, record])) })) }] }, access);
    assert.equal(seed.kind, 'committed');
    assert.equal((await saved()).mediaType, canvasMediaType, 'SQLite retains the published canvas media type');
    const handler = createResourceHandler({ authenticate: async request => request.headers.get('authorization') === 'Bearer fictional-canvas-journey' ? access : null,
      reader: files, lookup: files.reconciliation, publisher: { publish: async (request, granted) => {
        publications++;
        if (failPublication) { failPublication = false; throw new Error('Fictional failure before document commit'); }
        const outcome = await files.publication.publish(request, granted);
        if (delayed) { delayed = false; await new Promise(resolve => { release = resolve; }); }
        return outcome;
      } },
    });
    server = createServer(async (incoming, outgoing) => {
      try {
        if (incoming.url === '/resources') {
          const chunks = []; for await (const chunk of incoming) chunks.push(chunk);
          const response = await handler(new Request(`http://127.0.0.1/resources`, { method: incoming.method, headers: incoming.headers, body: Buffer.concat(chunks) }));
          outgoing.writeHead(response.status, Object.fromEntries(response.headers)); outgoing.end(Buffer.from(await response.arrayBuffer()));
        } else if (incoming.url === '/fixture.js' || incoming.url === '/fixture.css') {
          outgoing.writeHead(200, { 'content-type': incoming.url.endsWith('.js') ? 'text/javascript' : 'text/css' }); outgoing.end(readFileSync(join(directory, incoming.url.slice(1))));
        } else if (incoming.url === '/') {
          outgoing.writeHead(200, { 'content-type': 'text/html' }); outgoing.end('<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1"><title>Canvas proposal review</title><link rel="stylesheet" href="/fixture.css"><style>body{margin:0}button{min-height:36px}</style><div id="root"></div><script type="module" src="/fixture.js"></script>');
        } else outgoing.writeHead(404).end();
      } catch (error) { outgoing.writeHead(500).end(String(error)); }
    });
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    browser = await launch(`http://127.0.0.1:${server.address().port}`, { evidence }); await ready();
    assert.equal(publications, 0, 'mount does not publish');
  });
  for (const device of ['desktop', 'phone']) {
    await step(`${device}: review, dismiss, accept creation and reload`, async () => {
      await browser.emulate(device);
      const before = await run('return j.state().document;');
      await propose('create', 'Create fictional rectangle');
      assert.deepEqual(await run('return j.state().document;'), before);
      await browser.screenshot(`${device}-proposal.png`);
      await browser.click(button('Dismiss'));
      await browser.until('proposal dismissed', '!window.canvasProposals.state().proposals.length');
      assert.deepEqual(await run('return j.state().document;'), before);
      await propose('create', 'Create reviewed rectangle'); await accept();
      assert.equal((await document()).store['shape:reviewed'].x, 40);
      await reload();
      assert.equal(await run('return j.fixture.store.get(j.shapeId).x;'), 40);
    });
    await step(`${device}: dirty human edit is included only after explicit acceptance`, async () => {
      await run('j.move(90);');
      await propose('update', 'Move rectangle down');
      assert.equal((await document()).store['shape:reviewed'].x, 40);
      assert.equal(await run('return j.fixture.store.get(j.shapeId).y;'), 50);
      await accept();
      assert.equal((await document()).store['shape:reviewed'].x, 90);
      assert.equal((await document()).store['shape:reviewed'].y, 150);
      await reload();
    });
    await step(`${device}: intervening local edit makes the proposal stale`, async () => {
      await propose('update', 'Stale proposal');
      const count = publications;
      await run('j.move(120);');
      await browser.until('stale acceptance unavailable', `!${button('Accept and save')} || ${button('Accept and save')}.disabled`);
      assert.equal(publications, count);
      assert.equal(await run('return j.fixture.store.get(j.shapeId).x;'), 120);
      await browser.click(button('Dismiss'));
      await reload();
    });
    await step(`${device}: native read-only prevents proposal acceptance`, async () => {
      await propose('update', 'Read-only proposal');
      const count = publications;
      await run('j.fixture.editor.updateInstanceState({ isReadonly: true });');
      await browser.until('native read-only disables acceptance', `${button('Accept and save')}?.disabled`);
      assert.equal(publications, count);
      await run('j.fixture.editor.updateInstanceState({ isReadonly: false });');
      await browser.until('native read-only release restores acceptance', `${button('Accept and save')} && !${button('Accept and save')}.disabled`);
      await browser.click(button('Dismiss'));
    });
    await step(`${device}: delete requires acceptance and persists after reload`, async () => {
      await propose('remove', 'Remove reviewed rectangle');
      assert.ok((await document()).store['shape:reviewed']);
      await accept();
      assert.equal((await document()).store['shape:reviewed'], undefined);
      await reload();
      assert.equal(await run('return !!j.fixture.store.get(j.shapeId);'), false);
    });
  }
  await step('review includes implicit child removal before adoption', async () => {
    await propose('create', 'Create child for cascade'); await accept();
    await reload();
    await run('j.addChild();');
    const before = await run('return j.state().document;'), count = publications;
    assert.equal((await run('return j.proposeParentRemoval();')).kind, 'proposed');
    await browser.until('cascade proposal rendered', `document.body.innerText.includes('Remove parent and its child')`);
    await browser.click(`document.querySelector('[data-boring=canvas-proposal] details > summary')`);
    const review = await browser.evaluate(`document.querySelector('[data-boring=canvas-proposal]').innerText`);
    assert.ok(review.includes('shape:parent')); assert.ok(review.includes('shape:reviewed'));
    assert.deepEqual(await run('return j.state().document;'), before); assert.equal(publications, count);
    await accept();
    const after = await document();
    assert.equal(after.store['shape:parent'], undefined); assert.equal(after.store['shape:reviewed'], undefined);
    await reload();
  });
  await step('late save acknowledgment preserves a newer human edit', async () => {
    await propose('create', 'Delayed creation'); delayed = true;
    await browser.click(button('Accept and save'));
    await browser.until('save pending and proposal adopted', 'window.canvasProposals.state().save.kind === "pending" && !!window.canvasProposals.fixture.store.get(window.canvasProposals.shapeId)');
    const deadline = Date.now() + 10000;
    while (!release && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10));
    assert.ok(release, 'publication committed before acknowledgment gate');
    await run('j.move(777);'); release(); release = undefined;
    await browser.until('acknowledgment settles', 'window.canvasProposals.state().save.kind === "settled"');
    assert.equal(await run('return j.fixture.store.get(j.shapeId).x;'), 777);
    assert.equal(await run('return j.state().dirty;'), true);
    assert.equal((await document()).store['shape:reviewed'].x, 40);
    await browser.screenshot('late-acknowledgment.png');
  });
  await step('unconfirmed proposal save can return to a draft without replay', async () => {
    const before = await document(), count = publications;
    await propose('update', 'Proposal with unavailable publication'); failPublication = true;
    await browser.click(button('Accept and save'));
    await browser.until('publication remains unconfirmed', 'window.canvasProposals.state().save.kind === "settled" && window.canvasProposals.state().save.result.kind === "unknown"');
    const draft = await run('return j.state().document;');
    assert.equal(publications, count + 1);
    await browser.click(button('Check save outcome'));
    await browser.until('lookup reports no retained receipt', 'document.body.innerText.includes("No retained receipt")');
    await browser.click(button('Keep draft and refresh'));
    await browser.until('explicit recovery keeps the unsaved draft', 'window.canvasProposals.state().save.kind === "idle" && window.canvasProposals.state().dirty');
    assert.deepEqual(await run('return j.state().document;'), draft);
    assert.deepEqual(await document(), before);
    assert.equal(publications, count + 1);
    await browser.screenshot('unconfirmed-save-draft.png');
  });
  assert.deepEqual(browser.problems.filter(problem => problem.startsWith('exception:')), []);
  report.status = 'passed';
} catch (error) { report.status = 'failed'; report.error = String(error); process.exitCode = 1; console.error(error); }
finally {
  release?.();
  if (browser) { report.browserProblems = browser.problems; await browser.close(); }
  if (server?.listening) await new Promise(resolve => server.close(resolve));
  files.close(); rmSync(directory, { recursive: true, force: true });
  writeFileSync(join(evidence, 'report.json'), JSON.stringify(report, null, 2));
  console.log(`Canvas proposal journey ${report.status}: ${evidence}`);
}
