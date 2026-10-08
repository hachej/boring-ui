// Measures, in headless Chromium, how well the feedback voice capture's clock lines up with the pointer:
// `npm run feedback:voice-sync [-- --runs 5]` (needs `npm run build`; CHROMIUM or the Playwright Chromium under ~/.cache).
//
// A WAV with short beeps at known offsets is fed to the browser as a fake microphone. The page records it with
// `createVoiceCapture` while the pointer is moved (real CDP input) onto a different element at each beep. A second, independent
// reader of the same microphone (MediaStreamTrackProcessor on a cloned track) timestamps each beep as it arrives: the ground truth.
// After `stop()`, the page decodes the recording, finds the beep onsets in it, and converts them to page time with each clock
// strategy; the error is that time minus the ground truth. Finally `alignSpeech` runs on synthetic segments around each recorded
// beep and must place each on the element hovered at that beep.
//
// Chromium only: Firefox and WebKit have no fake-microphone file and no MediaStreamTrackProcessor, and are not measured.
// Writes .cache/evidence/feedback-voice/{runs.json,RESULT.md}. Fictional audio only (generated tones).
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const evidence = join(root, '.cache/evidence/feedback-voice');
const BEEPS = [0.8, 2.1, 3.7, 5.2]; // seconds into the fake microphone's audio
const RATE = 48_000, LENGTH = 6.5, BEEP_MS = 120;
const TARGET_MAX_MS = 150;
const runs = Number(process.argv[process.argv.indexOf('--runs') + 1]) || 5;
const chromium = process.env.CHROMIUM ?? join(homedir(), '.cache/ms-playwright/chromium-1243/chrome-linux64/chrome');
const sleep = ms => new Promise(r => setTimeout(r, ms));

/** 16-bit mono PCM WAV: silence with 1 kHz beeps (5 ms ramps) starting at BEEPS. */
function beepWav() {
  const samples = Math.round(RATE * LENGTH);
  const data = Buffer.alloc(samples * 2);
  for (const at of BEEPS) {
    const from = Math.round(at * RATE), count = Math.round((BEEP_MS / 1000) * RATE), ramp = Math.round(0.005 * RATE);
    for (let i = 0; i < count; i++) {
      const envelope = Math.min(1, i / ramp, (count - i) / ramp);
      data.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 1000 * i) / RATE) * envelope * 0.6 * 32767), (from + i) * 2);
    }
  }
  const header = Buffer.alloc(44);
  header.write('RIFF', 0); header.writeUInt32LE(36 + data.length, 4); header.write('WAVE', 8); header.write('fmt ', 12);
  header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22); header.writeUInt32LE(RATE, 24);
  header.writeUInt32LE(RATE * 2, 28); header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34); header.write('data', 36); header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

// The page: four pickable elements and empty space, the voice bundle, an instrumented MediaRecorder (to read every candidate
// clock without changing the capture), the ground-truth reader and the onset detector.
const PAGE_SCRIPT = String.raw`
const log = { pointer: [], live: [], rec: { chunks: [] } };
window.__log = log;
const targetAt = (x, y) => { const e = document.elementFromPoint(x, y)?.closest('[data-el]'); return e ? Number(e.dataset.el) : null; };
addEventListener('pointermove', event => {
  const target = targetAt(event.clientX, event.clientY), last = log.pointer[log.pointer.length - 1];
  if (!last || last.target !== target) log.pointer.push({ t: performance.now(), eventT: event.timeStamp, target });
});
const Native = window.MediaRecorder;
window.MediaRecorder = class extends Native {
  constructor(stream, options) {
    super(stream, options);
    this.addEventListener('start', event => { log.rec.startEvent = performance.now(); log.rec.startEventStamp = event.timeStamp; });
    this.addEventListener('dataavailable', event => { log.rec.chunks.push({ t: performance.now(), blob: event.data }); });
    this.addEventListener('stop', () => { log.rec.stopEvent = performance.now(); });
  }
  start(slice) { log.rec.startCall = performance.now(); return super.start(slice); }
  stop() { log.rec.stopCall = performance.now(); return super.stop(); }
};
// Onsets: the first sample above 0.2 after at least 0.3 s below 0.02.
function detector(rate) {
  let armed = true, quiet = 0;
  return (samples, onOnset) => {
    for (let i = 0; i < samples.length; i++) {
      const level = Math.abs(samples[i]);
      if (armed && level > 0.2) { armed = false; quiet = 0; onOnset(i); }
      else if (!armed) { quiet = level < 0.02 ? quiet + 1 : 0; if (quiet > 0.3 * rate) armed = true; }
    }
  };
}
const waiters = [];
async function liveReader(track) {
  if (typeof MediaStreamTrackProcessor !== 'function') { log.liveError = 'no MediaStreamTrackProcessor'; return; }
  const reader = new MediaStreamTrackProcessor({ track }).readable.getReader();
  let detect = null;
  for (;;) {
    const { value: frame, done } = await reader.read();
    if (done) break;
    const arrived = performance.now();
    const n = frame.numberOfFrames, rate = frame.sampleRate, samples = new Float32Array(n);
    frame.copyTo(samples, { planeIndex: 0, format: 'f32-planar' });
    detect ??= detector(rate);
    const frameMs = (n / rate) * 1000;
    log.frameMs = frameMs;
    (log.frames ??= []).push([frame.timestamp / 1000, arrived]);
    detect(samples, i => {
      const onset = { arrival: arrived - frameMs + (i / rate) * 1000, stamp: frame.timestamp / 1000 + (i / rate) * 1000 };
      log.live.push(onset);
      for (const w of waiters.splice(0)) w();
    });
    frame.close();
  }
}
window.nextBeep = k => new Promise(resolve => { const check = () => log.live.length > k ? resolve(log.live[k].arrival) : waiters.push(check); check(); });
let capture;
window.begin = async () => {
  capture = Voice.createVoiceCapture({ getUserMedia: async constraints => {
    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    log.gumResolved = performance.now();
    liveReader(stream.getAudioTracks()[0].clone());
    return stream;
  } });
  return capture.start();
};
async function onsetsOf(blob) {
  const context = new OfflineAudioContext(1, 1, 48000);
  const buffer = await context.decodeAudioData(await blob.arrayBuffer());
  const samples = buffer.getChannelData(0), found = [];
  detector(buffer.sampleRate)(samples, i => found.push(i / buffer.sampleRate));
  return { onsets: found, duration: buffer.duration };
}
window.finish = async () => {
  const result = await capture.stop();
  const { onsets, duration } = await onsetsOf(result.audio);
  let firstChunkMs = null;
  try { firstChunkMs = (await onsetsOf(log.rec.chunks[0].blob)).duration * 1000; } catch (error) { log.firstChunkError = String(error); }
  const anchors = {
    startCall: log.rec.startCall, startEvent: log.rec.startEvent, startEventStamp: log.rec.startEventStamp, stopCall: log.rec.stopCall, stopEvent: log.rec.stopEvent,
    firstChunk: log.rec.chunks[0]?.t ?? null, firstChunkMs,
  };
  const segments = onsets.map((at, k) => ({ start: Math.max(0, at - 0.15), end: at + 0.45, text: 'beep ' + k }));
  const aligned = Voice.alignSpeech({ segments, audioStartedAt: result.startedAt, pointer: log.pointer.map(p => ({ t: p.t, target: p.target })), pins: [] });
  const pinned = Voice.alignSpeech({ segments, audioStartedAt: result.startedAt, pointer: [], pins: log.live.map((l, k) => ({ t: l.arrival + 300, target: k })) });
  return {
    capture: { startedAt: result.startedAt, endedAt: result.endedAt, mimeType: result.mimeType, bytes: result.audio.size, truncated: result.truncated },
    duration, onsets, live: log.live, pointer: log.pointer, anchors, chunks: log.rec.chunks.map(c => ({ t: c.t, size: c.blob.size })),
    gumResolved: log.gumResolved,
    frames: log.frames ?? [], frameMs: log.frameMs, liveError: log.liveError ?? null,
    aligned, pinned,
  };
};
window.__ready = true;
`;

const PAGE = bundle => `<!doctype html><meta charset="utf-8"><title>voice sync</title>
<style>body{margin:0;font:14px system-ui}#grid{display:grid;grid-template-columns:repeat(4,160px);gap:60px;padding:120px 60px}[data-el]{height:120px;background:#dde;border:1px solid #99a}#blank{height:200px}</style>
<div id="grid"><div data-el="0">Save</div><div data-el="1">Name</div><div data-el="2">Plan</div><div data-el="3">Delete</div></div><div id="blank"></div>
<script>${bundle}</script><script>${PAGE_SCRIPT}</script>`;

async function browser(wav, url) {
  const profile = mkdtempSync(join(tmpdir(), 'boring-voice-sync-'));
  const child = spawn(chromium, ['--headless', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--window-size=1200,800', '--no-first-run',
    '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${wav}%noloop`, '--autoplay-policy=no-user-gesture-required', 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
  const endpoint = await new Promise((ok, fail) => {
    let text = '';
    child.stderr.on('data', chunk => { text += chunk; const found = /DevTools listening on (ws:\/\/\S+)/.exec(text); if (found) ok(found[1]); });
    child.once('exit', code => fail(new Error(`Chromium exited ${code}\n${text}`)));
    setTimeout(() => fail(new Error(`Chromium did not start\n${text}`)), 20000);
  });
  const socket = new WebSocket(endpoint);
  await new Promise((ok, fail) => { socket.onopen = ok; socket.onerror = fail; });
  let next = 0, sessionId;
  const waiting = new Map(), problems = [];
  socket.onmessage = event => {
    const message = JSON.parse(event.data);
    if (message.id && waiting.has(message.id)) { const { ok, fail } = waiting.get(message.id); waiting.delete(message.id); message.error ? fail(new Error(JSON.stringify(message.error))) : ok(message.result); }
    else if (message.method === 'Runtime.exceptionThrown') problems.push(message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text);
  };
  const send = (method, params = {}) => new Promise((ok, fail) => { const id = ++next; waiting.set(id, { ok, fail }); socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) })); });
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  ({ sessionId } = await send('Target.attachToTarget', { targetId, flatten: true }));
  await send('Runtime.enable'); await send('Page.enable');
  await send('Page.navigate', { url });
  const evaluate = async expression => {
    const { result, exceptionDetails } = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (exceptionDetails) throw new Error(`${exceptionDetails.exception?.description ?? exceptionDetails.text}\n${problems.join('\n')}`);
    return result.value;
  };
  for (let i = 0; !(await evaluate('!!window.__ready').catch(() => false)); i++) { if (i > 100) throw new Error(`page not ready\n${problems.join('\n')}`); await sleep(100); }
  const centre = async selector => evaluate(`(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
  const move = async ({ x, y }) => send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
  const close = async () => {
    const exited = new Promise(ok => { if (child.exitCode !== null) ok(); else child.once('exit', ok); });
    sessionId = undefined;
    await Promise.race([send('Browser.close').catch(() => {}), sleep(3000)]);
    await Promise.race([exited, sleep(3000)]);
    try { socket.close(); } catch { /* closed */ }
    if (child.exitCode === null) { child.kill('SIGKILL'); await exited; }
    await sleep(200);
    try { rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); } catch { /* a late Chromium helper still writing: leave the temporary profile */ }
  };
  return { evaluate, centre, move, close };
}

async function oneRun(wav, url) {
  const page = await browser(wav, url);
  try {
    const blank = await page.centre('#blank');
    const spots = await Promise.all([0, 1, 2, 3].map(k => page.centre(`[data-el="${k}"]`)));
    await page.move(blank);
    const started = await page.evaluate('window.begin()');
    if (started.kind !== 'recording') throw new Error(`capture refused: ${started.reason}`);
    // Beep 0 is followed as soon as the page hears it; the others are moved to on the beep schedule measured from beep 0, so the
    // pointer arrives at each beep time; it leaves for empty space 700 ms later (narration between beeps is over nothing).
    await page.evaluate('nextBeep(0)');
    const t0 = Date.now();
    for (let k = 0; k < BEEPS.length; k++) {
      if (k) await sleep(Math.max(0, t0 + (BEEPS[k] - BEEPS[0]) * 1000 - Date.now()));
      await page.move(spots[k]);
      await sleep(700);
      await page.move(blank);
    }
    await page.evaluate(`nextBeep(${BEEPS.length - 1})`);
    await sleep(400);
    return await page.evaluate('window.finish()');
  } finally { await page.close(); }
}

const stats = values => { const abs = values.map(Math.abs); return { mean: abs.reduce((a, b) => a + b, 0) / abs.length, max: Math.max(...abs), signedMean: values.reduce((a, b) => a + b, 0) / values.length }; };
const fmt = n => (n === null || n === undefined || Number.isNaN(n) ? '—' : n.toFixed(1));

async function main() {
  if (!existsSync(chromium)) throw new Error(`No Chromium at ${chromium}; set CHROMIUM`);
  if (!existsSync(join(root, 'packages/feedback/dist/page/voice/index.js'))) throw new Error('Run npm run build first');
  mkdirSync(evidence, { recursive: true });
  const wav = join(evidence, 'beeps.wav');
  writeFileSync(wav, beepWav());
  const bundled = await build({ entryPoints: [join(root, 'packages/feedback/dist/page/voice/index.js')], bundle: true, write: false, format: 'iife', globalName: 'Voice', platform: 'browser', logLevel: 'silent' });
  const html = PAGE(bundled.outputFiles[0].text.replace(/<\/script/g, '<\\/script'));
  const server = createServer((request, response) => { response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); response.end(html); });
  await new Promise(ok => server.listen(0, '127.0.0.1', ok));
  const url = `http://127.0.0.1:${server.address().port}/`;
  const results = [];
  try {
    for (let run = 0; run < runs; run++) {
      const result = await oneRun(wav, url);
      results.push(result);
      console.log(`run ${run + 1}/${runs}: ${result.onsets.length} beeps recorded, ${result.live.length} heard live, startedAt ${fmt(result.capture.startedAt)}`);
    }
  } finally { server.close(); }
  writeFileSync(join(evidence, 'runs.json'), JSON.stringify(results, null, 2));
  report(results);
}

/** Page time of the recording's first sample by each strategy, from the page's anchors (null when unavailable). */
const STRATEGIES = {
  'start() call': r => r.anchors.startCall,
  'start event (performance.now)': r => r.anchors.startEvent,
  'start event (event.timeStamp)': r => r.anchors.startEventStamp,
  'first track frame at or after start() (MediaStreamTrackProcessor timestamp)': r => r.frames.find(([stamp]) => stamp >= r.anchors.startCall)?.[0] ?? null,
  'stop event − decoded duration': r => r.anchors.stopEvent - r.duration * 1000,
  'stop() call − decoded duration': r => r.anchors.stopCall - r.duration * 1000,
  'first chunk − its decoded duration': r => (r.anchors.firstChunk === null || r.anchors.firstChunkMs === null ? null : r.anchors.firstChunk - r.anchors.firstChunkMs),
};
const CHOSEN = 'start() call';

/**
 * Time the fake microphone dropped before page time `t`: its frames' timestamps should advance by one frame each; a headless
 * Chromium under load skips ticks (FakeAudioWorker), so file time falls behind page time. A real microphone is clocked by its
 * hardware and does not drop time this way, so the "real-time equivalent" columns remove these gaps from every page time.
 */
function droppedBefore(r, t) {
  const frames = r.frames;
  let dropped = 0;
  for (let i = 1; i < frames.length && frames[i][0] <= t; i++) dropped = frames[i][0] - frames[0][0] - i * r.frameMs;
  return Math.max(0, dropped);
}

function report(results) {
  const table = Object.entries(STRATEGIES).map(([name, of]) => {
    const raw = [], realtime = [];
    for (const r of results) {
      if (r.onsets.length !== r.live.length) continue;
      const startedAt = of(r);
      if (startedAt === null || startedAt === undefined || Number.isNaN(startedAt)) continue;
      // An end-anchored strategy's anchor is the stop; its real-time equivalent removes the drops before the stop.
      const anchor = /stop|chunk/.test(name) ? (name.includes('chunk') ? r.anchors.firstChunk : name.includes('event') ? r.anchors.stopEvent : r.anchors.stopCall) : startedAt;
      const startedRealtime = startedAt - droppedBefore(r, anchor);
      r.onsets.forEach((at, k) => {
        const truth = r.live[k].stamp;
        raw.push(startedAt + at * 1000 - truth);
        realtime.push(startedRealtime + at * 1000 - (truth - droppedBefore(r, truth)));
      });
    }
    return { name, n: raw.length, raw: raw.length ? stats(raw) : null, realtime: realtime.length ? stats(realtime) : null };
  });
  const ranked = table.filter(row => row.realtime).sort((x, y) => x.realtime.max - y.realtime.max);
  const chosen = table.find(row => row.name === CHOSEN);
  const pointerLag = [];
  for (const r of results) r.live.forEach((l, k) => { const arrival = r.pointer.find(p => p.target === k); if (arrival) pointerLag.push(arrival.t - l.stamp); });
  const delivery = results.flatMap(r => r.live.map(l => l.arrival + r.frameMs - l.stamp)); // the frame's arrival in the page minus its timestamp
  const drops = results.map(r => droppedBefore(r, Infinity));
  const alignment = results.map(r => ({ dwell: r.aligned.map(a => a.target), pin: r.pinned.map(a => a.target) }));
  const alignOk = alignment.every(a => a.dwell.length === BEEPS.length && a.dwell.every((t, k) => t === k) && a.pin.every((t, k) => t === k));
  const captureMatches = results.every(r => Math.abs(r.capture.startedAt - r.anchors.startCall) < 2);
  const cell = s => (s ? `${fmt(s.mean)} / ${fmt(s.max)} / ${fmt(s.signedMean)}` : '—');
  const md = [
    '# Feedback voice: clock alignment in Chromium',
    '',
    `Measured by \`npm run feedback:voice-sync\` (tools/feedback-voice-sync.mjs) on ${new Date().toISOString().slice(0, 10)}: ${results.length} runs, ${BEEPS.length} beeps per run (${BEEPS.join(', ')} s into a generated WAV fed as the fake microphone), headless Chromium ${chromium.includes('chromium-1243') ? '153 (Playwright chromium-1243)' : chromium}, on a shared VM under load.`,
    '',
    'Error = the beep onset found in the recorded blob, put on the page clock with the strategy, minus the ground truth: the same beep on a second reader of the microphone (MediaStreamTrackProcessor on a cloned track), at its frame timestamp plus the onset sample (frame timestamps are on the page clock: they precede the frame\'s arrival in the page by a few ms when the page is idle). Positive = speech placed later than it was heard. Cells: mean abs / max abs / signed mean, ms.',
    '',
    `The fake microphone dropped ${drops.map(d => fmt(d)).join(', ')} ms of audio time per run (its frame timestamps jump; headless Chromium skips ticks of the fake device under CPU load), so every recorded sample after a drop sits later on the page clock than a single offset predicts. A real microphone is hardware-clocked and does not drop time like this, so the "real-time equivalent" column removes those gaps (from the anchors and from the ground truth) and is the one the strategy is chosen on; the raw column is what this loaded machine produced.`,
    '',
    '| Strategy for `startedAt` | n | real-time equivalent | raw (with fake-device drops) |',
    '| --- | --- | --- | --- |',
    ...table.map(row => `| ${row.name}${row.name === CHOSEN ? ' **(chosen)**' : ''} | ${row.n} | ${cell(row.realtime)} | ${cell(row.raw)} |`),
    '',
    `Most accurate (real-time equivalent, by max): **${ranked[0]?.name ?? 'none'}** (${fmt(ranked[0]?.realtime.max)} ms). Chosen in createVoiceCapture: **${CHOSEN}** — max ${fmt(chosen?.realtime?.max)} ms real-time equivalent, ${chosen?.realtime && chosen.realtime.max <= TARGET_MAX_MS ? `within the ${TARGET_MAX_MS} ms target` : `ABOVE the ${TARGET_MAX_MS} ms target`}; raw max ${fmt(chosen?.raw?.max)} ms.`,
    '',
    `The capture's own \`startedAt\` ${captureMatches ? 'equals' : 'DOES NOT equal'} the chosen anchor in every run (within 2 ms).`,
    '',
    `Ground-truth reader: a beep's frame reached the page script this long after its timestamp: mean ${fmt(stats(delivery).signedMean)} ms, max ${fmt(stats(delivery).max)} ms.`,
    `Pointer arrival on the beep's element minus the beep's ground truth (the driver aims each move at the beep from beep 0's schedule, so drops make later moves early): mean ${fmt(stats(pointerLag).signedMean)} ms, max abs ${fmt(stats(pointerLag).max)} ms.`,
    '',
    `alignSpeech on the measured runs (one segment from 0.15 s before to 0.45 s after each recorded beep, the capture's own startedAt, the recorded pointer, no pins; then pins only, 300 ms after each beep): ${alignOk ? 'every segment landed on the element hovered at its beep, by dwell and by pin' : 'MISMATCH'} — dwell targets per run ${alignment.map(a => `[${a.dwell.join(',')}]`).join(' ')}.`,
    '',
    'Scope: Chromium only (fake-microphone file and MediaStreamTrackProcessor); Firefox and WebKit are not measured. A fake device has no hardware input latency: a real microphone adds its own (typically 10–40 ms) before both the recording and the ground truth see the audio, so it does not change these differences.',
    '',
  ].join('\n');
  writeFileSync(join(evidence, 'RESULT.md'), md);
  console.log(md);
  if (!alignOk || !captureMatches || !chosen?.realtime || chosen.realtime.max > TARGET_MAX_MS) process.exitCode = 1;
}

if (process.argv.includes('--report-only')) report(JSON.parse(readFileSync(join(evidence, 'runs.json'), 'utf8')));
else await main();
