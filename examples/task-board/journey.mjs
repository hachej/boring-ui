import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { launch, pause } from '@hachej/boring-testing/browser';
import { startTaskBoard } from './server.mjs';

const evidence = resolve('.cache/evidence/d417/task-board'); mkdirSync(evidence, { recursive: true });
const app = await startTaskBoard(); let browser;
const stage = `document.querySelector('[aria-label="Right stage"]')`;
const board = `${stage}.querySelector('[data-boring="task-board"]')`;
const card = id => `${board}.querySelector('[data-task-open="${id}"]')`;
const detail = `${board}.querySelector('[data-task-detail]')`;
const list = `${board}.querySelector('[data-task-list]')`;
const steps = [];
const step = async (name, run) => { await run(); steps.push(name); console.log(`PASS ${name}`); };
try {
  browser = await launch(app.url, { evidence });
  await browser.send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false });
  await browser.until('board ready', `!!${card('D-201')}`);
  await step('wide host has three rails, folded terminal columns and two own request rows', async () => {
    assert.equal(await browser.evaluate(`getComputedStyle(${board}.querySelector('[data-task-column="waiting"]').parentElement).gridTemplateColumns.split(' ').length`), 3);
    assert.equal(await browser.evaluate(`${board}.querySelector('[data-task-column="done"]').open`), false);
    assert.equal(await browser.evaluate(`document.querySelector('[data-variant=compact] [role=list]').children.length`), 2);
    await browser.screenshot('desktop-wide-light.png');
  });
  await step('keyboard opens task; wide detail is alongside board; choices use host callback; Back restores focus and browser history', async () => {
    await browser.evaluate(`${card('D-201')}.focus()`); await browser.press('Enter');
    await browser.until('detail mounted', `!!${detail}`);
    assert.equal(await browser.evaluate(`new URL(location.href).searchParams.get('task')`), 'D-201');
    assert.notEqual(await browser.evaluate(`getComputedStyle(${list}).display`), 'none');
    assert.equal(await browser.evaluate(`document.activeElement.textContent`), 'Back to tasks');
    await browser.screenshot('desktop-detail-light.png');
    await browser.click(`${detail}.querySelector('[data-task-question] button')`);
    await browser.until('host choice received', `document.querySelector('output').textContent.includes('river')`);
    await browser.press('Escape'); await browser.until('board returned', `!${detail}`);
    assert.equal(await browser.evaluate('document.activeElement.dataset.taskOpen'), 'D-201');
    await browser.evaluate('history.back()'); await browser.until('back restored detail', `!!${detail}`);
    await browser.evaluate('history.forward()'); await browser.until('forward restored board', `!${detail}`);
  });
  await step('host theme reaches cards and detail, without component dark overrides', async () => {
    await browser.evaluate(`document.documentElement.classList.add('dark')`); await pause(200);
    await browser.screenshot('desktop-wide-dark.png');
    await browser.click(card('D-201')); await browser.until('dark detail', `!!${detail}`);
    await browser.screenshot('desktop-detail-dark.png');
    await browser.press('Escape');
  });
  await step('a narrow right panel on the same desktop uses a list and in-place detail', async () => {
    await browser.evaluate(`document.documentElement.classList.remove('dark')`); await pause(200);
    await browser.click(`document.querySelector('[data-panel-width]')`);
    assert.equal(await browser.evaluate(`getComputedStyle(${board}.querySelector('[data-task-column="waiting"]').parentElement).gridTemplateColumns.split(' ').length`), 1);
    await browser.screenshot('desktop-narrow-light.png');
    await browser.click(card('D-201')); await browser.until('narrow detail', `!!${detail}`);
    assert.equal(await browser.evaluate(`getComputedStyle(${list}).display`), 'none');
    await browser.screenshot('desktop-narrow-detail.png');
    await browser.press('Escape');
    await browser.evaluate(`document.documentElement.classList.add('dark')`); await pause(200); await browser.screenshot('desktop-narrow-dark.png');
  });
  await step('375px phone has no horizontal overflow, in-place detail, accessible links and back', async () => {
    await browser.send('Emulation.setDeviceMetricsOverride', { width: 375, height: 812, deviceScaleFactor: 1, mobile: true });
    await browser.evaluate(`document.documentElement.classList.remove('dark'); ${stage}.scrollIntoView()`); await pause(200);
    await browser.screenshot('phone-light.png');
    assert.equal(await browser.evaluate('document.documentElement.scrollWidth <= innerWidth'), true);
    await browser.click(card('D-201')); await browser.until('phone detail', `!!${detail}`);
    assert.equal(await browser.evaluate(`getComputedStyle(${list}).display`), 'none');
    await browser.evaluate(`${stage}.scrollIntoView()`); await browser.screenshot('phone-detail-light.png');
    const snapshot = await browser.send('Accessibility.getFullAXTree');
    writeFileSync(resolve(evidence, 'phone-accessibility.json'), JSON.stringify(snapshot, null, 2));
    await browser.evaluate(`document.documentElement.classList.add('dark')`); await pause(200); await browser.screenshot('phone-detail-dark.png');
    await browser.press('Escape'); await browser.screenshot('phone-dark.png');
    assert.equal(await browser.evaluate('document.documentElement.scrollWidth <= innerWidth'), true);
  });
  assert.deepEqual(browser.problems, []);
} finally {
  writeFileSync(resolve(evidence, 'journey.json'), JSON.stringify({ steps, errors: browser?.problems ?? [] }, null, 2));
  await browser?.close(); await app.close();
}
