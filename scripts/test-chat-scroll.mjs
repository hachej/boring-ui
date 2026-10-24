// The transcript at scale, on a fictional 500-message conversation in a real Chromium:
// 1. Scrolling all of it with the wheel (top and back) renders no message again, gives the scroller one item per run of
//    rows, and has no long task over BUDGET_MS (1× CPU; CPU=4 throttles like a slow phone and only reports).
// 2. With the default paging (60, then 40), every page revealed at the top keeps the row the reader sees where it was.
// Evidence in .cache/evidence/chat-scroll. BUDGET_MS can be raised on a shared, loaded machine; CI keeps 50.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { launch, pause } from '@hachej/boring-testing/browser';
import { startLongChat } from '../examples/long-chat/server.mjs';

const MESSAGES = 500, CHUNK = 20, BUDGET_MS = Number(process.env.BUDGET_MS ?? 50), cpu = Number(process.env.CPU ?? 1);
const evidence = process.env.CHAT_SCROLL_EVIDENCE ?? '.cache/evidence/chat-scroll';
mkdirSync(evidence, { recursive: true });
const scroll = `document.querySelector('[data-testid=transcript-scroll]')`;
const rows = `document.querySelectorAll('[data-testid=transcript] [data-row-key]').length`;
const app = await startLongChat({ messages: MESSAGES });
let browser;
try {
  browser = await launch('about:blank', { evidence });
  await browser.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });

  // 1. Every message mounted (paging.first = 500), then the wheel from the bottom to the top and back.
  await browser.send('Page.navigate', { url: `${app.url}?first=${MESSAGES}` });
  await browser.until(`${MESSAGES} messages mounted`, `${rows} >= ${MESSAGES}`, 60000);
  await pause(500);
  const items = await browser.evaluate(`document.querySelector('[data-testid=transcript]').querySelectorAll(':scope > [data-message-id]').length`);
  assert.ok(items <= Math.ceil(MESSAGES / CHUNK) + 1, `the scroller measures runs of rows, not each row: ${items} items for ${MESSAGES} messages`);
  if (cpu > 1) await browser.send('Emulation.setCPUThrottlingRate', { rate: cpu });
  await browser.evaluate(`(() => {
    window.__longTasks = []; new PerformanceObserver(list => { for (const entry of list.getEntries()) window.__longTasks.push(Math.round(entry.duration)); }).observe({ type: 'longtask' });
    window.__textRenders = 0;
  })()`);
  const box = await browser.evaluate(`(() => { const r = ${scroll}.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, height: ${scroll}.scrollHeight }; })()`);
  const steps = Math.ceil(box.height / 600) + 2;
  for (const direction of [-1, 1]) for (let step = 0; step < steps; step++) { await browser.wheel(box.x, box.y, direction * 600); await pause(16); }
  await pause(300);
  const longTasks = await browser.evaluate('window.__longTasks');
  const scrolled = { messages: MESSAGES, cpu, items, wheelSteps: steps * 2, scrollHeight: box.height, longTasks, worst: Math.max(0, ...longTasks), total: longTasks.reduce((sum, ms) => sum + ms, 0),
    textRenders: await browser.evaluate('window.__textRenders'), reachedBottom: await browser.evaluate(`${scroll}.scrollHeight - ${scroll}.scrollTop - ${scroll}.clientHeight < 4`) };
  if (cpu > 1) await browser.send('Emulation.setCPUThrottlingRate', { rate: 1 });

  // 2. The kit's paging: reveal every page from the top and check the reader's row after each one.
  await browser.send('Page.navigate', { url: app.url });
  await browser.until('the first page', `${rows} === 60`, 60000);
  await pause(500);
  const pages = [];
  for (let count = 60; count < MESSAGES;) {
    const before = await browser.evaluate(`(() => {
      const viewport = ${scroll}; viewport.scrollTop = 120;
      const top = viewport.getBoundingClientRect().top;
      const row = [...viewport.querySelectorAll('[data-row-key]')].find(node => node.getBoundingClientRect().bottom > top + 1);
      return { key: row.dataset.rowKey, offset: row.getBoundingClientRect().top - top };
    })()`);
    const next = await browser.until(`a page above ${count} rows`, `${rows} > ${count} && ${rows}`, 20000);
    await pause(200);
    const offset = await browser.evaluate(`(() => { const viewport = ${scroll}; const row = viewport.querySelector('[data-row-key="${before.key}"]'); return row.getBoundingClientRect().top - viewport.getBoundingClientRect().top; })()`);
    pages.push({ rows: next, anchor: before.key, before: Math.round(before.offset), after: Math.round(offset) });
    count = next;
  }
  const report = { scrolled, paging: pages };
  writeFileSync(join(evidence, `scroll-${cpu}x.json`), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ...scrolled, longTasks: undefined, pages: pages.map(page => `${page.rows}:${page.after - page.before}`).join(' ') }));

  assert.equal(scrolled.textRenders, 0, 'scrolling renders no message again');
  assert.ok(scrolled.reachedBottom, 'the wheel reaches the newest message again');
  assert.deepEqual(pages.filter(page => Math.abs(page.after - page.before) > 3), [], 'each revealed page keeps the row the reader sees in place');
  assert.equal(pages.at(-1).rows, MESSAGES, 'paging reaches the first message');
  if (cpu === 1) assert.ok(scrolled.worst <= BUDGET_MS, `no long task over ${BUDGET_MS} ms while scrolling ${MESSAGES} messages: ${JSON.stringify(longTasks)}`);
} finally {
  await browser?.close(); await app.close();
}
