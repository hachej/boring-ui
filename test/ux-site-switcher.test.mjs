import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import test from 'node:test';
import { buildPage, root } from '../ux/runner/build.mjs';
import { loadAll } from '../ux/runner/scenario.mjs';
import { site } from '../ux/runner/site.mjs';
import { variants } from '../ux/runner/site-page.mjs';

// The demo site's top bar: a page switcher with search, one Options menu, and on a phone a bar of the page name and a "more" menu.
const require = createRequire(join(root, 'package.json'));
let playwright; try { playwright = require('playwright-core'); } catch { /* not installed */ }
const skip = !process.env.CHROMIUM || !playwright;
const NAMES = ['component-design-system', 'component-agent-card', 'layout-bar'];
const shots = process.env.SHOTS;

let built;
/** The built showcase of three real pages, served; `open(path, viewport)` gives a Chromium page on it. */
async function serve(t) {
  if (!built) {
    const dir = mkdtempSync(join(tmpdir(), 'ux-switcher-')), from = join(dir, 'cap'), out = join(dir, 'site');
    const scenarios = NAMES.map(name => loadAll().find(s => s.target.replace(':', '-') === name));
    mkdirSync(join(from, '_pages'), { recursive: true });
    for (const [i, scenario] of scenarios.entries()) {
      const name = NAMES[i];
      mkdirSync(join(from, name), { recursive: true });
      await buildPage(scenario.fixture.entry, join(from, '_pages', `${name}.html`));
      writeFileSync(join(from, name, 'result.json'), JSON.stringify({ target: scenario.target, states: [], stateFailures: [], errors: [], flows: [] }));
      writeFileSync(join(from, name, 'target.json'), JSON.stringify({ target: scenario.target, title: scenario.title, purpose: scenario.purpose, level: scenario.target.split(':')[0], kitVersion: '0.0.0', commit: 'abc1234', capturedAt: '2026-01-01T00:00:00Z' }));
    }
    await site({ from, out, scenarios });
    built = { dir, out, scenarios };
  }
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
  const server = createServer((req, res) => {
    let file = join(built.out, decodeURIComponent(req.url.split('?')[0]));
    if (existsSync(file) && !extname(file)) file = join(file, 'index.html');
    if (!existsSync(file)) { res.statusCode = 404; res.end(); return; }
    res.setHeader('content-type', types[extname(file)] ?? 'application/octet-stream'); res.end(readFileSync(file));
  }).listen(0);
  t.after(() => server.close());
  const browser = await playwright.chromium.launch({ executablePath: process.env.CHROMIUM, args: ['--no-sandbox'] });
  t.after(() => browser.close());
  const requests = [];
  return { requests, open: async (path = '/', viewport = { width: 1440, height: 900 }, scheme = 'light') => {
    const page = await (await browser.newContext({ viewport, colorScheme: scheme, hasTouch: viewport.width < 600 })).newPage();
    page.on('request', r => requests.push(r.url()));
    await page.goto(`http://127.0.0.1:${server.address().port}${path}`);
    await page.locator('#pages').waitFor();
    return page;
  }, origin: () => `http://127.0.0.1:${server.address().port}` };
}
test.after(() => { if (built) rmSync(built.dir, { recursive: true, force: true }); });

const shot = (page, name) => (shots ? page.screenshot({ path: join(shots, `${name}.png`) }) : undefined);
const visibleTitles = page => page.locator('#sw-list .sw-item:visible .sw-title').allTextContents();

test('the switcher opens by its button, Ctrl+K, Cmd+K and /, marks the current page, groups the pages, and Esc closes it with the focus back on the button', { skip, timeout: 240000 }, async t => {
  const { open } = await serve(t);
  const page = await open();
  assert.equal(await page.locator('#pages .sw-name').textContent(), 'Design system');
  assert.equal(await page.locator('select').count(), 0, 'no native page list is left in the bar');
  for (const how of ['button', 'Control+k', 'Meta+k', '/']) {
    if (how === 'button') await page.locator('#pages').click(); else await page.keyboard.press(how);
    await page.locator('#sw-panel').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#pages').getAttribute('aria-expanded'), 'true', how);
    assert.equal(await page.evaluate(() => document.activeElement.id), 'sw-search', `${how}: the search field has the focus`);
    await page.keyboard.press('Escape');
    await page.locator('#sw-panel').waitFor({ state: 'hidden' });
    assert.equal(await page.evaluate(() => document.activeElement.id), 'pages', `${how}: Esc gives the focus back to the button`);
  }
  await page.locator('#pages').click();
  assert.deepEqual(await page.locator('#sw-list .sw-group').allTextContents(), ['Start here', 'Composer and layout'], 'groups, in order, only those with a page');
  assert.deepEqual(await visibleTitles(page), ['Design system', 'Agent cards', 'Assistant bar'], 'the owner order inside a group');
  assert.equal(await page.locator('#sw-list .sw-item[aria-current=page] .sw-title').textContent(), 'Design system', 'the current page is marked');
  assert.equal(await page.locator('#sw-list .sw-item[aria-current=page]').count(), 1);
  assert.equal(await page.locator('#sw-list a.sw-item[href]').count(), 3, 'every page is a real link');
  assert.equal(await page.locator('#sw-list a.sw-item[href="component-agent-card/index.html"] .sw-hint').textContent(), 'the ladder, folded to open', 'a one-line hint comes from the page data');
  assert.ok(await page.locator('body').evaluate(b => !b.textContent.includes('undefined')));
  await page.mouse.click(5, 600);
  await page.locator('#sw-panel').waitFor({ state: 'hidden' });
});

test('search filters by name, hint and start state ("tray"), arrows and Enter navigate, and the address of the page is unchanged', { skip, timeout: 240000 }, async t => {
  const { open } = await serve(t);
  const page = await open();
  await page.keyboard.press('Control+k');
  await page.keyboard.type('tray');
  assert.deepEqual(await visibleTitles(page), ['Agent cards', 'Assistant bar'], 'the pages that have a tray');
  assert.equal(await page.locator('#sw-list [data-sw-group]:visible').count(), 2);
  await page.keyboard.type('zzz');
  assert.equal(await page.locator('#sw-empty').isVisible(), true, 'nothing found says so');
  await page.locator('#sw-search').fill('');
  assert.equal((await visibleTitles(page)).length, 3, 'clearing the field lists every page again');
  await page.keyboard.press('ArrowDown');
  assert.equal(await page.evaluate(() => document.activeElement.textContent), 'Design systemevery part');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('ArrowUp');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'sw-search', 'arrow up from the first page goes back to the field');
  await page.keyboard.press('ArrowDown'); await page.keyboard.press('ArrowDown');
  await Promise.all([page.waitForURL(/component-agent-card\/index\.html$/), page.keyboard.press('Enter')]);
  assert.equal(await page.locator('#pages .sw-name').textContent(), 'Agent cards');
  assert.ok(new URL(page.url()).pathname.endsWith('/component-agent-card/index.html') && !new URL(page.url()).search, 'the page keeps its address');
  // Enter in the field goes to the first match.
  await page.keyboard.press('/');
  await page.keyboard.type('assistant');
  await Promise.all([page.waitForURL(/layout-bar\/index\.html$/), page.keyboard.press('Enter')]);
  // "/" typed in a text field does not open the switcher.
  await page.locator('#pages').click(); await page.locator('#sw-search').focus(); await page.keyboard.type('a/b');
  assert.equal(await page.locator('#sw-search').inputValue(), 'a/b');
});

test('the Options menu holds the start states: only a non-default choice shows in the bar, and the address reproduces it', { skip, timeout: 240000 }, async t => {
  const { open, requests, origin } = await serve(t);
  const agent = built.scenarios.find(s => s.target === 'component:agent-card'), tray = variants(agent).find(v => v.label === 'Tray');
  const page = await open('/component-agent-card/index.html');
  assert.equal(await page.locator('#options-chip').isVisible(), false, 'the default shows nothing in the bar');
  assert.equal(await page.locator('.bar > .seg, #tools .seg').count(), 1);
  assert.ok(await page.locator('#theme').isVisible() && await page.locator('[data-vp]').first().isVisible(), 'Phone | Desktop and Dark stay in the bar');
  assert.equal(await page.locator('.bar [data-variant]:visible').count(), 0, 'no row of state chips');
  await page.locator('#options').click();
  assert.deepEqual(await page.locator('#options-panel [data-variant]').allTextContents(), ['Tray', 'Open', 'Failed open', 'Task tray', 'Docked']);
  await page.locator('#options-panel').getByRole('menuitemradio', { name: 'Tray', exact: true }).click();
  await page.locator('#options-panel').waitFor({ state: 'hidden' });
  assert.equal(await page.evaluate(() => document.activeElement.id), 'options', 'the focus is back on the button');
  assert.equal(await page.locator('#options-chip').textContent(), 'Tray ×');
  assert.equal(new URL(page.url()).search, '?state=tray');
  await page.waitForFunction(q => document.querySelector('#demo').contentWindow.location.search.includes(q), tray.query);
  // The link reproduces the state, on a fresh load.
  const again = await open('/component-agent-card/index.html?state=tray');
  await again.waitForFunction(q => document.querySelector('#demo').contentWindow.location.search.includes(q), tray.query);
  assert.equal(await again.locator('#options-chip').textContent(), 'Tray ×');
  // The chip clears it.
  await again.locator('#options-chip').click();
  assert.equal(await again.locator('#options-chip').isVisible(), false);
  assert.equal(new URL(again.url()).search, '');
  assert.ok(requests.every(url => url.startsWith(origin()) || url.startsWith('data:')), 'no request leaves the site');
});

test('at 390 px the bar is the page name and a "more" menu; the switcher is a sheet; every control is at least 44 px', { skip, timeout: 240000 }, async t => {
  const { open } = await serve(t);
  const page = await open('/component-agent-card/index.html', { width: 390, height: 844 });
  const visible = await page.locator('.bar button:visible, .bar a:visible').evaluateAll(list => list.map(b => b.id || b.textContent));
  assert.deepEqual(visible, ['pages', 'more'], 'the page name and the more button only');
  assert.equal(await page.locator('#theme').isVisible() || await page.locator('#options').isVisible() || await page.locator('[data-vp]').first().isVisible(), false);
  const size = async sel => page.locator(sel).evaluateAll(list => list.filter(e => e.getClientRects().length).map(e => { const r = e.getBoundingClientRect(); return [e.id || e.textContent.slice(0, 20), Math.round(r.height), Math.round(r.width)]; }));
  for (const [id, h, w] of await size('#pages, #more')) assert.ok(h >= 44 && w >= 44, `${id} is ${w}x${h}`);
  await shot(page, 'phone-light-closed');
  await page.locator('#more').click();
  for (const sel of ['#theme', '#options', '[data-vp]']) assert.ok(await page.locator(sel).first().isVisible(), `${sel} is in the more menu`);
  for (const [id, h] of await size('#tools .icon-btn, #tools .seg button')) assert.ok(h >= 44, `${id} is ${h} px high`);
  await page.locator('#options').click();
  await page.locator('#options-panel').waitFor({ state: 'visible' });
  for (const [id, h] of await size('#options-panel .menu-item')) assert.ok(h >= 44, `${id} is ${h} px high`);
  await shot(page, 'phone-light-options');
  await page.keyboard.press('Escape'); await page.keyboard.press('Escape');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'more');
  await page.locator('#pages').click();
  const box = await page.locator('#sw-panel').boundingBox();
  assert.ok(box.width >= 389 && Math.abs(box.y + box.height - 844) < 2, `the switcher is a sheet at the bottom (${JSON.stringify(box)})`);
  for (const [id, h] of await size('#sw-search, #sw-list .sw-item')) assert.ok(h >= 44, `${id} is ${h} px high`);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'no sideways scroll');
  await shot(page, 'phone-light-switcher');
  await page.locator('#sw-search').fill('bar');
  await Promise.all([page.waitForURL(/layout-bar\/index\.html$/), page.locator('#sw-list .sw-item:visible').first().tap()]);
});

test('light and dark, 1440 and 390: screenshots of the bar closed, the switcher open and the Options menu open', { skip: skip || !shots, timeout: 300000 }, async t => {
  const { open } = await serve(t);
  mkdirSync(shots, { recursive: true });
  for (const [width, height, label] of [[1440, 900, 'desktop'], [390, 844, 'phone']]) for (const scheme of ['light', 'dark']) {
    const page = await open('/component-agent-card/index.html?state=tray', { width, height }, scheme);
    assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), scheme);
    await page.waitForTimeout(2500);
    await shot(page, `${label}-${scheme}-closed`);
    if (label === 'phone') await page.locator('#more').click();
    await page.locator('#options').click();
    await page.waitForTimeout(300);
    await shot(page, `${label}-${scheme}-options`);
    await page.keyboard.press('Escape');
    if (label === 'phone') await page.keyboard.press('Escape');
    await page.locator('#pages').click();
    await page.keyboard.type('a');
    await page.waitForTimeout(300);
    await shot(page, `${label}-${scheme}-switcher`);
  }
});
