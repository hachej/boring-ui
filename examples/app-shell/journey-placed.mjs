// Real-browser journey for PlacedAgentWorkspace (scripted model, no key): `?app=placed` is the writer's AgentWorkspace as the « Agent » tab of an
// app shell, collapsed while another screen is on show. At 1440x900: Agent tab, a picnic plan open in the panel, the draft « Résume la semaine »,
// then « Approbations » -> the same conversation floats (draft kept, the page keeps its composer node and its open file), expand returns to the
// tab, and a reload restores the floating placement. At 390x844 with touch: collapsing hands the same controller to the shell's drawer at peek
// above the tab bar (header and tabs not covered, exactly one chat drawer, never the ambient overlay), and expand from the drawer returns to
// the tab. Screenshots go to .cache/evidence/placed-agent/. Run: npm run app-shell:journey:placed
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launch, pause, q, qa } from '@hachej/boring-testing/browser';

process.env.STUDIO_MODEL = 'scripted';
const { startAppShell } = await import('./server.mjs');
const evidence = process.env.APP_EVIDENCE ?? '.cache/evidence/placed-agent';
mkdirSync(evidence, { recursive: true });
const step = async (name, run) => { const started = Date.now(); await run(); console.log(`ok  ${name} (${Date.now() - started} ms)`); };
const rect = selector => `(() => { const r = ${q(selector)}?.getBoundingClientRect(); return r && { x: r.x, y: r.y, w: r.width, h: r.height, right: r.right, bottom: r.bottom }; })()`;
const COMPOSER = '[data-testid=composer-input]';
const PAGE = '[data-testid=placed-agent]', FLOAT = '[data-boring=ambient-chat]', LAYER = '[data-testid=agent-layer]';
const live = `(() => { const e = ${q(PAGE + ' ' + COMPOSER)}; return !!e && !e.disabled; })()`;
const hash = `location.hash`;

const app = await startAppShell({ directory: mkdtempSync(join(tmpdir(), 'boring-placed-agent-')) });
let browser;
try {
  browser = await launch(app.url, { evidence });
  const { send } = browser;
  const shot = name => browser.screenshot(name);
  const open = async (size, query = 'app=placed') => {
    if (size === 'wide') { await browser.emulate('desktop'); await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false }); }
    else await browser.emulate('phone');
    await send('Page.navigate', { url: `${app.url}?${query}` });
    await browser.until('the Agent tab is live', live, 30000);
  };
  const reset = () => browser.evaluate(`(() => { localStorage.clear(); sessionStorage.clear(); return true; })()`);

  await step('1 wide: the Agent tab, a plan open in the panel and a draft; another screen floats the same conversation', async () => {
    await open('wide');
    await reset();
    await send('Page.navigate', { url: `${app.url}?app=placed` });
    await browser.until('the Agent tab is live', live, 30000);
    await browser.type(q(PAGE + ' ' + COMPOSER), 'Write a picnic plan and present it.');
    await browser.press('Enter');
    await browser.until('the plan opens in the panel', `/Picnic plan/.test(${q('[data-testid=viewer-panel]')}?.innerText ?? '')`, 30000);
    await browser.type(q(PAGE + ' ' + COMPOSER), 'Résume la semaine');
    await browser.evaluate(`(() => { ${q(PAGE + ' ' + COMPOSER)}.__mark = 'page-composer'; ${q('[data-testid=viewer-panel]')}.__mark = 'page-panel'; return true; })()`);
    await shot('wide-1-agent-tab.png');
    await browser.click(q('[data-testid=nav-approvals]'));
    await browser.until('the floating chat', `!!${q(FLOAT)} && ${q(FLOAT)}.checkVisibility() && /Approbations/.test(${q('[data-testid=screen-header]')}?.innerText ?? '')`, 10000);
    assert.equal(await browser.evaluate(hash), '#approvals');
    assert.equal(await browser.evaluate(`${q(FLOAT + ' ' + COMPOSER)}.value`), 'Résume la semaine', 'the draft is kept');
    assert.ok(await browser.evaluate(`/picnic plan is ready/.test(${q(FLOAT + ' [data-testid=transcript]')}?.innerText ?? '')`), 'the same conversation');
    assert.equal(await browser.evaluate(`!!${q('[data-testid=approvals]')} && ${q('[data-testid=approvals]')}.checkVisibility()`), true, 'the app screen is on show under the chat');
    assert.equal(await browser.evaluate(`${q(PAGE)}.checkVisibility()`), false, 'the page is hidden, not gone');
    const box = await browser.evaluate(rect(FLOAT));
    assert.ok(box.right <= 1440 && box.bottom <= 900, `the floating chat is on screen: ${JSON.stringify(box)}`);
    await shot('wide-2-floating.png');
  });

  await step('2 wide: expand returns to the tab with the same nodes, open file and draft; a reload restores the floating placement', async () => {
    await browser.click(q('[data-testid=ambient-dock]'));
    await browser.until('back on the Agent tab', `${hash} === '#agent' && ${q(PAGE)}.checkVisibility() && !${q(FLOAT)}`, 10000);
    assert.equal(await browser.evaluate(`${q(PAGE + ' ' + COMPOSER)}.__mark`), 'page-composer', 'the exact composer node');
    assert.equal(await browser.evaluate(`${q('[data-testid=viewer-panel]')}.__mark`), 'page-panel', 'the open file kept its node');
    assert.equal(await browser.evaluate(`${q(PAGE + ' ' + COMPOSER)}.value`), 'Résume la semaine');
    await shot('wide-3-expanded.png');
    await browser.click(q("[data-testid=placed-collapse]"));
    await browser.until('floating again', `!!${q(FLOAT)} && ${hash} === '#approvals'`, 10000);
    await send('Page.reload');
    await browser.until('the floating chat after the reload', `!!${q(FLOAT)} && ${q(FLOAT)}.checkVisibility() && /Approbations/.test(${q('[data-testid=screen-header]')}?.innerText ?? '')`, 30000);
    assert.ok(await browser.evaluate(`/picnic plan is ready/.test(${q(FLOAT + ' [data-testid=transcript]')}?.innerText ?? '')`), 'the conversation came back');
    await shot('wide-4-reload.png');
  });

  await step('3 phone: collapse hands the same controller to the shell drawer at peek; one drawer; expand returns to the tab', async () => {
    await open('phone');
    await reset();
    await send('Page.navigate', { url: `${app.url}?app=placed` });
    await browser.until('the Agent tab is live', live, 30000);
    await browser.type(q(PAGE + ' ' + COMPOSER), 'Write a picnic plan and present it.');
    await browser.tap(q(PAGE + ' [data-testid=composer-submit]'));
    await browser.until('the reply', `/picnic plan is ready/.test(${q(PAGE + ' [data-testid=transcript]')}?.innerText ?? '')`, 30000);
    await browser.type(q(PAGE + ' ' + COMPOSER), 'Résume la semaine');
    await shot('phone-1-agent-tab.png');
    assert.equal(await browser.evaluate(`!!${q(FLOAT)}`), false, 'never the ambient overlay on a phone');
    await browser.tap(q('[data-testid=tab-approvals]'));
    await browser.until('the drawer at peek', `${qa(LAYER)}.length === 1 && ${q(LAYER)}.dataset.state === 'peek'`, 10000);
    await pause(600);
    assert.equal(await browser.evaluate(`!!${q(FLOAT)}`), false, 'never the ambient overlay on a phone');
    assert.equal(await browser.evaluate(`${qa(LAYER)}.length`), 1, 'exactly one chat drawer');
    assert.equal(await browser.evaluate(`${q(LAYER + ' ' + COMPOSER)}.value`), 'Résume la semaine', 'the drawer shows the same draft');
    assert.ok(await browser.evaluate(`/picnic plan is ready/.test(${q(LAYER + ' [data-testid=transcript]')}?.textContent ?? '')`), 'the same conversation');
    const header = await browser.evaluate(rect('[data-testid=screen-header]')), tabs = await browser.evaluate(rect('[data-testid=tabbar]')), layer = await browser.evaluate(rect(LAYER));
    // The drawer's visible strip (the peek) sits above the tab bar: neither the header nor the tabs are covered.
    const visible = await browser.evaluate(`(() => { const t = document.elementFromPoint(innerWidth / 2, ${tabs.y + tabs.h / 2}); const h = document.elementFromPoint(innerWidth / 2, ${header.y + header.h / 2}); return { tabs: !!t?.closest('[data-testid=tabbar]'), header: !!h?.closest('[data-testid=screen-header]') }; })()`);
    assert.deepEqual(visible, { tabs: true, header: true }, `header and tabs stay uncovered: ${JSON.stringify({ header, tabs, layer })}`);
    await shot('phone-2-drawer-peek.png');
    await browser.tap(q(LAYER + ' ' + COMPOSER));
    await browser.until('the drawer is open with its title row', `!!${q('[data-testid=agent-layer-action-expand]')}`, 10000);
    await shot('phone-3-drawer-full.png');
    await browser.tap(q('[data-testid=agent-layer-action-expand]'));
    // The route, not the URL: closing the layer pops its own history entry, which restores the hash the layer was opened over.
    await browser.until('back on the Agent tab', `${q('[data-testid=tab-agent]')}.getAttribute('aria-selected') === 'true' && ${q(PAGE)}.dataset.mode === 'tab' && ${q(PAGE)}.checkVisibility() && ${qa(LAYER)}.every(e => e.dataset.state === 'closed')`, 10000);
    assert.equal(await browser.evaluate(`${q(PAGE + ' ' + COMPOSER)}.value`), 'Résume la semaine', 'the draft is on the page again');
    await shot('phone-4-expanded.png');
  });

  console.log(browser.problems.length ? `page problems:\n${browser.problems.join('\n')}` : 'no page problems');
  assert.deepEqual(browser.problems.filter(p => !/Failed to load resource/.test(p)), []);
} finally { await browser?.close(); await app.close(); }
