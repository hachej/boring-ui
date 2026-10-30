import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { build } from 'esbuild';
import { launch, pause } from '@hachej/boring-testing/browser';
import { buildTailwind } from '../../lab/studio/tailwind.mjs';

// Real public registry components and the existing demo's Base UI preset/theme. No model, API or mutation route.
const evidence = resolve('.cache/evidence/task-list-compact/screenshots'); mkdirSync(evidence, { recursive: true });
const bundle = await build({ entryPoints: ['examples/task-board/compact-page.tsx'], bundle: true, write: false, format: 'esm', platform: 'browser', jsx: 'automatic', alias: { '@': resolve('examples/app-shell') }, define: { 'process.env.NODE_ENV': '"production"' }, logLevel: 'silent' });
const css = await buildTailwind({ extraDirectories: ['examples/task-board', 'registry/task-board'], extraCss: `@layer base { @import "tailwindcss/preflight.css"; }\n${readFileSync(new URL('./studio-theme.css', import.meta.url), 'utf8')}` });
const html = '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"><title>Fictional native requests</title></head><body class="bg-background text-foreground font-sans"><div id="root"></div><script type="module" src="/page.js"></script></body></html>';
const statics = { '/': ['text/html', html], '/page.js': ['text/javascript', bundle.outputFiles[0].contents], '/app.css': ['text/css', css] };
const server = createServer((request, response) => {
  const asset = request.method === 'GET' && statics[new URL(request.url, 'http://fixture.invalid').pathname];
  if (!asset) return void response.writeHead(404).end();
  response.writeHead(200, { 'content-type': asset[0] }).end(asset[1]);
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
let browser;
const url = `http://127.0.0.1:${server.address().port}`;
const results = [];
try {
  browser = await launch(url, { evidence });
  for (const width of [375, 1280]) for (const locale of ['fr', 'en']) for (const dark of [false, true]) {
    await browser.send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: width === 375 });
    await browser.send('Page.navigate', { url: `${url}/?locale=${locale}${dark ? '&dark=1' : ''}` });
    await browser.until('native compact list', 'document.querySelectorAll("[data-task-card]").length === 4');
    await pause(300);
    assert.equal(await browser.evaluate('document.documentElement.scrollWidth <= innerWidth'), true, 'no horizontal overflow');
    assert.deepEqual(await browser.evaluate('[...document.querySelectorAll("[data-task-card]")].map(row => row.querySelectorAll("[data-slot=badge]").length)'), [1, 1, 1, 1]);
    assert.equal(await browser.evaluate('document.querySelector("[data-task-group=closed] button").getAttribute("aria-expanded")'), 'false');
    assert.equal(await browser.evaluate('!!document.querySelector("[data-task-group=technical]")'), false);
    const name = `${locale}-${width}-${dark ? 'dark' : 'light'}.png`;
    await browser.screenshot(name); results.push(name);
  }
  await browser.send('Page.navigate', { url: `${url}/?owner=1` });
  await browser.until('explicit owner technical group', '!!document.querySelector("[data-task-group=technical]")');
  assert.equal(await browser.evaluate('!!document.querySelector("[data-task-card=fictional-5]")'), false);
  await browser.click('document.querySelector("[data-task-group=technical] button")');
  await browser.until('technical expansion', '!!document.querySelector("[data-task-card=fictional-5]")');
  await browser.screenshot('owner-technical-expanded.png');
  await browser.click('document.querySelector("[data-task-actions] button")');
  await browser.until('authorized edit intent', 'document.querySelector("[role=status]")?.textContent === "Modifier"');
  await browser.click('document.querySelector("[data-task-actions] button:last-child")');
  await browser.until('authorized confirm intent', 'document.querySelector("[role=status]")?.textContent === "Confirmer"');
  await browser.click('document.querySelector("[data-task-open=fictional-0]")');
  await browser.until('full original need in native detail', 'document.querySelector("[data-task-detail]")?.textContent.includes("including all original details.")');
  await browser.screenshot('original-native-detail.png');
  assert.deepEqual(browser.problems, []);
  writeFileSync(`${evidence}/journey.json`, JSON.stringify({ screenshots: results, ownerExpansion: true, authorizedActions: true, originalNativeDetail: true, modelCalls: 0, livePosts: 0 }, null, 2) + '\n');
  console.log(`PASS compact native fixture: ${results.length + 2} screenshots, 375/1280 FR/EN light/dark, owner expansion, actions and original detail`);
} finally {
  await browser?.close(); server.closeAllConnections(); await new Promise(done => server.close(done));
}
