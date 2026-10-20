// Fictional workshop records through the real workspace, native write/present tools and ArtifactPanel. No model key.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { insecureUrl, launch, pause, q, qa } from '@hachej/boring-testing/browser';

process.env.STUDIO_MODEL = 'scripted';
const { startWorkspaceApp } = await import('./server.mjs');
const { misses } = await import('../../lab/studio/scripted-model.mjs');
const evidence = process.env.APP_EVIDENCE ?? '.cache/evidence/D77';
mkdirSync(evidence, { recursive: true });
const app = await startWorkspaceApp({ directory: mkdtempSync(join(tmpdir(), 'boring-records-')) });
const step = async (name, run) => { await run(); console.log(`ok ${name}`); };
const input = q('[data-testid=composer-input]');
const viewer = q('[data-boring=records-viewer]');
const noOverflow = 'document.documentElement.scrollWidth <= innerWidth && document.body.scrollWidth <= innerWidth';
let browser;
const buttonStates = [];
try {
  browser = await launch(insecureUrl(app.url), { evidence });
  const shoot = async name => {
    for (const value of ['light', 'dark']) {
      await browser.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value }] });
      await pause(250);
      if (name.startsWith('phone-records')) {
        const state = await browser.evaluate(`(() => { const button = ${q('[data-boring=record-list] button')}; const style = getComputedStyle(button); return { disabled: button.disabled, opacity: style.opacity, color: style.color, foreground: getComputedStyle(document.body).color, background: style.backgroundColor, outline: button.classList.contains('bg-background') && button.classList.contains('dark:bg-input/30') }; })()`);
        assert.equal(state.disabled, name.endsWith('-en'));
        assert.equal(state.opacity, state.disabled ? '0.5' : '1');
        assert.ok(state.outline, 'the host shadcn outline variant supplies the background tokens');
        assert.equal(state.color, state.foreground, 'outline text inherits the normal foreground');
        buttonStates.push({ screenshot: `${name}-${value}.png`, ...state });
      }
      await browser.screenshot(`${name}-${value}.png`);
    }
    await browser.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] });
  };
  const desktop = async () => { await browser.emulate('desktop'); await browser.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false }); await pause(300); };
  const open = async () => {
    if (!await browser.evaluate(`!!${viewer}`)) await browser.tap(qa('[data-testid=artifact-card][data-state=ready]') + '.at(-1)');
    await browser.until('records viewer', `!!${viewer}`, 10000);
  };
  await browser.until('chat ready', `!!${input} && !${input}.disabled`, 20000);
  await desktop();
  await step('desktop: default kind groups 30 rows and shows the app statuses', async () => {
    await browser.type(input, 'Make the workshop stock and present it.'); await browser.press('Enter');
    await browser.until('records presented', `!!${viewer}`, 30000);
    assert.equal(await browser.evaluate(`${q('[data-testid=artifact-panel-type]')}.textContent`), 'Records');
    assert.equal(await browser.evaluate(`${qa('[data-boring=record-table] [data-record-row]')}.length`), 30);
    assert.deepEqual(await browser.evaluate(`${qa('[data-record-group]')}.map(e => e.textContent)`), ['Rayon: Bois', 'Rayon: Métal', 'Rayon: Finition']);
    assert.deepEqual(await browser.evaluate(`${qa('[data-boring=record-table] thead th')}.map(e => e.textContent)`), ['Article', 'Quantité', 'Vérifié', 'État', 'Actions']);
    assert.ok(await browser.evaluate(`${qa('[data-record-row]')}.every(e => !/Bois|Métal|Finition/.test(e.textContent))`));
    assert.deepEqual(await browser.evaluate(`[...new Set(${qa('[data-boring=record-table] [data-record-status]')}.map(e => e.dataset.recordStatus))]`), ['ok', 'warn', 'error']);
    assert.ok(await browser.evaluate(noOverflow)); await shoot('desktop-records-en');
  });
  await step('phone: RecordList retains every field, group, row and action without overflow', async () => {
    await browser.emulate('phone'); await pause(400); await open();
    assert.equal(await browser.evaluate(`${q('[data-boring=record-table]')}.checkVisibility()`), false);
    assert.equal(await browser.evaluate(`${qa('[data-boring=record-list] [data-record-item]')}.length`), 30);
    assert.match(await browser.evaluate(`${q('[data-boring=record-list] [data-record-item]')}.textContent`), /Article 01.*Quantité: 1,234.5.*Vérifié: Oct 1, 2026.*Disponible/s);
    assert.ok(await browser.evaluate(`${qa('[data-record-item]')}.every(e => !/Rayon:|État:/.test(e.textContent))`));
    assert.equal(await browser.evaluate(`${q('[data-boring=record-list] [data-record-status]')}.getAttribute('aria-label')`), 'État: Disponible');
    assert.equal(await browser.evaluate(`${qa('[data-record-list-group]')}.length`), 3);
    assert.ok(await browser.evaluate(noOverflow)); await shoot('phone-records-en');
    await browser.send('Emulation.setDeviceMetricsOverride', { width: 360, height: 780, deviceScaleFactor: 2, mobile: true });
    await pause(300); assert.ok(await browser.evaluate(noOverflow));
  });
  await step('French host kind: Commander invokes the row action on desktop and phone', async () => {
    const previous = await browser.evaluate('performance.timeOrigin');
    await browser.send('Page.navigate', { url: `${insecureUrl(app.url)}?records=fr` });
    await browser.until('chat ready in French fixture', `performance.timeOrigin !== ${previous} && !!${input} && !${input}.disabled`, 20000);
    await desktop(); await open();
    assert.equal(await browser.evaluate(`${q('[data-testid=artifact-panel-type]')}.textContent`), 'Données');
    assert.match(await browser.evaluate(`${q('[data-boring=record-table]')}.textContent`), /1\s?234,5/);
    await browser.click(q('[data-boring=record-table] button'));
    await browser.until('host action', `${q('[data-testid=host-log]')}?.textContent === 'order:stock-2'`, 5000);
    await shoot('desktop-records-fr');
    await browser.emulate('phone'); await pause(400); await open();
    const action = q('[data-boring=record-list] button');
    assert.ok(await browser.evaluate(`${action}.getBoundingClientRect().height >= 44`));
    await browser.tap(action);
    await browser.until('phone host action', `${q('[data-testid=host-log]')}?.textContent === 'order:stock-2 order:stock-2'`, 5000);
    assert.ok(await browser.evaluate(noOverflow)); await shoot('phone-records-fr');
  });
  await step('malformed file: exact raw text and French note, never markup', async () => {
    await desktop();
    await browser.type(input, 'Make the broken stock and present it.'); await browser.press('Enter');
    await browser.until('raw fallback', `!!${q('[data-testid=records-raw]')}`, 30000);
    assert.equal(await browser.evaluate(`${q('[data-testid=records-raw]')}.textContent`), ' {"kind":"records@1", "rows": <fictional>\n');
    assert.match(await browser.evaluate(`${q('[data-testid=records-invalid]')}.textContent`), /texte brut/);
    assert.ok(await browser.evaluate(noOverflow)); await shoot('desktop-records-invalid');
  });
  assert.deepEqual(misses, []);
  assert.deepEqual(browser.problems, []);
  writeFileSync(join(evidence, 'phone-button-states.json'), JSON.stringify(buttonStates, null, 2) + '\n');
  console.log(`PASS records journey; screenshots in ${evidence}`);
} finally {
  await browser?.screenshot('records-last-state.png');
  await browser?.close(); await app.close();
}
