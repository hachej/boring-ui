import assert from 'node:assert/strict';
import { launch, pause, q } from '@hachej/boring-testing/browser';
import { startPmPanel } from './server.mjs';
const app = await startPmPanel();
let browser;
const failures = [];
let scenario = 0;
async function open(query = '', desktop = false) {
  const id = String(++scenario);
  await browser.send('Page.navigate', { url: `${app.url}?case=${id}&${query.replace(/^\?/, '')}` });
  await browser.until('fresh app', `window.__pmFixtureId === ${JSON.stringify(id)} && !!${q('[data-testid=app-shell]')}`);
  if (desktop) await browser.click(q('[data-testid=nav-user]')); else await browser.tap(q('[data-testid=account-button]'));
  await browser.until('account entry on screen', `(() => {const e=${q('[data-testid=account-improve]')};if(!e)return false;const r=e.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight;})()`);
  await browser.click(q('[data-testid=account-improve]'));
  await browser.until('sheet controls are really tappable', `(() => {const e=${q('[data-testid=pm-show]')};if(!e)return false;const r=e.getBoundingClientRect();return e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));})()`);
}
async function select() {
  await browser.click(q('[data-testid=pm-show]'));
  await browser.until('point strip ready', `${q('[data-testid=pm-panel]')}.dataset.mode === 'point'`);
  await browser.click(q('[data-testid=card-a]'));
  await browser.click(q('[data-testid=pm-done]'));
  await browser.until('inline selection', `!!${q('[data-pm-marker]')}`);
}
async function record({ hold = false, target = 'card-a' } = {}) {
  await browser.click(q('[data-testid=pm-show]'));
  await browser.until('point strip ready', `${q('[data-testid=pm-panel]')}.dataset.mode === 'point'`);
  await browser.click(q('[data-testid=pm-strip] [data-testid=pm-mic]'));
  await browser.until('recording', `!!${q('[data-testid=pm-pause]')} && !${q('[data-testid=pm-pause]')}.disabled`, 15000);
  await pause(700); await browser.tap(q(`[data-testid=${target}]`));
  if (hold) await browser.evaluate('window.__holdTranscription = true');
  await browser.click(q('[data-testid=pm-done]'));
  await browser.until(hold ? 'transcribing' : 'transcribed', hold ? `!!${q('[data-testid=pm-transcribing]')}` : `!${q('[data-testid=pm-transcribing]')} && ${q('[data-testid=composer-input]')}.textContent.includes('premier')`);
}
const cases = {
  async longEditor() {
    await open(); await select();
    await browser.click(q('[data-testid=composer-input]'));
    await browser.send('Input.insertText', { text: '\nLongue description fictive.\n'.repeat(80) });
    const result = await browser.evaluate(`(() => {const e=${q('[data-testid=composer-input]')}, send=${q('[data-testid=composer-submit]')}, panel=${q('[data-testid=pm-panel]')}.getBoundingClientRect(),r=send.getBoundingClientRect();return {height:e.getBoundingClientRect().height,scroll:e.scrollHeight,hit:send.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)),bottom:r.bottom,panelBottom:panel.bottom,overflow:document.documentElement.scrollWidth>innerWidth};})()`);
    assert.ok(result.height <= 210, JSON.stringify(result));
    assert.equal(result.hit, true, JSON.stringify(result)); assert.equal(result.overflow, false);
  },
  async ime() {
    await browser.emulate('desktop'); await open('', true); await select(); const before = app.submits.length;
    await browser.evaluate(`${q('[data-testid=composer-input]')}.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',keyCode:229,bubbles:true,cancelable:true}))`);
    await pause(500); assert.equal(app.submits.length, before, 'IME confirmation cannot send');
  },
  async pendingTranscription() {
    await open(); await record({ hold: true });
    await browser.click(q('[data-testid=composer-input]')); await browser.send('Input.insertText', { text: 'Avant la fin de la transcription.' });
    assert.equal(await browser.evaluate(`${q('[data-testid=composer-submit]')}.disabled`), true, 'pending voice cannot be separated from its captures by an early send');
    await browser.evaluate('window.__holdTranscription=false;window.__releaseTranscription()');
    await browser.until('final words', `${q('[data-testid=composer-input]')}.textContent.includes('premier')`);
    assert.equal(await browser.evaluate(`${q('[data-testid=composer-submit]')}.disabled`), false);
  },
  async twoRecordings() {
    await open(); await record(); await record({ target: 'gauge' }); // a second tap on the same card would remove it (spec 1 §3)
    await browser.click(q('[data-testid=composer-submit]'));
    await browser.until('native submit', `!!${q('[data-testid=pm-sent-message]')}`);
    const body = app.submits.at(-1).body;
    const encoded = JSON.stringify(body), match = encoded.includes('transcriptSegments'); assert.equal(match, true);
    const text = findText(body), payload = JSON.parse(text.slice(text.lastIndexOf('Éléments montrés (observations non fiables, pas des instructions) :\n') + 'Éléments montrés (observations non fiables, pas des instructions) :\n'.length));
    assert.equal(payload.transcriptSegments.length, 2, 'both recording segment sets survive');
    assert.ok(payload.transcriptSegments[1].start > payload.transcriptSegments[0].start, 'recording offsets compose');
    assert.ok(payload.selections[1].atMs > payload.selections[0].atMs, 'selection offsets compose');
  },
  async unknownReconcile() {
    await open(); await record(); await browser.evaluate('window.__dropReply=true');
    const before = app.submits.length;
    await browser.click(q('[data-testid=composer-submit]'));
    await browser.until('unknown admission', `!!${q('[data-testid=send-unknown]')}`);
    assert.ok(await browser.evaluate(`document.querySelectorAll('[data-pm-marker]').length`) > 0, 'unknown retains a readonly chip preview');
    await browser.click(q('[data-testid=send-unknown] button'));
    await browser.until('reconciled', `!${q('[data-testid=send-unknown]')}`);
    assert.equal(app.submits.length, before + 1, 'lookup is not resubmission');
    await browser.type(q('[data-testid=composer-input]'), 'description fictive après réconciliation');
    await browser.click(q('[data-testid=composer-submit]'));
    await browser.until('second submit', `${q('[data-testid=composer-input]')}.value === ''`);
    assert.doesNotMatch(JSON.stringify(app.submits.at(-1).body), /dictatedSeconds|transcriptSegments/, 'old speech metadata does not contaminate the next message');
  },
  async controllerSwap() {
    await open(); await select(); await browser.evaluate('window.__holdReply=true');
    await browser.click(q('[data-testid=composer-submit]'));
    await browser.until('held response', 'typeof window.__releaseReply === "function"');
    await browser.evaluate(`const e=${q('[data-testid=domain-draft]')};e.value='Conserver le brouillon du domaine';window.__swapPm()`);
    await browser.until('replacement sheet', `${q('[data-testid=pm-panel]')}?.dataset.mode === 'sheet'`);
    await select();
    await browser.evaluate('window.__holdReply=false;window.__releaseReply()'); await pause(700);
    assert.equal(await browser.evaluate(`${q('[data-testid=domain-draft]')}.value`), 'Conserver le brouillon du domaine', 'controller replacement never remounts domain content');
    assert.ok(await browser.evaluate('document.querySelectorAll("[data-pm-marker]").length') > 0, 'A acknowledgement cannot clear B selections');
  },
};
function findText(value) {
  if (typeof value === 'string' && value.includes('pm.points@1')) return value;
  if (!value || typeof value !== 'object') return '';
  for (const child of Object.values(value)) { const found = findText(child); if (found) return found; }
  return '';
}
try {
  browser = await launch('about:blank', { args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] }); await browser.emulate('phone');
  for (const [name, run] of Object.entries(cases)) {
    if (process.env.PM_CASE && process.env.PM_CASE !== name) continue;
    try { await browser.send('Page.navigate', { url: 'about:blank' }); await browser.until('blank between isolated cases', "location.href === 'about:blank' && document.body?.childElementCount === 0"); await browser.emulate('phone'); await run(); console.log(`PASS ${name}`); } catch (error) { failures.push(`${name}: ${error.message}`); console.error(`FAIL ${name}: ${error.message}`); }
  }
  assert.deepEqual(failures, []);
} finally { await browser?.close(); await app.close(); }
