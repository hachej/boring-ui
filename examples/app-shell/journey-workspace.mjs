// Real-browser journey for app-shell layouts B (`workspace`) and C (`chat`) (scripted model, no key): `?app=redaction` is a fictional
// consultation list (grouped by day, a detail with three blocks, two header actions) in <AppShell layout="workspace"> (./page.tsx), and
// `?app=pm` is the workspace-app's AgentWorkspace, untouched, in <AppShell layout="chat">. At 390x844 with touch: the list scrolls, a tap
// opens the detail as one stack step with « ← » and the actions kept, Back returns to the same scroll and a second Back leaves the page;
// a deep link to a detail goes Back to the list; a sheet, then the product-manager layer, close before the stack pops; the chat layout has
// the shell header above AgentWorkspace and no shell agent trigger. At 1280x800: the rail, a 20rem list beside the detail with no history
// entry per row, and AgentWorkspace with an artifact in its right panel. Controls are at least 44x44px and nothing overflows, in light and
// dark (the shell's own controls: AgentWorkspace is untouched, so its controls are not held to this). Screenshots go to .cache/evidence/app-shell/.
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
const step = async (name, run) => { const started = Date.now(); try { await run(); console.log(`ok  ${name} (${Date.now() - started} ms)`); } catch (error) { if (!collect) throw error; failed.push(name); console.log(`FAIL ${name}: ${String(error.message).split('\n')[0].slice(0, 200)}`); } };
const rect = selector => `(() => { const r = ${q(selector)}?.getBoundingClientRect(); return r && { x: r.x, y: r.y, w: r.width, h: r.height, right: r.right, bottom: r.bottom }; })()`;
const noOverflow = `document.documentElement.scrollWidth <= innerWidth && document.body.scrollWidth <= innerWidth`;
const LIST = '[data-testid=list-pane]', DETAIL = '[data-testid=detail-pane]', LAYER = '[data-testid=agent-layer]';
const view = `${q('[data-testid=list-detail]')}?.dataset.view`;
const historyLength = `history.length`;
const CHAT_LIVE = `!!${q('[data-testid=composer-input]')} && !${q('[data-testid=composer-input]')}.disabled`;

const app = await startAppShell({ directory: mkdtempSync(join(tmpdir(), 'boring-app-shell-ws-')) });
let browser;
try {
  browser = await launch(app.url, { evidence });
  const { send } = browser;
  const touch = (type, points) => send('Input.dispatchTouchEvent', { type, touchPoints: points.map(([x, y]) => ({ x, y })) });
  const dragTouch = async (x, y0, y1, steps = 8) => {
    await touch('touchStart', [[x, y0]]);
    for (let i = 1; i <= steps; i++) { await touch('touchMove', [[x, y0 + (y1 - y0) * i / steps]]); await pause(16); }
    await touch('touchEnd', []);
  };
  const center = async selector => { const r = await browser.evaluate(rect(selector)); return { ...r, x: r.x + r.w / 2, y: r.y + r.h / 2 }; };
  const tap = async selector => {
    await browser.until(`tappable ${selector}`, `(() => { const r = ${q(selector)}?.getBoundingClientRect(); return r && r.width > 0 && r.bottom > 0 && r.top < innerHeight; })()`);
    const r = await center(selector);
    await touch('touchStart', [[r.x, r.y]]); await touch('touchEnd', []);
  };
  const ready = () => browser.until('the app is live', `!!${q('[data-testid=screen-header]')} && !${q('[data-testid=connecting]')}`, 30000);
  const open = async (query, size = 'phone') => {
    if (size !== 'phone') { await browser.emulate('desktop'); await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false }); }
    await send('Page.navigate', { url: `${app.url}?${query}` });
    await ready();
  };
  /** Every visible control of the shell header, the rows and the tab bar is at least 44x44px; nothing overflows. */
  const controls = async where => {
    const small = await browser.evaluate(`(() => { const out = []; for (const e of document.querySelectorAll('[data-testid=screen-header] button, [data-testid=tabbar] [role=tab], [data-testid^=consultation-]')) {
      const r = e.getBoundingClientRect(); const st = getComputedStyle(e); if (!r.width || st.visibility === 'hidden' || e.closest('[hidden]')) continue; if (r.bottom < 0 || r.top > innerHeight) continue;
      if (r.width < 43.5 || r.height < 43.5) out.push((e.dataset.testid || e.getAttribute('aria-label') || e.tagName) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height)); } return out; })()`);
    assert.deepEqual(small, [], `${where}: controls under 44px`);
    assert.ok(await browser.evaluate(noOverflow), `${where}: horizontal overflow`);
  };
  const headerActions = `[...document.querySelectorAll('[data-testid^=header-action-]')].map(e => e.dataset.testid.slice(14))`;
  const openSheets = `document.querySelectorAll('[data-testid=app-sheet]').length`;
  const settle = () => pause(900);
  const rest = async selector => { let last = -1; for (let i = 0; i < 50; i++) { await pause(100); const now = await browser.evaluate(`${q(selector)}.scrollTop`); if (now === last) break; last = now; } return last; };
  const back = () => browser.evaluate(`history.back()`);

  await browser.emulate('phone');
  await open('app=redaction');
  const start = await browser.evaluate(historyLength);
  let scrolled = 0;

  await step('1 redaction compact: the list is grouped by day; scrolling then a tap opens the detail with « ← » and the actions, one history entry', async () => {
    assert.equal(await browser.evaluate(view), 'list');
    assert.equal(await browser.evaluate(`${qa('[data-testid=list-pane] h2')}.length`), 4, 'four days');
    assert.equal(await browser.evaluate(`!!${q('[data-testid=tabbar]')}`), true, 'two nav items: a tab bar');
    assert.deepEqual(await browser.evaluate(headerActions), ['new', 'agenda']);
    assert.equal(await browser.evaluate(`!!${q('[data-testid=agent-trigger]')}`), false, 'layout B has no shell agent trigger');
    const r = await center(LIST);
    await dragTouch(r.x, r.y + 200, r.y - 200);
    scrolled = await rest(LIST);
    assert.ok(scrolled > 100, `the list scrolled: ${scrolled}`);
    await controls('list');
    await browser.screenshot('workspace-phone-list.png');
    await tap('[data-testid=consultation-14]');
    await browser.until('the detail', `${view} === 'detail'`);
    assert.equal(await browser.evaluate(`${q('[data-testid=header-title]')}.textContent`), 'Consultation 14');
    assert.equal(await browser.evaluate(`!!${q('[data-testid=header-back]')}`), true, '« ← »');
    assert.deepEqual(await browser.evaluate(headerActions), ['new', 'agenda'], 'the screen\'s actions stay');
    assert.equal(await browser.evaluate(historyLength), start + 1, 'one history entry');
    assert.deepEqual(await browser.evaluate(`history.state`), { appShell: 'stack' });
    assert.equal(await browser.evaluate(`${q(LIST)}.hidden`), true, 'the list is hidden, not unmounted');
    assert.equal(await browser.evaluate(`${qa('[data-testid=detail-pane] section')}.length`), 3, 'blocks A, B and C');
    assert.deepEqual(await browser.evaluate(`window.__agentContext()`), { name: 'Consultations', params: { selected: 14 } }, 'the detail tells the agent what is selected');
    await browser.screenshot('workspace-phone-detail.png');
    await controls('detail');
  });

  await step('2 Back returns to the list at the same scroll, and a second Back leaves the page', async () => {
    await back();
    await browser.until('the list', `${view} === 'list'`);
    await pause(200);
    assert.equal(await browser.evaluate(`${q(LIST)}.scrollTop`), scrolled, 'the scroll is kept');
    assert.equal(await browser.evaluate(`history.state`), null);
    const href = await browser.evaluate(`location.href`);
    await tap('[data-testid=consultation-14]');
    await browser.until('the detail', `${view} === 'detail'`);
    await tap('[data-testid=header-back]');
    await browser.until('the list by « ← »', `${view} === 'list'`);
    await pause(300);
    assert.equal(await browser.evaluate(`location.href`), href);
    assert.equal(await browser.evaluate(`history.state`), null, '« ← » consumed the entry too');
    await back().catch(() => {});
    await browser.until('left the page', `location.href !== ${JSON.stringify(href)}`, 8000);
    await browser.evaluate(`history.forward()`).catch(() => {});
    await browser.until('back on the page', `location.href === ${JSON.stringify(href)}`, 8000);
    await ready();
  });

  await step('3 a deep link opens the detail, and Back goes to the list, not out of the app', async () => {
    await open('app=redaction&deep=1#12');
    assert.equal(await browser.evaluate(view), 'detail');
    assert.equal(await browser.evaluate(`${q('[data-testid=header-title]')}.textContent`), 'Consultation 12');
    await back();
    await browser.until('the list', `${view} === 'list'`);
    assert.ok((await browser.evaluate(`location.href`)).startsWith(app.url), 'still in the app');
    assert.equal(await browser.evaluate(`location.hash`), '', 'the app replaced the URL');
  });

  await step('4 in the detail, the account sheet closes first on Back and the detail stays; the next Back goes to the list', async () => {
    await tap('[data-testid=consultation-3]');
    await browser.until('the detail', `${view} === 'detail'`);
    await tap('[data-testid=account-button]');
    await browser.until('the sheet', `${openSheets} === 1 && !!${q('[data-testid=account-improve]')}`);
    await pause(700);
    assert.deepEqual(await browser.evaluate(`history.state`), { appShell: 'sheet' });
    await back();
    await browser.until('the sheet closed', `${openSheets} === 0`);
    assert.equal(await browser.evaluate(view), 'detail', 'the detail stays');
    assert.deepEqual(await browser.evaluate(`history.state`), { appShell: 'stack' });
    await back();
    await browser.until('the list', `${view} === 'list'`);
    assert.equal(await browser.evaluate(`history.state`), null);
  });

  await step('5 « Améliorer l’app » opens the layer in the detail: a swipe down does not close it and Back closes it before the stack pops', async () => {
    await tap('[data-testid=consultation-3]');
    await browser.until('the detail', `${view} === 'detail'`);
    await tap('[data-testid=account-button]');
    await browser.until('the account sheet', `!!${q('[data-testid=account-improve]')}`);
    await pause(700);
    await tap('[data-testid=account-improve]');
    await browser.until('improve shown', `${q('[data-testid=agent-layer-title]')}?.textContent === "Améliorer l’app" && ${q(LAYER)}?.dataset.state === 'half'`);
    await settle();
    const handle = await center('[data-slot=drawer-swipe-handle]');
    await dragTouch(handle.x, handle.y, 840, 10);
    await settle();
    assert.equal(await browser.evaluate(`${q(LAYER)}?.dataset.state`), 'half', 'a swipe down does not close it');
    await back();
    await browser.until('the layer closed', `!${q(LAYER)}`);
    assert.equal(await browser.evaluate(view), 'detail', 'the stack did not pop');
    await settle();
    await back();
    await browser.until('the list', `${view} === 'list'`);
  });

  await step('5b a tab from a detail keeps its URL after the stack goes back, and a reload on a detail adds no second entry', async () => {
    await open('app=redaction&tab=1');
    await tap('[data-testid=consultation-3]');
    await browser.until('the detail', `${view} === 'detail'`);
    await tap('[data-testid=tab-archives]');
    await browser.until('Archives on show', `!${q('[data-testid=screen-archives]')}.hidden`);
    await pause(500);
    assert.equal(await browser.evaluate(`location.hash`), '#archives', 'the URL is the tab\'s, not the detail\'s');
    await browser.reload();
    await ready();
    assert.equal(await browser.evaluate(`!${q('[data-testid=screen-archives]')}.hidden`), true, 'a reload shows Archives');
    await tap('[data-testid=tab-consultations]');
    await tap('[data-testid=consultation-4]');
    await browser.until('the detail', `${view} === 'detail'`);
    const length = await browser.evaluate(historyLength);
    await browser.reload();
    await ready();
    assert.equal(await browser.evaluate(view), 'detail');
    assert.equal(await browser.evaluate(historyLength), length, 'a reload adds no entry');
    await back();
    await browser.until('the list', `${view} === 'list'`);
    assert.equal(await browser.evaluate(`history.state`), null, 'the single entry was consumed');
  });

  await step('6 chat layout compact: the shell header sits above AgentWorkspace, the sessions drawer opens and closes, a message is answered, no shell agent trigger', async () => {
    await open('app=pm');
    assert.equal(await browser.evaluate(`!!${q('[data-testid=agent-trigger]')}`), false);
    assert.equal(await browser.evaluate(`!!${q('[data-testid=account-button]')}`), true, 'the avatar');
    assert.equal(await browser.evaluate(`${q('[data-testid=header-title]')}.textContent`), 'Atelier');
    const header = await browser.evaluate(rect('[data-testid=screen-header]')), workspace = await browser.evaluate(rect('[data-boring=agent-workspace]'));
    assert.ok(header.bottom <= workspace.y + 1, `the header is above the workspace: ${JSON.stringify({ header, workspace })}`);
    await browser.until('the chat is live', CHAT_LIVE, 20000);
    await browser.tap(q('[data-testid=sessions-toggle]'));
    await browser.until('the drawer', `${q('[data-testid=conversations]')}?.dataset.drawer === 'true'`, 5000);
    await pause(300);
    await browser.tap(q('[data-testid=sessions-toggle]'));
    await browser.until('the drawer closed', `${q('[data-testid=conversations]')}?.dataset.drawer !== 'true' || !${q('[data-testid=conversations]')}.checkVisibility()`, 5000);
    await browser.type(q('[data-testid=composer-input]'), 'Dis bonjour');
    await tap('[data-testid=composer-submit]');
    await browser.until('the reply', `/Bonjour/.test(${q('[data-testid=transcript]')}?.innerText ?? '')`, 20000);
    await browser.screenshot('workspace-phone-chat.png');
    await controls('chat');
  });

  await step('7 light and dark: no overflow and 44px controls on the list and the detail', async () => {
    await open('app=redaction');
    for (const dark of [false, true]) {
      await browser.evaluate(`document.documentElement.classList.toggle('dark', ${dark})`);
      await controls(dark ? 'list dark' : 'list light');
    }
    await tap('[data-testid=consultation-2]');
    await browser.until('the detail', `${view} === 'detail'`);
    await controls('detail dark');
    await browser.screenshot('workspace-phone-detail-dark.png');
    await browser.evaluate(`document.documentElement.classList.remove('dark')`);
  });

  await step('expanded redaction 1280x800: the rail, a 20rem list and the detail together; a row updates the detail with no history entry', async () => {
    await open('app=redaction', 'desktop');
    assert.equal(await browser.evaluate(`${q('[data-slot=sidebar][data-side=left]')}.dataset.state`), 'collapsed', 'the sidebar starts as the icon rail');
    assert.equal(await browser.evaluate(view), 'both');
    assert.equal(await browser.evaluate(`!!${q('[data-testid=tabbar]')}`), false);
    const list = await browser.evaluate(rect(LIST)), detail = await browser.evaluate(rect(DETAIL));
    assert.ok(Math.abs(list.w - 320) <= 1 && detail.x >= list.right - 1 && detail.w > 400, `a 20rem list beside the detail: ${JSON.stringify({ list, detail })}`);
    assert.deepEqual(await browser.evaluate(headerActions), ['new', 'agenda']);
    const before = await browser.evaluate(historyLength);
    await browser.click(q('[data-testid=consultation-5]'));
    await browser.until('the detail', `/Consultation 5/.test(${q('[data-testid=consultation-detail]')}?.innerText ?? '')`);
    await browser.click(q('[data-testid=consultation-9]'));
    await browser.until('the detail changed', `/Consultation 9/.test(${q('[data-testid=consultation-detail]')}?.innerText ?? '')`);
    assert.equal(await browser.evaluate(historyLength), before, 'no history entry');
    assert.equal(await browser.evaluate(`!!${q('[data-testid=header-back]')}`), false, 'no « ← » when expanded');
    assert.ok(await browser.evaluate(noOverflow));
    await browser.screenshot('workspace-desktop.png');
  });

  await step('expanded chat 1280x800: the rail and AgentWorkspace with its sessions pane; an artifact opens in the right panel', async () => {
    await open('app=pm', 'desktop');
    assert.equal(await browser.evaluate(`${q('[data-slot=sidebar][data-side=left]')}.dataset.state`), 'collapsed');
    await browser.until('the chat and sessions', `${CHAT_LIVE} && !!${q('[data-testid=conversations]')}`, 20000);
    await browser.type(q('[data-testid=composer-input]'), 'Write a picnic plan and present it.');
    await browser.press('Enter');
    await browser.until('the artifact panel', `${q('[data-testid=artifact-panel]')}?.dataset.artifactType === 'markdown' && /Picnic plan/.test(${q('[data-testid=artifact-panel]')}.innerText)`, 30000);
    const panel = await browser.evaluate(rect('[data-testid=workspace-panel]'));
    assert.ok(panel.x + panel.w > 1200, `the panel is on the right: ${JSON.stringify(panel)}`);
    assert.ok(await browser.evaluate(noOverflow));
    await browser.screenshot('workspace-desktop-chat.png');
  });

  if (failed.length) console.log(`COLLECT: ${failed.length} failing step(s): ${failed.join(' | ')}`);
  console.log(browser.problems.length ? `page problems:\n${browser.problems.join('\n')}` : 'no page problems');
  assert.deepEqual(browser.problems.filter(p => !/Failed to load resource/.test(p)), []);
} finally { await browser?.close(); await app.close(); }
