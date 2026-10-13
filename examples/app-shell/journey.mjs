// Real-browser journey for the app shell (scripted model, no key; fake microphone): a fictional fitness app in <AppShell layout="screen">
// (./page.tsx) at 390x844 with touch. Layout A: three tabs that keep their screens mounted (scroll survives, no history entry), one header
// per screen through useScreenHeader, the account sheet (Back closes it, one sheet at a time), « Plus » with six screens, the one-screen
// template (no tab bar), and at 1280x800 the sidebar (rail, NavUser). The AgentLayer, in the same page, proves: the trigger opens half with the page behind inert; the transcript scrolls
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
const step = async (name, run) => { const started = Date.now(); await run(); console.log(`ok  ${name} (${Date.now() - started} ms)`); };
const rect = selector => `(() => { const r = ${q(selector)}?.getBoundingClientRect(); return r && { x: r.x, y: r.y, w: r.width, h: r.height, right: r.right, bottom: r.bottom }; })()`;
const LAYER = '[data-testid=agent-layer]', TRIGGER = '[data-testid=agent-trigger]', TAB = '[data-testid=tab-jour]', INPUT = '[data-testid=composer-input]';
const snap = `(${q(LAYER)}?.dataset.state ?? null)`;
const taps = `window.__routes.length`;
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
    const small = await browser.evaluate(`(() => { const out = []; const sel = '${LAYER} button, ${LAYER} [role=button], ${LAYER} textarea, ${LAYER} a[href], ${TRIGGER}, [data-testid=tabbar] [role=tab], [data-testid=screen-header] button';
      for (const e of document.querySelectorAll(sel)) { const r = e.getBoundingClientRect(); const st = getComputedStyle(e); if (!r.width || st.visibility === 'hidden' || e.closest('[hidden]')) continue; if (e.closest('[data-testid=transcript]')) continue; /* pi-chat's own reply actions (40px): a known gap in pi-chat, which this item does not change */ if (r.bottom < 0 || r.top > innerHeight) continue;
        if (r.width < 43.5 || r.height < 43.5) out.push((e.dataset.testid || e.getAttribute('aria-label') || e.tagName) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height)); } return out; })()`);
    assert.deepEqual(small, [], `${where}: controls under 44px`);
    assert.ok(await browser.evaluate(noOverflow), `${where}: horizontal overflow`);
  };
  const settle = () => pause(900);
  /** The account sheet, then « Améliorer l'app »: opens the product manager in the layer. */
  const openImprove = async () => {
    await tap('[data-testid=account-button]');
    await browser.until('the account sheet', `!!${q('[data-testid=account-improve]')}`);
    await pause(700);
    await tap('[data-testid=account-improve]');
  };
  const openSheets = `document.querySelectorAll('[data-testid=app-sheet]').length`;
  /** Nothing covers the tab bar: the element at the middle of each tab is that tab. */
  const tabsFree = () => browser.evaluate(`[...document.querySelectorAll('[data-testid=tabbar] [role=tab]')].every(tab => { const r = tab.getBoundingClientRect(); const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return tab.contains(hit); })`);

  // A controllable visual viewport (the soft keyboard), installed before the page's scripts so the layer and the drawer both read it.
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => { const real = window.visualViewport; const t = new EventTarget(); let height = null;
    const vv = { addEventListener: t.addEventListener.bind(t), removeEventListener: t.removeEventListener.bind(t), dispatchEvent: t.dispatchEvent.bind(t),
      get height() { return height ?? real.height; }, get width() { return real.width; }, get offsetTop() { return 0; }, get offsetLeft() { return 0; }, get pageTop() { return real.pageTop; }, get pageLeft() { return real.pageLeft; }, get scale() { return 1; } };
    Object.defineProperty(window, 'visualViewport', { configurable: true, get: () => vv });
    window.__vv = { set: h => { height = h; t.dispatchEvent(new Event('resize')); } }; })()` });
  await browser.emulate('phone');
  await browser.reload();
  await live();

  const historyLength = await browser.evaluate(`history.length`);
  await step('A fitness: three tabs keep their screens mounted: the scroll survives and a tab switch adds no history entry', async () => {
    assert.equal(await browser.evaluate(`document.querySelectorAll('[data-testid=tabbar] [role=tab]').length`), 3);
    assert.equal(await browser.evaluate(`!!${q('[data-testid=tab-plus]')}`), false, 'no « Plus » with three screens');
    assert.equal(await browser.evaluate(`getComputedStyle(${q('[data-testid=tabbar]')}).paddingBottom`), '0px', 'safe-area padding is 0 here');
    const bar = await browser.evaluate(rect('[data-testid=tabbar]'));
    assert.ok(bar.h >= 56, `the tab bar is at least 56px tall: ${bar.h}`);
    assert.equal(await browser.evaluate(`getComputedStyle(document.documentElement).getPropertyValue('--app-shell-tabbar')`), `${bar.h}px`, '--app-shell-tabbar is the measured height');
    assert.equal(await browser.evaluate(`${q('[data-testid=tabbar]')}.getAttribute('role')`), 'tablist');
    assert.ok(await browser.evaluate(`${q('[data-testid=tabbar]')}.hasAttribute('data-feedback-ignore')`));
    const scroller = '[data-testid=screen-jour]';
    const r = await center(scroller);
    await dragTouch(r.x, r.y + 150, r.y - 150);
    await pause(500);
    const kept = await browser.evaluate(`${q(scroller)}.scrollTop`);
    assert.ok(kept > 100, `Jour scrolled: ${kept}`);
    assert.deepEqual(await browser.evaluate(`window.__agentContext()`), { name: 'Jour', params: {} }, 'the shell tells the agent which screen is on show');
    await tap('[data-testid=tab-progres]');
    await browser.until('Progrès on show', `!${q('[data-testid=screen-progres]')}.hidden && ${q(scroller)}.hidden`);
    assert.deepEqual(await browser.evaluate(`window.__agentContext()`), { name: 'Progrès', params: { range: 30 } }, 'a screen\'s own context overrides the shell\'s');
    await tap('[data-testid=tab-jour]');
    await browser.until('Jour on show', `!${q(scroller)}.hidden`);
    await pause(200);
    assert.equal(await browser.evaluate(`${q(scroller)}.scrollTop`), kept, 'the scroll position is kept');
    assert.equal(await browser.evaluate(`history.length`), historyLength, 'tab switches add no history entry');
    assert.deepEqual(await browser.evaluate(`window.__routes`), ['progres', 'jour']);
    assert.ok(await tabsFree(), 'nothing covers the tab bar');
    await browser.screenshot('phone-tabs.png');
    await controls('tabs');
  });

  await step('B the header: « Ma journée » on Jour, « Importer » only on Données, then theme and agent triggers, all at least 44px', async () => {
    const header = async () => browser.evaluate(`({ title: ${q('[data-testid=header-title]')}.textContent, subtitle: ${q('[data-testid=header-subtitle]')}?.textContent ?? null,
      actions: [...document.querySelectorAll('[data-testid^=header-action-]')].map(e => e.dataset.testid.slice(14)), agent: !!${q('[data-testid=agent-trigger]')} })`);
    assert.deepEqual(await header(), { title: 'Ma journée', subtitle: 'mardi 13 octobre', actions: ['theme'], agent: true });
    await tap('[data-testid=tab-donnees]');
    await browser.until('Données header', `${q('[data-testid=header-title]')}.textContent === 'Données'`);
    assert.deepEqual(await header(), { title: 'Données', subtitle: null, actions: ['import', 'theme'], agent: true });
    const order = await browser.evaluate(`[...document.querySelectorAll('[data-testid=screen-header] button')].map(e => e.dataset.testid)`);
    assert.deepEqual(order.slice(-3), ['header-action-import', 'header-action-theme', 'agent-trigger'], 'actions, then the agent trigger');
    await controls('header');
    await tap('[data-testid=header-action-import]');
    assert.deepEqual(await browser.evaluate(`window.__did`), ['import'], 'the latest onSelect runs');
    await tap('[data-testid=tab-progres]');
    await browser.until('Progrès header', `${q('[data-testid=header-title]')}.textContent === 'Progrès'`);
    assert.deepEqual((await header()).actions, ['theme'], 'a hidden screen does not keep its action');
    await tap('[data-testid=tab-jour]');
    await browser.until('Jour header', `${q('[data-testid=header-title]')}.textContent === 'Ma journée'`);
  });

  await step('C the account sheet: avatar opens it, Back closes it and the URL is unchanged, a choice closes it', async () => {
    const href = await browser.evaluate(`location.href`);
    await tap('[data-testid=account-button]');
    await browser.until('the sheet', `${openSheets} === 1 && !!${q('[data-testid=account-improve]')}`);
    await pause(700);
    const rows = await browser.evaluate(`[...document.querySelectorAll('[data-testid=account-menu] button')].map(e => e.textContent.trim())`);
    assert.deepEqual(rows, ["Améliorer l'app", 'Réglages', 'Nouveautés', 'Se déconnecter']);
    assert.ok((await browser.evaluate(`${q('[data-testid=account-menu]')}.innerText`)).includes('camille@example.invalid'), 'the person block');
    await browser.screenshot('phone-account.png');
    await controls('account sheet');
    assert.deepEqual(await browser.evaluate(`history.state`), { appShell: 'sheet' }, 'an open sheet owns one history entry');
    await browser.evaluate(`history.back()`);
    await browser.until('closed by Back', `${openSheets} === 0`);
    assert.equal(await browser.evaluate(`location.href`), href);
    assert.equal(await browser.evaluate(`history.state`), null);
    await tap('[data-testid=account-button]');
    await browser.until('the sheet again', `${openSheets} === 1`);
    await pause(700);
    await tap('[data-testid=account-menu] button:nth-of-type(2)');
    await browser.until('closed by a choice', `${openSheets} === 0`);
    assert.equal((await browser.evaluate(`window.__did`)).at(-1), 'settings');
    await pause(500);
    assert.equal(await browser.evaluate(`history.state`), null, 'a choice leaves no history entry');
  });

  await step('D « Améliorer l\'app » shows the product manager in the layer; closing it leaves the history clean', async () => {
    await openImprove();
    await browser.until('improve shown', `${q('[data-testid=agent-layer-title]')}?.textContent === "Améliorer l'app"`);
    await pause(700);
    assert.equal(await browser.evaluate(`${openSheets}`), 0, 'the account sheet closed');
    await tap('[data-testid=agent-layer-close]');
    await browser.until('closed', `!${q(LAYER)}`);
    await pause(500);
    assert.equal(await browser.evaluate(`history.state`), null);
  });

  await step('E six screens: three tabs plus « Plus »; the fifth screen takes the place of « Plus »; one sheet at a time', async () => {
    await browser.send('Page.navigate', { url: `${app.url}?app=fitness&nav=6` });
    await live();
    assert.deepEqual(await browser.evaluate(`[...document.querySelectorAll('[data-testid=tabbar] [role=tab]')].map(e => e.textContent.trim())`), ['Jour', 'Progrès', 'Données', 'Plus']);
    await tap('[data-testid=tab-plus]');
    await browser.until('the Plus sheet', `${openSheets} === 1 && !!${q('[data-testid=plus-sommeil]')}`);
    await pause(700);
    assert.deepEqual(await browser.evaluate(`[...document.querySelectorAll('[data-testid^=plus-]')].map(e => e.textContent.trim())`), ['Objectifs', 'Sommeil', 'Amis']);
    assert.equal(await browser.evaluate(`!!${q('[data-testid=plus-sommeil] [data-testid=nav-badge]')}`), true, 'the sheet shows the badge');
    await browser.screenshot('phone-plus.png');
    await controls('plus sheet');
    await tap('[data-testid=plus-sommeil]');
    await browser.until('Sommeil on show', `${q('[data-testid=tab-plus]')}.textContent.trim() === 'Sommeil' && ${openSheets} === 0`);
    assert.equal(await browser.evaluate(`${q('[data-testid=tab-plus]')}.getAttribute('aria-selected')`), 'true');
    assert.equal(await browser.evaluate(`${q('[data-testid=header-title]')}.textContent`), 'Sommeil');
    assert.equal(await browser.evaluate(`!!${q('[data-testid=header-more]')}`), true, 'three actions: two shown and « … »');
    // « … » while the account sheet is open closes the account sheet: never two sheets.
    await tap('[data-testid=account-button]');
    await browser.until('the account sheet', `${openSheets} === 1 && !!${q('[data-testid=account-menu]')}`);
    await browser.evaluate(`${q('[data-testid=header-more]')}.click()`);
    await browser.until('only the actions sheet', `${openSheets} === 1 && !${q('[data-testid=account-menu]')}`);
    await pause(700);
    assert.equal(await browser.evaluate(`[...document.querySelectorAll('[data-testid=app-sheet] button')].map(e => e.textContent.trim()).join()`), 'Exporter');
    await browser.evaluate(`history.back()`);
    await browser.until('closed', `${openSheets} === 0`);
    assert.equal(await browser.evaluate(`history.state`), null);
    await controls('six');
    await browser.send('Page.navigate', { url: app.url });
    await live();
  });

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
    assert.ok(Math.abs(peek.y + 128 - tab.y) <= 3, `the 8rem peek ends where the tab bar starts: ${JSON.stringify({ peek, tab })}`);
    await controls('peek');
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
    await browser.until('left the page', `location.href !== ${JSON.stringify(href)}`, 8000);
    await browser.evaluate(`history.forward()`).catch(() => {});
    await browser.until('back on the page', `location.href === ${JSON.stringify(href)}`, 8000);
    await live();
  });

  await step('9 push-to-talk: hold shows « J\'écoute… » at peek; release sends with the screen context (auto)', async () => {
    await tap('[data-testid=tab-progres]');
    await browser.until('Progrès on show', `${q('[data-testid=header-title]')}.textContent === 'Progrès'`);
    const before = app.submits.length;
    const r = await center(TRIGGER);
    await touch('touchStart', [[r.x, r.y]]);
    await browser.until('listening at peek', `${q('[data-testid=agent-listening]')}?.textContent.includes("J'écoute")`, 8000);
    assert.equal(await browser.evaluate(snap), 'peek');
    await browser.screenshot('phone-listening.png');
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
    await browser.until('listening', `!!${q('[data-testid=agent-listening]')}`, 8000);
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
    await openImprove();
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
    await openImprove();
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
    await tap('[data-testid=screen-progres] li:nth-child(3)');
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

  await step('draft mode: push-to-talk only fills the composer', async () => {
    await browser.send('Page.navigate', { url: `${app.url}?send=draft` });
    await live();
    const before = app.submits.length;
    const r = await center(TRIGGER);
    await touch('touchStart', [[r.x, r.y]]);
    await browser.until('listening', `!!${q('[data-testid=agent-listening]')}`, 8000);
    await touch('touchEnd', []);
    await browser.until('the composer holds the transcript', `${q(INPUT)}?.value === 'Combien de pas hier ?'`, 20000);
    assert.equal(app.submits.length, before, 'nothing sent');
  });

  await step('No-agent case (Redaction-like): no agent, no trigger, no peek; the manager opens at half and a swipe down does not close it', async () => {
    await browser.send('Page.navigate', { url: `${app.url}?agent=none` });
    await browser.until('ready', `!!${q('[data-testid=account-button]')} && !${q('[data-testid=connecting]')}`, 30000);
    assert.equal(await browser.evaluate(`!!${q(TRIGGER)}`), false);
    await openImprove();
    await browser.until('half', `${snap} === 'half'`); await settle();
    assert.equal(await browser.evaluate(`!!${q('[data-testid=agent-layer-back]')}`), false, 'no agent to go back to');
    const handle = await center('[data-slot=drawer-swipe-handle]');
    await dragTouch(handle.x, handle.y, 840, 10);
    await settle();
    assert.equal(await browser.evaluate(snap), 'half', 'a swipe down from half does not close it');
  });

  await step('empty template: one screen, no tab bar, an agent trigger without voice', async () => {
    await browser.send('Page.navigate', { url: `${app.url}?app=empty` });
    await browser.until('ready', `!!${q(TRIGGER)} && !${q('[data-testid=connecting]')}`, 30000);
    assert.equal(await browser.evaluate(`!!${q('[data-testid=tabbar]')}`), false, 'one screen: no tab bar');
    assert.equal(await browser.evaluate(`getComputedStyle(document.documentElement).getPropertyValue('--app-shell-tabbar')`), '0px');
    assert.equal(await browser.evaluate(`${q('[data-testid=header-title]')}.textContent`), 'Accueil');
    await controls('template');
    await browser.screenshot('phone-template.png');
    await tap(TRIGGER); await browser.until('half', `${snap} === 'half'`); await settle();
    assert.equal(await browser.evaluate(`!!${q('[data-testid=agent-hero-talk]')}`), false);
    await browser.evaluate(`${q('[data-testid=agent-layer-close]')}.click()`);
    await browser.until('closed', `!${q(LAYER)}`);
  });

  await step('expanded 1280x800: sidebar rail collapses and expands, no tab bar, NavUser has the same entries, the trigger opens the right panel', async () => {
    await browser.emulate('desktop');
    await browser.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
    await browser.send('Page.navigate', { url: app.url });
    await live();
    const sidebar = '[data-slot=sidebar][data-side=left]';
    assert.equal(await browser.evaluate(`!!${q('[data-testid=tabbar]')}`), false, 'no tab bar');
    assert.equal(await browser.evaluate(`${q(sidebar)}.dataset.state`), 'expanded');
    assert.equal(await browser.evaluate(`${q('[data-testid=sidebar-title]')}.textContent`), 'Forme');
    assert.deepEqual(await browser.evaluate(`[...document.querySelectorAll('[data-testid^=nav-]:not([data-testid=nav-badge]):not([data-testid=nav-user])')].map(e => e.textContent.trim())`), ['Jour', 'Progrès', 'Données']);
    await browser.screenshot('desktop-sidebar.png');
    const wide = (await browser.evaluate(rect('[data-slot=sidebar-container][data-side=left]'))).w;
    await browser.click(q('[data-slot=sidebar-trigger]'));
    await browser.until('collapsed to the icon rail', `${q(sidebar)}.dataset.state === 'collapsed'`);
    await pause(400);
    const rail = await browser.evaluate(rect('[data-slot=sidebar-container][data-side=left]'));
    assert.ok(rail.w < wide / 2, `an icon rail: ${rail.w}px against ${wide}px`);
    await browser.click(q('[data-slot=sidebar-trigger]'));
    await browser.until('expanded again', `${q(sidebar)}.dataset.state === 'expanded'`);
    await browser.click(q('[data-testid=nav-progres]'));
    await browser.until('Progrès on show', `${q('[data-testid=header-title]')}.textContent === 'Progrès' && !${q('[data-testid=screen-progres]')}.hidden`);
    await browser.click(q('[data-testid=nav-user]'));
    await browser.until('the NavUser menu', `!!${q('[data-testid=account-improve]')}`);
    assert.deepEqual(await browser.evaluate(`[...document.querySelectorAll('[data-slot=dropdown-menu-content] [role=menuitem]')].map(e => e.textContent.trim())`), ["Améliorer l'app", 'Réglages', 'Nouveautés', 'Se déconnecter']);
    await browser.screenshot('desktop-account.png');
    await browser.click(q('[data-testid=account-improve]'));
    await browser.until('the manager in the panel', `${q(LAYER)}?.dataset.state === 'open' && ${q('[data-testid=agent-layer-title]')}?.textContent === "Améliorer l'app"`);
    await browser.press('Escape');
    await browser.until('closed', `${q(LAYER)}?.dataset.state === 'closed'`);
    assert.ok(await browser.evaluate(noOverflow), 'no horizontal overflow');
    // The agent trigger toggles the right panel; the page stays interactive.
    // The sidebar's agent entry is not a route: it toggles the right panel, and aria-pressed follows it.
    const entry = '[data-testid=nav-agent]';
    const routes = await browser.evaluate(`window.__routes.length`), length = await browser.evaluate(`history.length`);
    assert.equal(await browser.evaluate(`${q(entry)}.getAttribute('aria-pressed')`), 'false');
    assert.equal(await browser.evaluate(`${q(entry)}.textContent.trim()`), 'Coach');
    assert.equal(await browser.evaluate(`document.querySelector('[data-testid=nav-agent]').closest('[data-sidebar=sidebar]') !== null`), true);
    await browser.click(q(entry));
    await browser.until('panel open from the entry', `${q(LAYER)}?.dataset.state === 'open' && ${q(entry)}.getAttribute('aria-pressed') === 'true'`);
    await browser.click(q(entry));
    await browser.until('panel closed from the entry', `${q(LAYER)}?.dataset.state === 'closed' && ${q(entry)}.getAttribute('aria-pressed') === 'false'`);
    assert.equal(await browser.evaluate(`window.__routes.length`), routes, 'no route change');
    assert.equal(await browser.evaluate(`history.length`), length, 'no history entry');
    await browser.click(q(TRIGGER));
    await browser.until('panel open', `${q(LAYER)}?.dataset.state === 'open'`);
    assert.equal(await browser.evaluate(`${q(entry)}.getAttribute('aria-pressed')`), 'true', 'the header trigger and the entry agree');
    await pause(500);
    const panel = await browser.evaluate(rect('[data-slot=sidebar-container][data-side=right]'));
    assert.ok(Math.abs(panel.w - 384) <= 2 && Math.abs(panel.right - await browser.evaluate('document.documentElement.clientWidth')) <= 1, `a 24rem panel on the right edge: ${JSON.stringify(panel)}`);
    assert.equal(await browser.evaluate(`!!document.querySelector('[data-slot=drawer-overlay]')`), false, 'not modal');
    const before = await browser.evaluate(taps);
    await browser.click(q('[data-testid=nav-jour]'));
    await browser.until('the page took the click', `${taps} === ${before + 1}`);
    await browser.screenshot('desktop-panel.png');
    await browser.press('Escape');
    await browser.until('closed', `${q(LAYER)}?.dataset.state === 'closed'`);
  });

  await step('expanded: icon actions (and one labelled) and « … » in a dropdown; the one-screen template has a sidebar with no nav list', async () => {
    await browser.send('Page.navigate', { url: `${app.url}?nav=6#sommeil` });
    await live();
    assert.equal(await browser.evaluate(`${q('[data-testid=header-action-theme]')}.textContent.trim()`), '', 'icon only');
    assert.equal(await browser.evaluate(`${q('[data-testid=header-action-theme]')}.getAttribute('aria-label')`), 'Thème');
    assert.equal(await browser.evaluate(`${q('[data-testid=header-action-theme]')}.title`), 'Thème', 'the tooltip');
    assert.equal(await browser.evaluate(`${q('[data-testid=header-action-import]')}.textContent.trim()`), 'Importer', 'showLabel: always');
    await browser.click(q('[data-testid=header-more]'));
    await browser.until('the dropdown', `[...document.querySelectorAll('[role=menuitem]')].some(e => e.textContent.trim() === 'Exporter')`);
    await browser.press('Escape');
    await browser.send('Page.navigate', { url: `${app.url}?agent=none` });
    await browser.until('ready', `!!${q('[data-testid=account-button]')} && !${q('[data-testid=connecting]')}`, 30000);
    assert.equal(await browser.evaluate(`!!${q('[data-testid=nav-agent]')}`), false, 'no agent, no sidebar entry');
    await browser.send('Page.navigate', { url: `${app.url}?app=empty` });
    await live();
    assert.equal(await browser.evaluate(`!!${q('[data-testid=tabbar]')} || !!document.querySelector('[data-testid^=nav-][data-testid$=accueil]')`), false, 'no tab bar and no nav list');
    assert.equal(await browser.evaluate(`!!${q('[data-testid=sidebar-title]')} && !!${q('[data-testid=nav-user]')}`), true, 'title and NavUser only');
  });

  console.log(browser.problems.length ? `page problems:\n${browser.problems.join('\n')}` : 'no page problems');
  assert.deepEqual(browser.problems.filter(p => !/Failed to load resource/.test(p)), []);
} finally { await browser?.close(); await app.close(); }
