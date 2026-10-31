// Public PM present regression: native tool -> regular artifact card/viewer, measured PM window, and Back.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { launch, pause, q } from '@hachej/boring-testing/browser';
import { startPmPanel } from './server.mjs';

const evidence = process.env.PM_EVIDENCE ?? '.cache/evidence/pm-one/present';
mkdirSync(evidence, { recursive: true });
let app;
const failures = [], records = [];
const cases = [{ name: 'wide', window: 1100, viewport: 1440, sheet: false }, { name: 'dock420', window: 420, viewport: 1440, sheet: true }, { name: 'phone390', window: 390, viewport: 390, sheet: true }].filter(item => !process.env.PRESENT_CASE || item.name === process.env.PRESENT_CASE);
let browser;
const check = (condition, message) => { if (!condition) failures.push(message); };
try {
  browser = await launch('about:blank', { evidence });
  for (const item of cases) {
    app = await startPmPanel({ oneLine: true });
    await browser.emulate(item.viewport === 390 ? 'phone' : 'desktop');
    await browser.send('Emulation.setDeviceMetricsOverride', { width: item.viewport, height: 900, deviceScaleFactor: 1, mobile: item.viewport === 390 });
    await browser.send('Page.navigate', { url: `${app.url}?agent=improve` });
    await browser.until('regular PM workspace', `!!${q('[data-testid=workspace-bar-new]')}`, 30000);
    await browser.click(q('[data-testid=workspace-bar-new]'));
    await pause(900);
    await browser.until('fresh PM composer', `!!${q('[data-testid=composer-input]')} && !${q('[data-testid=composer-input]')}.disabled`, 15000);
    await browser.evaluate(`(() => { const panel = ${q('[data-testid=pm-panel]')}; panel.style.width = '${item.window}px'; panel.style.flexBasis = '${item.window}px'; })()`);
    await browser.until('PM window measured', `Math.abs(${q('[data-testid=pm-panel]')}.getBoundingClientRect().width - ${item.window}) < 1`);
    await browser.type(q('[data-testid=composer-input]'), `Montrez-moi deux maquettes pour cette fenêtre fictive ${item.name}.`);
    await browser.click(q('[data-testid=composer-submit]'));
    await browser.until('native present cards', `document.querySelectorAll('[data-testid=artifact-card][data-state=ready]').length >= 2`, 30000);
    await browser.until('native PM choice settled', `!!${q('[data-testid=question-option]')}`, 30000);
    const automatic = await browser.evaluate(`!!${q('[data-testid=workspace-panel]')}`);
    check(automatic === !item.sheet, `${item.name}: auto-open must use PM window width, not ${item.viewport}px viewport (actual ${automatic})`);
    if (!automatic) await browser.click(q('[data-testid=artifact-card][data-state=ready]'));
    await browser.until('regular artifact viewer', `!!${q('[data-testid=workspace-panel]')} && ${q('[data-testid=artifact-body]')}?.dataset.state === 'open'`, 20000);
    await browser.until('the mock-up runs in its sandboxed frame, with its Close or Back', `!!${q('[data-testid=workspace-panel] iframe[sandbox]')} && !!${q('[data-testid=workspace-panel] [data-testid=artifact-close]')} && !${q('[data-testid=workspace-panel] [data-slot=spinner]')}`, 15000);
    await pause(400);
    const geometry = await browser.evaluate(`(() => {
      const workspace = ${q('[data-boring=artifact-workspace]')}, panel = ${q('[data-testid=workspace-panel]')}, chat = ${q('[data-testid=workspace-chat]')};
      const rect = node => { const r = node.getBoundingClientRect(); return { x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom }; };
      const back = panel.querySelector('[data-testid=artifact-close]');
      const arrow = [...(back?.querySelectorAll('.lucide-arrow-left') ?? [])].some(icon => getComputedStyle(icon).display !== 'none');
      const line = document.querySelector('[data-testid=pm-panel] > [data-slot=separator]');
      return { lineWidth: line?.getBoundingClientRect().width, window:rect(workspace), panel:rect(panel), chat:rect(chat), sheet:panel.dataset.sheet, position:getComputedStyle(panel).position, chatHidden:chat.hasAttribute('inert'), back:back?.getAttribute('aria-label'), arrow };
    })()`);
    records.push({ ...item, automatic, geometry });
    check(!(await browser.evaluate(`${q('[data-testid=workspace-panel]')}.innerText.includes('Preview omits')`)), `${item.name}: a presented mock-up runs in the sandboxed preview, never the stripped one`);
    await browser.screenshot(`${item.name}-present.png`);
    check(geometry.sheet === String(item.sheet), `${item.name}: expected sheet=${item.sheet}`);
    if (item.viewport !== 390) check(geometry.lineWidth >= 1, `${item.name}: a visible line separates the PM from the app`);
    if (item.sheet) {
      check(['x','y','width','height'].every(key => Math.abs(geometry.window[key] - geometry.panel[key]) < 1), `${item.name}: sheet must cover the PM window, under its bar (${JSON.stringify(geometry)})`);
      check(geometry.chatHidden, `${item.name}: viewer replaces chat`);
      check(await browser.evaluate(`(() => { const bar = ${q('[data-testid=workspace-bar-history]')}, panel = ${q('[data-testid=workspace-panel]')}; return !!bar && bar.getBoundingClientRect().bottom <= panel.getBoundingClientRect().top + 1; })()`), `${item.name}: the PM's bar stays above the viewer`);
      check(geometry.back === 'Retour à la discussion' && geometry.arrow, `${item.name}: sheet close is an accessible Back action at any viewport`);
    } else check(geometry.chat.right <= geometry.panel.x + 1 && !geometry.chatHidden && geometry.chat.width >= 360, `${item.name}: chat and present remain side by side`);
    writeFileSync(`${evidence}/geometry.json`, JSON.stringify({ records, failures }, null, 2));
    await browser.click(q('[data-testid=artifact-close]'));
    const returned = await browser.until('Back returns to PM chat', `!${q('[data-testid=workspace-panel]')} && !!${q('[data-testid=composer-input]')}?.checkVisibility({visibilityProperty:true})`, 3000).then(() => true, () => false);
    check(returned, `${item.name}: Back must return to chat inside the PM, not close the PM shell layer`);
    await browser.screenshot(`${item.name}-back.png`);
    check(await browser.evaluate(`!!${q('[data-testid=question-option]')}`), `${item.name}: original native question survives Back`);
    if (item.sheet && returned) {
      await browser.click(q('[data-testid=artifact-card][data-state=ready]'));
      await browser.until('sheet reopened', `!!${q('[data-testid=workspace-panel]')}`);
      await browser.evaluate('history.back()');
      const historyReturned = await browser.until('browser Back returns to PM chat', `!${q('[data-testid=workspace-panel]')} && !!${q('[data-testid=composer-input]')}?.checkVisibility({visibilityProperty:true})`, 3000).then(() => true, () => false);
      check(historyReturned, `${item.name}: browser Back closes only the artifact entry`);
    }
    await app.close(); app = undefined;
  }
  writeFileSync(`${evidence}/geometry.json`, JSON.stringify({ records, failures }, null, 2));
  assert.deepEqual(browser.problems, [], 'no browser exceptions');
  assert.deepEqual(failures, []);
  console.log('PASS: native present wide side-by-side, dock420 contained replacement/Back, and phone390 replacement/Back');
} finally { await browser?.close(); await app?.close(); }
