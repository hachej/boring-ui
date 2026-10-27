import assert from 'node:assert/strict';
import test from 'node:test';
import { Window } from 'happy-dom';
import { useChatVoice, useDictation, useVoiceAttempt, useVoiceMessage } from '@hachej/boring-ui-kit/chat-react';
import { voiceRefusalLabel } from '@hachej/boring-ui-kit/chat-text';
import { DEFAULT_MAX_VOICE_MS } from '@hachej/boring-ui-kit/voice-capture';

const window = new Window({ url: 'https://fictional.invalid/' });
for (const name of ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node', 'Text', 'MutationObserver']) {
  Object.defineProperty(globalThis, name, { configurable: true, value: name === 'window' ? window : window[name] });
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { act, createElement: h, StrictMode, Suspense, startTransition } = await import('react');
const { createRoot } = await import('react-dom/client');
test.after(() => window.happyDOM.close());
const words = Object.fromEntries([...Object.values(voiceRefusalLabel), 'voiceNothingHeard', 'voiceTranscribeFailed'].map(key => [key, `fictional:${key}`]));
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const flush = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
async function mount(t, hook, initial) {
  const tracks = []; const microphone = { pending: [], refusal: undefined };
  Object.defineProperty(window.navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: async () => {
    const gate = microphone.pending.shift(); if (gate) await gate.promise;
    if (microphone.refusal) throw Object.assign(new Error('fictional refusal'), { name: microphone.refusal });
    const track = { stopped: false, stop() { this.stopped = true; } }; tracks.push(track); return { getTracks: () => [track] };
  } } });
  class Recorder extends EventTarget {
    static isTypeSupported() { return true; }
    constructor() { super(); this.state = 'inactive'; this.mimeType = 'audio/webm'; }
    start() { this.state = 'recording'; }
    stop() {
      this.state = 'inactive'; const event = new Event('dataavailable'); event.data = new Blob(['fictional audio'], { type: this.mimeType });
      this.dispatchEvent(event); this.dispatchEvent(new Event('stop'));
    }
  }
  globalThis.MediaRecorder = Recorder;
  const element = document.createElement('div'); document.body.append(element); const root = createRoot(element); let api;
  const Probe = props => { const value = hook(props); if (props.suspend) throw props.suspend; api = value; return h('span', null, api.phase ?? 'core'); };
  const tree = props => h(StrictMode, null, h(Suspense, { fallback: 'waiting' }, h(Probe, props)));
  const render = props => act(async () => root.render(tree(props)));
  const transition = props => act(async () => startTransition(() => root.render(tree(props))));
  await render(initial);
  t.after(async () => { await act(async () => root.unmount()); element.remove(); });
  return { get api() { return api; }, tracks, microphone, render, transition, unmount: () => act(async () => root.unmount()) };
}

test('the public attempt core defaults to the existing five-minute cap and cancels only its own capture', async t => {
  const page = await mount(t, () => useVoiceAttempt(), {}); let first, second;
  await act(async () => { first = page.api.start({ subject: 'fictional A' }); second = page.api.start({ subject: 'fictional B' }); });
  assert.equal(first.maxMs, DEFAULT_MAX_VOICE_MS);
  assert.notEqual(first.id, second.id);
  await act(async () => page.api.remove(first));
  assert.equal(first.abort.signal.aborted, true);
  assert.equal(second.abort.signal.aborted, false);
  assert.equal(page.tracks[0].stopped, true);
  assert.equal(page.tracks[1].stopped, false, 'another attempt keeps its microphone');
});

test('browser cancellation drops owned recording attempts but leaves processing work intact', async t => {
  const page = await mount(t, () => useVoiceAttempt(), {}); let processing, recording;
  await act(async () => { processing = page.api.start({}); recording = page.api.start({}); });
  await act(async () => page.api.stop(processing));
  await act(async () => window.dispatchEvent(new window.Event('blur')));
  assert.equal(recording.abort.signal.aborted, true);
  assert.equal(processing.abort.signal.aborted, false);
  assert.deepEqual(page.api.current(), [processing]);
});

test('dictation forwards maxMs, retains capped audio until finish and trims delivery', async t => {
  const delivered = [];
  const page = await mount(t, useDictation, { labels: words, maxMs: 20, transcribe: async () => '  fictional note  ', onText: text => delivered.push(text) });
  await act(async () => page.api.start());
  await act(async () => new Promise(resolve => setTimeout(resolve, 60)));
  assert.equal(page.tracks[0].stopped, true);
  assert.equal(page.api.phase, 'recording', 'capture is capped but delivery still waits for finish');
  assert.deepEqual(delivered, []);
  await act(async () => page.api.finish());
  assert.deepEqual(delivered, ['fictional note']);
  assert.equal(page.api.phase, 'idle');
});

test('finish during starting fences late permission without cancelling a newer dictation attempt', async t => {
  const page = await mount(t, useDictation, { labels: words, transcribe: async () => 'fictional', onText() {} });
  const old = deferred(); page.microphone.pending.push(old);
  await act(async () => page.api.start());
  assert.equal(page.api.phase, 'starting');
  await act(async () => page.api.finish());
  assert.equal(page.api.phase, 'idle');
  await act(async () => page.api.start());
  assert.equal(page.api.phase, 'recording');
  await act(async () => old.resolve());
  assert.equal(page.tracks[0].stopped, false, 'newer microphone remains open');
  assert.equal(page.tracks[1].stopped, true, 'the late cancelled microphone is released');
  assert.equal(page.api.phase, 'recording');
});

test('target replacement aborts pending transcription and ignores a noncooperative late reply', async t => {
  const reply = deferred(), delivered = []; let signal;
  const options = { labels: words, target: 'fictional A', transcribe: async (_, abort) => { signal = abort; return reply.promise; }, onText: text => delivered.push(text) };
  const page = await mount(t, useDictation, options);
  await act(async () => page.api.start()); await act(async () => page.api.finish());
  assert.equal(page.api.phase, 'transcribing');
  await page.render({ ...options, target: 'fictional B' });
  assert.equal(signal.aborted, true);
  await act(async () => reply.resolve('old subject'));
  assert.deepEqual(delivered, []);
  assert.equal(page.api.phase, 'idle');
});

test('a suspended target change cannot cancel committed dictation or capture uncommitted callbacks', async t => {
  const reply = deferred(), suspended = deferred(), delivered = [];
  const options = { labels: words, target: 'fictional A', transcribe: async () => reply.promise, onText: text => delivered.push(['A', text]) };
  const page = await mount(t, useDictation, options);
  await act(async () => page.api.start()); await act(async () => page.api.finish());
  await page.transition({ ...options, target: 'fictional B', suspend: suspended.promise, onText: text => delivered.push(['B', text]) });
  await act(async () => reply.resolve('committed note'));
  assert.deepEqual(delivered, [['A', 'committed note']], 'the still-visible committed subject receives its result');
  await act(async () => page.api.start()); await act(async () => page.api.finish());
  assert.deepEqual(delivered, [['A', 'committed note'], ['A', 'committed note']], 'visible Start keeps committed callbacks while B is suspended');
});

test('refusals and empty/failed transcripts use injected label keys; unmount releases the microphone', async t => {
  let transcript = '', fail = false;
  const page = await mount(t, useDictation, { labels: words, transcribe: async () => { if (fail) throw new Error('fictional'); return transcript; }, onText() {} });
  for (const [name, key] of [['NotAllowedError', 'voiceDenied'], ['NotFoundError', 'voiceNoMicrophone'], ['NotReadableError', 'voiceBusy']]) {
    page.microphone.refusal = name; await act(async () => page.api.start()); assert.equal(page.api.problem, words[key]);
  }
  page.microphone.refusal = undefined;
  await act(async () => page.api.start()); await act(async () => page.api.finish());
  assert.equal(page.api.problem, words.voiceNothingHeard);
  fail = true; await act(async () => page.api.start()); await act(async () => page.api.finish());
  assert.equal(page.api.problem, words.voiceTranscribeFailed);
  transcript = 'unused'; await act(async () => page.api.start());
  await page.unmount(); assert.ok(page.tracks.every(track => track.stopped));
});

function chat() {
  const listeners = new Set(); let draft = { text: 'later typed draft', attachments: [] };
  let snapshot = { identity: { runtimeId: 'fictional', scopeId: 'fictional', principalId: 'fictional' }, conversationId: '1', disposed: false, draft, outbox: [], send: { kind: 'idle' } };
  const sent = []; let unknown = false;
  const controller = { getSnapshot: () => snapshot, subscribe: change => { listeners.add(change); return () => listeners.delete(change); },
    setText: text => { draft = { ...draft, text }; snapshot = { ...snapshot, draft }; },
    send: (mode, options) => {
      sent.push({ mode, options }); const submitted = { text: options.text, attachments: [] };
      const attempt = { requestId: 'fictional-request', draft: submitted };
      snapshot = { ...snapshot, send: { kind: 'validating', draft: submitted } };
      return Promise.resolve().then(() => { snapshot = { ...snapshot, send: { kind: unknown ? 'unknown' : 'admitted', attempt } }; return unknown ? undefined : { id: 'fictional-admitted' }; });
    },
  };
  return { controller, sent, listeners, uncertain: () => { unknown = true; }, admitted: () => {
    snapshot = { ...snapshot, send: { ...snapshot.send, kind: 'admitted' } }; for (const change of listeners) change();
  } };
}

test('voice message retries only the failed half, then sends one followUp without replacing the typed draft', async t => {
  const native = chat(); let uploads = 0, transcripts = 0, fail = true, admitted = 0;
  const page = await mount(t, useVoiceMessage, { controller: native.controller, labels: words, admitted: () => { admitted++; }, config: {
    transcribe: async () => { transcripts++; if (fail) throw new Error('fictional transcription failure'); return 'fictional transcript'; },
    upload: async files => { uploads++; return [{ path: `uploads/${files[0].name}` }]; },
  } });
  await act(async () => page.api.start()); await act(async () => page.api.finish());
  assert.equal(page.api.pending[0].phase, 'transcribe-failed');
  assert.equal(uploads, 1); assert.equal(native.sent.length, 0);
  fail = false; await act(async () => page.api.pending[0].retry()); await flush();
  assert.equal(transcripts, 2); assert.equal(uploads, 1); assert.equal(native.sent.length, 1);
  assert.equal(native.sent[0].mode, 'followUp');
  assert.match(native.sent[0].options.text, /^@uploads\/voice-.*\.webm fictional transcript$/);
  assert.deepEqual(native.sent[0].options.restore, { text: 'fictional transcript' });
  assert.equal(native.controller.getSnapshot().draft.text, 'later typed draft');
  assert.equal(admitted, 1); assert.deepEqual(page.api.pending, []);
});

test('unknown voice submission waits for its original native admission instead of sending again', async t => {
  const native = chat(); native.uncertain(); let admitted = 0;
  const page = await mount(t, useVoiceMessage, { controller: native.controller, labels: words, admitted: () => { admitted++; }, config: {
    transcribe: async () => 'fictional transcript', upload: async files => [{ path: `uploads/${files[0].name}` }],
  } });
  await act(async () => page.api.start()); await act(async () => page.api.finish()); await flush();
  assert.equal(page.api.phase, 'unconfirmed'); assert.equal(native.sent.length, 1);
  await act(async () => page.api.start()); assert.equal(native.sent.length, 1);
  await act(async () => native.admitted());
  assert.equal(admitted, 1); assert.equal(page.api.phase, 'idle'); assert.deepEqual(page.api.pending, []);
});

for (const mode of ['auto', 'message']) test(`chat voice ${mode} retains selected mentions and restores only transcript text`, async t => {
  const native = chat(); native.controller.setText('@repas:fictional/lunch typed words @docs/menu.md');
  const page = await mount(t, useChatVoice, { controller: native.controller, labels: words, onDone() {}, voice: {
    send: mode, transcribe: async () => 'fictional spoken text', upload: async files => [{ path: `uploads/${files[0].name}` }],
  } });
  await act(async () => page.api.start()); await act(async () => page.api.finish()); await flush();
  assert.match(native.sent[0].options.text, /^@repas:fictional\/lunch @docs\/menu\.md /);
  assert.match(native.sent[0].options.text, /fictional spoken text$/);
  assert.deepEqual(native.sent[0].options.restore, { text: 'fictional spoken text' });
  assert.equal(native.controller.getSnapshot().draft.text.trim(), 'typed words');
});

test('the shared attempt core projects real PCM progress, pauses samples and freezes waveform at the cap', async t => {
  const page = await mount(t, () => useVoiceAttempt(), {});
  const before = Object.getOwnPropertyDescriptor(globalThis, 'AudioContext'); let node;
  globalThis.AudioContext = class {
    constructor() { this.sampleRate = 48000; this.state = 'suspended'; this.destination = {}; }
    resume() { this.state = 'running'; return Promise.resolve(); }
    close() { this.state = 'closed'; return Promise.resolve(); }
    createMediaStreamSource() { return { connect() {}, disconnect() {} }; }
    createScriptProcessor() { node = { onaudioprocess: null, connect() {}, disconnect() {} }; return node; }
  };
  t.after(() => before ? Object.defineProperty(globalThis, 'AudioContext', before) : delete globalThis.AudioContext);
  const feed = value => node.onaudioprocess?.({ inputBuffer: { getChannelData: () => new Float32Array(48000).fill(value) } });
  const tick = () => act(async () => new Promise(resolve => setTimeout(resolve, 130)));
  let item;
  await act(async () => { item = page.api.start({}, 1500); });
  await act(async () => feed(0.25)); await tick();
  assert.equal(item.seconds, 1); assert.equal(item.canPause, true);
  assert.ok(item.levels.length > 0 && Math.abs(item.levels.at(-1) - 0.25) < 0.001);
  await act(async () => page.api.pause(item)); const levels = [...item.levels];
  await act(async () => feed(0.75)); await tick();
  assert.equal(item.paused, true); assert.equal(item.seconds, 1); assert.deepEqual(item.levels, levels);
  await act(async () => page.api.resume(item));
  await act(async () => feed(0.5)); await tick();
  assert.equal(page.tracks[0].stopped, true); assert.equal(item.canPause, false);
  const capped = [...item.levels]; await tick(); assert.deepEqual(item.levels, capped);
  let recording; await act(async () => { recording = await page.api.stop(item); });
  assert.equal(recording.truncated, true); assert.equal(recording.audio.size, 44 + 24000 * 2);
  assert.equal(recording.endedAt - recording.startedAt, 1500);
});

for (const mode of ['draft', 'auto', 'message']) test(`chat voice ${mode} uses the shared lifecycle and native draft/send rules`, async t => {
  const native = chat(), outcomes = [];
  const page = await mount(t, useChatVoice, { controller: native.controller, labels: words, onDone: outcome => outcomes.push(outcome), voice: {
    send: mode, maxMs: 20, transcribe: async () => 'fictional spoken text', upload: async files => [{ path: `uploads/${files[0].name}` }],
  } });
  await act(async () => page.api.start());
  await act(async () => new Promise(resolve => setTimeout(resolve, 60)));
  assert.equal(page.tracks[0].stopped, true, 'every mode forwards the configured cap');
  assert.equal(native.sent.length, 0, 'the cap does not send without finish');
  await act(async () => page.api.finish()); await flush();
  assert.deepEqual(outcomes, [mode === 'draft' ? 'drafted' : 'sent']);
  assert.equal(native.sent.length, mode === 'draft' ? 0 : 1);
  if (mode === 'draft') assert.equal(native.controller.getSnapshot().draft.text, 'later typed draft fictional spoken text');
  else assert.equal(native.sent[0].mode, mode === 'message' ? 'followUp' : undefined);
});
