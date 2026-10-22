import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { launch, pause } from '@hachej/boring-testing/browser';
import { startHighlights, source, target } from './server.mjs';

const evidence = resolve('.cache/evidence/D78'); mkdirSync(evidence, { recursive: true });
const report = { steps: [], markers: [] }, app = await startHighlights();
let browser, second;
const step = async (name, run) => { const item = { name }; report.steps.push(item); try { await run(); item.status = 'passed'; console.log(`PASS ${name}`); } catch (error) { item.status = 'failed'; item.error = String(error.stack ?? error); throw error; } };
const button = label => `[...document.querySelectorAll('button,[role^=menuitem]')].find(b => (b.getAttribute('aria-label') || b.textContent) === ${JSON.stringify(label)})`;
const ready = page => page.until('highlights and exact decoration', `!!document.querySelector('[data-mark-id="kite"]') && !![...document.querySelectorAll('button')].find(b => ['Highlight selection','Surligner la sélection'].includes(b.textContent))`, 30000);
const marks = async () => {
  const read = await app.client.read({ target: { ...target, resource: { ...target.resource, path: `${target.resource.path}.marks.json` } }, revision: { kind: 'latest' } });
  assert.equal(read.kind, 'available'); return JSON.parse(new TextDecoder().decode(read.snapshot.bytes)).marks;
};
const selectAll = async page => { for (const type of ['keyDown', 'keyUp']) await page.send('Input.dispatchKeyEvent', { type, key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: 2 }); };
try {
  browser = await launch(app.url, { evidence });
  await step('desktop and phone, FR/EN, light and dark: exact decoration and honest missing/ambiguous tray', async () => {
    for (const [device, width, height] of [['desktop', 1280, 1000], ['phone', 390, 844]]) {
      await browser.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: device === 'phone' });
      for (const locale of ['en', 'fr']) {
        await browser.send('Page.navigate', { url: `${app.url}?locale=${locale}` }); await ready(browser);
        assert.equal(await browser.evaluate(`document.querySelectorAll('[data-testid=lost-mark]').length`), 2);
        assert.equal(await browser.evaluate(`document.querySelector('[data-mark-id=kite]').textContent`), 'fictional kite');
        assert.equal(await browser.evaluate(`document.querySelector('[data-mark-id=duplicate]')`), null);
        for (const mode of ['light', 'dark']) {
          await browser.evaluate(`document.documentElement.classList.toggle('dark', ${mode === 'dark'}); scrollTo(0,0)`); await pause(150);
          const overflow = await browser.evaluate(`({ width: document.documentElement.scrollWidth, elements: [...document.querySelectorAll('main *')].filter(e => e.getBoundingClientRect().right > innerWidth).slice(0,12).map(e => [e.tagName, e.className, e.getBoundingClientRect().right]) })`);
          await browser.screenshot(`${device}-${locale}-${mode}-layout.png`);
          assert.ok(overflow.width <= width, `no horizontal overflow: ${JSON.stringify(overflow)}`);
          const marker = await browser.evaluate(`(() => {
            const mark = document.querySelector('[data-mark-id=kite]'), style = getComputedStyle(mark), page = getComputedStyle(document.body);
            const context = document.createElement('canvas').getContext('2d');
            const luminance = colour => { context.fillStyle = colour; context.fillRect(0,0,1,1); const rgb = [...context.getImageData(0,0,1,1).data].slice(0,3).map(v => { const c = v / 255; return c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4; }); return rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722; };
            const front = luminance(style.color), back = luminance(style.backgroundColor);
            return { foreground: style.color, background: style.backgroundColor, pageForeground: page.color, pageBackground: page.backgroundColor, contrast: (Math.max(front,back) + .05) / (Math.min(front,back) + .05), commented: !!document.querySelector('[data-mark-comment=kite][role=img]'), selection: getComputedStyle(mark, '::selection').backgroundColor, chroma: (() => { const rgb = [...context.getImageData(0,0,1,1).data].slice(0,3); return Math.max(...rgb) - Math.min(...rgb); })() };
          })()`);
          assert.equal(marker.foreground, marker.pageForeground); assert.notEqual(marker.background, marker.pageForeground); assert.notEqual(marker.background, marker.pageBackground);
          assert.ok(marker.contrast >= 4.5, `readable marker: ${JSON.stringify(marker)}`); assert.equal(marker.commented, true);
          assert.ok(marker.chroma > 3, 'marker has a theme tint, not neutral text-selection grey'); assert.notEqual(marker.background, marker.selection);
          report.markers.push({ device, locale, mode, ...marker });
          assert.equal(await browser.evaluate(`document.querySelector('aside h3').textContent`), locale === 'fr' ? "2 surlignages n'ont pas pu être placés" : '2 highlights could not be placed');
          assert.equal(await browser.evaluate(`document.querySelectorAll('[data-testid=candidate-context] mark').length`), 2);
          await browser.screenshot(`${device}-${locale}-${mode}.png`);
          if (device === 'phone') {
            await browser.evaluate(`document.querySelector('aside').scrollIntoView({block:'end'})`); await browser.screenshot(`${device}-${locale}-${mode}-tray.png`);
          }
        }
        await browser.click(`document.querySelector('[data-mark-id=kite]')`);
        await browser.until('focused commented marker', `document.querySelector('[data-mark-id=kite]')?.getAttribute('data-mark-active') === 'true'`);
        assert.equal(await browser.evaluate(`getComputedStyle(document.querySelector('[data-mark-id=kite]')).outlineStyle`), 'solid');
        assert.equal(await browser.evaluate(`document.querySelector('[data-boring=highlights] header p').textContent`), locale === 'fr' ? "Sélectionnez d'abord un passage dans le document." : 'Select a passage in the document first.');
        await browser.click(`document.querySelector('[data-testid=highlight-context] textarea')`);
        await browser.until('comment field owns focus', `!document.querySelector('[data-testid=markdown-dock]')`);
        const layout = await browser.send('Page.getLayoutMetrics');
        const image = await browser.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: 0, y: 0, width, height: layout.cssContentSize.height, scale: 1 } });
        writeFileSync(resolve(evidence, `${device}-${locale}-dark-commented-and-tray.png`), Buffer.from(image.data, 'base64'));
      }
    }
  });
  await browser.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 1000, deviceScaleFactor: 1, mobile: false });
  await browser.send('Page.navigate', { url: app.url }); await ready(browser);
  second = await launch(app.url, { evidence }); await ready(second);
  await step('a person chooses candidate 2 and its exact new anchor persists across reload', async () => {
    await browser.click(`[...document.querySelectorAll('button')].find(b => b.textContent.startsWith('Choose passage 2'))`);
    await browser.until('candidate saved', `document.querySelectorAll('[data-testid=lost-mark]').length === 1 && !!document.querySelector('[data-mark-id=duplicate]') && document.querySelector('[data-testid=highlight-context] button:last-child')?.disabled === false`);
    assert.equal((await marks()).find(m => m.id === 'duplicate').anchor.start, source.lastIndexOf('echo'));
    await browser.reload(); await ready(browser);
    assert.equal(await browser.evaluate(`document.querySelectorAll('[data-testid=lost-mark]').length`), 1);
  });
  await step('context menu edits a comment and stale second-tab save refuses without replacing it', async () => {
    await browser.click(`document.querySelector('[data-mark-id=kite]')`);
    const input = `document.querySelector('[data-testid=highlight-context] textarea')`;
    await browser.click(input); await selectAll(browser); await browser.send('Input.insertText', { text: 'A fictional saved comment.' });
    await browser.click(button('Save comment'));
    await browser.until('comment saved', `!document.querySelector('[data-testid=highlight-context] button:last-child').disabled`);
    assert.equal((await marks()).find(m => m.id === 'kite').note, 'A fictional saved comment.');
    await second.click(`document.querySelector('[data-mark-id=kite]')`); await second.click(input); await selectAll(second); await second.send('Input.insertText', { text: 'A stale fictional comment.' });
    await second.click(button('Save comment'));
    await second.until('stale write refused', `document.body.innerText.includes('Highlights changed elsewhere')`);
    assert.equal((await marks()).find(m => m.id === 'kite').note, 'A fictional saved comment.');
    await second.screenshot('desktop-en-light-stale-tab.png');
    await second.click(button('Reload highlights'));
    await second.until('reload settles conflict', `!document.body.innerText.includes('Reload highlights')`);
    await browser.click(button('Highlight actions'));
    await browser.until('context menu open', `!!document.querySelector('[role=menuitem]')`);
    await browser.screenshot('desktop-en-light-context-menu.png');
    await browser.press('Escape');
  });
  await step('source selection adds a mark without modifying document text; menu removal uses conditional publication', async () => {
    await browser.click(button('More actions'));
    await browser.click(button('Markdown'));
    const input = `document.querySelector('textarea.boring-markdown-source')`;
    await browser.click(input); await selectAll(browser);
    await browser.until('exact source selected', `![...document.querySelectorAll('button')].find(b => b.textContent === 'Highlight selection').disabled`);
    await browser.screenshot('desktop-en-light-selection-enabled.png');
    await browser.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    assert.equal(await browser.evaluate(`${button('Highlight selection')}.disabled`), false);
    assert.equal(await browser.evaluate(`${button('Attach to selection')}.disabled`), false);
    await browser.screenshot('phone-en-light-selection-enabled.png');
    await browser.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 1000, deviceScaleFactor: 1, mobile: false });
    await browser.click(button('Highlight selection'));
    await browser.until('mark saved', `![...document.querySelectorAll('button')].find(b => b.textContent === 'Highlight selection').disabled`);
    assert.equal((await marks()).length, 4);
    const added = (await marks()).find(m => !['kite','duplicate','missing'].includes(m.id)); assert.equal(added.anchor.exact, source);
    await browser.click(`document.querySelector('details > summary')`);
    await browser.click(`document.querySelector('details mark')`);
    await browser.click(button('Highlight actions')); await browser.click(button('Remove highlight'));
    await browser.until('removed mark settled', `!document.querySelector('[data-testid=highlight-context]')`);
    assert.equal((await marks()).length, 3);
    const read = await app.client.read({ target, revision: { kind: 'latest' } }); assert.equal(new TextDecoder().decode(read.snapshot.bytes), source);
    await browser.screenshot('desktop-en-light-annotated-source.png');
  });
  await step('browser bundle excludes kernel/server filesystem and requests stay on the fixture origin', async () => {
    assert.deepEqual(Object.keys(app.metafile.inputs).filter(p => /(?:pi-durable|node:fs|sqlite-filesystem)/.test(p)), []);
    assert.deepEqual(await browser.evaluate(`performance.getEntriesByType('resource').map(r => r.name).filter(url => !url.startsWith(${JSON.stringify(app.url)}))`), []);
    assert.deepEqual(browser.problems, []); assert.deepEqual(second.problems, []);
  });
} finally {
  if (second) await second.close(); if (browser) await browser.close(); await app.close();
  writeFileSync(resolve(evidence, 'journey.json'), JSON.stringify(report, null, 2));
}
