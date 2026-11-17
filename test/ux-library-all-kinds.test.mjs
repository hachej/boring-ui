import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { buildPage, root } from '../ux/runner/build.mjs';

// Every sample the demo's Library holds (`?demo=1`, invented files made in memory), opened through the real shell: the Library tree, a click, the pane's viewer.
// Each sample names the viewer it must open (a testid inside the pane), and the pane must be drawn, not blank, with no console error, at 1440 and 390.
const require = createRequire(join(root, 'package.json'));
let playwright; try { playwright = require('playwright-core'); } catch { /* not installed */ }
const skip = !process.env.CHROMIUM || !playwright;
const VIEWPORTS = [{ name: '1440', width: 1440, height: 900, touch: false }, { name: '390', width: 390, height: 844, touch: true }];
const FOLDERS = ['uploads', 'invoices', 'receipts', 'exports', 'videos', 'samples', 'samples/archive', 'samples/looks'];

// path -> the viewer's own testid in the pane
const selector = viewer => viewer.includes('[') ? viewer : `[data-testid=${viewer}]`;
const SAMPLES = {
  'closing-notes.md': 'pane-markdown',
  'samples/archive/notes-2025.md': 'pane-markdown',
  'uploads/statement-january.pdf': 'agent-preview-stage',
  'uploads/statement-february.pdf': 'agent-preview-stage',
  'invoices/invoice-delmore-0112.pdf': 'agent-preview-stage',
  'invoices/invoice-axiom-0108.pdf': 'agent-preview-stage',
  'invoices/invoice-brown-0121.pdf': 'agent-preview-stage',
  'receipts/receipt-harbor-garage-0109.pdf': 'agent-preview-stage',
  'receipts/note-gap-0109.md': 'pane-markdown',
  'uploads/discrepancies-january.csv': 'artifact-csv',
  'samples/open-gaps.csv': 'artifact-csv',
  'samples/archive/gaps-2025.csv': 'artifact-csv',
  'receipts/ticket-harbor-garage-0109.png': 'agent-preview-image',
  'videos/studio-tour.webm': 'agent-preview-video',
  'samples/harbor-logo.svg': 'agent-preview-image',
  'exports/reminder-delmore.txt': 'agent-preview-text',
  'exports/entries-january.json': 'artifact-code',
  'samples/reconcile.ts': 'artifact-code',
  'samples/reconcile.py': 'artifact-code',
  'samples/close-month.sh': 'artifact-code',
  'samples/booking.diagram.json': 'diagram',
  'samples/oakfield-garden.excalidraw.json': 'drawing-image',
  'samples/bakery-morning.drawio.xml': 'drawing-image',
  'samples/booking.mockup.html': 'mockup-run-frame',
  'samples/booking.maquette.json': 'maquette-screen',
  'samples/entries.records.json': '[data-testid=records-phone], [data-testid=agent-preview-view] table',
  'samples/gaps-chart.html': 'demo-html-run-frame',
  'samples/welcome.html': 'demo-html-run-frame',
  'samples/looks/missing-receipts.looks.json': 'looks-grid',
  'samples/looks/missing-receipts-layouts.looks.json': 'layouts-grid',
  'samples/looks/missing-receipts.mockup.html': 'mockup-run-frame',
  'samples/looks/layout-board.mockup.html': 'mockup-run-frame',
  'samples/looks/layout-list-detail.mockup.html': 'mockup-run-frame',
  'samples/looks/layout-table.mockup.html': 'mockup-run-frame',
};
// The drawing samples are invented content the renderer cannot fetch from a file:// page: a font of Excalidraw's, an image placeholder and an image of an invented host.
const KNOWN = [/Fetch API cannot load file:\/\/\/excalidraw\/fonts\//, /Not allowed to load local resource: file:\/\/.*\/x$/, /fictional\.invalid\/logo\.png.*Content Security Policy/];

test('every sample in the demo Library opens its own viewer, drawn and without error, at 1440 and 390', { skip, timeout: 420000 }, async t => {
  const dir = mkdtempSync(join(tmpdir(), 'library-kinds-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const page = join(dir, 'page.html');
  await buildPage('test/fixtures/themes/one-composer.jsx', page);
  const browser = await playwright.chromium.launch({ executablePath: process.env.CHROMIUM, args: ['--no-sandbox'] });
  t.after(() => browser.close());
  const scope = '[data-testid=fixture-library]';
  for (const viewport of VIEWPORTS) {
    const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height }, hasTouch: viewport.touch, isMobile: viewport.touch });
    const tab = await context.newPage();
    const errors = [];
    tab.on('pageerror', error => errors.push(String(error)));
    tab.on('console', message => { if (message.type() === 'error' && !KNOWN.some(known => known.test(message.text()))) errors.push(message.text()); });
    await tab.goto(`file://${page}?demo=1&pace=instant&${viewport.touch ? 'tabs=1' : 'single=1'}`);
    await tab.locator('[data-testid=composer-input]').first().waitFor({ timeout: 30000 });
    if (await tab.locator('[data-testid=agent-bar-conversation]').count()) await tab.locator('[data-testid=agent-bar-conversation]').dispatchEvent('click');
    await tab.locator('[data-testid=agent-layer-library]:visible').first().click();
    await tab.locator(`${scope} [role=treeitem]`).first().waitFor({ timeout: 15000 });
    for (const folder of FOLDERS) {
      const item = tab.locator(`${scope} [role=treeitem][data-path="${folder}"]`);
      await item.waitFor();
      if (await item.getAttribute('aria-expanded') !== 'true') await item.locator('.file-tree-row-button').first().click();
    }
    for (const [path, viewer] of Object.entries(SAMPLES)) {
      const label = `${viewport.name} ${path}`;
      const row = tab.locator(`${scope} [role=treeitem][data-path="${path}"] .file-tree-row-button`).first();
      await row.scrollIntoViewIfNeeded();
      await row.click();
      const pane = tab.locator('[data-testid=agent-preview]');
      await pane.locator('[data-testid=agent-preview-title]').waitFor({ timeout: 15000 });
      const root = pane.locator(selector(viewer)).locator('visible=true').first();
      await root.waitFor({ state: 'visible', timeout: 20000 });
      assert.equal(await pane.locator('[data-testid=agent-preview-title]').innerText(), path.split('/').at(-1), `${label}: the pane is titled with the file`);
      const box = await root.boundingBox();
      assert.ok(box && box.width > 20 && box.height > 8, `${label}: the viewer (${viewer}) has a size (${JSON.stringify(box)})`);
      const drawn = await root.evaluate(element => element.innerText.trim().length > 0 || element.matches('img, canvas, iframe, video, svg') || element.querySelector('img, canvas, iframe, video, svg') !== null);
      assert.ok(drawn, `${label}: the pane is not blank`);
      assert.ok(await tab.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), `${label}: no sideways scroll on the page`);
      if (/\.(ts|py|sh|json)$/.test(path) && viewer === 'artifact-code') {
        const colored = await pane.locator('[data-testid=artifact-code] code span').count();
        assert.ok(colored > 0, `${label}: the code is coloured`);
        assert.equal(await pane.locator('[data-testid=artifact-code] li').count() > 1, true, `${label}: its lines are numbered`);
      }
      if (path === 'samples/gaps-chart.html') {
        const frame = await pane.locator('[data-testid=demo-html-run-frame]').elementHandle().then(handle => handle.contentFrame());
        await frame.waitForFunction(() => document.documentElement.getAttribute('data-d3'), null, { timeout: 15000 });
        assert.equal(await frame.evaluate(() => document.querySelectorAll('rect.bar').length), 5, `${label}: d3 drew the five bars from the offline copy`);
      }
      await pane.locator('[data-testid=agent-preview-back]').click();
      await tab.locator(`${scope} [role=treeitem]`).first().waitFor({ timeout: 15000 });
    }
    assert.deepEqual(errors, [], `${viewport.name}: no console or page error`);
    await context.close();
  }
});

test('code in the pane follows the theme: keywords differ from plain text in light and dark, long lines wrap on a phone and scroll on a desktop', { skip, timeout: 240000 }, async t => {
  const dir = mkdtempSync(join(tmpdir(), 'library-code-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const page = join(dir, 'page.html');
  await buildPage('test/fixtures/themes/one-composer.jsx', page);
  const browser = await playwright.chromium.launch({ executablePath: process.env.CHROMIUM, args: ['--no-sandbox'] });
  t.after(() => browser.close());
  const scope = '[data-testid=fixture-library]';
  for (const viewport of VIEWPORTS) for (const dark of [false, true]) {
    const label = `${viewport.name} ${dark ? 'dark' : 'light'}`;
    const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height }, hasTouch: viewport.touch, isMobile: viewport.touch });
    const tab = await context.newPage();
    await tab.goto(`file://${page}?demo=1&pace=instant&${viewport.touch ? 'tabs=1' : 'single=1'}${dark ? '&dark=1' : ''}`);
    await tab.locator('[data-testid=composer-input]').first().waitFor({ timeout: 30000 });
    if (await tab.locator('[data-testid=agent-bar-conversation]').count()) await tab.locator('[data-testid=agent-bar-conversation]').dispatchEvent('click');
    await tab.locator('[data-testid=agent-layer-library]:visible').first().click();
    for (const folder of ['samples']) await tab.locator(`${scope} [role=treeitem][data-path="${folder}"] .file-tree-row-button`).first().click();
    await tab.locator(`${scope} [role=treeitem][data-path="samples/reconcile.ts"] .file-tree-row-button`).first().click();
    const code = tab.locator('[data-testid=agent-preview] [data-testid=artifact-code]');
    await code.waitFor({ timeout: 15000 });
    const read = await code.evaluate(element => {
      const color = node => getComputedStyle(node).color;
      const keyword = [...element.querySelectorAll('span')].find(span => span.textContent === 'export');
      const comment = [...element.querySelectorAll('span')].find(span => span.textContent.startsWith('// Invented'));
      const plain = element.querySelector('li:nth-child(8) code');
      const longest = [...element.querySelectorAll('code')].reduce((a, b) => b.textContent.length > a.textContent.length ? b : a);
      return { keyword: color(keyword), comment: color(comment), plain: color(plain), white: getComputedStyle(longest).whiteSpace, fits: element.scrollWidth <= element.clientWidth + 1 };
    });
    assert.notEqual(read.keyword, read.plain, `${label}: a keyword is not drawn like plain text`);
    assert.notEqual(read.comment, read.plain, `${label}: a comment is not drawn like plain text`);
    if (viewport.touch) { assert.equal(read.white, 'pre-wrap', `${label}: long lines wrap on a phone`); assert.ok(read.fits, `${label}: nothing scrolls sideways on a phone`); }
    else assert.equal(read.white, 'pre', `${label}: long lines scroll on a desktop`);
    await context.close();
  }
});
