// The composer journey (FEEDBACK.md, "UX"): one driven Chromium run (1280x800) of the default Fernhill page, with real pointer and keyboard
// input over the DevTools protocol on an insecure origin, the keyless scripted builder (builder.mjs) and the SQLite store. Steps:
//   the composer has exactly ONE annotate control and no Feedback block → toggle → hover and click Save (pinned, never pressed) → a pin with
//   a text field and a mic inside it, and a hint that ⌥ passes clicks to the app → type a note, Enter → a count chip in the composer →
//   hold ⌥ and use the app (open the Billing section, open the plan menu: both reach the page and are recorded as steps) → release ⌥, click
//   Change plan → the mic says recording needs a secure page and keeps the typed text → Enter → Esc exits annotating, the chip stays →
//   Send → the builder replies citing both elements with file:line → the card's element lines highlight in the page on hover → on a secure
//   origin (127.0.0.1) with Chromium's fake microphone: the mic in a pin records and the transcript lands in the field (run with
//   `env -u TRANSCRIPTION_API_KEY` so the example uses its fake transcription).
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

  await browser.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
  await browser.until('the page and the annotate toggle in the composer', `!!(${q('app-root')} && ${CHAT} && ${inChat('composer-annotate')} && !${inChat('composer-annotate')}.disabled && ${inChat('composer-input')} && !${inChat('composer-input')}.disabled)`, 30000);
  await browser.evaluate(`(() => { const hits = window.__journeyHits = { save: 0, submit: 0, plan: 0 };
    ${SAVE}.addEventListener('click', () => hits.save++); ${SAVE}.closest('form').addEventListener('submit', () => hits.submit++); })()`);
  const session = () => browser.evaluate('(() => { const s = window.__feedbackSession.getSnapshot(); return { phase: s.phase, mode: s.mode, using: s.using, notes: s.notes.length }; })()');

  await step('one annotate control: the toolbar has exactly one, 44px, and no Feedback block, Record, Done, general question or Show in app', async () => {
    const found = await browser.evaluate(`(() => { const form = ${inChat('composer')}; const toggles = [...form.querySelectorAll('[data-testid=composer-annotate]')];
      const r = toggles[0].getBoundingClientRect();
      return { toggles: toggles.length, size: [Math.round(r.width), Math.round(r.height)], label: toggles[0].textContent,
        words: /Feedback|Record|Done|Show in app|general question|Use app/i.test(form.innerText),
        gone: ['composer-feedback', 'composer-point', 'feedback-bar', 'feedback-chip', 'feedback-general', 'feedback-done', 'feedback-voice', 'feedback-count'].filter(id => document.querySelector('[data-testid=' + id + ']')),
        page: ['feedback-point', 'feedback-open-list', 'feedback-dock'].filter(id => document.querySelector('[data-testid=' + id + ']')) }; })()`);
    assert.equal(found.toggles, 1);
    assert.ok(found.size[0] >= 44 && found.size[1] >= 44, `44px target (${found.size})`);
    assert.equal(found.words, false, 'no Feedback block words in the composer');
    assert.deepEqual(found.gone, []);
    assert.deepEqual(found.page, []);
    await shot('01-page');
  });

  await step('toggle: targeting is armed, no bar appears; hovering boxes and labels the element through the privacy policy', async () => {
    await browser.click(inChat('composer-annotate'));
    await browser.until('annotating', `${inChat('composer-annotate')}.getAttribute('aria-pressed') === 'true' && window.__feedbackSession.getSnapshot().phase === 'active'`, 5000);
    assert.equal(await browser.evaluate(`!!${q('feedback-bar')} || !!${q('feedback-bar-hint')}`), false, 'no Feedback bar');
    assert.equal((await session()).mode, 'feedback', 'desktop: pins, not point mode');
    await point(SAVE);
    assert.equal(await browser.until('a hover label', hoverLabel, 5000), 'SettingsPage · button «Save profile»');
    await shot('02-annotate-hover');
  });

  await step('cancel a selection (Esc, a second click on the zone, the Cancel selection button): never stuck on a zone, and no general question anywhere', async () => {
    const live = () => session();
    // Esc from the note.
    await clickAt(SAVE);
    await browser.until('the pin', `!!${q('feedback-bubble-input')}`, 5000);
    await browser.type(q('feedback-bubble-input'), 'never mind');
    await browser.press('Escape');
    await browser.until('the pin is gone', `!${q('feedback-bubble')} && !(${DRAWN}).some(item => item.tone === 'pinned')`, 5000);
    assert.equal((await live()).phase, 'active', 'Esc in the pin did not end annotating');
    // The zone again: a second click clears the selection.
    await clickAt(SAVE);
    await browser.until('the pin', `!!${q('feedback-bubble-input')}`, 5000);
    await clickAt(SAVE);
    await browser.until('the selection is cleared', `!${q('feedback-bubble')} && !(${DRAWN}).some(item => item.tone === 'pinned')`, 5000);
    // The button.
    await clickAt(SAVE);
    await browser.until('the pin', `!!${q('feedback-bubble-input')}`, 5000);
    assert.equal(await browser.evaluate(`${q('feedback-cancel-selection')}.textContent`), 'Cancel selection');
    assert.equal(await browser.evaluate(`!!${q('feedback-bubble-general')} || !!${q('feedback-general')}`), false, 'no general-question button');
    await browser.click(q('feedback-cancel-selection'));
    await browser.until('the selection is cleared', `!${q('feedback-bubble')} && !(${DRAWN}).some(item => item.tone === 'pinned')`, 5000);
    assert.deepEqual(await browser.evaluate('window.__journeyHits'), { save: 0, submit: 0, plan: 0 }, 'the zone was never pressed');
    assert.equal(await browser.evaluate(`!!${inChat('feedback-count')}`), false, 'nothing taken: no count chip');
  });

  await step('click Save: a pin right there with a text field, a mic inside it and a one-line Alt hint; the page never reacts', async () => {
    await clickAt(SAVE);
    await browser.until('the pin', `!!${q('feedback-bubble-input')}`, 5000);
    assert.equal(await browser.evaluate(`${q('feedback-bubble-input')}.placeholder`), "What's wrong here?");
    assert.deepEqual(await browser.evaluate('window.__journeyHits'), { save: 0, submit: 0, plan: 0 }, 'Save was neither clicked nor submitted');
    assert.equal(await browser.evaluate(`${q('profile-saved')}.dataset.presses`), '0');
    const geometry = await browser.evaluate(`(() => { const f = ${q('feedback-bubble-input')}.getBoundingClientRect(), m = ${q('feedback-bubble-mic')}.getBoundingClientRect(); const hint = ${q('feedback-bubble-hint')};
      return { inside: m.left >= f.left && m.right <= f.right && m.top >= f.top && m.bottom <= f.bottom, mic: [Math.round(m.width), Math.round(m.height)], hint: hint.textContent, lines: Math.round(hint.getBoundingClientRect().height / parseFloat(getComputedStyle(hint).lineHeight || 16)), buttons: [...${q('feedback-bubble')}.querySelectorAll('button')].map(b => [b.textContent, Math.round(b.getBoundingClientRect().height)]) }; })()`);
    assert.equal(geometry.inside, true, 'the mic is inside the text field');
    assert.ok(geometry.mic[0] >= 44 && geometry.mic[1] >= 44, `44px mic (${geometry.mic})`);
    assert.match(geometry.hint, /Hold ⌥ to use the app/, 'desktop: Alt passes clicks to the app');
    assert.equal(geometry.lines, 1, 'a one-line hint');
    for (const [name, height] of geometry.buttons) assert.ok(height >= 44, `${name || 'mic'} is 44px (${height})`);
    await browser.type(q('feedback-bubble-input'), NOTE_SAVE);
    await shot('03-pin');
    await browser.press('Enter');
    await browser.until('the note is kept and counted in the composer', `!${q('feedback-bubble')} && ${inChat('feedback-count')}?.dataset.count === '1'`, 5000);
    assert.equal(await browser.evaluate(`${inChat('feedback-count')}.innerText.trim()`), '1 note');
    assert.ok((await browser.evaluate(DRAWN)).some(item => item.label === '①' && item.tone === 'pinned'), 'pin ① stays on the page');
    assert.equal(await browser.evaluate(boxOver(SAVE, 'pinned')), true);
  });

  await step('hold ⌥ and use the app: the Billing section opens and the plan menu opens; both are recorded as steps', async () => {
    await alt('rawKeyDown');
    await browser.until('using the app', `window.__feedbackSession.getSnapshot().using === true`, 5000);
    await clickAt(q('section-billing'), { alt: true });
    await browser.until('the Billing section', `location.pathname === '/settings/billing' && !!${PLAN}`, 5000);
    await browser.evaluate(`${PLAN}.addEventListener('click', () => window.__journeyHits.plan++)`);
    await clickAt(PLAN, { alt: true });
    await browser.until('the plan menu', `!!${q('plan-menu')}`, 5000);
    assert.equal(await browser.evaluate('window.__journeyHits.plan'), 1, 'the click reached the app');
    await shot('04-using-the-app');
    await alt('keyUp');
    await browser.until('back to commenting', `window.__feedbackSession.getSnapshot().using === false`, 5000);
  });

  await step('release ⌥ and click Change plan: a second pin; the mic on this insecure origin says so and keeps the typed text; the menu does not toggle', async () => {
    await clickAt(PLAN);
    await browser.until('the pin', `!!${q('feedback-bubble-input')}`, 5000);
    assert.equal(await browser.evaluate('window.__journeyHits.plan'), 1, 'the pin click never reached the app');
    assert.equal(await browser.evaluate(`!!${q('plan-menu')}`), true, 'the menu is still open');
    await browser.type(q('feedback-bubble-input'), NOTE_PLAN);
    await browser.click(q('feedback-bubble-mic'));
    assert.equal(await browser.until('the voice problem', `${q('feedback-bubble-voice-problem')}?.textContent`, 5000), 'Recording needs a secure page (https or localhost).');
    assert.equal(await browser.evaluate(`${q('feedback-bubble-input')}.value`), NOTE_PLAN, 'a failed mic keeps the typed text');
    assert.equal(await browser.evaluate(`(() => { const f = ${q('feedback-bubble-input')}.getBoundingClientRect(), m = ${q('feedback-bubble-mic')}.getBoundingClientRect(); return m.left >= f.left && m.right <= f.right && m.bottom <= f.bottom + 1; })()`), true, 'the mic stays inside the field when an error is shown');
    await shot('05-mic-insecure');
    await browser.click(q('feedback-bubble-input'));
    await browser.press('Enter');
    await browser.until('two notes', `${inChat('feedback-count')}?.dataset.count === '2'`, 5000);
    assert.ok((await browser.evaluate(DRAWN)).some(item => item.label === '②' && item.tone === 'pinned'));
    await shot('05b-second-pin');
  });

  await step('Esc exits annotating: the toggle is off, the pins are gone from the page, the composer keeps the "2 notes" chip; the toggle resumes and a third note joins them', async () => {
    await browser.press('Escape');
    await browser.until('not annotating', `${inChat('composer-annotate')}.getAttribute('aria-pressed') === 'false' && window.__feedbackSession.getSnapshot().phase === 'review'`, 10000);
    assert.equal(await browser.evaluate(`${inChat('feedback-count')}.innerText.trim()`), '2 notes');
    assert.deepEqual((await browser.evaluate(DRAWN)).filter(item => item.tone === 'pinned' || item.tone === 'hover'), [], 'no pins or hover once annotating is off');
    assert.equal(await browser.evaluate(`!!${inChat('feedback-chip')} || !!${q('feedback-bar')}`), false, 'no Feedback block');
    await shot('06-count-chip');
    assert.equal(await browser.evaluate(`${inChat('composer-annotate')}.disabled`), false, 'pending notes do not block annotating');
    await browser.click(inChat('composer-annotate'));
    await browser.until('resumed with the notes kept', `${inChat('composer-annotate')}.getAttribute('aria-pressed') === 'true' && ${inChat('feedback-count')}?.dataset.count === '2'`, 5000);
    await browser.press('Escape');
    await browser.until('not annotating', `${inChat('composer-annotate')}.getAttribute('aria-pressed') === 'false' && window.__feedbackSession.getSnapshot().phase === 'review'`, 10000);
    assert.equal(await browser.evaluate(`${inChat('feedback-count')}.dataset.count`), '2');
  });

  let id;
  await step('Send: the report is saved and attached; the builder replies citing both elements with file:line', async () => {
    await browser.type(inChat('composer-input'), 'Please fix these.');
    await browser.press('Enter');
    await browser.until('the count chip is gone', `!${inChat('feedback-count')}`, 10000);
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

  await step('the mic in a pin (secure origin, fake microphone): record, stop, the transcript lands in the field after the typed text; a failed one never loses it', async () => {
    await browser.send('Page.navigate', { url: `${app.url}settings/profile` });
    await browser.until('the secure page', `location.hostname === '127.0.0.1' && isSecureContext && !!(${inChat('composer-annotate')} && !${inChat('composer-annotate')}.disabled)`, 30000);
    await browser.click(inChat('composer-annotate'));
    await browser.until('annotating', `window.__feedbackSession.getSnapshot().phase === 'active'`, 5000);
    await clickAt(SAVE);
    await browser.until('the pin', `!!${q('feedback-bubble-input')}`, 5000);
    await browser.type(q('feedback-bubble-input'), 'Typed first.');
    await browser.click(q('feedback-bubble-mic'));
    await browser.until('recording', `${q('feedback-bubble-mic')}.dataset.state === 'recording'`, 10000);
    await pause(1200);
    await shot('07-pin-recording');
    await browser.click(q('feedback-bubble-mic'));
    await browser.until('the transcript is in the field', `${q('feedback-bubble-input')}.value.startsWith('Typed first. ') && ${q('feedback-bubble-input')}.value.includes('Fake transcript')`, 20000);
    assert.equal(await browser.evaluate(`!!${q('feedback-bubble-voice-problem')}`), false, 'no transcription problem');
    const spoken = await browser.evaluate(`${q('feedback-bubble-input')}.value`);
    summary.records.spoken = spoken;
    // A transcription the server refuses keeps everything typed and says so.
    await browser.evaluate(`(() => { const real = window.fetch; window.__realFetch = real; window.fetch = (input, init) => /\\/api\\/transcribe/.test(String(input?.url ?? input)) ? Promise.resolve(new Response('no', { status: 502 })) : real(input, init); })()`);
    await browser.click(q('feedback-bubble-mic'));
    await browser.until('recording again', `${q('feedback-bubble-mic')}.dataset.state === 'recording'`, 10000);
    await pause(600);
    await browser.click(q('feedback-bubble-mic'));
    await browser.until('the failure is said', `!!${q('feedback-bubble-voice-problem')}`, 20000);
    assert.equal(await browser.evaluate(`${q('feedback-bubble-input')}.value`), spoken, 'the field is unchanged by a failed transcription');
    await browser.evaluate('window.fetch = window.__realFetch');
    await shot('08-pin-voice-failed');
    await browser.click(q('feedback-bubble-input'));
    await browser.press('Enter');
    await browser.until('counted', `${inChat('feedback-count')}?.dataset.count === '1'`, 5000);
    await browser.click(inChat('feedback-count-clear'));
    await browser.until('removed', `!${inChat('feedback-count')} && window.__feedbackSession.getSnapshot().phase === 'idle'`, 5000);
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
