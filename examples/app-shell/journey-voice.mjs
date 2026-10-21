// Fictional consumer: real native admission, workspace uploads and reload; Chromium's fake microphone, scripted transcript/model.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launch, pause, q } from '@hachej/boring-testing/browser';

process.env.STUDIO_MODEL = 'scripted';
const { startAppShell } = await import('./server.mjs');
const evidence = '.cache/evidence/D111'; mkdirSync(evidence, { recursive: true });
const app = await startAppShell({ directory: mkdtempSync(join(tmpdir(), 'fictional-voice-')) });
let browser;
try {
  browser = await launch('about:blank', { evidence, args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
  const mic = '[data-testid=agent-talk]', pending = '[data-testid=voice-pending]', bubble = '[data-testid=voice-bubble]';
  const ready = () => browser.until('voice-capable fictional host ready', `${q(mic)} && !${q('[data-testid=connecting]')}`);
  const mounted = previous => browser.until('new fictional host document ready', `performance.timeOrigin !== ${previous} && document.readyState === 'complete' && !!${q('[data-testid=agent-trigger]')} && !${q('[data-testid=connecting]')}`);
  const point = () => browser.evaluate(`(() => { const r = ${q(mic)}.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
  const mouse = (type, p, buttons) => browser.send('Input.dispatchMouseEvent', { type, ...p, button: 'left', buttons, clickCount: 1 });
  const touch = (type, p) => browser.send('Input.dispatchTouchEvent', { type, touchPoints: p ? [p] : [] });
  for (const device of ['phone', 'desktop']) {
    await browser.emulate(device);
    const previous = await browser.evaluate('performance.timeOrigin');
    await browser.send('Page.navigate', { url: `${app.url}?send=message` });
    await mounted(previous);
    await browser.click(q('[data-testid=agent-trigger]')); await ready(); await pause(800);
    if (device === 'phone') { await browser.click(q('[data-testid=agent-layer-expand]')); await pause(800); }
    assert.equal(await browser.evaluate(`document.querySelectorAll('[data-testid=agent-talk]').length`), 1);
    assert.equal(await browser.evaluate(`!!${q('[data-testid=voice-message-record]')}`), false, 'one shared agent microphone');
    const before = app.submits.length, p = await point();
    if (device === 'phone') await touch('touchStart', p); else await mouse('mousePressed', p, 1);
    await browser.until('recording from the hold', `${q(mic)}.dataset.state === 'recording'`);
    await pause(10000);
    if (device === 'phone') await touch('touchEnd'); else await mouse('mouseReleased', p, 0);
    await browser.until('one local pending bubble', `!!${q(pending)}`);
    await browser.screenshot(`${device}-pending.png`);
    await browser.until('transcript and replay bubble', `!!${q(bubble)} && !${q(pending)} && document.body.innerText.includes('Tu as choisi une salade')`, 30000);
    assert.equal(app.submits.length, before + 1, 'exactly one native message for the recording');
    const sent = JSON.stringify(app.submits.at(-1).body);
    assert.match(sent, /@uploads\/voice-[^ ]+\.webm Je mange une salade/);
    assert.ok(await browser.evaluate('document.documentElement.scrollWidth <= innerWidth'), 'no horizontal overflow');
    const beforeReload = await browser.evaluate('performance.timeOrigin');
    await browser.reload();
    await mounted(beforeReload);
    await browser.click(q('[data-testid=agent-trigger]')); await ready(); await pause(800);
    await browser.until('retained transcript after reload', `!!${q(bubble)} && ${q(bubble)}.textContent.includes('Je mange une salade')`);
    const play = `${q(bubble)}.querySelector('[data-testid=voice-play]')`;
    await browser.click(play);
    await browser.until('retained audio plays lazily', `${q(bubble)}.querySelector('audio').paused === false`, 15000);
    await browser.until('retained duration decoded', `!['--:--', '0:00'].includes(${q(bubble)}.querySelector('[data-testid=voice-duration]').textContent)`, 15000);
    await browser.screenshot(`${device}-replay.png`);
    await browser.click(play);
    console.log(`PASS ${device}: 10s hold, pending, one native transcript turn, durable reload/replay/duration, no overflow`);
  }
  await browser.evaluate('window.__voiceFail = true');
  const beforeFailure = app.submits.length, p = await point();
  await mouse('mousePressed', p, 1); await pause(500); await mouse('mouseReleased', p, 0);
  await browser.until('explicit transcription failure', `!!${q('[data-testid=voice-retry]')}`);
  assert.equal(app.submits.length, beforeFailure);
  await browser.screenshot('desktop-failed.png');
  const uploads = await browser.evaluate('window.__voiceUploads');
  await browser.evaluate('window.__voiceFail = false'); await browser.click(q('[data-testid=voice-retry]'));
  await browser.until('retry admitted', `!${q(pending)}`, 30000);
  assert.equal(app.submits.length, beforeFailure + 1);
  assert.equal(await browser.evaluate('window.__voiceUploads'), uploads, 'transcription retry reuses uploaded bytes');
  for (const reason of ['slide', 'Escape']) {
    const before = app.submits.length, uploads = await browser.evaluate('window.__voiceUploads'), p = await point();
    await mouse('mousePressed', p, 1); await pause(400);
    if (reason === 'slide') await mouse('mouseMoved', { x: p.x - 150, y: p.y - 100 }, 1); else await browser.press('Escape');
    await mouse('mouseReleased', p, 0); await pause(1500);
    assert.equal(app.submits.length, before); assert.equal(await browser.evaluate('window.__voiceUploads'), uploads);
  }
  await browser.emulate('phone');
  const beforePhone = await browser.evaluate('performance.timeOrigin');
  await browser.send('Page.navigate', { url: `${app.url}?send=message` });
  await mounted(beforePhone);
  await browser.evaluate('window.__voiceFail = true');
  const trigger = await browser.evaluate(`(() => { const r = ${q('[data-testid=agent-trigger]')}.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
  const beforePeek = app.submits.length;
  await touch('touchStart', trigger);
  await browser.until('trigger records at peek', `${q('[data-testid=agent-listening]')}?.dataset.phase === 'recording'`);
  await pause(500); await touch('touchEnd');
  await browser.until('failed peek reveals actions at half', `${q('[data-testid=agent-layer]')}?.dataset.state === 'half' && !!${q('[data-testid=voice-retry]')}`);
  await pause(800);
  assert.equal(app.submits.length, beforePeek);
  assert.equal(await browser.evaluate(`document.activeElement === ${q('[data-testid=composer-input]')}`), false, 'failure never focuses the composer');
  assert.equal(await browser.evaluate(`(() => { const e = ${q('[data-testid=voice-retry]')}, r = e.getBoundingClientRect(); return r.top >= 0 && r.bottom <= visualViewport.height && e.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)); })()`), true, 'Retry is visible and tappable');
  await browser.screenshot('phone-failed.png');
  await browser.press('Escape');
  await browser.until('failed recording can be collapsed', `${q('[data-testid=agent-layer]')}?.dataset.state === 'peek'`);
  await pause(600);
  assert.equal(await browser.evaluate(`${q('[data-testid=agent-layer]')}?.dataset.state`), 'peek');
  await browser.click(q('[data-testid=agent-trigger]'));
  await browser.until('failed recording still available', `${q('[data-testid=agent-layer]')}?.dataset.state === 'half' && !!${q('[data-testid=voice-discard]')}`);
  await pause(700); await browser.click(q('[data-testid=voice-discard]'));
  for (const reason of ['Escape', 'blur', 'hidden']) {
    const previous = await browser.evaluate('performance.timeOrigin');
    await browser.send('Page.navigate', { url: `${app.url}?send=message` }); await mounted(previous);
    const before = app.submits.length, uploads = await browser.evaluate('window.__voiceUploads ?? 0');
    const point = await browser.evaluate(`(() => { const r = ${q('[data-testid=agent-trigger]')}.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
    await touch('touchStart', point);
    await browser.until('trigger recording before cancellation', `${q('[data-testid=agent-listening]')}?.dataset.phase === 'recording'`);
    if (reason === 'Escape') await browser.press('Escape');
    else if (reason === 'blur') await browser.evaluate(`window.dispatchEvent(new Event('blur'))`);
    else await browser.evaluate(`Object.defineProperty(document, 'hidden', { configurable: true, value: true }); document.dispatchEvent(new Event('visibilitychange'))`);
    await browser.until(`trigger ${reason} cancels before release`, `${q(mic)}?.dataset.state === 'idle'`);
    await touch('touchEnd'); await pause(1800);
    assert.equal(app.submits.length, before); assert.equal(await browser.evaluate('window.__voiceUploads ?? 0'), uploads);
  }
  console.log('PASS trigger Escape/blur/hidden cancel before release: no upload or native send');
  assert.deepEqual(browser.problems, []);
  console.log('PASS failure/retry with no duplicate upload; slide and Escape upload/send nothing; no browser errors');
} finally { await browser?.close(); await app.close(); }
