// Fictional meal mention through the real chat, transport, native admission and retained voice upload.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launch, pause, q } from '@hachej/boring-testing/browser';

process.env.STUDIO_MODEL = 'scripted';
const { startAppShell } = await import('./server.mjs');
const evidence = process.env.TALK_ABOUT_EVIDENCE ?? '.agent-handoff/talk-about/shots';
mkdirSync(evidence, { recursive: true });
const app = await startAppShell({ directory: mkdtempSync(join(tmpdir(), 'fictional-talk-about-')) });
let browser;
try {
  browser = await launch('about:blank', { evidence, args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
  for (const device of ['phone', 'desktop']) {
    await browser.emulate(device);
    await browser.send('Page.navigate', { url: `${app.url}?talkAbout=1&send=message#jour` });
    await browser.until('fictional card ready', `!!${q('[data-testid=card-mic]')} && !${q('[data-testid=connecting]')}`);
    const before = app.submits.length;
    if (device === 'phone') {
      const box = await browser.evaluate(`(() => { const r = ${q('[data-testid=talk-about-card]')}.getBoundingClientRect(); return { x: r.right - 30, y: r.top + 30 }; })()`);
      await browser.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [box] });
      for (let n = 1; n <= 8; n++) { await browser.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: box.x - n * 28, y: box.y }] }); await pause(30); }
      await browser.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    } else await browser.click(q('[data-testid=card-mic]'));
    await browser.until('talkAbout recording bar', `${q('[data-testid=agent-recording]')}?.dataset.phase === 'recording'`, 15000);
    await pause(1200);
    assert.equal(await browser.evaluate(`${q('[data-testid=agent-layer]')}.dataset.state`), device === 'phone' ? 'half' : 'open');
    assert.equal(await browser.evaluate(`${q('[data-testid=mention-chip]')}.textContent.includes('Déjeuner · mardi')`), true);
    assert.equal(await browser.evaluate('document.querySelectorAll("[data-testid=composer-input]").length'), 1, 'one real chat composer');
    assert.equal(await browser.evaluate('document.documentElement.scrollWidth <= innerWidth'), true);
    const buttons = await browser.evaluate(`[...${q('[data-testid=agent-recording]')}.querySelectorAll('button')].map(button => { const r = button.getBoundingClientRect(); return { height: r.height, width: r.width }; })`);
    assert.ok(buttons.every(button => button.height >= 44 && button.width >= 44), '44px recording actions');
    await browser.screenshot(`${device}-${device === 'phone' ? 'half-sheet' : 'panel'}-recording.png`);
    await browser.click(q('[data-testid=agent-recording-send]'));
    await browser.until('native voice message with card mention', `document.querySelectorAll('[data-testid=voice-bubble]').length === ${device === 'phone' ? 1 : 2} && ${q('[data-testid=voice-bubble]')}.textContent.includes('Déjeuner · mardi') && ${q('[data-testid=voice-bubble]')}.textContent.includes('Je mange une salade') && !${q('[data-testid=voice-pending]')}`, 30000);
    assert.equal(app.submits.length, before + 1, 'one native send');
    assert.match(JSON.stringify(app.submits.at(-1).body), /@repas:2026-10-27\/dejeuner @uploads\/voice-[^ ]+\.wav Je mange une salade/);
    assert.equal(await browser.evaluate(`${q('[data-testid=composer-input]')}.value`), '');
    assert.equal(await browser.evaluate(`!!${q('[data-testid=mention-chip]')}`), false);
    await browser.screenshot(`${device}-thread-after-send.png`);
    if (device === 'phone') { await browser.click(q('[data-testid=agent-layer-expand]')); await pause(600); }
    await browser.click(q('[data-testid=voice-play]'));
    await browser.until('audio still plays with prefixed card mention', `${q('[data-testid=voice-bubble] audio')}.paused === false`, 15000);
    await browser.click(q('[data-testid=agent-layer-close]'));
    await browser.reload();
    await browser.until('reloaded host ready', `!!${q('[data-testid=card-mic]')} && !${q('[data-testid=connecting]')}`);
    await browser.click(q('[data-testid=agent-trigger]'));
    await browser.until('durable mention label on reloaded voice message', `${q('[data-testid=voice-bubble]')}?.textContent.includes('Déjeuner · mardi')`, 15000);
    console.log(`PASS ${device}: ${device === 'phone' ? 'swipe release, half sheet' : 'mic click, panel'}, chip, recording, send, native token, audio playback and reload`);
  }
  assert.deepEqual(browser.problems, []);
} finally { await browser?.close(); await app.close(); }
