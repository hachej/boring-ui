// Drives the row D stories (1440×900, 2×): Studio's conversation column with the kit's PM composer in its desktop preset, the point layer
// inside the app's device frame. Writes D8, D1, D7c, D7, D7b and D9, each beside its mockup in `PM_COMPARE`, then drives click to comment
// (spec 1 §3b): Enter sends one message with one pick, « Add to message » and a click outside keep it in the draft, the box survives a reload.
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
// Visible pins only: the point layer keeps its own hidden label while picking.
const noPins = `![...document.querySelectorAll('[data-feedback-overlay]')].some(host => [...(host.shadowRoot?.querySelectorAll('.label') ?? [])].some(label => getComputedStyle(label).display !== 'none'))`;
const pins = n => `[...document.querySelectorAll('[data-feedback-overlay]')].some(host => host.shadowRoot?.querySelectorAll('.label').length === ${n})`;
const shots = [];
async function shot(board) { await pause(350); await browser.screenshot(`${board}.png`); shots.push(board); }
const comment = q('[data-testid=pm-comment]'), field = q('[data-testid=pm-comment-input]');
const noComment = async stage => assert.equal(await browser.evaluate(`!!${comment}`), false, `${stage}: no comment popover`);
const heading = q('[data-testid=studio-frame] > div');
async function commentOpen(stage) {
  await browser.until(stage, `!!${comment} && ${comment}.style.visibility !== 'hidden' && document.activeElement === ${field}`);
}
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
  await browser.until('recording', visible('[data-testid=pm-timer]'), 15000);
  await at('0:02'); await browser.click(q('[data-testid=d-card]'));
  await at('0:09'); await browser.click(q('[data-testid=d-gauge]'));
  // §3b: while recording the voice is the comment; a click only pins.
  await pause(300); await noComment('a click while recording');
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
  // D7c: in point.idle a click opens the comment popover at its pin, focus in the field.
  await browser.click(q('[data-testid=pm-show]'));
  await browser.until('strip', mode('point'));
  await browser.click(q('[data-testid=d-card]'));
  await commentOpen('card popover');
  await browser.type(field, 'Protein before calories');
  // A click outside with text keeps the pick and the text in the draft, and picks nothing.
  await browser.click(heading);
  await browser.until('card kept', `!${comment} && ${pins(1)}`);
  await browser.click(q('[data-testid=d-gauge]'));
  await commentOpen('gauge popover');
  assert.equal(await browser.evaluate(`${comment}.getAttribute('aria-label')`), 'Comment on Gauge · Protein');
  assert.equal(await browser.evaluate(`${comment}.firstElementChild.textContent`), '2Gauge · Protein · My day');
  assert.equal(await browser.evaluate(`${q('[data-testid=pm-comment-send]')}.disabled`), true, 'send is disabled while the field is empty');
  const placed = await browser.evaluate(`(() => { const p = ${comment}.getBoundingClientRect(), g = ${q('[data-testid=d-gauge]')}.getBoundingClientRect(); return { width: p.width, gap: Math.round(p.top - g.bottom), left: Math.round(p.left - g.left) }; })()`);
  assert.deepEqual(placed, { width: 320, gap: 8, left: 0 }, 'the popover is 320 wide, 8px below the pick and left-aligned with it');
  await browser.type(field, 'Show grams here, not the percentage');
  await browser.hover(q('nav[aria-label=Apps]'));
  await shot('D7c');
  await browser.click(heading);
  await browser.until('gauge kept', `!${comment}`);
  // D7: Montrer, two picks before the microphone (no timestamps), nothing recording.
  await browser.until('two pins', pins(2));
  await browser.hover(q('nav[aria-label=Apps]'));
  await shot('D7');
  // D7b: speaking, the toggle, hint, timer and « Done » in that order (no pause, no ×: spec 1 §2).
  await browser.until('mic ready', `!${q('[data-testid=pm-strip] [data-testid=pm-mic]')}.disabled`); await browser.click(q('[data-testid=pm-strip] [data-testid=pm-mic]'));
  await browser.until('recording', visible('[data-testid=pm-timer]'), 15000);
  await at('0:03');
  assert.deepEqual(await browser.evaluate(`[...${q('[data-testid=pm-strip]')}.querySelectorAll('[role=radiogroup], [data-testid=pm-hint], [data-testid=pm-timer], [data-testid=pm-pause], [data-testid=pm-mic], [data-testid=pm-done]')].map(n => n.getAttribute('role') ?? n.dataset.testid)`),
    ['radiogroup', 'pm-hint', 'pm-timer', 'pm-done'], 'D7b: no pause and no × in the strip');
  assert.deepEqual(await browser.evaluate(`(() => { const b = ${q('[data-testid=pm-done]')}, r = b.getBoundingClientRect(); return [b.textContent, b.getAttribute('aria-label'), Math.round(r.height)]; })()`), ['Done', 'Done: reread in the composer', 34]);
  await shot('D7b');
  // D9: a fresh draft typing a task mention.
  await open();
  await browser.type(q('[data-testid=composer-input]'), 'Before you start, about @d-2');
  await browser.until('D9 listbox', `document.querySelectorAll('[data-testid=pm-mention-row]').length === 3`);
  assert.deepEqual(await browser.evaluate(`[...document.querySelectorAll('[data-testid=pm-mention-row]')].map(row => row.textContent)`),
    ['D-201Protein before calories on meal cardsOn you', 'D-202Day plan: lunch photo', 'D-203Sunday weigh-in reminder'], 'the viewer\'s tasks, « On you » where one waits on them');
  await browser.hover(q('nav[aria-label=Apps]'));
  // The mouse passed over the list on its way out; ↑ brings the highlight back to the first row (keyboard, spec 1 §8).
  const active = () => browser.evaluate(`[...document.querySelectorAll('[data-testid=mention-item]')].findIndex(row => row.getAttribute('aria-selected') === 'true')`);
  for (let index = await active(); index > 0; index = await active()) await browser.press('ArrowUp');
  await shot('D9');

  // §3b, Enter: exactly one message with one pick goes straight to the PM; the draft is unchanged and the strip stays in point.idle.
  await open();
  await browser.type(q('[data-testid=composer-input]'), 'Draft stays');
  await browser.click(q('[data-testid=pm-show]'));
  await browser.until('strip', mode('point'));
  await browser.click(q('[data-testid=d-gauge]'));
  await commentOpen('gauge popover');
  const sent = app.submits.length, messages = await browser.evaluate(`document.querySelectorAll('[data-testid=pm-sent-message]').length`);
  await browser.type(field, 'Show grams here');
  await browser.press('Enter');
  await browser.until('sent to the PM', `!${comment} && ${q('[data-testid=pm-hint]')}?.textContent === 'Sent to the PM' && ${noPins}`);
  await browser.until('the message in the thread', `document.querySelectorAll('[data-testid=pm-sent-message]').length === ${messages + 1}`, 20000);
  assert.equal(app.submits.length, sent + 1, 'one message');
  const body = JSON.stringify(app.submits.at(-1).body);
  assert.equal(body.match(/\\"atMs\\":/g)?.length, 1, 'one pick');
  assert.ok(body.includes('Show grams here') && body.includes('image/png') && !body.includes('Draft stays'), 'the comment, its capture, and nothing from the draft');
  assert.match(await browser.evaluate(`[...document.querySelectorAll('[data-testid=pm-sent-transcript]')].at(-1).textContent`), /^Show grams here .*Gauge · Protein/);
  assert.equal(await browser.evaluate(mode('point')), true, 'the strip stays in point.idle');
  await browser.until('hint back', `${q('[data-testid=pm-hint]')}.textContent === 'Tap what you want to show'`, 5000);
  // « Add to message »: the pick and its text go into the draft; the box is remembered across a reload.
  await browser.click(q('[data-testid=d-card]'));
  await commentOpen('card popover');
  await browser.click(q('[data-testid=pm-comment-add]'));
  await browser.until('checked', `${q('[data-testid=pm-comment-add]')}.hasAttribute('data-checked')`);
  await browser.click(field); await browser.type(field, 'Bigger title');
  await browser.press('Enter');
  await browser.until('kept in the draft', `!${comment} && ${pins(1)}`);
  await browser.press('Escape');
  await browser.until('review', `${mode('sheet')} && document.querySelectorAll('[data-testid=pm-chip]').length === 1`);
  assert.match(await browser.evaluate(`${q('[data-testid=composer-input]')}.textContent`), /Draft stays.*Card · Lunch.*Bigger title/, 'the draft, then the chip and its text');
  await open();
  await browser.click(q('[data-testid=pm-show]'));
  await browser.until('strip', mode('point'));
  await browser.click(q('[data-testid=d-gauge]'));
  await commentOpen('after a reload');
  assert.equal(await browser.evaluate(`${q('[data-testid=pm-comment-add]')}.hasAttribute('data-checked')`), true, 'the box survives a reload');
  await browser.click(q('[data-testid=pm-comment-add]'));
  // Esc cancels the pick and closes the popover; a second Esc is the strip's ×.
  await browser.click(field); await browser.press('Escape');
  await browser.until('cancelled', `!${comment} && ${noPins} && ${mode('point')}`);
  await browser.press('Escape');
  await browser.until('back to the composer', mode('sheet'));
  assert.deepEqual(browser.problems, [], 'no browser errors');
} finally { await browser?.close(); await app.close(); }

const names = { D1: 'D1-StudioApp', D7: 'D7-StudioPoint', D7b: 'D7b-StudioPointSpeak', D7c: 'D7c-StudioPointComment', D8: 'D8-StudioReturn', D9: 'D9-StudioMention' };
for (const board of shots) {
  const mockup = join(mockups, `${names[board]}.png`);
  sideBySide(existsSync(mockup) ? mockup : undefined, join(evidence, `${board}.png`), join(compare, `${board}.png`), board);
}
console.log(`PASS studio: ${shots.join(', ')} → ${compare}`);
