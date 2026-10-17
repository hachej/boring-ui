import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { launch, q } from '@hachej/boring-testing/browser';
import { startWorkspaceApp } from '../examples/workspace-app/server.mjs';
import { readDesignConfig } from './check-design.mjs';
import { auditDesign } from '../test/fixtures/themes/audit.mjs';

// Group 3 (inputs): the real registry Composer, its pickers and menus in every state, stock and brand, light and dark, 1440 and 390.
const evidence = process.env.DESIGN_EVIDENCE ?? '.cache/evidence/shadcn-first/group-3';
mkdirSync(evidence, { recursive: true });
const config = readDesignConfig();
const strict = config.groups.filter(group => group.mode === 'FAIL').map(group => group.id);
const theme = JSON.parse(readFileSync(new URL('../registry.json', import.meta.url))).items.find(item => item.name === 'theme');
const options = { groups: config.groups, palette: [...Object.keys(theme.cssVars.light), 'overlay'], radiusBindings: Object.fromEntries(Object.entries(theme.cssVars.theme).filter(([name]) => name.startsWith('radius-'))) };
const app = await startWorkspaceApp({ directory: mkdtempSync(join(tmpdir(), 'boring-composer-design-')), scripted: true });
const input = q('[data-testid=composer-input]');
let browser;
const audits = [];
try {
  browser = await launch('about:blank', { evidence });
  const inspect = async (name, width) => {
    await browser.evaluate('document.fonts.ready.then(() => new Promise(requestAnimationFrame)).then(() => new Promise(requestAnimationFrame)).then(() => Promise.all(document.getAnimations().filter(animation => Number.isFinite(animation.effect?.getComputedTiming().endTime)).map(animation => animation.finished.catch(() => {}))))');
    const audit = await browser.evaluate(`(${auditDesign.toString()})(${JSON.stringify(options)})`);
    audits.push({ name, ...audit });
    writeFileSync(join(evidence, `${name}.json`), JSON.stringify(audit, null, 2));
    assert.ok(audit.groups.find(group => group.id === '3').elements > 0, `${name}: group 3 is mounted`);
    assert.deepEqual(audit.groups.filter(group => strict.includes(group.id)).flatMap(group => group.violations), [], name);
    assert.deepEqual(audit.contrast.filter(pair => !pair.pass), [], name);
    if (width === 390) {
      assert.equal(await browser.evaluate(`getComputedStyle(${input}).fontSize`), '16px', `${name}: 16px text, no iOS zoom`);
      const small = await browser.evaluate(`[...document.querySelectorAll('[data-slot=button], [data-slot=toggle], [data-testid=slash-search], [data-testid=composer-input]')].filter(element => element.checkVisibility()).map(element => ({ id: element.dataset.testid ?? element.getAttribute('aria-label'), width: element.getBoundingClientRect().width, height: element.getBoundingClientRect().height })).filter(box => box.width < 43.9 || box.height < 43.9)`);
      assert.deepEqual(small, [], `${name}: 44px touch targets, including chip remove buttons`);
    }
    await browser.screenshot(`${name}.png`);
  };
  for (const brand of ['stock', 'brand']) for (const mode of ['light', 'dark']) for (const width of [1440, 390]) for (const surface of ['empty', 'text', 'chips', 'mention', 'slash', 'streaming']) {
    const name = `composer-${brand}-${mode}-${width}-${surface}`;
    await browser.send('Emulation.setDeviceMetricsOverride', { width, height: width === 390 ? 844 : 950, deviceScaleFactor: 1, mobile: width === 390 });
    await browser.send('Emulation.setTouchEmulationEnabled', { enabled: width === 390, maxTouchPoints: 5 });
    await browser.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: mode }, { name: 'prefers-reduced-motion', value: 'reduce' }] });
    const previous = await browser.evaluate('performance.timeOrigin');
    await browser.send('Page.navigate', { url: `${app.url}?controls=composer-${surface}&theme=${brand}&mode=${mode}` });
    await browser.until(name, `performance.timeOrigin !== ${previous} && !!${q('[data-testid=group-three-controls]')} && document.readyState === 'complete' && ${brand === 'brand' ? "getComputedStyle(document.documentElement).getPropertyValue('--border-width').trim() === '2px'" : 'true'}`, 30000);
    if (surface === 'mention') {
      await browser.type(input, 'Read @notes');
      await browser.until('mention picker', `${document_all('[data-testid=mention-item]')}.length === 2`, 5000);
      await inspect(name, width);
      await browser.press('ArrowDown');
      await browser.until('second row active', `${document_all('[data-testid=mention-item]')}[1].getAttribute('aria-selected') === 'true'`, 3000);
      await browser.press('Enter');
      await browser.until('mention inserted', `${input}.value === 'Read @notes/packing-list.md ' && !${q('[data-testid=mention-menu]')} && document.activeElement === ${input}`, 3000);
    } else if (surface === 'slash') {
      await browser.type(input, '/');
      await browser.until('slash picker', `${document_all('[data-testid=slash-item]')}.length === 4`, 5000);
      await inspect(name, width);
      await browser.click(`${document_all('[data-testid=slash-chip]')}.find(element => element.dataset.group === 'skills')`);
      await browser.until('skills only', `${document_all('[data-testid=slash-item]')}.length === 2`, 3000);
      await browser.press('Escape');
      await browser.until('Escape closes the picker', `!${q('[data-testid=slash-menu]')}`, 3000);
    } else if (surface === 'chips') {
      await inspect(name, width);
      await browser.click(`${q('[data-testid=upload-chip][data-state=uploading]')}.querySelector('button')`);
      await browser.until('long paste card removed', `!${q('[data-testid=upload-chip][data-state=uploading]')}`, 3000);
    } else if (surface === 'streaming') {
      await inspect(name, width);
      assert.equal(await browser.evaluate(`${q('[data-testid=composer-submit]')}.dataset.state`), 'stop');
      await browser.click(q('[data-testid=composer-submit]'));
      await browser.until('stop callback', `${q('[data-testid=group-three-event]')}.textContent === 'stopped'`, 3000);
    } else if (surface === 'text') {
      await inspect(name, width);
      await browser.click(q('[data-testid=composer-model]'));
      await browser.until('model menu', `!!${q('[data-testid=composer-model-menu]')}`, 3000);
      await inspect(`${name}-model-menu`, width);
      await browser.click(`${document_all('[data-testid=composer-effort-option]')}.find(element => element.dataset.value === 'high')`);
      await browser.until('effort changed', `${q('[data-testid=composer-model-label]')}.textContent.endsWith('High') && !${q('[data-testid=composer-model-menu]')}`, 3000);
      await browser.click(q('[data-testid=composer-submit]'));
      await browser.until('send callback', `${q('[data-testid=group-three-event]')}.textContent === 'sent'`, 3000);
    } else {
      await inspect(name, width);
      await browser.click(q('[data-testid=composer-plus]'));
      await browser.until('plus menu', `!!${q('[data-testid=composer-plus-menu]')} && !!${q('[data-testid=composer-attach]')}`, 3000);
      await inspect(`${name}-plus-menu`, width);
      await browser.click(q('[data-testid=composer-commands]'));
      await browser.until('commands open the slash picker with focus in the text', `${input}.value === '/' && !!${q('[data-testid=slash-menu]')} && document.activeElement === ${input}`, 3000);
    }
  }
  assert.deepEqual(browser.problems, []);
  writeFileSync(join(evidence, 'composer-report.json'), JSON.stringify(audits, null, 2));
  console.log(`PASS group 3: ${audits.length} composer captures, stock/brand, light/dark, 1440/390; send, stop, @, /, chips and model menu driven.`);
} finally { await browser?.close(); await app.close(); }

function document_all(selector) { return `[...document.querySelectorAll(${JSON.stringify(selector)})]`; }
