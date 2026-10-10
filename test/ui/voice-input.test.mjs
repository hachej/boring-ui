// The composer's microphone button (pi-chat/voice-input.tsx) in happy-dom: a fake microphone and recorder, a fake transcriber and a
// fake chat controller. Fictional data only.
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync } from 'node:fs';
import { build } from 'esbuild';
import { Window } from 'happy-dom';

const mount = async t => {
  const window = new Window({ url: 'https://fictional.invalid/', settings: { disableIframePageLoading: true } });
  const names = ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node', 'Text', 'MutationObserver', 'getComputedStyle', 'IS_REACT_ACT_ENVIRONMENT'];
  const globals = new Map([...names, 'MediaRecorder'].map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  for (const name of names) {
    const value = name === 'window' ? window : name === 'IS_REACT_ACT_ENVIRONMENT' ? true : window[name];
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value: typeof value === 'function' && /^[a-z]/.test(name) ? value.bind(window) : value });
  }

  // The fake microphone: each getUserMedia call hands out a stream whose one track records whether it was released.
  const tracks = []; const microphone = { refuse: undefined };
  Object.defineProperty(window.navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: async () => {
    if (microphone.refuse) throw Object.assign(new Error(microphone.refuse), { name: 'NotAllowedError' });
    const track = { stopped: false, stop() { this.stopped = true; } }; tracks.push(track);
    return { getTracks: () => [track], getAudioTracks: () => [track] };
  } } });
  // The fake recorder: stop() delivers one chunk of audio, then the stop event, as MediaRecorder does.
  class FakeRecorder extends EventTarget {
    static isTypeSupported() { return true; }
    constructor() { super(); this.state = 'inactive'; this.mimeType = 'audio/webm'; }
    start() { this.state = 'recording'; }
    stop() {
      this.state = 'inactive';
      const chunk = new Event('dataavailable'); chunk.data = new Blob(['fictional audio'], { type: 'audio/webm' }); this.dispatchEvent(chunk);
      this.dispatchEvent(new Event('stop'));
    }
  }
  globalThis.MediaRecorder = FakeRecorder;

  const out = new URL('../../.cache/voice-input-test/', import.meta.url); mkdirSync(out, { recursive: true });
  await build({ entryPoints: [new URL('../../registry/pi-chat/voice-input.tsx', import.meta.url).pathname], outfile: new URL('voice-input.mjs', out).pathname,
    bundle: true, format: 'esm', platform: 'node', jsx: 'automatic', packages: 'external', logLevel: 'silent' });
  const { VoiceInput } = await import(new URL('voice-input.mjs', out).href);
  const { createElement, act } = await import('react'); const { createRoot } = await import('react-dom/client');

  const element = window.document.createElement('div'); window.document.body.append(element); const root = createRoot(element);
  t.after(async () => {
    await act(async () => root.unmount()); await window.happyDOM.close();
    for (const [name, descriptor] of globals) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name]; }
  });
  // The chat's controller as far as the button sees it: a draft, setText and a send that must never be called by the button.
  const chat = { text: 'Hello', sent: 0 };
  const controller = { getSnapshot: () => ({ draft: { text: chat.text, attachments: [] } }), setText: value => { chat.text = value; }, send: () => { chat.sent += 1; } };
  const transcripts = []; let transcribeError;
  const transcribe = async (audio, signal) => {
    transcripts.push({ audio, aborted: () => signal.aborted });
    if (transcribeError) throw transcribeError;
    return '  there from the microphone  ';
  };
  const until = async (condition, label) => {
    for (let n = 0; n < 200 && !condition(); n++) await act(async () => new Promise(resolve => setTimeout(resolve, 5)));
    assert.ok(condition(), label);
  };
  const button = () => element.querySelector('[data-testid="composer-voice"]');
  const cancel = () => element.querySelector('[data-testid="composer-voice-cancel"]');
  const alert = () => element.querySelector('[data-testid="composer-voice-problem"]');
  const click = async node => { await act(async () => { node.click(); }); };
  await act(async () => root.render(createElement(VoiceInput, { controller, transcribe })));
  return { element, chat, tracks, microphone, transcripts, button, cancel, alert, click, until, setTranscribeError: error => { transcribeError = error; }, unmount: () => act(async () => root.unmount()) };
};

test('the microphone button records on click, stops on the second, appends the transcript to the draft and never sends', async t => {
  const ui = await mount(t);
  assert.equal(ui.button().getAttribute('aria-pressed'), 'false');
  assert.equal(ui.cancel(), null, 'no cancel control while idle');
  await ui.click(ui.button());
  assert.equal(ui.button().getAttribute('aria-pressed'), 'true');
  assert.equal(ui.button().getAttribute('aria-label'), 'Stop recording');
  assert.ok(ui.cancel(), 'a cancel control while recording');
  await ui.click(ui.button());
  await ui.until(() => ui.transcripts.length === 1 && ui.chat.text !== 'Hello', 'the transcript is appended to the draft');
  assert.equal(ui.chat.text, 'Hello there from the microphone', 'the draft keeps its text, one space, then the trimmed transcript');
  assert.equal(ui.transcripts[0].audio.type, 'audio/webm');
  assert.equal(ui.chat.sent, 0, 'the transcript is not sent');
  assert.equal(ui.tracks[0].stopped, true, 'the microphone is released when the recording stops');
  assert.equal(ui.button().getAttribute('aria-pressed'), 'false');
});

test('cancel while recording releases the microphone and transcribes nothing', async t => {
  const ui = await mount(t);
  await ui.click(ui.button());
  assert.equal(ui.tracks[0].stopped, false);
  await ui.click(ui.cancel());
  assert.equal(ui.tracks[0].stopped, true, 'the microphone is released on cancel');
  assert.equal(ui.transcripts.length, 0, 'a cancelled recording is not transcribed');
  assert.equal(ui.chat.text, 'Hello');
  assert.equal(ui.button().getAttribute('aria-pressed'), 'false');
  assert.equal(ui.cancel(), null);
});

test('a refused microphone says what to do and starts no recording', async t => {
  const ui = await mount(t);
  ui.microphone.refuse = 'Permission denied';
  await ui.click(ui.button());
  assert.equal(ui.button().getAttribute('aria-pressed'), 'false');
  assert.equal(ui.alert().getAttribute('role'), 'alert');
  assert.equal(ui.alert().textContent, 'Microphone blocked. Allow it for this site in the browser, then press record again.');
  assert.equal(ui.tracks.length, 0);
});

test('a failed transcription keeps the draft and says so; unmounting while recording releases the microphone', async t => {
  const ui = await mount(t);
  ui.setTranscribeError(new Error('server down'));
  await ui.click(ui.button());
  await ui.click(ui.button());
  await ui.until(() => ui.alert() !== null, 'a failed transcription is reported');
  assert.equal(ui.alert().textContent, 'The recording could not be transcribed. Try again.');
  assert.equal(ui.chat.text, 'Hello', 'the draft is untouched');

  ui.setTranscribeError(undefined);
  await ui.click(ui.button());
  assert.equal(ui.tracks.at(-1).stopped, false);
  await ui.unmount();
  assert.equal(ui.tracks.at(-1).stopped, true, 'unmounting releases the microphone');
});
