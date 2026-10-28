// Drives the fictional Coach Max app through the row C boards at the mockups' viewport (390×844, 2×) and writes one screenshot per board,
// then places each beside its mockup PNG (left: mockup, right: build) in `PM_COMPARE` (default .agent-handoff/pm-panel/compare).
// The mockups are read from PM_SPEC (default ../pm-spec/mockups/png); without them only the build screenshots are written.
import assert from 'node:assert/strict';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { launch, pause, q } from '@hachej/boring-testing/browser';
import { startPmPanel } from './server.mjs';
import { sideBySide } from './compare.mjs';

const evidence = process.env.PM_EVIDENCE ?? '.cache/evidence/pm-panel/boards';
const compare = process.env.PM_COMPARE ?? '.agent-handoff/pm-panel/compare';
const mockups = process.env.PM_SPEC ?? '../pm-spec/mockups/png';
mkdirSync(evidence, { recursive: true }); mkdirSync(compare, { recursive: true });
const app = await startPmPanel();
let browser;
const visible = selector => `!!${q(selector)} && ${q(selector)}.getClientRects().length > 0`;
const mode = value => `${q('[data-testid=pm-panel]')}?.dataset.mode === '${value}'`;
const timer = () => browser.evaluate(`${q('[data-testid=pm-timer]')}?.textContent ?? ''`);
async function at(clock) { await browser.until(`timer ${clock}`, `(${q('[data-testid=pm-timer]')}?.textContent ?? '') >= ${JSON.stringify(clock)}`, 20000); }
const shots = [];
async function shot(board) {
  await pause(350);
  await browser.screenshot(`${board}.png`);
  shots.push(board);
}
try {
  browser = await launch('about:blank', { evidence, args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
  // Carets paint only in a focused page: the C6/D8/D9 shots show the caret at the end of the draft, as the boards do.
  await browser.send('Emulation.setFocusEmulationEnabled', { enabled: true });
  await browser.emulate('phone');
  await browser.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await browser.send('Page.navigate', { url: app.url });
  await browser.until('Coach Max', visible('[data-testid=card-a]'), 20000);
  await browser.tap(q('[data-testid=account-button]'));
  await browser.until('account menu', visible('[data-testid=account-improve]'));
  await shot('C1');
  await browser.tap(q('[data-testid=account-improve]'));
  await browser.until('C2 sheet', `${mode('sheet')} && ${visible('[data-testid=pm-sheet]')}`, 12000);
  await shot('C2');
  await browser.tap(q('[data-testid=pm-show]'));
  await browser.until('C3 strip', `${mode('point')} && ${visible('[data-testid=pm-strip]')}`);
  await shot('C3');
  await browser.until('mic ready', `!${q('[data-testid=pm-strip] [data-testid=pm-mic]')}.disabled`); await browser.tap(q('[data-testid=pm-strip] [data-testid=pm-mic]'));
  await browser.until('C4 recording', visible('[data-testid=pm-pause]'), 15000);
  await at('0:02'); await browser.tap(q('[data-testid=card-a]'));
  await at('0:09'); await browser.tap(q('[data-testid=gauge]'));
  await browser.until('two pins', `[...document.querySelectorAll('[data-feedback-overlay]')].some(host => host.shadowRoot?.querySelectorAll('.label').length === 2)`);
  assert.equal(await timer(), '0:09');
  await shot('C4');
  await browser.tap(q('[data-testid=pm-navigate]'));
  await browser.until('C5 navigate', mode('navigate'));
  await browser.tap(q('[data-testid=tab-progress]'));
  await browser.until('Progrès', visible('[data-testid=card-b]'));
  await at('0:12');
  await shot('C5');
  await browser.tap(q('[data-testid=tab-day]'));
  await browser.until('back on Ma journée', visible('[data-testid=card-a]'));
  await at('0:14'); await pause(200);
  await browser.tap(q('[data-testid=pm-done]'));
  await browser.until('C6 review', `${mode('sheet')} && ${visible('[data-testid=pm-review-hint]')} && document.querySelectorAll('[data-testid=pm-chip]').length === 2`, 15000);
  await shot('C6');
  await browser.tap(q('[data-testid=composer-submit]'));
  await browser.until('C7 thread', `${mode('full')} && ${visible('[data-testid=pm-sent-message]')} && ${visible('[data-testid=pm-request-card]')}`, 20000);
  await shot('C7');
  await browser.tap(q('[data-testid=pm-requests]'));
  await browser.until('Mes demandes', visible('[data-testid=pm-task-board-seam]'));
  await shot('C7-mes-demandes');
  assert.deepEqual(browser.problems, [], 'no browser errors');
} finally { await browser?.close(); await app.close(); }

for (const board of shots) {
  const name = { C1: 'C1-FinalMenu', C2: 'C2-FinalPanel', C3: 'C3-FinalPoint', C4: 'C4-FinalVoice', C5: 'C5-FinalNavigate', C6: 'C6-FinalReturn', C7: 'C7-FinalThread' }[board];
  const mockup = name && join(mockups, `${name}.png`);
  sideBySide(mockup && existsSync(mockup) ? mockup : undefined, join(evidence, `${board}.png`), join(compare, `${board}.png`), board);
}
console.log(`PASS boards: ${shots.join(', ')} → ${compare}`);
