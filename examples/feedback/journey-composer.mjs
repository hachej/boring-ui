// The composer journey (FEEDBACK.md, "UX"): one driven Chromium run of the default Fernhill page, with real pointer and keyboard input
// over the DevTools protocol on an insecure origin, the keyless scripted builder (builder.mjs) and the SQLite store. Steps:
//   Feedback in the chat composer → hover and click Save (pinned, never pressed) → type a note, Enter → hold ⌥ and use the app (open the
//   Billing section, open the plan menu: both reach the page and are recorded as steps) → release ⌥, click Change plan (pinned, the
//   menu does not toggle) → note → 🎙 Record says in the bar that recording needs a secure page (this origin is insecure) → Done →
//   one chip → its review (hover highlights a note's element, or says it is not on this page) → Send → the builder replies citing both
//   elements with file:line → the card's element lines read «name» kind + file:line; hovering one highlights it in the page (✓), and a
//   pin from the other section is "not on this page" → recording mode on a secure origin (127.0.0.1) with Chromium's fake microphone:
//   Record (red dot, timer, Stop), two clicks drop pins ① ② with no bubble, Stop, Done → Transcribing… → the chip counts the merged
//   notes from the fake transcription (run with `env -u TRANSCRIPTION_API_KEY` so the example uses it).
// Screenshots and journey.json go to .cache/evidence/feedback-composer/. Manual evidence, not an npm test.
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startFeedbackApp } from './server.mjs';
import { insecureUrl, launch, pause } from '@hachej/boring-testing/browser';

const evidence = process.env.FEEDBACK_EVIDENCE ?? '.cache/evidence/feedback-composer';
const chromium = process.env.CHROMIUM ?? `${process.env.HOME}/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome`;
mkdirSync(evidence, { recursive: true });
const directory = mkdtempSync(join(tmpdir(), 'boring-feedback-composer-'));
const steps = [];
const summary = { journey: 'feedback-composer', startedAt: new Date().toISOString(), model: 'scripted (keyless)', steps, screenshots: [], records: {} };
const step = async (name, run) => { const started = Date.now(); await run(); steps.push({ name, ms: Date.now() - started }); console.log(`ok  ${name} (${Date.now() - started} ms)`); };

const q = testid => `document.querySelector('[data-testid=${JSON.stringify(testid)}]')`;
const CHAT = `document.querySelector('[data-boring=ambient-chat]')`;
const inChat = testid => `${CHAT}?.querySelector('[data-testid=${JSON.stringify(testid)}]')`;
const TRANSCRIPT = `(${inChat('transcript')}?.innerText ?? '')`;
/** Every overlay's labels (the picker's hover overlay and the session's pins overlay, and the card's highlight overlay). */
const DRAWN = `[...document.querySelectorAll('[data-feedback-overlay]')].flatMap(host => [...host.shadowRoot.querySelectorAll('.label')].map(label => ({ label: label.textContent, tone: label.dataset.tone })))`;
const boxOver = (target, tone) => `[...document.querySelectorAll('[data-feedback-overlay]')].some(host => [...host.shadowRoot.querySelectorAll('.box')].some(box => { if (box.dataset.tone !== ${JSON.stringify(tone)}) return false; const a = box.getBoundingClientRect(), b = (${target}).getBoundingClientRect(); return Math.abs(a.top - b.top) < 2 && Math.abs(a.left - b.left) < 2; }))`;
const SAVE = q('save-profile');
const PLAN = q('change-plan');
const NOTE_SAVE = 'It should say what it saves.';
const NOTE_PLAN = 'Changing the plan should show the price first.';

const app = await startFeedbackApp({ directory, port: 0 });
let browser;
try {
  const base = insecureUrl(app.url);
  // The fake microphone (a beep) and an auto-accepted permission prompt, for the recording steps on the secure origin.
  browser = await launch(`${base}settings/profile`, { chromium, evidence, args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
  const shot = async name => { await pause(300); await browser.screenshot(`${name}.png`); summary.screenshots.push(join(evidence, `${name}.png`)); };
  const point = async selector => {
    const box = await browser.until(`the centre of ${selector}`, `(() => { const e = ${selector}; if (!e) return null; e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(); return r.width ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null; })()`);
    await browser.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: box.x, y: box.y });
    return box;
  };
  /** A real click; `alt` holds ⌥ on the mouse events too, as a person holding the key does. */
  const clickAt = async (selector, { alt = false } = {}) => {
    const box = await point(selector);
    for (const type of ['mousePressed', 'mouseReleased']) await browser.send('Input.dispatchMouseEvent', { type, x: box.x, y: box.y, button: 'left', clickCount: 1, modifiers: alt ? 1 : 0 });
  };
  const alt = type => browser.send('Input.dispatchKeyEvent', { type, key: 'Alt', code: 'AltLeft', windowsVirtualKeyCode: 18, modifiers: type === 'keyUp' ? 0 : 1 });
  const hoverLabel = `(${DRAWN}).find(item => item.tone === 'hover')?.label`;

  await browser.until('the page and the Feedback button in the composer', `!!(${q('app-root')} && ${CHAT} && ${inChat('composer-feedback')} && !${inChat('composer-feedback')}.disabled && ${inChat('composer-input')} && !${inChat('composer-input')}.disabled)`, 30000);
  await browser.evaluate(`(() => { const hits = window.__journeyHits = { save: 0, submit: 0, plan: 0 };
    ${SAVE}.addEventListener('click', () => hits.save++); ${SAVE}.closest('form').addEventListener('submit', () => hits.submit++); })()`);

  await step('one entry point: the composer has a Feedback button beside the + menu, and the page has no other feedback button', async () => {
    const found = await browser.evaluate(`({ button: ${inChat('composer-feedback')}.textContent, point: !!${q('feedback-point')}, list: !!${q('feedback-open-list')}, dock: !!${q('feedback-dock')}, bar: !!${q('feedback-bar')} })`);
    assert.deepEqual(found, { button: 'Feedback', point: false, list: false, dock: false, bar: false });
    await shot('01-page');
  });

  await step('Feedback: feedback mode, a slim bar; hovering boxes and labels the element through the privacy policy', async () => {
    await browser.click(inChat('composer-feedback'));
    await browser.until('the feedback bar', `!!${q('feedback-bar')}`, 5000);
    assert.equal(await browser.evaluate(`${inChat('composer-feedback')}.getAttribute('aria-pressed')`), 'true');
    assert.match(await browser.evaluate(`${q('feedback-bar')}.innerText`), /Feedback[\s\S]*0 notes[\s\S]*Hold ⌥ to use the app[\s\S]*Use app[\s\S]*Done/);
    await point(SAVE);
    assert.equal(await browser.until('a hover label', hoverLabel, 5000), 'SettingsPage · button «Save profile»');
    assert.equal(await browser.evaluate(`${q('feedback-bar-hint')}.textContent`), 'Click what you want to comment on', 'the bar never names the hovered component');
    assert.ok(await browser.evaluate(`!!${inChat('feedback-bar')}`), 'the bar is docked under the composer');
    await shot('02-feedback-mode-hover');
  });

  await step('click Save: a numbered pin and a note bubble right there; the page never reacts', async () => {
    await clickAt(SAVE);
    await browser.until('the bubble', `!!${q('feedback-bubble-input')}`, 5000);
    assert.equal(await browser.evaluate(`${q('feedback-bubble-input')}.placeholder`), "What's wrong here?");
    assert.deepEqual(await browser.evaluate('window.__journeyHits'), { save: 0, submit: 0, plan: 0 }, 'Save was neither clicked nor submitted');
    assert.equal(await browser.evaluate(`${q('profile-saved')}.dataset.presses`), '0');
    await browser.type(q('feedback-bubble-input'), NOTE_SAVE);
    await shot('03-bubble');
    await browser.press('Enter');
    await browser.until('the note is kept', `!${q('feedback-bubble')} && ${q('feedback-bar-count')}.textContent === '1 note'`, 5000);
    assert.ok((await browser.evaluate(DRAWN)).some(item => item.label === '①' && item.tone === 'pinned'), 'pin ① stays on the page');
    assert.equal(await browser.evaluate(boxOver(SAVE, 'pinned')), true);
  });

  await step('hold ⌥ and use the app: the Billing section opens and the plan menu opens; both are recorded as steps', async () => {
    await alt('rawKeyDown');
    await browser.until('using the app', `${q('feedback-bar')}.dataset.using === 'true'`, 5000);
    await clickAt(q('section-billing'), { alt: true });
    await browser.until('the Billing section', `location.pathname === '/settings/billing' && !!${PLAN}`, 5000);
    await browser.evaluate(`${PLAN}.addEventListener('click', () => window.__journeyHits.plan++)`);
    await clickAt(PLAN, { alt: true });
    await browser.until('the plan menu', `!!${q('plan-menu')}`, 5000);
    assert.equal(await browser.evaluate('window.__journeyHits.plan'), 1, 'the click reached the app');
    await shot('04-using-the-app');
    await alt('keyUp');
    await browser.until('back to commenting', `${q('feedback-bar')}.dataset.using === 'false'`, 5000);
  });

  await step('release ⌥ and click Change plan: a second pin and note; the menu does not toggle', async () => {
    await clickAt(PLAN);
    await browser.until('the bubble', `!!${q('feedback-bubble-input')}`, 5000);
    assert.equal(await browser.evaluate('window.__journeyHits.plan'), 1, 'the pin click never reached the app');
    assert.equal(await browser.evaluate(`!!${q('plan-menu')}`), true, 'the menu is still open');
    await browser.type(q('feedback-bubble-input'), NOTE_PLAN);
    await browser.press('Enter');
    await browser.until('two notes', `${q('feedback-bar-count')}.textContent === '2 notes'`, 5000);
    assert.ok((await browser.evaluate(DRAWN)).some(item => item.label === '②' && item.tone === 'pinned'));
    await shot('05-second-pin');
  });

  await step('🎙 Record: on this insecure origin the bar itself says recording needs a secure page', async () => {
    assert.equal(await browser.evaluate(`${q('feedback-voice')}.textContent`), 'Record', 'a labelled Record button');
    await browser.click(q('feedback-voice'));
    assert.equal(await browser.until('the voice problem', `${q('feedback-voice-problem')}?.textContent`, 5000), 'Recording needs a secure page (https or localhost).');
    assert.equal(await browser.evaluate(`${q('feedback-voice-problem')}.getAttribute('role')`), 'alert');
    assert.equal(await browser.evaluate(`!!${q('feedback-recording')}`), false, 'no recording indicator without a recording');
    await shot('05b-record-insecure');
  });

  await step('Done: feedback mode closes and the composer shows one chip', async () => {
    await browser.click(q('feedback-done'));
    await browser.until('the chip', `!!${inChat('feedback-chip')} && !${q('feedback-bar')}`, 10000);
    assert.equal(await browser.evaluate(`${inChat('feedback-chip-open')}.textContent`), '💬 Feedback · 2 notes · /settings/:section');
    assert.deepEqual((await browser.evaluate(DRAWN)).filter(item => item.tone === 'pinned' || item.tone === 'hover'), [], 'no pins or hover once feedback mode is closed');
    await shot('06-chip');
  });

  await step('the review: notes in order; hovering one highlights its element, or says it is not on this page', async () => {
    await browser.click(inChat('feedback-chip-open'));
    await browser.until('the review', `document.querySelectorAll('[data-testid=feedback-review-note]').length === 2`, 5000);
    const texts = await browser.evaluate(`[...document.querySelectorAll('[data-testid=feedback-review-text]')].map(area => area.value)`);
    assert.deepEqual(texts, [NOTE_SAVE, NOTE_PLAN]);
    await point(`document.querySelectorAll('[data-testid=feedback-review-note]')[1]`);
    await browser.until('the plan button highlighted', boxOver(PLAN, 'reveal'), 5000);
    await shot('07-review-hover');
    await point(`document.querySelectorAll('[data-testid=feedback-review-note]')[0]`);
    await browser.until('not on this page', `document.querySelectorAll('[data-testid=feedback-review-note]')[0].dataset.where === 'not-on-page'`, 5000);
    await browser.click(q('feedback-review-close'));
  });

  let id;
  await step('Send: the report is saved and attached; the builder replies citing both elements with file:line', async () => {
    await browser.type(inChat('composer-input'), 'Please fix these.');
    await browser.press('Enter');
    await browser.until('the chip is gone', `!${inChat('feedback-chip')}`, 10000);
    if (await browser.evaluate(`${CHAT}.dataset.state`) !== 'expanded') await browser.click(inChat('ambient-title'));
    const pattern = /fb_[1-9A-HJ-NP-Za-km-z]{16}: 2 notes/;
    await browser.until('the builder replied', `${pattern}.test(${TRANSCRIPT}) && ${CHAT}.querySelector('[data-testid=ambient-status]')?.dataset.status !== 'working'`, 30000);
    const transcript = await browser.evaluate(TRANSCRIPT);
    id = /(fb_[1-9A-HJ-NP-Za-km-z]{16}): 2 notes/.exec(transcript)[1];
    summary.records.id = id;
    const cited = [...transcript.matchAll(/\((examples\/feedback\/settings\/SettingsPage\.jsx:\d+)\)/g)].map(match => match[1]);
    assert.equal(cited.length, 2, `both elements cited with file:line: ${transcript.slice(-600)}`);
    summary.records.cited = cited;
    const read = await app.store.read(id, app.people.ada.access);
    assert.equal(read.kind, 'available');
    assert.deepEqual(read.report.notes.map(note => [note.text, note.anchor]), [[NOTE_SAVE, 0], [NOTE_PLAN, 1]]);
    assert.deepEqual(read.report.anchors.map(anchor => anchor.signals.feedbackId), ['save-profile', 'change-plan']);
    const stepsText = read.report.steps.map(item => item.kind === 'click' ? `click ${item.target}` : item.kind === 'note' ? `note ${item.note + 1}` : item.kind === 'route' ? `route ${item.route}` : `key ${item.key}`);
    assert.deepEqual(stepsText.filter(item => !item.startsWith('route')), ['note 1', 'click SettingsPage · link «Billing»', 'click SettingsPage · button «Change plan»', 'note 2']);
    summary.records.steps = stepsText;
    const user = (await app.messages('ada')).filter(message => message.role === 'user').at(-1);
    assert.ok(JSON.stringify(user.content).includes(`<file path=\\"feedback/${id}.md\\">`), 'the report reached the model through the mention resolver');
    await shot('08-reply');
  });

  await step('the card: hovering an element line highlights it in the page; a pin from the other section is reported missing', async () => {
    const lines = `[...(${CHAT}.querySelectorAll('[data-testid=feedback-card][data-kind=list] [data-testid=feedback-element][data-feedback-id=${JSON.stringify(id)}]') ?? [])]`;
    await browser.until('two element lines', `${lines}.length === 2`, 10000);
    const read = index => browser.evaluate(`(() => { const line = ${lines}[${index}]; return { name: line.querySelector('[data-testid=feedback-fallback]').textContent, file: line.querySelector('[data-testid=feedback-source]')?.textContent, path: line.querySelector('[data-testid=feedback-source]')?.title, text: line.innerText }; })()`);
    const saveLine = await read(0);
    assert.deepEqual([saveLine.name, saveLine.file, saveLine.path], ['«Save profile» button', 'SettingsPage.jsx:65', 'examples/feedback/settings/SettingsPage.jsx:65'], 'readable name, basename, full path in the tooltip');
    const cardText = await browser.evaluate(`${lines}[0].closest('[data-testid=feedback-card]').innerText`);
    assert.doesNotMatch(cardText, /checked in the page|examples\/feedback|Unavailable:|Stale:|Ambiguous|1 places/, cardText);
    await point(`${lines}[1]`);
    await browser.until('the plan button highlighted from the card', boxOver(PLAN, 'reveal'), 10000);
    assert.equal(await browser.until('an outcome', `${lines}[1].querySelector('[data-testid=feedback-outcome][data-outcome]')?.textContent`, 5000), 'shown in the page', 'a small ✓, only after the page revealed it');
    await shot('09-card-hover');
    await point(`${lines}[0]`);
    const missing = await browser.until('the honest outcome', `(() => { const badge = ${lines}[0].querySelector('[data-testid=feedback-outcome][data-outcome]'); return badge ? { text: badge.textContent, title: badge.title } : null; })()`, 10000);
    assert.equal(missing.text, 'not on this page', 'Save is on the Profile section, not this one');
    assert.match(missing.title, /Missing: Nothing on this page matches/, 'the host\'s full reason stays in the tooltip');
    await point(q('app-root'));
    await browser.until('leaving the line clears the highlight', `!(${DRAWN}).some(item => item.tone === 'reveal')`, 5000);
    // Clicks keep each line's outcome, for the card's "after" picture (the "before" is the person's screenshot, when present).
    await clickAt(`${lines}[1]`);
    await browser.until('kept outcome', `!!${lines}[1].querySelector('[data-testid=feedback-outcome][data-outcome]')`, 5000);
    await clickAt(`${lines}[0]`);
    await browser.until('kept outcome', `!!${lines}[0].querySelector('[data-testid=feedback-outcome][data-outcome]')`, 5000);
    await point(q('app-root'));
    await pause(300);
    const box = await browser.evaluate(`(() => { const card = ${lines}[0].closest('[data-testid=feedback-card]'); card.scrollIntoView({ block: 'center' }); const r = card.getBoundingClientRect(); return { x: r.x - 8, y: r.y - 8, width: r.width + 16, height: r.height + 16 }; })()`);
    const { data } = await browser.send('Page.captureScreenshot', { format: 'png', clip: { ...box, scale: 2 } });
    writeFileSync(join(evidence, '10-card-after.png'), Buffer.from(data, 'base64'));
    summary.screenshots.push(join(evidence, '10-card-after.png'));
    if (existsSync('.card-before.png')) { copyFileSync('.card-before.png', join(evidence, '10-card-before.png')); summary.screenshots.push(join(evidence, '10-card-before.png')); }
    summary.records.card = { save: saveLine.text, plan: (await read(1)).text };
  });

  await step('recording mode (secure origin, fake microphone): Record, red dot and timer; two clicks pin ① ② with no bubble; Done transcribes into two notes', async () => {
    await browser.send('Page.navigate', { url: `${app.url}settings/profile` });
    await browser.until('the secure page', `location.hostname === '127.0.0.1' && isSecureContext && !!(${inChat('composer-feedback')} && !${inChat('composer-feedback')}.disabled)`, 30000);
    await browser.click(inChat('composer-feedback'));
    await browser.until('the feedback bar', `!!${q('feedback-bar')}`, 5000);
    await browser.click(q('feedback-voice'));
    await browser.until('recording', `!!${q('feedback-recording')} && ${q('feedback-voice')}.textContent === 'Stop'`, 10000);
    assert.equal(await browser.evaluate(`${q('feedback-bar-hint')}.textContent`), 'Recording — point and talk');
    assert.match(await browser.evaluate(`${q('feedback-recording-time')}.textContent`), /^\d\d:\d\d$/);
    assert.equal(await browser.evaluate(`!!${q('feedback-voice-problem')}`), false);
    // The fake transcription says two segments: 0–1.5 s and 1.5–3 s of the audio. One click inside each.
    await pause(400);
    await clickAt(SAVE);
    await browser.until('pin ①', `(${DRAWN}).some(item => item.label === '①' && item.tone === 'pinned')`, 5000);
    assert.equal(await browser.evaluate(`!!${q('feedback-bubble')}`), false, 'no note bubble while recording');
    await pause(1300);
    const heading = `${q('notifications')}.querySelector('h2')`;
    await clickAt(heading);
    await browser.until('pin ②', `(${DRAWN}).some(item => item.label === '②' && item.tone === 'pinned')`, 5000);
    assert.equal(await browser.evaluate(`!!${q('feedback-bubble')}`), false);
    assert.equal(await browser.evaluate(`${q('feedback-bar-count')}.textContent`), '0 notes · 2 pins');
    assert.equal(await browser.evaluate(`${q('profile-saved')}.dataset.presses`), '0', 'Save was never pressed');
    await pause(1500);
    await shot('11-recording');
    await browser.evaluate(`(() => { window.__sawTranscribing = false; new MutationObserver(() => { if (${q('feedback-bar')}?.dataset.transcribing === 'true' && ${q('feedback-bar-hint')}?.textContent === 'Transcribing…') window.__sawTranscribing = true; }).observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true }); })()`);
    await browser.click(q('feedback-voice'));
    await browser.until('stopped', `!${q('feedback-recording')} && ${q('feedback-voice')}.textContent === 'Record'`, 5000);
    await browser.click(q('feedback-done'));
    await browser.until('the chip', `!!${inChat('feedback-chip')} && !${q('feedback-bar')}`, 20000);
    assert.equal(await browser.evaluate('window.__sawTranscribing'), true, 'the bar said Transcribing… until the notes were merged');
    assert.equal(await browser.evaluate(`${inChat('feedback-chip-open')}.textContent`), '💬 Feedback · 2 notes · /settings/:section');
    assert.equal(await browser.evaluate(`!!${inChat('feedback-chip-voice')}`), false, 'no transcription problem');
    await browser.click(inChat('feedback-chip-open'));
    await browser.until('the review', `document.querySelectorAll('[data-testid=feedback-review-note]').length === 2`, 5000);
    const notes = await browser.evaluate(`[...document.querySelectorAll('[data-testid=feedback-review-note]')].map(note => ({ name: note.querySelector('[data-testid=feedback-review-name]').textContent, file: note.querySelector('[data-testid=feedback-review-file]')?.textContent, text: note.querySelector('textarea').value, voice: !!note.querySelector('[data-testid=feedback-review-voice]') }))`);
    assert.deepEqual(notes.map(note => [note.name, note.file, note.voice]), [['«Save profile» button', 'SettingsPage.jsx:65', true], ['«Notifications» heading', 'SettingsPage.jsx:70', true]]);
    assert.equal(notes[0].text, 'Fake transcript: this is where the person spoke.');
    assert.match(notes[1].text, /^\(\d+ KB of audio\/webm\)$/);
    summary.records.recording = notes;
    await shot('12-recording-review');
    await browser.click(q('feedback-review-close'));
    await browser.click(inChat('feedback-chip-discard'));
    await browser.until('discarded', `!${inChat('feedback-chip')}`, 5000);
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
