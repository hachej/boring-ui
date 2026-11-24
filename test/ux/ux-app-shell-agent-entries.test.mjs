import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { buildPage, root } from '../../ux/runner/build.mjs';

// AppShell `headerAgent={false}` removes the assistant icon from the screen header (default: shown), and `agentNav="above-bottom"` puts the left bar's assistant entry above
// the nav items placed after the screen's content (default `end`: below them). The assistant stays reachable from the left bar either way.
const require = createRequire(join(root, 'package.json'));
let playwright; try { playwright = require('playwright-core'); } catch { /* not installed */ }
const skip = !process.env.CHROMIUM || !playwright;

test('AppShell: `headerAgent={false}` hides the header assistant icon; `agentNav="above-bottom"` moves the left bar entry above the bottom items; defaults unchanged', { skip, timeout: 300000 }, async t => {
  const dir = mkdtempSync(join(tmpdir(), 'app-shell-agent-entries-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const page = join(dir, 'page.html');
  await buildPage('ux/fixtures/design-system.jsx', page);
  const browser = await playwright.chromium.launch({ executablePath: process.env.CHROMIUM, args: ['--no-sandbox'] });
  t.after(() => browser.close());
  const open = async query => {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    t.after(() => context.close());
    const tab = await context.newPage();
    await tab.goto(`file://${page}?demo=1&pace=instant${query}`);
    await tab.locator('[data-testid=nav-agent]').waitFor({ timeout: 30000 });
    // The agent entry's place among the nav items: `before` is true when it comes first in the document.
    const above = await tab.evaluate(() => Boolean(document.querySelector('[data-testid=nav-agent]').compareDocumentPosition(document.querySelector('[data-testid=nav-design]')) & Node.DOCUMENT_POSITION_FOLLOWING));
    return { tab, above, header: await tab.locator('[data-testid=agent-trigger]').count() };
  };

  const base = await open('');
  assert.equal(base.header, 1, 'default: the header shows the assistant icon');
  assert.equal(base.above, false, 'default: the left bar entry comes after the nav items');

  const hidden = await open('&headerAgent=0');
  assert.equal(hidden.header, 0, 'headerAgent={false}: no assistant icon in the header');
  assert.equal(await hidden.tab.locator('[data-testid=nav-agent]').count(), 1, 'the left bar entry stays');
  assert.equal(hidden.above, false, 'headerAgent alone leaves the entry where it was');
  await hidden.tab.locator('[data-testid=nav-agent]').click();
  await hidden.tab.waitForFunction(() => document.querySelector('[data-testid=nav-agent]').getAttribute('aria-pressed') === 'true', null, { timeout: 4000 });

  const moved = await open('&agentNav=above-bottom');
  assert.equal(moved.above, true, 'agentNav="above-bottom": the entry comes before the bottom nav items');
  assert.equal(moved.header, 1, 'agentNav alone keeps the header icon');
});
