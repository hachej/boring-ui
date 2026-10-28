// Board-by-board comparison (PM spec rule 1): drive the fixture into D2, D3, D6 and the C7 card at the mockup viewport (2×),
// then place each shot beside the exported mockup PNG. Usage: MOCKUPS=<pm-spec>/mockups/png CHROMIUM=… node examples/task-board/compare.mjs
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { launch, pause } from '@hachej/boring-testing/browser';
import { startTaskBoard } from './server.mjs';

const mockups = resolve(process.env.MOCKUPS ?? '../_work/pm-spec/mockups/png');
const out = resolve(process.env.COMPARE_OUT ?? '.agent-handoff/d417/compare');
const raw = resolve('.cache/evidence/d417/compare'); mkdirSync(raw, { recursive: true }); mkdirSync(out, { recursive: true });
const app = await startTaskBoard(); let browser;
const detail = 'document.querySelector("[data-task-detail=\\"D-201\\"]")';
const viewport = (width, height) => browser.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 2, mobile: width < 500 });
const visit = async (query, ready) => { await browser.send('Page.navigate', { url: `${app.url}${query}` }); await browser.until(`ready ${query}`, `document.readyState === 'complete' && !!(${ready})`, 30000); await pause(500); };
const theme = async mode => { await browser.evaluate(`document.documentElement.classList.toggle('dark', ${mode === 'dark'})`); await pause(300); };
const shots = [];
const shoot = async (board, mode) => { const name = `${board}-${mode}.png`; await browser.screenshot(name); shots.push({ board, mode, file: resolve(raw, name) }); };
try {
  browser = await launch('about:blank', { evidence: raw });
  await viewport(1440, 900);
  for (const mode of ['light', 'dark']) {
    // D2: the PM's present(task) opens D-201 over the unchanged board.
    await visit('', '!!document.querySelector("aside textarea") && !!document.querySelector("[data-task-open=\\"D-201\\"]")');
    await theme(mode);
    await browser.type('document.querySelector("aside textarea")', "What's waiting on me?"); await browser.press('Enter');
    await browser.until('present opened D-201', `!!${detail}`, 20000);
    await browser.until('PM reply', `document.body.textContent.includes('I opened D-201 on the right.')`, 20000);
    await browser.evaluate('document.activeElement?.blur()'); await pause(400);
    await shoot('D2-StudioTasks', mode);
    // D6: the mockup file opens 760px wide over the detail.
    await browser.click(`${detail}.querySelector('[data-task-file$="meal-card.html"]')`);
    await browser.until('html mockup viewer', '!!document.querySelector("[data-testid=file-viewer][data-kind=html]")', 20000); await pause(1200);
    await shoot('D6-StudioViewer', mode);
    // D3: conversation collapsed to the ambient composer, detail still open.
    await visit('?layout=ambient&task=D-201', `${detail} && document.querySelector('[data-testid=composer-input]')`);
    await theme(mode); await browser.evaluate('document.activeElement?.blur()'); await pause(400);
    await shoot('D3-StudioAmbient', mode);
  }
  await viewport(390, 844);
  for (const mode of ['light', 'dark']) {
    await visit('?view=compact', 'document.querySelector("[data-compact-card]")');
    await theme(mode);
    await shoot('C7-FinalThread', mode);
  }
  // Side by side: this PR on the left, the immutable mockup export on the right, both at their exported 2× size.
  for (const { board, mode, file } of shots) {
    const mockup = resolve(mockups, `${board}.png`);
    const phone = board.startsWith('C');
    const [w, h] = phone ? [390, 844] : [1440, 900];
    const html = resolve(raw, `${board}-${mode}.html`);
    writeFileSync(html, `<!doctype html><body style="margin:0;background:#888;font:600 14px system-ui;color:#fff"><div style="display:flex;gap:16px;padding:8px">${[['This PR', file], ['Mockup', mockup]].map(([label, src]) => `<figure style="margin:0"><figcaption style="height:22px">${label} · ${board} · ${mode}</figcaption><img src="${pathToFileURL(src)}" style="display:block;width:${w}px;height:${h}px"></figure>`).join('')}</div></body>`);
    await browser.send('Emulation.setDeviceMetricsOverride', { width: w * 2 + 32, height: h + 46, deviceScaleFactor: phone ? 2 : 1, mobile: false });
    await browser.send('Page.navigate', { url: pathToFileURL(html).href }); await browser.until('images', '[...document.images].every(image => image.complete && image.naturalWidth > 0)');
    writeFileSync(resolve(out, `${board}-${mode}.png`), Buffer.from((await browser.send('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
    console.log(`compare ${board}-${mode}.png`);
  }
} finally { await browser?.close(); await app.close(); }
