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

// The agent card on its own page (ux/fixtures/component-agent-card.jsx, scripted agent: no model) at a phone and a desktop size, then through the built showcase site.
const require = createRequire(join(root, 'package.json'));
let playwright; try { playwright = require('playwright-core'); } catch { /* not installed */ }
const skip = !process.env.CHROMIUM || !playwright;
const task = (id, testid) => `[data-task=${id}] [data-testid=${testid}]`;
const VIEWPORTS = [{ name: '390', width: 390, height: 844, hasTouch: true, isMobile: true }, { name: '1440', width: 1440, height: 900 }];

test('the agent card: levels, background work, a decision on the folded card, dock, keys', { skip, timeout: 300000 }, async t => {
  const dir = mkdtempSync(join(tmpdir(), 'ux-agent-card-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, 'page.html');
  await buildPage('ux/fixtures/component-agent-card.jsx', file);
  const browser = await playwright.chromium.launch({ executablePath: process.env.CHROMIUM, args: ['--no-sandbox'] });
  t.after(() => browser.close());
  for (const { name, ...viewport } of VIEWPORTS) {
    const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height }, hasTouch: viewport.hasTouch, isMobile: viewport.isMobile });
    const page = await context.newPage();
    const errors = [];
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    page.on('pageerror', error => errors.push(String(error)));
    await page.goto(`file://${file}`);
    await page.locator(task('done', 'agent-card')).waitFor();
    const label = text => `${text} at ${name}`;

    // One card per state, each with its chip; the agent's colour is a token, never a hex.
    const chips = await page.locator('[data-testid=agent-card-status]').allTextContents();
    assert.deepEqual(chips, ['Queued', 'Running', 'Needs you', 'Done', 'Failed', 'Done'], label('one chip per state'));
    const dot = await page.locator(task('done', 'agent-card-dot')).evaluate(node => node.getAttribute('style'));
    assert.match(dot, /var\(--chart-1\)/, label('the dot takes the agent colour from a theme token'));

    // Folded: the run keeps working in the background, and the decision is on the folded card.
    assert.equal(await page.locator(task('running', 'agent-chat')).count(), 0, label('the running card is folded'));
    await page.locator(`${task("running", "agent-card-activity")}:has-text("files")`).waitFor({ timeout: 15000 });
    assert.equal(await page.locator(task('needs', 'approval-card')).count(), 1, label('the approval is on the folded card'));
    assert.equal(await page.locator(task('needs', 'agent-chat')).count(), 0, label('the card did not open by itself'));

    // The ladder through the strip, one step at a time. The strip is on the card's lower border and the card grows downwards: expand points down, collapse up (Phosphor's caret paths: the tip at 164.69 is down, 91.31 up).
    const arrow = testid => page.locator(task('done', testid)).evaluate(node => node.querySelector('svg').innerHTML);
    const strip = () => page.locator(`${task('done', 'agent-card')} [data-action]`).evaluateAll(nodes => nodes.map(node => node.getAttribute('data-testid')));
    const level = () => page.locator(task('done', 'agent-card')).getAttribute('data-level');
    const reveal = async testid => { if (name === '1440') { await page.keyboard.press('Shift'); await page.locator(task('done', testid)).focus(); } };
    // Level 0, chat not open: [Open the chat, Dock]; no chevron yet.
    assert.deepEqual(await strip(), ['agent-card-chat', 'agent-card-dock'], label('folded: Open the chat and Dock'));
    assert.equal(await page.locator(task('done', 'agent-card-composer')).count(), 0, label('folded: no composer yet'));
    await page.locator(task('done', 'agent-card-chat')).click();
    await page.locator(task('done', 'agent-card-composer')).waitFor();
    assert.equal(await page.locator(task('done', 'agent-chat-header')).count(), 0, label('only the composer opened'));
    assert.equal(await level(), '0');
    // Level 0, composer showing: [Collapse up, Expand down, Dock]; Collapse is one step back to the chat bubble.
    assert.deepEqual(await strip(), ['agent-card-collapse', 'agent-card-expand', 'agent-card-dock'], label('composer showing: Collapse, Expand, Dock'));
    assert.match(await arrow('agent-card-collapse'), /91\.31/, label('composer showing: Collapse points up'));
    assert.match(await arrow('agent-card-expand'), /164\.69/, label('composer showing: Expand points down'));
    await page.locator(task('done', 'agent-card-collapse')).click();
    await page.locator(task('done', 'agent-card-composer')).waitFor({ state: 'detached' });
    assert.deepEqual(await strip(), ['agent-card-chat', 'agent-card-dock'], label('Collapse returns to the chat bubble in one step'));
    await page.locator(task('done', 'agent-card-chat')).click();
    await page.locator(task('done', 'agent-card-composer')).waitFor();
    await reveal('agent-card-collapse');
    // Level 1, the tray: [Collapse up, Expand more double down, Dock].
    await page.locator(task('done', 'agent-card-expand')).click();
    await page.locator(task('done', 'agent-chat')).waitFor();
    assert.deepEqual(await strip(), ['agent-card-collapse', 'agent-card-expand-more', 'agent-card-dock'], label('level 1: Collapse, Expand more, Dock'));
    const collapseArrow = await arrow('agent-card-collapse');
    assert.match(collapseArrow, /91\.31/, label('level 1: the chevron points up'));
    assert.notEqual(await arrow('agent-card-expand-more'), collapseArrow, label('level 1: Expand more is the double chevron'));
    assert.match(await arrow('agent-card-expand-more'), /204\.69/, label('level 1: Expand more is the double chevron pointing down'));
    assert.equal(await page.locator(task('done', 'agent-chat-header')).count(), 0, label('level 1 is the tray, without the chat header'));
    assert.equal(await level(), '1');
    // Collapse from the tray goes back to level 0 with the composer showing.
    await reveal('agent-card-collapse');
    await page.locator(task('done', 'agent-card-collapse')).click();
    await page.locator(task('done', 'agent-card-composer')).waitFor();
    assert.equal(await level(), '0', label('Collapse from the tray: level 0'));
    assert.equal(await page.locator(`${task('done', 'agent-card')} :not([data-testid=agent-card-composer] *)[data-testid=agent-chat]`).count(), 0, label('Collapse from the tray: the tray is gone, only the composer stays'));
    // Level 2, the full chat: [Collapse up, Dock]; Collapse goes back to the tray, not to the folded card.
    await reveal('agent-card-collapse');
    await page.locator(task('done', 'agent-card-expand')).click();
    await page.locator(task('done', 'agent-chat')).waitFor();
    await reveal('agent-card-collapse');
    await page.locator(task('done', 'agent-card-expand-more')).click();
    await page.locator(task('done', 'agent-chat-header')).waitFor();
    assert.equal(await page.locator(`${task('done', 'agent-chat')} [data-testid=artifact-card]`).count(), 1, label('the file the agent presented is the chat\'s own card'));
    assert.deepEqual(await strip(), ['agent-card-collapse', 'agent-card-dock'], label('level 2: Collapse and Dock'));
    assert.match(await arrow('agent-card-collapse'), /91\.31/, label('level 2: Collapse points up'));
    await page.locator(task('done', 'agent-card-collapse')).click();
    await page.locator(task('done', 'agent-chat')).waitFor();
    await page.locator(task('done', 'agent-chat-header')).waitFor({ state: 'detached' });
    assert.equal(await level(), '1', label('Collapse from the full chat: the tray'));
    // Esc folds the card and focus is on its header; a tap on the header expands to the tray.
    await page.locator(task('done', 'composer-input')).press('Escape');
    await page.locator(task('done', 'agent-chat')).waitFor({ state: 'detached' });
    assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('data-testid')), 'agent-card-header', label('Esc folds the card and focus is on its header'));
    await page.locator(task('done', 'agent-card-header')).click();
    await page.locator(task('done', 'agent-chat')).waitFor();
    await page.locator(task('done', 'agent-card-collapse')).click();
    await page.locator(task('done', 'agent-card-composer')).waitFor();
    await page.locator(task('done', 'agent-card-collapse')).click();
    await page.locator(task('done', 'agent-card-composer')).waitFor({ state: 'detached' });

    // A task card is the same card: the same ladder.
    const taskStrip = async () => (await page.locator(`${task('task', 'agent-card')} [data-action]`).evaluateAll(nodes => nodes.map(node => node.getAttribute('data-action'))));
    assert.deepEqual(await taskStrip(), ['chat', 'dock'], label('a task card starts at the same step'));
    await page.locator(task('task', 'agent-card-chat')).click();
    assert.deepEqual(await taskStrip(), ['chevron', 'expand', 'dock'], label('a task card: composer showing'));

    // The decision on the folded card works there: the agent carries on and the chip follows.
    await page.locator(task('needs', 'approval-approve')).click();
    await page.locator(`${task('needs', 'agent-card-status')}:has-text("Done")`).waitFor({ timeout: 20000 });
    assert.deepEqual(await page.evaluate(() => window.__ux.answered()), ['Approve'], label('Approve reached the agent'));
    assert.equal(await page.locator(task('needs', 'approval-card')).count(), 0, label('the decision left the card'));

    // Dock and undock: the chat goes to the column, the card stays in the list, marked docked.
    await reveal('agent-card-chat');
    await page.locator(task('done', 'agent-card-dock')).click();
    await page.locator('[data-testid=dock] [data-testid=agent-chat-header]').waitFor();
    assert.deepEqual(await strip(), ['agent-card-undock'], label('docked: only Undock'));
    assert.equal(await level(), 'docked');
    await page.locator(task('done', 'agent-card-undock')).click();
    await page.locator('[data-testid=dock] [data-testid=agent-chat]').waitFor({ state: 'detached' });

    // A failed run is retried from its own composer (the chat has no retry button on a failed run's error): the agent answers and the chip follows.
    await page.locator(task('failed', 'agent-card-header')).click();
    await page.locator(task('failed', 'composer-input')).fill('Retry the export');
    await page.locator(task('failed', 'composer-submit')).click();
    await page.locator(`${task('failed', 'agent-card-status')}:has-text("Done")`).waitFor({ timeout: 20000 });

    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), label('no sideways scroll'));
    assert.deepEqual(errors, [], label('no console error'));
    await context.close();
  }
});

test('the showcase site lists Agent cards and plays the page', { skip, timeout: 240000 }, async t => {
  const dir = mkdtempSync(join(tmpdir(), 'ux-agent-card-site-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const scenario = loadAll().find(s => s.target === 'component:agent-card'), name = 'component-agent-card', from = join(dir, 'cap'), out = join(dir, 'site');
  mkdirSync(join(from, '_pages'), { recursive: true }); mkdirSync(join(from, name), { recursive: true });
  await buildPage(scenario.fixture.entry, join(from, '_pages', `${name}.html`));
  writeFileSync(join(from, name, 'result.json'), JSON.stringify({ target: scenario.target, states: [], stateFailures: [], errors: [], flows: [] }));
  writeFileSync(join(from, name, 'target.json'), JSON.stringify({ target: scenario.target, title: scenario.title, purpose: scenario.purpose, level: 'component', kitVersion: '0.0.0', commit: 'abc1234', capturedAt: '2026-01-01T00:00:00Z' }));
  await site({ from, out, scenarios: [scenario] });
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
  const server = createServer((req, res) => {
    let path = join(out, decodeURIComponent(req.url.split('?')[0]));
    if (existsSync(path) && !extname(path)) path = join(path, 'index.html');
    if (!existsSync(path)) { res.statusCode = 404; res.end(); return; }
    res.setHeader('content-type', types[extname(path)] ?? 'application/octet-stream'); res.end(readFileSync(path));
  }).listen(0);
  t.after(() => server.close());
  const browser = await playwright.chromium.launch({ executablePath: process.env.CHROMIUM, args: ['--no-sandbox'] });
  t.after(() => browser.close());
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  assert.ok((await page.locator('#pages option').allTextContents()).includes('Agent cards'), 'the top bar menu lists Agent cards');
  const demo = page.frameLocator('#demo');
  await demo.locator(task('needs', 'approval-card')).waitFor({ timeout: 30000 });
  await demo.locator(task('done', 'agent-card-chat')).click();
  await demo.locator(task('done', 'agent-card-composer')).waitFor();
});
