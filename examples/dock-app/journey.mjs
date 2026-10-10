// Real-browser journey for the dock example (scripted model, no key): a fictional "Journal" app in DockMain, an agent chat Dock on its left
// and a files Dock on its right (./page.tsx). It proves: the initial layout, keyboard resize with clamping and Home/End, pointer drag, the width
// remembered after a reload, dragging below the threshold (hint, release floats the chat as AmbientChat, the app takes the full width, the draft
// carries over), the floating window's grip and pill moving, the Dock button re-attaching at the last width, Alt+ArrowLeft floating, the files dock
// opened from the chat header and closed by dragging below its threshold, and at 390x844 the chat floating without a Dock button and the files
// dock a full-screen sheet with no horizontal scroll. Screenshots go to .cache/evidence/dock-app/.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { insecureUrl, launch, pause, q } from '@hachej/boring-testing/browser';

process.env.STUDIO_MODEL = 'scripted';
const { startDockApp } = await import('./server.mjs');
const evidence = process.env.APP_EVIDENCE ?? '.cache/evidence/dock-app';
mkdirSync(evidence, { recursive: true });
const step = async (name, run) => { const started = Date.now(); await run(); console.log(`ok  ${name} (${Date.now() - started} ms)`); };
const rect = selector => `(() => { const r = ${q(selector)}?.getBoundingClientRect(); return r && { x: r.x, y: r.y, w: r.width, h: r.height, right: r.right, bottom: r.bottom }; })()`;
const placement = id => `${q(`[data-dock=${id}]`)}?.dataset.placement`;
const DIVIDER = id => `[data-testid=dock-divider-${id}]`;
const now = id => `Number(${q(DIVIDER(id))}?.getAttribute('aria-valuenow'))`;
const INPUT = q('[data-testid=composer-input]');
const STATE = `${q('[data-boring=ambient-chat]')}?.dataset.state`;
const noOverflow = `document.documentElement.scrollWidth <= innerWidth && document.body.scrollWidth <= innerWidth`;

const app = await startDockApp({ directory: mkdtempSync(join(tmpdir(), 'boring-dock-app-')) });
let browser;
try {
  browser = await launch(insecureUrl(app.url), { evidence });
  const mouse = (type, x, y, clickCount = 1) => browser.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount });
  const dragFrom = async (selector, to) => {
    const r = await browser.evaluate(rect(selector));
    const from = { x: r.x + r.w / 2, y: r.y + r.h / 2 };
    await mouse('mouseMoved', from.x, from.y); await mouse('mousePressed', from.x, from.y);
    for (let i = 1; i <= 8; i++) await mouse('mouseMoved', from.x + (to.x - from.x) * i / 8, from.y + (to.y - from.y) * i / 8);
    await mouse('mouseReleased', to.x, to.y);
  };
  const focusDivider = id => browser.evaluate(`${q(DIVIDER(id))}.focus()`);
  const live = () => browser.until('the chat is live', `${q('[data-testid=connection]')}?.dataset.state === 'connected' && !!${INPUT}`, 20000);

  await step('initial layout: the chat on the left at its default width, the app on the right, files closed', async () => {
    await live();
    assert.equal(await browser.evaluate(placement('chat')), 'docked');
    assert.equal(await browser.evaluate(placement('files')), 'closed');
    const chat = await browser.evaluate(rect('[data-dock=chat]')), journal = await browser.evaluate(rect('[data-boring=dock-main]'));
    assert.deepEqual([chat.x, Math.round(chat.w)], [0, 420]);
    assert.ok(journal.x >= 419 && journal.x <= 424 && Math.round(journal.right) === 1500, JSON.stringify(journal));
    assert.equal(await browser.evaluate(`${q('[data-testid=dock-divider-chat]')}.getAttribute('role')`), 'separator');
    assert.equal(await browser.evaluate(`${q('[data-testid=dock-divider-files]')}`), null, 'a closed dock has no divider');
    assert.equal(await browser.evaluate(`document.querySelectorAll('[data-testid=journal-row]').length`), 3);
    await pause(300);
    await browser.screenshot('dock-app-attached.png');
  });

  await step('keyboard: arrows resize (Shift is a big step), the width is clamped, Home and End jump to the ends', async () => {
    await focusDivider('chat');
    await browser.press('ArrowRight');
    assert.equal(await browser.evaluate(now('chat')), 444);
    await browser.press('ArrowRight', { shift: true });
    assert.equal(await browser.evaluate(now('chat')), 540);
    await browser.press('ArrowLeft');
    assert.equal(await browser.evaluate(now('chat')), 516);
    await browser.press('Home');
    assert.equal(await browser.evaluate(now('chat')), 300);
    await browser.press('ArrowLeft');
    assert.equal(await browser.evaluate(now('chat')), 300, 'not narrower than minWidth with the arrow key');
    assert.equal(await browser.evaluate(placement('chat')), 'docked');
    await browser.press('End');
    assert.equal(await browser.evaluate(now('chat')), 1140, 'End leaves the app 360px (minMain)');
    await browser.press('ArrowRight', { shift: true });
    assert.equal(await browser.evaluate(now('chat')), 1140, 'not wider than the maximum');
    assert.equal(Math.round((await browser.evaluate(rect('[data-boring=dock-main]'))).w), 360, 'the app keeps its minimum width');
    await browser.evaluate(`${q(DIVIDER('chat'))}.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))`);
    assert.equal(await browser.evaluate(now('chat')), 420, 'double-click resets to defaultWidth');
  });

  await step('pointer drag resizes the chat, and the width is remembered after a reload', async () => {
    await browser.drag(q(DIVIDER('chat')), 520);
    await browser.until('520 wide', `${now('chat')} === 520`, 3000);
    assert.equal(Math.round((await browser.evaluate(rect('[data-dock=chat]'))).w), 520);
    await browser.reload();
    await live();
    assert.equal(await browser.evaluate(now('chat')), 520, 'the width survived the reload');
    assert.equal(await browser.evaluate(placement('chat')), 'docked');
  });

  await step('dragging below the threshold shows the hint; releasing floats the chat, the app takes the full width, the draft carries over', async () => {
    await browser.type(INPUT, 'Draft about the market');
    // Narrower to 400, then below the threshold: the chat keeps the last width above it (400) for the Dock button.
    const divider = await browser.evaluate(rect(DIVIDER('chat')));
    const from = { x: divider.x + divider.w / 2, y: divider.y + divider.h / 2 };
    // A real double-click first (it resets the width): the next press must still resize, not drag a text selection.
    await mouse('mouseMoved', from.x, from.y);
    for (const count of [1, 2]) { await mouse('mousePressed', from.x, from.y, count); await mouse('mouseReleased', from.x, from.y, count); }
    await browser.until('reset to 420 by the double-click', `${now('chat')} === 420`, 3000);
    assert.equal(await browser.evaluate('String(getSelection())'), '', 'the double-click selects nothing');
    const reset = await browser.evaluate(rect(DIVIDER('chat')));
    from.x = reset.x + reset.w / 2;
    await mouse('mouseMoved', from.x, from.y); await mouse('mousePressed', from.x, from.y);
    await mouse('mouseMoved', 400, from.y);
    await browser.until('400 wide while held', `${now('chat')} === 400`, 3000);
    await mouse('mouseMoved', 150, from.y);
    const held = { release: () => mouse('mouseReleased', 150, from.y) };
    await browser.until('the hint', `!!${q('[data-testid=dock-hint-chat]')} && /Release to float/.test(${q('[data-testid=dock-hint-chat]')}.innerText)`, 3000);
    assert.equal(await browser.evaluate(placement('chat')), 'docked', 'still docked while held');
    await held.release();
    await browser.until('floating, as AmbientChat', `${placement('chat')} === 'floating' && !!${q('[data-boring=ambient-chat]')} && !${q('[data-boring=pi-chat]')}`, 10000);
    const journal = await browser.evaluate(rect('[data-boring=dock-main]'));
    assert.ok(journal.x < 2 && Math.round(journal.w) === 1500, `the app takes the full width: ${JSON.stringify(journal)}`);
    await browser.until('the draft in the floating composer', `${INPUT}?.value === 'Draft about the market'`, 5000);
    assert.equal(await browser.evaluate(`${q('[data-testid=dock-hint-chat]')}`), null, 'the hint is gone');
    await pause(400);
    await browser.screenshot('dock-app-floating.png');
  });

  await step('the floating window\'s grip moves it, and the minimised pill can be dragged', async () => {
    const before = await browser.evaluate(rect('[data-testid=ambient-surface]'));
    await dragFrom('[data-testid=ambient-grip]', { x: 700, y: 300 });
    const moved = await browser.evaluate(rect('[data-testid=ambient-surface]'));
    assert.ok(Math.abs(moved.x - before.x) > 100 && Math.abs(moved.y - before.y) > 100, `the window moved ${JSON.stringify({ before, moved })}`);
    // Minimise: window to bar, bar to pill.
    await browser.click(q('[data-testid=ambient-minimize]'));
    await browser.until('the bar', `${STATE} === 'bar'`, 5000);
    await browser.click(q('[data-testid=ambient-minimize]'));
    await browser.until('a pill', `${STATE} === 'minimized'`, 5000);
    const pill = await browser.evaluate(rect('[data-testid=ambient-pill-box]'));
    await dragFrom('[data-testid=ambient-pill]', { x: 300, y: 600 });
    const pillMoved = await browser.evaluate(rect('[data-testid=ambient-pill-box]'));
    assert.ok(Math.abs(pillMoved.x - pill.x) > 100 || Math.abs(pillMoved.y - pill.y) > 100, `the pill moved ${JSON.stringify({ pill, pillMoved })}`);
    assert.equal(await browser.evaluate(STATE), 'minimized', 'a drag does not restore the pill');
    await browser.click(q('[data-testid=ambient-pill]'));
    await browser.until('the bar', `${STATE} === 'bar'`, 5000);
    await browser.click(q('[data-testid=ambient-title]'));
    await browser.until('the window', `${STATE} === 'expanded'`, 5000);
  });

  await step('the Dock button re-attaches the chat at its last width', async () => {
    await browser.click(q('[data-testid=ambient-dock]'));
    await browser.until('docked', `${placement('chat')} === 'docked' && !${q('[data-boring=ambient-chat]')} && !!${q('[data-boring=pi-chat]')}`, 10000);
    assert.equal(await browser.evaluate(now('chat')), 400, 'the last width above the threshold');
    await live();
    assert.equal(await browser.evaluate(`${INPUT}?.value`), 'Draft about the market', 'the draft is still there');
  });

  await step('Alt+ArrowLeft on the divider floats the chat', async () => {
    await focusDivider('chat');
    await browser.press('ArrowLeft', { alt: true });
    await browser.until('floating', `${placement('chat')} === 'floating' && !!${q('[data-boring=ambient-chat]')}`, 10000);
    await browser.click(q('[data-testid=ambient-dock]'));
    await browser.until('docked again', `${placement('chat')} === 'docked' && !!${q('[data-boring=pi-chat]')}`, 10000);
  });

  await step('the files dock opens from the chat header and closes by dragging below its threshold', async () => {
    await live();
    await browser.click(q('[data-testid=chat-action-files]'));
    await browser.until('files docked on the right', `${placement('files')} === 'docked'`, 5000);
    const files = await browser.evaluate(rect('[data-dock=files]')), chat = await browser.evaluate(rect('[data-dock=chat]'));
    assert.ok(Math.round(files.w) === 320 && Math.round(files.right) === 1500 && chat.x === 0, JSON.stringify({ files, chat }));
    assert.equal(await browser.evaluate(`${q('[data-testid=files]')}.innerText.includes('lentil-soup.md')`), true);
    await pause(300);
    await browser.screenshot('dock-app-files.png');
    // The right dock's divider is on its left edge: dragging towards the right edge narrows it.
    const held = await browser.drag(q(DIVIDER('files')), 1450, { release: false });
    await browser.until('the close hint', `/Release to close/.test(${q('[data-testid=dock-hint-files]')}?.innerText ?? '')`, 3000);
    await held.release();
    await browser.until('closed', `${placement('files')} === 'closed' && !${q('[data-testid=dock-divider-files]')}`, 5000);
    assert.equal(await browser.evaluate(`Math.round(${q('[data-boring=dock-main]')}.getBoundingClientRect().right)`), 1500);
    // Reopened from the app's own button (useDock), at the last width above the threshold (the drag passed minWidth, 240, on the way).
    await browser.click(q('[data-testid=journal-files]'));
    await browser.until('open again', `${placement('files')} === 'docked' && ${now('files')} === 240`, 5000);
    await browser.click(q('[data-testid=files-close]'));
    await browser.until('closed by its own button', `${placement('files')} === 'closed'`, 5000);
  });

  await step('phone: the chat floats without a Dock button, the files dock is a full-screen sheet, no horizontal scroll', async () => {
    await browser.emulate('phone');
    await browser.until('narrow layout', `innerWidth === 390 && ${placement('chat')} === 'floating'`, 10000);
    await browser.until('the floating chat', `!!${q('[data-boring=ambient-chat]')}`, 10000);
    assert.equal(await browser.evaluate(`${q('[data-testid=ambient-dock]')}`), null, 'no Dock button on a phone');
    assert.equal(await browser.evaluate(`!!${q('[data-testid=dock-divider-chat]')}`), false);
    await pause(400);
    assert.ok(await browser.evaluate(noOverflow), 'no horizontal scroll with the chat');
    await browser.screenshot('dock-app-phone-chat.png');
    await browser.tap(q('[data-testid=ambient-minimize]'));
    await browser.until('the bar', `${STATE} === 'bar'`, 5000);
    await browser.tap(q('[data-testid=ambient-minimize]'));
    await browser.until('the pill, the app reachable', `${STATE} === 'minimized'`, 5000);
    await browser.tap(q('[data-testid=journal-files]'));
    await browser.until('the sheet', `${placement('files')} === 'sheet'`, 5000);
    await pause(400);
    const sheet = await browser.evaluate(rect('[data-dock=files]'));
    assert.deepEqual([sheet.x, sheet.y, sheet.w, sheet.h], [0, 0, 390, 844], 'full screen');
    assert.ok(await browser.evaluate(noOverflow), 'no horizontal scroll with the sheet');
    await browser.screenshot('dock-app-phone.png');
    await browser.tap(q('[data-testid=files-close]'));
    await browser.until('the sheet closed', `${placement('files')} === 'closed'`, 5000);
    await browser.emulate('desktop');
  });

  assert.deepEqual(browser.problems, [], 'no page errors');
  console.log(`dock-app journey passed. Screenshots in ${evidence}`);
} finally {
  await browser?.close();
  await app.close();
}
