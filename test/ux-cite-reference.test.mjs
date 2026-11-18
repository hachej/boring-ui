import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { mentionedPaths } from '@hachej/boring-ui-kit/chat-text';
import { buildPage, root } from '../ux/runner/build.mjs';

// The cite button on the real design-system page: one chip per citation (title and number, tooltip, own remove), a second citation adds a second chip, the same one again
// changes nothing, the text typed stays free, the agent receives a structured reference, and French is a setting (`locale="fr"`).
const require = createRequire(join(root, 'package.json'));
let playwright; try { playwright = require('playwright-core'); } catch { /* not installed */ }
const skip = !process.env.CHROMIUM || !playwright;
const VIEWPORTS = [{ name: '390', width: 390, height: 844, touch: true }, { name: '1440', width: 1440, height: 900, touch: false }];

const cites = text => mentionedPaths(text).filter(value => value.startsWith('cite:')).map(value => JSON.parse(value.slice(5)));

test('a card is cited to the agent: one chip each, the same one once, free text, a structured reference, French by setting', { skip, timeout: 300000 }, async t => {
  const dir = mkdtempSync(join(tmpdir(), 'cite-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const page = join(dir, 'page.html');
  await buildPage('ux/fixtures/design-system.jsx', page);
  const browser = await playwright.chromium.launch({ executablePath: process.env.CHROMIUM, args: ['--no-sandbox'] });
  t.after(() => browser.close());
  for (const viewport of VIEWPORTS) for (const lang of ['en', 'fr']) {
    const label = `${viewport.name} ${lang}`;
    const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height }, hasTouch: viewport.touch, isMobile: viewport.touch });
    const tab = await context.newPage();
    const errors = [];
    tab.on('pageerror', error => errors.push(String(error)));
    await tab.goto(`file://${page}?demo=1&pace=instant&lang=${lang}`);
    const button = id => tab.locator(`[data-testid=ds-cite-${id}] [data-testid=cite-reference]`);
    const chips = tab.locator('[data-testid=mention-chip]');
    const chipCount = count => tab.waitForFunction(expected => document.querySelectorAll('[data-testid=mention-chip]').length === expected, count, { timeout: 8000 });
    const words = lang === 'fr' ? 'Citer dans l’assistant' : 'Reference in agent';
    await button(1).waitFor({ timeout: 30000 });
    assert.equal(await button(1).getAttribute('aria-label'), `${words}: Sort the list by date`, `${label}: the button is named`);
    if (viewport.touch) {
      const box = await button(1).boundingBox();
      assert.ok(box.width >= 43.5 && box.height >= 43.5, `${label}: a 44px touch target (${box.width}x${box.height})`);
    } else {
      await button(1).hover();
      await tab.locator('[data-slot=tooltip-content]', { hasText: words }).waitFor({ timeout: 4000 });
    }
    await tab.locator('[data-testid=composer-input]').fill('Why is this slow?');
    await button(1).click();
    await chipCount(1);
    assert.match(await chips.first().innerText(), /Sort the list by date\s+#1/, `${label}: one chip, title and number`);
    await button(2).click();
    await chipCount(2);
    await button(1).click();
    await chipCount(2);
    assert.equal(await button(1).getAttribute('data-cited'), '', `${label}: a cited item's button reads cited`);
    assert.match(await tab.locator('[data-testid=composer-input]').inputValue(), /Why is this slow\?/, `${label}: the typed text stays`);
    await chips.nth(1).getByRole('button').click();
    await chipCount(1);
    assert.equal(await button(2).getAttribute('data-cited'), null, `${label}: removing the chip frees its button`);
    await button(2).click();
    await chipCount(2);
    const before = (await tab.evaluate(() => window.__sent ?? [])).length;
    await tab.locator('[data-testid=composer-submit]').click();
    await tab.waitForFunction(count => (window.__sent ?? []).length > count, before, { timeout: 10000 });
    const sent = (await tab.evaluate(() => window.__sent)).at(-1).text;
    assert.deepEqual(cites(sent), [{ kind: 'card', id: 1, title: 'Sort the list by date', subtitle: '#1' }, { kind: 'card', id: 2, title: 'Fix the export of open-gaps.csv', subtitle: '#2' }], `${label}: the agent receives the references in order`);
    assert.match(sent, /Why is this slow\?/, `${label}: with the person's own words`);
    assert.deepEqual(errors, [], `${label}: no page error`);
    await context.close();
  }
});
