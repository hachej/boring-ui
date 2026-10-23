import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { launch, pause, q } from '@hachej/boring-testing/browser';
import { auditSmallText } from './colour-audit.mjs';

const message = id => q(`[data-shared-message="${id}"]`);
/**
 * The block's story (`?story`) on a phone, light and dark, at 390 and 360: the WhatsApp layout, nothing of the block over a message,
 * 44px targets, AA small text, the room starting at the latest message and the « new messages » pill when scrolled up.
 */
export async function checkStory(url, { evidence }) {
  const results = [];
  mkdirSync(evidence, { recursive: true });
  for (const width of [390, 360]) for (const scheme of ['light', 'dark']) {
    const browser = await launch(`${url}?story`, { evidence });
    try {
      await browser.emulate('phone');
      await browser.send('Emulation.setDeviceMetricsOverride', { width, height: 780, deviceScaleFactor: 1, mobile: true });
      await browser.reload();
      await browser.until('story room', `!!${message('mine-2')}`);
      await browser.evaluate(`document.documentElement.classList.toggle('dark', ${scheme === 'dark'})`);
      await browser.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme }] });
      await pause(300);
      const layout = await browser.evaluate(`(() => {
        const viewport = document.querySelector('[data-testid=transcript-scroll]');
        const rect = e => e.getBoundingClientRect();
        const last = rect(${message('mine-2')}), view = rect(viewport);
        const bubbles = [...document.querySelectorAll('[data-shared-message] [data-slot=bubble]')].map(rect);
        // Anything of the block that is positioned over the room (sticky, fixed or absolute outside a bubble) must not cover a bubble.
        const chat = document.querySelector('[data-boring=pi-chat]');
        const floating = [...chat.querySelectorAll('*')].filter(e => ['sticky', 'fixed'].includes(getComputedStyle(e).position) || getComputedStyle(e).position === 'absolute' && !e.closest('[data-slot=bubble]') && !e.closest('[data-shared-message]') && e.getClientRects().length && rect(e).width > 1 && rect(e).height > 1 && viewport.contains(e));
        const covers = floating.flatMap(e => bubbles.filter(b => { const r = rect(e); return r.left < b.right && r.right > b.left && r.top < b.bottom && r.bottom > b.top; }).map(() => e.outerHTML.slice(0, 80)));
        const navigation = document.querySelector('[data-testid=transcript-navigation]');
        const targets = [...chat.querySelectorAll('[data-testid=composer] button, [data-testid=request-action], [data-testid=message-author-toggle], [data-testid=system-lines-toggle]')].filter(e => e.getClientRects().length)
          .map(e => ({ id: e.dataset.testid, height: Math.round(rect(e).height), width: Math.round(rect(e).width) })).filter(t => t.height < 44 || t.width < 44 && t.id !== 'request-action');
        return { atBottom: Math.abs(viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop) <= 2, lastVisible: last.bottom <= view.bottom + 1 && last.top >= view.top,
          covers, navigation: !!navigation, smallTargets: targets, overflow: document.documentElement.scrollWidth > innerWidth,
          tails: document.querySelectorAll('[data-testid=bubble-tail]').length, times: document.querySelectorAll('[data-slot=bubble-content] [data-testid=message-time]').length,
          roleLines: document.querySelectorAll('[data-testid=message-role]').length, layout: document.querySelector('[data-testid=composer]').dataset.layout,
          mic: !!document.querySelector('[data-testid=composer-when-empty] [data-testid=voice-message-record]'), send: !!document.querySelector('[data-testid=composer-submit]') };
      })()`);
      assert.equal(layout.atBottom, true, 'the room starts at the latest message');
      assert.equal(layout.lastVisible, true);
      assert.deepEqual(layout.covers, [], 'no block element covers a bubble');
      assert.equal(layout.navigation, false, 'no jump pill at the bottom');
      assert.deepEqual(layout.smallTargets, [], '44px touch targets');
      assert.equal(layout.overflow, false, `no horizontal scroll at ${width}`);
      assert.ok(layout.tails >= 4 && layout.times >= 6, JSON.stringify(layout));
      assert.equal(layout.roleLines, 0);
      assert.equal(layout.layout, 'pill'); assert.equal(layout.mic, true); assert.equal(layout.send, false);
      const contrast = await auditSmallText(browser);
      await browser.screenshot(`story-${width}-${scheme}.png`);
      // Scrolled up, a new message from someone else raises the pill below the list, never over it; the pill brings the reader back.
      await browser.evaluate(`document.querySelector('[data-testid=transcript-scroll]').scrollTop = 0`);
      await browser.until('jump pill', `!!${q('[data-testid=transcript-navigation]')}`);
      await browser.evaluate(`window.__SHARED__.emit({ type: 'message', message: { id: 'late', conversationId: 'room', author: 'lea', at: new Date().toISOString(), text: 'One more thing.' } })`);
      await browser.until('new messages pill', `${q('[data-testid=jump-latest]')}?.textContent === '1 new message'`);
      const pill = await browser.evaluate(`(() => { const nav = document.querySelector('[data-testid=transcript-navigation]').getBoundingClientRect(), view = document.querySelector('[data-testid=transcript-scroll]').getBoundingClientRect(), button = document.querySelector('[data-testid=jump-latest]').getBoundingClientRect(); return { below: nav.top >= view.bottom - 1, height: Math.round(button.height) }; })()`);
      assert.equal(pill.below, true, 'the pill sits below the list, not over it');
      assert.ok(pill.height >= 44, 'the pill is a 44px target on a phone');
      await auditSmallText(browser, '[data-testid=jump-latest]');
      await browser.click(q('[data-testid=jump-latest]'));
      await browser.until('back at the latest', `!${q('[data-testid=transcript-navigation]')} && (() => { const v = document.querySelector('[data-testid=transcript-scroll]'); return Math.abs(v.scrollHeight - v.clientHeight - v.scrollTop) <= 2; })()`);
      assert.deepEqual(browser.problems, []);
      results.push({ width, scheme, contrast });
      console.log(`PASS story ${width}px ${scheme}: bottom-anchored WhatsApp room, nothing over messages, 44px targets, AA small text, new-messages pill`);
    } finally { await browser.close(); }
  }
  return results;
}
