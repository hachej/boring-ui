// Real-browser journey of the 0.4.3 gaps (scripted model, no key), embedded layout: the bar keeps a fixed app title with the conversation
// title after it (hidden on a phone), and a maquette opened from the Library draws its viewer instead of raw JSON.
// Screenshots at 1440 and 390, light and dark, go to .cache/evidence/gaps/.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { insecureUrl, launch, pause, q } from '@hachej/boring-testing/browser';

process.env.STUDIO_MODEL = 'scripted';
const { startWorkspaceApp } = await import('./server.mjs');
const evidence = process.env.APP_EVIDENCE ?? '.cache/evidence/gaps';
mkdirSync(evidence, { recursive: true });
const step = async (name, run) => { const started = Date.now(); await run(); console.log(`ok  ${name} (${Date.now() - started} ms)`); };
const INPUT = q('[data-testid=composer-input]');
const noOverflow = `document.documentElement.scrollWidth <= innerWidth && document.body.scrollWidth <= innerWidth`;
const scheme = value => browser.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value }] });
const shoot = async name => { for (const value of ['light', 'dark']) { await scheme(value); await pause(250); await browser.screenshot(`${name}-${value}.png`); } await scheme('light'); };
const desktop = async () => { await browser.emulate('desktop'); await browser.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false }); await pause(300); };
const libraryPick = async (tap, path) => {
  await (tap ? browser.tap : browser.click)(q('[data-testid=workspace-bar-library]'));
  const row = q(`[data-testid=workspace-library] [role=treeitem][data-path="${path}"] button`);
  await browser.until('the Library lists the file', `!!${row}`, 10000);
  await pause(700);
  await (tap ? browser.tap : browser.click)(row);
};

const app = await startWorkspaceApp({ directory: mkdtempSync(join(tmpdir(), 'boring-gaps-')) });
let browser;
try {
  browser = await launch(`${insecureUrl(app.url)}?embedded&title=Fictional%20bookings`, { evidence });
  await browser.until('the chat is live', `!!${INPUT} && !${INPUT}.disabled`, 20000);
  await desktop();
  await browser.type(INPUT, 'Make the booking mock-up and present it.'); await browser.press('Enter');
  await browser.until('the mock-up is presented', `${q('[data-testid=artifact-card][data-state=ready]')}?.dataset.artifactKind === 'Mock-up'`, 30000);

  await step('1440: the bar keeps the app title; the conversation title follows it, muted', async () => {
    await browser.until('the conversation has a title', `!!${q('[data-testid=workspace-bar-conversation]')}`, 15000);
    assert.equal(await browser.evaluate(`${q('[data-testid=workspace-bar-title]')}.textContent`), 'Fictional bookings');
    assert.ok((await browser.evaluate(`${q('[data-testid=workspace-bar-conversation]')}.textContent`)).length > 0);
    assert.ok(await browser.evaluate(noOverflow));
    await shoot('desktop-bar-title');
  });

  await step('1440: a maquette opened from the Library draws its viewer, not raw JSON', async () => {
    await libraryPick(false, 'booking.maquette.json');
    await browser.until('the maquette viewer', `!!${q('[data-testid=maquette-walk]')}`, 10000);
    assert.equal(await browser.evaluate(`${q('[data-testid=file-preview]')}`), null);
    await shoot('desktop-library-maquette');
  });

  await step('390: the bar keeps the app title and leaves the conversation to History; the Library opens the maquette', async () => {
    await browser.emulate('phone');
    await browser.send('Page.navigate', { url: `${insecureUrl(app.url)}?embedded&title=Fictional%20bookings` });
    await browser.until('the bar', `!!${q('[data-testid=workspace-bar-conversation]')}`, 20000);
    await pause(500);
    assert.equal(await browser.evaluate(`${q('[data-testid=workspace-bar-title]')}.textContent`), 'Fictional bookings');
    assert.equal(await browser.evaluate(`getComputedStyle(${q('[data-testid=workspace-bar-conversation]')}).display`), 'none');
    assert.ok(await browser.evaluate(noOverflow), 'no horizontal scroll at 390');
    await shoot('phone-bar-title');
    await browser.tap(q('[data-testid=workspace-bar-history]'));
    await browser.until('History lists the conversations', `!!${q('[data-testid=workspace-history] [data-testid=conversation-row]')}`, 10000);
    await shoot('phone-history');
    await browser.press('Escape');
    await browser.until('History closed', `!${q('[data-testid=workspace-history]')}`, 5000);
    await libraryPick(true, 'booking.maquette.json');
    await browser.until('the maquette viewer', `!!${q('[data-testid=maquette-walk]')}`, 10000);
    assert.ok(await browser.evaluate(noOverflow), 'no horizontal scroll at 390');
    await shoot('phone-library-maquette');
  });
} finally {
  await browser?.close();
  await app.close();
}
