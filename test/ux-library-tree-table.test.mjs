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

const geometry = (page, path, scope = '[data-testid=ds-files]') => page.evaluate(selector => {
  const item = document.querySelector(selector), button = item.querySelector('.file-tree-row-button');
  const box = element => { const r = element.getBoundingClientRect(); return { x: Math.round(r.left * 10) / 10, width: r.width, height: r.height }; };
  const icons = [...button.querySelectorAll(':scope > svg')].map(box);
  return { row: box(button), icon: icons.at(-1), chevron: item.getAttribute('aria-expanded') === null ? undefined : icons[0], name: box(button.querySelector('.file-tree-name')), title: button.getAttribute('title') };
}, `${scope} [role=treeitem][data-path="${path}"]`);

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
    assert.equal(folder.icon.width, 16, `${label}: the folder kind icon is 16px`);
    assert.equal(file.icon.width, 16, `${label}: the file kind icon is 16px`);
    assert.equal(folder.chevron.width, 14, `${label}: the chevron is 14px`);
    assert.equal(folder.row.height, viewport.touch ? 44 : 32, `${label}: rows are 32px, 44px on touch`);
    const limit = viewport.touch ? 44 : 36;
    for (const row of [folder.row, file.row]) assert.ok(row.height >= 32 && row.height <= limit + 0.5, `${label}: row height 32 to ${limit}px (${row.height})`);
    const input = await tree.locator('input[type=search]').evaluate(element => ({ height: element.getBoundingClientRect().height, radius: getComputedStyle(element).borderTopLeftRadius }));
    assert.ok(input.height <= limit + 0.5, `${label}: the search field is the kit's standard Input (${input.height})`);

    // At every depth a file lines up with its sibling folders, and each level indents by the same step.
    await tree.locator('[role=treeitem][data-path="samples"] .file-tree-row-button').first().click();
    await tree.locator('[role=treeitem][data-path="samples/archive"]').waitFor();
    await tree.locator('[role=treeitem][data-path="samples/archive"] .file-tree-row-button').first().click();
    await tree.locator('[role=treeitem][data-path="samples/archive/notes-2025.md"]').waitFor();
    const samples = await geometry(tab, 'samples'), archive = await geometry(tab, 'samples/archive'), nested = await geometry(tab, 'samples/reconcile.ts');
    const deep = await geometry(tab, 'samples/archive/notes-2025.md'), deepSibling = await geometry(tab, 'samples/archive/gaps-2025.csv');
    assert.equal(nested.icon.x, archive.icon.x, `${label}: a nested file's icon sits in its sibling folder's icon column`);
    assert.equal(nested.name.x, archive.name.x, `${label}: a nested file's name starts where its sibling folder's name starts`);
    assert.equal(deep.icon.x, deepSibling.icon.x, `${label}: files two levels down share one icon column`);
    assert.equal(deep.name.x, deepSibling.name.x, `${label}: files two levels down share one name column`);
    assert.ok(nested.icon.x > folder.icon.x, `${label}: nested rows are indented`);
    assert.equal(Math.round((deep.icon.x - archive.icon.x) * 10), Math.round((nested.icon.x - samples.icon.x) * 10), `${label}: each depth indents by the same step`);
    assert.equal(archive.icon.width, 16, `${label}: a nested folder's kind icon is 16px`);

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
    const chip = tab.locator('[data-testid=mention-chip]').first();
    await chip.waitFor({ timeout: 8000 });
    assert.match(await chip.innerText(), /open-gaps\.csv\s+row 3\s+Card Harbor Garage · Jan 09 · \$12\.00/, `${label}: the chip is the file, a row badge and the cells' summary`);
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

test('the shell Library pane shows the same aligned tree at 390 and 1440', { skip, timeout: 240000 }, async t => {
  const dir = mkdtempSync(join(tmpdir(), 'tree-library-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const page = join(dir, 'page.html');
  await buildPage('test/fixtures/themes/one-composer.jsx', page);
  const browser = await playwright.chromium.launch({ executablePath: process.env.CHROMIUM, args: ['--no-sandbox'] });
  t.after(() => browser.close());
  const scope = '[data-testid=fixture-library]';
  for (const viewport of VIEWPORTS) for (const dark of [false, true]) {
    const label = `library ${viewport.name} ${dark ? 'dark' : 'light'}`;
    const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height }, hasTouch: viewport.touch, isMobile: viewport.touch });
    const tab = await context.newPage();
    await tab.goto(`file://${page}?demo=1&pace=instant&${viewport.touch ? 'tabs=1' : 'single=1'}${dark ? '&dark=1' : ''}`);
    await tab.locator('[data-testid=composer-input]').first().waitFor({ timeout: 30000 });
    if (await tab.locator('[data-testid=agent-bar-conversation]').count()) await tab.locator('[data-testid=agent-bar-conversation]').click();
    await tab.locator('[data-testid=agent-layer-library]:visible').first().click();
    await tab.locator(`${scope} [role=treeitem]`).first().waitFor({ timeout: 15000 });
    const folder = await geometry(tab, 'uploads', scope), file = await geometry(tab, 'closing-notes.md', scope);
    assert.equal(file.icon.x, folder.icon.x, `${label}: a file's icon sits in its sibling folder's icon column`);
    assert.equal(file.name.x, folder.name.x, `${label}: a file's name starts where its sibling folder's name starts`);
    assert.equal(folder.icon.width, 16, `${label}: kind icon 16px`);
    assert.equal(folder.chevron.width, 14, `${label}: chevron 14px`);
    assert.equal(folder.row.height, viewport.touch ? 44 : 32, `${label}: rows are 32px, 44px on touch`);
    assert.equal(folder.title, null, `${label}: no title tooltip`);
    await tab.locator(`${scope} [role=treeitem][data-path="samples"] .file-tree-row-button`).first().click();
    await tab.locator(`${scope} [role=treeitem][data-path="samples/archive"]`).waitFor();
    const archive = await geometry(tab, 'samples/archive', scope), nested = await geometry(tab, 'samples/reconcile.ts', scope);
    assert.equal(nested.icon.x, archive.icon.x, `${label}: nested file and folder share an icon column`);
    assert.equal(nested.name.x, archive.name.x, `${label}: nested file and folder share a name column`);
    await context.close();
  }
});
