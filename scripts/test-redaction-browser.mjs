import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { build } from 'esbuild';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import { openNodeSqliteStorage } from '@earendil-works/pi-durable/storage/sqlite/node';
import { launch } from '@hachej/boring-testing/browser';
import { openRedactionBrowser } from '../examples/redaction-browser/runtime.mjs';
import { startRedactionBrowserServer } from '../examples/redaction-browser/server.mjs';
import { redactionActor, encode } from '../examples/redaction/bindings.mjs';
import { fictionalNotes, fictionalTranscript } from '../examples/redaction-browser/fixtures.mjs';

const evidence = resolve(process.env.REDACTION_BROWSER_EVIDENCE ?? '.cache/evidence/redaction-browser-journey'); mkdirSync(evidence, { recursive: true });
const directory = mkdtempSync(join(tmpdir(), 'redaction-browser-')), report = { status: 'running', steps: [] }, recordings = [];
let runtime, server, browser, hold = false, release, fail = false, revoked = false, denyPublish = false, holdSave = false, releaseSave;
const step = async (name, action) => { const result = { name, status: 'running' }; report.steps.push(result); try { await action(); result.status = 'passed'; } catch (error) { result.status = 'failed'; result.error = String(error); throw error; } };
const held = async test => { for (let i = 0; i < 1500 && !test(); i++) await delay(10); assert.ok(test(), 'Observed host gate'); };
async function taskCount() { let total = 0; for (const id of ['first', 'second']) { const storage = await openNodeSqliteStorage(join(directory, 'runtime', id, 'native.sqlite')); try { let cursor; do { const page = await storage.scanTasks({}, 100, cursor, context); total += page.items.length; cursor = page.next; } while (cursor !== undefined); } finally { await storage.close(context); } } return total; }
const run = body => browser.evaluate(`(async () => { const j = window.redaction, first = j.session.consultations.get('first'); ${body} })()`);
const button = text => `[...document.querySelectorAll('button')].find(node => node.textContent === ${JSON.stringify(text)})`;
const waitBlock = subject => browser.until(`proposal ${subject} ready`, `window.redaction.session.consultations.get('first').blocks.${subject}.proposal?.kind === 'ready'`);
const refresh = async subject => { for (let i = 0; i < 150; i++) { if (await run(`return first.blocks.${subject}.proposal?.kind === 'ready';`)) return; await browser.click(button(`Refresh proposal ${subject}`)); await delay(30); } await waitBlock(subject); };
try {
  await step('browser bundle excludes native, SQLite, server and private fixtures', async () => {
    const result = await build({ entryPoints: ['examples/redaction-browser/view.jsx'], outdir: join(directory, 'assets'), bundle: true, platform: 'browser', format: 'esm', metafile: true, define: { 'process.env.NODE_ENV': '"production"' } });
    const code = readFileSync(join(directory, 'assets/view.js'), 'utf8');
    for (const marker of Object.values(fictionalNotes)) assert.ok(!code.includes(marker));
    assert.ok(!code.includes(fictionalTranscript));
    assert.deepEqual(Object.keys(result.metafile.inputs).filter(path => /pi-durable|packages\/(agent|execution)\/|sqlite|redaction-browser\/(runtime|server|fixtures)|node:fs/.test(path)), []);
    writeFileSync(join(evidence, 'bundle.json'), JSON.stringify(result.metafile, null, 2));
  });
  await step('real native SQLite host and actual Chromium borrowed mount', async () => {
    runtime = await openRedactionBrowser({ directory: join(directory, 'runtime'), policy: (_id, _actor, action) => !(revoked && ['read', 'transcribe', 'publish'].includes(action)) && !(denyPublish && action === 'publish'), transcribe: async input => { recordings.push({ consultationId: input.consultationId, requestId: input.requestId }); if (hold) { hold = false; await new Promise(resolve => { release = resolve; }); } if (fail) throw new Error('Fictional recording failed'); return fictionalTranscript; }, beforeDocumentPublish: async () => { if (holdSave) { holdSave = false; await new Promise(resolve => { releaseSave = resolve; }); } } });
    server = await startRedactionBrowserServer({ runtime }); browser = await launch(server.origin, { evidence });
    await browser.until('mounted source ready', "!!window.redaction?.session.consultations.get('first').mounted?.getTarget()");
    assert.equal(await run("return first.notes.getSnapshot().dirty;"), false);
  });
  await step('exact UTF16 cursor and duplicate local dictation delivery', async () => {
    const old = await run('const n=document.querySelector("[data-notes] textarea"); n.focus(); n.setSelectionRange(2,5); return first.notes.getSnapshot().text;');
    await browser.click(button('Insert fictional dictation')); await browser.until('dictation applied', "window.redaction.session.consultations.get('first').dictations[0]?.status === 'applied'");
    assert.equal(await run('return first.notes.getSnapshot().text;'), old.slice(0, 2) + fictionalTranscript + old.slice(5));
    await run('await j.session.retryDictation(first.dictations[0]);'); assert.equal(recordings.length, 1); assert.equal(await run('return first.notes.getSnapshot().dirty;'), true);
  });
  await step('failed recording retry keeps original consultation after switch', async () => {
    fail = true; await browser.click(button('Insert fictional dictation')); await browser.until('recording failed', "window.redaction.session.consultations.get('first').dictations[1]?.status === 'failed'");
    const originalId = await run('return first.dictations[1].requestId;');
    await browser.click(button('Second fictional consultation')); fail = false; await run('await j.session.retryDictation(first.dictations[1]);');
    assert.equal(recordings.at(-1).consultationId, 'first'); assert.equal(recordings.at(-1).requestId, originalId); assert.equal(await run("return j.session.consultations.get('second').notes.getSnapshot().dirty;"), false);
    assert.equal(await run('return first.dictations[1].status;'), 'retained'); await browser.click(button('First fictional consultation'));
  });
  await step('typing and remount retain delayed Unicode transcript without insertion', async () => {
    hold = true; await browser.click(button('Insert fictional dictation')); await held(() => release); await browser.type('document.querySelector("[data-notes] textarea")', 'Newer fictional notes 🌈'); const text = await run('return first.notes.getSnapshot().text;'); release(); release = null;
    await browser.until('late transcript retained', "window.redaction.session.consultations.get('first').dictations.at(-1).status === 'retained'"); assert.equal(await run('return first.notes.getSnapshot().text;'), text);
    hold = true; await browser.click(button('Insert fictional dictation')); await held(() => release); await browser.click(button('Second fictional consultation')); await browser.click(button('First fictional consultation')); release(); release = null;
    await browser.until('switch-back capture stale', "window.redaction.session.consultations.get('first').dictations.at(-1).status === 'retained'"); assert.equal(await run('return first.notes.getSnapshot().text;'), text);
  });
  await step('denied, unknown and conflicted selected saves admit zero native tasks', async () => {
    const before = await taskCount(); denyPublish = true; await browser.click(button('Generate A/B/C from selected notes')); await browser.until('denied save refuses generation', 'window.redaction.session.consultations.get("first").notice.startsWith("No generation admitted")'); assert.equal(await taskCount(), before); denyPublish = false;
    await run('window.originalFetch=window.fetch; window.loseNotesAck=true; window.fetch=async (...args)=>{ const req=args[0], path=new URL(req.url ?? req,location.origin).pathname; const body= req instanceof Request ? await req.clone().json().catch(()=>null) : null; const reply=await originalFetch(...args); if(window.loseNotesAck && path.endsWith("/notes") && body?.kind==="publish") { window.loseNotesAck=false; throw new Error("Lost actual HTTP save acknowledgement"); } return reply; };');
    await browser.click(button('Generate A/B/C from selected notes')); await browser.until('unknown save blocks generation', 'window.redaction.session.consultations.get("first").notice.includes("unknown")'); assert.equal(await taskCount(), before);
    await run('window.fetch=window.originalFetch; await first.notes.actions.reconcile();'); assert.equal(await run('return first.notes.getSnapshot().save.result.kind;'), 'saved');
    await browser.type('document.querySelector("[data-notes] textarea")', 'Browser draft before external conflict');
    const target = runtime.local.apps.first.paths('A').source, provider = runtime.local.apps.first.local.provider, read = await provider.read({ target, revision: { kind: 'latest' } }, redactionActor());
    assert.equal((await provider.publication.publish({ operationId: 'browser-external-notes-conflict', atomicity: 'all-or-nothing', changes: [{ kind: 'replace', target: read.snapshot.ref, bytes: encode('External fictional notes'), mediaType: 'text/markdown' }] }, redactionActor())).kind, 'committed');
    await browser.click(button('Generate A/B/C from selected notes')); await browser.until('conflicted save blocks generation', 'window.redaction.session.consultations.get("first").notice.includes("conflict")'); assert.equal(await taskCount(), before); await run('await first.notes.actions.discardToRemote();');
  });
  await step('saved selected notes admit independent A B C while newer draft stays dirty', async () => {
    await browser.type('document.querySelector("[data-notes] textarea")', 'Selected fictional source'); holdSave = true; await browser.click(button('Generate A/B/C from selected notes')); await held(() => releaseSave); await browser.type('document.querySelector("[data-notes] textarea")', 'Later unsaved fictional source'); const later = await run('return first.notes.getSnapshot().text;'); releaseSave(); releaseSave = null;
    await browser.until('three independent native admissions', "Object.values(window.redaction.session.consultations.get('first').blocks).every(block => block.outcome?.kind === 'admitted')");
    assert.equal(await run('return first.notes.getSnapshot().text;'), later); assert.equal(await run('return first.notes.getSnapshot().dirty;'), true);
    for (const subject of ['A', 'B', 'C']) await refresh(subject);
    assert.equal(await run('return new Set(Object.values(first.blocks).map(block=>block.request.source.revision)).size;'), 1);
  });
  await step('human correction and explicit mixed adoption publish checked record and letter', async () => {
    const item = await run('return first.blocks.A.proposal.value.items[0];');
    await browser.type(`document.querySelector('input[aria-label="Correction A ${item.itemId}"]')`, 'Fictional browser human correction'); await browser.click(button('Save correction A'));
    await browser.until('correction saved', "window.redaction.session.consultations.get('first').blocks.A.correction?.result?.kind === 'committed'");
    await run(`const select=document.querySelector('select[aria-label="Choice A ${item.itemId}"]'); select.value='corrected'; select.dispatchEvent(new Event('change',{bubbles:true}));`);
    await browser.click(button('Adopt selected A')); await browser.until('native adoption admitted', "!!window.redaction.session.consultations.get('first').blocks.A.adoption?.ref");
    for (let i = 0; i < 150 && !(await run("return first.blocks.A.adoption.result.kind === 'committed';")); i++) { await browser.click(button('Check adoption A')); await delay(30); }
    assert.equal(await run('return first.blocks.A.adoption.result.kind;'), 'committed');
    const receipt = await run('return first.blocks.A.adoption.result.receipt;'); assert.equal(receipt.changes.length, 2);
    assert.ok(await run('return document.querySelector("[data-block=A] [data-adopted]").textContent.includes("Fictional browser human correction");'));
    const target = runtime.local.apps.first.domainPaths('A').letter, provider = runtime.local.apps.first.local.provider, read = await provider.read({ target, revision: { kind: 'latest' } }, redactionActor()), beforeTasks = await taskCount();
    const external = await provider.publication.publish({ operationId: 'browser-external-letter', atomicity: 'all-or-nothing', changes: [{ kind: 'replace', target: read.snapshot.ref, bytes: encode('Concurrent fictional human letter'), mediaType: 'text/markdown' }] }, redactionActor()); assert.equal(external.kind, 'committed');
    await browser.click(button('Adopt selected A')); await browser.until('stale letter capture rejected', 'window.redaction.session.consultations.get("first").blocks.A.outcome.kind === "conflict"'); assert.equal(await taskCount(), beforeTasks); assert.equal(new TextDecoder().decode((await provider.read({ target, revision: { kind: 'latest' } }, redactionActor())).snapshot.bytes), 'Concurrent fictional human letter');
    await browser.type('document.querySelector("[data-letter=A] textarea")', 'Independent dirty letter'); assert.equal(await run(`return ${button('Adopt selected A')}.disabled;`), true);
    await browser.screenshot('fictional-redaction-adopted.png');
  });
  await step('reload observes existing native tasks and actual saved record without new admission', async () => {
    const before = await runtime.latest('first', 'A', redactionActor()), record = await runtime.resourceClient('first', 'record-A', redactionActor()).read({ target: runtime.local.apps.first.domainPaths('A').record, revision: { kind: 'latest' } });
    await browser.reload(); await browser.until('new browser mounted', '!!window.redaction?.session'); await browser.click(button('Observe latest')); await browser.until('latest original ref', "!!window.redaction.session.consultations.get('first').blocks.A.ref");
    assert.equal(await run('return first.blocks.A.ref.validation;'), before.ref.validation); assert.equal(await run('return first.blocks.A.record.snapshot.ref.revision;'), record.snapshot.ref.revision);
  });
  await step('current access blocks late recording and crossed owner route', async () => {
    hold = true; await browser.click(button('Insert fictional dictation')); await held(() => release); revoked = true; release(); release = null;
    await browser.until('revoked transcript undisclosed', "window.redaction.session.consultations.get('first').dictations.at(-1).status === 'failed'"); assert.equal(await run('return first.dictations.at(-1).transcript;'), null); revoked = false;
    const crossed = await run("return await j.session.consultations.get('second').api.admit(first.blocks.A.request);"); assert.equal(crossed.kind, 'denied');
  });
  await step('viewer unmount leaves borrowed native task owner usable', async () => { await run('j.unmount();'); assert.equal((await runtime.latest('first', 'A', redactionActor())).kind, 'admitted'); });
  report.status = 'passed';
} catch (error) { report.status = 'failed'; report.error = String(error); process.exitCode = 1; }
finally { release?.(); releaseSave?.(); await browser?.close(); await server?.close(); await runtime?.close(); rmSync(directory, { recursive: true, force: true }); writeFileSync(join(evidence, 'journey.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report)); }
