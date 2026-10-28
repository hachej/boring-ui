// Behaviour journey for « Améliorer l'app » (spec 1 §10 and spec 2's checklist) on the fictional Coach Max app, phone and desktop.
// Every check drives the public AppShell `improve` entry and the real picker, composer and remote chat; nothing calls a library directly.
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync } from 'node:fs';
import { launch, pause, q } from '@hachej/boring-testing/browser';
import { startPmPanel } from './server.mjs';

const evidence = process.env.PM_EVIDENCE ?? '.cache/evidence/pm-panel/journey';
mkdirSync(evidence, { recursive: true });
// PM_ONE_LINE=1 runs the same journey on the app whose only PM code is `improve={{ agent: 'pm' }}` (the fake #854 door, dictation on the host's /api/host/transcribe); the task-board
// seam (request card, « Mes demandes », @ tasks) is host data that one line does not bring, so those steps run on the host-wired fixture only.
const oneLine = process.env.PM_ONE_LINE === '1';
if (oneLine) {
  const source = readFileSync(new URL('./oneline.tsx', import.meta.url), 'utf8').replace(/^\s*\/\/.*$/gm, '');
  assert.match(source, /improve=\{\{ agent: 'pm' \}\}/);
  assert.doesNotMatch(source, /useRemoteChat|controller|transcribe|identity|fetch\(/, 'the one line is the only PM code of the app');
}
const app = await startPmPanel({ oneLine });
let browser;
const visible = selector => `!!${q(selector)} && ${q(selector)}.getClientRects().length > 0`;
const mode = value => `${q('[data-testid=pm-panel]')}?.dataset.mode === '${value}'`;
const pinLabels = `[...document.querySelectorAll('[data-feedback-overlay]')].flatMap(host => [...(host.shadowRoot?.querySelectorAll('.label') ?? [])].filter(label => getComputedStyle(label).display !== 'none').map(label => label.textContent))`;
const chips = `[...document.querySelectorAll('[data-testid=pm-chip]')].map(chip => chip.dataset.n + ' ' + chip.title.split(' · ').slice(1).join(' · '))`;
const activated = () => browser.evaluate('(window.__activated ?? []).length');
let device;
const press = selector => device === 'phone' ? browser.tap(q(selector)) : browser.click(q(selector));

/** Spec 2 rule: in C2–C6 the panel takes layout space. No app element's visible rectangle meets the panel, and hit tests reach the page. */
async function uncovered(stage) {
  const result = await browser.evaluate(`(() => {
    const panel = ${q('[data-testid=pm-panel]')}.getBoundingClientRect(), page = ${q('[data-pm-page]')}.getBoundingClientRect();
    const items = [...document.querySelectorAll('[data-pm-page] *')].filter(node => node.getClientRects().length);
    const clipped = rect => ({ top: Math.max(rect.top, page.top), bottom: Math.min(rect.bottom, page.bottom), left: rect.left, right: rect.right });
    const meets = items.filter(node => { const r = clipped(node.getBoundingClientRect()); return r.bottom > r.top && r.bottom > panel.top + 0.5 && r.top < panel.bottom - 0.5; }).length;
    const hits = items.filter(node => node.children.length === 0 && node.textContent.trim()).filter(node => { const r = node.getBoundingClientRect(); const y = r.top + Math.min(r.height / 2, 4);
      return y > page.top && y < page.bottom && r.left + 2 < innerWidth; }).every(node => { const r = node.getBoundingClientRect(); const hit = document.elementFromPoint(r.left + 2, r.top + Math.min(r.height / 2, 4)); return !hit || !hit.closest('[data-testid=pm-panel]'); });
    return { meets, hits, pageBottom: page.bottom, panelTop: panel.top, position: getComputedStyle(${q('[data-testid=pm-panel]')}).position, overflow: document.documentElement.scrollWidth > innerWidth };
  })()`);
  assert.equal(result.meets, 0, `${stage}: no app element meets the panel ${JSON.stringify(result)}`);
  assert.equal(result.hits, true, `${stage}: hit tests reach the page`);
  assert.ok(result.pageBottom <= result.panelTop + 0.5, `${stage}: the page ends above the panel`);
  assert.ok(!['absolute', 'fixed'].includes(result.position), `${stage}: the panel is in flow`);
  assert.equal(result.overflow, false, stage);
}
async function openSheet() {
  if (device === 'phone') await browser.tap(q('[data-testid=account-button]')); else await browser.click(q('[data-testid=nav-user]'));
  await browser.until('account entry', visible('[data-testid=account-improve]'));
  await pause(400);
  await press('[data-testid=account-improve]');
  await browser.until('C2 sheet', `${mode('sheet')} && ${visible('[data-testid=pm-sheet]')}`, 12000);
}

try {
  browser = await launch('about:blank', { evidence, args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
  for (device of ['phone', 'desktop']) {
    await browser.emulate(device);
    await browser.send('Page.navigate', { url: `${app.url}?scroll=1` });
    await browser.until('Coach Max', visible('[data-testid=card-a]'), 20000);
    await openSheet();
    await browser.evaluate('window.__activated = []');

    // C2: no backdrop, the page stays live under the sheet, the tab bar is hidden, the header is ^ and ×, no « Mes demandes ».
    await uncovered(`${device} C2`);
    assert.equal(await browser.evaluate(`${q('[data-pm-navigation]')}.hidden`), true, 'the sheet hides the tab bar');
    assert.deepEqual(await browser.evaluate(`[...${q('[data-testid=pm-sheet]')}.querySelectorAll('h2 ~ button')].map(b => b.getAttribute('aria-label'))`), ['Ouvrir le panneau', 'Fermer']);
    assert.equal(await browser.evaluate(`!!${q('[data-testid=pm-requests]')}`), false, '« Mes demandes » is only in C7');
    await press('[data-testid=gauge]');
    assert.equal(await activated(), 1, 'a page control above the sheet still works (no backdrop)');
    assert.equal(await browser.evaluate(`${q('[data-testid=pm-show]')}.getAttribute('aria-pressed') + '|' + ${q('[data-testid=pm-show]')}.textContent.trim()`), 'false|', 'Montrer is an icon only (R1)');

    // Draft persistence: × and reopen keep the draft.
    await browser.type(q('[data-testid=composer-input]'), 'Brouillon fictif');
    await press('[data-testid=pm-close]');
    await browser.until('closed', `${q('[data-testid=pm-panel]')}.hidden`);
    await openSheet();
    assert.equal(await browser.evaluate(`${q('[data-testid=composer-input]')}.value`), 'Brouillon fictif', 'the draft persists across × and reopen');
    await browser.evaluate(`(() => { const input = ${q('[data-testid=composer-input]')}; const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set; set.call(input, ''); input.dispatchEvent(new Event('input', { bubbles: true })); })()`);

    // C3: Montrer shows the strip without recording: hint · mic · « ✓ Terminer », no toggle, no timer; the tab bar shows and navigates.
    await press('[data-testid=pm-show]');
    await browser.until('C3', `${mode('point')} && ${visible('[data-testid=pm-strip]')}`);
    assert.equal(await browser.evaluate(`${q('[data-testid=pm-strip]')}.dataset.phase`), 'idle');
    assert.equal(await browser.evaluate(`!!${q('[data-testid=pm-strip] [role=radiogroup]')} || !!${q('[data-testid=pm-timer]')}`), false, 'no toggle and no timer before the mic');
    assert.equal(await browser.evaluate(`${q('[data-testid=pm-hint]')}.textContent`), 'Touchez ce que vous voulez montrer');
    if (device === 'phone') {
      assert.equal(await browser.evaluate(`Math.round(${q('[data-testid=pm-strip]')}.getBoundingClientRect().height)`), 60, 'R2: the strip is 60px');
      assert.equal(await browser.evaluate(`${q('[data-pm-navigation]')}.hidden`), false, 'the tab bar shows under the strip');
      assert.ok(await browser.evaluate(`${q('[data-testid=pm-strip]')}.getBoundingClientRect().bottom <= ${q('[data-testid=tabbar]')}.getBoundingClientRect().top + 0.5`), 'the strip sits directly above the tab bar');
    }
    await uncovered(`${device} C3`);

    if (device === 'desktop') {
      // Web width, a mouse: click to comment (spec 1 §3b). A click in point.idle opens the popover at the pin with focus in the field.
      const comment = q('[data-testid=pm-comment]'), field = q('[data-testid=pm-comment-input]');
      const commentOpen = stage => browser.until(stage, `!!${comment} && ${comment}.style.visibility !== 'hidden' && document.activeElement === ${field}`);
      await press('[data-testid=gauge]');
      await commentOpen('comment popover');
      assert.equal(await browser.evaluate(`${comment}.getAttribute('aria-label')`), 'Commenter Jauge · Protéines');
      assert.equal(await browser.evaluate(`${field}.placeholder + '|' + ${q('[data-testid=pm-comment-send]')}.getAttribute('aria-label')`), 'Votre commentaire…|Envoyer au PM');
      // Enter sends one message with that pick straight to the PM; the panel stays on the strip, the draft is unchanged.
      const sent = app.submits.length;
      await browser.type(field, 'Les grammes ici');
      await browser.press('Enter');
      await browser.until('Envoyé au PM', `!${comment} && ${q('[data-testid=pm-hint]')}?.textContent === 'Envoyé au PM' && ${pinLabels}.length === 0 && ${mode('point')}`);
      for (let wait = 0; wait < 50 && app.submits.length === sent; wait++) await pause(100);
      assert.equal(app.submits.length, sent + 1, 'one message');
      assert.equal(await browser.evaluate(mode('point')), true, 'a comment does not open the full panel');
      // Esc cancels the pick and closes the popover.
      await press('[data-testid=gauge]'); await commentOpen('again');
      await browser.press('Escape');
      await browser.until('cancelled', `!${comment} && ${pinLabels}.length === 0 && ${mode('point')}`);
      // A click outside with text keeps the pick and its text in the draft and picks nothing; « Ajouter au message » does the same.
      await press('[data-testid=gauge]'); await commentOpen('gauge');
      await browser.type(field, 'Jauge trop petite');
      await press('[data-testid=card-a]');
      await browser.until('kept', `!${comment} && JSON.stringify(${pinLabels}) === '["1"]'`);
      await press('[data-testid=card-a]'); await commentOpen('card');
      await browser.click(q('[data-testid=pm-comment-add]'));
      await browser.click(field); await browser.type(field, 'Carte');
      await browser.press('Enter');
      await browser.until('two pins', `!${comment} && JSON.stringify(${pinLabels}) === '["1","2"]'`);
      assert.equal(await activated(), 1, 'clicks in select mode never trigger the app');
    } else {
    // Select mode: a tap selects and never activates; tapping a picked element removes it; numbers stay in order.
    await press('[data-testid=card-a]'); await press('[data-testid=gauge]');
    await browser.until('two pins', `JSON.stringify(${pinLabels}) === '["1","2"]'`);
    assert.equal(await activated(), 1, 'taps in select mode never trigger the app');
    assert.match(await browser.evaluate(`${q('[data-testid=pm-announce]')}.textContent`), /^Élément 2 ajouté : Jauge · Protéines$/);
    await press('[data-testid=card-a]');
    await browser.until('renumbered', `JSON.stringify(${pinLabels}) === '["1"]'`);
    assert.match(await browser.evaluate(`${q('[data-testid=pm-announce]')}.textContent`), /^Élément 1 retiré$/);
    await press('[data-testid=card-a]');
    await browser.until('card again', `JSON.stringify(${pinLabels}) === '["1","2"]'`);
    }
    const pin = await browser.evaluate(`(() => { const label = [...document.querySelectorAll('[data-feedback-overlay]')].flatMap(h => [...(h.shadowRoot?.querySelectorAll('.label') ?? [])]).find(l => l.textContent === '1').getBoundingClientRect(); const box = ${q('[data-testid=gauge]')}.getBoundingClientRect(); return { w: label.width, h: label.height, cx: label.left + label.width / 2 - box.right, cy: label.top + label.height / 2 - box.top }; })()`);
    assert.deepEqual([pin.w, pin.h], [24, 24], 'R3: a 24px pin');
    assert.ok(Math.abs(pin.cx) <= 1 && Math.abs(pin.cy) <= 1, `R3: centred on the top-right corner ${JSON.stringify(pin)}`);
    if (device === 'phone') {
      await browser.tap(q('[data-testid=tab-progress]'));
      await browser.until('the tab bar navigates in select mode', visible('[data-testid=card-b]'));
      assert.equal(await browser.evaluate(`JSON.stringify(${pinLabels})`), '[]', 'pins show only on their own screen');
      await browser.tap(q('[data-testid=tab-day]'));
      await browser.until('pins come back on their screen', `JSON.stringify(${pinLabels}) === '["1","2"]'`);
    }

    // C4: the mic starts recording; toggle · hint · timer · « ✓ Terminer » in that order. No pause and no × in the strip (spec 1 §1–2).
    await browser.until('mic ready', `!${q('[data-testid=pm-strip] [data-testid=pm-mic]')}.disabled`);
    await press('[data-testid=pm-strip] [data-testid=pm-mic]');
    await browser.until('C4', `${q('[data-testid=pm-strip]')}.dataset.phase === 'rec' && ${visible('[data-testid=pm-timer]')}`, 15000);
    // Some audio before the picks and Terminer, as a person speaks (the paused-timer check that used to wait here went with the pause button).
    await browser.until('recorded time', `${q('[data-testid=pm-timer]')}.textContent >= '0:02'`, 15000);
    const order = await browser.evaluate(`[...${q('[data-testid=pm-strip]')}.querySelectorAll('[role=radiogroup], [data-testid=pm-hint], [data-testid=pm-timer], [data-testid=pm-pause], [data-testid=pm-mic], [data-testid=pm-done]')].map(n => n.getAttribute('role') ?? n.dataset.testid)`);
    assert.deepEqual(order, ['radiogroup', 'pm-hint', 'pm-timer', 'pm-done']);
    assert.deepEqual(await browser.evaluate(`(() => { const b = ${q('[data-testid=pm-done]')}; return { label: b.getAttribute('aria-label'), text: b.textContent, check: !!b.querySelector('.lucide-check'), x: !!${q('[data-testid=pm-strip] .lucide-x')} }; })()`),
      { label: 'Terminer : relire dans le composer', text: 'Terminer', check: true, x: false }, 'the labelled « ✓ Terminer » pill replaces ×');
    if (device === 'phone') {
      // C4 at 390px: the pill never shrinks (44 high, its whole label); the hint takes at most two right-aligned lines, never clipped or
      // ellipsised, and shortens to « Parlez et touchez » when the whole one would need a third.
      const strip = await browser.evaluate(`(() => { const h = ${q('[data-testid=pm-hint]')}, s = getComputedStyle(h), r = h.getBoundingClientRect(), d = ${q('[data-testid=pm-done]')}, dr = d.getBoundingClientRect();
        return { width: innerWidth, text: h.textContent, lines: Math.round(r.height / parseFloat(s.lineHeight)), clipped: h.scrollHeight > h.clientHeight + 1 || h.scrollWidth > h.clientWidth + 1, overflow: s.overflow, clamp: s.webkitLineClamp, align: s.textAlign,
          pill: { height: Math.round(dr.height), full: d.scrollWidth <= d.clientWidth + 1, shrink: getComputedStyle(d.parentElement).flexShrink, inside: dr.right <= innerWidth } }; })()`);
      console.log('C4 at 390px:', JSON.stringify(strip));
      assert.ok(['Parlez et touchez ce que vous montrez', 'Parlez et touchez'].includes(strip.text), strip.text);
      assert.ok(strip.lines >= 1 && strip.lines <= 2, `the C4 hint takes ${strip.lines} lines`);
      assert.deepEqual({ ...strip, text: undefined, lines: undefined }, { width: 390, text: undefined, lines: undefined, clipped: false, overflow: 'visible', clamp: 'none', align: 'right', pill: { height: 44, full: true, shrink: '0', inside: true } }, 'the C4 hint is never truncated at 390px; the pill never shrinks');
    } else assert.equal(await browser.evaluate(`${q('[data-testid=pm-hint]')}.textContent`), 'Parlez et touchez ce que vous montrez');
    // R7: the timer opens the dictaphone; Montrer brings the strip back in the same state.
    await press('[data-testid=pm-timer]');
    await browser.until('dictaphone', `${mode('sheet')} && ${visible('[data-testid=voice-recording-bar]')}`);
    await press('[data-testid=pm-show]');
    await browser.until('back to the strip', `${mode('point')} && ${q('[data-testid=pm-strip]')}.dataset.phase === 'rec'`);

    // C5: navigate hides the hint and lets taps through; recording continues across screens.
    await press('[data-testid=pm-navigate]');
    await browser.until('C5', mode('navigate'));
    assert.equal(await browser.evaluate(`!!${q('[data-testid=pm-hint]')}`), false, 'no hint in navigate mode');
    if (device === 'phone') await browser.tap(q('[data-testid=tab-progress]')); else await browser.click(q('[data-testid=nav-progress]'));
    await browser.until('Progrès while recording', visible('[data-testid=card-b]'));
    const before = await activated();
    await press('[data-testid=card-b]');
    assert.equal(await activated(), before + 1, 'navigate: the tap goes through to the app');
    assert.equal(await browser.evaluate(`${q('[data-testid=pm-strip]')}.dataset.phase`), 'rec', 'recording continues across screens');
    if (device === 'phone') await uncovered(`${device} C5`);
    if (device === 'phone') await browser.tap(q('[data-testid=tab-day]')); else await browser.click(q('[data-testid=nav-day]'));
    await browser.until('Ma journée', visible('[data-testid=card-a]'));

    // « ✓ Terminer » (phone) or Esc (desktop) gives the review: chips merged by time, the meta line, send enabled, pins kept on the page.
    if (device === 'phone') await browser.tap(q('[data-testid=pm-done]')); else await browser.press('Escape');
    await browser.until('C6', `${mode('sheet')} && ${visible('[data-testid=pm-review-hint]')} && document.querySelectorAll('[data-testid=pm-chip]').length === 2 && !${q('[data-testid=pm-transcribing]')}`, 15000);
    assert.deepEqual(await browser.evaluate(chips), ['1 Jauge · Protéines', '2 Carte · Déjeuner']);
    // One line: dictation goes to the host's route (POST /api/host/transcribe?language=fr), not the PM agent's door.
    if (oneLine) assert.deepEqual(app.transcribes.map(call => call.language).slice(-1), ['fr'], 'the host transcribed the recording, in French');
    // C6: the editor has focus and the caret sits after the last character, ready to type.
    await browser.until('caret at the end', `(() => { const editor = ${q('[data-testid=composer-input][contenteditable=true]')}, s = getSelection(); if (document.activeElement !== editor || !s.rangeCount || !s.isCollapsed) return false;
      const tail = document.createRange(); tail.selectNodeContents(editor); tail.setStart(s.getRangeAt(0).endContainer, s.getRangeAt(0).endOffset); return tail.toString() === ''; })()`, 5000);
    assert.match(await browser.evaluate(`${q('[data-testid=pm-meta]')}.textContent`), /^Dicté · \d:\d\d · 2 captures · modifiable$/);
    assert.equal(await browser.evaluate(`${q('[data-testid=composer-submit]')}.disabled`), false, 'send enabled');
    assert.equal(await browser.evaluate(`!!${q('[data-testid=pm-expand]')} || !!${q('[data-testid=pm-close]')}`), false, 'C6: no ^ and no ×');
    assert.equal(await browser.evaluate(`JSON.stringify(${pinLabels}.sort())`), '["1","2"]', 'C6: the picked elements keep their pins');
    await uncovered(`${device} C6`);
    // The text is editable around the chips; the caret never rests inside a chip (pi's C6 regression).
    const editor = '[data-testid=composer-input][contenteditable=true]';
    await browser.click(q(`${editor} [data-pm-marker]`));
    await browser.send('Input.insertText', { text: ' précision' });
    assert.match(await browser.evaluate(`${q(editor)}.textContent`), /précision/, 'clicking a chip leaves the caret after it, and typing works');
    // Backspace removes a whole chip, renumbers the rest and drops its pin.
    await browser.evaluate(`(() => { const editor = ${q(editor)}; const chip = editor.querySelectorAll('[data-pm-marker]')[1]; const range = document.createRange(); range.setStartAfter(chip); range.collapse(true); const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range); editor.focus(); })()`);
    await browser.press('Backspace');
    await browser.until('one chip left', `document.querySelectorAll('[data-testid=pm-chip]').length === 1`);
    assert.deepEqual(await browser.evaluate(chips), ['1 Jauge · Protéines']);
    await browser.until('one pin', `JSON.stringify(${pinLabels}) === '["1"]'`);

    // Send: text, capture and pick metadata travel together; the draft and pins clear; C7 opens.
    const sent = app.submits.length;
    await press('[data-testid=composer-submit]');
    await browser.until('C7', `${mode('full')} && ${visible('[data-testid=pm-sent-message]')} && ${visible(oneLine ? '[data-testid=pm-reply]' : '[data-task-card=D-201][data-variant=compact]')}`, 20000);
    assert.equal(app.submits.length, sent + 1, 'one native admission');
    const body = JSON.stringify(app.submits.at(-1).body);
    for (const field of ['pm.points@1', 'dictatedMs', '\\"t\\":', 'selector', 'imageIndex', 'image/png', 'Jauge']) assert.ok(body.includes(field), `the message carries ${field}`);
    assert.equal(await browser.evaluate(`document.querySelectorAll('[data-testid=pm-chip]').length + ${pinLabels}.length`), 0, 'the draft and the pins clear');
    assert.equal(await browser.evaluate(`getComputedStyle(${q('[data-testid=pm-panel]')}).position`), 'absolute', 'only C7 overlays the page');
    assert.equal(await browser.evaluate(`Math.round(${q('[data-testid=pm-panel]')}.getBoundingClientRect().top)`), 40, 'C7 starts 40px from the top');
    assert.equal(await browser.evaluate(`${q('[data-testid=pm-title]')}.nextElementSibling.textContent`), 'Le chef de projet · Coach Max');
    assert.equal(await browser.evaluate(`!!${q('[data-testid=pm-reply] [data-testid=pm-reply]')} || getComputedStyle(${q('[data-testid=pm-reply] p')}).backgroundColor`), 'rgba(0, 0, 0, 0)', 'the PM reply has no bubble');
    assert.match(await browser.evaluate(`[...document.querySelectorAll('[data-testid=pm-sent-meta]')].at(-1).textContent`), /^Dicté · \d:\d\d · 1 capture$/);
    if (!oneLine) {
      // « Modifier » puts the request text in the composer; « Confirmer » changes the status pill.
      await press('[data-testid=pm-request-modify]');
      await browser.until('modify', `${q('[data-testid=pm-panel] [data-testid=composer-input]')}.value === 'Protéines avant les calories sur les cartes repas'`);
      // The shared compact card (task-board): « À confirmer » until the host takes the request off the viewer.
      assert.equal(await browser.evaluate(`${q('[data-task-card=D-201][data-variant=compact] [data-task-status]')}.textContent`), 'À confirmer');
      await press('[data-testid=pm-request-confirm]');
      await browser.until('confirmed', `!${q('[data-task-card=D-201] [data-task-status]')} && !${q('[data-testid=pm-request-confirm]')}`);
      // « Mes demandes »: the shared board, compact, with « ‹ Retour ».
      await press('[data-testid=pm-requests]');
      await browser.until('Mes demandes', `${visible('[data-testid=pm-task-board-seam]')} && JSON.stringify([...document.querySelectorAll('[data-testid=pm-task-board-seam] [data-boring=task-board][data-variant=compact] [data-task-card]')].map(card => card.dataset.taskCard)) === '["D-201","D-202","D-203"]'`);
      await press('[data-testid=pm-requests-back]');
      await browser.until('thread again', visible('[data-testid=pm-sent-message]'));

      // @ task mention: the header carries the query, the viewer's tasks only, Enter inserts, the chip opens the task.
      const input = '[data-testid=pm-panel] [data-testid=composer-input]';
      await browser.evaluate(`(() => { const input = ${q(input)}; const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set; set.call(input, ''); input.dispatchEvent(new Event('input', { bubbles: true })); input.focus(); })()`);
      await browser.type(q(input), 'Avant de commencer, @d-2');
      await browser.until('listbox', `document.querySelectorAll('[data-testid=pm-mention-row]').length === 3`);
      assert.equal(await browser.evaluate(`${q('[data-testid=pm-mention-header]')}.textContent`), 'TÂCHES · d-2');
      assert.equal(await browser.evaluate(`${q('[data-testid=mention-menu]')}.getBoundingClientRect().bottom <= ${q(input)}.getBoundingClientRect().top`), true, 'the listbox opens above the composer');
      // D-201 was just confirmed, so it no longer waits on the viewer: no « À vous » (D9 in journey-studio checks the marker).
      assert.match(await browser.evaluate(`${q('[data-testid=pm-mention-row]')}.textContent`), /^D-201Protéines avant les calories sur les cartes repas$/);
      // The first row is the highlighted one; a mouse resting over the list moves it, ↑ brings it back (keyboard, spec 1 §8).
      for (let index = 1; index > 0;) {
        index = await browser.evaluate(`[...document.querySelectorAll('[data-testid=mention-item]')].findIndex(row => row.getAttribute('aria-selected') === 'true')`);
        if (index > 0) await browser.press('ArrowUp');
      }
      await browser.press('Enter');
      await browser.until('task chip', visible('[data-testid=mention-chip]'));
      assert.match(await browser.evaluate(`${q('[data-testid=mention-chip]')}.textContent`), /@ D-201 · Protéines avant/);
      // The label opens the task and stays clear of « Retirer », however long the title (the desktop chip is narrower).
      assert.equal(await browser.evaluate(`(() => { const b = ${q('[data-testid=mention-chip] button')}, r = b.getBoundingClientRect(); return b.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)); })()`), true);
      await browser.click(q('[data-testid=mention-chip] button'));
      assert.deepEqual(await browser.evaluate('window.__presented'), ['D-201'], 'the chip opens the task');
      await browser.evaluate('window.__presented = []');
    }
    // Back closes the panel step by step and never leaves the app page: full panel, then the sheet, then closed; the strip closes too.
    const href = await browser.evaluate('location.href');
    await browser.evaluate('history.back()');
    await browser.until('Back: full → sheet', mode('sheet'));
    await browser.evaluate('history.back()');
    await browser.until('Back: sheet → closed', `${q('[data-testid=pm-panel]')}.hidden`);
    await openSheet();
    await press('[data-testid=pm-show]');
    await browser.until('strip', mode('point'));
    await browser.evaluate('history.back()');
    await browser.until('Back: strip → closed', `${q('[data-testid=pm-panel]')}.hidden && ${visible('[data-testid=card-a]')}`);
    await pause(400);
    assert.equal(await browser.evaluate('location.href'), href, 'Back never leaves the app page');
    console.log(`PASS ${oneLine ? 'one-line app ' : ''}${device}: C2–C7 behaviour, Back, never-covered page, select never activates, renumbering, persistence, recorder${oneLine ? '' : ', request card, « Mes demandes », @ mention'}`);
  }
  assert.deepEqual(browser.problems, [], 'no browser errors');
} finally { await browser?.close(); await app.close(); }
