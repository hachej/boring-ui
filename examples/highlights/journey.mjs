import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { launch, pause } from '@hachej/boring-testing/browser';
import { startHighlights, source, target } from './server.mjs';

const evidence = resolve('.cache/evidence/D78'); mkdirSync(evidence, { recursive: true });
const report = { steps: [] }, app = await startHighlights();
let browser, second;
const step = async (name, run) => { const item = { name }; report.steps.push(item); try { await run(); item.status = 'passed'; console.log(`PASS ${name}`); } catch (error) { item.status = 'failed'; item.error = String(error.stack ?? error); throw error; } };
const button = label => `[...document.querySelectorAll('button,[role=menuitem]')].find(b => (b.getAttribute('aria-label') || b.textContent) === ${JSON.stringify(label)})`;
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
          await browser.screenshot(`${device}-${locale}-${mode}.png`);
          if (device === 'phone') {
            await browser.evaluate(`document.querySelector('aside').scrollIntoView({block:'end'})`); await browser.screenshot(`${device}-${locale}-${mode}-tray.png`);
          }
        }
      }
    }
  });
  await browser.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 1000, deviceScaleFactor: 1, mobile: false });
  await browser.send('Page.navigate', { url: app.url }); await ready(browser);
  second = await launch(app.url, { evidence }); await ready(second);
  await step('a person chooses candidate 2 and its exact new anchor persists across reload', async () => {
    await browser.click(`[...document.querySelectorAll('button')].find(b => b.textContent.startsWith('Use candidate 2:'))`);
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
    await second.until('stale write refused', `document.body.innerText.includes('Marks changed elsewhere')`);
    assert.equal((await marks()).find(m => m.id === 'kite').note, 'A fictional saved comment.');
    await second.screenshot('desktop-en-light-stale-tab.png');
    await second.click(button('Reload marks'));
    await second.until('reload settles conflict', `!document.body.innerText.includes('Reload marks')`);
    await browser.click(button('Highlight actions'));
    await browser.until('context menu open', `!!document.querySelector('[role=menuitem]')`);
    await browser.screenshot('desktop-en-light-context-menu.png');
    await browser.press('Escape');
  });
  await step('source selection adds a mark without modifying document text; menu removal uses conditional publication', async () => {
    await browser.click(button('Markdown source'));
    const input = `document.querySelector('textarea.boring-markdown-source')`;
    await browser.click(input); await selectAll(browser);
    await browser.until('exact source selected', `![...document.querySelectorAll('button')].find(b => b.textContent === 'Highlight selection').disabled`);
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
