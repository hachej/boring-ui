import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { launch, pause, q, qa } from '@hachej/boring-testing/browser';
import { startSharedChat } from './server.mjs';

const evidence = process.env.SHARED_CHAT_EVIDENCE ?? '.cache/evidence/shared-chat';
mkdirSync(evidence, { recursive: true });
const app = await startSharedChat();
let browser;
const input = q('[data-testid=composer-input]');
const noOverflow = 'document.documentElement.scrollWidth <= innerWidth && document.body.scrollWidth <= innerWidth';
try {
  browser = await launch(app.url, { evidence });
  // Phone first, then the same existing workspace at desktop width, both default shadcn themes.
  for (const [device, width, height] of [['phone', 390, 844], ['desktop', 1440, 1000]]) {
    await browser.emulate(device);
    await browser.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: device === 'phone' });
    for (const scheme of ['light', 'dark']) {
      await browser.reload();
      await browser.until('the shared conversation', `!!${q('[data-shared-message=six]')} && !!${q('[data-testid=shared-members]')}`);
      await browser.evaluate(`document.documentElement.classList.toggle('dark', ${scheme === 'dark'})`);
      await browser.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme }] });
      assert.equal(await browser.evaluate(`!!${q('[data-testid=sessions-toggle]')}`), false, 'embedded layout keeps the existing bar, with no sidebar');
      assert.equal(await browser.evaluate(noOverflow), true, `${width}: page fits`);
      assert.equal(await browser.evaluate(`${q('[data-shared-message=four] [data-testid=author-badge]')}?.textContent`), 'Admin');
      assert.equal(await browser.evaluate(`${q('[data-shared-message=five] [data-testid=author-badge]')}?.textContent`), 'App');
      await browser.evaluate(`${q('[data-shared-message=five]')}.scrollIntoView({ block: 'start', behavior: 'instant' })`);
      await pause(150);
      await browser.screenshot(`${width}-${scheme}-conversation.png`);

      await browser.type(input, '@Le');
      await browser.until('the member mention popover', `!!${q('[data-testid=mention-item][data-path=leo]')}`);
      assert.equal(await browser.evaluate(noOverflow), true, `${width}: mention fits`);
      await browser.screenshot(`${width}-${scheme}-mention.png`);
      await browser.press('ArrowDown'); await browser.press('ArrowUp'); await browser.press('Enter');
      assert.match(await browser.evaluate(`${input}.value`), /@leo/);
      await browser.press('Enter');
      await browser.until('the mention reaches the host', `window.__SHARED__.sends.at(-1)?.mentions.includes('leo')`);

      await browser.click(q('[data-testid=shared-members]'));
      await browser.until('member list', `!!${q('[data-testid=member-list]')}`);
      assert.match(await browser.evaluate(`${q('[data-testid=member-list]')}.innerText`), /Julien \(admin\)/);
      await browser.evaluate(`window.__SHARED__.emit({ type: 'presence', members: [{ id: 'leo', presence: 'away' }] })`);
      await browser.until('presence update', `${q('[data-member-id=leo] [data-testid=presence]')}?.dataset.presence === 'away'`);
      await browser.screenshot(`${width}-${scheme}-members.png`);
      await browser.press('Escape');
      await browser.until('member list closes', `!${q('[data-testid=member-list]')}`);

      await browser.click(q('[data-testid=workspace-bar-history]'));
      await browser.until('History main, admin and direct', `${qa('[data-testid=conversation-row]')}.length === 3`);
      assert.deepEqual(await browser.evaluate(`${qa('[data-testid=conversation-row]')}.map(row => row.innerText.trim())`), ['Main', 'Admin', 'Mira and Leo']);
      await browser.screenshot(`${width}-${scheme}-history.png`);
      await browser.click(`${qa('[data-testid=conversation-row]')}.find(row => row.innerText.includes('Mira and Leo'))`);
      await browser.until('direct conversation', `!!${q('[data-shared-message=direct-one]')} && !${q('[data-shared-message=one]')}`);
      await browser.click(q('[data-testid=workspace-bar-history]'));
      await browser.until('History reopens', `${qa('[data-testid=conversation-row]')}.length === 3`);
      await browser.click(`${qa('[data-testid=conversation-row]')}.find(row => row.innerText.trim() === 'Main')`);
      await browser.until('main selected', `!!${q('[data-shared-message=six]')}`);

      await browser.click(q('[data-shared-message=six] button'));
      await browser.until('request action reaches host', `window.__SHARED__.actions.at(-1)?.requestId === 'review-plan'`);
      await browser.evaluate(`window.__SHARED__.emit({ type: 'message', message: { id: 'six', conversationId: 'main', author: 'pm', at: '2026-10-19T10:05:00Z', card: { requestId: 'review-plan', title: 'Review complete', line: 'The host accepted the review.' } } })`);
      await browser.until('replacement card', `${q('[data-shared-message=six]')}.innerText.includes('Review complete')`);
      assert.equal(await browser.evaluate(`${qa('[data-shared-message=six]')}.length`), 1);
      await browser.evaluate(`window.__SHARED__.emit({ type: 'message', message: { id: 'stream', conversationId: 'main', author: 'pm', at: new Date().toISOString(), text: 'I am checking', streaming: true } }); window.__SHARED__.emit({ type: 'delta', messageId: 'stream', conversationId: 'main', text: ' the fictional garden plan.' })`);
      await browser.until('streaming assistant rendering', `${q('[data-shared-message=stream] [data-role=assistant]')}?.dataset.streaming === 'true' && ${q('[data-shared-message=stream]')}.innerText.includes('checking the fictional')`);
      await browser.evaluate(`${q('[data-shared-message=stream]')}.scrollIntoView({ block: 'end', behavior: 'instant' })`);
      await browser.screenshot(`${width}-${scheme}-streaming.png`);
      console.log(`PASS ${width}px ${scheme}: authors, cards, mentions, members, History and streaming`);
    }
  }
  await browser.emulate('phone');
  await browser.send('Emulation.setDeviceMetricsOverride', { width: 360, height: 780, deviceScaleFactor: 1, mobile: true });
  await pause(200);
  assert.equal(await browser.evaluate(noOverflow), true, 'no horizontal overflow at 360px');
  assert.equal(await browser.evaluate(`(() => { const e = ${q('[data-testid=transcript-scroll]')}; return e.scrollWidth <= e.clientWidth; })()`), true, 'timeline has no hidden sideways overflow');
  await browser.screenshot('360-no-overflow.png');
  assert.deepEqual(browser.problems, []);
  writeFileSync(`${evidence}/browser-result.json`, JSON.stringify({ passed: true, widths: [390, 1440, 360], themes: ['light', 'dark'], fictional: true }, null, 2));
  console.log(`PASS shared chat browser journey; evidence ${evidence}`);
} catch (error) {
  await browser?.screenshot('last-state.png'); throw error;
} finally { await browser?.close(); await app.close(); }
