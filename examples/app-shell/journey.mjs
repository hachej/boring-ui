// Real-browser journey for the app shell (scripted model, no key; fake microphone): a fictional fitness app in <AppShell layout="screen">
// (./page.tsx) at 390x844 with touch. Layout A: three tabs that keep their screens mounted (scroll survives, no history entry), one header
// per screen through useScreenHeader, the account sheet (Back closes it, one sheet at a time), « Plus » with six screens, the one-screen
// template (no tab bar), and at 1280x800 the sidebar (rail, NavUser). The AgentLayer, in the same page, proves: the trigger opens half with the page behind inert; the transcript scrolls
// without moving the page; a hard swipe on the handle stops at peek (never closes) with the tab bar tappable; tapping above the sheet moves
// full to peek; focusing the composer goes to full and keeps it above a shortened visual viewport; five messages stay above the composer;
// a suggestion chip fills the composer without sending; Back closes the layer and leaves the history clean; push-to-talk shows
// « J’écoute… » at peek and sends (auto) or fills (draft) with the screen context; the product manager swaps in with « ← »; controls are at
// least 44x44px and nothing overflows horizontally in light and dark; the Redaction and empty-template cases; and at 1280x800 the layer as a Dock
// (docked right by default, floating or docked left, remembered across reloads). Point mode waits for #1661 (TODO in the item). Screenshots go to .cache/evidence/app-shell/.
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
  const tapAt = async selector => { const r = await center(selector); await touch('touchStart', [[r.x, r.y]]); await touch('touchEnd', []); };
  /** A finger tap at the element's centre once it receives hits, without scrolling it into view (that would move the sheet's own overflow). */
  const tap = async selector => {
    await browser.until(`tappable ${selector}`, `(() => { const e = ${q(selector)}, r = e?.getBoundingClientRect(); return r && r.width > 0 && r.height > 0 && e.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)); })()`);
    await tapAt(selector);
  };
  const live = () => browser.until('the chats are live', `${q('[data-testid=agent-trigger]')} && !${q('[data-testid=connecting]')}`, 30000);
  /** Every visible control of the layer is at least 44x44px (touch) and inside the viewport; fails with the selector. */
  const controls = async where => {
    const small = await browser.evaluate(`(() => { const out = []; const sel = '${LAYER} button, ${LAYER} [role=button], ${LAYER} textarea, ${LAYER} a[href], ${TRIGGER}, [data-testid=tabbar] [role=tab], [data-testid=screen-header] button';
      for (const e of document.querySelectorAll(sel)) { const r = e.getBoundingClientRect(); const st = getComputedStyle(e); if (!r.width || st.visibility === 'hidden' || e.closest('[hidden]')) continue;  if (r.bottom < 0 || r.top > innerHeight) continue;
        if (r.width < 43.5 || r.height < 43.5) out.push((e.dataset.testid || e.getAttribute('aria-label') || e.tagName) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height)); } return out; })()`);
    assert.deepEqual(small, [], `${where}: controls under 44px`);
    assert.ok(await browser.evaluate(noOverflow), `${where}: horizontal overflow`);
  };
  const settle = () => pause(900);
  /** The account sheet, then « Améliorer l’app »: opens the product manager in the layer. */
  const openImprove = async () => {
    await tap('[data-testid=account-button]');
    await browser.until('the account sheet', `!!${q('[data-testid=account-improve]')}`);
    await pause(700);
    // A portalled sheet's buttons take the item's reset (no preflight here): no native appearance, a transparent background.
    const reset = await browser.evaluate(sheetButtonReset);
    assert.equal(reset?.appearance, 'none', 'a portalled sheet button has appearance: none');
    assert.equal(reset?.background, 'rgba(0, 0, 0, 0)', 'a portalled sheet button has a transparent background');
    await tap('[data-testid=account-improve]');
  };
  const openSheets = `document.querySelectorAll('[data-testid=app-sheet]').length`;
  const sheetButtonReset = `(() => { const b = document.querySelector('[data-testid=app-sheet] button'); if (!b) return null; const s = getComputedStyle(b); return { appearance: s.appearance || s.webkitAppearance, background: s.backgroundColor }; })()`;
  /** Nothing covers the tab bar: the element at the middle of each tab is that tab. */
  const tabsFree = () => browser.evaluate(`[...document.querySelectorAll('[data-testid=tabbar] [role=tab]')].every(tab => { const r = tab.getBoundingClientRect(); const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return tab.contains(hit); })`);

  // A controllable visual viewport (the soft keyboard), installed before the page's scripts so the layer and the drawer both read it.
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => { const real = window.visualViewport; const t = new EventTarget(); let height = null;
    const vv = { addEventListener: t.addEventListener.bind(t), removeEventListener: t.removeEventListener.bind(t), dispatchEvent: t.dispatchEvent.bind(t),
      get height() { return height ?? real.height; }, get width() { return real.width; }, get offsetTop() { return 0; }, get offsetLeft() { return 0; }, get pageTop() { return real.pageTop; }, get pageLeft() { return real.pageLeft; }, get scale() { return 1; } };
    Object.defineProperty(window, 'visualViewport', { configurable: true, get: () => vv });
    window.__vv = { set: h => { height = h; t.dispatchEvent(new Event('resize')); } }; })()` });
  await browser.emulate('phone');
  if (process.env.THROTTLE) await send('Emulation.setCPUThrottlingRate', { rate: Number(process.env.THROTTLE) });
  await browser.reload();
  await live();

  const historyLength = await browser.evaluate(`history.length`);
  await step('A fitness: three tabs keep their screens mounted: the scroll survives and a tab switch adds no history entry', async () => {
    assert.equal(await browser.evaluate(`document.querySelectorAll('[data-testid=tabbar] [role=tab]').length`), 3);
    // The shell's own header button takes the item's reset: the root carries `app-shell`, and this page has no preflight.
    assert.equal(await browser.evaluate(`(() => { const s = getComputedStyle(document.querySelector('[data-testid=screen-header] button')); return s.appearance || s.webkitAppearance; })()`), 'none', 'a header button has appearance: none');
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
    // A fast drag ends in a fling, and a tap during a fling only stops it (slower machines fling longer): wait until the scroll has come to rest.
    let last = -1;
    for (let i = 0; i < 50; i++) { await pause(100); const now = await browser.evaluate(`${q(scroller)}.scrollTop`); if (now === last) break; last = now; }
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

  await step('B2 the layer header: the coach\'s host action is a link in the half drawer, 44px, before the close and snap controls', async () => {
    await tap(TRIGGER);
    await browser.until('the coach at half', `${q(LAYER)}?.dataset.state === 'half'`);
    await settle();
    const order = await browser.evaluate(`[...document.querySelectorAll('[data-testid=agent-layer-header] [data-testid]')].map(e => e.dataset.testid)`);
    assert.ok(order.indexOf('agent-layer-action-whatsapp') >= 0 && order.indexOf('agent-layer-action-whatsapp') < order.indexOf('agent-layer-expand'), `${order}`);
    assert.equal(await browser.evaluate(`${q('[data-testid=agent-layer-action-whatsapp]')}.tagName`), 'A');
    assert.equal(await browser.evaluate(`${q('[data-testid=agent-layer-action-whatsapp]')}.getAttribute('href')`), '/whatsapp/open?app=fitness');
    assert.equal(await browser.evaluate(`${q('[data-testid=agent-layer-action-whatsapp]')}.getAttribute('aria-label')`), 'Discuter avec Max sur WhatsApp');
    const size = await center('[data-testid=agent-layer-action-whatsapp]');
    assert.ok(size.w >= 44 && size.h >= 44, `${size.w}x${size.h}`);
    await tap('[data-testid=agent-layer-close]');
    await browser.until('closed', `!${q(LAYER)}`);
  });

  await step('B3 the layer overflow on a phone: « … » opens a sheet with the third action as a link (44px); Back closes the sheet, not the layer; a tap navigates', async () => {
    const link = '[data-testid=app-sheet] a[href="/invite?app=fitness"]';
    await tap(TRIGGER);
    await browser.until('the coach at half', `${q(LAYER)}?.dataset.state === 'half'`);
    await settle();
    await tap('[data-testid=agent-layer-more]');
    await browser.until('the overflow sheet', `!!${q(link)}`);
    await pause(400);
    assert.equal(await browser.evaluate(`${q(link)}.textContent.trim()`), 'Inviter un ami');
    const size = await center(link);
    assert.ok(size.h >= 44, `${size.h}px`);
    await browser.evaluate('history.back()');
    await browser.until('the sheet closed by Back', `!${q('[data-testid=app-sheet]')}`);
    assert.equal(await browser.evaluate(`${q(LAYER)}?.dataset.state`), 'half', 'Back closed the sheet, the layer stays open');
    await tap('[data-testid=agent-layer-more]');
    await browser.until('the overflow sheet again', `!!${q(link)}`);
    await pause(400);
    await tap(link);
    await browser.until('navigated to the link', `location.pathname === '/invite'`, 15000);
    await browser.send('Page.navigate', { url: app.url });
    await live();
  });

  await step('B4 Escape on the phone drawer steps down to peek: from full with the composer focused, and from half with Close focused; the layer stays open', async () => {
    await tap(TRIGGER);
    await browser.until('half', `${q(LAYER)}?.dataset.state === 'half'`);
    await settle();
    await tap(INPUT);
    await browser.until('full', `${q(LAYER)}?.dataset.state === 'full'`);
    await settle();
    await browser.press('Escape');
    await browser.until('peek after Escape from full', `${q(LAYER)}?.dataset.state === 'peek'`);
    await pause(700);
    assert.equal(await browser.evaluate(`${q(LAYER)}?.dataset.state`), 'peek', 'still peek after the close animation');
    await tap(TRIGGER);
    await browser.until('half again', `${q(LAYER)}?.dataset.state === 'half'`);
    await settle();
    await browser.evaluate(`${q('[data-testid=agent-layer-close]')}.focus()`);
    await browser.press('Escape');
    await browser.until('peek after Escape from half', `${q(LAYER)}?.dataset.state === 'peek'`);
    await pause(700);
    assert.equal(await browser.evaluate(`${q(LAYER)}?.dataset.state`), 'peek', 'still peek after the close animation');
  });

  await step('C the account sheet: avatar opens it, Back closes it and the URL is unchanged, a choice closes it', async () => {
    const href = await browser.evaluate(`location.href`);
    await tap('[data-testid=account-button]');
    await browser.until('the sheet', `${openSheets} === 1 && !!${q('[data-testid=account-improve]')}`);
    await pause(700);
    const rows = await browser.evaluate(`[...document.querySelectorAll('[data-testid=account-menu] button')].map(e => e.textContent.trim())`);
    assert.deepEqual(rows, ["Améliorer l’app", 'Réglages', 'Nouveautés', 'Se déconnecter']);
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

  await step('D « Améliorer l’app » shows the product manager in the layer; closing it leaves the history clean', async () => {
    await openImprove();
    await browser.until('improve shown', `${q('[data-testid=agent-layer-title]')}?.textContent === "Améliorer l’app"`);
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
    const entries = JSON.parse(await browser.evaluate(`JSON.stringify([navigation.currentEntry.index, navigation.entries().map(e => e.url)])`));
    await tap('[data-testid=tab-plus]');
    await browser.until('the Plus sheet', `${openSheets} === 1 && !!${q('[data-testid=plus-sommeil]')}`);
    await pause(700);
    assert.deepEqual(await browser.evaluate(`[...document.querySelectorAll('[data-testid^=plus-]')].map(e => e.textContent.trim())`), ['Objectifs', 'Sommeil', 'Amis']);
    assert.equal(await browser.evaluate(`!!${q('[data-testid=plus-sommeil] [data-testid=nav-badge]')}`), true, 'the sheet shows the badge');
    await browser.screenshot('phone-plus.png');
    await controls('plus sheet');
    await tap('[data-testid=plus-sommeil]');
    await browser.until('Sommeil on show', `${q('[data-testid=tab-plus]')}.textContent.trim() === 'Sommeil' && ${openSheets} === 0`);
    await pause(800);
    // The choice survives the sheet's own Back: the URL is the destination, and the entry the sheet had is gone.
    assert.equal(await browser.evaluate(`location.hash`), '#sommeil', 'the final URL is the chosen screen');
    assert.equal(await browser.evaluate(`navigation.currentEntry.index`), entries[0], 'the sheet left no entry');
    assert.equal(await browser.evaluate(`navigation.entries()[navigation.currentEntry.index - 1]?.url`), entries[1][entries[0] - 1], 'the next Back goes where it went before the sheet');
    assert.equal(await browser.evaluate(`${q('[data-testid=tab-plus]')}.textContent.trim()`), 'Sommeil', 'and the screen is still the chosen one');
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
    await tapAt(TAB);
    await pause(300);
    assert.equal(await browser.evaluate(taps), before, 'the tab bar behind a modal layer does not receive the tap');
    await browser.screenshot('phone-half.png');
    await controls('half');
    // Native ghost Button keeps its transparent border, not the browser's grey control chrome.
    assert.deepEqual(await browser.evaluate(`(() => { const button = ${q('[data-testid=agent-layer-close]')}, s = getComputedStyle(button); return [button.dataset.slot, s.appearance, s.borderTopWidth, s.borderTopColor, s.backgroundColor]; })()`), ['button', 'none', '1px', 'rgba(0, 0, 0, 0)', 'rgba(0, 0, 0, 0)']);
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
    assert.deepEqual(await browser.evaluate(`['composer-plus', 'composer-annotate'].map(id => { const e = document.querySelector('[data-testid=composer] [data-testid=' + id + ']'); return !!e && e.getBoundingClientRect().width > 0; })`), [false, false], 'the other composer controls wait for half');
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
    const dockBottom = await browser.evaluate(`${q(INPUT)}.closest('[data-boring=pi-chat]').querySelector('[data-testid=composer-dock]').getBoundingClientRect().bottom`);
    assert.ok(dockBottom >= vvBottom - 20 && dockBottom <= vvBottom + 1, `drawer compensation is applied once: composer dock ${dockBottom}, keyboard top ${vvBottom}`);
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
    // At half the drawer's lower part is below the screen by design: the chat pads nothing for it, so the messages have room and the last one is on screen.
    const seen = await browser.evaluate(`(() => { const s = ${q('[data-testid=transcript-scroll]')}.getBoundingClientRect(); const rows = [...document.querySelectorAll('${LAYER} [data-testid=transcript] > *')].filter(e => e.getBoundingClientRect().height); const last = rows.at(-1)?.getBoundingClientRect(); return { height: s.height, rows: rows.length, lastTop: last?.top, lastBottom: last?.bottom, inner: innerHeight }; })()`);
    assert.ok(seen.height >= 100, `the half drawer's transcript has room: ${JSON.stringify(seen)}`);
    assert.ok(seen.rows > 0 && seen.lastBottom <= seen.inner && seen.lastTop >= 0, `the last message is on screen at half: ${JSON.stringify(seen)}`);
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

  await step('9 push-to-talk: hold shows « J’écoute… » at peek; release sends with the screen context (auto)', async () => {
    await tap('[data-testid=tab-progres]');
    await browser.until('Progrès on show', `${q('[data-testid=header-title]')}.textContent === 'Progrès'`);
    const before = app.submits.length;
    const r = await center(TRIGGER);
    await touch('touchStart', [[r.x, r.y]]);
    if (process.env.DBG) { await pause(2000); console.log('DBG', await browser.evaluate(`JSON.stringify({ snap: ${snap}, listening: ${q('[data-testid=agent-listening]')}?.outerHTML.slice(0, 150), talk: ${q('[data-testid=agent-talk]')}?.dataset.state, prob: ${q('[data-testid=agent-voice-problem]')}?.textContent })`)); }
    await browser.until('listening at peek', `${q('[data-testid=agent-listening]')}?.textContent.includes("J’écoute") && ${q('[data-testid=agent-listening]')}.dataset.phase === 'recording'`, 8000);
    assert.equal(await browser.evaluate(snap), 'peek');
    await browser.screenshot('phone-listening.png');
    await pause(600); // the fake microphone needs a moment of audio
    await touch('touchEnd', []);
    await browser.until('submit recorded', `true`);
    for (let i = 0; i < 100 && app.submits.length === before; i++) await pause(100);
    const sent = app.submits.at(-1);
    assert.equal(sent.agent, 'coach');
    assert.deepEqual(sent.body.context, { name: 'Progrès', params: { range: 30 }, placement: 'floating' }, 'the compact drawer is a floating placement');
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

  await step('9c the composer microphone at peek, half and full: a hold survives the keyboard, the viewport shrinking and a pointercancel; only a slide off cancels', async () => {
    const MIC = '[data-testid=agent-talk]', state = `${q(MIC)}?.dataset.state`;
    const active = `document.activeElement?.getAttribute('data-testid') ?? document.activeElement?.tagName`;
    /** Hold the microphone, shrink the visual viewport mid-hold (the keyboard), and check nothing moved under the finger. */
    const hold = async (where, finish) => {
      const mic = await browser.evaluate(rect(MIC)), focus = await browser.evaluate(active), sheet = await browser.evaluate(snap);
      const r = await center(MIC);
      await touch('touchStart', [[r.x, r.y]]);
      await browser.until(`${where}: recording`, `${state} === 'recording'`, 8000);
      assert.equal(await browser.evaluate(`${q(INPUT)}.readOnly`), true, `${where}: the composer is read-only while recording`);
      await browser.evaluate(`window.__vv.set(500)`);
      await pause(700);
      assert.equal(await browser.evaluate(state), 'recording', `${where}: still recording after the viewport shrank`);
      assert.deepEqual(await browser.evaluate(rect(MIC)), mic, `${where}: the microphone did not move under the finger`);
      assert.equal(await browser.evaluate(snap), sheet, `${where}: the snap holds`);
      assert.equal(await browser.evaluate(active), focus, `${where}: pressing the microphone moved no focus`);
      await finish(r);
      await browser.evaluate(`window.__vv.set(844)`);
      await browser.until(`${where}: the composer is editable again`, `${q(INPUT)}.readOnly === false`, 5000);
      await settle();
    };
    const away = async r => { await touch('touchMove', [[r.x - 150, r.y - 200]]); await browser.until('cancelled', `${state} === 'idle'`, 5000); await touch('touchEnd', []); };
    const submits = app.submits.length;
    // Peek: the browser takes the touch back (pointercancel): the recording is kept and sent.
    assert.equal(await browser.evaluate(snap), 'peek');
    await hold('peek', async () => { await pause(600); await touch('touchCancel', []); });
    for (let i = 0; i < 100 && app.submits.length === submits; i++) await pause(100);
    assert.equal(app.submits.length, submits + 1, 'a pointercancel while recording keeps the audio');
    await browser.until('idle', `${state} === 'idle'`, 20000);
    // Half, then full with the composer focused: a slide off the button cancels, nothing is sent.
    const sent = app.submits.length;
    await tap(TRIGGER); await browser.until('half', `${snap} === 'half'`); await settle();
    await hold('half', away);
    await tap(INPUT); await browser.until('full', `${snap} === 'full'`); await settle();
    assert.equal(await browser.evaluate(active), 'composer-input', 'the composer is focused');
    await hold('full', away);
    await browser.evaluate(`document.activeElement.blur()`);
    await pause(400);
    assert.equal(app.submits.length, sent, 'a slide off sent nothing');
    assert.equal(await browser.evaluate(`${q(INPUT)}.readOnly`), false, 'the composer is editable again');
    // Back to peek, where the next step starts.
    const layer = await browser.evaluate(rect(LAYER));
    await touch('touchStart', [[195, layer.y / 2]]); await touch('touchEnd', []);
    await browser.until('peek again', `${snap} === 'peek'`);
    // Keep the slide at its start briefly: peek is already non-modal, but the moving handle can still cover the header trigger.
    // The next tap must wait for the actual hit target, not just the snap state (the race seen on a faster CI runner).
    assert.equal(await browser.evaluate(`(() => { const slide = ${q(LAYER)}.getAnimations().find(animation => animation.transitionProperty === 'transform');
      if (!slide) return false; slide.pause(); slide.currentTime = 0; setTimeout(() => slide.play(), 600); return true; })()`), true, 'the full-to-peek slide is running');
  });

  await step('10 the product manager swaps in with « ← », each chat keeps its own draft', async () => {
    await tap(TRIGGER); await browser.until('half', `${snap} === 'half'`); await settle();
    await browser.evaluate(`(() => { const t = ${q(INPUT)}; t.focus(); })()`);
    await send('Input.insertText', { text: 'brouillon du coach' });
    await browser.evaluate(`document.activeElement.blur()`);
    await browser.evaluate(`${q('[data-testid=agent-layer-close]')}.click()`);
    await browser.until('closed', `!${q(LAYER)}`);
    await openImprove();
    await browser.until('improve shown', `${q('[data-testid=agent-layer-title]')}?.textContent === "Améliorer l’app"`);
    assert.ok(await browser.evaluate(`!!${q('[data-testid=agent-layer-back]')}`), 'the « ← » is shown');
    await settle();
    await browser.screenshot('phone-improve.png');
    await controls('improve');
    await tap('[data-testid=agent-layer-back]');
    await browser.until('back to the coach', `${q('[data-testid=agent-layer-title]')}?.textContent === 'Coach'`);
    assert.equal(await browser.evaluate(`${q('[data-spec=agent] ' + INPUT)}.value`), 'brouillon du coach', 'the draft survived');
    await tap('[data-testid=agent-layer-close]');
    await browser.until('closed', `!${q(LAYER)}`);
    // Point mode: the ONE annotate toggle (a phone: point mode) hides the sheet, the point bar sits above the tab bar, a pick, « Terminé » brings it back with the count chip.
    await openImprove();
    await browser.until('improve shown', `${q('[data-testid=agent-layer-title]')}?.textContent === "Améliorer l’app"`);
    await settle();
    assert.deepEqual(await browser.evaluate(`(() => { const form = ${q('[data-spec=improve] [data-testid=composer]')}; const toggles = [...form.querySelectorAll('[data-testid=composer-annotate]')]; const r = toggles[0]?.getBoundingClientRect();
      return { toggles: toggles.length, label: toggles[0]?.getAttribute('aria-label'), size: r ? [Math.round(r.width), Math.round(r.height)] : null, words: /Retour|Feedback|Montrer dans|question générale|Terminé/i.test(form.innerText),
        gone: ['composer-feedback', 'composer-point', 'feedback-bar', 'feedback-chip', 'feedback-general', 'feedback-count'].filter(id => document.querySelector('[data-testid=' + id + ']')) }; })()`),
      { toggles: 1, label: 'Annoter', size: [44, 44], words: false, gone: [] }, 'exactly one annotate control, 44px, and no Feedback block');
    await tap('[data-spec=improve] [data-testid=composer-annotate]');
    await browser.until('point bar, sheet hidden', `!!${q('[data-testid=feedback-point-bar]')} && !${q(LAYER)}`, 8000);
    await pause(500);
    const bar = await browser.evaluate(rect('[data-testid=feedback-point-bar]'));
    const tabs = await browser.evaluate(rect('[data-testid=tabbar]'));
    assert.ok(bar.bottom <= tabs.y + 1, `the point bar is above the tab bar: ${JSON.stringify({ bar, tabs })}`);
    await browser.screenshot('phone-point-bar.png');
    await tap('[data-testid=screen-progres] li:nth-child(3)');
    await browser.until('a bubble', `!!${q('[data-testid=feedback-bubble]')}`, 8000);
    await browser.until('the field is focused', `document.activeElement === ${q('[data-testid=feedback-bubble-input]')}`, 8000);
    await browser.send('Input.insertText', { text: 'Plus de détails ici.' });
    await browser.evaluate(`document.activeElement.blur()`);
    await tap('[data-testid=feedback-point-done]');
    await browser.until('the sheet is back with the count chip', `${snap} === 'half' && !!${q('[data-spec=improve]')} && !${q('[data-testid=feedback-point-bar]')} && ${q('[data-spec=improve] [data-testid=feedback-count]')}?.dataset.count === '1'`, 8000);
    assert.match(await browser.evaluate(`${q('[data-spec=improve] [data-testid=feedback-count]')}.innerText`), /1 note/);
    assert.equal(await browser.evaluate(`${q('[data-spec=improve] [data-testid=composer-annotate]')}.disabled`), false, 'notes waiting for Send do not block annotating');
    await settle();
    await tap('[data-spec=improve] [data-testid=feedback-count-clear]');
    await browser.until('the chip is removed', `!${q('[data-spec=improve] [data-testid=feedback-count]')}`, 5000);
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
    const bar = await browser.evaluate(rect('[data-testid=tabbar]'));
    assert.equal(await browser.evaluate(`getComputedStyle(${q(LAYER)}).getPropertyValue('--app-shell-tabbar')`).then(v => v.trim()), `${bar.h}px`, 'review 4: the portalled popup is given the tab bar height');
  });

  await step('review 9: every control of the layer, transcript buttons included, is at least 44px', async () => {
    await controls('half with replies');
    await browser.evaluate(`${q('[data-testid=agent-layer-close]')}.click()`);
    await browser.until('closed', `!${q(LAYER)}`);
  });

  await step('review 6: the chat keeps its DOM while the layer is closed and while pointing', async () => {
    await openImprove();
    await browser.until('improve', `${q('[data-testid=agent-layer-title]')}?.textContent === "Améliorer l’app"`); await settle();
    await browser.evaluate(`window.__chatNode = ${q('[data-spec=improve] [data-boring=pi-chat]')}; 0`);
    await browser.evaluate(`${q('[data-testid=agent-layer-close]')}.click()`);
    await browser.until('closed', `!${q(LAYER)}`);
    assert.equal(await browser.evaluate(`window.__chatNode.isConnected === false && !!window.__chatNode`), true, 'detached while closed, not destroyed');
    await openImprove();
    await browser.until('improve again', `!!${q('[data-spec=improve] [data-boring=pi-chat]')}`); await settle();
    assert.equal(await browser.evaluate(`${q('[data-spec=improve] [data-boring=pi-chat]')} === window.__chatNode`), true, 'the same chat element came back');
  });

  await step('review 3: Back during point mode ends pointing and keeps the page and the layer', async () => {
    const href = await browser.evaluate('location.href');
    await tap('[data-spec=improve] [data-testid=composer-annotate]');
    await browser.until('pointing', `!!${q('[data-testid=feedback-point-bar]')}`, 8000);
    assert.equal(await browser.evaluate('history.state?.appShell'), 'point');
    await browser.evaluate('history.back()');
    await browser.until('pointing ended', `!${q('[data-testid=feedback-point-bar]')} && ${snap} === 'half'`, 8000);
    assert.equal(await browser.evaluate('location.href'), href, 'still on the page');
    assert.equal(await browser.evaluate('history.state?.appShell'), 'agent', 'the layer keeps its entry');
    await settle();
  });

  await step('review 5: on a phone the annotate toggle is always point mode (no pins inside the sheet)', async () => {
    await tap('[data-spec=improve] [data-testid=composer-annotate]');
    await browser.until('point mode', `!!${q('[data-testid=feedback-point-bar]')}`, 8000);
    assert.equal(await browser.evaluate(`['feedback-general', 'feedback-general-bubble', 'feedback-bar'].some(id => !!document.querySelector('[data-testid=' + id + ']'))`), false, 'no general question, no Feedback bar');
    await tap('[data-testid=feedback-point-cancel]');
    await browser.until('back to the sheet', `!${q('[data-testid=feedback-point-bar]')} && ${snap} === 'half'`, 8000);
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

  await step('round c 4: the account sheet then « Améliorer l’app » then point mode keeps the page (no about:blank)', async () => {
    await browser.send('Page.navigate', { url: app.url });
    await live();
    const href = await browser.evaluate('location.href');
    await tap('[data-testid=account-button]');
    await browser.until('the account sheet', `!!${q('[data-testid=account-menu]')}`);
    await settle();
    if (process.env.DBG) console.log('RECT', JSON.stringify(await browser.evaluate(rect('[data-testid=account-improve]'))), await browser.evaluate(`document.elementFromPoint(100, 800)?.outerHTML.slice(0, 120)`));
    await tap('[data-testid=account-improve]');
    if (process.env.DBG) { await pause(1500); console.log('DBG', await browser.evaluate(`JSON.stringify({ href: location.href, st: history.state, snap: ${snap}, sheet: !!${q('[data-testid=account-menu]')} })`)); }
    await browser.until('improve shown', `${q('[data-testid=agent-layer-title]')}?.textContent === "Améliorer l’app"`); await settle();
    assert.equal(await browser.evaluate('location.href'), href);
    assert.equal(await browser.evaluate('history.state?.appShell'), 'agent', 'the layer owns its entry after the sheet closed');
    await tap('[data-spec=improve] [data-testid=composer-annotate]');
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
    assert.equal(await browser.evaluate(`!!${q('[data-testid=agent-talk]')}`), false);
    await browser.evaluate(`${q('[data-testid=agent-layer-close]')}.click()`);
    await browser.until('closed', `!${q(LAYER)}`);
  });

  await step('expanded 1280x800: the coach\'s host action is in the dock header, before the dock controls and Close', async () => {
    await browser.emulate('desktop');
    await browser.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
    await browser.send('Page.navigate', { url: app.url });
    await live();
    await browser.click(q(TRIGGER));
    await browser.until('the coach in the panel', `${q(LAYER)}?.dataset.state === 'open'`);
    await settle();
    const order = await browser.evaluate(`[...document.querySelectorAll('[data-testid=agent-layer-header] [data-testid]')].map(e => e.dataset.testid)`);
    assert.ok(order.indexOf('agent-layer-action-whatsapp') >= 0 && order.indexOf('agent-layer-action-whatsapp') < order.indexOf('agent-layer-close'), `${order}`);
    assert.equal(await browser.evaluate(`${q('[data-testid=agent-layer-action-whatsapp]')}.getAttribute('href')`), '/whatsapp/open?app=fitness');
    // The third action is in the « … » menu, as a link.
    await browser.click(q('[data-testid=agent-layer-more]'));
    await browser.until('the overflow menu', `!!${q('[role=menuitem][data-testid=agent-layer-action-invite]')}`);
    assert.equal(await browser.evaluate(`${q('[role=menuitem][data-testid=agent-layer-action-invite]')}.tagName`), 'A', 'a link in the menu');
    assert.equal(await browser.evaluate(`${q('[role=menuitem][data-testid=agent-layer-action-invite]')}.getAttribute('href')`), '/invite?app=fitness');
    await browser.press('Escape');
    await browser.until('the menu closed', `!${q('[role=menu]')}`);
    await browser.screenshot('desktop-agent-header-action.png');
  });

  await step('expanded 1280x800: on the floating panel a press on a header link neither drags the panel nor swallows the click', async () => {
    await browser.emulate('desktop');
    await browser.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
    await browser.send('Page.navigate', { url: app.url });
    await live();
    await browser.click(q(TRIGGER));
    await browser.until('the coach docked', `${q(LAYER)}?.dataset.state === 'open' && ${q(LAYER)}?.dataset.placement === 'docked'`);
    await browser.click(q('[data-testid=agent-layer-float]'));
    await browser.until('floating', `${q(LAYER)}?.dataset.placement === 'floating'`);
    await settle();
    const link = '[data-testid=agent-layer-action-whatsapp]';
    // A press on the link, a move, and a release away from it: the panel stays where it is.
    const before = await browser.evaluate(rect(LAYER));
    const at = await center(link);
    await browser.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: at.x, y: at.y, button: 'left', buttons: 1, clickCount: 1 });
    for (let i = 1; i <= 10; i++) await browser.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: at.x - i * 12, y: at.y + i * 8, button: 'left', buttons: 1 });
    await browser.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: at.x - 120, y: at.y + 80, button: 'left', buttons: 0, clickCount: 1 });
    await pause(300);
    const after = await browser.evaluate(rect(LAYER));
    assert.deepEqual([after.x, after.y], [before.x, before.y], 'the panel did not move');
    // A plain click on the link navigates (the link's own href; the page behind is a fictional one, so it may 404).
    await browser.click(q(link));
    await browser.until('navigated to the link', `location.pathname === '/whatsapp/open'`, 15000);
    // Leave the floating state behind for the next steps (the remembered placement lives in localStorage).
    await browser.send('Page.navigate', { url: app.url });
    await live();
    await browser.evaluate('localStorage.clear()');
    await browser.send('Page.navigate', { url: app.url });
    await live();
  });

  await step('expanded 1280x800: the layer reports its real placement with each submit: docked, floating, docked again', async () => {
    await browser.emulate('desktop');
    await browser.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
    await browser.send('Page.navigate', { url: app.url });
    await live();
    await browser.click(q(TRIGGER));
    await browser.until('the coach docked', `${q(LAYER)}?.dataset.state === 'open' && ${q(LAYER)}?.dataset.placement === 'docked'`);
    const say = async (text, placement) => {
      const before = app.contexts.length;
      await browser.type(q(INPUT), text);
      await browser.press('Enter');
      for (let i = 0; i < 100 && app.contexts.length === before; i++) await pause(100);
      assert.equal(app.contexts.at(-1)?.value.placement, placement, `${text}: ${JSON.stringify(app.contexts.at(-1)?.value)}`);
      assert.equal(typeof app.contexts.at(-1).value.name, 'string', 'the screen fields stay at the top level');
      await browser.until('the reply', `document.body.innerText.includes(${JSON.stringify(text === 'Dis bonjour' ? 'Bonjour ! Que veux-tu écrire ?' : 'Hier : 8 200 pas')})`, 20000);
    };
    await say('Dis bonjour', 'docked');
    await browser.click(q('[data-testid=agent-layer-float]'));
    await browser.until('floating', `${q(LAYER)}?.dataset.placement === 'floating'`);
    await say('Combien de pas hier ?', 'floating');
    await browser.click(q('[data-testid=agent-layer-dock-right]'));
    await browser.until('docked again', `${q(LAYER)}?.dataset.placement === 'docked'`);
    await say('Combien de pas hier ? Merci', 'docked');
    await browser.evaluate('localStorage.clear()');
    await browser.send('Page.navigate', { url: app.url });
    await live();
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
    assert.deepEqual(await browser.evaluate(`[...document.querySelectorAll('[data-testid^=nav-]:not([data-testid=nav-badge]):not([data-testid=nav-user]):not([data-testid=nav-agent])')].map(e => e.textContent.trim())`), ['Jour', 'Progrès', 'Données']);
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
    assert.deepEqual(await browser.evaluate(`[...document.querySelectorAll('[data-slot=dropdown-menu-content] [role=menuitem]')].map(e => e.textContent.trim())`), ["Améliorer l’app", 'Réglages', 'Nouveautés', 'Se déconnecter']);
    await browser.screenshot('desktop-account.png');
    await browser.click(q('[data-testid=account-improve]'));
    await browser.until('the manager in the panel', `${q(LAYER)}?.dataset.state === 'open' && ${q('[data-testid=agent-layer-title]')}?.textContent === "Améliorer l’app"`);
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
    await pause(400);
    assert.equal(await browser.evaluate(`window.__routes.length`), routes, 'no route change');
    assert.equal(await browser.evaluate(`history.length`), length, 'no history entry');
    await browser.click(q(TRIGGER));
    await browser.until('panel open', `${q(LAYER)}?.dataset.state === 'open'`);
    assert.equal(await browser.evaluate(`${q(entry)}.getAttribute('aria-pressed')`), 'true', 'the header trigger and the entry agree');
    await pause(500);
    const panel = await browser.evaluate(rect(LAYER));
    assert.ok(Math.abs(panel.w - 384) <= 2 && Math.abs(panel.right - await browser.evaluate('document.documentElement.clientWidth')) <= 1, `a 24rem panel on the right edge: ${JSON.stringify(panel)}`);
    assert.equal(await browser.evaluate(`!!document.querySelector('[data-slot=drawer-overlay]')`), false, 'not modal');
    const before = await browser.evaluate(taps);
    await browser.click(q('[data-testid=nav-jour]'));
    await browser.until('the page took the click', `${taps} === ${before + 1}`);
    await browser.screenshot('desktop-panel.png');
    await browser.press('Escape');
    await browser.until('closed', `${q(LAYER)}?.dataset.state === 'closed'`);
  });

  await step('expanded 1280x800: the layer is a dock: docked right by default and the content reflows; float, reload, still floating; dock left, reload, still left; the manager closes the coach; compact is still the drawer', async () => {
    const MAIN = '[data-boring=dock-main]', viewport = 'document.documentElement.clientWidth';
    const placement = `${q(LAYER)}?.dataset.placement + ':' + ${q(LAYER)}?.dataset.side`;
    const openCoach = async () => { await browser.click(q(TRIGGER)); await browser.until('the coach open', `${q(LAYER)}?.dataset.state === 'open'`); await pause(400); };
    const full = (await browser.evaluate(rect(MAIN))).w;
    await openCoach();
    assert.equal(await browser.evaluate(placement), 'docked:right', 'default: docked right');
    const docked = await browser.evaluate(rect(LAYER)), shrunk = await browser.evaluate(rect(MAIN));
    assert.ok(Math.abs(docked.right - await browser.evaluate(viewport)) <= 1 && shrunk.w <= full - 300 && shrunk.right <= docked.x + 1, `docked: the content reflows beside the panel: ${JSON.stringify({ full, shrunk, docked })}`);
    // The controls are labelled and 44px under a coarse pointer (checked on the phone); here: named buttons.
    assert.deepEqual(await browser.evaluate(`['float', 'dock-left'].map(id => document.querySelector('[data-testid="agent-layer-' + id + '"]')?.getAttribute('aria-label'))`), ["Flotter sur l’app", 'Ancrer à gauche']);
    await browser.click(q('[data-testid=agent-layer-float]'));
    await browser.until('floating', `${placement} === 'floating:right'`);
    await pause(300);
    const floating = await browser.evaluate(rect(LAYER));
    assert.ok(Math.abs((await browser.evaluate(rect(MAIN))).w - full) <= 2, 'floating overlays: the content takes the full width again');
    assert.ok(floating.x > 0 && floating.right <= await browser.evaluate(viewport) && floating.w < 400 && floating.h < 800, `a floating window inside the viewport: ${JSON.stringify(floating)}`);
    assert.equal(await browser.evaluate(`!!${q(LAYER)}.contains(document.activeElement) && document.activeElement.hasAttribute('data-dock-control')`), true, 'focus stays on a dock control after floating');
    // Dragging the title row moves the window.
    const grip = await center('[data-testid=agent-layer-title]');
    await browser.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: grip.x, y: grip.y, button: 'left', clickCount: 1 });
    await browser.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: grip.x - 200, y: grip.y - 120, button: 'left' });
    await browser.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: grip.x - 200, y: grip.y - 120, button: 'left', clickCount: 1 });
    await pause(200);
    const moved = await browser.evaluate(rect(LAYER));
    assert.ok(Math.abs(moved.x - (floating.x - 200)) <= 3 && Math.abs(moved.y - (floating.y - 120)) <= 3, `dragged by the title row: ${JSON.stringify({ floating, moved })}`);
    await browser.screenshot('desktop-dock-floating.png');
    // Reachable after a resize: dragged far right at 1920 wide, then the window shrinks to 1024 (also after closing and reopening).
    await browser.send('Emulation.setDeviceMetricsOverride', { width: 1920, height: 800, deviceScaleFactor: 1, mobile: false });
    await pause(300);
    const far = await center('[data-testid=agent-layer-title]');
    await browser.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: far.x, y: far.y, button: 'left', clickCount: 1 });
    await browser.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 1900, y: far.y, button: 'left' });
    await browser.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 1900, y: far.y, button: 'left', clickCount: 1 });
    await pause(200);
    assert.ok((await browser.evaluate(rect(LAYER))).x > 1400, 'dragged to x > 1400');
    await browser.send('Emulation.setDeviceMetricsOverride', { width: 1024, height: 800, deviceScaleFactor: 1, mobile: false });
    await browser.until('fully visible after the window shrank', `(() => { const r = ${q(LAYER)}.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight; })()`, 5000);
    await browser.click(q('[data-testid=agent-layer-close]'));
    await browser.until('closed', `${q(LAYER)}.dataset.state === 'closed'`);
    await browser.click(q(TRIGGER));
    await browser.until('reopened', `${q(LAYER)}.dataset.state === 'open'`);
    assert.ok(await browser.evaluate(`(() => { const r = ${q(LAYER)}.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth; })()`), 'still visible after reopening');
    await browser.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
    await pause(300);
    await browser.send('Page.navigate', { url: app.url }); await live();
    await openCoach();
    assert.equal(await browser.evaluate(placement), 'floating:right', 'still floating after a reload');
    await browser.click(q('[data-testid=agent-layer-dock-left]'));
    await browser.until('docked left', `${placement} === 'docked:left'`);
    await pause(300);
    const left = await browser.evaluate(rect(LAYER)), main = await browser.evaluate(rect(MAIN));
    assert.ok(left.right <= main.x + 1 && main.right >= await browser.evaluate(viewport) - 1, `docked left: the content reflows to its right: ${JSON.stringify({ left, main })}`);
    assert.equal(await browser.evaluate(`!!${q(LAYER)}.contains(document.activeElement)`), true, 'focus stays in the panel after docking');
    await browser.screenshot('desktop-dock-left.png');
    await browser.send('Page.navigate', { url: app.url }); await live();
    await openCoach();
    assert.equal(await browser.evaluate(placement), 'docked:left', 'still docked left after a reload');
    // Floating from the divider (Alt+Arrow towards the edge) keeps focus in the panel. Dock right first: its divider is on the inner (left) edge.
    await browser.click(q('[data-testid=agent-layer-dock-right]'));
    await browser.until('docked right', `${placement} === 'docked:right'`);
    await browser.evaluate(`${q('[data-testid=dock-divider-agent]')}.focus()`);
    await browser.press('ArrowRight', { alt: true });
    await browser.until('floating from the divider', `${placement} === 'floating:right'`);
    assert.equal(await browser.evaluate(`${q(LAYER)}.contains(document.activeElement)`), true, 'focus stays in the panel after floating from the divider');
    await browser.click(q('[data-testid=agent-layer-dock-left]'));
    await browser.until('docked left again', `${placement} === 'docked:left'`);
    // One layer at a time: the manager replaces the coach, in the same dock.
    await browser.click(q('[data-testid=nav-user]'));
    await browser.until('the NavUser menu', `!!${q('[data-testid=account-improve]')}`);
    await browser.click(q('[data-testid=account-improve]'));
    await browser.until('the manager shown, the coach hidden', `${q('[data-spec=improve]')} && !${q('[data-spec=improve]')}.hidden && ${q('[data-spec=agent]')}.hidden && ${q('[data-testid=agent-layer-title]')}.textContent === "Améliorer l’app"`);
    assert.equal(await browser.evaluate(`document.querySelectorAll('${LAYER}').length`), 1, 'one layer');
    await browser.click(q('[data-testid=agent-layer-dock-right]'));
    await browser.until('docked right again', `${placement} === 'docked:right'`);
    await browser.press('Escape');
    await browser.until('closed', `${q(LAYER)}?.dataset.state === 'closed'`);
    // Compact: still the bottom drawer, with no dock placement.
    await browser.emulate('phone');
    await browser.send('Page.navigate', { url: app.url }); await live();
    await tap(TRIGGER);
    await browser.until('the drawer at half', `${snap} === 'half' && !!document.querySelector('[data-slot=drawer-popup]')`);
    assert.equal(await browser.evaluate(`${q(LAYER)}.dataset.placement ?? null`), null, 'the drawer has no dock placement');
    assert.equal(await browser.evaluate(`!!${q('[data-boring=dock]')} || !!${q('[data-testid=agent-layer-float]')}`), false, 'no dock and no float control on a phone');
    await browser.emulate('desktop');
    await browser.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
    await browser.send('Page.navigate', { url: app.url }); await live();
  });

  await step('expanded 1280x800: the annotate toggle arms pins, not point mode: hover, click, a pin with a field and a mic, the count chip, Esc exits (and does not close the panel), Send attaches the note', async () => {
    await browser.click(q('[data-testid=nav-progres]'));
    await browser.until('Progrès on show', `${q('[data-testid=header-title]')}.textContent === 'Progrès' && !${q('[data-testid=screen-progres]')}.hidden`);
    await browser.click(q('[data-testid=nav-user]'));
    await browser.until('the NavUser menu', `!!${q('[data-testid=account-improve]')}`);
    await browser.click(q('[data-testid=account-improve]'));
    await browser.until('the manager in the panel', `${q(LAYER)}?.dataset.state === 'open' && ${q('[data-testid=agent-layer-title]')}?.textContent === "Améliorer l’app"`);
    await pause(500);
    const IMPROVE = '[data-spec=improve]';
    const found = await browser.evaluate(`(() => { const form = ${q(IMPROVE + ' [data-testid=composer]')}; const toggles = [...form.querySelectorAll('[data-testid=composer-annotate]')]; const r = toggles[0]?.getBoundingClientRect();
      return { toggles: toggles.length, label: toggles[0]?.getAttribute('aria-label'), size: r ? [Math.round(r.width), Math.round(r.height)] : null, words: /Retour|Feedback|Montrer dans|question générale|Terminé/i.test(form.innerText),
        gone: ['composer-feedback', 'composer-point', 'feedback-bar', 'feedback-chip', 'feedback-general', 'feedback-count'].filter(id => document.querySelector('[data-testid=' + id + ']')) }; })()`);
    assert.deepEqual(found, { toggles: 1, label: 'Annoter', size: [34, 32], words: false, gone: [] }, 'exactly one stock native pointer Toggle and no Feedback block');
    await browser.click(q(IMPROVE + ' [data-testid=composer-annotate]'));
    await browser.until('annotating', `${q(IMPROVE + ' [data-testid=composer-annotate]')}.getAttribute('aria-pressed') === 'true'`);
    assert.equal(await browser.evaluate(`!!${q('[data-testid=feedback-point-bar]')} || !!${q('[data-testid=feedback-bar]')}`), false, 'pins, not point mode, and no bar');
    assert.equal(await browser.evaluate(`${q(LAYER)}?.dataset.state`), 'open', 'the panel stays open: the page is visible beside it');
    const item = '[data-testid=screen-progres] li:nth-child(3)';
    const at = await center(item);
    await browser.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: at.x, y: at.y });
    await browser.until('a hover label', `[...document.querySelectorAll('[data-feedback-overlay]')].some(host => host.shadowRoot.querySelector('.label[data-tone=hover]'))`, 5000);
    await browser.screenshot('desktop-annotate-hover.png');
    for (const type of ['mousePressed', 'mouseReleased']) await browser.send('Input.dispatchMouseEvent', { type, x: at.x, y: at.y, button: 'left', clickCount: 1 });
    await browser.until('the pin', `!!${q('[data-testid=feedback-bubble-input]')}`, 8000);
    const pin = await browser.evaluate(`(() => { const f = ${q('[data-testid=feedback-bubble-input]')}.getBoundingClientRect(), m = ${q('[data-testid=feedback-bubble-mic]')}?.getBoundingClientRect(), b = ${q('[data-testid=feedback-bubble]')}.getBoundingClientRect();
      return { mic: m ? [Math.round(m.width), Math.round(m.height)] : null, inside: !!m && m.left >= f.left && m.right <= f.right && m.bottom <= f.bottom + 1, hint: ${q('[data-testid=feedback-bubble-hint]')}?.textContent, general: !!${q('[data-testid=feedback-bubble-general]')},
        inViewport: b.left >= 0 && b.top >= 0 && b.right <= innerWidth && b.bottom <= innerHeight, buttons: [...${q('[data-testid=feedback-bubble]')}.querySelectorAll('button')].map(x => Math.round(x.getBoundingClientRect().height)) }; })()`);
    assert.deepEqual(pin.mic, [34, 32], 'stock pointer Toggle geometry');
    assert.ok(pin.inside, `the native mic stays inside the field: ${JSON.stringify(pin)}`);
    assert.equal(pin.hint, 'Maintenez ⌥ pour utiliser l’app');
    assert.equal(pin.general, false);
    assert.equal(pin.inViewport, true, 'the pin is inside the viewport');
    assert.ok(pin.buttons.every(height => height === 32), `stock pointer controls in the pin: ${pin.buttons}`);
    await browser.type(q('[data-testid=feedback-bubble-input]'), 'Montrer les pas de la semaine.');
    await browser.screenshot('desktop-annotate-pin.png');
    await browser.press('Enter');
    await browser.until('the count chip', `${q(IMPROVE + ' [data-testid=feedback-count]')}?.dataset.count === '1'`, 5000);
    await browser.press('Escape');
    await browser.until('annotating off', `${q(IMPROVE + ' [data-testid=composer-annotate]')}.getAttribute('aria-pressed') === 'false'`, 5000);
    await pause(400);
    assert.equal(await browser.evaluate(`${q(LAYER)}?.dataset.state`), 'open', 'Esc ended annotating only: the panel is still open');
    assert.equal(await browser.evaluate(`${q(IMPROVE + ' [data-testid=feedback-count]')}.dataset.count`), '1', 'the note waits for Send');
    const before = app.submits.length;
    await browser.click(q(IMPROVE + ' [data-testid=composer-submit]'));
    for (let i = 0; i < 100 && app.submits.length === before; i++) await pause(100);
    const sent = JSON.stringify(app.submits.at(-1)?.body);
    assert.ok(app.submits.length > before && sent.includes('Montrer les pas de la semaine.'), `Send attached the pending note: ${sent?.slice(0, 300)}`);
    await browser.until('the count chip is gone', `!${q(IMPROVE + ' [data-testid=feedback-count]')}`, 5000);
    await browser.screenshot('desktop-annotate-sent.png');
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
    await browser.until('ready', `!!${q('[data-testid=nav-user]')} && !${q('[data-testid=connecting]')}`, 30000);
    assert.equal(await browser.evaluate(`!!${q('[data-testid=nav-agent]')}`), false, 'no agent, no sidebar entry');
    await browser.send('Page.navigate', { url: `${app.url}?app=empty` });
    await live();
    assert.equal(await browser.evaluate(`!!${q('[data-testid=tabbar]')} || !!document.querySelector('[data-testid^=nav-][data-testid$=accueil]')`), false, 'no tab bar and no nav list');
    assert.equal(await browser.evaluate(`!!${q('[data-testid=sidebar-title]')} && !!${q('[data-testid=nav-user]')}`), true, 'title and NavUser only');
  });

  if (failed.length) console.log(`COLLECT: ${failed.length} failing step(s): ${failed.join(' | ')}`);
  console.log(browser.problems.length ? `page problems:\n${browser.problems.join('\n')}` : 'no page problems');
  assert.deepEqual(browser.problems.filter(p => !/Failed to load resource/.test(p)), []);
} finally { await browser?.close(); await app.close(); }
