// Sending in a SharedChat channel, as the person feels it, in a real Chromium, at phone width and on a desktop, with a host that
// confirms a message only after DELAY_MS (a slow network, a cold host, a chain of services behind the source):
// 1. The reader is scrolled up to the top of a fictional conversation, types a message and presses Send.
// 2. Their message is in the transcript within ECHO_MS of the click (before the host answered), and the transcript is at its
//    bottom, showing it.
// 3. Once the host confirmed it, the message is there exactly once and the transcript is still at its bottom.
// Evidence (timings, positions, screenshots) in .cache/evidence/chat-send.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { launch, pause } from '@hachej/boring-testing/browser';
import { startLongChat } from '../examples/long-chat/server.mjs';

const DELAY_MS = Number(process.env.DELAY_MS ?? 1500), ECHO_MS = Number(process.env.ECHO_MS ?? 400), MESSAGES = 80;
const evidence = process.env.CHAT_SEND_EVIDENCE ?? '.cache/evidence/chat-send';
mkdirSync(evidence, { recursive: true });
const scroll = `document.querySelector('[data-testid=transcript-scroll]')`;
const gap = `(() => { const v = ${scroll}; return Math.round(v.scrollHeight - v.scrollTop - v.clientHeight); })()`;
const copies = text => `[...document.querySelectorAll('[data-testid=transcript] [data-role=user]')].filter(node => node.textContent.includes(${JSON.stringify(text)})).length`;
const app = await startLongChat({ messages: MESSAGES });
let browser;
const results = [];
try {
  browser = await launch('about:blank', { evidence });
  for (const surface of ['shared']) for (const device of ['phone', 'desktop']) {
    const label = `${surface} ${device}`;
    if (device === 'phone') await browser.emulate('phone');
    else { await browser.emulate('desktop'); await browser.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false }); }
    await browser.send('Page.navigate', { url: `${app.url}?messages=${MESSAGES}&sendDelay=${DELAY_MS}&shared` });
    await browser.until(`${label}: the conversation`, `document.querySelectorAll('[data-testid=transcript] [data-row-key]').length >= 20 && !document.querySelector('[data-testid=composer-input]')?.disabled`, 60000);
    await pause(500);
    // 1. Away from the bottom, as when reading back.
    await browser.evaluate(`${scroll}.scrollTop = 0`);
    await pause(300);
    const before = await browser.evaluate(gap);
    const text = `Fictional message from the ${label} at ${Date.now()}`;
    await browser.type(`document.querySelector('[data-testid=composer-input]')`, text);
    await browser.evaluate(`(() => {
      window.__echo = undefined;
      const observer = new MutationObserver(() => { if (${copies(text)} > 0 && window.__echo === undefined) { window.__echo = performance.now() - window.__sent; observer.disconnect(); } });
      observer.observe(document.body, { subtree: true, childList: true, characterData: true });
      document.querySelector('[data-testid=composer-submit]').addEventListener('click', () => { window.__sent = performance.now(); }, { capture: true, once: true });
    })()`);
    await browser.click(`document.querySelector('[data-testid=composer-submit]')`);
    // 2. Before the host confirmed it.
    await pause(ECHO_MS);
    const early = { echoMs: await browser.evaluate('window.__echo === undefined ? null : Math.round(window.__echo)'), copies: await browser.evaluate(copies(text)), gap: await browser.evaluate(gap) };
    await browser.screenshot(`${surface}-${device}-early.png`);
    // 3. After it.
    await pause(DELAY_MS + 1000);
    const late = { echoMs: await browser.evaluate('window.__echo === undefined ? null : Math.round(window.__echo)'), copies: await browser.evaluate(copies(text)), gap: await browser.evaluate(gap) };
    await browser.screenshot(`${surface}-${device}-late.png`);
    results.push({ surface, device, delayMs: DELAY_MS, gapBefore: before, early, late });
  }
  writeFileSync(join(evidence, 'results.json'), JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results, null, 2));
  for (const { surface, device, early, late } of results) {
    const label = `${surface} ${device}`;
    assert.equal(early.copies, 1, `${label}: the message is in the transcript ${ECHO_MS} ms after Send, before the host (${DELAY_MS} ms) confirmed it (echo after ${early.echoMs} ms)`);
    assert.ok(early.gap <= 4, `${label}: the transcript scrolled to the new message on Send (${early.gap}px from the bottom)`);
    assert.equal(late.copies, 1, `${label}: once confirmed, the message is there once`);
    assert.ok(late.gap <= 4, `${label}: still at the bottom once confirmed (${late.gap}px from the bottom)`);
  }
  assert.deepEqual(browser.problems, [], 'no page errors');
  console.log('chat send: ok');
} finally {
  await browser?.close();
  await app.close();
}
