// Feedback voice: speech-to-pointer alignment, the microphone capture's refusals and truncation, and the browser boundary.
// Transcription itself is a host capability, not part of @hachej/boring-feedback: the session takes a `transcribe` callback
// (feedback-session.test.mjs), and the example's server-side glue is tested in feedback-transcription-example.test.mjs.
// Fictional data only. The clock itself is measured in Chromium by `npm run feedback:voice-sync` (tools/feedback-voice-sync.mjs),
// not here.
import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { alignSpeech, createVoiceCapture, PIN_AFTER_MS } from '@hachej/boring-feedback/page';
import { checkPlatformApis } from '../../scripts/check-platform-apis.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const targets = aligned => aligned.map(a => [a.text, a.target, a.confidence]);

// ---------------------------------------------------------------- alignSpeech
// Audio starts at page time 1000. Pointer: nothing, then element 0 at 1500, element 1 at 3000, nothing at 4500.
const POINTER = [{ t: 900, target: null }, { t: 1500, target: 0 }, { t: 3000, target: 1 }, { t: 4500, target: null }];

test('alignSpeech: a segment attaches to the element the pointer dwelt on longest during it', () => {
  const out = alignSpeech({ audioStartedAt: 1000, pointer: POINTER, pins: [], segments: [
    { start: 0.6, end: 1.8, text: 'This button label is wrong' }, // 1600–2800: element 0 only
    { start: 1.5, end: 2.6, text: 'and this field too' }, // 2500–3600: 500 ms on 0, 600 ms on 1
  ] });
  assert.deepEqual(targets(out), [['This button label is wrong', 0, 'dwell'], ['and this field too', 1, 'dwell']]);
  assert.equal(out[0].at, 1600);
});

test('alignSpeech: a pin placed during the segment, or within a second after it, wins over dwell', () => {
  const during = alignSpeech({ audioStartedAt: 1000, pointer: POINTER, pins: [{ t: 2000, target: 3 }], segments: [{ start: 0.6, end: 1.8, text: 'this one' }] });
  assert.deepEqual(targets(during), [['this one', 3, 'pin']]);
  const after = alignSpeech({ audioStartedAt: 1000, pointer: POINTER, pins: [{ t: 2800 + PIN_AFTER_MS - 1, target: 2 }], segments: [{ start: 0.6, end: 1.8, text: 'this one' }] });
  assert.deepEqual(targets(after), [['this one', 2, 'pin']]);
  const late = alignSpeech({ audioStartedAt: 1000, pointer: POINTER, pins: [{ t: 2800 + PIN_AFTER_MS + 1, target: 2 }], segments: [{ start: 0.6, end: 1.8, text: 'this one' }] });
  assert.deepEqual(targets(late), [['this one', 0, 'dwell']]);
  // Inside beats after; the earliest inside wins.
  const both = alignSpeech({ audioStartedAt: 1000, pointer: POINTER, pins: [{ t: 2900, target: 2 }, { t: 2400, target: 3 }, { t: 2200, target: 1 }], segments: [{ start: 0.6, end: 1.8, text: 'x' }] });
  assert.deepEqual(targets(both), [['x', 1, 'pin']]);
});

test('alignSpeech: a pin after a segment does not claim it once the next segment has started', () => {
  const out = alignSpeech({ audioStartedAt: 0, pointer: [], pins: [{ t: 1300, target: 4 }], segments: [
    { start: 0, end: 1, text: 'first remark' }, { start: 1.2, end: 2, text: 'second remark' },
  ] });
  assert.deepEqual(targets(out), [['first remark', null, 'none'], ['second remark', 4, 'pin']]);
});

test('alignSpeech: narration over nothing is general (target null)', () => {
  const out = alignSpeech({ audioStartedAt: 1000, pointer: POINTER, pins: [], segments: [{ start: 3.6, end: 5, text: 'Overall the page feels slow' }] });
  assert.deepEqual(targets(out), [['Overall the page feels slow', null, 'none']]);
});

test('alignSpeech: overlapping segments are each aligned on their own window, in time order', () => {
  const out = alignSpeech({ audioStartedAt: 1000, pointer: POINTER, pins: [], segments: [
    { start: 1.9, end: 3.2, text: 'B' }, // 2900–4200: mostly element 1
    { start: 0.4, end: 2.2, text: 'A' }, // 1400–3200: mostly element 0
  ] });
  assert.deepEqual(targets(out), [['A', 0, 'dwell'], ['B', 1, 'dwell']]);
});

test('alignSpeech: a sample holds across pointer gaps until the next sample; a segment before the first sample is unknown', () => {
  const sparse = [{ t: 2000, target: 5 }, { t: 9000, target: null }];
  const out = alignSpeech({ audioStartedAt: 0, pointer: sparse, pins: [], segments: [
    { start: 0.5, end: 1.5, text: 'before any pointer' }, { start: 4, end: 6, text: 'during a long gap' }, { start: 9.5, end: 10, text: 'after leaving' },
  ] });
  assert.deepEqual(targets(out), [['before any pointer', null, 'none'], ['during a long gap', 5, 'dwell'], ['after leaving', null, 'none']]);
  // Partly before the first sample: only the known part counts.
  assert.deepEqual(targets(alignSpeech({ audioStartedAt: 0, pointer: sparse, pins: [], segments: [{ start: 1.5, end: 2.2, text: 'x' }] })), [['x', 5, 'dwell']]);
  // Unsorted pointer samples are sorted first; a zero-length segment takes the sample holding at that instant.
  const unsorted = [{ t: 3000, target: 2 }, { t: 1000, target: 1 }];
  assert.deepEqual(targets(alignSpeech({ audioStartedAt: 0, pointer: unsorted, pins: [], segments: [{ start: 3, end: 3, text: 'now' }, { start: 2, end: 2, text: 'then' }] })), [['then', 1, 'dwell'], ['now', 2, 'dwell']]);
});

test('alignSpeech: ties go to the element reached first', () => {
  const pointer = [{ t: 0, target: 7 }, { t: 500, target: 8 }];
  assert.deepEqual(targets(alignSpeech({ audioStartedAt: 0, pointer, pins: [], segments: [{ start: 0, end: 1, text: 'x' }] })), [['x', 7, 'dwell']]);
});

test('alignSpeech: empty, blank and invalid inputs', () => {
  assert.deepEqual(alignSpeech({ audioStartedAt: 0, pointer: [], pins: [], segments: [] }), []);
  assert.deepEqual(alignSpeech({ audioStartedAt: Number.NaN, pointer: POINTER, pins: [], segments: [{ start: 0, end: 1, text: 'x' }] }), []);
  const out = alignSpeech({ audioStartedAt: 0, pointer: [], pins: [], segments: [{ start: 0, end: 1, text: '   ' }, { start: Number.NaN, end: 1, text: 'bad' }, { start: 2, end: 1, text: ' reversed ' }] });
  assert.deepEqual(out, [{ target: null, text: 'reversed', at: 2000, confidence: 'none' }]);
});

test('alignSpeech: with word timings a segment splits where the pointer moved; without them it never splits', () => {
  const words = [
    { start: 0.6, end: 0.9, text: 'this' }, { start: 0.9, end: 1.3, text: 'label' }, // 1600–2300: element 0
    { start: 1.9, end: 2.2, text: 'and' }, // 2900–3200: mostly element 1
    { start: 2.3, end: 2.7, text: 'this' }, { start: 2.7, end: 3.2, text: 'field' }, // element 1
  ];
  const segment = { start: 0.6, end: 3.2, text: 'this label and this field', words };
  assert.deepEqual(targets(alignSpeech({ audioStartedAt: 1000, pointer: POINTER, pins: [], segments: [segment] })), [['this label', 0, 'dwell'], ['and this field', 1, 'dwell']]);
  const { words: _ignored, ...whole } = segment;
  // Whole: 1400 ms over element 0 against 1200 ms over element 1.
  assert.deepEqual(targets(alignSpeech({ audioStartedAt: 1000, pointer: POINTER, pins: [], segments: [whole] })), [['this label and this field', 0, 'dwell']]);
  // Words over nothing stay with the group before them; a leading word over nothing joins the first element group.
  const moving = [{ t: 0, target: null }, { t: 1000, target: 0 }, { t: 2000, target: null }, { t: 2500, target: 1 }];
  const split = alignSpeech({ audioStartedAt: 0, pointer: moving, pins: [], segments: [{ start: 0.5, end: 3, text: 'so this then that', words: [
    { start: 0.5, end: 0.8, text: 'so' }, { start: 1.2, end: 1.5, text: 'this' }, { start: 2.1, end: 2.3, text: 'then' }, { start: 2.6, end: 3, text: 'that' },
  ] }] });
  assert.deepEqual(targets(split), [['so this then', 0, 'dwell'], ['that', 1, 'dwell']]);
});

// ---------------------------------------------------------------- createVoiceCapture
class FakeRecorder extends EventTarget {
  static supported = new Set(['audio/webm;codecs=opus']);
  static isTypeSupported(type) { return FakeRecorder.supported.has(type); }
  static last;
  constructor(stream, options = {}) { super(); this.stream = stream; this.mimeType = options.mimeType ?? ''; this.state = 'inactive'; this.calls = []; FakeRecorder.last = this; }
  start(slice) { this.calls.push(['start', slice]); this.state = 'recording'; queueMicrotask(() => this.dispatchEvent(new Event('start'))); }
  stop() {
    this.calls.push(['stop']); this.state = 'inactive';
    setTimeout(() => {
      const event = new Event('dataavailable'); event.data = new Blob([new Uint8Array([1, 2, 3, 4])], { type: this.mimeType }); this.dispatchEvent(event);
      this.dispatchEvent(new Event('stop'));
    }, 1);
  }
}
const fakeStream = () => { const track = { stopped: false, stop() { this.stopped = true; } }; return { track, stream: { getTracks: () => [track], getAudioTracks: () => [track] } }; };
function withRecorder(t, Recorder = FakeRecorder) {
  const before = Object.getOwnPropertyDescriptor(globalThis, 'MediaRecorder');
  Object.defineProperty(globalThis, 'MediaRecorder', { configurable: true, writable: true, value: Recorder ?? undefined });
  t.after(() => { if (before) Object.defineProperty(globalThis, 'MediaRecorder', before); else delete globalThis.MediaRecorder; });
}
const clock = () => { let time = 100; return { now: () => (time += 10), set: value => { time = value; } }; };

test('createVoiceCapture: refuses without MediaRecorder, before opening the microphone', async t => {
  withRecorder(t, null);
  let asked = 0;
  const capture = createVoiceCapture({ getUserMedia: async () => { asked++; return fakeStream().stream; } });
  const result = await capture.start();
  assert.equal(result.kind, 'refused');
  assert.equal(result.code, 'unsupported');
  assert.match(result.reason, /^This browser cannot record audio here\. \(no MediaRecorder\)$/);
  assert.equal(asked, 0);
  assert.equal(await capture.stop(), null);
});

test('createVoiceCapture: refuses when the microphone is unavailable or the permission is denied', async t => {
  withRecorder(t);
  // Node has no navigator.mediaDevices: the feature-detected default refuses instead of throwing.
  const none = await createVoiceCapture().start();
  assert.deepEqual(none, { kind: 'refused', code: 'unsupported', reason: 'This browser cannot record audio here.' });
  // On an insecure origin (http on a name other than localhost) browsers hide media devices: the message says how to fix it.
  const where = Object.getOwnPropertyDescriptor(globalThis, 'location');
  try {
    Object.defineProperty(globalThis, 'location', { configurable: true, writable: true, value: { protocol: 'http:', hostname: 'insecure.test' } });
    assert.deepEqual(await createVoiceCapture().start(), { kind: 'refused', code: 'insecure', reason: 'Recording needs a secure page (https or localhost).' });
    Object.defineProperty(globalThis, 'location', { configurable: true, writable: true, value: { protocol: 'https:', hostname: 'fictional.invalid' } });
    assert.equal((await createVoiceCapture().start()).code, 'unsupported', 'on https, missing devices are the browser\'s');
  } finally { if (where) Object.defineProperty(globalThis, 'location', where); else delete globalThis.location; }
  const denied = await createVoiceCapture({ getUserMedia: async () => { throw Object.assign(new Error('Permission denied'), { name: 'NotAllowedError' }); } }).start();
  assert.deepEqual(denied, { kind: 'refused', code: 'denied', reason: 'Microphone blocked. Allow it for this site in the browser, then press Record again.' });
  const missing = await createVoiceCapture({ getUserMedia: async () => { throw Object.assign(new Error('none'), { name: 'NotFoundError' }); } }).start();
  assert.deepEqual(missing, { kind: 'refused', code: 'no-microphone', reason: 'No microphone found. Connect one, then press Record again.' });
  const busy = await createVoiceCapture({ getUserMedia: async () => { throw Object.assign(new Error('in use'), { name: 'NotReadableError' }); } }).start();
  assert.equal(busy.code, 'busy');
  // A recorder the browser cannot build releases the microphone it opened.
  const { track, stream } = fakeStream();
  withRecorder(t, class extends FakeRecorder { constructor() { super(); throw new Error('unsupported track'); } });
  const broken = await createVoiceCapture({ getUserMedia: async () => stream }).start();
  assert.equal(broken.kind, 'refused');
  assert.equal(broken.code, 'unsupported');
  assert.equal(track.stopped, true);
});

test('createVoiceCapture: records with startedAt on the injected page clock, read just before MediaRecorder.start()', async t => {
  withRecorder(t);
  const { track, stream } = fakeStream();
  const time = clock();
  let constraints;
  const capture = createVoiceCapture({ getUserMedia: async c => { constraints = c; time.set(5000); return stream; }, now: time.now });
  assert.deepEqual(await capture.start(), { kind: 'recording' });
  assert.deepEqual(constraints, { audio: true });
  assert.deepEqual(FakeRecorder.last.calls, [['start', 1000]]);
  assert.equal(FakeRecorder.last.mimeType, 'audio/webm;codecs=opus');
  assert.deepEqual(await capture.start(), { kind: 'refused', code: 'failed', reason: 'Already recording.' });
  const result = await capture.stop();
  assert.equal(result.startedAt, 5010);
  assert.ok(result.endedAt > result.startedAt);
  assert.equal(result.truncated, false);
  assert.equal(result.mimeType, 'audio/webm;codecs=opus');
  assert.equal(result.audio.size, 4);
  assert.equal(track.stopped, true, 'the microphone is released');
  assert.equal(await capture.stop(), null, 'stopping twice gives nothing');
});

test('createVoiceCapture: maxMs stops the recording on its own and stop() reports it truncated', async t => {
  withRecorder(t);
  const { track, stream } = fakeStream();
  const capture = createVoiceCapture({ getUserMedia: async () => stream, maxMs: 15 });
  assert.equal((await capture.start()).kind, 'recording');
  await new Promise(resolve => setTimeout(resolve, 60));
  assert.equal(FakeRecorder.last.state, 'inactive');
  assert.equal(track.stopped, true);
  const result = await capture.stop();
  assert.equal(result.truncated, true);
  assert.equal(result.audio.size, 4);
});

test('createVoiceCapture: cancel discards the audio and releases the microphone, also while it is opening', async t => {
  withRecorder(t);
  const first = fakeStream();
  const capture = createVoiceCapture({ getUserMedia: async () => first.stream });
  await capture.start();
  capture.cancel();
  assert.equal(first.track.stopped, true);
  assert.equal(await capture.stop(), null);
  const second = fakeStream();
  let open;
  const slow = createVoiceCapture({ getUserMedia: () => new Promise(resolve => { open = () => resolve(second.stream); }) });
  const starting = slow.start();
  await Promise.resolve();
  slow.cancel();
  open();
  assert.equal((await starting).kind, 'refused');
  assert.equal(second.track.stopped, true);
  const again = slow.start();
  await Promise.resolve();
  open();
  assert.equal((await again).kind, 'recording', 'a cancelled capture can start again');
  slow.cancel();
});

// ---------------------------------------------------------------- boundaries
test('the page and ui browser bundle holds the voice capture and no server code', async () => {
  const result = await build({ stdin: { contents: "export * from '@hachej/boring-feedback/page'; export * from '@hachej/boring-feedback/ui';", resolveDir: root }, bundle: true, write: false, format: 'esm', platform: 'browser', metafile: true, logLevel: 'silent' });
  const inputs = Object.keys(result.metafile.inputs);
  assert.ok(inputs.some(path => path.includes('feedback/dist/page/voice/')), 'the voice capture is in the page bundle');
  assert.deepEqual(inputs.filter(path => /feedback\/dist\/(store|agent|tickets|source)\/|examples\/|node:/.test(path)), []);
  // The capture is the only feedback file allowed to reach getUserMedia, and it feature-detects (npm run check).
  assert.deepEqual(checkPlatformApis(root).errors, []);
});
