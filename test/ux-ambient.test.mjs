import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import test from 'node:test';
import { buildPage, root } from '../ux/runner/build.mjs';

// The ambient bar (`AmbientChat`) on a phone behaves as the app shell's bar does: no strip, the grabber on the top edge is the size control (a tap
// opens the full window, whose minimize goes back), 44px hit areas, round composer actions (`data-composer-action`); and its `/` menu is the same grouped menu with a Commands button on touch.
const require = createRequire(join(root, 'package.json'));
let playwright; try { playwright = require('playwright-core'); } catch { /* not installed */ }
const skip = !process.env.CHROMIUM || !playwright;

async function launch(t, viewport, touch) {
  const dir = mkdtempSync(join(tmpdir(), 'ux-ambient-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  await buildPage('test/fixtures/themes/ambient-demo.jsx', join(dir, 'index.html'), { css: ['pi-ambient'] });
  const server = createServer((req, res) => {
    const file = join(dir, decodeURIComponent(req.url.split('?')[0]).replace(/\/$/, '/index.html'));
    if (!existsSync(file) || !extname(file)) { res.statusCode = 404; res.end(); return; }
    res.setHeader('content-type', extname(file) === '.js' ? 'text/javascript' : extname(file) === '.css' ? 'text/css' : 'text/html'); res.end(readFileSync(file));
  }).listen(0);
  t.after(() => server.close());
  const browser = await playwright.chromium.launch({ executablePath: process.env.CHROMIUM, args: ['--no-sandbox'] });
  t.after(() => browser.close());
  const page = await (await browser.newContext({ viewport, ...(touch ? { hasTouch: true, isMobile: true } : {}) })).newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}/index.html`);
  await page.locator('[data-boring=ambient-chat]').waitFor({ timeout: 30000 });
  return page;
}

for (const [width, height] of [[390, 844], [360, 740]]) {
  test(`${width}: the ambient bar has no strip, a grabber that opens the full window, round 44px composer actions`, { skip, timeout: 120000 }, async t => {
    const page = await launch(t, { width, height }, true);
    const state = () => page.locator('[data-boring=ambient-chat]').getAttribute('data-state');
    assert.equal(await state(), 'bar');
    assert.equal(await page.locator('[data-testid=composer-controller]').count(), 0, 'no strip');
    const grabber = page.locator('[data-testid=ambient-grabber]');
    const hit = await grabber.boundingBox();
    assert.ok(hit.width >= 44 && hit.height >= 44, `the grabber is a 44px target (${hit.width}x${hit.height})`);
    // Every control of the bar is a 44px target.
    const buttons = await page.locator('[data-testid=ambient-header] button:visible, [data-testid=composer] button:visible, [data-slot=input-group] button:visible').evaluateAll(list => [...new Set(list)].map(b => {
      const r = b.getBoundingClientRect(), radius = parseFloat(getComputedStyle(b).borderTopLeftRadius);
      return { id: b.dataset.testid ?? b.getAttribute('aria-label'), w: r.width, h: r.height, round: radius >= Math.min(r.width, r.height) / 2 - 0.5, label: b.textContent.trim(), action: b.hasAttribute('data-composer-action') };
    }));
    assert.ok(buttons.length >= 3, `the bar has its buttons (${JSON.stringify(buttons)})`);
    for (const b of buttons) { assert.ok(b.w >= 43.5 && b.h >= 43.5, `${b.id} is 44px (${b.w}x${b.h})`); if (b.action) assert.ok(b.round, `${b.id} is a circle`); }
    await page.screenshot({ path: join(root, '.cache/evidence', `ambient-${width}-bar.png`) });
    await grabber.tap();
    await page.waitForFunction(() => document.querySelector('[data-boring=ambient-chat]').dataset.state === 'expanded');
    const full = await page.locator('[data-boring=ambient-chat]').boundingBox();
    assert.ok(full.width >= width - 1 && full.height >= height - 1, `a tap on the grabber opens the full window (${full.width}x${full.height})`);
    await page.screenshot({ path: join(root, '.cache/evidence', `ambient-${width}-full.png`) });
    assert.equal(await page.locator('[data-testid=ambient-grabber]').count(), 0, 'the full window has no grabber over its header (its minimize goes back)');
    await page.locator('[data-testid=ambient-minimize]').tap();
    await page.waitForFunction(() => document.querySelector('[data-boring=ambient-chat]').dataset.state === 'bar');
    assert.equal(await state(), 'bar', 'minimize goes back to the bar');
  });
}

for (const [label, viewport, touch] of [['1440', { width: 1440, height: 900 }, false], ['390', { width: 390, height: 844 }, true]]) {
  test(`${label}: the ambient bar's « / » lists commands, skills and actions under headings, with kind icons`, { skip, timeout: 120000 }, async t => {
    const page = await launch(t, viewport, touch);
    const input = page.locator('[data-testid=composer-input]');
    await input.focus(); await page.keyboard.type('/');
    await page.locator('[role=listbox]').waitFor();
    assert.deepEqual(await page.locator('[data-testid=slash-heading]').allTextContents(), ['Commands', 'Skills', 'Actions'], 'one heading per group');
    assert.equal(await page.locator('[data-testid=slash-item]').count(), 9);
    assert.equal(await page.locator('[data-testid=slash-item] svg').count() >= 9, true, 'a kind icon per row');
    assert.equal(await page.locator('[data-testid=slash-search]').count(), 0, 'the field is the search: no search box');
    assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('data-testid')), 'composer-input', 'the field keeps the focus');
    if (touch) assert.ok((await page.locator('[data-testid=slash-item]').evaluateAll(items => items.map(e => e.getBoundingClientRect().height))).every(h => h >= 43.5), 'rows are 44px on touch');
    await page.screenshot({ path: join(root, '.cache/evidence', `ambient-slash-${label}.png`) });
    await page.keyboard.type('exp');
    await page.waitForFunction(() => document.querySelectorAll('[data-testid=slash-item]').length === 1);
    assert.deepEqual(await page.locator('[data-testid=slash-item]').evaluateAll(items => items.map(e => e.dataset.name)), ['export-gaps'], '/exp finds the action');
    await page.keyboard.press('Escape');
    await input.fill('');
    const button = page.locator('[data-testid=composer-bar-commands]');
    if (touch) {
      await button.tap();
      await page.locator('[role=listbox]').waitFor();
      assert.equal(await page.locator('[data-testid=slash-heading]').count(), 3, 'the Commands button opens the same menu');
    } else {
      assert.equal(await button.evaluate(e => e.getClientRects().length), 0, 'no Commands button on a wide screen');
    }
  });
}

test('1440: the ambient bar\'s composer actions are circles on the bar\'s midline, as the app shell\'s are', { skip, timeout: 120000 }, async t => {
  const page = await launch(t, { width: 1440, height: 900 }, false);
  await page.locator('[data-testid=composer-submit]').waitFor();
  const seen = await page.evaluate(() => { const box = document.querySelector('[data-testid=composer-input]').closest('[data-slot=input-group]') ?? document.querySelector('[data-testid=composer]'); const g = box.getBoundingClientRect(), mid = g.top + g.height / 2;
    return [...document.querySelectorAll('[data-composer-action]')].filter(b => b.getClientRects().length).map(b => { const r = b.getBoundingClientRect(); return { id: b.dataset.testid, round: parseFloat(getComputedStyle(b).borderTopLeftRadius) >= Math.min(r.width, r.height) / 2 - 0.5, off: Math.abs(r.top + r.height / 2 - mid), w: r.width, h: r.height }; }); });
  assert.ok(seen.length >= 2, JSON.stringify(seen));
  for (const b of seen) { assert.ok(b.round, `${b.id} is a circle`); assert.ok(b.w === b.h, `${b.id} is square (${b.w}x${b.h})`); }
  await page.screenshot({ path: join(root, '.cache/evidence', 'ambient-1440-round.png') });
});
