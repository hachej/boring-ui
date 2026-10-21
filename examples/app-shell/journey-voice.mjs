// Fictional consumer: real native admission, workspace uploads and reload; Chromium's fake microphone, scripted transcript/model.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launch, pause, q } from '@hachej/boring-testing/browser';

process.env.STUDIO_MODEL = 'scripted';
const { startAppShell } = await import('./server.mjs');
const evidence = process.env.VOICE_EVIDENCE ?? '.cache/evidence/D111/delta'; mkdirSync(evidence, { recursive: true });
let directory = mkdtempSync(join(tmpdir(), 'fictional-voice-'));
let app = await startAppShell({ directory });
const retainedAudio = () => readdirSync(join(directory, 'workspace', 'uploads')).filter(name => name.startsWith('voice-'));
let browser;
const findings = [];
const check = (value, label) => { if (process.env.VOICE_REVIEW_COLLECT) { console.log(`${value ? 'PASS' : 'FAIL'} review: ${label}`); if (!value) findings.push(label); } else assert.ok(value, label); };
try {
  browser = await launch('about:blank', { evidence, args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
  const mic = '[data-testid=agent-talk]', pending = '[data-testid=voice-pending]', bubble = '[data-testid=voice-bubble]';
  const ready = () => browser.until('voice-capable fictional host ready', `${q(mic)} && !${q('[data-testid=connecting]')}`);
  const mounted = previous => browser.until('new fictional host document ready', `performance.timeOrigin !== ${previous} && document.readyState === 'complete' && !!${q('[data-testid=agent-trigger]')} && !${q('[data-testid=connecting]')}`);
  const point = () => browser.evaluate(`(() => { const r = ${q(mic)}.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
  const mouse = (type, p, buttons) => browser.send('Input.dispatchMouseEvent', { type, ...p, button: 'left', buttons, clickCount: 1 });
  const touch = (type, p) => browser.send('Input.dispatchTouchEvent', { type, touchPoints: p ? [p] : [] });
  const reviewPending = async () => {
    const layout = await browser.evaluate(`(() => { const p = ${q(pending)}, c = ${q('[data-testid=composer-dock]')}; return { inTranscript: !!p.closest('[data-testid=transcript]'), above: p.getBoundingClientRect().bottom <= c.getBoundingClientRect().top, empty: !!document.querySelector('[data-testid=empty-state]') }; })()`);
    check(layout.inTranscript && layout.above && !layout.empty, 'pending/failed voice is a transcript user row above composer, without empty-state overlay');
  };
  const fresh = async () => {
    await app.close(); directory = mkdtempSync(join(tmpdir(), 'fictional-voice-scene-')); app = await startAppShell({ directory });
    const previous = await browser.evaluate('performance.timeOrigin'); await browser.send('Page.navigate', { url: `${app.url}?send=message` }); await mounted(previous);
  };
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
    await reviewPending();
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
    const automatic = await browser.evaluate(`(() => { const v = ${q('[data-testid=transcript-scroll]')}, b = ${q('[data-testid=jump-latest]')}; return { distance: v.scrollHeight - v.clientHeight - v.scrollTop, height: v.clientHeight, scrollHeight: v.scrollHeight, arrow: !!b && Number(getComputedStyle(b).opacity) > 0, native: v.dataset.scrollable }; })()`);
    console.log('review automatic bottom', device, JSON.stringify(automatic));
    check(automatic.distance < 2 && !automatic.arrow, 'reloaded transcript starts at the bottom without jump arrow');
    if (automatic.scrollHeight > automatic.height + 10) {
      const viewport = await browser.evaluate(`(() => { const r = ${q('[data-testid=transcript-scroll]')}.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
      await browser.wheel(viewport.x, viewport.y, -1000); await pause(700);
      check(await browser.evaluate(`(() => { const v = ${q('[data-testid=transcript-scroll]')}.getBoundingClientRect(), b = ${q('[data-testid=jump-latest]')}; if (!b) return false; const r = b.getBoundingClientRect(); return r.top >= v.bottom || r.bottom <= v.top; })()`), 'visible jump control has reserved space outside the message viewport');
      await browser.screenshot(`${device}-jump.png`);
      await browser.click(q('[data-testid=jump-latest]'));
    }
    if (device === 'phone') { await browser.click(q('[data-testid=agent-layer-expand]')); await pause(800); }
    const play = `${q(bubble)}.querySelector('[data-testid=voice-play]')`;
    const clickReplay = async () => {
      const p = await browser.evaluate(`(() => { const e = ${play}, r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
      await mouse('mousePressed', p, 1); await mouse('mouseReleased', p, 0);
    };
    await clickReplay();
    await browser.until('retained audio plays lazily', `${q(bubble)}.querySelector('audio').paused === false`, 15000);
    await browser.until('retained duration decoded', `!['--:--', '0:00'].includes(${q(bubble)}.querySelector('[data-testid=voice-duration]').textContent)`, 15000);
    check(await browser.evaluate(`${play}.getAttribute('aria-label') === 'Mettre en pause'`), 'playing audio has accessible Mettre en pause label');
    await clickReplay();
    await browser.until('idle replay has a play label', `${q(bubble)}.querySelector('audio').paused`);
    await browser.evaluate(`${q('[data-testid=transcript-scroll]')}.scrollTop = ${q('[data-testid=transcript-scroll]')}.scrollHeight`);
    await pause(700);
    const position = await browser.evaluate(`(() => { const v = ${q('[data-testid=transcript-scroll]')}, b = ${q('[data-testid=jump-latest]')}; return { distance: v.scrollHeight - v.clientHeight - v.scrollTop, arrow: !!b && getComputedStyle(b).visibility !== 'hidden' && Number(getComputedStyle(b).opacity) > 0, native: v.dataset.scrollable }; })()`);
    console.log('review bottom geometry', device, JSON.stringify(position));
    check(position.distance < 2 && !position.arrow, 'jump-to-bottom is hidden at actual bottom');
    check(await browser.evaluate(`${play}.getAttribute('aria-label') === 'Lire' && ${q(bubble)}.querySelector('audio').paused && !['--:--', '0:00'].includes(${q(bubble)}.querySelector('[data-testid=voice-duration]').textContent)`), 'idle replay shows play control and total duration');
    await browser.screenshot(`${device}-replay.png`);
    console.log(`PASS ${device}: 10s hold, pending, one native transcript turn, durable reload/replay/duration, no overflow`);
  }
  await fresh(); await browser.click(q('[data-testid=agent-trigger]')); await ready(); await pause(800);
  await browser.evaluate('window.__voiceFail = true');
  const beforeFailure = app.submits.length, p = await point();
  await mouse('mousePressed', p, 1); await pause(500); await mouse('mouseReleased', p, 0);
  await browser.until('explicit transcription failure', `!!${q('[data-testid=voice-retry]')}`);
  assert.equal(app.submits.length, beforeFailure);
  await reviewPending();
  await browser.screenshot('desktop-failed.png');
  const uploads = await browser.evaluate('window.__voiceUploads'), retained = retainedAudio();
  assert.equal(retained.length, 1, 'clean desktop failure retained exactly one audio file');
  await browser.evaluate('window.__voiceFail = false'); await browser.click(q('[data-testid=voice-retry]'));
  await browser.until('retry admitted', `!${q(pending)}`, 30000);
  assert.equal(app.submits.length, beforeFailure + 1);
  assert.equal(await browser.evaluate('window.__voiceUploads'), uploads, 'transcription retry reuses uploaded bytes');
  assert.deepEqual(retainedAudio(), retained, 'retry keeps the exact one persisted upload path');
  for (const reason of ['slide', 'Escape']) {
    const before = app.submits.length, uploads = await browser.evaluate('window.__voiceUploads'), p = await point();
    await mouse('mousePressed', p, 1); await pause(400);
    if (reason === 'slide') await mouse('mouseMoved', { x: p.x - 150, y: p.y - 100 }, 1); else await browser.press('Escape');
    await mouse('mouseReleased', p, 0); await pause(1500);
    assert.equal(app.submits.length, before); assert.equal(await browser.evaluate('window.__voiceUploads'), uploads);
  }
  await browser.emulate('phone');
  await fresh();
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
  await reviewPending();
  const failure = await browser.evaluate(`(() => { const buttons = ['voice-retry', 'voice-audio-only', 'voice-discard'].map(id => document.querySelector('[data-testid=' + id + ']')); const mic = ${q(mic)}, files = ${q('[data-testid=conversation-files]')}; return { idle: !mic.disabled && !mic.querySelector('.animate-spin'), files: files?.textContent, uploads: window.__voiceUploads, buttons: buttons.map(b => ({ slot: b.dataset.slot, ghost: b.classList.contains('dark:hover:bg-muted/50'), top: b.getBoundingClientRect().top, bottom: b.getBoundingClientRect().bottom })) }; })()`);
  console.log('review clean failure', JSON.stringify(failure));
  check(failure.idle, 'failed preparation leaves the mic idle and available');
  check(failure.uploads === 1 && retainedAudio().length === 1 && /· 1$/.test(failure.files ?? ''), 'clean failure scene contains exactly one uploaded file and file chip');
  check(failure.buttons.every(b => b.slot === 'button') && failure.buttons[2].ghost && Math.max(...failure.buttons.map(b => b.top)) - Math.min(...failure.buttons.map(b => b.top)) < 2, 'Discard is a real ghost Button aligned with Retry and Send audio only');
  await browser.screenshot('phone-failed.png');
  const next = await point(); await touch('touchStart', next); await pause(500);
  check(await browser.evaluate(`${q(mic)}.dataset.state === 'recording' && document.querySelectorAll('[data-testid=voice-pending]').length === 1`), 'next recording genuinely starts while the earlier failed transcript row remains');
  await browser.press('Escape'); await touch('touchEnd');
  check(await browser.evaluate('window.__voiceUploads') === 1, 'cancelled next recording creates no duplicate upload');
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
  assert.deepEqual(findings, [], 'screenshot review assertions');
  assert.deepEqual(browser.problems, []);
  console.log('PASS failure/retry with no duplicate upload; slide and Escape upload/send nothing; no browser errors');
} finally { await browser?.close(); await app.close(); }
