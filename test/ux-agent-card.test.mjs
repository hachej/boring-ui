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
    assert.equal(await page.locator(`${task('done', 'agent-card')} [data-testid=composer-controller]`).count(), 1, label('level 2: one strip on the card, not one per layer'));
    await page.locator(task('done', 'agent-card-collapse')).scrollIntoViewIfNeeded();
    const box = await page.locator(task('done', 'agent-card-collapse')).boundingBox();
    assert.ok(box.y >= 0 && box.y + box.height <= viewport.height && box.x >= 0 && box.x + box.width <= viewport.width, label('level 2: the strip is fully inside the screen'));
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

test('a message sent from the folded composer opens the tray (the host\'s onSent still runs); `unreadCount: false` keeps the unread mark a dot', { skip, timeout: 300000 }, async t => {
  const dir = mkdtempSync(join(tmpdir(), 'ux-agent-card-send-'));
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
    await page.goto(`file://${file}?twice=1&pace=instant`);
    await page.locator(task('done', 'agent-card')).waitFor();
    const label = text => `${text} at ${name}`;

    // Sending from the folded composer opens the tray: the message and its reply are on screen, no « Expand more » needed.
    const level = () => page.locator(task('done', 'agent-card')).getAttribute('data-level');
    await page.locator(task('done', 'agent-card-chat')).click();
    await page.locator(task('done', 'agent-card-composer')).waitFor();
    assert.equal(await level(), '0', label('the composer alone is level 0'));
    await page.locator(task('done', 'composer-input')).fill('Is the March statement in?');
    await page.locator(task('done', 'composer-submit')).click();
    await page.locator(`${task('done', 'agent-card')}[data-level="1"]`).waitFor();
    assert.equal(await page.locator(task('done', 'agent-card-composer')).count(), 0, label('the folded composer gave way to the tray'));
    await page.locator(`${task('done', 'agent-chat')} :text("Is the March statement in?")`).first().waitFor({ state: 'visible' });
    assert.equal(await page.evaluate(() => window.__ux.sent()), 1, label('the host\'s own onSent ran once'));

    // Two replies came while the card was folded: a number pill by default, a dot only with `unreadCount: false`.
    await page.waitForFunction(() => window.__ux.twice() === 4, null, { timeout: 20000 });
    const pill = page.locator(task('twice', 'agent-bar-unread'));
    await pill.waitFor();
    assert.equal(await pill.getAttribute('data-count'), '2', label('by default the mark counts'));
    assert.equal((await pill.textContent()).trim(), '2');
    const quiet = page.locator(task('twice-quiet', 'agent-bar-unread'));
    await quiet.waitFor();
    assert.equal(await quiet.getAttribute('data-count'), null, label('a dot carries no count'));
    assert.equal(await quiet.textContent(), '', label('a dot draws no number'));
    assert.match(await quiet.getAttribute('aria-label'), /^New reply$/, label('the dot keeps its name'));

    // No dot while the card's own chat is open.
    await page.locator(task('twice-quiet', 'agent-card-header')).click();
    await page.locator(`${task('twice-quiet', 'agent-card')}[data-level="1"]`).waitFor();
    assert.equal(await page.locator(task('twice-quiet', 'agent-bar-unread')).count(), 0, label('no unread mark while the tray is open'));

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
  assert.ok((await page.locator('#sw-list .sw-title').allTextContents()).includes('Agent cards'), 'the page switcher lists Agent cards');
  const demo = page.frameLocator('#demo');
  await demo.locator(task('needs', 'approval-card')).waitFor({ timeout: 30000 });
  await demo.locator(task('done', 'agent-card-chat')).click();
  await demo.locator(task('done', 'agent-card-composer')).waitFor();
});

// A host that draws its own card: its header and body, the tray inside its body (slot), a chat made on the first tap, an unread dot with no controller.
test('the agent card on a host card: header, body, slot, a chat made on the first tap, a quiet unread dot', { skip, timeout: 300000 }, async t => {
  const dir = mkdtempSync(join(tmpdir(), 'ux-agent-card-host-'));
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
    const label = text => `${text} at ${name}`;
    const open = async query => { await page.goto(`file://${file}?${query}`); await page.locator(task('host', 'agent-card')).or(page.locator('[data-testid=board]')).first().waitFor(); };
    const host = testid => page.locator(task('host', testid));
    const log = () => page.evaluate(() => window.__ux.log());
    const created = () => page.evaluate(() => window.__ux.created());
    const strip = () => page.locator(`${task('host', 'agent-card')} [data-action]`).evaluateAll(nodes => nodes.map(node => node.getAttribute('data-testid')));
    const level = () => host('agent-card').getAttribute('data-level');
    const reveal = async testid => { if (name === '1440') { await page.keyboard.press('Shift'); await host(testid).focus(); } };

    // The host's header replaces the built-in one and is not a tap target of the card.
    await open('');
    assert.equal(await host('agent-card-title').count(), 0, label('no built-in title'));
    assert.equal(await host('agent-card-header').count(), 0, label('no built-in header'));
    assert.equal(await host('agent-card-host-header').count(), 1, label('the host header is drawn'));
    assert.equal(await host('agent-card').getAttribute('aria-label'), 'Match the January payments', label('the card is named by its title'));
    assert.equal(await host('host-body').count(), 0, label('the host body starts closed'));
    await host('host-header-toggle').click();
    await host('host-body').waitFor();
    assert.deepEqual(await log(), ['header tapped'], label('the host header keeps its own gesture'));
    assert.equal(await level(), '0', label('a tap on the host header leaves the card at level 0'));
    assert.equal(await host('agent-chat').count(), 0, label('the tray did not open from the header'));
    assert.deepEqual(await strip(), ['agent-card-chat'], label('no controller: only Open the chat'));
    assert.equal(await created(), 0, label('no conversation yet'));

    // The first tap asks for the chat once; the composer opens inside the host's body, under its lines.
    await host('agent-card-chat').click();
    await host('agent-card-composer').waitFor();
    assert.deepEqual((await log()).filter(item => item === 'chat requested'), ['chat requested'], label('one request'));
    assert.equal(await created(), 1, label('one conversation made'));
    assert.equal(await host('host-slot').locator('[data-testid=agent-card-composer]').count(), 1, label('the composer is inside the slot'));
    assert.equal(await page.evaluate(() => { const lines = document.querySelector('[data-testid=host-lines]'), composer = document.querySelector('[data-task=host] [data-testid=agent-card-composer]'); return Boolean(lines.compareDocumentPosition(composer) & Node.DOCUMENT_POSITION_FOLLOWING); }), true, label('the composer is under the lines'));
    assert.deepEqual(await strip(), ['agent-card-collapse', 'agent-card-expand', 'agent-card-dock'], label('the ladder, once the controller is there'));

    // A draft survives the body closing: the composer goes back under the header.
    await host('composer-input').fill('The date is the 3rd');
    await host('host-header-toggle').click();
    await host('host-body').waitFor({ state: 'detached' });
    assert.equal(await host('agent-card-composer').count(), 1, label('the composer returned under the header'));
    assert.equal(await host('composer-input').inputValue(), 'The date is the 3rd', label('the draft is kept'));
    await host('host-header-toggle').click();
    await host('host-slot').locator('[data-testid=agent-card-composer]').waitFor();
    assert.equal(await host('composer-input').inputValue(), 'The date is the 3rd', label('the draft is kept going back into the slot'));

    // The tray (level 1) is in the slot; the whole chat (level 2) keeps the host header and takes the body's place; Collapse gives it back.
    await reveal('agent-card-collapse');
    await host('agent-card-expand').click();
    await host('host-slot').locator('[data-testid=agent-chat]').waitFor();
    assert.equal(await level(), '1');
    await reveal('agent-card-collapse');
    await host('agent-card-expand-more').click();
    await host('agent-chat-header').waitFor();
    assert.equal(await level(), '2');
    assert.equal(await host('host-header-toggle').count(), 1, label('level 2: the host header stays on top'));
    assert.equal(await host('host-lines').count(), 0, label('level 2: the body is not drawn'));
    assert.equal(await host('agent-card-title').count(), 0, label('level 2: still no built-in header'));
    await host('agent-card-collapse').click();
    await host('host-slot').locator('[data-testid=agent-chat]').waitFor();
    assert.equal(await host('host-lines').count(), 1, label('Collapse gives the body back'));
    // Esc folds; with no kit header, focus goes to the strip's first cell.
    await host('composer-input').press('Escape');
    await host('agent-chat').waitFor({ state: 'detached' });
    assert.equal(await level(), '0');
    assert.equal(await page.evaluate(() => document.activeElement?.closest('[data-testid=composer-controller]') !== null), true, label('Esc: focus is on the strip'));

    // Docked: the card says so under the host header.
    await open('at=host:d');
    assert.equal(await level(), 'docked');
    assert.equal(await host('agent-card-docked').count(), 1, label('Docked marker under the host header'));
    assert.deepEqual(await strip(), ['agent-card-undock']);

    // The unread dot: quiet, one dot, no count, before any chat exists.
    await open('');
    const dot = page.locator(task('unread', 'agent-bar-unread'));
    assert.equal(await dot.count(), 1, label('an unread dot with no controller'));
    assert.equal(await dot.getAttribute('aria-label'), 'New reply');
    assert.equal(await dot.textContent(), '', label('no count'));
    assert.equal(await dot.getAttribute('data-count'), null);
    assert.match(await dot.getAttribute('class'), /bg-primary/, label('the primary colour, not red'));
    assert.equal(await page.locator(task('host', 'agent-bar-unread')).count(), 0, label('a card without the flag has no dot'));
    assert.equal(await page.locator(task('unread', 'agent-chat')).count(), 0, label('the dot cost no chat'));

    // A board of thirty cards makes no conversation; taps before a controller arrives ask once.
    await open('many=30');
    assert.equal(await page.locator('[data-task^=board-]').count(), 30);
    assert.equal(await page.locator('[data-testid=agent-chat], [data-testid=composer-input]').count(), 0, label('no chat mounted'));
    assert.equal(await created(), 0);
    const first = page.locator('[data-task=board-0] [data-testid=agent-card-chat]');
    for (let i = 0; i < 3; i++) await first.click();
    assert.deepEqual(await log(), ['chat requested 0'], label('three taps, one request'));
    assert.equal(await page.locator('[data-testid=agent-chat]').count(), 0, label('and still no chat before the controller'));

    await open('at=host:1');
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), label('no sideways scroll'));
    assert.deepEqual(errors, [], label('no console error'));
    await context.close();
  }
});
