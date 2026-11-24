import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { mentionedPaths } from '@hachej/boring-ui-kit/chat-text';
import { buildPage, root } from '../../ux/runner/build.mjs';

// The table viewer's row references on the real design-system page: the action's tooltip and name, a chip per row that adds up (once each, with its own remove),
// several rows at once (a chip each up to three, one grouped chip above), and the structured references the assistant receives, in order.
const require = createRequire(join(root, 'package.json'));
let playwright; try { playwright = require('playwright-core'); } catch { /* not installed */ }
const skip = !process.env.CHROMIUM || !playwright;
const VIEWPORTS = [{ name: '390', width: 390, height: 844, touch: true }, { name: '1440', width: 1440, height: 900, touch: false }];

const parsed = text => mentionedPaths(text).filter(value => value.startsWith('row:')).map(value => {
  const body = value.slice(4), at = body.indexOf(' '), [path, rows] = body.slice(0, at).split('#');
  return { path, rows: rows.split(',').map(Number), cells: JSON.parse(body.slice(at + 1)) };
});

test('a table row is referenced in the assistant: tooltip, chips that add up, multi-select, the payload in order', { skip, timeout: 300000 }, async t => {
  const dir = mkdtempSync(join(tmpdir(), 'table-refs-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const page = join(dir, 'page.html');
  await buildPage('ux/fixtures/design-system.jsx', page);
  const browser = await playwright.chromium.launch({ executablePath: process.env.CHROMIUM, args: ['--no-sandbox'] });
  t.after(() => browser.close());
  for (const viewport of VIEWPORTS) {
    const label = viewport.name;
    const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height }, hasTouch: viewport.touch, isMobile: viewport.touch });
    const tab = await context.newPage();
    const errors = [];
    tab.on('pageerror', error => errors.push(String(error)));
    await tab.goto(`file://${page}?demo=1&pace=instant`);
    const tree = tab.locator('[data-testid=ds-files]');
    await tree.locator('[role=treeitem]').first().waitFor({ timeout: 30000 });
    await tree.locator('[role=treeitem][data-path="samples"] .file-tree-row-button').first().click();
    await tree.locator('[role=treeitem][data-path="samples/open-gaps.csv"] .file-tree-row-button').click();
    const table = tab.locator('[data-testid=artifact-csv]');
    await table.waitFor({ timeout: 15000 });
    const action = row => table.locator(`[data-row="${row}"] [data-testid=csv-row-reference]`);
    const chips = tab.locator('[data-testid=mention-chip]');
    const chipCount = count => tab.waitForFunction(expected => document.querySelectorAll('[data-testid=mention-chip]').length === expected, count, { timeout: 8000 });
    const sendWith = async words => {
      const before = (await tab.evaluate(() => window.__sent ?? [])).length;
      await tab.locator('[data-testid=composer-input]').fill(words);
      await tab.locator('[data-testid=composer-submit]').click();
      await tab.waitForFunction(count => (window.__sent ?? []).length > count, before, { timeout: 10000 });
      return (await tab.evaluate(() => window.__sent)).at(-1).text;
    };

    assert.match(await action(3).getAttribute('aria-label'), /^Reference in agent/, `${label}: the row action is named Reference in agent`);
    if (viewport.touch) {
      const box = await action(3).boundingBox();
      assert.ok(box.width >= 43.5 && box.height >= 43.5, `${label}: the row action is a 44px touch target (${box.width}x${box.height})`);
      assert.equal(await action(3).evaluate(element => getComputedStyle(element).opacity), '1', `${label}: visible without hover on touch`);
    } else {
      assert.equal(await action(3).evaluate(element => getComputedStyle(element).opacity), '0', `${label}: the action waits for hover on a fine pointer`);
      await table.locator('[data-row="3"]').hover();
      await action(3).hover();
      await tab.locator('[data-slot=tooltip-content]', { hasText: 'Reference in agent' }).waitFor({ timeout: 4000 });
    }

    await action(3).click();
    assert.equal(await tab.locator('[data-testid=composer-input]').getAttribute('placeholder'), '1 referenced', `${label}: the field says so for a moment`);
    await action(4).click();
    await action(5).click();
    await action(3).click();
    await chipCount(3);
    assert.match(await chips.nth(0).innerText(), /open-gaps\.csv\s+row 3\s+Card Harbor Garage · Jan 09 · \$12\.00/, `${label}: the chip is the file, a row badge and a summary line`);
    assert.equal(await action(3).getAttribute('data-referenced'), 'true', `${label}: a referenced row's button reads Referenced`);
    assert.match(await action(3).getAttribute('aria-label'), /^Referenced/);
    await chips.nth(1).getByRole('button', { name: /Remove/ }).click();
    await chipCount(2);
    assert.equal(await action(4).getAttribute('data-referenced'), null, `${label}: removing the chip frees the row's button`);
    const sent = await sendWith('Which of these are still open?');
    assert.deepEqual(parsed(sent).map(item => item.rows), [[3], [5]], `${label}: the message carries the remaining references in order`);
    assert.deepEqual(parsed(sent)[0].cells, { Label: 'Card Harbor Garage', Date: 'Jan 09', Amount: '$12.00', Status: 'Needs a receipt' }, `${label}: a reference carries its row's cells`);
    assert.equal(parsed(sent)[0].path, 'samples/open-gaps.csv');

    const start = row => viewport.touch
      ? table.locator(`[data-row="${row}"]`).evaluate(element => new Promise(done => {
        element.dispatchEvent(new PointerEvent('pointerdown', { pointerType: 'touch', bubbles: true }));
        setTimeout(() => { element.dispatchEvent(new PointerEvent('pointerup', { pointerType: 'touch', bubbles: true })); done(); }, 650);
      }))
      : table.locator(`[data-row="${row}"] td`).nth(2).click({ modifiers: ['Control'] });
    await start(1);
    await table.locator('[data-row="2"] [data-testid=csv-row-select]').click();
    assert.match(await tab.locator('[data-testid=csv-selection-bar]').innerText(), /Reference 2 rows in agent/, `${label}: the bar counts the selection`);
    await tab.locator('[data-testid=csv-reference-selected]').click();
    await chipCount(2);
    const several = await sendWith('Both of these, please.');
    assert.deepEqual(parsed(several).map(item => item.rows), [[1], [2]], `${label}: up to three rows get a chip each, in order`);

    await start(1);
    for (const row of [2, 3, 4]) await table.locator(`[data-row="${row}"] [data-testid=csv-row-select]`).click();
    await tab.locator('[data-testid=csv-reference-selected]').click();
    await chipCount(1);
    assert.match(await chips.first().innerText(), /open-gaps\.csv\s+rows 1, 2, 3, 4/, `${label}: four rows are one grouped chip naming each row`);
    const grouped = await sendWith('All four.');
    assert.deepEqual(parsed(grouped).map(item => item.rows), [[1, 2, 3, 4]], `${label}: the group is one reference with its rows in order`);
    assert.equal(parsed(grouped)[0].cells.length, 4, `${label}: and each row's cells`);
    assert.deepEqual(errors, [], `${label}: no page error`);
    await context.close();
  }
});
