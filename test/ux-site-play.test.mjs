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

test('the Play menu plays a response into the design system page, and the demo has the attach and dictation buttons', { skip, timeout: 180000 }, async t => {
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
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  const demo = page.frameLocator('#demo');
  await demo.locator('[data-testid=composer-input]').waitFor({ timeout: 30000 });
  assert.equal(await demo.locator('[data-testid=composer-bar-attach]').count(), 1, 'the bar has the attach button');
  assert.equal(await demo.locator('[data-testid=agent-talk]').count(), 1, 'the bar has the dictation button');
  const items = await page.locator('#play option').allTextContents();
  assert.ok(items.includes('Markdown answer') && items.includes('Question card: choices') && items.includes('Error') && items.at(-1) === 'Reset the conversation', `the menu lists the page's flows (${items})`);
  await page.selectOption('#play', { label: 'Markdown answer' });
  await demo.getByText('A Markdown answer').first().waitFor({ timeout: 40000 });
  await page.selectOption('#play', { label: 'Reset the conversation' });
  await demo.locator('[data-testid=composer-input]').waitFor();
  assert.equal(await demo.getByText('A Markdown answer').count(), 0, 'Reset starts a fresh conversation');
});
