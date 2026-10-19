// Real-browser journey of the built-in maquette viewer in the workspace app (scripted model, no key): the agent writes and presents the
// fictional booking mock-up (test/fixtures/maquette/booking.maquette.json) and the pi-app artifact panel draws it with no app kind. Phone
// first (the panel is a full-screen sheet; the message is sent at desktop width, where the panel opens for `present`): the screen takes
// most of the height under one thin bar, swipe walks the screens, a goto opens its screen and Back returns, a guided tour from the menu
// shows its caption and dots, How it works opens the diagram in a dialog, no horizontal scroll at 390 or 360 and 44px touch targets.
// Then desktop at 1440: arrow keys, Back, and `#screen=` opening a screen. Screenshots (light and dark) go to .cache/evidence/maquette/.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { insecureUrl, launch, pause, q, qa } from '@hachej/boring-testing/browser';

process.env.STUDIO_MODEL = 'scripted';
const { startWorkspaceApp } = await import('./server.mjs');
const { misses } = await import('../../lab/studio/scripted-model.mjs');
const evidence = process.env.APP_EVIDENCE ?? '.cache/evidence/maquette';
mkdirSync(evidence, { recursive: true });
const step = async (name, run) => { const started = Date.now(); await run(); console.log(`ok  ${name} (${Date.now() - started} ms)`); };
const INPUT = q('[data-testid=composer-input]');
const WALK = q('[data-testid=maquette-walk]');
const SCREEN = `${WALK}?.dataset.screen`;
const noOverflow = `document.documentElement.scrollWidth <= innerWidth && document.body.scrollWidth <= innerWidth`;
// Visible buttons, selects and inputs of the viewer smaller than 44px in either direction.
const SMALL = `${qa('[data-boring=maquette-viewer] button, [data-boring=maquette-viewer] select, [data-boring=maquette-viewer] input')}.filter(e => e.checkVisibility() && !e.closest('[inert]')).map(e => { const r = e.getBoundingClientRect(); return { t: e.dataset.testid ?? e.textContent.trim().slice(0, 20), h: r.height }; }).filter(b => b.h < 44)`;
const scheme = value => browser.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value }] });
const shoot = async name => { for (const value of ['light', 'dark']) { await scheme(value); await pause(250); await browser.screenshot(`${name}-${value}.png`); } await scheme('light'); };
const swipe = async dx => {
  const box = await browser.evaluate(`(() => { const r = ${q('[data-testid=maquette-frame]')}.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + Math.min(r.height / 2, 200) }; })()`);
  await browser.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: box.x, y: box.y }] });
  await browser.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: box.x + dx / 2, y: box.y }] });
  await browser.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
};

const app = await startWorkspaceApp({ directory: mkdtempSync(join(tmpdir(), 'boring-maquette-')) });
let browser;
try {
  browser = await launch(insecureUrl(app.url), { evidence });
  await browser.until('the chat is live', `!!${INPUT} && !${INPUT}.disabled`, 20000);
  const openMenu = async tap => { await (tap ? browser.tap : browser.click)(q('[data-testid=maquette-menu]')); await browser.until('the menu', `!!${q('[data-testid=maquette-menu-list]')}`, 5000); await pause(200); };

  await step('phone: the presented mock-up opens in the sheet, the screen taking most of the height', async () => {
    await browser.type(INPUT, 'Make the booking mock-up and present it.'); await browser.press('Enter');
    await browser.until('the card names the built-in kind', `${q('[data-testid=artifact-card][data-state=ready]')}?.dataset.artifactKind === 'Mock-up'`, 30000);
    await browser.emulate('phone');
    await pause(400);
    if (!(await browser.evaluate(`!!${WALK}`))) await browser.tap(q('[data-testid=artifact-card][data-state=ready]'));
    await browser.until('the sheet with the viewer', `${q('[data-testid=workspace-panel]')}?.dataset.sheet === 'true' && ${SCREEN} === 'classes'`, 10000);
    assert.equal(await browser.evaluate(`${q('[data-testid=artifact-panel-type]')}?.textContent`), 'Mock-up');
    assert.equal(await browser.evaluate(`${q('[data-testid=maquette-position]')}.textContent`), '1 / 3');
    const top = await browser.evaluate(`${q('[data-testid=maquette-frame]')}.getBoundingClientRect().top / innerHeight`);
    assert.ok(top <= 0.15, `the screen starts within the top 15% of the phone (${top.toFixed(3)})`);
    assert.ok(await browser.evaluate(noOverflow), 'no horizontal scroll at 390');
    assert.deepEqual(await browser.evaluate(SMALL), [], '44px touch targets');
    await shoot('phone-screen');
  });

  await step('phone: swipe walks the screens; a goto opens its screen and Back returns', async () => {
    await swipe(-160);
    await browser.until('swiped to the next screen', `${SCREEN} === 'class'`, 5000);
    await swipe(160);
    await browser.until('swiped back', `${SCREEN} === 'classes'`, 5000);
    await browser.tap(q('[data-testid=maquette-screen] [data-testid=maquette-goto][data-goto=class]'));
    await browser.until('goto opened the class', `${SCREEN} === 'class'`, 5000);
    await browser.tap(q('[data-testid=maquette-back]'));
    await browser.until('Back returned', `${SCREEN} === 'classes'`, 5000);
  });

  await step('phone: the menu starts a guided tour with a caption and step dots', async () => {
    await openMenu(true);
    await shoot('phone-menu');
    await browser.tap(q('[data-testid=maquette-tour]'));
    await browser.until('first tour step', `/Alex, a fictional student/.test(${q('[data-testid=maquette-caption]')}?.textContent ?? '')`, 5000);
    await browser.tap(q('[data-testid=maquette-next]'));
    await browser.until('second tour step', `${SCREEN} === 'class' && /types a name/.test(${q('[data-testid=maquette-caption]')}.textContent)`, 5000);
    assert.ok(await browser.evaluate(noOverflow));
    assert.deepEqual(await browser.evaluate(SMALL), [], '44px touch targets in a tour');
    await shoot('phone-tour-step');
    await browser.tap(q('[data-testid=maquette-end-tour]'));
  });

  await step('phone: How it works opens from the menu in a dialog; the diagram scrolls inside its box', async () => {
    assert.equal(await browser.evaluate(`!!${q('[data-testid=diagram]')}`), false, 'hidden by default');
    await openMenu(true);
    await browser.tap(q('[data-testid=maquette-how-open]'));
    await browser.until('diagram', `!!${q('[data-testid=maquette-how] [data-testid=diagram]')}`, 5000);
    await browser.tap(qa('[data-testid=maquette-case]') + `.find(e => e.textContent === 'Cancellation')`);
    await browser.until('highlighted', `${qa('[data-testid=diagram] g[data-node][data-lit]')}.length === 4`, 5000);
    assert.equal(await browser.evaluate(`${q('[data-testid=diagram]')}.dataset.layout`), 'vertical', 'steps run top to bottom on a phone');
    assert.ok(await browser.evaluate(noOverflow), 'the diagram never scrolls the page');
    await shoot('phone-how-it-works');
    await browser.press('Escape');
    await browser.until('dialog closed', `!${q('[data-testid=maquette-how]')}`, 5000);
    await browser.send('Emulation.setDeviceMetricsOverride', { width: 360, height: 780, deviceScaleFactor: 2, mobile: true });
    await pause(300);
    assert.ok(await browser.evaluate(noOverflow), 'no horizontal scroll at 360');
  });

  await step('desktop 1440: arrow keys, Back, a tour, How it works, and #screen= opens a screen', async () => {
    await browser.emulate('desktop');
    await browser.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await browser.until('panel beside the chat', `${q('[data-testid=workspace-panel]')}?.dataset.sheet !== 'true' && !!${WALK}`, 10000);
    await browser.evaluate(`${q('[data-testid=maquette-screen-title]')}.focus()`);
    const before = await browser.evaluate(SCREEN);
    await browser.press('ArrowRight');
    await browser.until('arrow key moved on', `${SCREEN} !== ${JSON.stringify(before)}`, 5000);
    await browser.click(q('[data-testid=maquette-back]'));
    await browser.until('Back returned', `${SCREEN} === ${JSON.stringify(before)}`, 5000);
    await shoot('desktop-screen');
    await openMenu(false);
    await browser.click(q('[data-testid=maquette-tour]'));
    await browser.until('tour', `!!${q('[data-testid=maquette-caption]')}`, 5000);
    await shoot('desktop-tour-step');
    await browser.click(q('[data-testid=maquette-end-tour]'));
    await openMenu(false);
    await browser.click(q('[data-testid=maquette-how-open]'));
    await browser.until('diagram', `!!${q('[data-testid=maquette-how] [data-testid=diagram]')}`, 5000);
    await shoot('desktop-how-it-works');
    await browser.press('Escape');
    await browser.evaluate(`location.hash = 'screen=confirmed'`);
    await browser.until('#screen= opened the screen', `${SCREEN} === 'confirmed'`, 5000);
  });

  assert.deepEqual(misses, [], 'every prompt had a scripted answer');
  assert.deepEqual(browser.problems, [], 'no page errors');
  console.log(`PASS maquette journey; screenshots in ${evidence}`);
} finally {
  await browser?.screenshot('last-state.png');
  await browser?.close();
  await app.close();
}
