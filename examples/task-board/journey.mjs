import assert from 'node:assert/strict';
import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { launch, pause } from '@hachej/boring-testing/browser';
import { startTaskBoard } from './server.mjs';
import { readDesignConfig } from '../../scripts/check-design.mjs';
import { auditDesign } from '../../test/fixtures/themes/audit.mjs';

const evidence = resolve('.cache/evidence/task-board'); mkdirSync(evidence, { recursive: true });
const screenshots = resolve('.agent-handoff/task-board'); mkdirSync(screenshots, { recursive: true });
const report = { steps: [] }, app = await startTaskBoard(); let browser;
const step = async (name, run) => { const entry = { name }; report.steps.push(entry); try { await run(); entry.status = 'passed'; console.log(`PASS ${name}`); } catch (error) { entry.status = 'failed'; entry.error = String(error.stack ?? error); throw error; } };
const board = "document.querySelector('[data-boring=task-board]')";
const group = state => `document.querySelector('[data-task-state="${state}"]')`;
const button = label => `[...document.querySelectorAll('button')].find(b => b.getAttribute('aria-label') === ${JSON.stringify(label)} || b.textContent === ${JSON.stringify(label)})`;
const card = id => `document.querySelector('[data-task-id="${id}"]')`;
const theme = JSON.parse(readFileSync(new URL('../../registry.json', import.meta.url))).items.find(item => item.name === 'theme');
const auditOptions = { groups: readDesignConfig().groups, palette: Object.keys(theme.cssVars.light), radiusBindings: Object.fromEntries(Object.entries(theme.cssVars.theme).filter(([name]) => name.startsWith('radius-'))) };
const shot = async name => {
  await pause(500);
  await browser.evaluate('document.fonts.ready.then(() => new Promise(requestAnimationFrame)).then(() => new Promise(requestAnimationFrame)).then(() => Promise.all(document.getAnimations().filter(animation => Number.isFinite(animation.effect?.getComputedTiming().endTime)).map(animation => animation.finished.catch(() => {}))))');
  const audit = await browser.evaluate(`(${auditDesign.toString()})(${JSON.stringify(auditOptions)})`);
  writeFileSync(resolve(evidence, name.replace(/\.png$/, '.design.json')), JSON.stringify(audit, null, 2));
  assert.deepEqual(audit.groups.flatMap(group => group.violations), [], `${name}: stock shadcn geometry and tokens`);
  assert.deepEqual(audit.contrast.filter(pair => !pair.pass), [], `${name}: theme contrast`);
  await browser.screenshot(name); cpSync(resolve(evidence, name), resolve(screenshots, name));
};
const noOverflow = async () => assert.equal(await browser.evaluate('document.documentElement.scrollWidth <= innerWidth'), true);
try {
  browser = await launch(app.url, { evidence });
  await browser.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await browser.until('board', `!!${board}`);
  await step('desktop kanban: five ordered groups, viewer-first questions, dense native surfaces and collapsed rails', async () => {
    assert.equal(await browser.evaluate(`${board}.dataset.layout`), 'kanban');
    assert.deepEqual(await browser.evaluate(`[...document.querySelectorAll('[data-task-state]')].map(e=>e.dataset.taskState)`), ['open', 'working', 'waiting', 'done', 'closed']);
    assert.deepEqual(await browser.evaluate(`[...${group('waiting')}.querySelectorAll('[data-task-entry]')].map(e=>e.dataset.taskEntry)`), ['D-117', 'D-114', 'D-112', 'D-110']);
    assert.match(await browser.evaluate(`${group('waiting')}.textContent`), /2 on you/);
    for (const state of ['open', 'working', 'waiting']) { const width = await browser.evaluate(`${group(state)}.getBoundingClientRect().width`); assert.ok(width >= 260 && width <= 340); }
    for (const state of ['done', 'closed']) assert.ok(await browser.evaluate(`${group(state)}.getBoundingClientRect().width < 100`));
    await noOverflow(); await shot('desktop-kanban.png');
  });
  await step('narrow desktop uses the host horizontal snap viewport without document overflow', async () => {
    await browser.send('Emulation.setDeviceMetricsOverride', { width: 900, height: 1000, deviceScaleFactor: 1, mobile: false });
    const viewport = `${board}.querySelector('[data-slot=scroll-area-viewport]')`;
    assert.match(await browser.evaluate(`getComputedStyle(${viewport}).scrollSnapType`), /^x(?: proximity)?$/);
    assert.equal(await browser.evaluate(`${viewport}.scrollWidth > ${viewport}.clientWidth`), true);
    await browser.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: 500, y: 200, deltaX: 400, deltaY: 0 });
    await browser.until('horizontal scrolling', `${viewport}.scrollLeft > 0`);
    await noOverflow();
    await browser.evaluate(`${viewport}.scrollLeft = 0`);
    await browser.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  });
  await step('short desktop viewport scrolls columns without moving their sticky headers', async () => {
    await browser.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 420, deviceScaleFactor: 1, mobile: false });
    const scrollable = await browser.evaluate(`${group('waiting')}.scrollHeight > ${group('waiting')}.clientHeight`);
    assert.equal(scrollable, true, 'long columns must scroll independently');
    const before = await browser.evaluate(`${group('waiting')}.querySelector('button').getBoundingClientRect().top`);
    await browser.evaluate(`${group('waiting')}.scrollTop = 120`); await pause(100);
    assert.ok(await browser.evaluate(`${group('waiting')}.scrollTop > 0`));
    const after = await browser.evaluate(`${group('waiting')}.querySelector('button').getBoundingClientRect().top`);
    assert.ok(Math.abs(after - before) < 1, 'state header stays visible while cards scroll');
    await browser.evaluate(`${group('waiting')}.scrollTop = 0`);
    await browser.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  });
  await step('keyboard Enter opens host Sheet with full question, kit Markdown and history; Escape returns focus', async () => {
    await browser.evaluate(`${card('D-117')}.focus()`); await browser.press('Enter');
    await browser.until('detail panel', "!!document.querySelector('[data-boring=task-detail]')");
    assert.equal(await browser.evaluate("document.querySelector('[data-boring=task-detail] strong').textContent"), '24 places');
    assert.match(await browser.evaluate("document.querySelector('[data-boring=task-detail]').textContent"), /Friday 6 November.*Camille needs the date/);
    assert.equal(await browser.evaluate("document.querySelectorAll('[data-boring=task-detail] li').length >= 3"), true);
    assert.equal(await browser.evaluate("document.querySelector('[data-boring=task-detail] img, [data-boring=task-detail] script') === null"), true);
    await shot('desktop-detail.png'); await browser.press('Escape'); await browser.until('detail closed', "!document.querySelector('[data-boring=task-detail]')");
    await browser.until('card focus restored', `document.activeElement === ${card('D-117')}`);
  });
  await step('filters and search are driven controls with filtered group counts', async () => {
    await browser.click(button('Waiting on me')); await browser.until('viewer filter', "document.querySelectorAll('[data-task-entry]').length === 2");
    await browser.click(button('High risk')); await browser.until('risk filter', "document.querySelectorAll('[data-task-entry]').length === 1");
    await browser.click(button('Mine')); await browser.until('combined empty', "document.body.textContent.includes('No tasks match your filters.')");
    for (const label of ['Mine', 'High risk', 'Waiting on me']) await browser.click(button(label));
    await browser.type("document.querySelector('input[type=search]')", 'D-119'); await browser.until('id search', "document.querySelectorAll('[data-task-entry]').length === 1");
    assert.equal(await browser.evaluate("document.querySelector('[data-task-entry]').dataset.taskEntry"), 'D-119');
    await browser.evaluate("(() => { const input=document.querySelector('input'); const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;set.call(input,'');input.dispatchEvent(new Event('input',{bubbles:true})); })()");
    await browser.until('search cleared', "document.querySelectorAll('[data-task-entry]').length === 10");
  });
  await step('desktop sections preserve expanded choices and show folded terminal counts', async () => {
    await browser.click(`[...${group('done')}.querySelectorAll('span')].find(element => element.textContent === 'Done')`); await browser.until('done expanded', `!!${card('D-108')}`);
    await browser.click(button('Sections')); await browser.until('sections', `${board}.dataset.layout === 'sections'`);
    assert.equal(await browser.evaluate(`${group('done')}.querySelector('button').getAttribute('aria-expanded')`), 'true');
    await browser.click(`${group('done')}.querySelector('button')`); await browser.until('done folded', `${group('done')}.querySelector('button').getAttribute('aria-expanded') === 'false'`);
    assert.match(await browser.evaluate(`${group('done')}.textContent`), /Show 1 done/);
    await browser.evaluate('scrollTo(0,0)'); await browser.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1600, deviceScaleFactor: 1, mobile: false }); await noOverflow(); await shot('desktop-sections.png');
  });
  await step('sections headers stick to the page while the section scrolls', async () => {
    await browser.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 700, deviceScaleFactor: 1, mobile: false });
    const header = `${group('open')}.firstElementChild`;
    await browser.evaluate(`scrollTo(0, ${group('open')}.getBoundingClientRect().top + scrollY + 30)`);
    await pause(150);
    assert.ok(Math.abs(await browser.evaluate(`${header}.getBoundingClientRect().top`)) < 1, 'section header stays at the page top');
    await browser.evaluate('scrollTo(0,0)');
  });
  await step('dark mode uses host tokens for the same board and detail', async () => {
    await browser.click(button('Kanban')); await browser.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
    await browser.click(button('Use dark theme')); assert.equal(await browser.evaluate("document.documentElement.classList.contains('dark')"), true); await shot('desktop-kanban-dark.png');
    await browser.click(card('D-117')); await browser.until('dark detail', "!!document.querySelector('[data-boring=task-detail]')"); await shot('desktop-detail-dark.png');
    await browser.press('Escape'); await browser.until('Sheet overlay removed', "!document.querySelector('[data-slot=sheet-overlay]')"); await browser.click(button('Use light theme'));
    await browser.until('light theme restored', "!document.documentElement.classList.contains('dark')");
  });
  await step('390px requested kanban becomes sections, with no layout toggle or horizontal overflow', async () => {
    await browser.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await browser.until('phone sections', `${board}.dataset.layout === 'sections'`);
    assert.equal(await browser.evaluate(`${board}.dataset.preferredLayout`), 'kanban');
    assert.equal(await browser.evaluate(`!!${button('Kanban')}`), false); await browser.evaluate('scrollTo(0,0)'); await noOverflow();
    const smallTargets = await browser.evaluate(`[...${board}.querySelectorAll('button, input, [role=button]')].filter(element => element.checkVisibility()).map(element => ({ label: element.getAttribute('aria-label') ?? element.textContent, height: element.getBoundingClientRect().height })).filter(target => target.height < 43.9)`);
    assert.deepEqual(smallTargets, [], 'phone controls keep 44px touch targets');
    await shot('phone390-requested-kanban.png');
    await browser.evaluate(`${group('waiting')}.scrollIntoView({ block: 'start' })`); await shot('phone390-waiting.png');
    await browser.click(card('D-117')); await browser.until('phone detail', "!!document.querySelector('[data-boring=task-detail]')"); await noOverflow(); await shot('phone390-detail.png'); await browser.press('Escape');
  });
  await step('390px requested sections also renders sections; returning wide restores preference and collapse state', async () => {
    await browser.send('Page.navigate', { url: `${app.url}?layout=sections` }); await browser.until('requested sections', `${board}?.dataset.preferredLayout === 'sections'`);
    await noOverflow(); await shot('phone390-requested-sections.png');
    await browser.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
    await browser.until('wide sections', `${board}.dataset.layout === 'sections' && !!${button('Kanban')}`);
    await browser.click(button('Kanban')); await browser.click(`${group('done')}.querySelector('button')`);
    await browser.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true }); await browser.until('phone again', `${board}.dataset.layout === 'sections'`);
    await browser.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false }); await browser.until('preferred kanban restored', `${board}.dataset.layout === 'kanban'`);
    assert.equal(await browser.evaluate(`${group('done')}.querySelector('button').getAttribute('aria-expanded')`), 'true');
  });
  await step('reduced-motion composition adds no animation; bundle is browser-only and console clean', async () => {
    await browser.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    assert.equal(await browser.evaluate("matchMedia('(prefers-reduced-motion: reduce)').matches"), true);
    assert.equal(await browser.evaluate(`${card('D-117')}.getAnimations().length`), 0);
    assert.deepEqual(Object.keys(app.metafile.inputs).filter(path => /(?:pi-durable|packages\/agent|node:fs)/.test(path)), []);
    assert.deepEqual(browser.problems, []);
  });
} finally {
  if (browser) await browser.close(); await app.close(); writeFileSync(resolve(evidence, 'journey.json'), JSON.stringify(report, null, 2) + '\n');
}
