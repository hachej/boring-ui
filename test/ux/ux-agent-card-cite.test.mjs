import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { buildPage, root } from '../../ux/runner/build.mjs';

// `AgentCard` props `notch` and `cite` on the real design-system page (inside the AppShell): the card with `notch={false}` draws no strip while the others keep theirs,
// and the card with `cite={<CiteButton/>}` shows the @ on hover (always on touch), puts one chip with the card's title in the page's composer, and keeps the @ shown while cited.
const require = createRequire(join(root, 'package.json'));
let playwright; try { playwright = require('playwright-core'); } catch { /* not installed */ }
const skip = !process.env.CHROMIUM || !playwright;
const VIEWPORTS = [{ name: '390', width: 390, height: 844, touch: true }, { name: '1440', width: 1440, height: 900, touch: false }];

test('agent card: `notch={false}` draws no strip (default keeps it); `cite` is an @ on hover that references the card in the composer', { skip, timeout: 300000 }, async t => {
  const dir = mkdtempSync(join(tmpdir(), 'agent-card-cite-'));
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
    const card = tab.locator('[data-task=cited] [data-testid=agent-card]');
    await card.waitFor({ timeout: 30000 });
    await card.scrollIntoViewIfNeeded();

    assert.equal(await tab.locator('[data-task=cited] [data-testid=composer-controller]').count(), 0, `${label}: notch={false} draws no strip`);
    assert.equal(await tab.locator('[data-task=done] [data-testid=composer-controller]').count(), 1, `${label}: the default keeps the strip`);

    const wrap = tab.locator('[data-task=cited] [data-testid=agent-card-cite]');
    const opacity = () => wrap.evaluate(node => getComputedStyle(node).opacity);
    const chips = tab.locator('[data-testid=mention-chip]');
    const button = tab.locator('[data-task=cited] [data-testid=cite-reference]');
    await button.waitFor();
    if (viewport.touch) assert.equal(await opacity(), '1', `${label}: on touch the @ is always shown`);
    else {
      assert.equal(await opacity(), '0', `${label}: at rest the @ is hidden`);
      await card.hover();
      await tab.waitForFunction(() => getComputedStyle(document.querySelector('[data-task=cited] [data-testid=agent-card-cite]')).opacity === '1', null, { timeout: 4000 });
    }
    await tab.locator('[data-testid=composer-input]').fill('Why is this late?');
    await button.click();
    await tab.waitForFunction(() => document.querySelectorAll('[data-testid=mention-chip]').length === 1, null, { timeout: 8000 });
    assert.match(await chips.first().innerText(), /Chase the late payers \(cite, no notch\)\s+#3/, `${label}: the composer holds one chip, the card's title and number`);
    assert.equal(await button.getAttribute('data-cited'), '', `${label}: the @ reads as cited`);
    if (!viewport.touch) {
      await tab.mouse.move(0, 0);
      assert.equal(await opacity(), '1', `${label}: a cited card keeps its @ shown`);
    }
    assert.deepEqual(errors, [], `${label}: no page error`);
    await context.close();
  }
});
