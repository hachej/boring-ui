import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launch, q } from '@hachej/boring-testing/browser';
import { startWorkspaceApp } from '../examples/workspace-app/server.mjs';

const evidence = process.env.DESIGN_EVIDENCE ?? '.cache/evidence/shadcn-first/group-7';
mkdirSync(evidence, { recursive: true });
const app = await startWorkspaceApp({ directory: mkdtempSync(join(tmpdir(), 'boring-viewer-chrome-')), scripted: true });
let browser;
const screenshots = [];
try {
  browser = await launch('about:blank', { evidence });
  for (const theme of ['stock', 'brand']) for (const mode of ['light', 'dark']) for (const width of [1440, 390]) {
    await browser.send('Emulation.setDeviceMetricsOverride', { width, height: width === 390 ? 844 : 950, deviceScaleFactor: 1, mobile: width === 390 });
    await browser.send('Emulation.setTouchEmulationEnabled', { enabled: width === 390, maxTouchPoints: 5 });
    await browser.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: mode }, { name: 'prefers-reduced-motion', value: 'reduce' }] });
    for (const surface of ['markdown', 'source', 'selection', 'proposal', 'html', 'html-source', 'standalone-markdown', 'standalone-html', 'image', 'pdf', 'manual']) {
      const previous = await browser.evaluate('performance.timeOrigin');
      await browser.send('Page.navigate', { url: `${app.url}?viewer=${surface}&theme=${theme}&mode=${mode}` });
      await browser.until('fictional viewer mounted', `performance.timeOrigin !== ${previous} && !!${q('[data-testid=viewer-chrome-fixture]')} && document.documentElement.classList.contains('dark') === ${mode === 'dark'}`, 30000);
      if (['markdown', 'selection', 'proposal', 'standalone-markdown'].includes(surface)) await browser.until('native rich editor', `!!${q('[contenteditable=true]')}`, 10000);
      if (surface === 'image') await browser.until('image loaded', `${q('img')}?.naturalWidth === 640`, 10000);
      if (surface === 'proposal') {
        await browser.click(q('summary'));
        await browser.until('proposal diff', `!!${q('[data-boring=proposal-diff]')}`);
      }
      if (surface === 'selection' || surface === 'markdown' && width === 390) {
        await browser.evaluate(`(() => { const editor = ${q('[contenteditable=true]')}; editor.focus(); const range = document.createRange(); range.selectNodeContents(editor.querySelector('p')); const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range); document.dispatchEvent(new Event('selectionchange')); })()`);
        await browser.until('native selection toolbar', `!!${q('.boring-markdown-bubble [data-slot=toggle]')}`, 10000);
      }
      if (surface === 'manual') {
        await browser.click(q('[data-testid=fixture-viewer-more]'));
        await browser.click(q('[data-testid=fixture-viewer-copy]'));
        await browser.until('native manual-copy dialog', `!!${q('[data-testid=fixture-viewer-manual-copy][data-slot=dialog-content]')}`);
        assert.equal(await browser.evaluate(`${q('[data-testid=fixture-viewer-manual-copy-text]')}.value`), '# Cedar Works\n\nA fictional picnic plan.\n\n- Bring a blanket\n- Pack some sandwiches\n');
      }
      await browser.evaluate(`Promise.all(document.getAnimations().filter(animation => Number.isFinite(animation.effect?.getComputedTiming().endTime)).map(animation => animation.finished.catch(() => {})))`);
      const rawControls = await browser.evaluate(`Array.from(document.querySelectorAll('[data-testid=viewer-chrome-fixture] button, [data-testid=viewer-chrome-fixture] input, [data-testid=viewer-chrome-fixture] textarea')).filter(element => element.checkVisibility() && !element.dataset.slot).map(element => element.outerHTML)`);
      assert.deepEqual(rawControls, [], `${surface}: every mounted viewer control comes from shadcn`);
      const file = `viewer-${theme}-${mode}-${width}-${surface}.png`;
      await browser.screenshot(file); screenshots.push(file);
    }
  }
  assert.deepEqual(browser.problems, [], 'viewer fixtures have no browser console errors');
  writeFileSync(join(evidence, 'viewer-screenshots.json'), JSON.stringify(screenshots, null, 2) + '\n');
  console.log(`PASS: ${screenshots.length} real viewer screenshots, stock and brand, light and dark, desktop and phone.`);
} finally { if (browser) await browser.close(); await app.close(); }
