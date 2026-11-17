import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { buildPage, root } from '../ux/runner/build.mjs';

// The design system's scripted assistant through the real shell (composer="bar"): a file the reply cites is a chip that opens it in the pane,
// the file card names the file's real kind, and the app's reply action is a button with its own icon.
const require = createRequire(join(root, 'package.json'));
let playwright; try { playwright = require('playwright-core'); } catch { /* not installed */ }
const skip = !process.env.CHROMIUM || !playwright;

const CITED = ['samples/oakfield-garden.excalidraw.json', 'samples/bakery-morning.drawio.xml', 'samples/entries.records.json', 'samples/booking.diagram.json'];
const name = path => path.split('/').at(-1);

test('cited files are chips that open each file, a missing one is text, the card says Diagram, the undo action has an undo icon', { skip, timeout: 240000 }, async t => {
  const dir = mkdtempSync(join(tmpdir(), 'ux-file-mentions-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const html = await buildPage('ux/fixtures/design-system.jsx', join(dir, 'page.html'));
  const browser = await playwright.chromium.launch({ executablePath: process.env.CHROMIUM, args: ['--no-sandbox'] });
  t.after(() => browser.close());

  for (const [width, height] of [[390, 844], [1440, 900]]) {
    const phone = width < 500;
    const context = await browser.newContext({ viewport: { width, height }, hasTouch: phone, isMobile: phone });
    const page = await context.newPage();
    await page.goto(`file://${html}?pace=instant`);
    const send = async text => {
      await page.fill('[data-testid=composer-input]', text);
      await page.locator('[data-testid=composer-submit]').click();
      await page.locator('[data-testid=agent-card][data-state=reply]').waitFor({ timeout: 30000 });
    };
    await page.locator('[data-testid=composer-input]').waitFor({ timeout: 30000 });
    await send('files');
    const at = `at ${width}`;

    // Folded: the cited files are chips with their kind's icon, and the app's action is a button with an svg.
    const folded = page.locator('[data-testid=agent-card]');
    assert.deepEqual(await folded.locator('[data-testid=agent-card-file]').evaluateAll(chips => chips.map(chip => chip.dataset.path)).then(paths => paths.sort()), [...CITED].sort(), `${at}: the folded card cites the four files`);
    const folder = folded.locator('[data-testid=agent-card-action]');
    assert.equal(await folder.evaluate(element => element.tagName), 'BUTTON', `${at}: the folded action is a button`);
    assert.equal(await folder.locator('svg').count(), 1, `${at}: it has one icon`);
    assert.equal(await folder.innerText().then(text => text.trim()), 'Undo the change');
    await folder.click();
    assert.equal(await page.evaluate(() => window.__undone), 1, `${at}: the folded action fires`);

    await page.locator('[data-testid=agent-bar-conversation]').click();
    const tray = page.locator('[data-testid=conversation-content]');
    await tray.locator('[data-testid=message-mention][data-file-chip]').first().waitFor({ timeout: 15000 });
    const inline = tray.locator('[data-testid=message-mention][data-file-chip]');
    assert.deepEqual(await inline.evaluateAll(chips => chips.map(chip => chip.tagName + ':' + chip.dataset.path).sort()), CITED.map(path => `BUTTON:${path}`).sort(), `${at}: four inline chips, all buttons`);

    // The card says the kind the Library says, not « Code ».
    const card = tray.locator('[data-testid=artifact-card]').first();
    await card.waitFor({ timeout: 15000 });
    assert.equal(await card.locator('[data-testid=artifact-type]').innerText(), 'Diagram', `${at}: the card's kind`);

    // The reply action in the tray: a button, its own icon, not the copy icon.
    const undo = tray.locator('[data-testid=agent-reply-action]');
    assert.equal(await undo.evaluate(element => element.tagName), 'BUTTON');
    assert.equal(await undo.locator('svg').count(), 1);
    const copy = tray.locator('[data-testid=reply-actions] svg').first();
    assert.notEqual(await undo.locator('svg').evaluate(svg => svg.innerHTML), await copy.evaluate(svg => svg.innerHTML), `${at}: the undo icon is not the copy icon`);
    assert.ok((await undo.boundingBox()).height >= (phone ? 44 : 20), `${at}: the action's height`);
    await undo.click();
    assert.equal(await page.evaluate(() => window.__undone), 2, `${at}: the tray action fires`);

    // Each chip opens its own file in the pane: four distinct opens, the last one the file already shown at 1440 (so it is clicked last).
    const order = ['samples/oakfield-garden.excalidraw.json', 'samples/bakery-morning.drawio.xml', 'samples/entries.records.json', 'samples/booking.diagram.json'];
    const opened = [];
    for (const path of order) {
      const chip = tray.locator(`[data-testid=message-mention][data-path="${path}"]`);
      if (!(await chip.isVisible())) await page.locator('[data-testid=agent-bar-conversation]').click();
      await chip.waitFor({ state: 'visible', timeout: 10000 });
      if (phone) assert.ok((await chip.boundingBox()).height >= 44, `${at}: a 44 px chip`);
      await chip.click();
      const title = page.locator('[data-testid=agent-preview] [data-pane-top] [data-testid=agent-preview-title]');
      await page.waitForFunction(expected => document.querySelector('[data-testid=agent-preview] [data-pane-top] [data-testid=agent-preview-title]')?.textContent === expected, name(path), { timeout: 15000 });
      opened.push(await title.innerText());
      if (phone) await page.locator('[data-testid=agent-preview-back], [data-testid=agent-preview-close]').first().click();
    }
    assert.deepEqual(opened, order.map(name), `${at}: each chip opened its own file`);

    // Keyboard: Enter on a chip opens it too.
    const first = tray.locator(`[data-testid=message-mention][data-path="${order[0]}"]`);
    if (!(await first.isVisible())) await page.locator('[data-testid=agent-bar-conversation]').click();
    await first.focus();
    await page.keyboard.press('Enter');
    await page.waitForFunction(expected => document.querySelector('[data-testid=agent-preview] [data-pane-top] [data-testid=agent-preview-title]')?.textContent === expected, name(order[0]), { timeout: 15000 });
    if (phone) await page.locator('[data-testid=agent-preview-back], [data-testid=agent-preview-close]').first().click();

    // A mention of a file the workspace does not have is plain text; the file it does have is a chip.
    if (!(await page.locator('[data-testid=composer-input]').isVisible())) await page.locator('[data-testid=agent-bar-conversation]').click();
    await page.fill('[data-testid=composer-input]', 'missing file');
    await page.locator('[data-testid=composer-submit]').click();
    await page.getByText('Not written yet').first().waitFor({ timeout: 30000 });
    const missing = tray.locator('[data-testid=message-mention][data-path="samples/never-written.csv"]');
    await missing.waitFor({ state: 'attached', timeout: 15000 });
    await page.waitForTimeout(500);
    assert.equal(await missing.evaluate(element => element.tagName), 'SPAN', `${at}: a missing file is not a button`);
    assert.equal(await missing.evaluate(element => element.hasAttribute('data-file-chip')), false);
    await context.close();
  }
});
