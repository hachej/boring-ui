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
      if (surface === 'pdf') await assertPdfPages(browser, 1);
      if (surface === 'proposal') {
        await browser.click(q('summary'));
        await browser.until('proposal diff', `!!${q('[data-boring=proposal-diff]')}`);
      }
      if (['markdown', 'standalone-markdown'].includes(surface)) {
        // The document surface draws no focus frame while editing (the caret is the cue), even after keyboard input.
        await browser.press('Shift');
        const frame = await browser.evaluate(`(() => { const editor = ${q('.boring-markdown-content[contenteditable=true]')}; editor.focus(); const style = getComputedStyle(editor); return { focused: document.activeElement === editor, outline: style.outlineStyle === 'none' || parseFloat(style.outlineWidth) === 0 ? 'none' : style.outlineStyle + ' ' + style.outlineWidth, shadow: style.boxShadow }; })()`);
        assert.deepEqual(frame, { focused: true, outline: 'none', shadow: 'none' }, `${surface}: no focus frame around the editing surface`);
        // Save stays a quiet ghost icon action beside the status (autosave saves on its own); its name and Ctrl/Cmd+S remain.
        const save = await browser.evaluate(`(() => { const button = document.querySelector('[data-testid$=-save][data-slot=button]'); return button && { name: button.getAttribute('aria-label'), background: getComputedStyle(button).backgroundColor }; })()`);
        if (surface === 'markdown') assert.deepEqual(save, { name: 'Save', background: 'rgba(0, 0, 0, 0)' }, `${surface}: Save is a ghost icon button`);
        await browser.evaluate(`document.activeElement?.blur()`);
      }
      if (surface === 'markdown' && width === 1440) {
        // A narrow artifact column makes the formatting toolbar overflow: it scrolls, but shows no native scrollbar.
        const bar = await browser.evaluate(`(() => { const toolbar = ${q('.boring-markdown-toolbar')}; toolbar.style.width = '240px'; const style = getComputedStyle(toolbar); return { overflows: toolbar.scrollWidth > toolbar.clientWidth, scrollbarWidth: style.scrollbarWidth, barHeight: toolbar.offsetHeight - toolbar.clientHeight, overflowX: style.overflowX }; })()`);
        assert.deepEqual(bar, { overflows: true, scrollbarWidth: 'none', barHeight: 0, overflowX: 'auto' }, `${surface}: overflowing toolbar scrolls with no native scrollbar`);
      }
      if (surface === 'selection' || surface === 'markdown' && width === 390) {
        await browser.evaluate(`(() => { const editor = ${q('[contenteditable=true]')}; editor.focus(); const range = document.createRange(); range.selectNodeContents(editor.querySelector('p')); const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range); document.dispatchEvent(new Event('selectionchange')); })()`);
        // On a phone the focused editor docks the full formatting bar above the keyboard; on a desktop the selection opens the bubble.
        await browser.until('native formatting toolbar', width === 390 ? `!!${q('[data-testid=markdown-dock] [data-slot=toggle]')} && !!${q('[data-testid=markdown-dock] [data-slot=separator]')}` : `!!${q('.boring-markdown-bubble [data-slot=toggle]')}`, 10000);
      }
      if (surface === 'manual') {
        await browser.click(q('[data-testid=fixture-viewer-more]'));
        await browser.click(q('[data-testid=fixture-viewer-copy]'));
        await browser.until('native manual-copy dialog', `!!${q('[data-testid=fixture-viewer-manual-copy][data-slot=dialog-content]')}`);
        assert.equal(await browser.evaluate(`${q('[data-testid=fixture-viewer-manual-copy-text]')}.value`), '# Cedar Works\n\nA fictional picnic plan.\n\n- Bring a blanket\n- Pack some sandwiches\n');
      }
      await browser.evaluate(`Promise.all(document.getAnimations().filter(animation => Number.isFinite(animation.effect?.getComputedTiming().endTime)).map(animation => animation.finished.catch(() => {})))`);
      const rawControls = await browser.evaluate(`Array.from(document.querySelectorAll('[data-testid=viewer-chrome-fixture] button, [data-testid=viewer-chrome-fixture] input, [data-testid=viewer-chrome-fixture] textarea, [data-testid=markdown-dock] button, .boring-markdown-bubble button')).filter(element => element.checkVisibility() && !element.dataset.slot).map(element => element.outerHTML)`);
      assert.deepEqual(rawControls, [], `${surface}: every mounted viewer control comes from shadcn`);
      const file = `viewer-${theme}-${mode}-${width}-${surface}.png`;
      await browser.screenshot(file); screenshots.push(file);
    }
  }
  // A high-density phone: the page canvas carries three device pixels per CSS pixel.
  await browser.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 3, mobile: true });
  {
    const previous = await browser.evaluate('performance.timeOrigin');
    await browser.send('Page.navigate', { url: `${app.url}?viewer=pdf&theme=stock&mode=light` });
    await browser.until('pdf at 3x', `performance.timeOrigin !== ${previous} && !!${q('[data-testid=viewer-chrome-fixture]')}`, 30000);
    await assertPdfPages(browser, 3);
  }
  await browser.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  // A damaged file still falls back to Download; a browser with its own viewer keeps the frame (desktop is unchanged).
  for (const [surface, ready] of [['pdf-damaged', `!!${q('[data-testid=fixture-viewer-pdf-fallback] [data-testid=fixture-viewer-pdf-download]')}`], ['pdf-native', `${q('iframe[data-testid=fixture-viewer-frame-pdf]')}?.src.startsWith('blob:')`]]) {
    const previous = await browser.evaluate('performance.timeOrigin');
    await browser.send('Page.navigate', { url: `${app.url}?viewer=${surface}&theme=stock&mode=light` });
    await browser.until(surface, `performance.timeOrigin !== ${previous} && ${ready}`, 30000);
    assert.equal(await browser.evaluate(`document.querySelectorAll('[data-testid=fixture-viewer-pdf-canvas]').length`), 0, `${surface}: no pdf.js pages`);
  }
  assert.deepEqual(browser.problems, [], 'viewer fixtures have no browser console errors');
  writeFileSync(join(evidence, 'viewer-screenshots.json'), JSON.stringify(screenshots, null, 2) + '\n');
  console.log(`PASS: ${screenshots.length} real viewer screenshots, stock and brand, light and dark, desktop and phone.`);
} finally { if (browser) await browser.close(); await app.close(); }

/** The phone path: pdf.js draws both pages of the fictional PDF (canvases with ink, crisp at the device ratio, page 2 once scrolled near), the indicator follows the scroll and zoom widens the pages. */
async function assertPdfPages(browser, ratio) {
  const pages = `Array.from(document.querySelectorAll('[data-testid=fixture-viewer-pdf-page]'))`;
  const scroller = q('[data-testid=fixture-viewer-pdf-pages]');
  await browser.until('pdf.js drew the first page', `${pages}.length === 2 && !!${pages}[0].dataset.rendered`, 30000);
  assert.equal(await browser.evaluate(`${q('[data-testid=fixture-viewer-pdf-page-indicator]')}.textContent`), '1 / 2');
  await browser.evaluate(`(() => { const box = ${scroller}; box.scrollTop = box.scrollHeight; })()`);
  await browser.until('the second page drawn once near and the indicator following the scroll', `!!${pages}[1].dataset.rendered && ${q('[data-testid=fixture-viewer-pdf-page-indicator]')}.textContent === '2 / 2'`, 15000);
  const drawn = await browser.evaluate(`${pages}.map(page => { const canvas = page.querySelector('canvas'); const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data; let ink = 0; for (let i = 0; i < pixels.length; i += 4) if (pixels[i] < 128) ink++; return { width: canvas.width, height: canvas.height, css: Math.round(canvas.getBoundingClientRect().width), ink }; })`);
  for (const page of drawn) {
    assert.ok(page.width > 0 && page.height > page.width, `a portrait page canvas with pixels: ${JSON.stringify(page)}`);
    assert.equal(page.width, page.css * ratio, `the canvas is scaled by the device pixel ratio (${ratio})`);
    assert.ok(page.ink > 100, `text drawn on the page: ${JSON.stringify(page)}`);
  }
  const stage = await browser.evaluate(`${scroller}.clientWidth`);
  assert.ok(drawn[0].css <= stage && drawn[0].css >= stage - 24, `the page fits the pane width (${drawn[0].css} of ${stage})`);
  await browser.evaluate(`${scroller}.scrollTop = 0`);
  await browser.until('the indicator back on page 1', `${q('[data-testid=fixture-viewer-pdf-page-indicator]')}.textContent === '1 / 2'`, 5000);
  // On a phone the viewer controls live in the "…" menu, as for images.
  const zoomStep = async id => {
    if (!await browser.evaluate(`!!document.querySelector('[data-testid=fixture-viewer-controls] [data-testid=fixture-viewer-${id}]')?.checkVisibility()`)) {
      if (!await browser.evaluate(`!!document.querySelector('[data-slot=dropdown-menu-content]')`)) await browser.click(q('[data-testid=fixture-viewer-more]'));
      await browser.click(q(`[data-slot=dropdown-menu-content] [data-testid=fixture-viewer-${id}]`));
    } else await browser.click(q(`[data-testid=fixture-viewer-controls] [data-testid=fixture-viewer-${id}]`));
  };
  await zoomStep('zoom-in');
  await browser.until('zoomed pages redrawn wider', `(() => { const page = ${pages}[0]; return page.getBoundingClientRect().width > ${drawn[0].css * 1.2} && page.querySelector('canvas').width > ${drawn[0].width}; })()`, 15000);
  await zoomStep('zoom-out');
  await browser.until('back to fit width', `Math.round(${pages}[0].getBoundingClientRect().width) === ${drawn[0].css} && ${pages}[0].querySelector('canvas').width === ${drawn[0].width}`, 15000);
  await browser.evaluate(`${scroller}.scrollLeft = 0`);
  if (await browser.evaluate(`!!document.querySelector('[data-slot=dropdown-menu-content]')`)) {
    await browser.press('Escape');
    await browser.until('menu closed', `!document.querySelector('[data-slot=dropdown-menu-content]')`, 5000);
    await browser.evaluate(`document.activeElement?.blur()`);
  }
}
