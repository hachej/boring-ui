// Real-browser journey (scripted model, no key): 50 fictional conversations in every place the conversation list is drawn, on a computer
// (1400x900) and a phone (390x844). The list scrolls inside its sheet: no row is drawn or takes a click outside it, none lies over the message
// box, and the last row can be reached and picked. A short list keeps a short sheet. happy-dom has no layout, so this needs the browser.
// Every place is tried even after one fails, so a failing run names them all. Screenshots go to .cache/evidence/history-list/.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launch, pause, q, qa } from '@hachej/boring-testing/browser';

process.env.STUDIO_MODEL = 'scripted';
const { startAppShell } = await import('./server.mjs');
const evidence = process.env.APP_EVIDENCE ?? '.cache/evidence/history-list';
mkdirSync(evidence, { recursive: true });

const COMPUTER = { width: 1400, height: 900, deviceScaleFactor: 1, mobile: false };
const WORKSPACE_BAR = q('[data-testid=workspace-bar-history]'), CHAT_HEADER = q('[data-testid=history-open]'), SESSIONS_TOGGLE = q('[data-testid=sessions-toggle]');
const PLACES = [
  { name: 'computer-workspace-bar', query: 'app=pm&embedded', sheet: 'workspace-history', opener: WORKSPACE_BAR, shortSheet: true },
  { name: 'computer-chat-header', query: 'app=pm&popover-history', sheet: 'conversations', opener: CHAT_HEADER, shortSheet: true },
  { name: 'computer-sessions-column', query: 'app=pm', sheet: 'conversations', staysOpen: true },
  { name: 'phone-workspace-bar', phone: true, query: 'app=pm&embedded', sheet: 'workspace-history', opener: WORKSPACE_BAR },
  { name: 'phone-chat-header', phone: true, query: 'app=pm&popover-history', sheet: 'conversations', opener: CHAT_HEADER },
  { name: 'phone-sessions-drawer', phone: true, query: 'app=pm', sheet: 'conversations', opener: SESSIONS_TOGGLE },
];

const app = await startAppShell({ directory: mkdtempSync(join(tmpdir(), 'boring-history-list-')) });
const failed = [];
let browser;
try {
  for (let i = 1; i <= 50; i++) {
    const created = await fetch(new URL('/api/conversations?op=create', app.url), { method: 'POST', headers: { authorization: `Bearer ${app.token}`, 'content-type': 'application/json' }, body: JSON.stringify({ title: `Fictional walk ${String(i).padStart(2, '0')}` }) });
    assert.equal(created.status, 200, `seed conversation ${i}`);
  }
  browser = await launch(app.url, { evidence });
  const { send } = browser;

  const goTo = async place => {
    if (place.phone) await browser.emulate('phone');
    else { await browser.emulate('desktop'); await send('Emulation.setDeviceMetricsOverride', COMPUTER); }
    await send('Page.navigate', { url: `${app.url}?${place.query}` });
    await browser.until('the message box', `!!${q('[data-testid=composer-input]')} && !${q('[data-testid=composer-input]')}.disabled && !${q('[data-testid=connecting]')}`, 30000);
  };
  const press = (place, selector) => place.phone ? browser.tap(selector) : browser.click(selector);
  const sheetOf = place => `[data-testid=${place.sheet}]`;
  const rowsOf = place => qa(`${sheetOf(place)} [data-testid=conversation-row]`);
  const viewportOf = place => q(`${sheetOf(place)} [data-slot=scroll-area-viewport]`);

  /** Where the list sits against its sheet, and what the browser hits where a row or the message box is drawn. */
  const measure = place => browser.evaluate(`(() => {
    const sheet = ${q(sheetOf(place))}.getBoundingClientRect(), viewport = ${viewportOf(place)}, box = viewport.getBoundingClientRect(), composer = ${q('[data-testid=composer-input]')}.getBoundingClientRect();
    const inSheet = (x, y) => x >= sheet.left && x <= sheet.right && y >= sheet.top && y <= sheet.bottom;
    const onScreen = (x, y) => x >= 0 && y >= 0 && x < innerWidth && y < innerHeight;
    const rowAt = (x, y) => !!document.elementFromPoint(x, y)?.closest('[data-testid=conversation-row]');
    const rows = ${rowsOf(place)};
    const escaped = rows.filter(row => { const r = row.getBoundingClientRect(), x = r.x + r.width / 2, y = r.y + r.height / 2; return !inSheet(x, y) && onScreen(x, y) && rowAt(x, y); }).length;
    let overComposer = 0;
    for (let i = 1; i < 12; i++) for (let j = 1; j < 4; j++) { const x = composer.left + composer.width * i / 12, y = composer.top + composer.height * j / 4; if (!inSheet(x, y) && onScreen(x, y) && rowAt(x, y)) overComposer++; }
    return { rows: rows.length, sheetTop: sheet.top, sheetBottom: sheet.bottom, sheetHeight: sheet.height, listTop: box.top, listBottom: box.bottom, listHeight: viewport.clientHeight, scrollHeight: viewport.scrollHeight, escaped, overComposer };
  })()`);

  const inside = async place => {
    const seen = await measure(place);
    console.log(`    ${JSON.stringify(seen)}`);
    assert.ok(seen.rows >= 50, `50 rows: ${seen.rows}`);
    assert.equal(seen.escaped, 0, 'rows that take a click outside the sheet');
    assert.equal(seen.overComposer, 0, 'points of the message box where a row takes the click');
    assert.ok(seen.listBottom <= seen.sheetBottom + 1, `the list ends inside the sheet: ${seen.listBottom} > ${seen.sheetBottom}`);
    assert.ok(seen.scrollHeight > seen.listHeight, `the list scrolls: ${seen.scrollHeight} <= ${seen.listHeight}`);
  };

  /** One match keeps a sheet that fits it, with the row in full view: the list does not collapse, and does not hold the sheet open either. */
  const shortList = async place => {
    if (await browser.evaluate(`!${q(`${sheetOf(place)} [data-testid=conversation-search]`)}`)) await press(place, q(`${sheetOf(place)} [data-testid=conversation-search-open]`));
    const search = q(`${sheetOf(place)} [data-testid=conversation-search]`);
    await browser.type(search, 'Fictional walk 07');
    await browser.until('one match', `${rowsOf(place)}.length === 1`, 8000);
    await pause(500);
    const seen = await browser.evaluate(`(() => { const row = ${rowsOf(place)}[0].getBoundingClientRect(), viewport = ${viewportOf(place)}, box = viewport.getBoundingClientRect(), sheet = ${q(sheetOf(place))}.getBoundingClientRect(); return { rowHeight: row.height, rowTop: row.top, rowBottom: row.bottom, listTop: box.top, listBottom: box.bottom, listHeight: viewport.clientHeight, sheetHeight: sheet.height }; })()`);
    console.log(`    one match ${JSON.stringify(seen)}`);
    assert.ok(seen.listHeight >= seen.rowHeight && seen.rowTop >= seen.listTop - 1 && seen.rowBottom <= seen.listBottom + 1, 'the row is in full view');
    if (place.shortSheet) assert.ok(seen.sheetHeight < 320, `a short list keeps a short sheet: ${seen.sheetHeight}`);
    await browser.evaluate(`(() => { const e = ${search}; e.focus(); e.select(); })()`);
    await browser.press('Backspace');
    await browser.until('the whole list again', `${rowsOf(place)}.length >= 50`, 8000);
  };

  /** A person's wheel or finger brings the last row into the sheet; picking it opens that conversation. */
  const lastRow = async place => {
    const last = `${rowsOf(place)}.at(-1)`;
    const reached = `(() => { const row = ${last}.getBoundingClientRect(), box = ${viewportOf(place)}.getBoundingClientRect(), sheet = ${q(sheetOf(place))}.getBoundingClientRect(); return row.top >= box.top && row.bottom <= box.bottom + 1 && row.bottom <= sheet.bottom + 1 && row.bottom <= innerHeight; })()`;
    const centre = await browser.evaluate(`(() => { const box = ${viewportOf(place)}.getBoundingClientRect(); return { x: box.left + box.width / 2, top: box.top + 20, y: box.top + box.height / 2, bottom: Math.min(box.bottom, innerHeight) - 20 }; })()`);
    for (let i = 0; i < 60 && !await browser.evaluate(reached); i++) {
      if (place.phone) {
        await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: centre.x, y: centre.bottom }] });
        for (let step = 1; step <= 8; step++) { await send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: centre.x, y: centre.bottom + (centre.top - centre.bottom) * step / 8 }] }); await pause(16); }
        await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      } else await browser.wheel(centre.x, centre.y, 600);
      await pause(120);
    }
    assert.ok(await browser.evaluate(`${q(sheetOf(place))} && ${reached}`), 'the last row is reached by scrolling');
    assert.ok(await browser.evaluate(`${viewportOf(place)}.scrollTop > 0`), 'the list itself scrolled');
    await browser.screenshot(`${place.name}-scrolled.png`);
    const id = await browser.evaluate(`${last}.dataset.conversationId`);
    await press(place, last);
    await browser.until('the last row opens its conversation', `${q('[data-testid=app]')}.dataset.conversation === ${JSON.stringify(id)}`, 10000);
    if (!place.staysOpen) await browser.until('the sheet closes', `!${q(sheetOf(place))}`, 5000);
  };

  for (const place of PLACES) {
    try {
      await goTo(place);
      if (place.opener) await press(place, place.opener);
      await browser.until('the list in its sheet', `${rowsOf(place)}.length >= 50`, 10000);
      await pause(900);
      await browser.screenshot(`${place.name}.png`);
      await inside(place);
      await shortList(place);
      await lastRow(place);
      console.log(`ok  ${place.name}`);
    } catch (error) {
      failed.push(place.name);
      console.log(`FAIL ${place.name}: ${String(error.message).split('\n')[0]}`);
    }
  }
  assert.deepEqual(failed, [], `places where the list escapes or cannot be used: ${failed.join(', ')}`);
  console.log(browser.problems.length ? `page problems:\n${browser.problems.join('\n')}` : 'no page problems');
  assert.deepEqual(browser.problems.filter(problem => !/Failed to load resource/.test(problem)), []);
} finally { await browser?.close(); await app.close(); }
