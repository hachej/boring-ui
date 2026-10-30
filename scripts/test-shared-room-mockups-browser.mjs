import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { build } from 'esbuild';
import { launch, q, qa } from '@hachej/boring-testing/browser';
import { createRoomBackend } from '../examples/shared-chat/room-backend.mjs';
import { buildTailwind } from '../lab/studio/tailwind.mjs';

const evidence = '.cache/evidence/room-mockups/browser';
mkdirSync(evidence, { recursive: true });
const descriptors = ['A', 'B', 'C'].map(name => ({ schema: 'boring.artifact', version: 1, title: `Idea ${name} — garden`, type: 'html', mediaType: 'text/html', target: { resource: { providerId: 'room-files', path: `ideas/${name}.html` }, view: { kind: 'published' } }, revision: `immutable-${name}` }));
const report = { widths: [], reads: [], status: 'running' };
let browser, server, backend;
try {
  const bundle = await build({ entryPoints: ['test/fixtures/shared-room-mockups-browser.tsx'], bundle: true, write: false, format: 'esm', platform: 'browser', jsx: 'automatic', metafile: true, alias: { '@': new URL('../examples/app-shell', import.meta.url).pathname }, define: { 'process.env.NODE_ENV': '"production"' } });
  assert.ok(Object.keys(bundle.metafile.inputs).every(path => !/pi-durable|packages\/(agent|execution)\/|node:fs/.test(path)), 'public browser bundle has no agent/kernel/server FS');
  writeFileSync(`${evidence}/bundle.json`, JSON.stringify(bundle.metafile, null, 2));
  const css = await buildTailwind({ extraDirectories: ['registry/pm-panel'], extraFiles: ['test/fixtures/shared-room-mockups.tsx'] });
  backend = await createRoomBackend({ mockups: descriptors, streamMs: 20 });
  server = createServer(async (request, response) => {
    if (await backend.handle(request, response)) return;
    if (request.url === '/mockup' && request.method === 'POST') {
      let body = ''; for await (const part of request) body += part;
      const parsed = JSON.parse(body), match = descriptors.find(artifact => JSON.stringify(parsed) === JSON.stringify({ target: artifact.target, revision: { kind: 'exact', value: artifact.revision } }));
      report.reads.push(parsed);
      if (!match) return void response.writeHead(404).end();
      return void response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ html: `<h1>Fictional ${match.title}</h1><button onclick="this.textContent='Selected'">Try this idea</button>`, revision: match.revision }));
    }
    if (request.url === '/app.js') return void response.writeHead(200, { 'content-type': 'text/javascript' }).end(bundle.outputFiles[0].text);
    if (request.url === '/app.css') return void response.writeHead(200, { 'content-type': 'text/css' }).end(css);
    if (request.url !== '/') return void response.writeHead(404).end();
    response.writeHead(200, { 'content-type': 'text/html' }).end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>Fictional shared room mockups</title><link rel="stylesheet" href="/app.css"><style>html,body,#root{height:100%;margin:0}#root{display:flex;flex-direction:column}body{background:var(--background);color:var(--foreground);font-family:system-ui}</style><div id="root"></div><script type="module" src="/app.js"></script>');
  });
  server.on('upgrade', backend.upgrade);
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  const url = `http://127.0.0.1:${server.address().port}`;
  // A real native room wake and durable question; the native model/present execution is separately tested in agent-room.test.mjs.
  await backend.as('person:ana', 'join');
  await backend.as('person:ana', 'send', { conversationId: 'main', text: '@agent:pm Three fictional mockups', mentions: ['agent:pm'] }, 'mockup-request');
  for (const width of [375, 1280]) {
    browser = await launch(url, { evidence });
    await browser.send('Emulation.setDeviceMetricsOverride', { width, height: 844, deviceScaleFactor: 1, mobile: width < 600 });
    await browser.reload();
    await browser.until('three shared cards and native choice', `${qa('[data-testid=pm-mockup]')}.length === 3 && ${qa('[data-testid=question-option]')}.length === 3`);
    assert.deepEqual(await browser.evaluate(`${qa('[data-testid=pm-mockup-title]')}.map(e => e.textContent)`), descriptors.map(artifact => artifact.title));
    assert.equal(await browser.evaluate('document.documentElement.scrollWidth <= innerWidth'), true, 'no phone overflow');
    await browser.screenshot(`${width}-cards.png`);
    for (let i = 0; i < 3; i++) {
      await browser.click(`${qa('[data-testid=pm-mockup-open]')}[${i}]`);
      await browser.until('exact full sandbox', `!!${q('[data-testid=pm-mockup-full-run-frame]')}?.srcdoc.includes(${JSON.stringify(descriptors[i].title)})`);
      assert.equal(await browser.evaluate(`${q('[data-testid=pm-mockup-full-run-frame]')}.getAttribute('sandbox')`), 'allow-scripts');
      await browser.screenshot(`${width}-full-${i}.png`);
      await browser.click(q('[data-testid=pm-mockup-back]'));
    }
    report.widths.push(width);
    assert.deepEqual(browser.problems, []);
    await browser.close(); browser = undefined;
  }
  browser = await launch(url, { evidence });
  await browser.until('native choice', `${qa('[data-testid=question-option]')}.length === 3`);
  await browser.click(`${qa('[data-testid=question-option]')}[1]`);
  await browser.until('native settlement', 'document.body.innerText.includes("Selected B; launch not requested.")');
  assert.equal(await browser.evaluate(`${qa('[data-testid=pm-mockup]')}.length`), 3, 'question/final dedup');
  await browser.reload();
  await browser.until('history retains cards', `${qa('[data-testid=pm-mockup]')}.length === 3 && document.body.innerText.includes("Selected B; launch not requested.")`);
  const entries = await backend.entries();
  assert.ok(entries.some(entry => entry.kind === 'room.message' && entry.data.text === 'B' && entry.data.replyTo));
  assert.deepEqual(entries.findLast(entry => entry.kind === 'room.message' && entry.data.author === 'agent:pm').data.artifacts, descriptors);
  assert.equal((await backend.wakes()).length, 0);
  assert.doesNotMatch(JSON.stringify(entries), /<h1>|Try this idea/);
  writeFileSync(`${evidence}/native-room.json`, JSON.stringify(entries, null, 2));
  assert.ok(report.reads.every(read => read.revision.kind === 'exact'));
  report.status = 'passed';
} catch (error) { report.status = 'failed'; report.error = String(error); throw error; }
finally {
  writeFileSync(`${evidence}/report.json`, JSON.stringify(report, null, 2));
  await browser?.close();
  if (server) { server.closeAllConnections(); await new Promise(done => server.close(done)); }
  await backend?.close();
}
