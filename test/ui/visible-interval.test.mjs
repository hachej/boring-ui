// useVisibleInterval (`@hachej/boring-ui-kit/visible-interval`): a screen's refresh timer that pauses while the tab is hidden, resumes when it shows,
// stops after ten idle minutes (here a few dozen milliseconds) and is cleared on unmount. In happy-dom; real timers, fictional callbacks.
import assert from 'node:assert/strict';
import test from 'node:test';
import { Window } from 'happy-dom';

test('useVisibleInterval runs while shown, pauses hidden, resumes on show, stops when idle, restarts on activity, and cleans up', async t => {
  const window = new Window({ url: 'https://fictional.invalid/', settings: { disableIframePageLoading: true } });
  const names = ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node', 'Text', 'MutationObserver', 'getComputedStyle', 'IS_REACT_ACT_ENVIRONMENT', 'Event'];
  const globals = new Map(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  for (const name of names) {
    const value = name === 'window' ? window : name === 'IS_REACT_ACT_ENVIRONMENT' ? true : window[name];
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value: typeof value === 'function' && /^[a-z]/.test(name) ? value.bind(window) : value });
  }
  let visibility = 'visible';
  Object.defineProperty(window.document, 'visibilityState', { configurable: true, get: () => visibility });
  const { useVisibleInterval } = await import('@hachej/boring-ui-kit/visible-interval');
  const { createElement, act } = await import('react'); const { createRoot } = await import('react-dom/client');
  const element = window.document.createElement('div'); window.document.body.append(element); const root = createRoot(element);
  t.after(async () => {
    await act(async () => root.unmount()); await window.happyDOM.close();
    for (const [name, descriptor] of globals) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name]; }
  });
  const wait = ms => act(async () => new Promise(resolve => setTimeout(resolve, ms)));
  const show = state => { visibility = state; window.document.dispatchEvent(new window.Event('visibilitychange')); };

  let calls = 0;
  const Probe = ({ idleMs }) => { useVisibleInterval(() => { calls++; }, 10, { idleMs }); return null; };
  await act(async () => root.render(createElement(Probe, { idleMs: 400 })));

  await wait(100);
  assert.ok(calls >= 4, `it ticks while shown (${calls})`);

  await act(async () => show('hidden'));
  const paused = calls;
  await wait(80);
  assert.equal(calls, paused, 'a hidden tab makes no call');

  await act(async () => show('visible'));
  assert.equal(calls, paused + 1, 'it calls once at once when the tab shows again');
  await wait(60);
  assert.ok(calls > paused + 2, 'and goes on ticking');

  // Idle: no activity for idleMs stops it; any pointer, key or touch activity starts it again.
  await wait(450);
  const stopped = calls;
  await wait(80);
  assert.equal(calls, stopped, 'ten idle minutes (here 400 ms) stop it');
  await act(async () => window.document.dispatchEvent(new window.Event('pointerdown')));
  assert.equal(calls, stopped + 1, 'activity brings it back with one call');
  await wait(50);
  assert.ok(calls > stopped + 2, 'and it ticks again');
  for (const name of ['keydown', 'touchstart']) {
    await wait(30);
    await act(async () => window.document.dispatchEvent(new window.Event(name)));
  }

  await act(async () => root.render(createElement('div')));
  const gone = calls;
  await wait(60);
  assert.equal(calls, gone, 'unmounting clears the timer');
});

test('useVisibleInterval does not tick while disabled and reads the latest callback without restarting', async t => {
  const window = new Window({ url: 'https://fictional.invalid/', settings: { disableIframePageLoading: true } });
  const names = ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node', 'Text', 'MutationObserver', 'getComputedStyle', 'IS_REACT_ACT_ENVIRONMENT'];
  const globals = new Map(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  for (const name of names) {
    const value = name === 'window' ? window : name === 'IS_REACT_ACT_ENVIRONMENT' ? true : window[name];
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value: typeof value === 'function' && /^[a-z]/.test(name) ? value.bind(window) : value });
  }
  const { useVisibleInterval } = await import('@hachej/boring-ui-kit/visible-interval');
  const { createElement, act } = await import('react'); const { createRoot } = await import('react-dom/client');
  const element = window.document.createElement('div'); window.document.body.append(element); const root = createRoot(element);
  t.after(async () => {
    await act(async () => root.unmount()); await window.happyDOM.close();
    for (const [name, descriptor] of globals) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name]; }
  });
  const wait = ms => act(async () => new Promise(resolve => setTimeout(resolve, ms)));
  const seen = [];
  const Probe = ({ label, enabled }) => { useVisibleInterval(() => seen.push(label), 10, { enabled }); return null; };
  await act(async () => root.render(createElement(Probe, { label: 'a', enabled: false })));
  await wait(60);
  assert.deepEqual(seen, [], 'disabled: no calls');
  await act(async () => root.render(createElement(Probe, { label: 'a', enabled: true })));
  await wait(50);
  await act(async () => root.render(createElement(Probe, { label: 'b', enabled: true })));
  await wait(50);
  assert.ok(seen.includes('a') && seen.includes('b'), 'the latest callback is the one called');
  assert.equal(seen.indexOf('b') > seen.lastIndexOf('a'), true, 'after the change only the latest is called');
});
