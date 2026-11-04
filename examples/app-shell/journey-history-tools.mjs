// Real-browser journey (scripted model, no key) for History as a host mounts it from the agent layer: ConversationHistory, placement `above`, in
// PiChat `tools` (`?tools-history`). At 1280x800 with 5, 9 and 12 fictional conversations, with real wheel events: it prints the sheet's height, the list's
// height and scrollHeight and the page's scrollY; every row is reached inside the list; no row is drawn or takes a click outside the sheet; nothing behind
// the sheet moves, also once the list is at its top or bottom; the last row opens. 50 rows at 1400x900 is the same check in the same placement. The
// other places the list is drawn are in journey-history-list.mjs. Every check runs after a failure, so a failing run names them all.
// Screenshots go to .cache/evidence/history-tools/. Run: npm run app-shell:journey:history-tools
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launch, pause, q, qa } from '@hachej/boring-testing/browser';

process.env.STUDIO_MODEL = 'scripted';
const { startAppShell } = await import('./server.mjs');
const evidence = process.env.APP_EVIDENCE ?? '.cache/evidence/history-tools';
mkdirSync(evidence, { recursive: true });

const SHEET = '[data-testid=conversations][role=dialog]', OPENER = q('[data-testid=agent-layer-action-history]');
const CASES = [
  { rows: 5, width: 1280, height: 800, scrolls: false },
  { rows: 9, width: 1280, height: 800 },
  { rows: 12, width: 1280, height: 800, scrolls: true },
  { rows: 50, width: 1400, height: 900, scrolls: true },
];
const rowsOf = qa(`${SHEET} [data-testid=conversation-row]`), viewport = q(`${SHEET} [data-slot=scroll-area-viewport]`);

const directory = mkdtempSync(join(tmpdir(), 'boring-history-tools-'));
const app = await startAppShell({ directory });
const failed = [];
let browser;
const check = async (name, run) => {
  try { await run(); console.log(`ok  ${name}`); }
  catch (error) { failed.push(name); console.log(`FAIL ${name}: ${String(error.message).split('\n')[0]}`); }
};
const authorization = { authorization: `Bearer ${app.token}` };
const seedTo = async count => {
  const listed = await fetch(new URL('/api/conversations', app.url), { headers: authorization });
  assert.equal(listed.status, 200, 'list conversations');
  let have = (await listed.json()).conversations.length;
  while (have < count) {
    have++;
    const created = await fetch(new URL('/api/conversations?op=create', app.url), { method: 'POST', headers: { ...authorization, 'content-type': 'application/json' }, body: JSON.stringify({ title: `Fictional walk ${String(have).padStart(2, '0')}` }) });
    assert.equal(created.status, 200, `seed conversation ${have}`);
  }
};

// The numbers, and what the browser hits where each row is drawn.
const MEASURE = `(() => {
  const sheet = ${q(SHEET)}, panel = sheet.getBoundingClientRect(), list = ${viewport}, box = list.getBoundingClientRect(), rows = ${rowsOf};
  const round = value => Math.round(value * 10) / 10;
  const inPanel = (x, y) => x >= panel.left && x <= panel.right && y >= panel.top && y <= panel.bottom;
  const outside = rows.filter(row => {
    const r = row.getBoundingClientRect(), x = r.x + r.width / 2, y = r.y + r.height / 2;
    return !inPanel(x, y) && x >= 0 && y >= 0 && x < innerWidth && y < innerHeight && !!document.elementFromPoint(x, y)?.closest('[data-testid=conversation-row]');
  }).length;
  const moved = [...document.querySelectorAll('*')].filter(node => !sheet.contains(node) && node !== document.scrollingElement && (node.scrollTop > 0)).map(node => (node.dataset.testid ?? node.dataset.slot ?? node.tagName) + ':' + round(node.scrollTop));
  return { rows: rows.length, window: innerWidth + 'x' + innerHeight, popoverTop: round(panel.top), popoverBottom: round(panel.bottom), popoverHeight: round(panel.height), viewportHeight: list.clientHeight, viewportBottom: round(box.bottom), scrollHeight: list.scrollHeight, scrollTop: round(list.scrollTop), pageScrollY: round(scrollY), pageScrollHeight: document.scrollingElement.scrollHeight, movedBehind: moved, outside };
})()`;

try {
  browser = await launch(app.url, { evidence });
  const { send } = browser;

  const open = async ({ rows, width, height }) => {
    await seedTo(rows);
    await browser.emulate('desktop');
    await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
    await browser.evaluate('window.__leaving = true');
    await send('Page.navigate', { url: `${app.url}?tools-history` });
    await browser.until('the agent trigger', `!window.__leaving && !!${q('[data-testid=agent-trigger]')} && !${q('[data-testid=connecting]')}`, 30000);
    await browser.click(q('[data-testid=agent-trigger]'));
    await browser.until('the agent layer', `!!${OPENER}`, 10000);
    await pause(500);
    await browser.click(OPENER);
    await browser.until(`${rows} rows in the sheet`, `${rowsOf}.length === ${rows}`, 10000);
    await pause(900);
  };

  /** Real wheel events over the list, until `done` holds or the turns run out; the end of the list takes more of them, and each is read back. */
  const wheelTo = async (deltaY, done) => {
    const centre = await browser.evaluate(`(() => { const box = ${viewport}.getBoundingClientRect(); return { x: box.left + box.width / 2, y: box.top + Math.min(box.height, innerHeight - box.top) / 2 }; })()`);
    for (let turn = 0; turn < 60 && !await browser.evaluate(done); turn++) { await browser.wheel(centre.x, centre.y, deltaY); await pause(100); }
    for (let extra = 0; extra < 5; extra++) { await browser.wheel(centre.x, centre.y, deltaY); await pause(100); }
    await pause(300);
  };
  const lastInView = `(() => { const row = ${rowsOf}.at(-1).getBoundingClientRect(), box = ${viewport}.getBoundingClientRect(), panel = ${q(SHEET)}.getBoundingClientRect(); return row.top >= box.top - 1 && row.bottom <= box.bottom + 1 && row.bottom <= panel.bottom + 1 && row.bottom <= innerHeight; })()`;

  const still = (seen, what) => {
    assert.equal(seen.pageScrollY, 0, `${what}: the page moved`);
    assert.deepEqual(seen.movedBehind, [], `${what}: something behind the sheet moved`);
  };

  for (const entry of CASES) {
    const name = `${entry.rows} rows at ${entry.width}x${entry.height}`;
    await check(`${name}: stays inside its sheet`, async () => {
      await open(entry);
      await browser.screenshot(`rows-${entry.rows}-open.png`);
      const seen = await browser.evaluate(MEASURE);
      console.log(`    open ${name} ${JSON.stringify(seen)}`);
      assert.equal(seen.outside, 0, `rows drawn outside the sheet: ${seen.outside}`);
      assert.ok(seen.popoverTop >= 0 && seen.popoverBottom <= entry.height, `the sheet is on screen: ${seen.popoverTop} to ${seen.popoverBottom}`);
      assert.ok(seen.viewportBottom <= seen.popoverBottom + 1, `the list ends inside the sheet: ${seen.viewportBottom} > ${seen.popoverBottom}`);
      if (entry.scrolls === true) assert.ok(seen.scrollHeight > seen.viewportHeight, `the list scrolls: ${seen.scrollHeight} <= ${seen.viewportHeight}`);
      if (entry.scrolls === false) assert.ok(seen.scrollHeight <= seen.viewportHeight + 1, `a short list has nothing to scroll: ${seen.scrollHeight} > ${seen.viewportHeight}`);
      still(seen, 'on opening');
    });
    await check(`${name}: real wheel reaches the last row, nothing behind moves`, async () => {
      await open(entry);
      await wheelTo(100, lastInView);
      const bottom = await browser.evaluate(MEASURE);
      console.log(`    wheel down ${name} ${JSON.stringify(bottom)}`);
      await browser.screenshot(`rows-${entry.rows}-wheel-down.png`);
      assert.ok(await browser.evaluate(lastInView), 'the last row is reached inside the list');
      if (entry.scrolls === true) assert.ok(bottom.scrollTop > 0, 'the list itself scrolled');
      assert.equal(bottom.outside, 0, `rows drawn outside the sheet: ${bottom.outside}`);
      still(bottom, 'at the bottom of the list');
      await wheelTo(-100, `${viewport}.scrollTop === 0`);
      const top = await browser.evaluate(MEASURE);
      console.log(`    wheel up ${name} ${JSON.stringify(top)}`);
      assert.equal(top.scrollTop, 0, 'the list went back to its top');
      still(top, 'at the top of the list');
    });
    await check(`${name}: the last row opens`, async () => {
      await open(entry);
      await wheelTo(100, lastInView);
      const id = await browser.evaluate(`${rowsOf}.at(-1).dataset.conversationId`);
      await browser.click(`${rowsOf}.at(-1)`);
      await browser.until('the last row is picked', `String(window.__pickedConversation) === ${JSON.stringify(id)}`, 5000);
      await browser.until('the sheet closes', `!${q(SHEET)}`, 5000);
    });
  }

  assert.deepEqual(failed, [], `failed checks: ${failed.join(' | ')}`);
  console.log(browser.problems.length ? `page problems:\n${browser.problems.join('\n')}` : 'no page problems');
  assert.deepEqual(browser.problems.filter(problem => !/Failed to load resource/.test(problem)), []);
} finally { await browser?.close(); await app.close(); }
