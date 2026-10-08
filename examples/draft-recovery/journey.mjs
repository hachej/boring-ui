import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { build } from 'esbuild';
import { launch, q } from '@hachej/boring-testing/browser';
import { webRequest, sendWebResponse } from '@hachej/boring-files/node-http';
import { openDraftHost, draftIdentity, draftTarget } from './host.mjs';

const evidence = resolve('.cache/evidence/draft-recovery-browser'); mkdirSync(evidence, { recursive: true });
const directory = mkdtempSync(join(tmpdir(), 'boring-draft-browser-'));
const report = { status: 'running', steps: [] };
let host, server, browser, holdPublish = false, publishHeld = false, releasePublish;
const held = async predicate => { const until = Date.now() + 10000; while (!predicate()) { assert.ok(Date.now() < until, 'Host barrier arrived'); await delay(10); } };
const record = () => { writeFileSync(join(evidence, 'journey.json'), JSON.stringify(report, null, 2)); };
const step = async (name, action) => {
  const item = { name, status: 'running' }; report.steps.push(item); record(); console.log(JSON.stringify(item));
  try { await action(); item.status = 'passed'; }
  catch (error) { item.status = 'failed'; throw error; }
  finally { record(); console.log(JSON.stringify(item)); }
};
const ready = () => browser.until('four concrete viewers ready', '!!(window.drafts?.ready && window.drafts.editor)');
const reload = async () => {
  const previous = await browser.evaluate("window.drafts.controllers.get('markdown').actions.selection().target.instanceId");
  await browser.reload();
  await browser.until('new page owns all four concrete viewers', `!!(window.drafts?.ready && window.drafts.editor && window.drafts.controllers.get('markdown').actions.selection().target.instanceId !== ${JSON.stringify(previous)})`);
};
const button = (format, label) => `[...document.querySelectorAll('[data-format="${format}"] button')].find(button=>button.textContent.trim()===${JSON.stringify(label)})`;
const state = format => `window.drafts.controllers.get('${format}').getSnapshot()`;
const type = async (format, text) => { const selector = q(`[data-format="${format}"] textarea`); await browser.click(selector); await browser.evaluate(`(${selector}).select()`); await browser.send('Input.insertText', { text }); };
try {
  const bundle = await build({ entryPoints: [resolve('examples/draft-recovery/browser.jsx')], outfile: join(directory, 'view.js'), platform: 'browser', format: 'esm', bundle: true, target: 'es2022', metafile: true, loader: { '.woff2': 'dataurl', '.woff': 'dataurl', '.ttf': 'dataurl', '.svg': 'dataurl', '.png': 'dataurl' } });
  assert.ok(!Object.keys(bundle.metafile.inputs).some(path => /pi-durable|packages\/agent\/|node-http|sqlite-workspaces/.test(path)), 'Browser bundle excludes server/native runtime'); writeFileSync(join(evidence, 'bundle.json'), JSON.stringify(bundle.metafile, null, 2));
  host = await openDraftHost({ filename: join(directory, 'resources.sqlite'), beforePublish: async () => { if (holdPublish) { publishHeld = true; await new Promise(resolve => { releasePublish = resolve; }); publishHeld = false; } } });
  const sources = {};
  for (const format of ['markdown', 'html', 'canvas', 'experience']) sources[format] = (await host.provider.read({ target: draftTarget(format), revision: { kind: 'latest' } }, draftIdentity)).snapshot.ref;
  server = createServer(async (incoming, outgoing) => {
    const abort = new AbortController(); outgoing.on('close', () => { if (!outgoing.writableFinished) abort.abort(); });
    try {
      const url = new URL(incoming.url, 'http://127.0.0.1');
      if (['/view.js', '/view.css'].includes(url.pathname)) { await sendWebResponse(new Response(readFileSync(join(directory, url.pathname.slice(1))), { headers: { 'content-type': url.pathname.endsWith('.js') ? 'text/javascript' : 'text/css' } }), outgoing); return; }
      if (url.pathname.startsWith('/resource/')) { const request = await webRequest(incoming, url, { signal: abort.signal }); await sendWebResponse(request ? await host.handle(request) : new Response(null, { status: 413 }), outgoing); return; }
      await sendWebResponse(new Response('<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="/view.css"><style>body{font:16px sans-serif;margin:20px}section[data-format]{margin:24px 0;padding:16px;border:1px solid #aaa}textarea{width:95%;min-height:80px}</style><div id="root"></div><script type="module" src="/view.js"></script>', { headers: { 'content-type': 'text/html' } }), outgoing);
    } catch { if (!outgoing.headersSent) outgoing.writeHead(500); outgoing.end(); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  browser = await launch(origin, { evidence }); await ready();
  await step('actual IndexedDB session/floors/bounds conformance', async () => {
    const { checkIndexedDbStore } = await import('./store-conformance.mjs');
    await browser.evaluate(`(${checkIndexedDbStore.toString()})(window.drafts.openDraftDatabase, indexedDB, (value,label)=>{if(!value)throw new Error(label)})`);
  });
  await step('all four drafts checkpoint and reload without publication', async () => {
    assert.equal(host.publications(), 0);
    await type('markdown', '# Recovered fictional Markdown 🌞');
    await type('html', '\uFEFF<p>Recovered fictional HTML 🌞</p>');
    await browser.evaluate('window.drafts.addCanvas(); window.drafts.changeLayout();');
    for (const format of ['markdown', 'html', 'canvas', 'experience']) { await browser.click(button(format, 'Store draft for recovery')); await browser.until(`${format} checkpoint`, `${state(format)}.recovery.checkpoint.kind==='stored'`); }
    const epoch = await browser.evaluate('window.drafts.session.epoch'); await reload(); assert.equal(await browser.evaluate('window.drafts.session.epoch'), epoch); assert.equal(host.publications(), 0);
    for (const format of ['markdown', 'html', 'canvas', 'experience']) { await browser.click(button(format, 'Check stored drafts')); await browser.until(`${format} recovery offer`, `${state(format)}.recovery.discovery.kind==='offered'`); await browser.click(button(format, 'Restore draft')); await browser.until(`${format} restored locally`, `${state(format)}.dirty`); }
    assert.equal(host.publications(), 0); assert.equal(await browser.evaluate(`${state('html')}.text`), '\uFEFF<p>Recovered fictional HTML 🌞</p>');
    assert.ok(await browser.evaluate(`Object.values(${state('canvas')}.document.store).some(record=>record.typeName==='shape')`)); assert.equal(await browser.evaluate(`${state('experience')}.pin`), null);
    for (const format of ['markdown', 'html', 'canvas', 'experience']) { await browser.click(button(format, format === 'experience' ? 'Keep this layout' : 'Save')); await browser.until(`${format} receipt`, `${state(format)}.save.result?.kind==='saved'`); const result = await browser.evaluate(`${state(format)}.save.result`); assert.equal(result.receipt.changes[0].after.revision, result.ref.revision); const lookup = await host.provider.reconciliation.lookup(result.receipt.operationId, draftIdentity); assert.equal(lookup.kind, 'committed'); assert.notEqual(result.ref.revision, sources[format].revision); }
    assert.equal(host.publications(), 4); await browser.screenshot('four-viewers-restored.png');
  });
  await step('late saved selection cannot delete newer typing across reload', async () => {
    await type('html', '<p>Selected V1</p>'); await browser.click(button('html', 'Store draft for recovery')); await browser.until('V1 stored', `${state('html')}.recovery.checkpoint.kind==='stored'`);
    holdPublish = true; await browser.click(button('html', 'Save')); await held(() => publishHeld);
    await type('html', '<p>Newer V2 🌞</p>'); await browser.evaluate("window.drafts.controllers.get('html').actions.checkpointDraft()");
    holdPublish = false; releasePublish(); releasePublish = undefined;
    await browser.until('V1 saved preserves V2', `${state('html')}.save.result?.kind==='saved'&&${state('html')}.dirty`);
    await browser.evaluate("window.drafts.controllers.get('html').actions.checkpointDraft()");
    await reload(); await browser.click(button('html', 'Check stored drafts')); await browser.until('V2 recovered choice', `${state('html')}.recovery.discovery.choices?.some(choice=>choice.text==='<p>Newer V2 🌞</p>')`); await browser.click(button('html', 'Restore draft'));
    await browser.until('V2 restore completed with exact text', `${state('html')}.text==='<p>Newer V2 🌞</p>'&&${state('html')}.dirty`);
    assert.equal(await browser.evaluate(`${state('html')}.text`), '<p>Newer V2 🌞</p>');
    await browser.click(button('html', 'Save')); await browser.until('V2 saved', `${state('html')}.save.result?.kind==='saved'&&!${state('html')}.dirty`); assert.equal(host.publications(), 6);
  });
  await step('changed resource revision offers conflict without overwrite', async () => {
    await type('markdown', '# Draft on previous revision'); await browser.click(button('markdown', 'Store draft for recovery')); await browser.until('conflict candidate persisted', `${state('markdown')}.recovery.checkpoint.kind==='stored'`);
    const read = await host.provider.read({ target: draftTarget('markdown'), revision: { kind: 'latest' } }, draftIdentity);
    const human = await host.provider.publication.publish({ operationId: 'fictional-other-human', atomicity: 'all-or-nothing', changes: [{ kind: 'replace', target: read.snapshot.ref, bytes: new TextEncoder().encode('# Actual newer fictional saved document'), mediaType: 'text/markdown' }] }, draftIdentity); assert.equal(human.kind, 'committed');
    await reload(); await browser.click(button('markdown', 'Check stored drafts')); await browser.until('changed revision conflict', `${state('markdown')}.recovery.discovery.choices?.[0]?.compatibility==='conflict'`);
    assert.equal(await browser.evaluate(`(${button('markdown', 'Restore draft')}).disabled`), true); assert.equal(await browser.evaluate(`${state('markdown')}.text`), '# Actual newer fictional saved document'); assert.equal(host.publications(), 6);
  });
  await step('two tabs and exact discard preserve independent writer', async () => {
    await type('html', '<p>First tab unsaved</p>'); await browser.click(button('html', 'Store draft for recovery')); await browser.until('first tab stored', `${state('html')}.recovery.checkpoint.kind==='stored'`);
    const tab = await browser.openTab(origin);
    try { await tab.until('second tab ready', 'window.drafts?.ready'); await tab.evaluate("window.drafts.controllers.get('html').actions.edit('<p>Second tab unsaved</p>'); window.drafts.controllers.get('html').actions.checkpointDraft();"); await tab.until('second tab stored', `${state('html')}.recovery.checkpoint.kind==='stored'`); await reload(); await browser.click(button('html', 'Check stored drafts')); await browser.until('two writer choices', `${state('html')}.recovery.discovery.choices?.length===2`); await browser.click(button('html', 'Discard stored draft')); await browser.click(button('html', 'Check stored drafts')); await browser.until('one writer remains', `${state('html')}.recovery.discovery.choices?.length===1`); } finally { await tab.close(); }
  });
  await step('delayed storage write cannot cross durable logout', async () => {
    await browser.evaluate("window.drafts.holdWrite=true; window.drafts.controllers.get('html').actions.edit('<p>Logout race</p>'); window.drafts.pendingCheckpoint=window.drafts.controllers.get('html').actions.checkpointDraft(); void 0;");
    await browser.until('storage write held before transaction', 'window.drafts.writeHeld');
    await browser.evaluate('window.drafts.logout()');
    await browser.evaluate('window.drafts.releaseWrite();');
    assert.equal((await browser.evaluate('window.drafts.pendingCheckpoint')).kind, 'denied');
    await browser.until('revocation visible', `${state('html')}.recovery.kind==='revoked'`);
    const oldEpoch = await browser.evaluate('window.drafts.session.epoch');
    await reload();
    assert.notEqual(await browser.evaluate('window.drafts.session.epoch'), oldEpoch);
    await browser.click(button('html', 'Check stored drafts'));
    await browser.until('logout purged old payloads', `${state('html')}.recovery.discovery.kind==='empty'`);
    assert.equal(host.publications(), 6);
  });
  report.status = 'passed';
} catch (error) {
  report.status = 'failed'; report.error = String(error); process.exitCode = 1;
  report.html = await browser?.evaluate("window.drafts?.controllers.get('html').getSnapshot()").catch(() => undefined);
}
finally { releasePublish?.(); await browser?.close(); if (server?.listening) await new Promise(resolve => server.close(resolve)); host?.close(); rmSync(directory, { recursive: true, force: true }); writeFileSync(join(evidence, 'journey.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report)); }
