// Real-browser journey for the AgentLayer (scripted model, no key; fake microphone): a fictional fitness app with a fake screen and a 56px
// fake tab bar (./page.tsx) at 390x844 with touch. It proves: the trigger opens half with the page behind inert; the transcript scrolls
// without moving the page; a hard swipe on the handle stops at peek (never closes) with the tab bar tappable; tapping above the sheet moves
// full to peek; focusing the composer goes to full and keeps it above a shortened visual viewport; five messages stay above the composer;
// a suggestion chip fills the composer without sending; Back closes the layer and leaves the history clean; push-to-talk shows
// « J'écoute… » at peek and sends (auto) or fills (draft) with the screen context; the product manager swaps in with « ← »; controls are at
// least 44x44px and nothing overflows horizontally in light and dark; the Redaction and empty-template cases; and at 1280x800 the right
// panel. Point mode waits for #1661 (TODO in the item). Screenshots go to .cache/evidence/app-shell/.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launch, pause, q, qa } from '@hachej/boring-testing/browser';

process.env.STUDIO_MODEL = 'scripted';
const { startAppShell } = await import('./server.mjs');
const evidence = process.env.APP_EVIDENCE ?? '.cache/evidence/app-shell';
mkdirSync(evidence, { recursive: true });
const collect = process.env.COLLECT === '1';
const failed = [];
// COLLECT=1 (fail-first evidence): a failing step is reported and the journey goes on.
const step = async (name, run) => { if (process.env.ONLY && !new RegExp(process.env.ONLY).test(name)) return; const started = Date.now(); try { await run(); console.log(`ok  ${name} (${Date.now() - started} ms)`); } catch (error) { if (!collect) throw error; failed.push(name); console.log(`FAIL ${name}: ${String(error.message).split('\n')[0].slice(0, 200)}`); } };
const rect = selector => `(() => { const r = ${q(selector)}?.getBoundingClientRect(); return r && { x: r.x, y: r.y, w: r.width, h: r.height, right: r.right, bottom: r.bottom }; })()`;
const LAYER = '[data-testid=agent-layer]', TRIGGER = '[data-testid=agent-trigger]', TAB = '[data-testid=tab-Jour]', INPUT = '[data-testid=composer-input]';
const snap = `(${q(LAYER)}?.dataset.state ?? null)`;
const taps = `Number(${q('[data-testid=tab-count]')}.textContent)`;
const noOverflow = `document.documentElement.scrollWidth <= innerWidth && document.body.scrollWidth <= innerWidth`;
const base = { directory: mkdtempSync(join(tmpdir(), 'boring-app-shell-')) };

const app = await startAppShell(base);
let browser;
try {
  browser = await launch(app.url, { evidence, args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
  const { send } = browser;
  const touch = (type, points) => send('Input.dispatchTouchEvent', { type, touchPoints: points.map(([x, y]) => ({ x, y })) });
  /** A finger drag from (x, y0) to (x, y1) in steps, as raw touch events (synthesizeScrollGesture does not scroll here). */
  const dragTouch = async (x, y0, y1, steps = 8, { release = true } = {}) => {
    await touch('touchStart', [[x, y0]]);
    for (let i = 1; i <= steps; i++) { await touch('touchMove', [[x, y0 + (y1 - y0) * i / steps]]); await pause(16); }
    if (release) await touch('touchEnd', []);
  };
  const center = async selector => { const r = await browser.evaluate(rect(selector)); return { ...r, x: r.x + r.w / 2, y: r.y + r.h / 2 }; };
  /** A finger tap at the element's centre, without scrolling it into view first (that would move the sheet's own overflow). */
  const tap = async selector => {
    await browser.until(`tappable ${selector}`, `(() => { const r = ${q(selector)}?.getBoundingClientRect(); return r && r.width > 0 && r.bottom > 0 && r.top < innerHeight; })()`);
    const r = await center(selector);
    await touch('touchStart', [[r.x, r.y]]); await touch('touchEnd', []);
  };
  const live = () => browser.until('the chats are live', `${q('[data-testid=agent-trigger]')} && !${q('[data-testid=connecting]')}`, 30000);
  /** Every visible control of the layer is at least 44x44px (touch) and inside the viewport; fails with the selector. */
  const controls = async where => {
    const small = await browser.evaluate(`(() => { const out = []; const sel = '${LAYER} button, ${LAYER} [role=button], ${LAYER} textarea, ${LAYER} a[href], ${TRIGGER}, ${TAB}';
      for (const e of document.querySelectorAll(sel)) { const r = e.getBoundingClientRect(); const st = getComputedStyle(e); if (!r.width || st.visibility === 'hidden' || e.closest('[hidden]')) continue;  if (r.bottom < 0 || r.top > innerHeight) continue;
        if (r.width < 43.5 || r.height < 43.5) out.push((e.dataset.testid || e.getAttribute('aria-label') || e.tagName) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height)); } return out; })()`);
    assert.deepEqual(small, [], `${where}: controls under 44px`);
    assert.ok(await browser.evaluate(noOverflow), `${where}: horizontal overflow`);
  };
  const settle = () => pause(900);

  // A controllable visual viewport (the soft keyboard), installed before the page's scripts so the layer and the drawer both read it.
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => { const real = window.visualViewport; const t = new EventTarget(); let height = null;
    const vv = { addEventListener: t.addEventListener.bind(t), removeEventListener: t.removeEventListener.bind(t), dispatchEvent: t.dispatchEvent.bind(t),
      get height() { return height ?? real.height; }, get width() { return real.width; }, get offsetTop() { return 0; }, get offsetLeft() { return 0; }, get pageTop() { return real.pageTop; }, get pageLeft() { return real.pageLeft; }, get scale() { return 1; } };
    Object.defineProperty(window, 'visualViewport', { configurable: true, get: () => vv });
    window.__vv = { set: h => { height = h; t.dispatchEvent(new Event('resize')); } }; })()` });
  await browser.emulate('phone');
  await browser.reload();
  await live();

  await step('1 the trigger opens half: overlay visible, page behind inert (a tab tap does nothing)', async () => {
    assert.equal(await browser.evaluate(snap), null, 'closed: no layer mounted');
    await tap(TRIGGER);
    await browser.until('half', `${snap} === 'half'`);
    await settle();
    const layer = await browser.evaluate(rect(LAYER));
    assert.ok(layer.y > 200 && layer.y < 600 && Math.round(layer.bottom) >= 844, JSON.stringify(layer));
    assert.ok(await browser.evaluate(`!!document.querySelector('[data-slot=drawer-overlay]')`), 'modal backdrop');
    const before = await browser.evaluate(taps);
    await tap(TAB).catch(() => {});
    await pause(300);
    assert.equal(await browser.evaluate(taps), before, 'the tab bar behind a modal layer does not receive the tap');
    await browser.screenshot('phone-half.png');
    await controls('half');
    // Round c: the layer's own buttons are not browser-grey (the scoped reset stands in for Tailwind's preflight), and the microphone is in the composer row.
    assert.deepEqual(await browser.evaluate(`(() => { const s = getComputedStyle(${q('[data-testid=agent-layer-close]')}); return [s.appearance, s.borderTopWidth, s.backgroundColor]; })()`), ['none', '0px', 'rgba(0, 0, 0, 0)']);
    const mic = await browser.evaluate(rect('[data-testid=agent-talk]')), composer = await browser.evaluate(rect('[data-testid=composer]'));
    assert.ok(mic.y >= composer.y && mic.bottom <= composer.bottom, 'the microphone is in the composer row, not over the messages');
  });

  await step('7 a suggestion chip fills the composer and sends nothing', async () => {
    const submits = app.submits.length;
    await browser.evaluate(`(() => { const chip = ${q('[data-testid=agent-layer-sheet] [data-testid=empty-suggestion]')} ?? [...document.querySelectorAll('${LAYER} button')].find(b => b.textContent.includes('Résumé de la semaine')); chip.click(); })()`);
    await browser.until('chip text in the composer', `${q(INPUT)}?.value === 'Fais le résumé de ma semaine'`);
    assert.equal(app.submits.length, submits, 'no submit request');
    await pause(400);
    assert.equal(await browser.evaluate(snap), 'full', 'the composer took focus: full');
    // Empty the composer again (React-compatible value setter) so the next messages stand alone.
    await browser.evaluate(`(() => { const t = ${q(INPUT)}; Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(t, ''); t.dispatchEvent(new Event('input', { bubbles: true })); t.blur(); })()`);
  });

  await step('4 a tap above the sheet moves full to peek (never closes); the tab bar is then tappable', async () => {
    await settle();
    assert.equal(await browser.evaluate(snap), 'full');
    const layer = await browser.evaluate(rect(LAYER));
    assert.ok(layer.y > 5, `a gap above the full sheet: ${layer.y}`);
    await touch('touchStart', [[195, layer.y / 2]]); await touch('touchEnd', []);
    await browser.until('peek', `${snap} === 'peek'`);
    await settle();
    await browser.screenshot('phone-peek.png');
    const before = await browser.evaluate(taps);
    await tap(TAB);
    await browser.until('the tab bar took the tap', `${taps} === ${before + 1}`);
    const peek = await browser.evaluate(rect(LAYER));
    const tab = await browser.evaluate(rect('[data-testid=tabbar]'));
    assert.ok(Math.abs(peek.y + 96 - tab.y) <= 3, `the 6rem peek ends where the tab bar starts: ${JSON.stringify({ peek, tab })}`);
    await controls('peek');
    // Round c: the peek is ONE compact row (no Close, a one-line input with the coach's placeholder, the microphone and Send).
    const row = await browser.evaluate(rect('[data-testid=composer]'));
    assert.ok(row.h >= 44 && row.h <= 64, `the peek composer is one row of 44-64px: ${row.h}`);
    assert.equal(await browser.evaluate(`!!${q('[data-testid=agent-layer-close]')}`), false, 'no Close at peek');
    assert.equal(await browser.evaluate(`${q(INPUT)}.placeholder`), 'Parle au coach…');
    assert.deepEqual(await browser.evaluate(`['composer-plus', 'composer-feedback'].map(id => !!${q('[data-testid=composer] [data-testid=composer-plus]')} && ${q('[data-testid=composer] [data-testid=composer-plus]')}.getBoundingClientRect().width > 0)`), [false, false], 'the other composer controls wait for half');
    const mic = await browser.evaluate(rect('[data-testid=agent-talk]'));
    assert.ok(mic && mic.y >= row.y - 1 && mic.bottom <= row.bottom + 1, 'the microphone is in the composer row');
  });

  await step('5 focusing the composer goes to full, above a shortened visual viewport, in a 16px font', async () => {
    await tap(INPUT);
    await browser.until('full', `${snap} === 'full'`);
    await settle();
    // The soft keyboard: the visual viewport shrinks to 390x500 while the layout viewport stays (as on a phone).
    await browser.evaluate(`window.__vv.set(500)`);
    await pause(900);
    const composer = await browser.evaluate(rect(INPUT));
    const vvBottom = await browser.evaluate(`(window.visualViewport?.offsetTop ?? 0) + (window.visualViewport?.height ?? innerHeight)`);
    assert.ok(composer.bottom <= vvBottom + 1, `composer bottom ${composer.bottom} within the visual viewport ${vvBottom}`);
    assert.ok(Number.parseFloat(await browser.evaluate(`getComputedStyle(${q(INPUT)}).fontSize`)) >= 16, 'composer font-size >= 16px');
    await browser.evaluate(`window.__vv.set(844)`);
    await browser.evaluate(`${q(INPUT)}.blur()`);
    await pause(400);
  });

  await step('6 five messages: after each, the last row is above the composer', async () => {
    for (let i = 1; i <= 5; i++) {
      await browser.evaluate(`(() => { const t = ${q(INPUT)}; t.focus(); })()`);
      await browser.type(q(INPUT), `message ${i}`);
      await tap('[data-testid=composer-submit]');
      await browser.until(`reply ${i}`, `document.body.innerText.includes('Réponse ${['', 'un', 'deux', 'trois', 'quatre', 'cinq'][i]}')`, 20000);
      await pause(500);
      const last = await browser.evaluate(`(() => { const rows = [...document.querySelectorAll('${LAYER} [data-testid=transcript] > *')].filter(e => e.getBoundingClientRect().height); const r = rows.at(-1).getBoundingClientRect(); return r.bottom; })()`);
      const top = (await browser.evaluate(rect(INPUT))).y;
      assert.ok(last <= top + 1, `message ${i}: last row bottom ${last} <= composer top ${top}`);
    }
    await browser.screenshot('phone-full.png');
  });

  await step('2 the transcript scrolls under a finger and the page behind does not move', async () => {
    await browser.evaluate(`window.scrollTo(0, 0)`);
    const scroller = '[data-testid=transcript-scroll]';
    const t0 = await browser.evaluate(`${q(scroller)}.scrollTop`);
    const r = await center(scroller);
    await dragTouch(r.x, r.y - 20, r.y + 120);
    await pause(300);
    const up = await browser.evaluate(`${q(scroller)}.scrollTop`);
    await dragTouch(r.x, r.y + 100, r.y - 100);
    await pause(300);
    const down = await browser.evaluate(`${q(scroller)}.scrollTop`);
    assert.ok(up !== t0 || down !== up, `the transcript scrolled (${t0} -> ${up} -> ${down})`);
    assert.equal(await browser.evaluate(`window.scrollY`), 0, 'the page behind did not scroll');
    assert.ok(['full', 'half'].includes(await browser.evaluate(snap)), 'the transcript drag did not move the sheet');
    assert.equal(await browser.evaluate(snap), 'full');
  });

  await step('3 a hard swipe down on the handle stops at peek: the layer is not closed', async () => {
    await browser.evaluate(`${q(INPUT)}?.blur()`);
    const handle = await center('[data-slot=drawer-swipe-handle]');
    await dragTouch(handle.x, handle.y, 840, 10);
    await settle();
    const state = await browser.evaluate(snap);
    assert.ok(state === 'peek' || state === 'half', `after a swipe the layer is at ${state}`);
    if (state !== 'peek') { const h = await center('[data-slot=drawer-swipe-handle]'); await dragTouch(h.x, h.y, 840, 10); await settle(); }
    assert.equal(await browser.evaluate(snap), 'peek', 'never closed');
    const before = await browser.evaluate(taps);
    await tap(TAB);
    await browser.until('tab tappable at peek', `${taps} === ${before + 1}`);
  });

  await step('8 Back closes the layer, keeps the URL, and the history is clean', async () => {
    await tap(TRIGGER);
    await browser.until('half', `${snap} === 'half'`);
    const href = await browser.evaluate(`location.href`);
    assert.deepEqual(await browser.evaluate(`history.state`), { appShell: 'agent' }, 'half owns one history entry');
    await browser.evaluate(`history.back()`);
    await browser.until('closed', `${snap} === null || ${snap} === undefined`);
    assert.equal(await browser.evaluate(`location.href`), href);
    assert.equal(await browser.evaluate(`history.state`), null, 'the entry was consumed');
    await tap(TRIGGER); await browser.until('half again', `${snap} === 'half'`); await settle();
    await tap('[data-testid=agent-layer-close]');
    await browser.until('closed by the button', `!${q(LAYER)}`);
    await pause(300);
    assert.equal(await browser.evaluate(`history.state`), null, 'the close button removed the entry too');
    assert.equal(await browser.evaluate(`location.href`), href);
    // A second Back leaves the page for its previous entry: nothing of the layer is left in the history.
    await browser.evaluate(`history.back()`).catch(() => {});
    await browser.until('left the page', `location.href === 'about:blank'`, 8000);
    await browser.evaluate(`history.forward()`).catch(() => {});
    await browser.until('back on the page', `location.href === ${JSON.stringify(href)}`, 8000);
    await live();
  });

  await step('9 push-to-talk: hold shows « J\'écoute… » at peek; release sends with the screen context (auto)', async () => {
    const before = app.submits.length;
    const r = await center(TRIGGER);
    await touch('touchStart', [[r.x, r.y]]);
    if (process.env.DBG) { await pause(2000); console.log('DBG', await browser.evaluate(`JSON.stringify({ snap: ${snap}, listening: ${q('[data-testid=agent-listening]')}?.outerHTML.slice(0, 150), talk: ${q('[data-testid=agent-talk]')}?.dataset.state, prob: ${q('[data-testid=agent-voice-problem]')}?.textContent })`)); }
    await browser.until('listening at peek', `${q('[data-testid=agent-listening]')}?.textContent.includes("J'écoute") && ${q('[data-testid=agent-listening]')}.dataset.phase === 'recording'`, 8000);
    assert.equal(await browser.evaluate(snap), 'peek');
    await browser.screenshot('phone-listening.png');
    await pause(600); // the fake microphone needs a moment of audio
    await touch('touchEnd', []);
    await browser.until('submit recorded', `true`);
    for (let i = 0; i < 100 && app.submits.length === before; i++) await pause(100);
    const sent = app.submits.at(-1);
    assert.equal(sent.agent, 'coach');
    assert.deepEqual(sent.body.context, { name: 'Progrès', params: { range: 30 } });
    assert.equal(app.contexts.at(-1).value.name, 'Progrès', 'the transport handed the context to the host');
    await browser.until('the reply', `document.body.innerText.includes('Hier : 8 200 pas')`, 20000);
  });

  await step('9b a slide off the trigger cancels the recording', async () => {
    const before = app.submits.length;
    const r = await center(TRIGGER);
    await touch('touchStart', [[r.x, r.y]]);
    await browser.until('listening', `${q('[data-testid=agent-listening]')}?.dataset.phase === 'recording'`, 8000);
    await touch('touchMove', [[r.x - 150, r.y + 200]]);
    await browser.until('cancelled', `!${q('[data-testid=agent-listening]')}`, 5000);
    await touch('touchEnd', []);
    await pause(800);
    assert.equal(app.submits.length, before);
  });

  await step('10 the product manager swaps in with « ← », each chat keeps its own draft', async () => {
    await tap(TRIGGER); await browser.until('half', `${snap} === 'half'`); await settle();
    await browser.evaluate(`(() => { const t = ${q(INPUT)}; t.focus(); })()`);
    await send('Input.insertText', { text: 'brouillon du coach' });
    await browser.evaluate(`document.activeElement.blur()`);
    await browser.evaluate(`${q('[data-testid=agent-layer-close]')}.click()`);
    await browser.until('closed', `!${q(LAYER)}`);
    await tap('[data-testid=menu-improve]');
    await browser.until('improve shown', `${q('[data-testid=agent-layer-title]')}?.textContent === "Améliorer l'app"`);
    assert.ok(await browser.evaluate(`!!${q('[data-testid=agent-layer-back]')}`), 'the « ← » is shown');
    await settle();
    await browser.screenshot('phone-improve.png');
    await controls('improve');
    await tap('[data-testid=agent-layer-back]');
    await browser.until('back to the coach', `${q('[data-testid=agent-layer-title]')}?.textContent === 'Coach'`);
    assert.equal(await browser.evaluate(`${q('[data-spec=agent] ' + INPUT)}.value`), 'brouillon du coach', 'the draft survived');
    await tap('[data-testid=agent-layer-close]');
    await browser.until('closed', `!${q(LAYER)}`);
    // Point mode: « Montrer dans l'app » hides the sheet, the point bar sits above the tab bar, a pick, « Terminé » brings it back with the chip.
    await tap('[data-testid=menu-improve]');
    await browser.until('improve shown', `${q('[data-testid=agent-layer-title]')}?.textContent === "Améliorer l'app"`);
    await settle();
    assert.equal(await browser.evaluate(`${q('[data-spec=improve] [data-testid=composer-point]')}?.textContent`), 'Montrer dans l’app');
    await tap('[data-spec=improve] [data-testid=composer-point]');
    await browser.until('point bar, sheet hidden', `!!${q('[data-testid=feedback-point-bar]')} && !${q(LAYER)}`, 8000);
    await pause(500);
    const bar = await browser.evaluate(rect('[data-testid=feedback-point-bar]'));
    const tabs = await browser.evaluate(rect('[data-testid=tabbar]'));
    assert.ok(bar.bottom <= tabs.y + 1, `the point bar is above the tab bar: ${JSON.stringify({ bar, tabs })}`);
    await browser.screenshot('phone-point-bar.png');
    await tap('[data-testid=screen] li:nth-child(3)');
    await browser.until('a bubble', `!!${q('[data-testid=feedback-bubble]')}`, 8000);
    await browser.evaluate(`document.activeElement.blur()`);
    await tap('[data-testid=feedback-point-done]');
    await browser.until('the sheet is back with the chip', `${snap} === 'half' && !!${q('[data-spec=improve]')} && !${q('[data-testid=feedback-point-bar]')}`, 8000);
    await browser.evaluate(`${q('[data-testid=agent-layer-close]')}.click()`);
    await browser.until('closed', `!${q(LAYER)}`);
  });

  await step('11 dark theme: the layer renders and nothing overflows', async () => {
    await browser.evaluate(`document.documentElement.classList.add('dark')`);
    await tap(TRIGGER); await browser.until('half', `${snap} === 'half'`); await settle();
    await browser.screenshot('phone-half-dark.png');
    await controls('half dark');
    await browser.evaluate(`${q('[data-testid=agent-layer-close]')}.click()`);
    await browser.until('closed', `!${q(LAYER)}`);
    await browser.evaluate(`document.documentElement.classList.remove('dark')`);
  });

  await step('review 2: entering half from peek moves focus from the page into the layer', async () => {
    await tap(TRIGGER); await browser.until('half', `${snap} === 'half'`); await settle();
    const handle = await center('[data-slot=drawer-swipe-handle]');
    await dragTouch(handle.x, handle.y, 840, 10);
    await browser.until('peek', `${snap} === 'peek'`); await settle();
    await browser.evaluate(`${q(TAB)}.focus()`);
    await tap(TRIGGER); await browser.until('half', `${snap} === 'half'`); await settle();
    assert.equal(await browser.evaluate(`!!document.activeElement?.closest('[data-slot=drawer-popup]')`), true, `focus is inside the modal layer (it is on ${await browser.evaluate('document.activeElement?.tagName')})`);
    assert.equal(await browser.evaluate(`!!${q('[data-spec=agent] [data-testid=host-tool]')}`), true, "the host's own composer tools stay beside the microphone");
    assert.equal(await browser.evaluate(`${q(LAYER)}.getAttribute('aria-label')`), 'Coach', 'review 8: the dialog is named');
    assert.equal(await browser.evaluate(`getComputedStyle(${q(LAYER)}).getPropertyValue('--app-shell-tabbar')`).then(v => v.trim()), '56px', 'review 4: the portalled popup is given the tab bar height');
  });

  await step('review 9: every control of the layer, transcript buttons included, is at least 44px', async () => {
    await controls('half with replies');
    await browser.evaluate(`${q('[data-testid=agent-layer-close]')}.click()`);
    await browser.until('closed', `!${q(LAYER)}`);
  });

  await step('review 6: the chat keeps its DOM while the layer is closed and while pointing', async () => {
    await tap('[data-testid=menu-improve]');
    await browser.until('improve', `${q('[data-testid=agent-layer-title]')}?.textContent === "Améliorer l'app"`); await settle();
    await browser.evaluate(`window.__chatNode = ${q('[data-spec=improve] [data-boring=pi-chat]')}; 0`);
    await browser.evaluate(`${q('[data-testid=agent-layer-close]')}.click()`);
    await browser.until('closed', `!${q(LAYER)}`);
    assert.equal(await browser.evaluate(`window.__chatNode.isConnected === false && !!window.__chatNode`), true, 'detached while closed, not destroyed');
    await tap('[data-testid=menu-improve]');
    await browser.until('improve again', `!!${q('[data-spec=improve] [data-boring=pi-chat]')}`); await settle();
    assert.equal(await browser.evaluate(`${q('[data-spec=improve] [data-boring=pi-chat]')} === window.__chatNode`), true, 'the same chat element came back');
  });

  await step('review 3: Back during point mode ends pointing and keeps the page and the layer', async () => {
    const href = await browser.evaluate('location.href');
    await tap('[data-spec=improve] [data-testid=composer-point]');
    await browser.until('pointing', `!!${q('[data-testid=feedback-point-bar]')}`, 8000);
    assert.equal(await browser.evaluate('history.state?.appShell'), 'point');
    await browser.evaluate('history.back()');
    await browser.until('pointing ended', `!${q('[data-testid=feedback-point-bar]')} && ${snap} === 'half'`, 8000);
    assert.equal(await browser.evaluate('location.href'), href, 'still on the page');
    assert.equal(await browser.evaluate('history.state?.appShell'), 'agent', 'the layer keeps its entry');
    await settle();
  });

  await step('review 5: ordinary feedback has its note editor, inside the layer', async () => {
    await tap('[data-spec=improve] [data-testid=composer-feedback]');
    await browser.until('the general question button', `!!${q('[data-testid=feedback-general]')}`, 8000);
    await tap('[data-testid=feedback-general]');
    await browser.until('the editor', `!!${q('[data-testid=feedback-general-input]')}`, 8000);
    assert.equal(await browser.evaluate(`document.activeElement === ${q('[data-testid=feedback-general-input]')} && !!document.activeElement.closest('[data-slot=drawer-popup]')`), true, 'focused, inside the modal layer');
    const bubble = await browser.evaluate(rect('[data-testid=feedback-general-bubble]'));
    assert.ok(bubble && bubble.w > 0 && bubble.y >= 0 && bubble.bottom <= 844, `the note editor is inside the viewport: ${JSON.stringify(bubble)}`);
    await browser.press('Escape');
    await pause(400);
    await browser.evaluate(`window.__vv.set(844)`);
  });

  await step('review 7: a send that fails keeps the transcript in the composer', async () => {
    await browser.send('Page.navigate', { url: app.url });
    await live();
    await browser.evaluate(`window.__breakSend = true`);
    const before = app.submits.length;
    const r = await center(TRIGGER);
    await touch('touchStart', [[r.x, r.y]]);
    await browser.until('listening', `${q('[data-testid=agent-listening]')}?.dataset.phase === 'recording'`, 8000);
    await pause(600);
    await touch('touchEnd', []);
    await browser.until('the composer holds the transcript', `${q(INPUT)}?.value === 'Combien de pas hier ?'`, 20000);
    assert.equal(app.submits.length, before);
    assert.equal(await browser.evaluate(snap), 'half');
    await browser.evaluate(`window.__breakSend = false`);
  });

  await step('round c 4: the account sheet then « Améliorer l\'app » then point mode keeps the page (no about:blank)', async () => {
    await browser.send('Page.navigate', { url: app.url });
    await live();
    const href = await browser.evaluate('location.href');
    await tap('[data-testid=menu-button]');
    await browser.until('the account sheet', `!!${q('[data-testid=account-sheet]')}`);
    await settle();
    if (process.env.DBG) console.log('RECT', JSON.stringify(await browser.evaluate(rect('[data-testid=account-improve]'))), await browser.evaluate(`document.elementFromPoint(100, 800)?.outerHTML.slice(0, 120)`));
    await tap('[data-testid=account-improve]');
    if (process.env.DBG) { await pause(1500); console.log('DBG', await browser.evaluate(`JSON.stringify({ href: location.href, st: history.state, snap: ${snap}, sheet: !!${q('[data-testid=account-sheet]')} })`)); }
    await browser.until('improve shown', `${q('[data-testid=agent-layer-title]')}?.textContent === "Améliorer l'app"`); await settle();
    assert.equal(await browser.evaluate('location.href'), href);
    assert.equal(await browser.evaluate('history.state?.appShell'), 'agent', 'the layer owns its entry after the sheet closed');
    await tap('[data-spec=improve] [data-testid=composer-point]');
    await browser.until('pointing', `!!${q('[data-testid=feedback-point-bar]')}`, 8000);
    await pause(600);
    assert.equal(await browser.evaluate('location.href'), href, 'still on the page while pointing');
    await tap('[data-testid=feedback-point-cancel]');
    await browser.until('back to the sheet', `!${q('[data-testid=feedback-point-bar]')} && ${snap} === 'half'`, 8000);
    assert.equal(await browser.evaluate('location.href'), href);
    await browser.evaluate('history.back()');
    await browser.until('closed by Back', `${snap} === null`);
    assert.equal(await browser.evaluate('location.href'), href, 'one Back closed the layer and nothing more');
  });

  await step('draft mode: push-to-talk only fills the composer', async () => {
    await browser.send('Page.navigate', { url: `${app.url}?send=draft` });
    await live();
    const before = app.submits.length;
    const r = await center(TRIGGER);
    await touch('touchStart', [[r.x, r.y]]);
    await browser.until('listening', `${q('[data-testid=agent-listening]')}?.dataset.phase === 'recording'`, 8000);
    await pause(600);
    await touch('touchEnd', []);
    await browser.until('the composer holds the transcript', `${q(INPUT)}?.value === 'Combien de pas hier ?'`, 20000);
    assert.equal(app.submits.length, before, 'nothing sent');
  });

  await step('Redaction case: no agent, no trigger, no peek; the manager opens at half and a swipe down does not close it', async () => {
    await browser.send('Page.navigate', { url: `${app.url}?mode=redaction` });
    await browser.until('ready', `!!${q('[data-testid=menu-improve]')} && !${q('[data-testid=connecting]')}`, 30000);
    assert.equal(await browser.evaluate(`!!${q(TRIGGER)}`), false);
    await tap('[data-testid=menu-improve]');
    await browser.until('half', `${snap} === 'half'`); await settle();
    assert.equal(await browser.evaluate(`!!${q('[data-testid=agent-layer-back]')}`), false, 'no agent to go back to');
    const handle = await center('[data-slot=drawer-swipe-handle]');
    await dragTouch(handle.x, handle.y, 840, 10);
    await settle();
    assert.equal(await browser.evaluate(snap), 'half', 'a swipe down from half does not close it');
  });

  await step('empty template: an agent without voice has no hero microphone', async () => {
    await browser.send('Page.navigate', { url: `${app.url}?mode=template` });
    await browser.until('ready', `!!${q(TRIGGER)} && !${q('[data-testid=connecting]')}`, 30000);
    await tap(TRIGGER); await browser.until('half', `${snap} === 'half'`); await settle();
    assert.equal(await browser.evaluate(`!!${q('[data-testid=agent-talk]')}`), false);
    await browser.evaluate(`${q('[data-testid=agent-layer-close]')}.click()`);
    await browser.until('closed', `!${q(LAYER)}`);
  });

  await step('expanded 1280x800: the trigger opens the right panel, the page stays interactive, Escape closes it', async () => {
    await browser.emulate('desktop');
    await browser.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
    await browser.send('Page.navigate', { url: app.url });
    await live();
    await browser.click(q(TRIGGER));
    await browser.until('panel open', `${q(LAYER)}?.dataset.state === 'open'`);
    await pause(500);
    const panel = await browser.evaluate(rect('[data-slot=sidebar-container]'));
    assert.ok(Math.abs(panel.w - 384) <= 2 && Math.abs(panel.right - await browser.evaluate('document.documentElement.clientWidth')) <= 1, `a 24rem panel on the right edge: ${JSON.stringify(panel)}`);
    assert.equal(await browser.evaluate(`!!document.querySelector('[data-slot=drawer-overlay]')`), false, 'not modal');
    const before = await browser.evaluate(taps);
    await browser.click(q(TAB));
    await browser.until('the page took the click', `${taps} === ${before + 1}`);
    await browser.screenshot('desktop-panel.png');
    await browser.press('Escape');
    await browser.until('closed', `${q(LAYER)}?.dataset.state === 'closed'`);
  });

  if (failed.length) console.log(`COLLECT: ${failed.length} failing step(s): ${failed.join(' | ')}`);
  console.log(browser.problems.length ? `page problems:\n${browser.problems.join('\n')}` : 'no page problems');
  assert.deepEqual(browser.problems.filter(p => !/Failed to load resource/.test(p)), []);
} finally { await browser?.close(); await app.close(); }
