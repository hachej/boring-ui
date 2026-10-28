// Drives the row D stories (1440×900, 2×): Studio's conversation column with the kit's PM composer in its desktop preset, the point layer
// inside the app's device frame. Writes D8, D1, D7, D7b and D9, each beside its mockup in `PM_COMPARE`.
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
const mode = value => `${q('[data-testid=pm-chat]')}?.dataset.mode === '${value}'`;
async function at(clock) { await browser.until(`timer ${clock}`, `(${q('[data-testid=pm-timer]')}?.textContent ?? '') >= ${JSON.stringify(clock)}`, 20000); }
const pins = n => `[...document.querySelectorAll('[data-feedback-overlay]')].some(host => host.shadowRoot?.querySelectorAll('.label').length === ${n})`;
const shots = [];
async function shot(board) { await pause(350); await browser.screenshot(`${board}.png`); shots.push(board); }
async function open() {
  await browser.send('Page.navigate', { url: `${app.url}?studio=1` });
  await browser.until('Studio story', visible('[data-testid=studio-frame]') + ` && ${visible('[data-testid=pm-show]')}`, 20000);
}
try {
  browser = await launch('about:blank', { evidence, args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
  // Carets paint only in a focused page: the C6/D8/D9 shots show the caret at the end of the draft, as the boards do.
  await browser.send('Emulation.setFocusEmulationEnabled', { enabled: true });
  await browser.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 2, mobile: false });
  await open();
  // D8: the review after a dictated pointing round.
  await browser.click(q('[data-testid=pm-show]'));
  await browser.until('D7 strip', `${mode('point')} && ${visible('[data-testid=pm-strip]')}`);
  await browser.until('mic ready', `!${q('[data-testid=pm-strip] [data-testid=pm-mic]')}.disabled`); await browser.click(q('[data-testid=pm-strip] [data-testid=pm-mic]'));
  await browser.until('recording', visible('[data-testid=pm-pause]'), 15000);
  await at('0:02'); await browser.click(q('[data-testid=d-card]'));
  await at('0:09'); await browser.click(q('[data-testid=d-gauge]'));
  assert.equal(await browser.evaluate('(window.__activated ?? []).length'), 0, 'a click in select mode never activates the app');
  await at('0:10'); await pause(400);
  await browser.press('Escape');
  await browser.until('D8 review', `${mode('sheet')} && document.querySelectorAll('[data-testid=pm-chip]').length === 2`, 15000);
  await shot('D8');
  // D1: sent, with the PM's answer.
  await browser.click(q('[data-testid=composer-submit]'));
  await browser.until('D1 thread', `${visible('[data-testid=pm-sent-message]')} && ${visible('[data-testid=pm-reply]')} && !${q('[data-testid=pm-chip]')}`, 20000);
  await browser.hover(q('nav[aria-label=Apps]'));
  await shot('D1');
  // D7: Montrer, two picks before the microphone (no timestamps), nothing recording.
  await browser.click(q('[data-testid=pm-show]'));
  await browser.until('strip', mode('point'));
  await browser.click(q('[data-testid=d-card]')); await browser.click(q('[data-testid=d-gauge]'));
  await browser.until('two pins', pins(2));
  await browser.hover(q('nav[aria-label=Apps]'));
  await shot('D7');
  // D7b: speaking, the toggle, hint, timer, pause and × in that order.
  await browser.until('mic ready', `!${q('[data-testid=pm-strip] [data-testid=pm-mic]')}.disabled`); await browser.click(q('[data-testid=pm-strip] [data-testid=pm-mic]'));
  await browser.until('recording', visible('[data-testid=pm-pause]'), 15000);
  await at('0:03');
  await shot('D7b');
  // D9: a fresh draft typing a task mention.
  await open();
  await browser.type(q('[data-testid=composer-input]'), 'Before you start, about @d-2');
  await browser.until('D9 listbox', `document.querySelectorAll('[data-testid=pm-mention-row]').length === 3`);
  await browser.hover(q('nav[aria-label=Apps]'));
  // The mouse passed over the list on its way out; ↑ brings the highlight back to the first row (keyboard, spec 1 §8).
  const active = () => browser.evaluate(`[...document.querySelectorAll('[data-testid=mention-item]')].findIndex(row => row.getAttribute('aria-selected') === 'true')`);
  for (let index = await active(); index > 0; index = await active()) await browser.press('ArrowUp');
  await shot('D9');
  assert.deepEqual(browser.problems, [], 'no browser errors');
} finally { await browser?.close(); await app.close(); }

const names = { D1: 'D1-StudioApp', D7: 'D7-StudioPoint', D7b: 'D7b-StudioPointSpeak', D8: 'D8-StudioReturn', D9: 'D9-StudioMention' };
for (const board of shots) {
  const mockup = join(mockups, `${names[board]}.png`);
  sideBySide(existsSync(mockup) ? mockup : undefined, join(evidence, `${board}.png`), join(compare, `${board}.png`), board);
}
console.log(`PASS studio: ${shots.join(', ')} → ${compare}`);
