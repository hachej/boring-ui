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
import { join, relative } from 'node:path';
import { launch, pause, q, qa } from '@hachej/boring-testing/browser';

process.env.STUDIO_MODEL = 'scripted';
const { startAppShell } = await import('./server.mjs');
const evidence = process.env.APP_EVIDENCE ?? '.cache/evidence/app-shell';
mkdirSync(evidence, { recursive: true });
// The embedded layout's screenshots (AgentWorkspace layout="embedded" inside the shell) go beside the standalone ones of the workspace-app journey.
const embeddedEvidence = process.env.EMBEDDED_EVIDENCE ?? '.cache/evidence/embedded';
mkdirSync(embeddedEvidence, { recursive: true });
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
  const shot = name => browser.screenshot(join(relative(evidence, embeddedEvidence), name));
  // AgentWorkspace layout="embedded" in the shell: its History, Library and New sit in the shell's header (one row), with no left column.
  const BAR = id => q(`[data-testid=screen-header] [data-testid=header-slot] [data-testid=workspace-bar-${id}]`);
  const libraryRow = name => `[...document.querySelectorAll('[data-testid=workspace-library] [data-path]')].find(e => e.dataset.path === ${JSON.stringify(name)})`;
  const embeddedInShell = async where => {
    for (const id of ['history', 'library', 'new']) assert.equal(await browser.evaluate(`!!${BAR(id)}`), true, `${where}: ${id} in the shell header`);
    assert.equal(await browser.evaluate(`!!${q('[data-testid=workspace-bar]')}`), false, `${where}: no second bar row`);
    assert.equal(await browser.evaluate(`!!${q('[data-testid=conversations]')} || !!${q('[data-testid=sessions-toggle]')}`), false, `${where}: no sessions column or toggle`);
    assert.equal(await browser.evaluate(`${q('[data-boring=agent-workspace]')}.dataset.layout`), 'embedded');
    const header = await browser.evaluate(rect('[data-testid=screen-header]')), history = await browser.evaluate(rect('[data-testid=workspace-bar-history]'));
    assert.ok(history.y >= header.y && history.bottom <= header.bottom + 1, `${where}: History is inside the header row: ${JSON.stringify({ header, history })}`);
  };

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

  // The PM panel replaced the manager's drawer (no swipe-to-keep-open, no history entry of its own); it is covered by examples/pm-panel/journey.mjs.
  await step('5 « Améliorer l’app » opens the PM panel in the detail: closing it keeps the detail, and Back then pops the stack', async () => {
    await tap('[data-testid=consultation-3]');
    await browser.until('the detail', `${view} === 'detail'`);
    await tap('[data-testid=account-button]');
    await browser.until('the account sheet', `!!${q('[data-testid=account-improve]')}`);
    await pause(700);
    await tap('[data-testid=account-improve]');
    await browser.until('the PM panel as a sheet', `${q('[data-testid=pm-panel]')}?.hidden === false && ${q('[data-testid=pm-panel]')}.dataset.mode === 'sheet'`);
    assert.equal(await browser.evaluate(`!!${q(LAYER)}`), false, 'the agent layer stays out of it');
    await settle();
    await tap('[data-testid=pm-close]');
    await browser.until('the PM panel closed', `${q('[data-testid=pm-panel]')}.hidden`);
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
    // The History column (the sessions pane) stays beside the artifact while column, viewer and chat fit, and steps aside when they do not.
    const SESSIONS = `${q('[data-boring=agent-workspace]')}.dataset.sessions`;
    assert.equal(await browser.evaluate(SESSIONS), 'docked', 'the column fits beside the artifact at 1280px');
    await browser.screenshot('workspace-desktop-chat.png');
    await send('Emulation.setDeviceMetricsOverride', { width: 900, height: 800, deviceScaleFactor: 1, mobile: false });
    await browser.until('the column steps aside; History is the popover', `innerWidth === 900 && ${SESSIONS} === 'hidden' && !!${q('[data-testid=history-open]')} && !${q('[data-testid=sessions-toggle]')}`, 10000);
    await browser.click(q('[data-testid=artifact-close]'));
    await browser.until('the column returns', `${SESSIONS} === 'docked' && !${q('[data-testid=history-open]')}`, 10000);
    assert.ok(await browser.evaluate(noOverflow));
  });

  await step('8 embedded chat layout compact: History, Library and New join the shell header; sheets; a picked document opens; 44px and no overflow at 390 and 360, light and dark', async () => {
    await browser.emulate('phone');
    await open('app=pm&embedded');
    await browser.until('the chat is live', CHAT_LIVE, 20000);
    await embeddedInShell('390');
    await browser.type(q('[data-testid=composer-input]'), 'Write a picnic plan and present it.');
    await tap('[data-testid=composer-submit]');
    await browser.until('the reply', `/picnic plan is ready/.test(${q('[data-testid=transcript]')}?.innerText ?? '')`, 30000);
    for (const dark of [false, true]) {
      const scheme = dark ? 'dark' : 'light';
      await browser.evaluate(`document.documentElement.classList.toggle('dark', ${dark})`);
      await controls(`embedded ${scheme}`);
      await shot(`shell-phone-${scheme}.png`);
      await browser.tap(BAR('history'));
      await browser.until('the History sheet', `!!${q('[data-testid=workspace-history]')} && ${qa('[data-testid=workspace-history] [data-testid=conversation-row]')}.length >= 1`, 5000);
      await settle(); await shot(`shell-phone-history-${scheme}.png`);
      await browser.press('Escape');
      await browser.until('the History sheet closed', `!${q('[data-testid=workspace-history]')}`, 5000);
      await browser.tap(BAR('library'));
      await browser.until('the Library sheet lists the document', `!!${libraryRow('picnic-plan.md')}`, 10000);
      await settle(); await shot(`shell-phone-library-${scheme}.png`);
      await browser.tap(`${libraryRow('picnic-plan.md')}.querySelector('button') ?? ${libraryRow('picnic-plan.md')}`);
      await browser.until('the document opens in the artifact panel', `!${q('[data-testid=workspace-library]')} && /Picnic plan/.test(${q('[data-testid=viewer-panel]')}?.innerText ?? '')`, 10000);
      await settle(); await shot(`shell-phone-document-${scheme}.png`);
      await browser.evaluate(`[...document.querySelectorAll('[data-testid=viewer-panel] [data-testid$="-close"]')].find(e => e.checkVisibility())?.click()`);
      await browser.until('the panel closed', `!${q('[data-testid=viewer-panel]')}?.checkVisibility()`, 5000);
    }
    await send('Emulation.setDeviceMetricsOverride', { width: 360, height: 780, deviceScaleFactor: 3, mobile: true });
    await browser.until('360px', 'innerWidth === 360', 5000);
    await embeddedInShell('360');
    await controls('embedded 360');
    await browser.evaluate(`document.documentElement.classList.remove('dark')`);
  });

  await step('9 embedded chat layout expanded 1440x900: History and Library are popovers from the shell header; a picked document opens the panel, light and dark', async () => {
    await open('app=pm&embedded', 'desktop');
    await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await browser.until('the chat is live', `innerWidth === 1440 && ${CHAT_LIVE}`, 20000);
    await embeddedInShell('1440');
    for (const dark of [false, true]) {
      const scheme = dark ? 'dark' : 'light';
      await browser.evaluate(`document.documentElement.classList.toggle('dark', ${dark})`);
      await browser.click(BAR('history'));
      await browser.until('the History popover', `!!${q('[data-testid=workspace-history]')} && ${qa('[data-testid=workspace-history] [data-testid=conversation-row]')}.length >= 1`, 5000);
      await settle(); await shot(`shell-desktop-history-${scheme}.png`);
      await browser.press('Escape');
      await browser.until('the History popover closed', `!${q('[data-testid=workspace-history]')}`, 5000);
      await browser.click(BAR('library'));
      await browser.until('the Library popover lists the document', `!!${libraryRow('picnic-plan.md')}`, 10000);
      await settle(); await shot(`shell-desktop-library-${scheme}.png`);
      await browser.click(`${libraryRow('picnic-plan.md')}.querySelector('button') ?? ${libraryRow('picnic-plan.md')}`);
      await browser.until('the document opens in the artifact panel', `!${q('[data-testid=workspace-library]')} && /Picnic plan/.test(${q('[data-testid=viewer-panel]')}?.innerText ?? '')`, 10000);
      assert.ok(await browser.evaluate(noOverflow));
      await settle(); await shot(`shell-desktop-document-${scheme}.png`);
    }
    await browser.evaluate(`document.documentElement.classList.remove('dark')`);
  });

  await step('10 the open document renamed from the Library stays open at its new path, and closes when it is deleted (D-263)', async () => {
    const viewing = path => `!!${q(`[data-testid=viewer-panel] [data-testid=file-viewer][data-path=${JSON.stringify(path)}]`)}`;
    await browser.until('the document is open in the panel', viewing('picnic-plan.md'), 10000);
    await browser.click(BAR('library'));
    await browser.until('the Library popover lists the document', `!!${libraryRow('picnic-plan.md')}`, 10000);
    await browser.evaluate(`${libraryRow('picnic-plan.md')}.querySelector('[data-file-more]').focus()`); await browser.press('Enter');
    await browser.until('the row menu', `!!${q('[data-boring=file-actions] [data-action=rename]')}`, 5000);
    await browser.evaluate(`${q('[data-boring=file-actions] [data-action=rename]')}.click()`);
    await browser.until('inline rename', `document.activeElement?.matches('input[data-file-rename][data-revision-known]')`, 5000);
    await browser.evaluate(`${q('input[data-file-rename]')}.select()`); await send('Input.insertText', { text: 'picnic-plan-v2.md' }); await browser.press('Enter');
    await browser.until('the renamed row', `!!${libraryRow('picnic-plan-v2.md')} && !${libraryRow('picnic-plan.md')}`, 10000);
    await browser.until('the panel follows the rename', `${viewing('picnic-plan-v2.md')} && !${viewing('picnic-plan.md')}`, 10000);
    await settle(); await shot('shell-desktop-renamed-open-file.png');
    await browser.evaluate(`${libraryRow('picnic-plan-v2.md')}.focus()`); await browser.press('Delete');
    await browser.until('the delete dialog', `!!${q('[data-boring=file-tree-dialog] [data-confirm=delete]')}`, 5000);
    await browser.evaluate(`${q('[data-boring=file-tree-dialog] [data-confirm=delete]')}.click()`);
    await browser.until('the deleted row', `!${libraryRow('picnic-plan-v2.md')}`, 10000);
    await browser.until('the panel closes on delete', `!${q('[data-testid=file-viewer]')}`, 10000);
  });

  if (failed.length) console.log(`COLLECT: ${failed.length} failing step(s): ${failed.join(' | ')}`);
  console.log(browser.problems.length ? `page problems:\n${browser.problems.join('\n')}` : 'no page problems');
  assert.deepEqual(browser.problems.filter(p => !/Failed to load resource/.test(p)), []);
} finally { await browser?.close(); await app.close(); }
