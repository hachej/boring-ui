// Real workspace transcript with native Pi tools and the scripted model. No provider keys or production data.
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { insecureUrl, launch, pause, q } from '@hachej/boring-testing/browser';
import { startWorkspaceDemo } from './server.mjs';

const evidence = process.env.APP_EVIDENCE ?? '.cache/evidence/trace';
mkdirSync(evidence, { recursive: true });
const app = await startWorkspaceDemo({ scripted: true });
let browser;
try {
  browser = await launch(insecureUrl(app.url), { evidence });
  await browser.until('workspace composer', `!!${q('[data-testid=composer-input]')}`, 30000);
  const say = async text => { await browser.type(q('[data-testid=composer-input]'), text); await browser.press('Enter'); };
  const activity = q('[data-testid=activity]');
  const trigger = `${activity}.querySelector('[data-slot=trace-collapsible-trigger]')`;
  const screenshots = async name => {
    for (const scheme of ['light', 'dark']) {
      await browser.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme }] });
      await pause(200);
      await browser.screenshot(`${name}-${scheme}.png`);
    }
  };
  await say('Inspect Trace activity');
  await browser.until('running Trace title', `${activity}?.dataset.state === 'running' && !!${activity}.querySelector('[data-slot=trace-line][data-status=running]')`, 20000);
  await screenshots('running');
  // Native trigger owns Enter, aria-expanded, aria-controls and focus.
  await browser.evaluate(`${trigger}.focus()`);
  await browser.press('Enter');
  await browser.until('expanded running Trace', `${trigger}.getAttribute('aria-expanded') === 'true' && !!${activity}.querySelector('[data-testid=tool-card]')`, 5000);
  assert.equal(await browser.evaluate(`${trigger}.getAttribute('aria-controls') !== null`), true);
  const title = `${activity}.querySelector('[data-slot=trace-line][data-status=running] > [data-slot=trace-title]')`;
  assert.equal(await browser.evaluate(`getComputedStyle(${title}).animationName`), 'pi-chat-shimmer');
  await browser.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  assert.equal(await browser.evaluate(`getComputedStyle(${title}).animationName`), 'none');
  await browser.send('Emulation.setEmulatedMedia', { features: [] });
  await screenshots('running-expanded');
  await browser.until('one completed step beside the next running step', `!!${activity}.querySelector('[data-testid=tool-card][data-status=completed]') && !!${activity}.querySelector('[data-testid=tool-card][data-status=running]')`, 20000);
  await screenshots('done-and-running');
  await browser.until('native failure with output', `${activity}.dataset.state === 'failed' && !!${activity}.querySelector('[role=alert]')`, 20000);
  assert.match(await browser.evaluate(`${activity}.querySelector('[role=alert]').textContent`), /No invoice INV-NONE/);
  assert.equal(await browser.evaluate(`${activity}.querySelector('[data-testid=tool-card][data-status=failed] [data-slot=trace-line]').dataset.status`), 'error');
  await screenshots('failed-expanded');
  const errorTrigger = `${activity}.querySelector('[data-testid=tool-card][data-status=failed] [data-slot=trace-collapsible-trigger]')`;
  await browser.evaluate(`${errorTrigger}.focus()`);
  await browser.press('Enter');
  await browser.until('failure detail collapsed with keyboard', `${errorTrigger}.getAttribute('aria-expanded') === 'false'`, 5000);
  await browser.press('Enter');
  await browser.until('failure detail reopened with keyboard', `${errorTrigger}.getAttribute('aria-expanded') === 'true'`, 5000);
  await say('Read the Trace policy');
  const last = `[...document.querySelectorAll('[data-testid=activity]')].at(-1)`;
  await browser.until('a settled successful Trace', `${last}?.dataset.state === 'done' && document.body.innerText.includes('Trace policy read finished.')`, 20000);
  await screenshots('done');
  await browser.click(`${last}.querySelector('[data-slot=trace-collapsible-trigger]')`);
  await browser.until('successful steps expanded', `!!${last}.querySelector('[data-testid=tool-card][data-status=completed]')`, 5000);
  await screenshots('done-expanded');
  assert.deepEqual(browser.problems, []);
  console.log(`PASS: workspace Trace running/done/failed, nested output, keyboard disclosures; light/dark screenshots in ${evidence}`);
} finally {
  await browser?.close();
  await app.close();
}
