import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { launch, q } from '@hachej/boring-testing/browser';
import { startWorkspaceApp } from '../examples/workspace-app/server.mjs';
import { readDesignConfig } from './check-design.mjs';
import { auditDesign } from '../test/fixtures/themes/audit.mjs';

const evidence = process.env.DESIGN_EVIDENCE ?? '.cache/evidence/shadcn-first/group-5';
mkdirSync(evidence, { recursive: true });
const config = readDesignConfig();
const theme = JSON.parse(readFileSync(new URL('../registry.json', import.meta.url))).items.find(item => item.name === 'theme');
const options = { groups: config.groups, palette: Object.keys(theme.cssVars.light), radiusBindings: Object.fromEntries(Object.entries(theme.cssVars.theme).filter(([name]) => name.startsWith('radius-'))) };
const app = await startWorkspaceApp({ directory: mkdtempSync(join(tmpdir(), 'boring-transcript-design-')), scripted: true });
let browser;
const audits = [];
try {
  browser = await launch('about:blank', { evidence });
  const inspect = async name => {
    await browser.evaluate('document.activeElement?.blur()');
    await browser.evaluate('document.fonts.ready.then(() => new Promise(requestAnimationFrame)).then(() => new Promise(requestAnimationFrame)).then(() => Promise.all(document.getAnimations().filter(animation => Number.isFinite(animation.effect?.getComputedTiming().endTime)).map(animation => animation.finished.catch(() => {}))))');
    const audit = await browser.evaluate(`(${auditDesign.toString()})(${JSON.stringify(options)})`);
    audits.push({ name, ...audit });
    writeFileSync(join(evidence, `${name}.json`), JSON.stringify(audit, null, 2));
    assert.deepEqual(audit.groups.filter(group => group.id === '5').flatMap(group => group.violations), [], name);
    assert.deepEqual(audit.contrast.filter(pair => !pair.pass), [], name);
    const { cssContentSize } = await browser.send('Page.getLayoutMetrics');
    const screenshot = await browser.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: 0, y: 0, width: cssContentSize.width, height: cssContentSize.height, scale: 1 } });
    writeFileSync(join(evidence, `${name}.png`), Buffer.from(screenshot.data, 'base64'));
  };
  for (const brand of ['stock', 'brand']) for (const mode of ['light', 'dark']) for (const width of [1440, 390]) for (const surface of ['messages', 'activity', 'notices', 'queue']) {
    const name = `transcript-${brand}-${mode}-${width}-${surface}`;
    await browser.send('Emulation.setDeviceMetricsOverride', { width, height: width === 390 ? 844 : 950, deviceScaleFactor: 1, mobile: width === 390 });
    await browser.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: mode }, { name: 'prefers-reduced-motion', value: 'reduce' }] });
    const previous = await browser.evaluate('performance.timeOrigin');
    await browser.send('Page.navigate', { url: `${app.url}?controls=transcript-${surface}&theme=${brand}&mode=${mode}` });
    await browser.until(name, `performance.timeOrigin !== ${previous} && !!${q('[data-testid=group-five-controls]')} && document.readyState === 'complete'`, 30000);
    await inspect(name);
    if (surface === 'messages') {
      await browser.click(q('[data-testid=message-mention][data-path^="uploads/packing"]'));
      assert.equal(await browser.evaluate(`${q('[data-testid=group-five-event]')}.textContent`), 'uploads/packing-1234abcd.pdf');
      await browser.click(q('[data-testid=command-mention]'));
      assert.equal(await browser.evaluate(`${q('[data-testid=group-five-event]')}.textContent`), 'command activated');
      const mutant = await browser.evaluate(`(() => { const element = ${q('[data-slot=checkbox]')}; element.style.borderRadius = '37px'; const result = (${auditDesign.toString()})(${JSON.stringify(options)}); element.style.removeProperty('border-radius'); return result; })()`);
      assert.ok(mutant.groups.find(group => group.id === '1').violations.some(finding => finding.family === 'radius' && finding.actual === '37px'), 'native Checkbox geometry overrides are rejected');
    } else if (surface === 'activity') {
      await browser.evaluate(`document.querySelectorAll('[data-testid=activity][data-open=false] [data-slot=trace-collapsible-trigger]').forEach(button => button.click())`);
      await browser.until('activity expanded', `!document.querySelector('[data-testid=activity][data-open=false]')`, 5000);
      await browser.until('nested steps mounted', `!!${q('[data-testid=reasoning]')} && !!${q('[data-testid=tool-card][data-status=completed]')}`, 5000);
      await browser.evaluate(`document.querySelectorAll('[data-testid=reasoning] button, [data-testid=tool-card][data-status=completed] > button').forEach(button => button.click())`);
      await browser.until('reasoning and completed result expanded', `!!${q('[data-testid=reasoning-text]')} && !!${q('[data-testid=tool-card][data-status=completed] [data-testid=tool-details]')}`, 5000);
      await inspect(`${name}-expanded`);
    } else if (surface === 'notices') {
      await browser.click(q('[data-role=system] button'));
      await inspect(`${name}-system`);
    } else {
      await browser.click(q('[data-testid=queue-more]'));
      await browser.until('native queue menu', `!!${q('[data-testid=queue-menu]')}`, 5000);
      await inspect(`${name}-menu`);
      await browser.click(q('[data-testid=queue-edit]'));
      assert.equal(await browser.evaluate(`${q('[data-testid=group-five-event]')}.textContent`), 'edited 1');
      await browser.click(q('[data-testid=queue-cancel]'));
      await browser.until('withdraw refusal', `!!${q('[data-testid=queue-error]')}`, 5000);
      await inspect(`${name}-refused`);
    }
  }
  assert.deepEqual(browser.problems, []);
  writeFileSync(join(evidence, 'transcript-report.json'), JSON.stringify(audits, null, 2));
  console.log(`PASS group 5: ${audits.length} transcript captures, stock/brand, light/dark, 1440/390; native file, command and queue callbacks driven.`);
} finally { await browser?.close(); await app.close(); }
