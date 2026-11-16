import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { mentionedPaths } from '@hachej/boring-ui-kit/chat-text';
import { buildPage, root } from '../ux/runner/build.mjs';

// The design-system page's file tree (the same FileTreeView the Library shows) and the table viewer's « @ » row action, driven in a real Chromium on the real page:
// a file lines up with its sibling folders, rows and icons stay compact, no second tooltip repeats a label; a row of the sample table becomes one `row` chip in the
// composer and its structured reference (file, row, cells) is what the assistant receives.
const require = createRequire(join(root, 'package.json'));
let playwright; try { playwright = require('playwright-core'); } catch { /* not installed */ }
const skip = !process.env.CHROMIUM || !playwright;
const VIEWPORTS = [{ name: '390', width: 390, height: 844, touch: true }, { name: '1440', width: 1440, height: 900, touch: false }];

const geometry = (page, path) => page.evaluate(selector => {
  const item = document.querySelector(selector), button = item.querySelector('.file-tree-row-button');
  const box = element => { const r = element.getBoundingClientRect(); return { x: Math.round(r.left * 10) / 10, width: r.width, height: r.height }; };
  const icons = [...button.querySelectorAll(':scope > svg')].map(box);
  return { row: box(button), icon: icons.at(-1), chevron: item.getAttribute('aria-expanded') === null ? undefined : icons[0], name: box(button.querySelector('.file-tree-name')), title: button.getAttribute('title') };
}, `[data-testid=ds-files] [role=treeitem][data-path="${path}"]`);

test('the file tree lines files up with folders, stays compact and has no second tooltip; a table row is referenced in the assistant', { skip, timeout: 240000 }, async t => {
  const dir = mkdtempSync(join(tmpdir(), 'tree-table-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const page = join(dir, 'page.html');
  await buildPage('ux/fixtures/design-system.jsx', page);
  const browser = await playwright.chromium.launch({ executablePath: process.env.CHROMIUM, args: ['--no-sandbox'] });
  t.after(() => browser.close());
  for (const viewport of VIEWPORTS) for (const dark of [false, true]) {
    const label = `${viewport.name} ${dark ? 'dark' : 'light'}`;
    const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height }, hasTouch: viewport.touch, isMobile: viewport.touch });
    const tab = await context.newPage();
    const errors = [];
    tab.on('pageerror', error => errors.push(String(error)));
    await tab.goto(`file://${page}?demo=1&pace=instant${dark ? '&dark=1' : ''}`);
    const tree = tab.locator('[data-testid=ds-files]');
    await tree.locator('[role=treeitem]').first().waitFor({ timeout: 30000 });

    // One icon column: a file at the root has its icon and name where its sibling folders have theirs.
    const folder = await geometry(tab, 'uploads'), file = await geometry(tab, 'closing-notes.md');
    assert.equal(file.icon.x, folder.icon.x, `${label}: a file's icon sits in its sibling folder's icon column`);
    assert.equal(file.name.x, folder.name.x, `${label}: a file's name starts where its sibling folder's name starts`);
    assert.ok(folder.icon.width <= 18 && folder.icon.height <= 18, `${label}: folder icon is 16 to 18px (${folder.icon.width})`);
    assert.ok(folder.chevron.width <= 14, `${label}: the chevron is 14px at most (${folder.chevron.width})`);
    const limit = viewport.touch ? 44 : 36;
    for (const row of [folder.row, file.row]) assert.ok(row.height >= 32 && row.height <= limit + 0.5, `${label}: row height 32 to ${limit}px (${row.height})`);
    const input = await tree.locator('input[type=search]').evaluate(element => ({ height: element.getBoundingClientRect().height, radius: getComputedStyle(element).borderTopLeftRadius }));
    assert.ok(input.height <= limit + 0.5, `${label}: the search field is the kit's standard Input (${input.height})`);

    // Nested rows keep one indent step, and a nested file lines up with the other rows of its folder.
    await tree.locator('[role=treeitem][data-path="samples"] .file-tree-row-button').first().click();
    await tree.locator('[role=treeitem][data-path="samples/open-gaps.csv"]').waitFor();
    const nested = await geometry(tab, 'samples/open-gaps.csv'), sibling = await geometry(tab, 'samples/reconcile.ts');
    assert.equal(nested.icon.x, sibling.icon.x, `${label}: nested files share one icon column`);
    assert.equal(nested.name.x, sibling.name.x, `${label}: nested files share one name column`);
    assert.ok(nested.icon.x > folder.icon.x, `${label}: nested rows are indented`);

    // No second tooltip: a native title would repeat the label printed beside it.
    if (!viewport.touch) {
      await tree.locator('[role=treeitem][data-path="receipts"] .file-tree-row-button').hover();
      assert.equal(await tree.locator('[role=treeitem][data-path="receipts"] .file-tree-row-button').getAttribute('title'), null, `${label}: no title tooltip on a row whose label is whole`);
    }

    // A table row to the assistant: open the table, reference row 3, the chip says which row, the send carries the structured reference.
    await tree.locator('[role=treeitem][data-path="samples/open-gaps.csv"] .file-tree-row-button').click();
    const table = tab.locator('[data-testid=artifact-csv]');
    await table.waitFor({ timeout: 15000 });
    const action = table.locator('[data-row="3"] [data-testid=csv-row-reference]');
    if (viewport.touch) {
      const box = await action.boundingBox();
      assert.ok(box.width >= 43.5 && box.height >= 43.5, `${label}: the row action is a 44px touch target (${box.width}x${box.height})`);
      assert.equal(await action.evaluate(element => getComputedStyle(element).opacity), '1', `${label}: the row action is visible without hover on touch`);
    } else {
      assert.equal(await action.evaluate(element => getComputedStyle(element).opacity), '0', `${label}: the row action waits for hover on a fine pointer`);
      await table.locator('[data-row="3"]').hover();
      await action.evaluate(element => new Promise(done => { const check = () => getComputedStyle(element).opacity === '1' ? done() : setTimeout(check, 30); check(); })).catch(() => {});
      assert.equal(await action.evaluate(element => getComputedStyle(element).opacity), '1', `${label}: hovering the row shows its action`);
    }
    await action.click();
    const chip = tab.getByText('open-gaps.csv row 3: Card Harbor Garage, Jan 09').first();
    await chip.waitFor({ timeout: 8000 });
    await tab.locator('[data-testid=composer-input]').fill('Is this one still open?');
    await tab.locator('[data-testid=composer-submit]').click();
    await tab.getByText('Row 3 of').first().waitFor({ timeout: 20000 });
    const sent = await tab.evaluate(() => window.__sent ?? []);
    assert.equal(sent.length, 1, `${label}: one message was sent`);
    assert.match(sent[0].text, /Is this one still open\?/);
    const [mention] = mentionedPaths(sent[0].text);
    assert.ok(mention?.startsWith('row:samples/open-gaps.csv#3 '), `${label}: the message carries the row mention (${mention})`);
    assert.deepEqual(JSON.parse(mention.slice(mention.indexOf(' ') + 1)), { Label: 'Card Harbor Garage', Date: 'Jan 09', Amount: '$12.00', Status: 'Needs a receipt' }, `${label}: the reference carries the row's cells`);
    assert.deepEqual(errors, [], `${label}: no page error`);
    await context.close();
  }
});
