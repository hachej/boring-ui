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
    await browser.until('finished fold', visible('[data-testid=pm-finished-toggle]'));
    assert.equal(await browser.evaluate(`${q('[data-testid=pm-finished-toggle]')}.getAttribute('aria-expanded')`), 'false');
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
    // Reject forged and cross-window messages; same-origin parent message opens the existing PM.
    await browser.evaluate(`window.dispatchEvent(new MessageEvent('message', {origin:'https://foreign.invalid', source:window, data:{boring:'pm-open',requestId:'forged-origin'}}))`);
    assert.equal(await browser.evaluate(`${q('[data-testid=pm-panel]')}.hidden`), true);
    await browser.evaluate(`window.dispatchEvent(new MessageEvent('message', {origin:location.origin, source:null, data:{boring:'pm-open',requestId:'forged-source'}}))`);
    assert.equal(await browser.evaluate(`${q('[data-testid=pm-panel]')}.hidden`), true);
    await browser.evaluate(`window.postMessage({boring:'pm-open',requestId:'open-again'}, location.origin)`);
    await browser.until('same-origin open signal', visible('[data-testid=pm-show]'));
  }
  // Real same-origin parent/child handshake, not just a synthetic event in the app window.
  await browser.send('Page.navigate', { url: app.url });
  await browser.until('parent app loaded', visible('[data-testid=account-button]'));
  await browser.evaluate(`(() => {
    const frame = document.createElement('iframe'); frame.id='pm-host-frame'; frame.src=${JSON.stringify(app.url)};
    frame.style.cssText='position:fixed;inset:0;width:100%;height:100%;border:0';
    window.__pmSignals=[];
    window.addEventListener('message', event => { if(event.origin===location.origin && event.source===frame.contentWindow && ['pm-ready','pm-ack'].includes(event.data?.boring)) window.__pmSignals.push(event.data); });
    document.body.replaceChildren(frame);
  })()`);
  const child = `document.querySelector('#pm-host-frame').contentDocument`;
  const send = (kind, requestId) => browser.evaluate(`document.querySelector('#pm-host-frame').contentWindow.postMessage({boring:${JSON.stringify(kind)},requestId:${JSON.stringify(requestId)}}, location.origin)`);
  await browser.until('child advertises PM support', 'window.__pmSignals.some(message=>message.boring==="pm-ready" && message.supported)');
  await send('pm-probe', 'probe-1');
  await browser.until('correlated capability probe', 'window.__pmSignals.some(message=>message.boring==="pm-ready" && message.requestId==="probe-1" && message.supported)');
  for (const requestId of ['first-open', 'reopen-after-close']) {
    await send('pm-open', requestId);
    await browser.until('parent open acknowledged', `window.__pmSignals.some(message=>message.boring==='pm-ack' && message.requestId===${JSON.stringify(requestId)} && message.accepted)`);
    await browser.until('child PM visible', `!!${child}.querySelector('[data-testid=pm-show]')?.checkVisibility({visibilityProperty:true})`, 20000);
    await browser.click(`${child}.querySelector('[data-testid=pm-close]')`);
    await browser.until('person closed child PM', `${child}.querySelector('[data-testid=pm-panel]').hidden`);
  }
  writeFileSync(`${evidence}/frame-signals.json`, JSON.stringify(await browser.evaluate('window.__pmSignals'), null, 2));
  assert.deepEqual(browser.problems, []);
  writeFileSync(`${evidence}/geometry.json`, JSON.stringify(records, null, 2));
  console.log('PASS: 48 screenshots; 1440/390, light/dark, two host token themes; Tasks/History/Library/New/close, pin/send, Back and parent-frame readiness/reopen');
} finally { await browser?.close(); await app.close(); }
