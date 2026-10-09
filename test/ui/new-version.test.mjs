// The pi-app "a new version is available" hook and notice, in happy-dom. The served build is fictional (`/version.json` is stubbed).
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync } from 'node:fs';
import { build } from 'esbuild';
import { Window } from 'happy-dom';

test('useNewVersion flips once the served build differs, stays false for an equal build or dev, and survives failed checks', async t => {
  const window = new Window({ url: 'https://fictional.invalid/', settings: { disableIframePageLoading: true } });
  const names = ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node', 'Text', 'MutationObserver', 'getComputedStyle', 'IS_REACT_ACT_ENVIRONMENT'];
  const globals = new Map([...names, 'fetch'].map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  for (const name of names) {
    const value = name === 'window' ? window : name === 'IS_REACT_ACT_ENVIRONMENT' ? true : window[name];
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value: typeof value === 'function' && /^[a-z]/.test(name) ? value.bind(window) : value });
  }
  const out = new URL('../../.cache/new-version-test/', import.meta.url); mkdirSync(out, { recursive: true });
  const bundle = (entry, name) => build({ entryPoints: [new URL(entry, import.meta.url).pathname], outfile: new URL(name, out).pathname, bundle: true, format: 'esm', platform: 'node', jsx: 'automatic', packages: 'external', logLevel: 'silent' });
  await bundle('../../registry/pi-app/use-new-version.ts', 'use-new-version.mjs');
  await bundle('../../registry/pi-app/new-version-notice.tsx', 'new-version-notice.mjs');
  const { useNewVersion } = await import(new URL('use-new-version.mjs', out).href);
  const { NewVersionNotice } = await import(new URL('new-version-notice.mjs', out).href);
  const { createElement, act } = await import('react'); const { createRoot } = await import('react-dom/client');
  // Waits inside act, so the state changes a check makes are flushed as they happen.
  const until = async (condition, label) => {
    for (let n = 0; n < 200 && !condition(); n++) await act(async () => new Promise(resolve => setTimeout(resolve, 5)));
    assert.ok(condition(), label);
  };

  // The deployed build, and every request the hook makes.
  let served = 'build-1'; const requests = []; let failNext = false;
  globalThis.fetch = async (url, init) => {
    requests.push({ url, init });
    if (failNext) { failNext = false; throw new TypeError('offline'); }
    return new Response(JSON.stringify({ build: served }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const element = window.document.createElement('div'); window.document.body.append(element); const root = createRoot(element);
  t.after(async () => {
    await act(async () => root.unmount()); await window.happyDOM.close();
    for (const [name, descriptor] of globals) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name]; }
  });
  const Probe = props => createElement('output', { 'data-stale': String(useNewVersion(props)) });
  const probe = props => createElement(Probe, props);
  const stale = () => element.querySelector('output').dataset.stale;

  // dev (or no build id): never checks, never flips.
  await act(async () => root.render(probe({ current: 'dev', everyMs: 5 })));
  await act(async () => new Promise(resolve => setTimeout(resolve, 30)));
  assert.equal(stale(), 'false'); assert.equal(requests.length, 0, 'a dev build does not check');
  await act(async () => root.render(probe({ current: undefined, everyMs: 5 })));
  assert.equal(requests.length, 0);

  // An equal build checks on the interval, with no-store and same-origin, and stays false.
  await act(async () => root.render(probe({ current: 'build-1', everyMs: 5 })));
  await until(() => requests.length >= 3, 'the hook polls /version.json on its interval');
  assert.equal(requests[0].url, '/version.json');
  assert.equal(requests[0].init.cache, 'no-store'); assert.equal(requests[0].init.credentials, 'same-origin');
  assert.equal(stale(), 'false');

  // A failed check (offline) is retried and does not flip the result.
  failNext = true;
  const before = requests.length;
  await until(() => requests.length > before + 1, 'a failed check is followed by another check');
  assert.equal(stale(), 'false');

  // The deploy lands: the next check flips it, and the hook stops checking.
  served = 'build-2';
  await until(() => stale() === 'true', 'a different served build flips the hook to true');
  const settled = requests.length;
  await act(async () => new Promise(resolve => setTimeout(resolve, 30)));
  assert.equal(requests.length, settled, 'once stale, the hook stops polling');
  assert.equal(stale(), 'true');

  // The notice: a polite status line with the app's words and a Reload button.
  await act(async () => root.render(createElement(NewVersionNotice)));
  const notice = element.querySelector('[data-testid="new-version-notice"]');
  assert.equal(notice.getAttribute('role'), 'status');
  assert.match(notice.textContent, /A new version is available\./);
  assert.match(element.querySelector('[data-testid="new-version-reload"]').textContent, /Reload/);
});
