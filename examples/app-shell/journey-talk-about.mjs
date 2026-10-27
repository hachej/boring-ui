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
async function transcriptAlignment() {
  const samples = [
    { name: 'one-line', words: 'Merci.', lines: 1 },
    { name: 'three-line', words: 'Une salade et du pain, puis des légumes pour le dîner.', lines: 3 },
  ];
  const measure = async selector => browser.evaluate(`(() => {
    const text = ${selector}, rows = [], walker = document.createTreeWalker(text, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (node.parentElement.closest('[data-testid=message-mention]')) continue;
      for (let at = 0; at < node.textContent.length; at++) {
        if (/\\s/.test(node.textContent[at])) continue;
        const range = document.createRange(); range.setStart(node, at); range.setEnd(node, at + 1);
        const rect = range.getBoundingClientRect(), y = rect.top + rect.height / 2;
        let row = rows.find(row => Math.abs(row.y - y) < 1);
        if (!row) { row = { y, left: rect.left }; rows.push(row); } else row.left = Math.min(row.left, rect.left);
      }
    }
    const mention = text.querySelector('[data-testid=message-mention]'), node = [...mention.childNodes].find(node => node.nodeType === Node.TEXT_NODE && node.textContent.trim());
    const range = document.createRange(); range.selectNodeContents(node); const label = range.getBoundingClientRect();
    return { rows, labelY: label.top + label.height / 2, left: mention.getBoundingClientRect().left };
  })()`);
  for (const sample of samples) {
    await browser.click(q('[data-testid=agent-layer-close]'));
    await browser.evaluate(`window.__transcript = ${JSON.stringify(sample.words)}`);
    const before = app.submits.length;
    await browser.click(q('[data-testid=card-mic]'));
    await browser.until('alignment sample records', `${q('[data-testid=agent-talk]')}?.dataset.state === 'recording'`, 15000);
    await pause(300); await browser.click(q('[data-testid=agent-talk]'));
    await browser.until('alignment transcript sent', `document.querySelectorAll('[data-testid=voice-bubble]').length === ${before + 1} && [...document.querySelectorAll('[data-testid=voice-bubble]')].at(-1).textContent.includes(${JSON.stringify(sample.words)})`, 30000);
    await browser.click(q('[data-testid=agent-layer-expand]')); await pause(600);
    const geometry = await measure(`[...document.querySelectorAll('[data-testid=voice-bubble] [data-testid=user-text]')].at(-1)`);
    assert.equal(geometry.rows.length, sample.lines, `${sample.name}: transcript line count ${JSON.stringify(geometry)}`);
    assert.ok(Math.abs(geometry.labelY - geometry.rows[0].y) <= 1.5, `mention and first text line share a baseline: ${JSON.stringify(geometry)}`);
    assert.ok(geometry.rows.slice(1).every(row => Math.abs(row.left - geometry.left) <= 1), `wrapped lines start flush: ${JSON.stringify(geometry)}`);
    await browser.screenshot(`phone-${sample.name}-transcript.png`);
    console.log(`PASS phone ${sample.name}: inline card/text baseline and flush wrapping`);
  }
  await browser.type(q('[data-testid=composer-input]'), '@docs/plan.md Merci.');
  await browser.click(q('[data-testid=composer-submit]'));
  await browser.until('inline file mention sent', `!!document.querySelector('[data-role=user] [data-testid=message-mention][data-path="docs/plan.md"]')`);
  const file = await measure(`[...document.querySelectorAll('[data-role=user] [data-testid=user-text]')].at(-1)`);
  assert.equal(file.rows.length, 1);
  assert.ok(Math.abs(file.labelY - file.rows[0].y) <= 1.5, `file mention shares text baseline: ${JSON.stringify(file)}`);
  await browser.screenshot('phone-file-mention-line.png');
  await browser.evaluate('window.__transcript = undefined');
}
try {
  browser = await launch('about:blank', { evidence, args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
  for (const device of ['phone', 'desktop']) {
    await browser.emulate(device);
    await browser.send('Page.navigate', { url: `${app.url}?talkAbout=1&send=message#jour` });
    await browser.until('fictional card ready', `!!${q('[data-testid=card-mic]')} && !${q('[data-testid=connecting]')}`);
    const before = app.submits.length;
    const voiceBefore = app.submits.filter(item => JSON.stringify(item.body).includes('@uploads/voice-')).length;
    if (device === 'phone') {
      const box = await browser.evaluate(`(() => { const r = ${q('[data-testid=talk-about-card]')}.getBoundingClientRect(); return { x: r.right - 30, y: r.top + 30 }; })()`);
      await browser.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [box] });
      for (let n = 1; n <= 8; n++) { await browser.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: box.x - n * 28, y: box.y }] }); await pause(30); }
      await browser.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    } else await browser.click(q('[data-testid=card-mic]'));
    await browser.until('talkAbout composer recording', `${q('[data-testid=agent-talk]')}?.dataset.state === 'recording'`, 15000);
    await pause(1200);
    assert.equal(await browser.evaluate(`${q('[data-testid=agent-layer]')}.dataset.state`), device === 'phone' ? 'half' : 'open');
    assert.equal(await browser.evaluate(`${q('[data-testid=mention-chip]')}.textContent.includes('Déjeuner · mardi')`), true);
    assert.equal(await browser.evaluate('document.querySelectorAll("[data-testid=composer]").length'), 1, 'one real chat composer');
    assert.equal(await browser.evaluate('document.querySelectorAll("[data-testid=composer-input]").length'), 0, 'recording replaces editable row');
    assert.equal(await browser.evaluate('document.documentElement.scrollWidth <= innerWidth'), true);
    assert.equal(await browser.evaluate(`${q('[data-testid=composer]')}.textContent.includes('@repas:')`), false, 'kind token hidden');
    assert.equal(await browser.evaluate(`!!${q('[data-testid=voice-recording-bar]')}`), true, 'shared recording row');
    await browser.until('actual microphone levels', `${q('[data-testid=voice-waveform]')}?.children.length > 0`);
    assert.equal(await browser.evaluate(`[...${q('[data-testid=voice-waveform]')}.children].some(bar => Number(bar.dataset.level) > 0)`), true, 'nonzero actual input level');
    await browser.click(q('[data-testid=voice-pause]')); await pause(1200);
    assert.equal(await browser.evaluate(`${q('[data-testid=voice-recording]')}.textContent.includes(${JSON.stringify('Enregistrement en pause')})`), true);
    const paused = await browser.evaluate(`${q('[data-testid=voice-recording]')}.textContent`); await pause(1100);
    assert.equal(await browser.evaluate(`${q('[data-testid=voice-recording]')}.textContent`), paused, 'timer freezes paused');
    await browser.click(q('[data-testid=voice-pause]')); await pause(400);
    assert.equal(await browser.evaluate(`!!${q('[data-testid=agent-recording]')}`), false, 'no separate recording bar');
    assert.equal(await browser.evaluate(`${q('[data-testid=composer]')}.contains(${q('[data-testid=voice-recording]')})`), true);
    const buttons = await browser.evaluate(`[${q('[data-testid=agent-talk]')}, ${q('[data-testid=composer-voice-cancel]')}, ${q('[data-testid=voice-pause]')}].map(button => { const r = button.getBoundingClientRect(); return { height: r.height, width: r.width }; })`);
    assert.ok(buttons.every(button => button.height >= 44 && button.width >= 44), '44px recording actions');
    assert.equal(await browser.evaluate(`(() => { const composer = ${q('[data-testid=composer]')}.getBoundingClientRect(); return [...${q('[data-testid=composer-controls]')}.querySelectorAll('button')].every(button => { const r = button.getBoundingClientRect(); return r.left >= composer.left && r.right <= composer.right; }); })()`), true, 'all composer actions stay inside the composer');
    const stable = await browser.evaluate(`${q('[data-testid=voice-recording-bar]')}.getBoundingClientRect().bottom`); await pause(1100);
    assert.ok(Math.abs(await browser.evaluate(`${q('[data-testid=voice-recording-bar]')}.getBoundingClientRect().bottom`) - stable) <= 1, 'recording bar geometry stable');
    await browser.screenshot(`${device}-${device === 'phone' ? 'half-sheet' : 'panel'}-recording.png`);
    await browser.click(q('[data-testid=agent-talk]'));
    await browser.until('native voice message with card mention', `document.querySelectorAll('[data-testid=voice-bubble]').length === ${voiceBefore + 1} && ${q('[data-testid=voice-bubble]')}.textContent.includes('Déjeuner · mardi') && ${q('[data-testid=voice-bubble]')}.textContent.includes('Je mange une salade') && !${q('[data-testid=voice-pending]')}`, 30000);
    assert.equal(app.submits.length, before + 1, 'one native send');
    assert.match(JSON.stringify(app.submits.at(-1).body), /@repas:2026-10-27\/dejeuner @uploads\/voice-[^ ]+\.wav Je mange une salade/);
    assert.equal(await browser.evaluate(`${q('[data-testid=composer-input]')}.value`), '');
    assert.equal(await browser.evaluate(`!!${q('[data-testid=mention-chip]')}`), false);
    if (device === 'phone') { await browser.click(q('[data-testid=agent-layer-expand]')); await pause(600); }
    await browser.screenshot(`${device}-thread-after-send.png`);
    assert.equal(await browser.evaluate(`!!document.querySelector('[data-testid=voice-play], [data-testid=voice-duration], [data-testid=voice-bubble] audio')`), false, 'voice defaults to transcript only');
    assert.equal(await browser.evaluate(`${q('[data-testid=voice-bubble]')}.textContent.includes('@uploads/')`), false, 'stored audio token is hidden');
    if (device === 'phone') await transcriptAlignment();
    await browser.click(q('[data-testid=agent-layer-close]'));
    await browser.reload();
    await browser.until('reloaded host ready', `!!${q('[data-testid=card-mic]')} && !${q('[data-testid=connecting]')}`);
    await browser.click(q('[data-testid=agent-trigger]'));
    await browser.until('durable mention label on reloaded voice message', `${q('[data-testid=voice-bubble]')}?.textContent.includes('Déjeuner · mardi')`, 15000);
    console.log(`PASS ${device}: ${device === 'phone' ? 'swipe release, half sheet' : 'mic click, panel'}, chip, recording, send, native audio token, transcript-only display and reload`);
  }
  assert.deepEqual(browser.problems, []);
} finally { await browser?.close(); await app.close(); }
