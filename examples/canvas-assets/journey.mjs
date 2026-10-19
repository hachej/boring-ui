// Drives the canvas-assets host in real Chromium. Proves: tldraw's stylesheet arrives only when a canvas opens; every resource the
// page requests (CSS, fonts, icons, translations, scripts) is same-origin; no security-policy violation is recorded; and tldraw's
// assets are served from this origin. Fictional content only. Set CHROMIUM to a Chromium or chrome-headless-shell binary.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { launch } from '@hachej/boring-testing/browser';
import { startCanvasAssetsServer } from './server.mjs';

const evidence = resolve(process.env.CANVAS_ASSETS_EVIDENCE ?? '.cache/evidence/canvas-assets');
mkdirSync(evidence, { recursive: true });
const report = { steps: [] };
const step = async (name, run) => {
  const item = { name, status: 'running' };
  report.steps.push(item);
  try { await run(); item.status = 'passed'; } catch (error) { item.status = 'failed'; item.error = String(error); throw error; }
};

const server = await startCanvasAssetsServer();
let browser;
try {
  browser = await launch(server.url, { evidence });
  await step('page loads without tldraw: no tldraw stylesheet and no tldraw asset request', async () => {
    await browser.until('host page', `document.querySelector('button')?.textContent === 'Open canvas'`);
    const loaded = await browser.evaluate(`[...document.styleSheets].some(sheet => [...sheet.cssRules].some(rule => rule.selectorText === '.tl-container'))`);
    assert.equal(loaded, false, 'tldraw CSS must not load before a canvas opens');
    assert.equal(server.requests.filter(line => line.includes('/tldraw-assets/')).length, 0);
  });
  await step('opening a canvas loads tldraw CSS and its assets from this origin', async () => {
    await browser.evaluate(`document.querySelector('button').click()`);
    // --tl-space-1 is declared only by tldraw.css on .tl-container; tldraw's runtime watermark style does not declare it.
    await browser.until('mounted canvas with tldraw stylesheet', `Boolean(document.querySelector('[data-boring="canvas-editor"]')) && getComputedStyle(document.querySelector('.tl-container')).getPropertyValue('--tl-space-1').trim() === '2px'`);
    await browser.until('tldraw translations loaded', `performance.getEntriesByType('resource').some(entry => entry.name.includes('/tldraw-assets/translations/'))`);
    assert.ok(server.requests.some(line => line.includes('/tldraw-assets/translations/')), 'translations are served by this origin');
  });
  await step('no external request and no CSP violation', async () => {
    const names = await browser.evaluate(`performance.getEntriesByType('resource').map(entry => entry.name)`);
    const origin = new URL(server.url).origin;
    const external = names.filter(name => !name.startsWith(origin + '/'));
    assert.deepEqual(external, [], 'every resource request must stay on the host origin');
    const violations = await browser.evaluate(`window.__cspViolations`);
    assert.deepEqual(violations, [], 'the host policy must not be violated');
    assert.deepEqual(browser.problems.filter(text => /Content Security Policy|cdn\.tldraw/i.test(text)), []);
    report.resources = names.length;
    report.assetRequests = server.requests.filter(line => line.includes('/tldraw-assets/')).length;
  });
  await step('desktop 1440 and phone 390 evidence', async () => {
    await browser.screenshot('desktop-light');
    await browser.emulate('phone');
    await browser.until('canvas on phone', `Boolean(document.querySelector('[data-boring="canvas-editor"]'))`);
    await browser.screenshot('phone-light');
  });
} finally {
  if (browser) await browser.close();
  await server.close();
  writeFileSync(resolve(evidence, 'report.json'), JSON.stringify(report, null, 2));
}
console.log(JSON.stringify(report, null, 2));
