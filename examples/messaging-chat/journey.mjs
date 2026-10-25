// PiChat `messageStyle`, in a real Chromium on a fictional French coaching conversation: `default` is today's look (no tail, no time);
// `messaging` has a primary bubble for me, a muted bubble for the reply, a tail on the first bubble of each run and the time inside.
// Light and dark, desktop and 390 px phone; no horizontal scroll. Screenshots go to MESSAGING_EVIDENCE (default .cache/evidence/messaging-chat).
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { launch, pause } from '@hachej/boring-testing/browser';
import { startMessagingChat } from './server.mjs';

const evidence = process.env.MESSAGING_EVIDENCE ?? '.cache/evidence/messaging-chat';
mkdirSync(evidence, { recursive: true });
const app = await startMessagingChat();
let browser;
try {
  browser = await launch('about:blank', { evidence });
  for (const [device, width, height, mobile] of [['desktop', 1280, 1000, false], ['phone', 390, 1200, true]]) {
    await browser.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 2, mobile });
    for (const style of ['default', 'messaging']) for (const mode of ['light', 'dark']) {
      await browser.send('Page.navigate', { url: `${app.url}?style=${style}&mode=${mode}` });
      await browser.until('the conversation is shown', `document.querySelectorAll('[data-testid=transcript] [data-row-key]').length >= 6`, 30000);
      await pause(600);
      const seen = await browser.evaluate(`(() => {
        const bg = element => getComputedStyle(element.querySelector('[data-slot=bubble-content]')).backgroundColor;
        const token = name => { const probe = document.createElement('i'); probe.style.backgroundColor = 'var(--' + name + ')'; document.body.append(probe); const value = getComputedStyle(probe).backgroundColor; probe.remove(); return value; };
        const user = document.querySelector('[data-role=user] [data-slot=bubble]'), reply = document.querySelector('[data-role=assistant] [data-slot=bubble]');
        const tails = [...document.querySelectorAll('[data-testid=bubble-tail]')].map(tail => tail.dataset.side);
        const scroller = document.scrollingElement;
        return { tails, times: document.querySelectorAll('[data-testid=message-time]').length, userBg: bg(user), replyBg: reply.querySelector('[data-slot=bubble-content]') ? bg(reply) : null,
          primary: token('primary'), muted: token('muted'), overflow: scroller.scrollWidth - scroller.clientWidth, userAlign: user.dataset.align, replyAlign: reply.dataset.align };
      })()`);
      const label = `${style} ${mode} ${device}`;
      assert.equal(seen.overflow, 0, `${label}: no horizontal scroll`);
      if (style === 'default') {
        assert.deepEqual(seen.tails, [], `${label}: no tail`); assert.equal(seen.times, 0, `${label}: no time in the bubbles`);
        assert.equal(seen.userBg, seen.muted, `${label}: my message is a muted bubble`);
      } else {
        assert.ok(seen.tails.includes('end') && seen.tails.includes('start'), `${label}: a tail on each side`);
        assert.ok(seen.tails.length < seen.times, `${label}: a tail only on the first bubble of a run (${seen.tails.length} tails, ${seen.times} times)`);
        assert.ok(seen.times >= 5, `${label}: the time is inside the bubbles`);
        assert.equal(seen.userBg, seen.primary, `${label}: my message is a primary bubble`); assert.equal(seen.replyBg, seen.muted, `${label}: the reply is a muted bubble`);
        assert.equal(seen.userAlign, 'end'); assert.equal(seen.replyAlign, 'start');
      }
      await browser.screenshot(`${style}-${mode}-${device}.png`);
    }
  }
  assert.deepEqual(browser.problems, [], 'no page errors');
  console.log('messaging chat: ok');
} finally {
  await browser?.close();
  await app.close();
}
