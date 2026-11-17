import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import test from 'node:test';
import { buildPage, root } from '../ux/runner/build.mjs';
import { loadAll } from '../ux/runner/scenario.mjs';

// The `/` menu of the one composer (the design-system page's real AppShell): Commands, Skills and Actions under headings, filtered as you type,
// driven by the keyboard, and each kind does its own thing (a command acts on the page, a skill is sent to the assistant, an action asks approval first).
const require = createRequire(join(root, 'package.json'));
let playwright; try { playwright = require('playwright-core'); } catch { /* not installed */ }
const skip = !process.env.CHROMIUM || !playwright;

for (const [label, viewport, touch] of [['1440', { width: 1440, height: 900 }, false], ['390', { width: 390, height: 844 }, true]]) {
  test(`${label}: « / » lists commands, skills and actions under headings, filters across them, and each kind works`, { skip, timeout: 240000 }, async t => {
    const dir = mkdtempSync(join(tmpdir(), 'ux-slash-'));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    const scenario = loadAll().find(s => s.target === 'component:design-system');
    await buildPage(scenario.fixture.entry, join(dir, 'index.html'));
    const server = createServer((req, res) => {
      const file = join(dir, decodeURIComponent(req.url.split('?')[0]).replace(/\/$/, '/index.html'));
      if (!existsSync(file) || !extname(file)) { res.statusCode = 404; res.end(); return; }
      res.setHeader('content-type', extname(file) === '.js' ? 'text/javascript' : extname(file) === '.css' ? 'text/css' : 'text/html'); res.end(readFileSync(file));
    }).listen(0);
    t.after(() => server.close());
    const browser = await playwright.chromium.launch({ executablePath: process.env.CHROMIUM, args: ['--no-sandbox'] });
    t.after(() => browser.close());
    const page = await (await browser.newContext({ viewport, ...(touch ? { hasTouch: true, isMobile: true } : {}) })).newPage();
    await page.goto(`http://127.0.0.1:${server.address().port}/index.html?pace=instant`);
    const input = page.locator('[data-testid=composer-input]');
    await input.waitFor({ timeout: 30000 });
    assert.match(await input.getAttribute('placeholder') ?? '', /type \//i, 'the field says it takes « / »');

    const clear = async () => { await input.fill(''); };
    const open = async () => { await clear(); await input.focus(); await page.keyboard.type('/'); await page.locator('[role=listbox]').waitFor(); };
    await open();
    const headings = await page.locator('[data-testid=slash-heading]').allTextContents();
    assert.deepEqual(headings, ['Commands', 'Skills', 'Actions'], 'one heading per group');
    assert.equal(await page.locator('[data-testid=slash-item]').count(), 9, 'three of each kind');
    assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('data-testid')), 'composer-input', 'the field keeps the focus');
    assert.equal(await page.evaluate(() => [...document.querySelectorAll('[data-testid=slash-heading]')].every(e => e.tabIndex < 0 && !e.matches('button, a, [tabindex]'))), true, 'headings are not focusable');
    const geometry = await page.evaluate(() => { const list = document.querySelector('[role=listbox]').getBoundingClientRect(), field = document.querySelector('[data-testid=composer-input]').getBoundingClientRect();
      return { above: list.bottom <= field.top + 1, rows: [...document.querySelectorAll('[data-testid=slash-item]')].map(e => e.getBoundingClientRect().height), top: list.top }; });
    assert.equal(geometry.above, true, 'the list opens above the field');
    if (touch) { assert.ok(geometry.rows.every(h => h >= 43.5), `rows are 44px targets on touch (${geometry.rows})`); }
    assert.ok(await page.locator('[data-testid=slash-hint]').count() >= 2, 'argument hints show');
    await page.screenshot({ path: join(root, '.cache/evidence', `slash-menu-${label}.png`) });

    // Filtering runs across the kinds; the heading of an empty group goes.
    await page.keyboard.type('exp');
    await page.waitForFunction(() => document.querySelectorAll('[data-testid=slash-item]').length === 1);
    assert.deepEqual(await page.locator('[data-testid=slash-item]').evaluateAll(items => items.map(e => e.dataset.name)), ['export-gaps'], '/exp finds the action');
    assert.deepEqual(await page.locator('[data-testid=slash-heading]').allTextContents(), ['Actions']);

    // Arrow keys move the highlight, Esc closes and keeps the text.
    await open();
    await page.keyboard.press('ArrowDown');
    assert.equal(await page.locator('[data-testid=slash-item][data-active=true]').evaluate(e => e.dataset.name), 'help', 'ArrowDown moves to the second row');
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('[role=listbox]').count(), 0, 'Esc closes the menu');
    assert.equal(await input.inputValue(), '/', 'and keeps the text');

    // Tab picks a command: it acts on the field.
    await clear(); await page.keyboard.type('/hel'); await page.keyboard.press('Tab');
    assert.equal(await input.inputValue(), 'What can you do here?', 'a command runs');

    // A skill puts its name in the field; the person adds the argument and sends it.
    await clear(); await page.keyboard.type('/summ'); await page.keyboard.press('Enter');
    assert.equal(await input.inputValue(), '/summarize ', 'a skill fills the field');
    await page.keyboard.type('samples/open-gaps.csv');
    if (touch) await page.locator('[data-testid=composer-submit]').tap(); else await page.keyboard.press('Enter');
    await page.getByText('Four gaps are open').first().waitFor({ timeout: 30000 });

    // An action asks the assistant to do something; the approval comes first, then it is done.
    await clear(); await input.focus(); await page.keyboard.type('/exp'); await page.keyboard.press('Enter');
    // The folded card carries the approval (`agent-approval`); where it does not yet, the open conversation does.
    await page.locator('[data-testid=agent-approval-approve], [data-testid=approval-approve]').first().waitFor({ state: 'attached', timeout: 30000 });
    if (await page.locator('[data-testid=agent-approval-approve]').count() === 0) await page.locator('[data-testid=agent-bar-conversation]').click({ force: true });
    const approve = page.locator('[data-testid=agent-approval-approve], [data-testid=approval-approve]').first();
    await approve.waitFor({ timeout: 30000 });
    await approve.click();
    await page.getByText('4 rows saved').first().waitFor({ timeout: 30000 });

    // The same composer in the open conversation: the same menu, not a copy.
    await clear(); await page.keyboard.press('Escape');
    await page.locator('[data-testid=agent-bar-conversation]').click({ force: true });
    await page.locator('[data-testid=agent-tray], [data-testid=agent-layer-sheet][data-state=half], [data-testid=agent-layer][data-state=half]').first().waitFor({ timeout: 10000 });
    await open();
    assert.deepEqual(await page.locator('[data-testid=slash-heading]').allTextContents(), ['Commands', 'Skills', 'Actions'], 'the open conversation has the same menu');
    await page.keyboard.press('Escape');

    // On touch the bar has a Commands button at its end that opens the same menu.
    if (touch) {
      await clear();
      const button = page.locator('[data-testid=composer-bar-commands]');
      assert.equal(await button.count(), 1, 'a Commands button on the bar');
      await button.tap();
      await page.locator('[role=listbox]').waitFor();
      assert.equal(await page.locator('[data-testid=slash-heading]').count(), 3, 'the button opens the same menu');
    }
  });
}
