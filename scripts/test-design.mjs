import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch, q } from '@hachej/boring-testing/browser';
import { readDesignConfig, designRoot } from './check-design.mjs';
import { auditDesign } from '../test/fixtures/themes/audit.mjs';

export function designFailures(audits, config) {
  const failures = [];
  for (const audit of audits) {
    for (const pair of audit.contrast) if (!pair.pass) failures.push(`${audit.surface}: ${pair.foreground}/${pair.background} contrast ${pair.ratio.toFixed(2)} < 4.5`);
    for (const group of audit.groups) if (config.groups.find(entry => entry.id === group.id)?.mode === 'FAIL' && group.violations.length) failures.push(`${audit.surface}: group ${group.id}: ${group.violations.length} computed-style violations`);
  }
  for (const group of config.groups.filter(group => group.mode === 'FAIL')) {
    for (const theme of ['stock', 'brand']) for (const mode of ['light', 'dark']) for (const width of [1440, 390]) {
      if (!audits.some(audit => audit.theme === theme && audit.mode === mode && audit.width === width && audit.groups.some(result => result.id === group.id && result.elements > 0 && result.checks > 0))) failures.push(`group ${group.id}: no coverage for ${theme}/${mode}/${width}`);
    }
  }
  return failures;
}

export async function testDesign({ evidence = process.env.DESIGN_EVIDENCE } = {}) {
  const config = readDesignConfig(), audits = [];
  evidence ??= config.evidenceDirectory ?? '.cache/evidence/shadcn-first/group-0';
  const theme = JSON.parse(readFileSync(join(designRoot, 'registry.json'), 'utf8')).items.find(item => item.name === 'theme');
  const options = { groups: config.groups, palette: [...new Set([...Object.keys(theme.cssVars.light), 'overlay', 'sidebar', 'sidebar-foreground', 'sidebar-primary', 'sidebar-primary-foreground', 'sidebar-accent', 'sidebar-accent-foreground'])], radiusBindings: Object.fromEntries(Object.entries(theme.cssVars.theme).filter(([name]) => name.startsWith('radius-'))) };
  mkdirSync(evidence, { recursive: true });
  // Import and start one app at a time. All data and model responses are fictional.
  const { startWorkspaceApp } = await import('../examples/workspace-app/server.mjs');
  const { startWorkspaceDemo } = await import('../demos/workspace/server.mjs');
  const { misses } = await import('../lab/studio/scripted-model.mjs');
  const input = q('[data-testid=composer-input]');
  for (const [name, start, prompt] of [['standalone', startWorkspaceApp, 'Write a picnic plan and present it.'], ['workspace', startWorkspaceDemo, 'what needs my approval this week']]) {
    const app = await start({ directory: mkdtempSync(join(tmpdir(), 'boring-design-app-')), scripted: true });
    let browser;
    try {
      browser = await launch('about:blank', { evidence });
      const inspect = async (surface, params) => {
        await browser.evaluate(`Promise.all(document.getAnimations().filter(animation => Number.isFinite(animation.effect?.getComputedTiming().endTime)).map(animation => animation.finished.catch(() => {})))`);
        if (params.width === 390) {
          const small = await browser.evaluate(`[...document.querySelectorAll('[data-slot=button], [data-slot=toggle], [class~="group/button"], [class~="group/toggle"]')].filter(element => element.checkVisibility() && element.closest('.pi-chat, .boring-viewer, .app-shell, [data-boring], [role=dialog]')).map(element => ({ id: element.dataset.testid ?? element.getAttribute('aria-label'), width: element.getBoundingClientRect().width, height: element.getBoundingClientRect().height })).filter(box => box.width < 43.9 || box.height < 43.9)`);
          assert.deepEqual(small, [], `${surface}: native button/toggle touch targets must be at least 44px`);
        }
        const result = await browser.evaluate(`(${auditDesign.toString()})(${JSON.stringify(options)})`);
        assert.ok(result.groups.reduce((sum, group) => sum + group.checks, 0) > 20, 'audit must inspect real mounted blocks');
        audits.push({ app: name, surface, ...params, ...result });
        await browser.screenshot(`${surface}.png`);
        writeFileSync(join(evidence, `${surface}.json`), JSON.stringify(audits.at(-1), null, 2));
      };
      const visit = async (params, url, ready) => {
        const { width, mode, theme } = params;
        await browser.send('Emulation.setDeviceMetricsOverride', { width, height: width === 390 ? 844 : 950, deviceScaleFactor: 1, mobile: width === 390 });
        await browser.send('Emulation.setTouchEmulationEnabled', { enabled: width === 390, maxTouchPoints: 5 });
        await browser.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: mode }, { name: 'prefers-reduced-motion', value: 'reduce' }] });
        const previousDocument = await browser.evaluate('performance.timeOrigin');
        await browser.send('Page.navigate', { url });
        await browser.until(`${name}-${theme}-${mode}-${width}: new document and mounted controls`, `performance.timeOrigin !== ${previousDocument} && document.readyState === 'complete' && (${ready}) && document.documentElement.classList.contains('dark') === ${mode === 'dark'} && ${theme === 'brand' ? "getComputedStyle(document.documentElement).getPropertyValue('--border-width').trim() === '2px'" : 'true'}`, 30000);
        assert.equal(await browser.evaluate('innerWidth'), width, 'the audit uses the requested CSS viewport, not a shrink-to-fit page');
        assert.equal(await browser.evaluate('visualViewport.scale'), 1, 'the audit never zooms the page to fit');
      };
      let prepared = false;
      for (const themeName of ['stock', 'brand']) for (const mode of ['light', 'dark']) for (const width of [1440, 390]) {
        const params = { theme: themeName, mode, width };
        const prefix = `${name}-${themeName}-${mode}-${width}`;
        await visit(params, `${app.url}?theme=${themeName}&mode=${mode}`, `!!${input} && !${input}.disabled`);
        await inspect(`${prefix}-chat`, params);
        if (!prepared) {
          await browser.type(input, prompt);
          await browser.click(q('[data-testid=composer-submit]'));
          await browser.until('scripted response', `${q('[data-testid=composer-submit]')}?.dataset.state === 'send' && !!${q('[data-testid=transcript] article[data-role=assistant]')}`, 30000);
          prepared = true;
        }
        if (name === 'standalone') {
          // Open an actual editable document and its real portalled menu, in both viewport sizes.
          await browser.until('artifact card', `!!${q('[data-testid=artifact-card][data-state=ready]')}`, 20000);
          await browser.click(q('[data-testid=artifact-card][data-state=ready]'));
          await browser.until('viewer bar', `!!${q('[data-testid=artifact-panel] [data-testid$="-more"]')}`, 20000);
          await inspect(`${prefix}-viewer`, params);
          await browser.click(q('[data-testid=artifact-panel] [data-testid$="-more"]'));
          await browser.until('viewer menu', `!!${q('[role=menu]')}`, 5000);
          await inspect(`${prefix}-menu`, params);
          await browser.press('Escape');
          await browser.press('Escape');
          // The sessions drawer is a separate real surface on phones.
          if (width === 390) {
            await browser.click(q('[data-testid=sessions-toggle]'));
            await browser.until('sessions drawer', `${q('[data-testid=conversations]')}?.dataset.drawer === 'true'`, 5000);
            await inspect(`${prefix}-sessions`, params);
            await browser.press('Escape');
          }
        } else {
          // History and Library popovers are mounted by the workspace host in every placement.
          for (const panel of ['library', 'history']) {
            await browser.click(q(`[data-testid=chat-action-${panel}]`));
            await browser.until(`${panel} surface`, `!!${q(panel === 'library' ? '[data-testid=library-popover]' : '[data-testid=conversations]')}`, 5000);
            await inspect(`${prefix}-${panel}`, params);
            await browser.press('Escape');
          }
        }
        // Prove the audit rejects bad values on a REAL block control, independently of REPORT mode.
        const mutant = await browser.evaluate(`(() => { const element = ${input}; const old = element.style.cssText; element.style.cssText += ';border:7px solid red!important;border-radius:37px!important;box-shadow:rgb(255,0,0) 13px 17px 19px 0!important;font-family:serif!important;color:rgb(255,0,0)!important;background:rgb(255,0,0)!important'; const result = (${auditDesign.toString()})(${JSON.stringify(options)}); element.style.cssText = old; return result; })()`);
        const findings = mutant.groups.flatMap(group => group.violations).filter(finding => finding.target === 'textarea[data-testid=composer-input]');
        for (const [family, actual] of [['border-width', '7px'], ['radius', '37px'], ['shadow', '13px 17px 19px'], ['font', 'serif'], ['text-color', 'rgb(255, 0, 0)'], ['background-color', 'rgb(255, 0, 0)']]) assert.ok(findings.some(finding => finding.family === family && finding.actual.includes(actual)), `${prefix}: audit did not detect ${family} mutation on the actual composer`);
        const badButton = await browser.evaluate(`(async () => { const element = ${q('[data-testid=composer-submit]')}; const old = element.style.cssText; element.style.cssText += ';border:7px solid red!important;border-radius:37px!important;box-shadow:rgb(255,0,0) 13px 17px 19px 0!important'; getComputedStyle(element).borderTopWidth; await new Promise(requestAnimationFrame); for (const animation of element.getAnimations()) if (Number.isFinite(animation.effect?.getComputedTiming().endTime)) animation.finish(); const subject = { style: element.style.cssText, border: getComputedStyle(element).borderTopWidth }; const result = (${auditDesign.toString()})(${JSON.stringify(options)}); element.style.cssText = old; return { ...result, subject }; })()`);
        writeFileSync(join(evidence, `${prefix}-button-mutation.json`), JSON.stringify(badButton, null, 2));
        for (const family of ['border-width', 'radius', 'shadow']) assert.ok(badButton.groups.find(group => group.id === '1').violations.some(finding => finding.target === 'button[data-testid=composer-submit]' && finding.family === family), `${prefix}: native Button ${family} mutation must fail group 1`);
      }
      if (name === 'standalone') for (const theme of ['stock', 'brand']) for (const mode of ['light', 'dark']) for (const width of [1440, 390]) for (const surface of ['choices', 'notification', 'provider', 'toggles']) {
        const params = { theme, mode, width }, prefix = `${name}-${theme}-${mode}-${width}-${surface}`;
        await visit(params, `${app.url}?controls=${surface}&theme=${theme}&mode=${mode}`, `!!${q('[data-testid=group-one-controls]')}`);
        await inspect(prefix, params);
        if (surface === 'choices') {
          const bounds = await browser.evaluate('[...document.querySelectorAll("[data-testid=question-option], [data-testid=suggestion]")].map(button => ({ width: button.clientWidth, scroll: button.scrollWidth, height: button.clientHeight, content: button.scrollHeight }))');
          assert.ok(bounds.length >= 4 && bounds.every(box => box.scroll <= box.width + 1 && box.content <= box.height + 1), `${prefix}: multiline choices must fit their activation boxes`);
          const aligns = await browser.evaluate('[...document.querySelectorAll("[data-testid=question-text], [data-testid=question-option]")].map(element => getComputedStyle(element).textAlign)');
          assert.ok(aligns.length >= 3 && aligns.every(align => align === 'start' || align === 'left'), `${prefix}: question card content must be start-aligned, got ${aligns}`);
          await browser.click(q('[data-testid=question-option]'));
          await browser.until('fictional question callback', `${q('[data-testid=question-card]')}.dataset.state === 'sent'`);
        } else if (surface === 'notification') {
          const box = await browser.evaluate(`(() => { const button = ${q('[data-testid=agent-toast-open]')}; return { height: button.clientHeight, content: button.scrollHeight }; })()`);
          assert.ok(box.content <= box.height + 1, `${prefix}: notification text must fit its activation box`);
          await browser.click(q('[data-testid=agent-toast-open]'));
          await browser.until('notification callback', `${q('[data-testid=group-one-event]')}.textContent === 'notification opened'`);
        } else if (surface === 'provider') {
          await browser.click(q('[data-testid=provider-save]'));
          await browser.until('provider callback', `${q('[data-testid=group-one-event]')}.textContent === 'provider saved'`);
        } else {
          if (width === 390) assert.ok(await browser.evaluate(`${q('[data-testid=account-theme]')}.parentElement.querySelector('label').getBoundingClientRect().height >= 44`), 'Switch keeps its stock track and a 44px associated label target');
          await browser.click(q('[data-testid=fixture-pin]'));
          await browser.click(q('[data-testid=account-theme]'));
          assert.equal(await browser.evaluate(`${q('[data-testid=fixture-pin]')}.getAttribute('aria-pressed')`), 'true');
          assert.equal(await browser.evaluate(`${q('[data-testid=account-theme]')}.getAttribute('aria-checked')`), 'true');
          assert.equal(await browser.evaluate(`${q('[data-testid=group-one-event]')}.textContent`), '1', 'one pointer click changes the theme once');
          await inspect(`${prefix}-pressed`, params);
        }
      }
      assert.deepEqual(browser.problems, [], 'no browser console errors');
    } finally { if (browser) await browser.close(); await app.close(); }
  }
  writeFileSync(join(evidence, 'report.json'), JSON.stringify(audits, null, 2));
  const lines = ['BORING-UI-1 browser audit (REPORT is migration debt, not conformance)'];
  for (const group of config.groups) {
    const samples = audits.flatMap(audit => audit.groups.filter(result => result.id === group.id));
    lines.push(`${samples.some(sample => sample.elements) ? group.mode : 'UNCOVERED'} group ${group.id} ${group.name}: ${samples.reduce((sum, sample) => sum + sample.violations.length, 0)} violation(s), ${samples.reduce((sum, sample) => sum + sample.elements, 0)} element sample(s)`);
  }
  lines.push(`WCAG AA: ${audits.length * 7} role-pair checks; evidence: ${evidence}`);
  const report = lines.join('\n');
  console.log(report); writeFileSync(join(evidence, 'report.txt'), report + '\n');
  assert.deepEqual(misses, [], 'every fixture prompt must have a scripted answer');
  assert.deepEqual(designFailures(audits, config), []);
  return audits;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await testDesign();
