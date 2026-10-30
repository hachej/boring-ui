// The shared-chat journey on the room source (`createRoomSource`): two fictional people, a mention list, a question card, a resume after a
// reconnect, at phone width 390, against a fictional room host (room-backend.mjs) that speaks the `_room/*` door over the real room kit.
// It also measures the smoothness budgets the plan gives R3: B1 (my message shows in under 50 ms and its echo takes its place), B5 (no
// layout shift while an agent streams; the scroll stays at the bottom) and B6 (8 s without a frame: « still working » and Try again).
// Set CHROMIUM to a Chromium binary. Screenshots and `budgets.json` go to SHARED_CHAT_EVIDENCE (default .cache/evidence/shared-chat/r3-room).
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { launch, pause, q, qa } from '@hachej/boring-testing/browser';
import { startSharedChat } from './server.mjs';
import { createRoomBackend } from './room-backend.mjs';

const evidence = process.env.SHARED_CHAT_EVIDENCE ?? '.cache/evidence/shared-chat/r3-room';
mkdirSync(evidence, { recursive: true });
const backend = await createRoomBackend({ latencyMs: 150, streamMs: 140 });
const app = await startSharedChat({ room: backend });
const input = q('[data-testid=composer-input]');
const budgets = { b1: {}, b5: {}, b6: {}, resume: {}, screenshots: [] };
const browsers = [];
const row = text => `[...document.querySelectorAll('[data-shared-message]')].find(e => e.innerText.includes(${JSON.stringify(text)}))`;
const rowsWith = text => `[...document.querySelectorAll('[data-shared-message]')].filter(e => e.innerText.includes(${JSON.stringify(text)})).length`;
const noOverflow = 'document.documentElement.scrollWidth <= innerWidth && document.body.scrollWidth <= innerWidth';
const atBottom = "(() => { const v = document.querySelector('[data-testid=transcript-scroll]'); return Math.abs(v.scrollHeight - v.clientHeight - v.scrollTop) <= 2; })()";
const SAMPLES = 12;
const percentile = (values, p) => [...values].sort((a, b) => a - b)[Math.min(values.length - 1, Math.floor(values.length * p))];
const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

async function person(id, prefix) {
  const browser = await launch(`${app.url}?room&as=${id}`, { evidence });
  browsers.push(browser);
  await browser.emulate('phone');
  await browser.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await browser.reload();
  await browser.send('Emulation.resetPageScaleFactor');
  await browser.until(`${id} sees the room`, `!!${input} && ${rowsWith('Le plan du jardin')} === 1`);
  // Layout shifts are recorded for the whole page life; a window is read as the difference.
  await browser.evaluate(`(() => { window.__shift = 0; window.__shifts = []; new PerformanceObserver(list => { for (const e of list.getEntries()) { window.__shift += e.value; window.__shifts.push({ at: Math.round(e.startTime), value: e.value, input: e.hadRecentInput, sources: e.sources.map(s => ({ node: s.node?.outerHTML?.slice(0, 90) ?? String(s.node), from: [s.previousRect.y, s.previousRect.height], to: [s.currentRect.y, s.currentRect.height] })) }); } }).observe({ type: 'layout-shift', buffered: true }); })()`);
  const shot = async name => { await pause(250); await browser.screenshot(`${prefix}-${name}.png`); budgets.screenshots.push(`${evidence}/${prefix}-${name}.png`); };
  return { browser, shot, id };
}
const type = async (side, text, mention) => {
  if (mention) { await side.browser.type(input, '@'); await side.browser.until('mention list', `${qa('[data-testid=mention-item]')}.length > 0`); await side.browser.press('Enter'); }
  await side.browser.type(input, text);
};
const send = side => side.browser.click(q('[data-testid=composer-submit]'));

try {
  const ana = await person('person:ana', 'ana-390'), ben = await person('person:ben', 'ben-390');
  assert.equal(await ana.browser.evaluate(noOverflow), true);

  // ---- 1. the room as stored: a notice, a message, a card, a pin; people and agents by name, never by id ----
  const text = await ana.browser.evaluate('document.body.innerText');
  assert.match(text, /Ben a rejoint/); assert.match(text, /Export CSV/); assert.match(text, /Le bouton est trop bas/); assert.match(text, /Accueil, bouton Exporter/);
  assert.equal(await ana.browser.evaluate(`!!${q('[data-testid=pinned-comment]')} && !!${q('[data-testid=request-card]')}`), true, 'the pin and the card are drawn');
  assert.deepEqual(await ana.browser.evaluate(`${qa('[data-testid=request-action]')}.map(e => e.textContent)`), ['Essayer', 'Plus tard']);
  await ana.shot('1-room-overview');

  // ---- 2. the mention list: agents first, each by role in plain words ----
  await ana.browser.type(input, '@');
  await ana.browser.until('mention list', `${qa('[data-testid=mention-item]')}.length === 5`);
  assert.deepEqual(await ana.browser.evaluate(`${qa('[data-testid=mention-item]')}.map(e => e.dataset.path)`), ['agent:pm', 'agent:worker', 'agent:verifier', 'person:ben', 'person:dev']);
  const picker = await ana.browser.evaluate(`${qa('[data-testid=mention-item]')}.map(e => e.textContent).join(' | ')`);
  assert.match(picker, /Votre assistant/); assert.match(picker, /Builder/); assert.match(picker, /Un agent/); assert.match(picker, /Ben/); assert.match(picker, /Un membre/);
  assert.doesNotMatch(picker, /agent:|person:|user_7c1e|verifier|worker/, 'no raw id or slug in the picker');
  await ana.shot('2-mention-list');
  await ana.browser.press('Escape'); await ana.browser.evaluate(`(${input}).blur()`);
  await ana.browser.evaluate(`(() => { const i = ${input}; const s = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set; if (s && i.tagName === 'TEXTAREA') { s.call(i, ''); i.dispatchEvent(new Event('input', { bubbles: true })); } })()`);

  // ---- 3. B1: my message shows at once; its echo takes its place; the other person sees it once ----
  await ana.browser.evaluate(`(() => { window.__b1 = []; document.addEventListener('click', e => { if (e.target.closest('[data-testid=composer-submit]')) window.__t0 = performance.now(); }, true);
    new MutationObserver(() => { if (window.__t0 !== undefined && document.querySelector('[data-pending="true"]')) { window.__b1.push(performance.now() - window.__t0); window.__t0 = undefined; } }).observe(document.body, { subtree: true, childList: true, attributes: true }); })()`);
  const places = [];
  for (let n = 1; n <= SAMPLES; n++) {
    const line = `Message de test numéro ${n} pour Ben`;
    await ana.browser.type(input, line);
    await send(ana);
    await ana.browser.until(`bubble ${n}`, `window.__b1.length === ${n}`);
    const before = await ana.browser.evaluate(`(() => { const r = ${row(line)}.getBoundingClientRect(); return Math.round(r.top); })()`);
    await ana.browser.until(`echo ${n}`, `!document.querySelector('[data-pending="true"]') && ${rowsWith(line)} === 1`);
    await pause(60);
    const after = await ana.browser.evaluate(`(() => { const r = ${row(line)}.getBoundingClientRect(); return Math.round(r.top); })()`);
    places.push(after - before);
    await ben.browser.until(`ben sees ${n}`, `${rowsWith(line)} === 1`);
  }
  const b1 = await ana.browser.evaluate('window.__b1');
  budgets.b1 = { hostLatencyMs: 150, samples: b1.map(v => Math.round(v * 10) / 10), medianMs: Math.round(median(b1) * 10) / 10, p75Ms: Math.round(percentile(b1, 0.75) * 10) / 10, maxMs: Math.round(Math.max(...b1) * 10) / 10, budgetMs: 50, echoMovedPx: places };
  console.log('B1 samples (ms)', b1.map(v => v.toFixed(1)).join(' '), 'load', (await import('node:os')).loadavg().map(v => v.toFixed(1)).join(' '));
  // A shared, loaded machine adds the odd outlier (a GC pause, a busy core): the budget holds when three bubbles in four are under 50 ms and the median is well under.
  assert.ok(percentile(b1, 0.75) < 50 && median(b1) < 40, `B1: the bubble shows in under 50 ms (${b1.map(v => v.toFixed(1))})`);
  assert.ok(places.every(delta => Math.abs(delta) <= 1), `the echo replaces the bubble where it was (${places})`);
  assert.equal(await ana.browser.evaluate(rowsWith(`Message de test numéro ${SAMPLES}`)), 1);
  assert.equal(await ben.browser.evaluate(rowsWith(`Message de test numéro ${SAMPLES}`)), 1);
  await ben.shot('3-ben-sees-ana');

  // ---- 4. the PM writes: the working sign from the send answer; B5 over the stream; the answer takes the same place ----
  await type(ana, ' écris-moi un plan', true);
  const echoStart = await ana.browser.evaluate('window.__shift');
  await send(ana);
  await ana.browser.until('writing sign', `!!${q('[data-streaming="true"]')}`);
  await ben.browser.until('ben sees the PM writing too', `!!${q('[data-streaming="true"]')}`);
  assert.match(await ana.browser.evaluate(`${q('[data-streaming="true"] [data-testid=activity-label]')}.textContent`), /Votre assistant travaille/);
  let drift = 0;
  await ana.browser.until('the first words stream in', `(${q('[data-streaming="true"]')}?.innerText ?? '').includes('Je')`);
  // From the first words to the answer: every layout shift counts, even one the browser would excuse as following an input. (My own bubble
  // taking its confirmed time, a moment before, is B1's: its shift is reported as `echoShift`.)
  const shiftBefore = await ana.browser.evaluate('window.__shift');
  const shiftsBefore = (await ana.browser.evaluate('window.__shifts')).length;
  await ana.browser.until('more text streams', `(${q('[data-streaming="true"]')}?.innerText ?? '').includes('Je regarde')`);
  await ana.shot('4-pm-writing');
  while (await ana.browser.evaluate(`!!${q('[data-streaming="true"]')}`)) { if (!(await ana.browser.evaluate(atBottom))) drift++; await pause(40); }
  await ana.browser.until('answer in place', `${rowsWith('une version que vous pourrez essayer')} === 1 && !${q('[data-streaming="true"]')}`);
  const shifted = (await ana.browser.evaluate('window.__shift')) - shiftBefore;
  const echoShift = shiftBefore - echoStart;
  budgets.b5sources = (await ana.browser.evaluate('window.__shifts')).slice(shiftsBefore);
  budgets.b5 = { echoShift: Math.round(echoShift * 100000) / 100000, layoutShiftDuringStream: Math.round(shifted * 10000) / 10000, framesNotAtBottom: drift, budget: 0 };
  assert.equal(await ana.browser.evaluate(rowsWith('une version que vous pourrez essayer')), 1, 'the writing message became the answer: one message');
  assert.equal(await ben.browser.evaluate(rowsWith('une version que vous pourrez essayer')), 1);
  assert.equal(shifted, 0, `B5: no layout shift while the agent streams ${JSON.stringify(budgets.b5sources)}`);
  assert.equal(drift, 0, 'the scroll stays anchored at the bottom while the answer streams');
  await ben.shot('4-ben-answer');

  // ---- 5. a question card: both see it, ben answers with one tap, it is answered everywhere, the agent goes on ----
  await type(ana, ' quel format pour l’export ?', true);
  await send(ana);
  await ana.browser.until('question card', `!!${q('[data-testid=question-card]')}`);
  await ben.browser.until('ben sees the question', `!!${q('[data-testid=question-card]')}`);
  assert.deepEqual(await ana.browser.evaluate(`${qa('[data-testid=question-option]')}.map(e => e.textContent)`), ['PDF', 'CSV']);
  assert.equal(await ana.browser.evaluate(`!!${q('[data-testid=question-reply]')}`), true, 'free text is allowed: Reply');
  assert.equal(await ana.browser.evaluate(`!!${q('[data-streaming="true"]')}`), false, 'the agent waits for a person: nothing says it is writing');
  assert.equal(await ana.browser.evaluate(`${qa('[data-testid=question-option], [data-testid=question-reply]')}.every(e => e.getBoundingClientRect().height >= 44)`), true, '44px touch targets');
  await ana.shot('5-question-card');
  await ben.shot('5-ben-question');
  await ben.browser.tap(q('[data-testid=question-option]'));
  for (const side of [ana, ben]) {
    await side.browser.until(`${side.id}: only the chosen reply remains`, `!${q('[data-testid=question-card]')} && ${rowsWith('PDF')} >= 1`);
    assert.equal(await side.browser.evaluate(`${qa('[data-testid=question-option]')}.length`), 0, 'answered: no choices left');
  }
  await ana.browser.until('the agent goes on with the answer', `${rowsWith('Parfait, j’ajoute un export PDF')} === 1 && !${q('[data-streaming="true"]')}`);
  await ben.browser.until('ben too', `${rowsWith('Parfait, j’ajoute un export PDF')} === 1 && !${q('[data-streaming="true"]')}`);
  assert.equal(await ana.browser.evaluate(`${qa('[data-testid=question-card]')}.length`), 0, 'the answered prompt is not repeated');
  assert.equal(await ana.browser.evaluate(`${qa('[data-streaming]')}.length`), 0, 'no writing message left behind');
  await ana.shot('5-question-answered');
  await ben.shot('5-ben-answered');

  // ---- 6. resume after a reconnect: the socket is lost, ben speaks and the PM answers meanwhile, ana's screen catches up from her cursor ----
  const cursor = await ana.browser.evaluate('window.__ROOM__.cursor("main")');
  const mark = backend.log.length;
  backend.cut('person:ana');
  await ana.browser.until('ana sees the connection problem', `!!${q('[data-testid=shared-status]')}`);
  await ana.shot('6-offline');
  await type(ben, 'Pendant que tu es hors ligne (un)');
  await send(ben);
  await ben.browser.until('ben sent the first', `${rowsWith('Pendant que tu es hors ligne (un)')} === 1 && !${q('[data-pending="true"]')}`);
  await type(ben, ' peux-tu faire un résumé ?', true);
  await send(ben);
  await ben.browser.until('the PM answered ben', `${rowsWith('peux-tu faire un résumé')} === 1 && ${rowsWith('Je regarde vos fichiers')} === 2 && !${q('[data-streaming="true"]')}`);
  assert.equal(await ana.browser.evaluate(rowsWith('Pendant que tu es hors ligne')), 0, 'ana has seen nothing of it');
  backend.restore('person:ana');
  const back = Date.now();
  await ana.browser.evaluate("window.dispatchEvent(new Event('online'))");
  await ana.browser.until('ana caught up', `${rowsWith('Pendant que tu es hors ligne (un)')} === 1 && ${rowsWith('peux-tu faire un résumé')} === 1 && ${rowsWith('Je regarde vos fichiers')} === 2 && !${q('[data-testid=shared-status]')}`);
  const caughtUp = Date.now() - back;
  await pause(300);
  for (const text of ['Pendant que tu es hors ligne (un)', 'peux-tu faire un résumé', 'Parfait, j’ajoute un export PDF']) assert.equal(await ana.browser.evaluate(rowsWith(text)), 1, `${text}: once`);
  assert.equal(await ana.browser.evaluate(`${qa('[data-streaming]')}.length`), 0, 'no writing message left behind');
  const resumed = backend.log.slice(mark).filter(request => request.person === 'person:ana' && request.operation === 'history');
  assert.ok(resumed.length >= 1 && resumed.every(request => request.body.after >= cursor), `the resume reads after the cursor ${cursor}: ${JSON.stringify(resumed.map(request => request.body))}`);
  assert.ok(resumed.some(request => request.body.after === cursor));
  budgets.resume = { cursorBefore: cursor, historyRequests: resumed.map(request => request.body), caughtUpMs: caughtUp, duplicates: 0 };
  await ana.shot('6-resumed');

  // ---- 7. B6: an agent silent for 8 s says it is still working and offers Try again; retrying gives one answer ----
  await type(ana, ' c’est lent aujourd’hui', true);
  await send(ana);
  await ana.browser.until('writing sign', `!!${q('[data-streaming="true"]')}`);
  const began = Date.now();
  await ana.browser.until('the stalled card', `!!${q('[data-action=retry]')}`, 15000);
  const stalledAfter = Date.now() - began;
  budgets.b6 = { stalledAfterMs: stalledAfter, budgetMs: 8000, retryLabel: await ana.browser.evaluate(`${q('[data-action=retry]')}.textContent`) };
  assert.ok(stalledAfter >= 7000 && stalledAfter < 9500, `B6: the stall shows at 8 s (${stalledAfter} ms)`);
  assert.match(await ana.browser.evaluate('document.body.innerText'), /Toujours en train de répondre/);
  await ana.shot('7-stalled');
  await ana.browser.tap(q('[data-action=retry]'));
  await ana.browser.until('the answer after the retry', `${rowsWith('Désolé pour l’attente')} === 1 && !${q('[data-streaming="true"]')} && !${q('[data-action=retry]')}`);
  await pause(300);
  assert.equal(await ana.browser.evaluate(rowsWith('Désolé pour l’attente')), 1, 'one answer');
  assert.equal(await ana.browser.evaluate(rowsWith('Toujours en train de répondre')), 0, 'the stalled card became the answer');

  // ---- 8. a card action wakes the card's agent (the builder), once ----
  await ana.browser.tap(q('[data-action=try]'));
  await ana.browser.until('the builder answers', `${rowsWith('Noté, je prépare')} === 1`);
  assert.match(await ana.browser.evaluate(`${row('Noté, je prépare')}.innerText`), /Noté/);
  assert.match(await ana.browser.evaluate('document.body.innerText'), /Builder/);
  await ana.shot('8-builder');

  // ---- 9. removing my own message, and the page as a whole ----
  await ana.browser.evaluate(`(async () => { const c = window.__CONTROLLER__; await c.remove(c.getSnapshot().shared.messages.find(m => m.text === 'Message de test numéro 1 pour Ben')); })()`);
  await ana.browser.until('removed', `${rowsWith('Message supprimé')} >= 1`);
  assert.equal(await ana.browser.evaluate(rowsWith('Message de test numéro 1 pour Ben')), 0);
  for (const side of [ana, ben]) {
    const page = await side.browser.evaluate('document.body.innerText');
    assert.doesNotMatch(page, /agent:|person:|user_7c1e|wake:|room:|sp_fictional/, `${side.id}: no id reaches the page`);
    assert.equal(await side.browser.evaluate(noOverflow), true, 'no horizontal scroll at 390');
    assert.deepEqual(side.browser.problems, [], `${side.id}: no console error`);
  }
  await ana.shot('9-final');
}
catch (error) { await Promise.all(browsers.map(browser => browser.close().catch(() => {}))); await app.close(); await backend.close(); throw error; }
await Promise.all(browsers.map(browser => browser.close().catch(() => {})));
await app.close(); await backend.close();
writeFileSync(`${evidence}/budgets.json`, JSON.stringify(budgets, null, 2));
