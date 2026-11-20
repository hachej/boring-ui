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

// The top bar's Play menu lists the page's "things to try" and plays one into the real demo: the scripted assistant's response shows in the conversation.
const require = createRequire(join(root, 'package.json'));
let playwright; try { playwright = require('playwright-core'); } catch { /* not installed */ }
const skip = !process.env.CHROMIUM || !playwright;

/** The design system page of the site, served and open in Chromium: `page` is the site, `demo` its embedded demo frame. */
async function openSite(t, viewport = { width: 1280, height: 800 }) {
  const dir = mkdtempSync(join(tmpdir(), 'ux-play-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const scenario = loadAll().find(s => s.target === 'component:design-system'), name = 'component-design-system', from = join(dir, 'cap'), out = join(dir, 'site');
  mkdirSync(join(from, '_pages'), { recursive: true }); mkdirSync(join(from, name), { recursive: true });
  await buildPage(scenario.fixture.entry, join(from, '_pages', `${name}.html`));
  writeFileSync(join(from, name, 'result.json'), JSON.stringify({ target: scenario.target, states: [], stateFailures: [], errors: [], flows: [] }));
  writeFileSync(join(from, name, 'target.json'), JSON.stringify({ target: scenario.target, title: scenario.title, purpose: scenario.purpose, level: 'component', kitVersion: '0.0.0', commit: 'abc1234', capturedAt: '2026-01-01T00:00:00Z' }));
  await site({ from, out, scenarios: [scenario] });
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
  const server = createServer((req, res) => {
    let file = join(out, decodeURIComponent(req.url.split('?')[0]));
    if (existsSync(file) && !extname(file)) file = join(file, 'index.html');
    if (!existsSync(file)) { res.statusCode = 404; res.end(); return; }
    res.setHeader('content-type', types[extname(file)] ?? 'application/octet-stream'); res.end(readFileSync(file));
  }).listen(0);
  t.after(() => server.close());
  const browser = await playwright.chromium.launch({ executablePath: process.env.CHROMIUM, args: ['--no-sandbox'] });
  t.after(() => browser.close());
  const page = await (await browser.newContext({ viewport })).newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  const demo = page.frameLocator('#demo');
  await demo.locator('[data-testid=composer-input]').waitFor({ timeout: 30000 });
  return { page, demo };
}

/** On a phone the Phone/Desktop switch, Options and Dark sit in the "more" menu: open it when it is shown and closed. */
async function openTools(page) {
  const more = page.locator('#more');
  if (await more.isVisible() && (await more.getAttribute('aria-expanded')) !== 'true') await more.click();
}
/** Pick an item of the Options menu by its words (opens the "more" menu on a phone, then Options). */
async function choose(page, label) {
  await openTools(page);
  if ((await page.locator('#options').getAttribute('aria-expanded')) !== 'true') await page.locator('#options').click();
  await page.locator('#options-panel').getByRole('menuitem', { name: label, exact: true }).click();
}

test('the Options menu plays a response into the design system page, and the demo has the attach and dictation buttons', { skip, timeout: 180000 }, async t => {
  const { page, demo } = await openSite(t);
  assert.equal(await demo.locator('[data-testid=composer-bar-attach]').count(), 1, 'the bar has the attach button');
  assert.equal(await demo.locator('[data-testid=agent-talk]').count(), 1, 'the bar has the dictation button');
  const items = await page.locator('#options-panel .menu-item').allTextContents();
  assert.ok(items.includes('Markdown answer') && items.includes('Question card: choices') && items.includes('Error') && items.at(-1) === 'Reset the conversation', `the menu lists the page's flows (${items})`);
  await choose(page, 'Markdown answer');
  await demo.getByText('A Markdown answer').first().waitFor({ timeout: 40000 });
  const folded = await demo.locator('[data-testid=agent-card-reply]').first().textContent();
  assert.ok(!/#|\*|`/.test(folded), `the folded card shows the Markdown reply as plain text (${JSON.stringify(folded)})`);
  assert.ok(folded.includes('bold') && folded.includes('inline code'), 'the words are kept');
  await demo.locator('[data-testid=agent-bar-conversation]').click();
  await demo.locator('[data-testid=agent-tray] [data-testid=transcript] h2').first().waitFor({ timeout: 10000 });
  assert.ok(await demo.locator('[data-testid=agent-tray] [data-testid=transcript] strong').count() >= 1, 'the open conversation still renders bold');
  await choose(page, 'Approval card');
  await demo.locator('[data-testid=approval-card]').first().waitFor({ timeout: 40000 });
  await choose(page, 'Reply card with an action');
  await demo.locator('[data-testid=agent-card-action]').waitFor({ timeout: 40000 });
  await choose(page, 'Reset the conversation');
  await demo.locator('[data-testid=composer-input]').waitFor();
  assert.equal(await demo.getByText('A Markdown answer').count(), 0, 'Reset starts a fresh conversation');
});

// AC-8 (notifications): the Play menu has a Notifications group; each item shows its pattern in the demo, light and dark, at 1440 and 390.
test('the Play menu has a Notifications group: info, success, warning, error and needs you each show their pattern, light and dark, at 1440 and 390', { skip, timeout: 300000 }, async t => {
  const shots = join(root, '.cache/evidence/composer-content');
  mkdirSync(shots, { recursive: true });
  for (const [width, height, label] of [[1440, 900, 'desktop'], [390, 844, 'phone']]) {
    const { page, demo } = await openSite(t, { width, height });
    if (label === 'phone') await page.locator('[data-vp]').filter({ hasText: 'Phone' }).first().click().catch(() => {});
    const group = await page.locator('[data-options-group=Notifications] .menu-item').allTextContents();
    assert.deepEqual(group, ['Notification: info', 'Notification: success', 'Notification: warning', 'Notification: error', 'Notification: needs you'], 'the group lists the five patterns');
    for (const theme of ['light', 'dark']) {
      if ((await page.evaluate(() => document.documentElement.dataset.theme)) !== theme) { await openTools(page); await page.locator('#theme').click(); await page.waitForFunction(value => document.documentElement.dataset.theme === value, theme); }
      for (const kind of ['info', 'success', 'warning', 'error']) {
        await choose(page, `Notification: ${kind}`);
        await demo.locator(`[data-testid=notice][data-notice-kind=${kind}]`).waitFor({ timeout: 20000 });
        assert.equal(await demo.locator('[data-testid=notice]').count(), 1, 'one notice at the composer (the page\'s own sample is the update notice)');
        assert.equal(await demo.locator('[data-testid=agent-tray]').count(), 0, 'no tray opened');
        await page.screenshot({ path: join(shots, `notifications-play-${kind}-${label}-${theme}.png`) });
        if (kind === 'warning' || kind === 'error') assert.equal(await demo.locator('[data-testid=notice-reference]').count(), 1, 'the @ is there');
      }
      await choose(page, 'Notification: needs you');
      await demo.locator('[data-testid=agent-card][data-needs-you]').waitFor({ timeout: 40000 });
      assert.equal(await demo.locator('[data-testid=agent-tray]').count(), 0, 'no tray for a decision');
      await page.screenshot({ path: join(shots, `notifications-play-needs-you-${label}-${theme}.png`) });
      await choose(page, 'Reset the conversation');
      await demo.locator('[data-testid=composer-input]').waitFor();
    }
  }
});
