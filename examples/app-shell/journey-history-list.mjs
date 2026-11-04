// Real-browser journey (scripted model, no key): the conversation list in every place it is drawn, on a computer (1400x900) and a phone (390x844).
// With about 3 fictional conversations it records the sheet and rows (few-conversations.json, to compare across versions: a short list must not
// change). With 50 the list scrolls inside its sheet: no row is drawn or takes a click outside it, the last row can be reached and picked, and a real
// click on the message box lands in it. The workspace bar's sheet clears the box at 1400x900. The panels sharing that sheet (Library, host panels) are
// measured too. happy-dom has no layout, so this needs the browser. Every check runs on a fresh page and after a failure, so a failing run names them all.
// Screenshots go to .cache/evidence/history-list/.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launch, pause, q, qa } from '@hachej/boring-testing/browser';

process.env.STUDIO_MODEL = 'scripted';
const { startAppShell } = await import('./server.mjs');
const evidence = process.env.APP_EVIDENCE ?? '.cache/evidence/history-list';
mkdirSync(evidence, { recursive: true });

const COMPUTER = { width: 1400, height: 900, deviceScaleFactor: 1, mobile: false };
const WORKSPACE_BAR = q('[data-testid=workspace-bar-history]'), CHAT_HEADER = q('[data-testid=history-open]'), SESSIONS_TOGGLE = q('[data-testid=sessions-toggle]');
// The sessions pane keeps the test id `conversations` beside the chat's sheet, which is the dialog.
const CHAT_SHEET = '[data-testid=conversations][role=dialog]';
const PLACES = [
  { name: 'computer-workspace-bar', query: 'app=pm&embedded', sheet: '[data-testid=workspace-history]', opener: WORKSPACE_BAR, shortSheet: true, clearsBox: true },
  { name: 'computer-chat-header', query: 'app=pm&popover-history', sheet: CHAT_SHEET, opener: CHAT_HEADER, shortSheet: true },
  { name: 'computer-sessions-column', query: 'app=pm', sheet: '[data-testid=conversations]', staysOpen: true },
  { name: 'phone-workspace-bar', phone: true, query: 'app=pm&embedded', sheet: '[data-testid=workspace-history]', opener: WORKSPACE_BAR },
  { name: 'phone-chat-header', phone: true, query: 'app=pm&popover-history', sheet: CHAT_SHEET, opener: CHAT_HEADER },
  { name: 'phone-sessions-drawer', phone: true, query: 'app=pm', sheet: '[data-testid=conversations]', opener: SESSIONS_TOGGLE },
];

const directory = mkdtempSync(join(tmpdir(), 'boring-history-list-'));
const app = await startAppShell({ directory });
const failed = [];
let browser;
let seeded = 0;
const seedTo = async count => {
  while (seeded < count) {
    seeded++;
    const created = await fetch(new URL('/api/conversations?op=create', app.url), { method: 'POST', headers: { authorization: `Bearer ${app.token}`, 'content-type': 'application/json' }, body: JSON.stringify({ title: `Fictional walk ${String(seeded).padStart(2, '0')}` }) });
    assert.equal(created.status, 200, `seed conversation ${seeded}`);
  }
};
const check = async (name, run) => {
  try { await run(); console.log(`ok  ${name}`); }
  catch (error) { failed.push(name); console.log(`FAIL ${name}: ${String(error.message).split('\n')[0]}`); }
};

try {
  await seedTo(2);
  browser = await launch(app.url, { evidence });
  const { send } = browser;

  const goTo = async place => {
    if (place.phone) await browser.emulate('phone');
    else { await browser.emulate('desktop'); await send('Emulation.setDeviceMetricsOverride', COMPUTER); }
    await browser.evaluate('window.__leaving = true');
    await send('Page.navigate', { url: `${app.url}?${place.query}` });
    await browser.until('the message box', `!window.__leaving && !!${q('[data-testid=composer-input]')} && !${q('[data-testid=composer-input]')}.disabled && !${q('[data-testid=connecting]')}`, 30000);
  };
  const press = (place, selector) => place.phone ? browser.tap(selector) : browser.click(selector);
  const rowsOf = place => qa(`${place.sheet} [data-testid=conversation-row]`);
  const viewportOf = place => q(`${place.sheet} [data-slot=scroll-area-viewport]`);
  const BOX = `${q('[data-testid=composer-input]')}.closest('[data-slot=input-group]')`;
  /** A fresh page with the list open and settled. */
  const open = async (place, rows) => {
    await goTo(place);
    if (place.opener) await press(place, place.opener);
    await browser.until('the list in its sheet', `${rowsOf(place)}.length >= ${rows}`, 10000);
    await pause(900);
  };

  /** The sheet and rows as drawn, to compare across versions. */
  const few = async place => {
    await open(place, 2);
    await browser.screenshot(`${place.name}-few.png`);
    return browser.evaluate(`(() => {
      const whole = rect => ({ x: rect.x, y: rect.y, width: rect.width, height: rect.height });
      return { sheet: whole(${q(place.sheet)}.getBoundingClientRect()), rows: ${rowsOf(place)}.map(row => whole(row.getBoundingClientRect())), list: whole(${viewportOf(place)}.getBoundingClientRect()) };
    })()`);
  };

  /** Where the list sits against its sheet, and what the browser hits where a row or the message box is drawn. */
  const measure = place => browser.evaluate(`(() => {
    const sheet = ${q(place.sheet)}.getBoundingClientRect(), viewport = ${viewportOf(place)}, box = viewport.getBoundingClientRect(), composer = ${BOX}.getBoundingClientRect();
    const inSheet = (x, y) => x >= sheet.left && x <= sheet.right && y >= sheet.top && y <= sheet.bottom;
    const onScreen = (x, y) => x >= 0 && y >= 0 && x < innerWidth && y < innerHeight;
    const rowAt = (x, y) => !!document.elementFromPoint(x, y)?.closest('[data-testid=conversation-row]');
    const rows = ${rowsOf(place)};
    const escaped = rows.filter(row => { const r = row.getBoundingClientRect(), x = r.x + r.width / 2, y = r.y + r.height / 2; return !inSheet(x, y) && onScreen(x, y) && rowAt(x, y); }).length;
    let overComposer = 0;
    for (let i = 1; i < 12; i++) for (let j = 1; j < 4; j++) { const x = composer.left + composer.width * i / 12, y = composer.top + composer.height * j / 4; if (!inSheet(x, y) && onScreen(x, y) && rowAt(x, y)) overComposer++; }
    const overlapX = Math.min(sheet.right, composer.right) - Math.max(sheet.left, composer.left), overlapY = Math.min(sheet.bottom, composer.bottom) - Math.max(sheet.top, composer.top);
    return { rows: rows.length, sheetTop: sheet.top, sheetBottom: sheet.bottom, sheetHeight: sheet.height, boxTop: composer.top, boxBottom: composer.bottom, sheetOverBox: overlapX > 0 && overlapY > 0 ? { width: overlapX, height: overlapY } : null, listTop: box.top, listBottom: box.bottom, listHeight: viewport.clientHeight, scrollHeight: viewport.scrollHeight, escaped, overComposer };
  })()`);

  const inside = async place => {
    await open(place, 50);
    await browser.screenshot(`${place.name}.png`);
    const seen = await measure(place);
    console.log(`    ${place.name} ${JSON.stringify(seen)}`);
    assert.ok(seen.rows >= 50, `50 rows: ${seen.rows}`);
    assert.equal(seen.escaped, 0, 'rows that take a click outside the sheet');
    assert.equal(seen.overComposer, 0, 'points of the message box where a row takes the click');
    assert.ok(seen.listBottom <= seen.sheetBottom + 1, `the list ends inside the sheet: ${seen.listBottom} > ${seen.sheetBottom}`);
    assert.ok(seen.scrollHeight > seen.listHeight, `the list scrolls: ${seen.scrollHeight} <= ${seen.listHeight}`);
  };

  const clearsBox = async place => {
    await open(place, 50);
    const seen = await measure(place);
    assert.equal(seen.sheetOverBox, null, `the sheet ends at ${seen.sheetBottom}, the message box starts at ${seen.boxTop}`);
  };

  /** One match keeps a sheet that fits it, with the row in full view: the list does not collapse, and does not hold the sheet open either. */
  const shortList = async place => {
    await open(place, 50);
    if (await browser.evaluate(`!${q(`${place.sheet} [data-testid=conversation-search]`)}`)) await press(place, q(`${place.sheet} [data-testid=conversation-search-open]`));
    await browser.type(q(`${place.sheet} [data-testid=conversation-search]`), 'Fictional walk 07');
    await browser.until('one match', `${rowsOf(place)}.length === 1`, 8000);
    await pause(500);
    const seen = await browser.evaluate(`(() => { const row = ${rowsOf(place)}[0].getBoundingClientRect(), viewport = ${viewportOf(place)}, box = viewport.getBoundingClientRect(), sheet = ${q(place.sheet)}.getBoundingClientRect(); return { rowHeight: row.height, rowTop: row.top, rowBottom: row.bottom, listTop: box.top, listBottom: box.bottom, listHeight: viewport.clientHeight, sheetHeight: sheet.height }; })()`);
    console.log(`    ${place.name} one match ${JSON.stringify(seen)}`);
    assert.ok(seen.listHeight >= seen.rowHeight && seen.rowTop >= seen.listTop - 1 && seen.rowBottom <= seen.listBottom + 1, 'the row is in full view');
    if (place.shortSheet) assert.ok(seen.sheetHeight < 320, `a short list keeps a short sheet: ${seen.sheetHeight}`);
  };

  /** A person's wheel or finger brings the last row into the sheet; picking it opens that conversation. */
  const lastRow = async place => {
    await open(place, 50);
    const last = `${rowsOf(place)}.at(-1)`;
    const reached = `(() => { const row = ${last}.getBoundingClientRect(), box = ${viewportOf(place)}.getBoundingClientRect(), sheet = ${q(place.sheet)}.getBoundingClientRect(); return row.top >= box.top && row.bottom <= box.bottom + 1 && row.bottom <= sheet.bottom + 1 && row.bottom <= innerHeight; })()`;
    const centre = await browser.evaluate(`(() => { const box = ${viewportOf(place)}.getBoundingClientRect(); return { x: box.left + box.width / 2, top: box.top + 20, y: box.top + box.height / 2, bottom: Math.min(box.bottom, innerHeight) - 20 }; })()`);
    for (let i = 0; i < 60 && !await browser.evaluate(reached); i++) {
      if (place.phone) {
        await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: centre.x, y: centre.bottom }] });
        for (let step = 1; step <= 8; step++) { await send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: centre.x, y: centre.bottom + (centre.top - centre.bottom) * step / 8 }] }); await pause(16); }
        await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      } else await browser.wheel(centre.x, centre.y, 600);
      await pause(120);
    }
    assert.ok(await browser.evaluate(reached), 'the last row is reached by scrolling');
    assert.ok(await browser.evaluate(`${viewportOf(place)}.scrollTop > 0`), 'the list itself scrolled');
    await browser.screenshot(`${place.name}-scrolled.png`);
    const id = await browser.evaluate(`${last}.dataset.conversationId`);
    await press(place, last);
    await browser.until('the last row opens its conversation', `${q('[data-testid=app]')}.dataset.conversation === ${JSON.stringify(id)}`, 10000);
    if (!place.staysOpen) await browser.until('the sheet closes', `!${q(place.sheet)}`, 5000);
  };

  /** With History open, real clicks: where the rows used to be drawn the box takes the press (when the box reaches below the sheet there), and in the text field the cursor lands and words go in. */
  const clickBox = async place => {
    const pressAt = async point => {
      await browser.evaluate(`document.addEventListener('mousedown', event => { window.__pressed = { inBox: !!event.target.closest('[data-slot=input-group]'), onRow: !!event.target.closest('[data-testid=conversation-row]') }; }, { capture: true, once: true })`);
      for (const type of ['mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type, x: point.x, y: point.y, button: 'left', clickCount: 1 });
      await pause(300);
      return browser.evaluate(`({ ...window.__pressed, focused: document.activeElement === ${q('[data-testid=composer-input]')} })`);
    };
    await open(place, 50);
    const underRows = await browser.evaluate(`(() => {
      const sheet = ${q(place.sheet)}.getBoundingClientRect(), box = ${BOX}.getBoundingClientRect(), x = sheet.left + 40, y = box.bottom - 12;
      return x > box.left && x < box.right && y > sheet.bottom ? { x, y } : null;
    })()`);
    if (underRows) {
      const seen = await pressAt(underRows);
      console.log(`    ${place.name} press under the rows' column ${JSON.stringify(underRows)} ${JSON.stringify(seen)}`);
      assert.equal(seen.onRow, false, 'a row takes the click on the box');
      assert.equal(seen.inBox, true, 'the box takes the click');
      await open(place, 50);
    } else console.log(`    ${place.name} the box does not reach below the sheet in the rows' column`);
    const inField = await browser.evaluate(`(() => {
      const sheet = ${q(place.sheet)}.getBoundingClientRect(), input = ${q('[data-testid=composer-input]')}.getBoundingClientRect(), y = input.top + input.height / 2;
      const clear = y < sheet.top || y > sheet.bottom;
      return { x: clear && sheet.left > input.left && sheet.left + 40 < input.right ? sheet.left + 40 : input.left + 24, y };
    })()`);
    const seen = await pressAt(inField);
    console.log(`    ${place.name} click in the field ${JSON.stringify(inField)} ${JSON.stringify(seen)}`);
    assert.equal(seen.onRow, false, 'a row takes the click on the field');
    assert.equal(seen.focused, true, 'the cursor is in the box');
    await send('Input.insertText', { text: 'Fictional words' });
    await browser.until('typed in the box', `${q('[data-testid=composer-input]')}.value.includes('Fictional words')`, 3000);
  };

  /** A panel sharing the workspace bar's sheet: its content against the sheet's bounds, and what its own scroller does. */
  const sharedPanel = async ({ id, body, ready }) => {
    const place = { ...PLACES[0] };
    await goTo({ ...place, query: `${place.query}&bar-panels` });
    await browser.click(q(`[data-testid=workspace-bar-${id}]`));
    await browser.until(`the ${id} panel`, `!!${q(`[data-testid=workspace-${id}]`)} && (${ready})`, 15000);
    await pause(900);
    await browser.screenshot(`panel-${id}.png`);
    const describe = `(() => {
      const sheet = ${q(`[data-testid=workspace-${id}]`)}.getBoundingClientRect(), content = ${q(body)}, rect = content.getBoundingClientRect();
      const scroller = [content, ...content.querySelectorAll('*')].find(node => { const overflow = getComputedStyle(node).overflowY; return (overflow === 'auto' || overflow === 'scroll') && node.scrollHeight > node.clientHeight + 1; });
      return { sheetTop: sheet.top, sheetBottom: sheet.bottom, sheetHeight: sheet.height, contentBottom: rect.bottom, scrolls: !!scroller, scrollerBottom: scroller?.getBoundingClientRect().bottom ?? null, scrollTop: scroller?.scrollTop ?? null };
    })()`;
    const before = await browser.evaluate(describe);
    if (before.scrolls) { await browser.wheel(1140, (before.sheetTop + before.sheetBottom) / 2, 400); await pause(300); }
    const after = await browser.evaluate(describe);
    console.log(`    panel ${id} ${JSON.stringify(after)}`);
    return after;
  };

  // ---- About 3 conversations: numbers to compare across versions.
  const fewNumbers = {};
  for (const place of PLACES) await check(`${place.name}: few conversations`, async () => {
    fewNumbers[place.name] = await few(place);
    console.log(`    few ${place.name} ${JSON.stringify(fewNumbers[place.name])}`);
  });
  writeFileSync(join(evidence, 'few-conversations.json'), `${JSON.stringify(fewNumbers, null, 2)}\n`);

  // ---- 50 conversations.
  await seedTo(50);
  for (const place of PLACES) {
    await check(`${place.name}: the list stays inside its sheet`, () => inside(place));
    if (place.clearsBox) await check(`${place.name}: the sheet clears the message box`, () => clearsBox(place));
    await check(`${place.name}: one match`, () => shortList(place));
    await check(`${place.name}: the last row is reached and picked`, () => lastRow(place));
    // On a phone the sheet is modal over the whole page, so the box is not there to click.
    if (!place.phone) await check(`${place.name}: a real click lands in the message box`, () => clickBox(place));
  }

  // ---- The panels sharing the workspace bar's sheet.
  for (let i = 1; i <= 40; i++) writeFileSync(join(directory, 'workspace', `fictional-note-${String(i).padStart(2, '0')}.md`), `# Fictional note ${i}\n`);
  await check('library: a long tree scrolls inside the sheet', async () => {
    const seen = await sharedPanel({ id: 'library', body: '[data-testid=workspace-library] > div', ready: `${qa('[data-testid=workspace-library] [data-path]')}.length >= 20` });
    assert.ok(seen.scrolls, 'the tree scrolls');
    assert.ok(seen.scrollerBottom <= seen.sheetBottom + 1, `the tree ends inside the sheet: ${seen.scrollerBottom} > ${seen.sheetBottom}`);
    assert.ok(seen.scrollTop > 0, 'the wheel scrolled it');
  });
  await check('host panel: a short one fits', async () => {
    const seen = await sharedPanel({ id: 'host-short', body: '[data-testid=host-short-body]', ready: `!!${q('[data-testid=host-short-body]')}` });
    assert.ok(seen.contentBottom <= seen.sheetBottom + 1, `fits: ${seen.contentBottom} > ${seen.sheetBottom}`);
    assert.ok(seen.sheetHeight < 240, `the sheet hugs it: ${seen.sheetHeight}`);
  });
  await check('host panel: a long one that scrolls itself stays inside', async () => {
    const seen = await sharedPanel({ id: 'host-scrolls', body: '[data-testid=host-scrolls-body]', ready: `!!${q('[data-testid=host-scrolls-body]')}` });
    assert.ok(seen.scrolls, 'it scrolls');
    assert.ok(seen.scrollerBottom <= seen.sheetBottom + 1, `ends inside the sheet: ${seen.scrollerBottom} > ${seen.sheetBottom}`);
    assert.ok(seen.scrollTop > 0, 'the wheel scrolled it');
  });
  // Recorded, not asserted: a host panel with no scroller of its own spills out of the sheet, before and after this change.
  await check('host panel: a long one with no scroller of its own (recorded)', () => sharedPanel({ id: 'host-plain', body: '[data-testid=host-plain-body]', ready: `!!${q('[data-testid=host-plain-body]')}` }));

  assert.deepEqual(failed, [], `failed checks: ${failed.join(' | ')}`);
  console.log(browser.problems.length ? `page problems:\n${browser.problems.join('\n')}` : 'no page problems');
  assert.deepEqual(browser.problems.filter(problem => !/Failed to load resource/.test(problem)), []);
} finally { await browser?.close(); await app.close(); }
