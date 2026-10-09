import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delayMs } from 'node:timers/promises';
import { build } from 'esbuild';
import { launch } from '@hachej/boring-testing/browser';
import { openMorningRuntime } from '../examples/morning/runtime.mjs';
import { morningIdentity } from '../examples/morning/documents.mjs';
import { privateCanaries } from '../examples/morning/fixtures.mjs';
import { morningLayout, fakeMorningEvaluator } from '../examples/morning/composition.mjs';
import { startMorningServer } from '../examples/morning/server.mjs';

const evidence = resolve(process.env.MORNING_EVIDENCE ?? '.cache/evidence/morning-browser'); mkdirSync(evidence, { recursive: true });
const directory = mkdtempSync(join(tmpdir(), 'boring-morning-browser-')), report = { status: 'running', steps: [], native: [] }, evaluated = [];
let runtime, server, browser, revoked = false, calendarFailed = false, delay = false, release, heldSignal, fail = false, holdEvaluation = false, releaseEvaluation;
const held = async getter => { const deadline = Date.now() + 15000; while (!getter()) { assert.ok(Date.now() < deadline, 'Host gate reached'); await delayMs(10); } };
const counts = () => structuredClone(runtime.local.publicationCounts);
const step = async (name, action) => { const item = { name, status: 'running' }; report.steps.push(item); try { await action(); item.status = 'passed'; } catch (error) { item.status = 'failed'; item.error = String(error); throw error; } };
const run = body => browser.evaluate(`(async () => { const j = window.morning; ${body} })()`);
const button = label => `[...document.querySelectorAll('button')].find(button => button.textContent === ${JSON.stringify(label)})`;
const outcome = (app, kind) => browser.until(`${app} ${kind}`, `window.morning.inspect().outcomes.${app}?.result.kind === ${JSON.stringify(kind)}`);
async function record(app) { const read = await runtime[app].read(morningIdentity); assert.equal(read.kind, 'available'); return read; }
try {
  await step('browser bundle excludes native kernel and server authorities', async () => {
    const bundled = await build({ entryPoints: ['examples/morning/view.jsx'], outdir: join(directory, 'bundle'), bundle: true, platform: 'browser', format: 'esm', metafile: true, define: { 'process.env.NODE_ENV': '"production"' } });
    for (const marker of Object.values(privateCanaries)) assert.ok(!readFileSync(join(directory, 'bundle/view.js'), 'utf8').includes(marker));
    assert.deepEqual(Object.keys(bundled.metafile.inputs).filter(path => /pi-durable|packages\/(agent|execution)\/|sqlite|morning\/runtime|morning\/fixtures|morning\/server|node:fs/.test(path)), []);
    writeFileSync(join(evidence, 'bundle.json'), JSON.stringify(bundled.metafile, null, 2));
  });
  await step('explicit native preparation and browser-closed assistant action', async () => {
    runtime = await openMorningRuntime({ directory: join(directory, 'runtime'), layout: morningLayout,
      authorize: (app, permission) => !(revoked && app === 'email' && ['write', 'execute'].includes(permission)) && !(calendarFailed && app === 'calendar') });
    report.prepared = await runtime.prepare(); assert.ok(report.prepared.ids.email); assert.ok(report.prepared.ids.calendar); assert.ok(report.prepared.ids.merge);
    const todo = await record('todo'); const native = await runtime.invokeTool('complete_todo', { expected: todo.revision, itemId: 'calendar', completed: true }, morningIdentity);
    assert.ok(native.taskId); assert.equal(native.result.kind, 'committed'); report.native.push(native);
  });
  await step('actual authenticated host and Chromium mount without publications', async () => {
    server = await startMorningServer({ runtime, evaluate: async input => { evaluated.push(structuredClone(input)); if (holdEvaluation) { holdEvaluation = false; await new Promise(resolve => { releaseEvaluation = resolve; }); } if (fail) throw new Error('Fictional evaluator failed'); return fakeMorningEvaluator(input); },
      beforeCompose: async signal => { if (delay) { delay = false; heldSignal = signal; await new Promise(resolve => { release = resolve; }); } } });
    const before = counts(); browser = await launch(server.origin, { evidence }); await browser.until('morning fixture ready', '!!window.morning?.session'); assert.deepEqual(counts(), before);
  });
  await step('dirty reply focus and selection survive delayed proposal and explicit region adoption', async () => {
    await browser.type('document.querySelector("[data-fixed-reply] textarea")', 'Browser private reply draft');
    assert.equal(await run('return j.session.reply.getSnapshot().dirty;'), true); assert.equal(await run(`return ${button('Send saved reply')}.disabled;`), true);
    delay = true; await browser.click(button('Regenerate decisions')); await browser.until('composition delayed with defaults', 'window.morning.inspect().compositionStatus.includes("default retained")');
    await run('window.originalReply = document.querySelector("[data-fixed-reply] textarea"); originalReply.focus(); originalReply.setSelectionRange(2,8); window.originalLayout = j.session.experience.getSnapshot().text;');
    await held(() => release); release(); release = undefined;
    await browser.until('validated offer ready', '!!window.morning.session.experience.getSnapshot().proposal');
    assert.equal(await run('return document.activeElement === window.originalReply && originalReply.selectionStart === 2 && originalReply.selectionEnd === 8;'), true);
    assert.equal(await run('return j.session.experience.getSnapshot().text === window.originalLayout;'), true);
    await browser.click(button('Use proposed region'));
    assert.equal(await run('return document.querySelector("[data-fixed-reply] textarea") === window.originalReply;'), true); assert.equal(await run('return j.session.reply.getSnapshot().dirty;'), true);
    assert.deepEqual(await run('return j.session.experience.getSnapshot().descriptor.elements.header;'), morningLayout.elements.header);
    assert.deepEqual(await run('return j.session.experience.getSnapshot().descriptor.elements.reply;'), morningLayout.elements.reply);
    await browser.click(button('Pin this region')); await browser.until('pin acknowledged', 'window.morning.session.experience.getSnapshot().save.kind === "settled" && window.morning.session.experience.getSnapshot().save.result.kind === "saved"');
    const receipt = await run('return j.session.experience.getSnapshot().save.result.receipt;'); assert.deepEqual((await runtime.layoutClient(morningIdentity).lookup(receipt.operationId)).receipt, receipt);
    for (const marker of [...Object.values(privateCanaries), 'Browser private reply draft']) { assert.ok(!JSON.stringify(evaluated).includes(marker)); assert.ok(!(await run('return j.session.experience.getSnapshot().text;')).includes(marker)); }
    await browser.screenshot('morning-proposal-pinned.png');
  });
  await step('visible phase change offers a layout and cancellation retains current view', async () => {
    const before = await run('return j.session.experience.getSnapshot().text;');
    await run('const request=j.session.experience.actions.beginRegion(j.session.experience.actions.selection(),"decisions","phase"); if(request.kind!=="applied")throw new Error(request.kind); await j.session.regenerate(request.value);');
    assert.equal(await run('return !!j.session.experience.getSnapshot().proposal;'), true); assert.equal(await run('return j.session.experience.getSnapshot().text;'), before); await browser.click(button('Dismiss proposed region'));
    delay = true; await run('j.session.compositionAbort = new AbortController();'); await browser.click(button('Regenerate decisions')); await browser.until('cancel request waiting', 'window.morning.inspect().compositionStatus.includes("Composing")');
    await held(() => release); const cancelledSignal = heldSignal, priorEvaluations = evaluated.length; await run('j.session.compositionAbort.abort();'); await held(() => cancelledSignal.aborted); release?.(); release = undefined;
    await browser.until('cancelled view retained', 'window.morning.inspect().compositionStatus.includes("cancelled")'); assert.equal(evaluated.length, priorEvaluations); assert.equal(await run('return j.session.experience.getSnapshot().text;'), before); await run('j.session.compositionAbort = undefined;');
  });
  await step('failed composition preserves default/current view and dirty editor', async () => {
    fail = true; const priorEvaluations = evaluated.length; const before = await run('return {text:j.session.experience.getSnapshot().text,draft:j.session.reply.getSnapshot().text};');
    await browser.click(button('Regenerate decisions')); await held(() => evaluated.length > priorEvaluations); await browser.until('failure retained view', 'window.morning.inspect().compositionStatus.includes("retained") && !window.morning.inspect().compositionStatus.startsWith("Composing")');
    assert.equal(await run('return j.session.experience.getSnapshot().proposal;'), null);
    assert.deepEqual(await run('return {text:j.session.experience.getSnapshot().text,draft:j.session.reply.getSnapshot().text};'), before); fail = false;
  });
  await step('local Expand and Focus never write or admit native work', async () => {
    const before = counts(), requests = await run('return j.faults.requests.length;'); await browser.click(button('Expand email')); await browser.click(button('Focus reply'));
    assert.equal(await run('return document.activeElement === document.querySelector("[data-fixed-reply] textarea");'), true); assert.deepEqual(counts(), before); assert.equal(await run('return j.faults.requests.length;'), requests);
  });
  await step('Snooze, denied Send, rejected owner injection and fictional outbox receipt', async () => {
    await browser.click(button('Snooze')); await outcome('email', 'committed'); assert.equal((await record('email')).document.status, 'snoozed');
    await run('return j.session.reply.flush(j.session.reply.actions.selection());').then(result => assert.equal(result.kind, 'saved'));
    revoked = true; const before = counts(); await browser.click(button('Send saved reply')); await outcome('email', 'denied'); assert.deepEqual(counts(), before); revoked = false;
    const email = await record('email'); const forged = await run(`return j.session.client.email.send({expected:${JSON.stringify(email.revision)},draftRevision:j.session.reply.getSnapshot().base.target.revision,app:'calendar'});`); assert.equal(forged.result.kind, 'denied');
    for (const headers of [{ authorization: 'Bearer foreign', origin: server.origin }, { authorization: 'Bearer fictional-morning', origin: 'https://foreign.invalid' }]) {
      const response = await fetch(new URL('/email/read', server.origin), { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: '{}' }); assert.equal(response.status, 403);
    }
    await browser.click(button('Send saved reply')); await outcome('email', 'committed'); assert.equal((await record('email')).document.status, 'queued');
    assert.equal(await run('return document.querySelector("[data-outcome=email]").textContent.includes("Queued in fictional outbox");'), true);
    const operationId = await run('return j.inspect().outcomes.email.intent.operationId;'); assert.equal((await runtime.email.lookup(operationId, morningIdentity)).kind, 'committed');
  });
  await step('Slot acceptance and Tick lost acknowledgment reconcile without replay', async () => {
    const calendar = await record('calendar'); await browser.click(button(`Accept ${calendar.document.options[0].label}`)); await outcome('calendar', 'committed'); assert.equal((await record('calendar')).document.selected, calendar.document.options[0].id);
    await run('j.faults.loseActionReply = true;'); await browser.click(`document.querySelector('input[aria-label="Tick reply"]')`); await outcome('todo', 'unknown'); const before = counts();
    await browser.click(button('Reconcile todo')); await outcome('todo', 'committed'); assert.deepEqual(counts(), before); assert.equal((await record('todo')).document.items.find(item => item.id === 'reply').completed, true);
  });
  await step('stale layout keep conflicts and cannot replace another writer', async () => {
    await browser.click(button('Regenerate decisions')); await browser.until('second region offer', '!!window.morning.session.experience.getSnapshot().proposal'); await browser.click(button('Use proposed region'));
    const client = runtime.layoutClient(morningIdentity), selected = await client.read({ target: runtime.layoutTarget, revision: { kind: 'latest' } }); assert.equal(selected.kind, 'available');
    const other = await client.publish({ operationId: 'other-layout-writer', atomicity: 'all-or-nothing', changes: [{ kind: 'replace', target: selected.snapshot.ref, mediaType: 'application/json', bytes: new TextEncoder().encode(JSON.stringify({ ...JSON.parse(new TextDecoder().decode(selected.snapshot.bytes)), title: 'Other fixed morning' })) }] }); assert.equal(other.kind, 'committed');
    await browser.click(button('Keep this layout')); await browser.until('stale keep conflict', 'window.morning.session.experience.getSnapshot().save.kind === "settled" && window.morning.session.experience.getSnapshot().save.result.kind === "conflict"');
    const saved = await client.read({ target: runtime.layoutTarget, revision: { kind: 'latest' } }); assert.equal(saved.snapshot.ref.revision, other.receipt.changes[0].after.revision); assert.equal(JSON.parse(new TextDecoder().decode(saved.snapshot.bytes)).title, 'Other fixed morning');
  });
  await step('authorization revoked during evaluator await refuses hidden result', async () => {
    holdEvaluation = true; releaseEvaluation = undefined; const before = evaluated.length;
    const pending = run('return j.session.client.compose(j.session.experience.getSnapshot().descriptor,"request");');
    const deadline = Date.now() + 5000; while (!releaseEvaluation) { assert.ok(Date.now() < deadline); await delayMs(10); }
    calendarFailed = true; releaseEvaluation(); releaseEvaluation = undefined; const result = await pending; assert.equal(result.kind, 'denied'); assert.equal(evaluated.length, before + 1); calendarFailed = false;
  });
  await step('app failure/removal and borrowed viewer detach leave independent native work usable', async () => {
    calendarFailed = true; await run('j.session.removeCell("calendar/conflict");'); await browser.until('calendar hidden', '!document.querySelector("[data-cell=calendar]")');
    assert.equal((await runtime.calendar.read(morningIdentity)).kind, 'denied'); const before = counts(), requests = await run('return j.faults.requests.length;'); await browser.click(button('Expand email')); assert.deepEqual(counts(), before);
    await run('await j.detach();'); assert.equal(await run('return j.session.reply.getSnapshot().lifecycle;'), 'active'); assert.equal(await run('return j.session.experience.getSnapshot().lifecycle;'), 'active');
    const todo = await record('todo'), native = await runtime.invokeTool('complete_todo', { expected: todo.revision, itemId: 'calendar', completed: false }, morningIdentity); assert.ok(native.taskId); assert.equal(native.result.kind, 'committed'); report.native.push(native);
  });
  assert.deepEqual(browser.problems.filter(problem => problem.startsWith('exception:')), []); report.status = 'passed';
} catch (error) { report.status = 'failed'; report.error = String(error); process.exitCode = 1; console.error(error); }
finally {
  release?.(); releaseEvaluation?.(); if (browser) { report.browserProblems = browser.problems; await run('await j.close();').catch(() => {}); await browser.close(); }
  await server?.close(); await runtime?.close(); rmSync(directory, { recursive: true, force: true });
  writeFileSync(join(evidence, 'evaluation.json'), JSON.stringify(evaluated, null, 2)); writeFileSync(join(evidence, 'report.json'), JSON.stringify(report, null, 2)); console.log(`Morning browser ${report.status}: ${evidence}`);
}
