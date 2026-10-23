// The looks viewer in a real browser: four looks of one key screen, then three layouts in the chosen look; light, dark, desktop and phone.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { launch, pause } from '@hachej/boring-testing/browser';
import { startLooks } from './server.mjs';

const evidence = resolve(process.env.LOOKS_EVIDENCE ?? '.cache/evidence/looks-viewer');
mkdirSync(evidence, { recursive: true });
const report = { steps: [] };
const app = await startLooks();
let browser;
const step = async (name, run) => {
  const item = { name }; report.steps.push(item);
  try { await run(); item.status = 'passed'; console.log(`PASS ${name}`); }
  catch (error) { item.status = 'failed'; item.error = String(error.stack ?? error); throw error; }
};
const ev = body => browser.evaluate(`(async () => { ${body} })()`);
const open = async (file, frames) => {
  await browser.send('Page.navigate', { url: `${app.url}?file=${file}` });
  await browser.until(`${frames} frames`, `document.querySelectorAll('[data-testid=looks-frame] iframe').length === ${frames}`, 30000);
  await pause(2500);
};
const size = async (width, height, mobile = false) => browser.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile });
// The frame's own variables: what the sandboxed page was given, read back from its srcdoc's theme message is not possible (opaque origin),
// so the host side is checked: each frame receives a distinct primary through the pick-mode message (see the contract test).
try {
  browser = await launch(app.url, { evidence });
  await size(1440, 1100);
  await step('four looks of the key screen, each with its label, personality, swatches and Pick', async () => {
    await open('looks', 4);
    const cards = await ev(`return [...document.querySelectorAll('[data-testid^=look-]:not([data-testid$=-pick])')].map(card => ({ id: card.dataset.testid, title: card.querySelector('h3')?.textContent, swatches: card.querySelectorAll('[data-testid=looks-swatches] circle').length, sandbox: card.querySelector('iframe')?.getAttribute('sandbox') }));`);
    assert.deepEqual(cards.map(card => card.id), ['look-calm', 'look-warm', 'look-bold', 'look-clinical']);
    for (const card of cards) { assert.equal(card.sandbox, 'allow-scripts'); assert.equal(card.swatches, 4, `${card.id} swatches`); }
    await browser.screenshot('desktop-1440-light-looks.png');
  });
  await step('Pick marks the look and tells the host', async () => {
    await browser.click(`document.querySelector('[data-testid=look-warm-pick]')`);
    await pause(300);
    assert.deepEqual(await ev(`return window.__picks;`), [{ kind: 'look', id: 'warm', label: 'Warm', path: 'fixtures/missing-receipts.looks.json' }]);
    assert.equal(await ev(`return document.querySelector('[data-testid=look-warm]').hasAttribute('data-chosen');`), true);
    await browser.screenshot('desktop-1440-light-looks-picked.png');
  });
  await step('dark previews every look in its dark values', async () => {
    await browser.click(`document.querySelector('[data-testid=looks-dark]')`);
    await pause(1500);
    await browser.screenshot('desktop-1440-dark-looks.png');
  });
  await step('three layouts in the chosen look', async () => {
    await open('layouts', 3);
    const cards = await ev(`return [...document.querySelectorAll('[data-testid^=layout-]:not([data-testid$=-pick])')].map(card => card.dataset.testid);`);
    assert.deepEqual(cards, ['layout-list-detail', 'layout-table', 'layout-board']);
    assert.match(await ev(`return document.querySelector('[data-testid=layouts-grid]').textContent;`), /In the Warm look/);
    await browser.screenshot('desktop-1440-light-layouts.png');
    await browser.click(`document.querySelector('[data-testid=layout-table-pick]')`);
    await pause(300);
    assert.equal((await ev(`return window.__picks;`)).at(-1).id, 'table');
  });
  await step('phone 390: one column, no horizontal overflow', async () => {
    await size(390, 844, true);
    await open('looks', 4);
    assert.equal(await ev(`return document.documentElement.scrollWidth <= innerWidth;`), true);
    await browser.screenshot('phone-390-light-looks.png');
  });
} finally {
  if (browser) await browser.close();
  await app.close();
  writeFileSync(resolve(evidence, 'report.json'), JSON.stringify(report, null, 2));
}
