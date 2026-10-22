// The point-mode journey (FEEDBACK.md, "Point mode"): one driven Chromium run of the Fernhill page in its phone layout (`?mobile=1`),
// emulated as a 390x844 phone with touch through the DevTools protocol, the keyless scripted builder (builder.mjs) and the SQLite store.
// Steps: open the assistant (a full-screen panel whose composer has ONE annotate toggle) → the toggle enters point mode: the panel steps aside and CommentBanner sits above the tab bar →
// tap an element and Annuler: the panel comes back with no picks → point again → tap the Facturation tab (navigation while pointing) →
// tap Change plan (the bubble, the page never reacts) → note → re-tap deselects → tap again, note → tap Profil → tap Save profile → note
// → tap a heading and scroll it down to the bar (the bubble stays clear of the bar) → re-tap deselects → Terminé: the panel is back and the composer's count chip holds the two picks → Send attaches the report. Geometry: the bar never overlaps
// the tab bar, the selection or the bubble, and every bar button is at least 44px.
// Screenshots and journey.json go to .cache/evidence/feedback-point/. Manual evidence, not an npm test.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startFeedbackApp } from './server.mjs';
import { launch, pause } from '@hachej/boring-testing/browser';

const evidence = process.env.FEEDBACK_EVIDENCE ?? '.cache/evidence/feedback-point';
const chromium = process.env.CHROMIUM ?? `${process.env.HOME}/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome`;
mkdirSync(evidence, { recursive: true });
const directory = mkdtempSync(join(tmpdir(), 'boring-feedback-point-'));
const steps = [];
const commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const dirty = execFileSync('git', ['status', '--porcelain', '--untracked-files=no'], { encoding: 'utf8' }).trim() !== '';
const summary = { journey: 'feedback-point', commit, dirty, device: 'phone 390x844 touch', startedAt: new Date().toISOString(), model: 'scripted (keyless)', steps, screenshots: [], records: {} };
const step = async (name, run) => { const started = Date.now(); await run(); steps.push({ name, ms: Date.now() - started }); console.log(`ok  ${name} (${Date.now() - started} ms)`); };

const q = testid => `document.querySelector('[data-testid=${JSON.stringify(testid)}]')`;
const PANEL = q('assistant-panel');
const inPanel = testid => `${PANEL}?.querySelector('[data-testid=${JSON.stringify(testid)}]')`;
const BAR = q('feedback-point-bar');
const box = selector => `(() => { const r = (${selector})?.getBoundingClientRect(); return r && r.width ? { top: r.top, bottom: r.bottom, left: r.left, right: r.right, width: r.width, height: r.height } : null; })()`;
const overlap = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
const NOTE_PLAN = 'Montrer le prix avant de changer.';
const NOTE_SAVE = 'Dire ce qui est enregistré.';

const app = await startFeedbackApp({ directory, port: 0 });
let browser;
try {
  browser = await launch('about:blank', { chromium, evidence });
  await browser.emulate('phone');
  await browser.send('Page.navigate', { url: `${app.url}settings/profile?mobile=1` });
  const shot = async name => { await pause(300); await browser.screenshot(`${name}.png`); summary.screenshots.push(join(evidence, `${name}.png`)); };
  const count = () => browser.evaluate(`${q('feedback-point-count')}?.textContent ?? ''`);
  /** The bar against the tab bar, a selected element and the bubble: none overlap, and the bar sits above the tab bar. */
  const geometry = async selected => {
    const found = await browser.evaluate(`({ bar: ${box(BAR)}, tabbar: ${box(q('tabbar'))}, selected: ${selected ? box(selected) : 'null'}, bubble: ${box(q('feedback-bubble'))},
      viewport: { width: innerWidth, height: innerHeight }, targets: [...${BAR}.querySelectorAll('button:not([role=switch])'), ${q('feedback-comment-switch')}?.parentElement].filter(Boolean).map(button => { const r = button.getBoundingClientRect(); return { name: button.textContent || button.dataset.testid || 'the switch', width: r.width, height: r.height }; }) })`);
    assert.ok(found.bar.bottom <= found.tabbar.top, `the bar (${found.bar.bottom}) sits above the tab bar (${found.tabbar.top})`);
    assert.ok(!overlap(found.bar, found.tabbar), 'the bar does not overlap the tab bar');
    if (found.selected) assert.ok(!overlap(found.bar, found.selected), 'the bar does not overlap the selection');
    if (found.bubble) assert.ok(!overlap(found.bar, found.bubble), 'the bar does not overlap the note bubble');
    assert.ok(found.bar.left >= 0 && found.bar.right <= found.viewport.width, 'the bar fits the phone width');
    for (const target of found.targets) assert.ok(target.width >= 44 && target.height >= 44, `${target.name} is at least 44px (${target.width}x${target.height})`);
    return found;
  };

  await browser.until('the phone page', `!!(${q('app-root')} && ${q('tabbar')} && innerWidth === 390)`, 30000);
  await browser.evaluate(`(() => { const hits = window.__journeyHits = { save: 0, submit: 0, plan: 0 };
    document.addEventListener('click', event => { if (event.target.closest?.('[data-testid=save-profile]')) hits.save++; if (event.target.closest?.('[data-testid=change-plan]')) hits.plan++; }, true);
    document.addEventListener('submit', () => hits.submit++, true); })()`);

  await step('open the assistant: a full-screen panel whose composer has exactly one annotate control (44px) and no Feedback block, Show in app or general question', async () => {
    await browser.tap(q('tab-assistant'));
    await browser.until('the panel and its composer', `!!(${PANEL} && !${PANEL}.hidden && ${inPanel('composer-annotate')} && !${inPanel('composer-annotate')}.disabled)`, 30000);
    const panel = await browser.evaluate(box(PANEL));
    assert.deepEqual([panel.top, panel.left, panel.width, panel.height], [0, 0, 390, 844], 'the panel covers the phone');
    const found = await browser.evaluate(`(() => { const form = ${inPanel('composer')}; const toggles = [...form.querySelectorAll('[data-testid=composer-annotate]')]; const r = toggles[0].getBoundingClientRect();
      return { toggles: toggles.length, label: toggles[0].getAttribute('aria-label'), size: [Math.round(r.width), Math.round(r.height)], words: /Retour|Feedback|Montrer dans|question générale|Terminé/i.test(form.innerText),
        gone: ['composer-feedback', 'composer-point', 'feedback-bar', 'feedback-chip', 'feedback-general', 'feedback-count'].filter(id => document.querySelector('[data-testid=' + id + ']')) }; })()`);
    assert.equal(found.toggles, 1);
    assert.equal(found.label, 'Annoter');
    assert.ok(found.size[0] >= 44 && found.size[1] >= 44, `44px target (${found.size})`);
    assert.equal(found.words, false);
    assert.deepEqual(found.gone, []);
    await shot('01-panel');
  });

  await step('the annotate toggle on a phone is point mode: the panel steps aside, the app is visible, the bar sits above the tab bar', async () => {
    await browser.tap(inPanel('composer-annotate'));
    await browser.until('point mode', `!!${BAR} && ${PANEL}.hidden`, 5000);
    assert.equal(await browser.evaluate(`${q('feedback-point-hint')}.textContent`), 'Touchez un élément pour le commenter');
    assert.equal(await count(), '', 'no count before a note says something');
    assert.equal(await browser.evaluate(`${q('feedback-comment-switch')}.getAttribute('aria-checked')`), 'true', 'comment mode is on');
    summary.records.bar = await geometry();
    await shot('02-point-bar');
  });

  await step('Terminé with an empty pin: the panel comes back with no notes', async () => {
    await browser.tap(q('save-profile'));
    await browser.until('the bubble', `!!${q('feedback-bubble-input')}`, 5000);
    await browser.tap(q('feedback-point-done'));
    await browser.until('the panel is back', `!${BAR} && !${PANEL}.hidden`, 5000);
    assert.equal(await browser.evaluate(`!!${inPanel('feedback-count')}`), false, 'no count chip');
    assert.equal(await browser.evaluate(`!!${q('feedback-bubble')}`), false);
  });

  await step('point again and navigate with the tab bar while pointing: the app stays usable', async () => {
    await browser.tap(inPanel('composer-annotate'));
    await browser.until('point mode', `!!${BAR} && ${PANEL}.hidden`, 5000);
    await browser.tap(q('tab-billing'));
    await browser.until('the Billing section', `location.pathname === '/settings/billing' && !!${q('change-plan')}`, 5000);
    assert.equal(await browser.evaluate(`!!${BAR}`), true, 'still pointing');
  });

  await step('tap Change plan: selected with the existing picker (box, pin, bubble); the page never reacts; a re-tap deselects', async () => {
    await browser.tap(q('change-plan'));
    await browser.until('the bubble', `!!${q('feedback-bubble-input')}`, 5000);
    assert.equal(await count(), '', 'an empty pin is not a note yet');
    assert.equal(await browser.evaluate(`!!${q('plan-menu')}`), false, 'the plan menu did not open');
    assert.deepEqual(await browser.evaluate('window.__journeyHits'), { save: 0, submit: 0, plan: 0 }, 'Change plan was not pressed');
    await browser.tap(q('change-plan'));
    await browser.until('deselected', `!${q('feedback-bubble')} && !${q('feedback-point-count')}`, 5000);
    await browser.tap(q('change-plan'));
    await browser.until('the bubble', `document.activeElement === ${q('feedback-bubble-input')}`, 5000);
    await browser.send('Input.insertText', { text: NOTE_PLAN });
    assert.equal(await browser.evaluate(`${q('feedback-cancel-selection')}.textContent`), 'Annuler la sélection');
    const pin = await browser.evaluate(`(() => { const m = ${q('feedback-bubble-mic')}?.getBoundingClientRect(), f = ${q('feedback-bubble-input')}.getBoundingClientRect();
      return { mic: m ? [Math.round(m.width), Math.round(m.height)] : null, inside: !!m && m.left >= f.left && m.right <= f.right && m.bottom <= f.bottom + 1, hint: !!${q('feedback-bubble-hint')}, general: !!${q('feedback-bubble-general')}, buttons: [...${q('feedback-bubble')}.querySelectorAll('button')].map(b => Math.round(b.getBoundingClientRect().height)) }; })()`);
    assert.ok(pin.mic && pin.mic[0] >= 44 && pin.mic[1] >= 44 && pin.inside, `a 44px mic inside the pin's field (${JSON.stringify(pin)})`);
    assert.equal(pin.hint, false, 'no Alt hint on touch');
    assert.equal(pin.general, false, 'no general question');
    assert.ok(pin.buttons.every(height => height >= 44), `44px targets in the pin (${pin.buttons})`);
    summary.records.selection = await geometry(q('change-plan'));
    await shot('03-selection');
  });

  await step('tap Profil, then Save profile: several picks across screens', async () => {
    await browser.tap(q('tab-profile'));
    await browser.until('the Profile section', `location.pathname === '/settings/profile' && !!${q('save-profile')}`, 5000);
    await browser.tap(q('save-profile'));
    await browser.until('the second bubble', `document.activeElement === ${q('feedback-bubble-input')} && ${q('feedback-point-count')}?.textContent === ' · 1 note'`, 5000);
    await browser.send('Input.insertText', { text: NOTE_SAVE });
    assert.deepEqual(await browser.evaluate('window.__journeyHits'), { save: 0, submit: 0, plan: 0 }, 'Save was neither pressed nor submitted');
    summary.records.second = await geometry(q('save-profile'));
    await shot('04-second-pick');
  });

  await step('a selection scrolled down to the bar: the bubble follows and still never covers the bar; a re-tap deselects it', async () => {
    const HEADING = `document.querySelector('[data-testid=exports] h2')`;
    // A finger on the heading where it is (the driver's tap would centre it under the open bubble): scroll it near the top first.
    await browser.evaluate(`window.scrollBy(0, ${HEADING}.getBoundingClientRect().top - 200)`);
    const at = await browser.until('the heading, clear of the bubble', `(() => { const r = ${HEADING}.getBoundingClientRect(), b = ${q('feedback-bubble')}?.getBoundingClientRect(); const x = r.left + 20, y = r.top + r.height / 2;
      return Math.abs(r.top - 200) < 2 && !(b && x >= b.left && x <= b.right && y >= b.top && y <= b.bottom) ? { x, y } : null; })()`, 5000);
    await browser.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [at] });
    await browser.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await browser.until('its bubble', `!!${q('feedback-bubble')} && ${q('feedback-point-count')}?.textContent === ' · 2 notes'`, 5000);
    // Scroll the page up so the selected heading sits 745px down the 844px screen, just above the tab bar and behind CommentBanner.
    await browser.evaluate(`window.scrollBy(0, ${HEADING}.getBoundingClientRect().top - 745)`);
    const low = await browser.until('the selection low on the screen', `(() => { const r = ${HEADING}.getBoundingClientRect(); return Math.abs(r.top - 745) < 2 ? r.top : null; })()`, 5000);
    await pause(200);
    summary.records.scrolled = { selectionTop: low, ...(await geometry()) };
    assert.ok(summary.records.scrolled.bubble, 'the bubble is still open');
    await shot('04b-scrolled');
    await browser.tap(HEADING);
    await browser.until('deselected', `!${q('feedback-bubble')} && ${q('feedback-point-count')}?.textContent === ' · 2 notes'`, 5000);
  });

  await step('Terminé: the panel is back and the picks are the composer\'s count chip', async () => {
    await browser.tap(q('feedback-point-done'));
    await browser.until('the panel with the count chip', `!${BAR} && !${PANEL}.hidden && ${inPanel('feedback-count')}?.dataset.count === '2'`, 10000);
    assert.match(await browser.evaluate(`${inPanel('feedback-count')}.innerText`), /2 notes/);
    assert.equal(await browser.evaluate(`!!${inPanel('feedback-chip')} || !!${inPanel('feedback-bar')}`), false, 'no Feedback block');
    await shot('05-count-chip');
  });

  await step('Send: the report is saved and attached to the message, as feedback attaches today', async () => {
    await browser.until('Send enabled', `!!${inPanel('composer-submit')} && !${inPanel('composer-submit')}.disabled`, 5000);
    await browser.tap(inPanel('composer-submit'));
    await browser.until('sent: the count chip is gone, the message carries the report and the builder read both notes', `!${inPanel('feedback-count')} && /fb_\\w{16}: 2 notes/.test(${PANEL}.innerText)`, 20000);
    const listed = await browser.evaluate(`fetch('/api/feedback', { headers: { authorization: 'Bearer ' + window.__FEEDBACK__.token } }).then(response => response.json())`);
    assert.equal(listed.kind, 'available');
    assert.equal(listed.items.length, 1, 'one stored report');
    summary.records.stored = listed.items.map(item => ({ id: item.id, title: item.title }));
    const stored = await browser.evaluate(`fetch('/api/feedback/${listed.items[0].id}', { headers: { authorization: 'Bearer ' + window.__FEEDBACK__.token } }).then(response => response.json())`);
    assert.deepEqual(stored.report.notes.map(note => note.text), [NOTE_PLAN, NOTE_SAVE], 'the notes typed in the pins are in the stored report');
    summary.records.notes = stored.report.notes.map(note => note.text);
    await shot('06-sent');
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
