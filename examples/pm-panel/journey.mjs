import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { launch, pause, q } from '@hachej/boring-testing/browser';
import { startPmPanel } from './server.mjs';

const evidence = process.env.PM_EVIDENCE ?? '.agent-handoff/pm-panel/screenshots';
mkdirSync(evidence, { recursive: true });
const app = await startPmPanel();
let browser;
const visible = selector => `!!${q(selector)} && ${q(selector)}.getClientRects().length > 0`;
const mode = value => `${q('[data-testid=pm-panel]')}?.dataset.mode === '${value}'`;
async function uncovered(stage, strip) {
  const result = await browser.evaluate(`(() => {
    const page = ${q('[data-pm-page]')}.getBoundingClientRect(), panel = ${q('[data-testid=pm-panel]')}.getBoundingClientRect();
    const nav = ${q('[data-pm-navigation]')}, bar = ${q('[data-testid=pm-strip]')}.getBoundingClientRect();
    const overlap = page.bottom > panel.top + 1;
    const buttons = [...${q('[data-testid=pm-panel]')}.querySelectorAll('button')].filter(node => {
      if (!node.getClientRects().length) return false;
      const r=node.getBoundingClientRect();
      return !!node.closest('[data-testid=composer-controls], [data-testid=pm-strip]') || node.contains(document.elementFromPoint(r.left+r.width/2,r.top+r.height/2));
    });
    return { overlap, height: bar.height, navVisible: nav.getClientRects().length > 0, pageHeight: page.height,
      controlsInBounds: buttons.every(node => { const r = node.getBoundingClientRect(); return r.left >= panel.left - 1 && r.right <= panel.right + 1 && r.top >= panel.top - 1 && r.bottom <= panel.bottom + 1; }),
      outside: buttons.filter(node => { const r=node.getBoundingClientRect(); return r.top<panel.top-1||r.bottom>panel.bottom+1||r.left<panel.left-1||r.right>panel.right+1; }).map(node=>({id:node.dataset.testid,text:node.textContent,rect:node.getBoundingClientRect().toJSON()})), panel:panel.toJSON(),
      overflow: document.documentElement.scrollWidth > innerWidth,
      panelPosition: getComputedStyle(${q('[data-testid=pm-panel]')}).position };
  })()`);
  if (!result.controlsInBounds) await browser.screenshot(`${stage.replaceAll(' ', '-')}-controls-failure.png`);
  assert.equal(result.overlap, false, `${stage}: page ends above PM ${JSON.stringify(result)}`);
  assert.ok(result.pageHeight > 80, `${stage}: the app keeps a tappable content area`);
  assert.equal(result.overflow, false, stage);
  assert.equal(result.controlsInBounds, true, `${stage}: controls stay inside PM ${JSON.stringify(result)}`);
  assert.ok(!['absolute', 'fixed'].includes(result.panelPosition), `${stage}: in-flow PM`);
  if (strip) { assert.equal(result.height, 56, stage); assert.equal(result.navVisible, true, stage); }
  return result;
}
async function open(device) {
  await browser.emulate(device);
  await browser.send('Page.navigate', { url: app.url });
  await browser.until('fictional app', visible('[data-testid=app-shell]'));
  if (device === 'phone') await browser.tap(q('[data-testid=account-button]'));
  else await browser.click(q('[data-testid=nav-user]'));
  await browser.until('account first entry is on screen', `(() => {const e=${q('[data-testid=account-improve]')}; if(!e)return false;const r=e.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight;})()`);
  assert.equal(await browser.evaluate(`(() => {const entry = ${q('[data-testid=account-improve]')}; return !entry.previousElementSibling || entry.previousElementSibling.querySelector('[data-slot=avatar]') !== null;})()`), true);
  await browser.click(q('[data-testid=account-improve]'));
  await browser.until('PM sheet opens', `${mode('sheet')} && ${visible('[data-testid=pm-sheet]')}`, 12000);
}
try {
  browser = await launch('about:blank', { evidence, args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
  for (const device of ['phone', 'desktop']) {
    await open(device);
    await uncovered(`${device} C2`, false);
    assert.equal(await browser.evaluate(`${q('[data-testid=pm-show]')}.getAttribute('aria-pressed')`), 'false');
    assert.equal(await browser.evaluate(`!!${q('[data-testid=pm-requests]')}`), false);
    await browser.screenshot(`${device}-C2-sheet.png`);
    await browser.click(q('[data-testid=pm-show]'));
    await browser.until('C3 point mode', mode('point'));
    assert.equal(await browser.evaluate(`${q('[data-testid=pm-timer]')}?.getClientRects().length > 0`), false, 'Montrer never starts recording');
    if (device === 'phone') await browser.tap(q('[data-testid=card-a]')); else await browser.click(q('[data-testid=card-a]'));
    await browser.until('first privacy-filtered capture', `[...document.querySelectorAll('[data-feedback-overlay]')].some(host => host.shadowRoot?.textContent.includes('①'))`);
    assert.equal(await browser.evaluate('(window.__activated ?? []).length'), 0, 'selecting never activates the button');
    await uncovered(`${device} C3`, device === 'phone');
    await browser.screenshot(`${device}-C3-point.png`);
    await browser.click(q('[data-testid=pm-strip] [data-testid=pm-mic]'));
    await browser.until('C4 microphone is recording', visible('[data-testid=pm-pause]'), 15000);
    await browser.until('PCM pause capability', `!${q('[data-testid=pm-pause]')}.disabled`, 15000);
    await pause(1100);
    if (device === 'phone') await browser.tap(q('[data-testid=card-a]')); else await browser.click(q('[data-testid=card-a]'));
    const firstTime = await browser.evaluate(`${q('[data-testid=pm-timer]')}.textContent`);
    await pause(1100);
    assert.notEqual(await browser.evaluate(`${q('[data-testid=pm-timer]')}.textContent`), firstTime, 'dictation continues through a pick');
    await uncovered(`${device} C4`, device === 'phone');
    await browser.screenshot(`${device}-C4-point-recording.png`);
    await browser.click(q('[data-testid=pm-pause]')); await pause(250);
    assert.equal(await browser.evaluate(`${q('[data-testid=pm-pause]')}.getAttribute('aria-label')`), 'Reprendre');
    const frozen = await browser.evaluate(`${q('[data-testid=pm-timer]')}.textContent`); await pause(1100);
    assert.equal(await browser.evaluate(`${q('[data-testid=pm-timer]')}.textContent`), frozen, 'pause freezes sample time');
    await browser.click(q('[data-testid=pm-pause]'));
    // Timer opens the real #1882 recording row, without stopping or replacing the capture.
    await browser.click(q('[data-testid=pm-timer]'));
    await browser.until('full dictaphone', `${mode('sheet')} && ${visible('[data-testid=voice-recording-bar]')}`);
    await uncovered(`${device} dictaphone`, false);
    await browser.screenshot(`${device}-dictaphone.png`);
    await browser.click(q('[data-testid=pm-show]'));
    await browser.until('return to recording strip', `${mode('point')} && ${visible('[data-testid=pm-pause]')}`);
    await browser.click(q('[data-testid=pm-navigate]'));
    await browser.until('C5 selection paused', mode('navigate'));
    if (device === 'phone') await browser.tap(q('[data-testid=tab-progress]'));
    else await browser.click(q('[data-testid=nav-progress]'));
    await browser.until('new app screen while recording', visible('[data-testid=card-b]'));
    if (device === 'phone') await browser.tap(q('[data-testid=card-b]')); else await browser.click(q('[data-testid=card-b]'));
    assert.deepEqual(await browser.evaluate('window.__activated'), ['b']);
    await uncovered(`${device} C5`, device === 'phone');
    await browser.screenshot(`${device}-C5-navigate-recording.png`);
    await browser.click(q('[data-testid=pm-select]'));
    if (device === 'phone') {
      await browser.tap(q('[data-testid=card-b]'));
      await browser.tap(q('[data-testid=tab-day]'));
      assert.equal(await browser.evaluate(`${q('[data-testid=tab-progress]')}.getAttribute('aria-selected')`), 'true', 'the tab bar itself is selectable without activation');
    } else await browser.click(q('[data-testid=card-b]'));
    // Scroll is still real navigation while pointing; the last page action can be brought fully into the reduced content area.
    await browser.evaluate(`${q('[data-testid=screen-progress]')}.scrollTop = 600`);
    await browser.evaluate(`${q('[data-testid=screen-progress] [data-testid=last-action]')}.scrollIntoView({block:'end'})`);
    const hit = await browser.evaluate(`(() => {const target=${q('[data-testid=screen-progress] [data-testid=last-action]')}, r=target.getBoundingClientRect(); return target.contains(document.elementFromPoint(r.left+r.width/2,r.top+r.height/2));})()`);
    assert.equal(hit, true, 'last page control is not under the PM strip');
    await uncovered(`${device} bottom target`, device === 'phone');
    await browser.click(q('[data-testid=pm-done]'));
    await browser.until('C6 editable inline description', `${mode('sheet')} && ${visible('[data-testid=composer-input][contenteditable=true]')} && !${q('[data-testid=pm-transcribing]')}`, 15000);
    const editor = '[data-testid=composer-input][contenteditable=true]';
    assert.ok(await browser.evaluate(`${q(editor)}.querySelectorAll('[data-pm-marker]').length`) >= 3);
    await uncovered(`${device} C6`, false);
    await browser.screenshot(`${device}-C6-editable-description.png`);
    await browser.click(q(editor)); await browser.press('End'); await browser.send('Input.insertText', { text: ' Une précision fictive.' });
    assert.match(await browser.evaluate(`${q(editor)}.textContent`), /Une précision fictive/);
    const before = app.submits.length;
    await browser.click(q('[data-testid=composer-submit]'));
    await browser.until('C7 sent', `${mode('full')} && ${visible('[data-testid=pm-sent-message]')}`, 15000);
    assert.equal(app.submits.length, before + 1, 'one native admission');
    const body = JSON.stringify(app.submits.at(-1).body);
    assert.match(body, /pm.points@1/); assert.match(body, /transcriptSegments/); assert.match(body, /atMs/); assert.match(body, /imageIndex/); assert.match(body, /image\/png/);
    assert.match(body, /progress/);
    assert.equal(await browser.evaluate(`!!${q('[data-testid=pm-sent-message] [role=list]')}`), false, 'no separate sent chip row');
    assert.ok(await browser.evaluate(`document.querySelectorAll('[data-testid=pm-inline-selection]').length`) >= 3);
    await browser.until('PM answer', `document.querySelectorAll('[data-role=assistant]').length > 0`, 15000);
    await uncovered(`${device} C7`, false);
    await browser.evaluate(`${q('[data-testid=pm-sent-message]')}.scrollIntoView({block:'start'})`);
    await browser.screenshot(`${device}-C7-thread.png`);
    await browser.click(q('[data-testid=pm-requests]'));
    assert.match(await browser.evaluate(`${q('[data-testid=pm-task-board-seam]')}.textContent`), /mine · full/);
    await browser.click(q('[data-testid=pm-requests]'));
    await browser.type(q('[data-testid=composer-input]'), '@');
    await browser.until('injectable task mentions', `!!document.querySelector('[data-testid=mention-item][data-path="task:D-201"]')`);
    assert.match(await browser.evaluate(`${q('[data-testid=mention-menu]')}.textContent`), /D-201/);
    await browser.click(q('[data-testid=pm-tasks-all]'));
    await browser.until('all task filter', `!!document.querySelector('[data-testid=mention-item][data-path="task:D-202"]')`);
    await browser.click(`document.querySelector('[data-testid=mention-item][data-path="task:D-201"]')`);
    await browser.until('task kind chip', visible('[data-testid=mention-chip]'));
    assert.match(await browser.evaluate(`${q('[data-testid=mention-chip]')}.textContent`), /@ D-201 · Clarifier/);
    await browser.click(q('[data-testid=mention-chip] button'));
    assert.deepEqual(await browser.evaluate('window.__presented'), ['D-201']);
    await browser.screenshot(`${device}-task-mention.png`);
    await browser.click(q('[data-testid=pm-close]'));
    await browser.until('close releases only presentation', `!!${q('[data-testid=pm-panel]')}.hidden`);
    console.log(`PASS ${device}: C2–C7, never-covered page, shared dictaphone, timed inline chips, navigation, task kinds`);
  }
  const problems = browser.problems;
  assert.deepEqual(problems, [], 'no browser errors');
} finally { await browser?.close(); await app.close(); }
