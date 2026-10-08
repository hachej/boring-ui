// The preview journey (FEEDBACK.md, "Preview"): one driven Chromium run of the default Fernhill page with the keyless scripted builder,
// the keyless scripted preview subagent behind `/api/llm`, and the default file sink. Steps: Feedback in the composer → pin Save with
// the note "make it green" → Send → "preview" → the builder's `browser_preview` waits; the page's subagent turns Save green (computed
// style) under the preview banner → "darker" in the banner → Approve → the builder files the ticket and replies with its link; the
// ticket's acceptance criteria carry the approved change with SettingsPage.jsx:N → back on the page, "preview" again → Discard → Save
// is back to its original style and nothing is filed. Screenshots and journey.json go to .cache/evidence/feedback-preview/.
// Manual evidence, not an npm test: `npm run feedback:journey:preview`.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startFeedbackApp } from './server.mjs';
import { launch, pause } from '@hachej/boring-testing/browser';

const evidence = process.env.FEEDBACK_EVIDENCE ?? '.cache/evidence/feedback-preview';
const chromium = process.env.CHROMIUM ?? `${process.env.HOME}/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome`;
mkdirSync(evidence, { recursive: true });
const directory = mkdtempSync(join(tmpdir(), 'boring-feedback-preview-'));
const steps = [];
const summary = { journey: 'feedback-preview', startedAt: new Date().toISOString(), model: 'scripted (keyless), builder and preview subagent', sink: 'file', steps, screenshots: [], records: {} };
const step = async (name, run) => { const started = Date.now(); await run(); steps.push({ name, ms: Date.now() - started }); console.log(`ok  ${name} (${Date.now() - started} ms)`); };

const q = testid => `document.querySelector('[data-testid=${JSON.stringify(testid)}]')`;
const CHAT = `document.querySelector('[data-boring=ambient-chat]')`;
const inChat = testid => `${CHAT}?.querySelector('[data-testid=${JSON.stringify(testid)}]')`;
const TRANSCRIPT = `(${inChat('transcript')}?.innerText ?? '')`;
const IDLE = `${CHAT}.querySelector('[data-testid=ambient-status]')?.dataset.status !== 'working'`;
const SAVE = q('save-profile');
const SAVE_STYLE = `(() => { const s = getComputedStyle(${SAVE}); return { background: s.backgroundColor, color: s.color, inline: ${SAVE}.getAttribute('style') }; })()`;
const BANNER = q('preview-banner');
const NOTE = 'make it green';
const LINK = /Ticket for (fb_[1-9A-HJ-NP-Za-km-z]{16}) filed \(file\): (http:\/\/127\.0\.0\.1:\d+\/tickets\/([A-Za-z0-9_-]+))/;
const GREEN = 'rgb(47, 158, 68)', DARKER = 'rgb(27, 94, 32)';

const app = await startFeedbackApp({ directory, port: 0, modelGateway: { log: () => {} } });
let browser;
try {
  browser = await launch(`${app.url}settings/profile`, { chromium, evidence });
  const shot = async name => { await pause(300); await browser.screenshot(`${name}.png`); summary.screenshots.push(join(evidence, `${name}.png`)); };
  const clickAt = async selector => {
    const box = await browser.until(`the centre of ${selector}`, `(() => { const e = ${selector}; if (!e) return null; e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(); return r.width ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null; })()`);
    await browser.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: box.x, y: box.y });
    for (const type of ['mousePressed', 'mouseReleased']) await browser.send('Input.dispatchMouseEvent', { type, x: box.x, y: box.y, button: 'left', clickCount: 1 });
  };
  const ready = () => browser.until('the page and the Feedback button', `!!(${q('app-root')} && ${inChat('composer-feedback')} && !${inChat('composer-feedback')}.disabled && !${inChat('composer-input')}.disabled)`, 30000);
  const say = async text => { await browser.type(inChat('composer-input'), text); await browser.press('Enter'); };
  const expand = async () => { if (await browser.evaluate(`${CHAT}.dataset.state`) !== 'expanded') await browser.click(inChat('ambient-title')); };
  await ready();
  const original = await browser.evaluate(SAVE_STYLE);
  summary.records.original = original;

  let id;
  await step(`Feedback: pin Save with "${NOTE}", Done, Send; the builder cites it`, async () => {
    await browser.click(inChat('composer-feedback'));
    await browser.until('the feedback bar', `!!${q('feedback-bar')}`, 5000);
    await clickAt(SAVE);
    await browser.until('the bubble', `!!${q('feedback-bubble-input')}`, 5000);
    await browser.type(q('feedback-bubble-input'), NOTE);
    await browser.press('Enter');
    await browser.until('one note', `${q('feedback-bar-count')}.textContent === '1 note'`, 5000);
    await browser.click(q('feedback-done'));
    await browser.until('the chip', `!!${inChat('feedback-chip')}`, 10000);
    await say('Please fix this.');
    await browser.until('the chip is gone', `!${inChat('feedback-chip')}`, 10000);
    await expand();
    await browser.until('the builder replied', `/fb_[1-9A-HJ-NP-Za-km-z]{16}: 1 note/.test(${TRANSCRIPT}) && ${IDLE}`, 30000);
    id = /(fb_[1-9A-HJ-NP-Za-km-z]{16}): 1 note/.exec(await browser.evaluate(TRANSCRIPT))[1];
    summary.records.feedback = id;
    await shot('01-feedback-sent');
  });

  await step('"preview": browser_preview waits; the page subagent turns Save green under the preview banner', async () => {
    await say('preview');
    await browser.until('the banner, ready', `${BANNER}?.dataset.status === 'ready'`, 30000);
    const banner = await browser.evaluate(`({ text: ${BANNER}.innerText, role: ${BANNER}.getAttribute('role'), label: ${BANNER}.getAttribute('aria-label'), ignored: ${BANNER}.hasAttribute('data-feedback-ignore'), position: getComputedStyle(${BANNER}).position })`);
    assert.match(banner.text, /Preview[\s\S]*these changes are not saved/i);
    assert.deepEqual([banner.role, banner.label, banner.ignored, banner.position], ['region', 'Preview of a change', true, 'fixed']);
    const style = await browser.evaluate(SAVE_STYLE);
    assert.equal(style.background, GREEN, 'Save is green');
    assert.equal(await browser.evaluate(`${CHAT}.querySelector('[data-testid=ambient-status]')?.dataset.status`), 'working', 'the builder is waiting on the page');
    summary.records.green = style;
    await shot('02-preview-green');
  });

  await step('"darker" in the banner: the subagent darkens Save', async () => {
    await browser.type(q('preview-input'), 'darker');
    await browser.click(q('preview-say'));
    await browser.until('darker', `getComputedStyle(${SAVE}).backgroundColor === ${JSON.stringify(DARKER)} && ${BANNER}?.dataset.status === 'ready'`, 30000);
    summary.records.changes = await browser.evaluate(`[...document.querySelectorAll('[data-testid=preview-change]')].map(li => li.innerText)`);
    await shot('03-preview-darker');
  });

  let link, ticketId;
  await step('Approve: the builder writes the ticket with the approved change and replies with its link; the page is back as it was', async () => {
    await browser.click(q('preview-approve'));
    await expand();
    await browser.until('the ticket reply', `${LINK}.test(${TRANSCRIPT}) && ${IDLE}`, 30000);
    const found = LINK.exec(await browser.evaluate(TRANSCRIPT));
    assert.equal(found[1], id);
    [, , link, ticketId] = found;
    summary.records.link = link;
    const tools = (await app.messages('ada')).filter(message => message.role === 'toolResult').slice(-5).map(message => message.toolName);
    assert.deepEqual(tools, ['browser_preview', 'load_skill', 'feedback', 'write', 'present']);
    await browser.until('the banner is gone', `!${BANNER}`, 10000);
    assert.deepEqual(await browser.evaluate(SAVE_STYLE), original, 'nothing stays changed on the page');
    await shot('04-approved-ticket-reply');
  });

  await step('the ticket: acceptance criterion with the approved change on Save, SettingsPage.jsx:N', async () => {
    await browser.send('Page.navigate', { url: link });
    await browser.until('the ticket page', `!!${q('ticket')}`, 10000);
    const body = await browser.evaluate(`${q('ticket-body')}.innerText`);
    assert.match(body, /Approved preview/);
    assert.match(body, /AC-\d+: on \/settings\/:section, the «Save profile» button \(examples\/feedback\/settings\/SettingsPage\.jsx:\d+\): background-color is #1b5e20 \(was .+\), as previewed and approved/);
    summary.records.criteria = body.split('\n').filter(line => /AC-\d+/.test(line));
    summary.records.ticket = ticketId;
    await shot('05-ticket-page');
  });

  await step('again, "preview" then Discard: Save returns to its original style and nothing is filed', async () => {
    await browser.send('Page.navigate', { url: `${app.url}settings/profile` });
    await ready();
    await expand();
    await say('preview');
    await browser.until('the banner, ready', `${BANNER}?.dataset.status === 'ready'`, 30000);
    assert.equal((await browser.evaluate(SAVE_STYLE)).background, GREEN);
    await shot('06-preview-again');
    await browser.click(q('preview-discard'));
    await browser.until('the discard reply', `/Preview discarded/.test(${TRANSCRIPT}) && ${IDLE}`, 30000);
    assert.deepEqual(await browser.evaluate(SAVE_STYLE), original, 'Discard reverts the style');
    const created = (await app.messages('ada')).filter(message => message.role === 'toolResult' && message.toolName === 'write').length;
    assert.equal(created, 1, 'no second ticket');
    await browser.until('the banner is gone', `!${BANNER}`, 10000);
    await shot('07-discarded');
  });

  assert.deepEqual(browser.problems.filter(problem => !/favicon|ERR_|Failed to load resource/.test(problem)), [], 'no page errors');
  summary.result = 'pass';
  console.log(`PASS: ${steps.length} steps; screenshots in ${evidence}`);
} catch (error) {
  summary.result = 'fail';
  summary.error = String(error?.stack ?? error);
  await browser?.screenshot('failure.png').catch(() => {});
  process.exitCode = 1;
  console.error(error);
} finally {
  summary.finishedAt = new Date().toISOString();
  writeFileSync(join(evidence, 'journey.json'), JSON.stringify(summary, null, 2));
  await browser?.close();
  await app.close();
  rmSync(directory, { recursive: true, force: true });
}
