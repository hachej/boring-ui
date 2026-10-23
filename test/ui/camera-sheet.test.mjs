// The composer's in-page camera (pi-chat-attachments/camera-sheet.tsx) in happy-dom: a fake getUserMedia whose tracks record being stopped, and
// a stubbed video, canvas and toBlob. Fictional data only.
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync } from 'node:fs';
import { build } from 'esbuild';
import { Window } from 'happy-dom';

const mount = async (t, { refuse = false, videoSize = [3200, 2400], props = {} } = {}) => {
  const window = new Window({ url: 'https://fictional.invalid/', settings: { disableIframePageLoading: true } });
  const names = ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node', 'Text', 'MutationObserver', 'KeyboardEvent', 'File', 'getComputedStyle', 'IS_REACT_ACT_ENVIRONMENT'];
  const globals = new Map(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  for (const name of names) {
    const value = name === 'window' ? window : name === 'IS_REACT_ACT_ENVIRONMENT' ? true : window[name];
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value: typeof value === 'function' && /^[a-z]/.test(name) ? value.bind(window) : value });
  }
  // The video reports a size once it plays; the canvas draws nothing and hands back a small JPEG blob, recording the size it was given.
  const video = window.HTMLVideoElement.prototype;
  // happy-dom only takes a real MediaStream as srcObject; the fake stream is plain.
  Object.defineProperty(video, 'srcObject', { configurable: true, get() { return this._src ?? null; }, set(value) { this._src = value; } });
  Object.defineProperty(video, 'play', { configurable: true, value: async () => {} });
  Object.defineProperty(video, 'videoWidth', { configurable: true, get: () => videoSize[0] });
  Object.defineProperty(video, 'videoHeight', { configurable: true, get: () => videoSize[1] });
  // toBlob answers only when the test says so, so the encoding state can be observed.
  const canvases = []; const pending = [];
  const canvas = window.HTMLCanvasElement.prototype;
  Object.defineProperty(canvas, 'getContext', { configurable: true, value() { return { drawImage() {} }; } });
  Object.defineProperty(canvas, 'toBlob', { configurable: true, value(callback, type, quality) { canvases.push({ width: this.width, height: this.height, type, quality }); pending.push(() => callback(new window.Blob(['fictional jpeg'], { type }))); } });

  // The fake camera: each call hands out a stream whose one track records whether it was released; `calls` keeps the constraints.
  const tracks = []; const calls = [];
  const getUserMedia = async constraints => {
    calls.push(constraints);
    if (refuse) throw Object.assign(new Error('Permission denied'), { name: 'NotAllowedError' });
    const track = { stopped: false, stop() { this.stopped = true; } }; tracks.push(track);
    return { getTracks: () => [track] };
  };

  const out = new URL('../../.cache/camera-sheet-test/', import.meta.url); mkdirSync(out, { recursive: true });
  await build({ entryPoints: [new URL('../../registry/pi-chat-attachments/camera-sheet.tsx', import.meta.url).pathname], outfile: new URL('camera-sheet.mjs', out).pathname,
    bundle: true, format: 'esm', platform: 'node', jsx: 'automatic', packages: 'external', logLevel: 'silent' });
  const { CameraSheet, CAMERA_MAX_SIDE } = await import(new URL('camera-sheet.mjs', out).href);
  const { createElement, act } = await import('react'); const { createRoot } = await import('react-dom/client');

  const element = window.document.createElement('div'); window.document.body.append(element); const root = createRoot(element);
  let mounted = true;
  t.after(async () => {
    if (mounted) await act(async () => root.unmount());
    await window.happyDOM.close();
    for (const [name, descriptor] of globals) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name]; }
  });
  const captured = []; const closed = [];
  const until = async (condition, label) => {
    for (let n = 0; n < 200 && !condition(); n++) await act(async () => new Promise(resolve => setTimeout(resolve, 5)));
    assert.ok(condition(), label);
  };
  const q = selector => window.document.body.querySelector(selector);
  await act(async () => root.render(createElement(CameraSheet, { onCapture: file => captured.push(file), onClose: () => closed.push(true), getUserMedia, ...props })));
  return { window, tracks, calls, captured, closed, canvases, until, encode: () => act(async () => { pending.splice(0).forEach(done => done()); }), q, max: CAMERA_MAX_SIDE, act,
    click: node => act(async () => { node.click(); }),
    key: key => act(async () => { window.document.body.dispatchEvent(new window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })); }),
    unmount: async () => { mounted = false; await act(async () => root.unmount()); } };
};

test('the sheet is a modal dialog portalled to the body, above the shell, and opens the rear camera', async t => {
  const ui = await mount(t);
  await ui.until(() => ui.tracks.length === 1 && !ui.q('[data-testid=camera-shoot]').disabled, 'the camera opens and the shutter enables');
  const sheet = ui.q('[data-testid=camera-sheet]');
  assert.equal(sheet.parentElement, ui.window.document.body, 'portalled to the body');
  assert.equal(sheet.getAttribute('role'), 'dialog');
  assert.equal(sheet.getAttribute('aria-modal'), 'true');
  assert.ok(sheet.hasAttribute('data-boring-overlay'));
  assert.match(sheet.getAttribute('style'), /calc\(var\(--app-shell-z-point, 60\) \+ 10\)/);
  assert.deepEqual(ui.calls, [{ video: { facingMode: 'environment' } }]);
  const video = ui.q('video');
  assert.ok(video.hasAttribute('playsinline') && video.hasAttribute('autoplay') && video.muted !== false);
});

test('a camera that rejects the rear constraint falls back to any camera', async t => {
  const calls = [];
  const ui = await mount(t, { props: { getUserMedia: async constraints => {
    calls.push(constraints);
    if (constraints.video?.facingMode) throw Object.assign(new Error('Overconstrained'), { name: 'OverconstrainedError' });
    return { getTracks: () => [{ stop() {} }] };
  } } });
  await ui.until(() => !ui.q('[data-testid=camera-shoot]').disabled, 'the second request opens the camera');
  assert.deepEqual(calls, [{ video: { facingMode: 'environment' } }, { video: true }]);
});

test('the shutter encodes a JPEG scaled to 1600px on the longest side, disables while encoding and hands it to onCapture', async t => {
  const ui = await mount(t);
  await ui.until(() => !ui.q('[data-testid=camera-shoot]').disabled, 'ready');
  await ui.click(ui.q('[data-testid=camera-shoot]'));
  assert.equal(ui.q('[data-testid=camera-shoot]').disabled, true, 'disabled while encoding');
  assert.equal(ui.captured.length, 0);
  await ui.encode();
  await ui.until(() => ui.captured.length === 1, 'the photo is delivered');
  assert.deepEqual(ui.canvases, [{ width: 1600, height: 1200, type: 'image/jpeg', quality: 0.85 }]);
  assert.ok(ui.max === 1600);
  assert.equal(ui.captured[0].type, 'image/jpeg');
  assert.match(ui.captured[0].name, /\.jpg$/);
  assert.equal(ui.tracks[0].stopped, true, 'the camera is released after the shot');
});

test('a small picture is not scaled up', async t => {
  const ui = await mount(t, { videoSize: [640, 480] });
  await ui.until(() => !ui.q('[data-testid=camera-shoot]').disabled, 'ready');
  await ui.click(ui.q('[data-testid=camera-shoot]'));
  await ui.encode();
  await ui.until(() => ui.captured.length === 1, 'delivered');
  assert.deepEqual([ui.canvases[0].width, ui.canvases[0].height], [640, 480]);
});

test('Close stops the camera and closes the sheet', async t => {
  const ui = await mount(t);
  await ui.until(() => ui.tracks.length === 1, 'open');
  await ui.click(ui.q('[data-testid=camera-close]'));
  assert.equal(ui.tracks[0].stopped, true, 'Close stops the tracks');
  assert.equal(ui.closed.length, 1);
});

test('Escape stops the camera and reaches no listener behind the sheet', async t => {
  const ui = await mount(t);
  await ui.until(() => ui.tracks.length === 1, 'open');
  const behind = [];
  ui.window.document.body.addEventListener('keydown', event => behind.push(event.key));
  ui.window.document.addEventListener('keydown', event => behind.push(event.key));
  await ui.key('Escape');
  assert.equal(ui.tracks[0].stopped, true, 'Escape stops the tracks');
  assert.equal(ui.closed.length, 1);
  assert.deepEqual(behind, [], 'the capture-phase listener stops Escape before the drawer or a menu behind sees it');
});

test('unmounting stops the camera', async t => {
  const ui = await mount(t);
  await ui.until(() => ui.tracks.length === 1, 'open');
  await ui.unmount();
  assert.equal(ui.tracks[0].stopped, true, 'unmounting stops the tracks');
});

test('a refused camera says so and offers the phone camera through a file input, clicked synchronously', async t => {
  const ui = await mount(t, { refuse: true });
  await ui.until(() => ui.q('[data-testid=camera-unavailable]'), 'the unavailable text shows');
  assert.equal(ui.q('[data-testid=camera-unavailable]').textContent, 'The camera cannot open on this page.');
  assert.equal(ui.q('[data-testid=camera-shoot]'), null, 'no shutter without a stream');
  const input = ui.q('[data-testid=camera-fallback-input]');
  assert.equal(input.getAttribute('accept'), 'image/*');
  assert.equal(input.getAttribute('capture'), 'environment');
  let opened = 0; input.click = () => { opened += 1; };
  await ui.click(ui.q('[data-testid=camera-fallback]'));
  assert.equal(opened, 1, 'the button opens the phone camera');
  const file = new ui.window.File(['fictional'], 'taken.jpg', { type: 'image/jpeg' });
  Object.defineProperty(input, 'files', { configurable: true, value: [file] });
  await ui.act(async () => { input.dispatchEvent(new ui.window.Event('change', { bubbles: true })); });
  assert.equal(ui.captured.length, 1);
  assert.equal(ui.captured[0].name, 'taken.jpg');
});

test('without media devices the sheet falls back at once', async t => {
  const ui = await mount(t, { props: { getUserMedia: undefined } });
  await ui.until(() => ui.q('[data-testid=camera-unavailable]'), 'no navigator.mediaDevices, so the fallback shows');
  assert.equal(ui.calls.length, 0);
});
