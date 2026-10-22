import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { launch, pause } from '@hachej/boring-testing/browser';
import { draftReport, feedbackText } from '@hachej/boring-feedback/format';
import { demoLabels } from './presentation.mjs';
import { startStagedChat } from './server.mjs';

const evidence = '.cache/evidence/D72'; mkdirSync(evidence, { recursive: true });
const app = await startStagedChat();
const steps = [];
let browser;
const thread = name => `document.querySelector('[data-thread="${name}"]')`;
const input = name => `${thread(name)}.querySelector('[data-testid="composer-input"]')`;
const rows = name => `[...${thread(name)}.querySelectorAll('[data-role="assistant"]')]`;
try {
  for (const [device, width, height] of [['desktop', 1440, 1000], ['phone', 390, 844]]) {
    browser = await launch(app.url, { evidence });
    await browser.emulate(device);
    const activate = selector => device === 'phone' ? browser.tap(selector) : browser.click(selector);
    const screenshot = async name => { await browser.evaluate('window.scrollTo({top:0,behavior:"instant"})'); await pause(100); await browser.screenshot(name); };
    await browser.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: device === 'phone' });
    await browser.until('independent native controllers', `!!${input('Questions')} && !!${input('Senior')} && window.__STAGED__.controllers.Questions?.getSnapshot().connection.kind === 'connected' && window.__STAGED__.controllers.Senior?.getSnapshot().connection.kind === 'connected'`);
    await browser.evaluate('document.fonts.ready.then(() => true)');
    const geometry = await browser.evaluate(`(() => { const a = ${thread('Questions')}.getBoundingClientRect(), b = ${thread('Senior')}.getBoundingClientRect(); return { left: a.left, right: a.right, bottom: a.bottom, seniorLeft: b.left, seniorTop: b.top, height: a.height }; })()`);
    assert.ok(device === 'desktop' ? geometry.right <= geometry.seniorLeft : geometry.bottom <= geometry.seniorTop, 'the fixture uses two columns on desktop and stacks on phone');
    assert.equal(Math.round(geometry.height), 704, 'each thread has a bounded independent viewport');
    for (const name of ['Questions', 'Senior']) assert.equal(await browser.evaluate(`[...${thread(name)}.querySelectorAll('h2')].filter(node => node.textContent === ${JSON.stringify(name)}).length`), 1, 'one conversation heading');
    assert.equal(await browser.evaluate(`${rows('Questions')}.filter(row => row.textContent.includes('Note fictive précédente')).flatMap(row => [...row.querySelectorAll('[data-testid="total-duration"]')]).length`), 0, 'untimed seeded history has no duration noise');
    await browser.type(input('Senior'), 'Brouillon Senior indépendant');
    assert.equal(await browser.evaluate(`${thread('Questions')}.querySelectorAll('[data-row-id]').length`), 24);
    const earlier = `${thread('Questions')}.querySelector('[data-testid="transcript-history-load"]')`;
    await browser.evaluate(`${earlier}.focus()`); await browser.press('Enter');
    await browser.until('display-only limit reveals retained rows', `${thread('Questions')}.querySelectorAll('[data-row-id]').length > 24`);
    const seniorScroll = await browser.evaluate(`${thread('Senior')}.querySelector('[data-testid="transcript-scroll"]').scrollTop`);
    const previousAnswer = await browser.evaluate(`${rows('Questions')}.at(-1)?.dataset.rowId`);
    await browser.type(input('Questions'), 'Quelle dose pour un adulte ?');
    if (device === 'phone') await activate(`${thread('Questions')}.querySelector('[data-testid="composer-submit"]')`); else await browser.press('Enter');
    await browser.until('first validated stage', `${rows('Questions')}.at(-1)?.dataset.rowId !== ${JSON.stringify(previousAnswer)} && ${rows('Questions')}.at(-1)?.textContent.includes('vérifier le contexte')`);
    await browser.until('one changing marker for stage two', `!!${thread('Questions')}.querySelector('[data-testid="stage-status"][data-stage="2"][data-state="running"]')`);
    await browser.evaluate(`void (window.__STAGED__.runningStage = ${thread('Questions')}.querySelector('[data-testid="stage-status"][data-stage="2"][data-state="running"]'))`);
    const scroll = `${thread('Questions')}.querySelector('[data-testid="transcript-scroll"]')`;
    await browser.evaluate(`${scroll}.scrollIntoView({block:'center',behavior:'instant'})`);
    const point = await browser.evaluate(`(() => { const r = ${scroll}.getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2}; })()`);
    await browser.wheel(point.x, point.y, -500); await pause(150);
    const before = await browser.evaluate(`${scroll}.scrollTop`);
    assert.ok(await browser.evaluate(`${scroll}.scrollHeight - ${scroll}.clientHeight - ${scroll}.scrollTop > 50`), 'the reader actually left the bottom');
    const anchor = await browser.evaluate(`(() => { const top = ${scroll}.getBoundingClientRect().top; const row = [...${scroll}.querySelectorAll('[data-row-id]')].find(node => node.getBoundingClientRect().bottom > top && node.getBoundingClientRect().top < ${scroll}.getBoundingClientRect().bottom); return row && { key: row.dataset.rowId, offset: row.getBoundingClientRect().top - top }; })()`);
    assert.ok(anchor);
    await browser.until('three stages, one answer', `${rows('Questions')}.at(-1)?.textContent.includes('Synthèse fictive') && !window.__STAGED__.controllers.Questions.getSnapshot().view.docs['pi.live']?.run && !${rows('Questions')}.at(-1)?.dataset.streaming`, 20000);
    const anchorOffset = await browser.evaluate(`(() => { const row = [...${scroll}.querySelectorAll('[data-row-id]')].find(node => node.dataset.rowId === ${JSON.stringify(anchor.key)}); return row && row.getBoundingClientRect().top - ${scroll}.getBoundingClientRect().top; })()`);
    assert.ok(typeof anchorOffset === 'number' && Math.abs(anchorOffset - anchor.offset) < 3, 'appending stages preserves the visible reading anchor');
    assert.equal(await browser.evaluate(`${input('Senior')}.value`), 'Brouillon Senior indépendant');
    assert.equal(await browser.evaluate(`${thread('Senior')}.querySelector('[data-testid="transcript-scroll"]').scrollTop`), seniorScroll, 'Questions updates do not scroll Senior');
    assert.equal(await browser.evaluate(`!!${thread('Senior')}.querySelector('[data-testid="preparing"]')`), false);
    assert.equal(await browser.evaluate(`${thread('Senior')}.textContent.includes('Synthèse fictive')`), false);
    assert.equal(await browser.evaluate(`${thread('Questions')}.textContent.includes('::meta')`), false);
    const last = `${rows('Questions')}.at(-1)`;
    const stages = await browser.evaluate(`[...${last}.querySelectorAll('[data-testid="stage-status"]')].map(node => ({ task: node.dataset.task, state: node.dataset.state }))`);
    assert.equal(stages.length, 3); assert.equal(new Set(stages.map(stage => stage.task)).size, 3);
    assert.ok(stages.every(stage => stage.state === 'validated'));
    assert.equal(await browser.evaluate(`${last}.querySelector('[data-testid="stage-status"][data-stage="2"]') === window.__STAGED__.runningStage`), true, 'the running marker updates in place');
    assert.equal(await browser.evaluate(`${last}.querySelectorAll('[data-testid="total-duration"]').length`), 1);
    const nativeDuration = await browser.evaluate(`(() => { const entries = window.__STAGED__.controllers.Questions.getSnapshot().view.entries; const start = entries.findLastIndex(entry => entry.model?.some(message => message.role === 'user')); return entries.slice(start).flatMap(entry => entry.model ?? []).filter(message => message.role === 'assistant').reduce((sum, message) => sum + (message.durationMs ?? 0), 0); })()`);
    assert.equal(await browser.evaluate(`${last}.querySelector('[data-testid="total-duration"]').textContent`), demoLabels('fr').duration(nativeDuration));
    assert.ok(await browser.evaluate(`!!${last}.querySelector('[data-testid="unread"]')`));
    const unreadGeometry = await browser.evaluate(`(() => { const button = ${last}.querySelector('[data-testid="unread"]'), content = button.closest('[data-slot="message-content"]'); const a = button.getBoundingClientRect(), b = content.getBoundingClientRect(); return { attached: button.parentElement.dataset.testid === 'reply-unread', left: a.left - b.left, width: a.width, messageWidth: b.width }; })()`);
    assert.ok(unreadGeometry.attached && Math.abs(unreadGeometry.left) <= 1 && unreadGeometry.width < unreadGeometry.messageWidth * .75, 'unread hugs and aligns with its reply');
    await browser.evaluate(`${last}.scrollIntoView({block:'end',behavior:'instant'})`);
    await activate(`${last}.querySelector('button[aria-label="Copier la réponse"]')`);
    assert.equal(await browser.evaluate('window.__STAGED__.copies.at(-1).includes("::meta")'), false);
    await screenshot(`${device}-three-stages.png`);
    await activate(`${last}.querySelector('[data-testid="unread"]')`);
    await browser.until('host seen key clears unread', `!${last}.querySelector('[data-testid="unread"]')`);
    const count = await browser.evaluate(`${thread('Questions')}.querySelector('[data-testid="offer-count"]').textContent`);
    await browser.reload(); await browser.until('reloaded answer', `${rows('Questions')}.at(-1)?.textContent.includes('Synthèse fictive') && !!${input('Questions')}`);
    assert.equal(await browser.evaluate(`!!${rows('Questions')}.at(-1).querySelector('[data-testid="unread"]')`), false);
    await browser.evaluate(`${rows('Questions')}.at(-1).scrollIntoView({block:'end',behavior:'instant'})`);
    await activate(`${rows('Questions')}.at(-1).querySelector('[data-testid="reply-action-offer"]')`);
    await browser.until('old offer works after reload', `${thread('Questions')}.querySelector('[data-testid="offer-count"]').textContent !== ${JSON.stringify(count)}`);
    assert.equal(await browser.evaluate(`${thread('Questions')}.querySelector('[data-testid="offer-count"]').textContent`), demoLabels('fr').offers((await app.host.readerState('Questions')).offers));
    // Lose the first POST before admission: retry must preserve the selected demo control and the native request ID.
    await browser.evaluate(`(() => { const send = window.fetch.bind(window); window.fetch = async (request, options) => { if (new URL(request.url ?? request, location.href).searchParams.get('op') === 'submit') { window.fetch = send; throw new TypeError('Fictional pre-admission connection loss'); } return send(request, options); }; })()`);
    await activate(`${thread('Questions')}.querySelector('[data-testid="fail-first"]')`);
    await browser.until('demo input has unknown admission', `window.__STAGED__.controllers.Questions.getSnapshot().send.kind === 'unknown' && !!${thread('Questions')}.querySelector('[data-testid="send-unknown"]')`);
    const failedRequestId = await browser.evaluate('window.__STAGED__.controllers.Questions.getSnapshot().send.attempt.requestId');
    await activate(`${thread('Questions')}.querySelector('[data-testid="send-unknown"] button:last-child')`);
    await browser.until('retried input admitted', `window.__STAGED__.controllers.Questions.getSnapshot().send.kind === 'admitted'`);
    assert.equal(await browser.evaluate('window.__STAGED__.controllers.Questions.getSnapshot().send.attempt.requestId'), failedRequestId, 'retry keeps the original native request ID');
    await app.host.threads.Questions.waitForIdle(app.host.context);
    await browser.until('retried native run settled', `!window.__STAGED__.controllers.Questions.getSnapshot().view.docs['pi.live']?.run`);
    await pause(250);
    assert.equal(await browser.evaluate(`${input('Questions')}.value`), 'Quelle dose pour un adulte ?', 'retry retains the first-stage failure choice and restores the real question');
    await browser.until('first-stage failure restores unadorned question', `${input('Questions')}.value === 'Quelle dose pour un adulte ?'`, 20000);
    await browser.until('first failure settled', `!window.__STAGED__.controllers.Questions.getSnapshot().view.docs['pi.live']?.run`);
    assert.equal(await browser.evaluate(`${last}.querySelectorAll('[role="alert"]').length`), 1);
    assert.match(await browser.evaluate(`${last}.querySelector('[role="alert"]').textContent`), /question.*saisie/i);
    assert.doesNotMatch(await browser.evaluate(`${last}.textContent`), /note précédente|en cours/);
    assert.equal(await browser.evaluate(`[...${thread('Questions')}.querySelectorAll('[data-role="user"]')].at(-1).textContent.trim()`), 'Quelle dose pour un adulte ?');
    await browser.evaluate(`${last}.scrollIntoView({block:'end',behavior:'instant'})`);
    await screenshot(`${device}-first-stage-error.png`);
    await browser.evaluate(`(() => { const e = ${input('Questions')}; e.focus(); e.select(); })()`); await browser.press('Backspace');
    await activate(`${thread('Questions')}.querySelector('[data-testid="fail-second"]')`);
    await browser.until('later-stage failure keeps the first stage', `${rows('Questions')}.at(-1)?.textContent.includes('vérifier le contexte') && !!${rows('Questions')}.at(-1)?.querySelector('[data-testid="response-error"]')`, 20000);
    assert.equal(await browser.evaluate(`${input('Questions')}.value`), '');
    await browser.until('later failure settled', `!window.__STAGED__.controllers.Questions.getSnapshot().view.docs['pi.live']?.run`);
    assert.equal(await browser.evaluate(`${last}.querySelectorAll('[role="alert"]').length`), 1);
    assert.match(await browser.evaluate(`${last}.querySelector('[role="alert"]').textContent`), /note précédente reste disponible/);
    assert.doesNotMatch(await browser.evaluate(`${last}.textContent`), /en cours/);
    assert.equal(await browser.evaluate(`[...${thread('Questions')}.querySelectorAll('[data-role="user"]')].at(-1).textContent.trim()`), 'Quelle dose pour un adulte ?');
    await browser.evaluate(`${rows('Questions')}.at(-1).scrollIntoView({block:'end',behavior:'instant'})`);
    await screenshot(`${device}-later-stage-error.png`);
    const accessibility = await browser.send('Accessibility.getFullAXTree');
    const controls = accessibility.nodes.filter(node => !node.ignored && ['button', 'textbox'].includes(node.role?.value));
    assert.ok(controls.length > 0);
    assert.deepEqual(controls.filter(node => !String(node.name?.value ?? '').trim()).map(node => node.role.value), [], 'visible controls have accessible names');
    steps.push({ device, width, height, geometry, displayLimit: 24, retainedRowsRevealed: true, scrollBefore: before, readingAnchor: anchor, finalAnchorOffset: anchorOffset, independentSeniorScroll: seniorScroll, nativeDurationMs: nativeDuration, stageStates: stages, unreadGeometry, retriedDemoFailure: true, nativeRequestIdPreserved: true, namedControls: controls.length, result: 'passed' });
    assert.equal(await browser.evaluate('document.documentElement.scrollWidth <= innerWidth'), true, 'no horizontal overflow');
    assert.deepEqual(browser.problems, []);
    await browser.close(); browser = undefined;
  }
  // Sent comments exercise the same native transcript renderer, independently of the staged answer workflow above.
  const feedbackEvidence = '.cache/evidence/D207'; mkdirSync(feedbackEvidence, { recursive: true });
  const report = draftReport({
    observed: { kind: 'host', subject: { type: 'app', app: 'fictional-workshop', route: '/settings' }, snapshot: 'app.dom@1', digest: `sha256:${'0'.repeat(64)}`, policy: { version: 1, widened: [] } },
    anchors: [{ kind: 'app.element@1', fallback: 'the Header' }, { kind: 'app.element@1', fallback: 'the Save button' }],
    said: '', notes: [{ anchor: 0, text: 'the logo is blurry' }, { anchor: 1, text: 'label unclear' }],
  }, { id: 'fb_123456789ABCDEFG', created: '2026-10-21T12:00:00Z' });
  const text = feedbackText(report);
  const long = feedbackText({ ...report, notes: Array.from({ length: 6 }, (_, at) => ({ anchor: at % 2, text: `Fictional comment ${at + 1}` })) });
  await app.host.threads.Questions.submit({ type: 'write', entry: { kind: 'message', model: [
    { role: 'user', content: `\`\`\`markdown\n${text}\`\`\``, timestamp: 0 },
    { role: 'user', content: `\`\`\`markdown\n${long}\`\`\``, timestamp: 1 },
    { role: 'user', content: 'hello', timestamp: 2 },
  ] } }, app.host.context);
  const feedbackSteps = [];
  for (const [device, width, height, locale] of [['desktop', 1440, 1000, 'en'], ['phone', 390, 844, 'fr']]) {
    browser = await launch(`${app.url}?lang=${locale}`, { evidence: feedbackEvidence });
    await browser.emulate(device);
    await browser.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: device === 'phone' });
    for (const dark of [false, true]) {
      await browser.send('Page.navigate', { url: `${app.url}?lang=${locale}&mode=${dark ? 'dark' : 'light'}` });
      const cards = `${thread('Questions')}.querySelectorAll('[data-testid="message-feedback"]')`;
      const card = `${cards}[0]`, disclosure = `${cards}[1].querySelector('button')`;
      const plain = `[...${thread('Questions')}.querySelectorAll('[data-testid="user-text"]')].at(-1)`;
      await browser.until('the formatter reports and the plain message', `${cards}.length === 2 && ${plain}?.textContent === 'hello'`, 20000);
      await browser.evaluate('document.fonts.ready.then(() => true)');
      await browser.evaluate(`${thread('Questions')}.querySelector('[data-testid="transcript-scroll"]').scrollTop = 1e6`);
      await pause(300);
      assert.equal(await browser.evaluate(`${card}.getAttribute('aria-label')`), locale === 'fr' ? '2 commentaires sur la page' : '2 comments on the page');
      assert.deepEqual(await browser.evaluate(`[...${card}.querySelectorAll('[data-testid="message-feedback-note"]')].map(node => node.textContent)`), ['Headerthe logo is blurry', 'Save buttonlabel unclear']);
      assert.equal(await browser.evaluate(`${disclosure}.getAttribute('aria-expanded')`), 'false');
      assert.equal(await browser.evaluate(`${cards}[1].querySelectorAll('[data-testid="message-feedback-note"]').length`), 0);
      assert.equal(await browser.evaluate(`${plain}.closest('[data-slot="bubble"]') !== null`), true, 'hello remains a normal text bubble');
      assert.equal(await browser.evaluate('document.documentElement.classList.contains("dark")'), dark);
      const bounds = await browser.evaluate(`(() => { const a = ${card}.getBoundingClientRect(), b = ${disclosure}.getBoundingClientRect(), c = ${plain}.getBoundingClientRect(), d = ${cards}[1].getBoundingClientRect(); return { card: { left: a.left, right: a.right, top: a.top, bottom: a.bottom }, control: { width: b.width, height: b.height, left: b.left, right: b.right }, longCard: { left: d.left, right: d.right }, plain: { top: c.top, bottom: c.bottom }, width: innerWidth }; })()`);
      assert.ok(bounds.control.left >= bounds.longCard.left && bounds.control.right <= bounds.longCard.right, `the entire disclosure is visible and tappable: ${JSON.stringify(bounds)}`);
      assert.ok(bounds.card.left >= 0 && bounds.card.right <= width && bounds.card.top >= 0 && bounds.card.bottom <= height, JSON.stringify(bounds));
      assert.ok(bounds.plain.top >= 0 && bounds.plain.bottom <= height, 'the plain message is visible with the card');
      if (device === 'phone') assert.ok(bounds.control.width >= 48 && bounds.control.height >= 48, `48px disclosure: ${JSON.stringify(bounds.control)}`);
      assert.equal(await browser.evaluate('document.documentElement.scrollWidth <= innerWidth'), true);
      const activate = device === 'phone' ? browser.tap : browser.click;
      await browser.screenshot(`sent-feedback-${locale}-${device}-${dark ? 'dark' : 'light'}.png`);
      if (device === 'desktop' && !dark) await browser.screenshot('plain-message.png');
      if (device === 'phone') await activate(disclosure);
      else { await browser.evaluate(`${disclosure}.focus()`); await browser.press('Enter'); }
      await browser.until('the long report opens', `${disclosure}.getAttribute('aria-expanded') === 'true' && ${cards}[1].querySelectorAll('[data-testid="message-feedback-note"]').length === 6`);
      await activate(disclosure);
      await browser.until('the long report closes', `${disclosure}.getAttribute('aria-expanded') === 'false'`);
      const accessibility = await browser.send('Accessibility.getFullAXTree');
      assert.ok(accessibility.nodes.some(node => !node.ignored && node.role?.value === 'button' && node.name?.value === (locale === 'fr' ? '6 commentaires sur la page' : '6 comments on the page')), 'native disclosure has a localised accessible name');
      feedbackSteps.push({ device, width, height, locale, dark, bounds, result: 'passed' });
    }
    assert.deepEqual(browser.problems, [], 'no sent-feedback page errors');
    await browser.close(); browser = undefined;
  }
  writeFileSync(`${feedbackEvidence}/journey-results.json`, JSON.stringify({ steps: feedbackSteps, limits: ['Fictional native transcript through the real transport.', 'Chromium phone emulation, not physical-device qualification.'] }, null, 2));
  writeFileSync(`${evidence}/journey-results.json`, JSON.stringify({ steps, limits: ['Scripted fictional model, not medical/provider qualification.', 'Native MemoryStorage survives browser reload only.'] }, null, 2));
  console.log('PASS: native staged chat on phone and desktop, restoration, retained text, filtered copy, unread, old offer and scroll independence');
} catch (error) { await browser?.screenshot('journey-failed.png').catch(() => {}); throw error; }
finally { await browser?.close(); await app.close(); }
