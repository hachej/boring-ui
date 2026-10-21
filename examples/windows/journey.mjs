import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { launch, pause } from '@hachej/boring-testing/browser';
import { startWindows } from './server.mjs';

const evidence = resolve('.cache/evidence/D79'); mkdirSync(evidence, { recursive: true });
const report = { steps: [] }, app = await startWindows(); let browser;
const step = async (name, run) => { const entry = { name }; report.steps.push(entry); try { await run(); entry.status = 'passed'; console.log(`PASS ${name}`); } catch (error) { entry.status = 'failed'; entry.error = String(error.stack ?? error); throw error; } };
const panel = id => `document.querySelector('[data-window="${id}"]')`;
const rect = id => `(() => { const r = ${panel(id)}.getBoundingClientRect(); return { x:r.x, y:r.y, width:r.width, height:r.height }; })()`;
const button = label => `[...document.querySelectorAll('button')].find(b => b.getAttribute('aria-label') === ${JSON.stringify(label)})`;
const launcher = `document.querySelector('[data-window-launcher]')`;
try {
  browser = await launch(app.url, { evidence });
  await browser.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await browser.until('launcher ready', `!!${launcher}`);
  const open = async title => { await browser.click(launcher); await browser.until('launcher list', `!!document.querySelector('[role=menuitem]')`); await browser.click(`[...document.querySelectorAll('[role=menuitem]')].find(b => b.textContent.startsWith(${JSON.stringify(title)}))`); await browser.until('window focus', `!!document.activeElement.closest('[data-window]')`); };
  const gesture = async (selector, dx, dy) => {
    const at = await browser.evaluate(`(() => { const r = ${selector}.getBoundingClientRect(); return {x:r.x + Math.min(30,r.width/2), y:r.y+r.height/2}; })()`);
    await browser.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: at.x, y: at.y, button: 'left', buttons: 1, clickCount: 1 });
    for (let i = 1; i <= 8; i++) await browser.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: at.x + dx*i/8, y: at.y + dy*i/8, button: 'left', buttons: 1 });
    await browser.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: at.x + dx, y: at.y + dy, button: 'left', buttons: 0, clickCount: 1 });
    await pause(120);
  };
  await step('desktop launcher uses native keyboard navigation and opens two windows with focus', async () => {
    await browser.click(launcher); await browser.screenshot('desktop-launcher.png');
    await browser.press('Escape'); await browser.evaluate(`${launcher}.focus()`); await browser.press('ArrowDown');
    await browser.until('keyboard menu focus', `document.activeElement.getAttribute('role') === 'menuitem'`);
    await browser.press('Enter'); await browser.until('Notes focused', `${panel('notes')}?.contains(document.activeElement)`);
    await open('Calculatrice'); await browser.screenshot('desktop-two-windows.png');
  });
  await step('drag Notes, click Calculatrice to raise it, and keep all three windows open', async () => {
    const before = await browser.evaluate(rect('notes'));
    await gesture(`${panel('notes')}.querySelector('[data-window-drag]')`, 90, 60);
    const after = await browser.evaluate(rect('notes')); assert.ok(Math.abs(after.x-before.x-90)<2); assert.ok(Math.abs(after.y-before.y-60)<2);
    await browser.click(`${panel('calculator')}.querySelector('[data-slot=card-title]')`);
    assert.ok(await browser.evaluate(`Number(${panel('calculator')}.style.zIndex) > Number(${panel('notes')}.style.zIndex)`));
    await browser.screenshot('desktop-raised.png'); await open('Planning'); await browser.screenshot('desktop-three-windows.png');
  });
  let remembered;
  await step('pointer and keyboard resize; stored rectangles and open windows survive reload', async () => {
    await browser.click(`${panel('notes')}.querySelector('[data-slot=card-title]')`);
    const before = await browser.evaluate(rect('notes'));
    await gesture(`${panel('notes')}.querySelector('[data-window-resize]')`, 100, 80);
    const after = await browser.evaluate(rect('notes')); assert.ok(Math.abs(after.width-before.width-100)<2); assert.ok(Math.abs(after.height-before.height-80)<2);
    await browser.click(button('Resize Notes')); await browser.press('ArrowRight');
    assert.ok(Math.abs((await browser.evaluate(rect('notes'))).width-after.width-24)<2);
    await browser.screenshot('desktop-resized.png');
    remembered = await browser.evaluate(`Object.fromEntries(['notes','calculator','planning'].map(id => [id, JSON.parse(localStorage.getItem('fictional.windows.'+id))]))`);
    await browser.reload(); await browser.until('all three restored', `document.querySelectorAll('[data-window][data-placement=floating]:not([hidden])').length === 3`);
    for (const id of Object.keys(remembered)) { const actual = await browser.evaluate(rect(id)); assert.deepEqual(actual, remembered[id].rect); }
    await browser.screenshot('desktop-restored.png');
  });
  await step('launcher focuses an open window, minimize restores it, Escape closes only the focused window', async () => {
    await browser.click(launcher); await browser.until('open state in launcher', `document.querySelectorAll('[role=menuitem][data-window-open=true]').length === 3`); await browser.screenshot('desktop-launcher-open-windows.png');
    await browser.click(`[...document.querySelectorAll('[role=menuitem]')].find(b => b.textContent.startsWith('Notes'))`);
    await browser.until('Notes focused', `${panel('notes')}.contains(document.activeElement)`);
    await browser.click(button('Minimize Notes')); await browser.until('Notes minimized', `${panel('notes')}.hidden`);
    await open('Notes'); await browser.press('Escape'); await browser.until('Notes closed', `${panel('notes')}.hidden`);
    assert.equal(await browser.evaluate(`${panel('calculator')}.hidden`), false); await open('Notes');
  });
  await step('phone 390: launcher list opens a full-screen window; returning to desktop preserves its geometry', async () => {
    await browser.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await browser.until('phone fullscreen', `!!document.querySelector('[data-placement=fullscreen][data-window=notes]')`);
    const actual = await browser.evaluate(rect('notes')); assert.deepEqual(actual, {x:0,y:0,width:390,height:844});
    await browser.screenshot('phone-fullscreen.png');
    await browser.click(button('Close Notes')); await browser.until('next phone window', `!!document.querySelector('[data-placement=fullscreen][data-window=calculator]') || !!document.querySelector('[data-placement=fullscreen][data-window=planning]')`);
    for (const title of ['Planning','Calculatrice']) { const control = button(`Close ${title}`); if (await browser.evaluate(`!!${control}`)) { await browser.click(control); await pause(550); } }
    await browser.until('phone launcher available', `!document.querySelector('[data-placement=fullscreen]')`);
    await browser.until('phone launcher focus restored', `document.activeElement === ${launcher}`);
    await browser.tap(launcher); await browser.until('phone launcher list', `document.querySelectorAll('[role=menuitem]').length === 3`); await browser.screenshot('phone-launcher.png');
    await browser.tap(`[...document.querySelectorAll('[role=menuitem]')].find(b => b.textContent.startsWith('Notes'))`);
    await browser.until('phone Notes', `!!document.querySelector('[data-placement=fullscreen][data-window=notes]')`);
    await browser.screenshot('phone-notes-opened.png');
    await browser.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await browser.until('desktop Notes', `!!document.querySelector('[data-placement=floating][data-window=notes]')`);
    assert.deepEqual(await browser.evaluate(rect('notes')), remembered.notes.rect);
  });
  await step('viewport resize re-clamps without overflow; browser has no errors or runtime kernel', async () => {
    await browser.send('Emulation.setDeviceMetricsOverride', { width: 700, height: 450, deviceScaleFactor: 1, mobile: false });
    await pause(150); const actual = await browser.evaluate(rect('notes')); assert.ok(actual.x >= 0 && actual.y >= 0 && actual.x+actual.width <=700 && actual.y+actual.height<=450);
    assert.equal(await browser.evaluate('document.documentElement.scrollWidth <= innerWidth'), true);
    assert.deepEqual(Object.keys(app.metafile.inputs).filter(path => /(?:pi-durable|packages\/agent|node:fs)/.test(path)), []);
    assert.deepEqual(browser.problems, []);
  });
} finally {
  if (browser) await browser.close(); await app.close(); writeFileSync(resolve(evidence, 'journey.json'), JSON.stringify(report, null, 2));
}
