// One PM surface: the real AppShell one-line door, embedded workspace, history/library/tasks and the retained point workflow.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { launch, pause, q } from '@hachej/boring-testing/browser';
import { startPmPanel } from './server.mjs';

const evidence = process.env.PM_EVIDENCE ?? '.cache/evidence/pm-one/workspace';
mkdirSync(evidence, { recursive: true });
const app = await startPmPanel({ oneLine: true });
let browser;
const visible = selector => `!!${q(selector)}?.checkVisibility({ visibilityProperty: true })`;
const pins = `[...document.querySelectorAll('[data-feedback-overlay]')].flatMap(h => [...(h.shadowRoot?.querySelectorAll('.label') ?? [])]).filter(label => getComputedStyle(label).display !== 'none').map(label => label.textContent)`;
const records = [];
try {
  browser = await launch('about:blank', { evidence });
  for (const theme of ['coach', 'studio']) for (const dark of [false, true]) for (const device of ['desktop', 'phone']) {
    await browser.emulate(device);
    if (device === 'desktop') await browser.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    const label = `${theme}-${dark ? 'dark' : 'light'}-${device}`;
    const press = selector => device === 'phone' ? browser.tap(q(selector)) : browser.click(q(selector));
    await browser.send('Page.navigate', { url: `${app.url}?agent=improve` });
    await browser.until('PM opened on arrival', visible('[data-testid=workspace-bar-library]'), 30000);
    await browser.evaluate(`document.documentElement.classList.toggle('dark', ${dark}); document.documentElement.dataset.pmTheme = ${JSON.stringify(theme)}`);
    await browser.until('four existing icons plus close', `document.querySelectorAll('[data-testid=workspace-bar-tools] button[data-testid]').length === 5`);
    const buttons = await browser.evaluate(`[...document.querySelectorAll('[data-testid=workspace-bar-tools] button[data-testid]')].map(button => button.dataset.testid)`);
    assert.deepEqual(buttons, ['workspace-bar-tasks', 'workspace-bar-history', 'workspace-bar-library', 'workspace-bar-new', 'pm-close']);
    assert.equal(await browser.evaluate(`!!${q('[data-testid=pm-grabber]')} || !!${q('[data-testid=pm-expand]')} || !!${q('[data-testid=pm-requests]')}`), false);
    assert.equal(await browser.evaluate('new URL(location.href).searchParams.has("agent")'), false, 'launch parameter consumed before Back');
    const geometry = await browser.evaluate(`(() => { const app=${q('[data-pm-page]')}.getBoundingClientRect(), pm=${q('[data-testid=pm-panel]')}.getBoundingClientRect(); return { appRight:app.right, pmLeft:pm.left, pmWidth:pm.width, width:innerWidth, overflow:document.documentElement.scrollWidth>innerWidth, background:getComputedStyle(${q('[data-testid=pm-panel]')}).backgroundColor }; })()`);
    assert.equal(geometry.overflow, false);
    if (device === 'desktop') assert.ok(geometry.appRight <= geometry.pmLeft + 1, 'docked beside, not over app');
    else assert.equal(Math.round(geometry.pmWidth), 390, 'phone chat fills the screen');
    records.push({ label, ...geometry });
    await browser.screenshot(`${label}-chat.png`);

    await press('[data-testid=workspace-bar-tasks]');
    await browser.until('existing requests panel', visible('[data-testid=pm-task-board-seam]'));
    await browser.until('the board', visible('[data-testid=pm-task-board-seam] [data-boring=task-board]'));
    await browser.screenshot(`${label}-tasks.png`);
    await browser.press('Escape'); await pause(350);

    await press('[data-testid=workspace-bar-history]');
    await browser.until('history rows', visible('[data-testid=conversation-row]'));
    assert.ok(await browser.evaluate(`!!${q('[data-testid=workspace-bar-new]')}`), 'New remains its own fourth icon');
    const original = await browser.evaluate(`${q('[data-testid=conversation-row][data-active=true]')}.dataset.conversationId`);
    await browser.screenshot(`${label}-history.png`);
    if (theme === 'coach' && !dark) {
      await browser.press('Escape'); await pause(350);
      await press('[data-testid=workspace-bar-new]');
      await browser.until('new conversation ready', visible('[data-testid=pm-show]'), 20000);
      await press('[data-testid=workspace-bar-history]');
      await browser.until('new conversation selected', `!!${q('[data-testid=conversation-row][data-active=true]')} && ${q('[data-testid=conversation-row][data-active=true]')}.dataset.conversationId !== ${JSON.stringify(original)}`);
      await press(`[data-testid=conversation-row][data-conversation-id="${original}"]`);
      await browser.until('old chat continued', visible('[data-testid=pm-show]'), 20000);
    } else { await browser.press('Escape'); await pause(350); }

    await press('[data-testid=workspace-bar-library]');
    await browser.until('read-only file library', 'document.body.innerText.includes("fiche-produit.md")');
    assert.equal(await browser.evaluate(`!!document.querySelector('[data-testid=workspace-library] input[type=file]')`), false, 'Library has no upload');
    await browser.screenshot(`${label}-library.png`);
    await browser.press('Escape'); await pause(350);

    const before = app.submits.length;
    await press('[data-testid=pm-show]');
    await browser.until('point mode strip', visible('[data-testid=pm-strip]'));
    await press('[data-testid=card-a]');
    await browser.until('pin visible', `${pins}.includes('1')`);
    await browser.screenshot(`${label}-pin.png`);
    if (device === 'desktop') {
      await browser.until('comment field', visible('[data-testid=pm-comment-input]'));
      await browser.type(q('[data-testid=pm-comment-input]'), `Agrandir cette carte fictive ${label}`);
      await browser.press('Enter');
      await browser.until('comment sent', `${q('[data-testid=pm-hint]')}?.textContent === 'Envoyé au PM'`);
      await press('[data-testid=pm-done]');
    } else {
      await press('[data-testid=pm-done]');
      await browser.until('editable review chip', visible('[data-testid=pm-chip]'));
      await press('[data-testid=composer-submit]');
    }
    await browser.until('sent pin in regular chat', visible('[data-testid=pm-sent-message]'), 15000);
    assert.equal(app.submits.length, before + 1);
    assert.match(JSON.stringify(app.submits.at(-1).body), /pm\.points@1/);
    assert.match(JSON.stringify(app.submits.at(-1).body), /image\/png/);
    await browser.until('scripted PM reply', 'document.body.innerText.includes("C’est noté") || document.body.innerText.includes("C\'est noté")', 20000);
    await browser.screenshot(`${label}-sent.png`);
    assert.equal(await browser.evaluate('document.documentElement.scrollWidth > innerWidth'), false);

    // Back is local: pointing -> chat -> closed, never the deleted intermediate sheet or another page.
    await press('[data-testid=pm-show]');
    await browser.until('pointing again', visible('[data-testid=pm-strip]'));
    await browser.evaluate('history.back()');
    await browser.until('Back returns to chat', `${q('[data-testid=pm-panel]')}?.dataset.mode === 'chat'`);
    await browser.evaluate('history.back()');
    await browser.until('Back closes PM', `${q('[data-testid=pm-panel]')}.hidden`);
    assert.equal(await browser.evaluate('location.pathname'), new URL(app.url).pathname);
  }
  assert.deepEqual(browser.problems, []);
  writeFileSync(`${evidence}/geometry.json`, JSON.stringify(records, null, 2));
  console.log('PASS: 48 screenshots; 1440/390, light/dark, two host token themes; Tasks/History/Library/New/close, pin/send and Back');
} finally { await browser?.close(); await app.close(); }
