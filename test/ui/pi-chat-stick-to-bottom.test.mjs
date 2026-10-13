// The pi-chat transcript keeps its latest row in view while rows grow after they are inserted (streamed text, a late image),
// and leaves the view alone once the reader has scrolled up. happy-dom has no layout, so the scroller's height is modelled
// from the rows' `data-h` heights and a fake ResizeObserver reports each content height change after the render.
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync } from 'node:fs';
import { build } from 'esbuild';
import { Window } from 'happy-dom';

const VIEWPORT = 400; // the scroller's clientHeight
const ENTRY = `
import { createElement as h } from 'react';
import { useTranscript } from ${JSON.stringify(new URL('../../registry/pi-chat/session.tsx', import.meta.url).pathname)};
export function Host({ rows, heights, expose }) {
  const { stick, visible } = useTranscript(rows, 60, 40);
  expose(stick);
  return h('div', { ref: stick.scrollRef, 'data-testid': 'transcript-scroll' },
    h('div', { ref: stick.contentRef, 'data-testid': 'transcript' },
      visible(rows).map(row => h('div', { key: row.key, 'data-h': heights[row.key] }, row.key))));
}`;

async function harness(t) {
  const window = new Window({ url: 'https://fictional.invalid/', settings: { disableIframePageLoading: true } });
  const names = ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node', 'Text', 'Event', 'MutationObserver', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame', 'IS_REACT_ACT_ENVIRONMENT', 'ResizeObserver'];
  const globals = new Map(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  // The fake ResizeObserver: layout() reports every observed element whose content height changed.
  const observed = new Map();
  class FakeResizeObserver {
    constructor(callback) { this.callback = callback; }
    observe(element) { observed.set(element, { owner: this, height: undefined }); }
    unobserve(element) { observed.delete(element); }
    disconnect() { for (const [element, entry] of observed) if (entry.owner === this) observed.delete(element); }
  }
  for (const name of names) {
    const value = name === 'window' ? window : name === 'IS_REACT_ACT_ENVIRONMENT' ? true : name === 'ResizeObserver' ? FakeResizeObserver : window[name];
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value: typeof value === 'function' && /^[a-z]/.test(name) ? value.bind(window) : value });
  }
  const { createElement, act } = await import('react');
  const { createRoot } = await import('react-dom/client');
  const out = new URL('../../.cache/pi-chat-stick-test/', import.meta.url);
  mkdirSync(out, { recursive: true });
  const output = new URL('host.mjs', out);
  await build({ stdin: { contents: ENTRY, resolveDir: new URL('../../registry/pi-chat/', import.meta.url).pathname, loader: 'tsx' }, outfile: output.pathname, bundle: true, format: 'esm', platform: 'node', jsx: 'automatic', packages: 'external', logLevel: 'silent' });
  const { Host } = await import(output.href);

  const element = window.document.createElement('div');
  window.document.body.append(element);
  const root = createRoot(element);
  let stick;
  const expose = value => { stick = value; };
  const heights = {};
  // The scroller's layout: content height is the sum of the rows' heights, the viewport is VIEWPORT px, scrollTop clamps.
  let scroller;
  const contentHeight = () => [...scroller.firstElementChild.children].reduce((sum, row) => sum + Number(row.dataset.h), 0);
  const maxTop = () => Math.max(0, contentHeight() - VIEWPORT);
  let top = 0;
  const layout = () => {
    scroller ??= element.querySelector('[data-testid="transcript-scroll"]');
    if (!scroller) return;
    Object.defineProperty(scroller, 'clientHeight', { configurable: true, get: () => VIEWPORT });
    Object.defineProperty(scroller, 'scrollHeight', { configurable: true, get: contentHeight });
    Object.defineProperty(scroller, 'scrollTop', { configurable: true,
      get: () => Math.min(top, maxTop()),
      set: value => { top = Math.max(0, Math.min(Number(value), maxTop())); setTimeout(() => scroller.dispatchEvent(new window.Event('scroll'))); } });
    for (const [target, entry] of observed) {
      const height = target === scroller.firstElementChild ? contentHeight() : undefined;
      if (height !== undefined && height !== entry.height) { entry.height = height; entry.owner.callback([{ contentRect: { height } }]); }
    }
  };
  const render = async rows => { await act(async () => root.render(createElement(Host, { rows, heights, expose }))); layout(); };
  const frames = ms => act(() => new Promise(resolve => setTimeout(resolve, ms)));
  const distanceFromBottom = () => Math.round(maxTop() - top);
  t.after(async () => {
    await act(async () => root.unmount());
    await window.happyDOM.close();
    for (const [name, descriptor] of globals) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name]; }
  });
  return { render, frames, expose: () => stick, heights, distanceFromBottom, scrollTo: value => { scroller.scrollTop = value; }, scroller: () => scroller, layout };
}

test('the latest row stays in view while the rows after it grow', async t => {
  const chat = await harness(t);
  const rows = [];
  await chat.render(rows);
  const send = async (key, lines) => {
    // The send path scrolls to the bottom, then the new rows are appended.
    chat.expose().scrollToBottom('instant');
    rows.push({ key: `${key}-user` }, { key: `${key}-reply` });
    chat.heights[`${key}-user`] = 60;
    chat.heights[`${key}-reply`] = lines * 20;
    await chat.render(rows);
  };
  // Each reply grows in steps after it is inserted: streamed text, then a late-loading image.
  for (const round of ['a', 'b', 'c', 'd', 'e']) {
    await send(round, 3);
    for (const lines of [12, 22, 30, 40]) {
      chat.heights[`${round}-reply`] = lines * 20;
      await chat.render(rows);
      // The reader sees the view a few frames after each growth, before a slow scroll could catch up.
      await chat.frames(100);
      assert.ok(chat.distanceFromBottom() <= 2, `round ${round}, ${lines} lines: the latest row is ${chat.distanceFromBottom()}px below the viewport`);
    }
  }
});

test('a reader who scrolled up is not pulled back down when a row grows', async t => {
  const chat = await harness(t);
  const rows = [{ key: 'old-user' }, { key: 'old-reply' }];
  chat.heights['old-user'] = 60;
  chat.heights['old-reply'] = 600;
  await chat.render(rows);
  chat.expose().scrollToBottom('instant');
  await chat.frames(100);
  chat.scrollTo(0);
  await chat.frames(100);
  chat.heights['old-reply'] = 900;
  await chat.render(rows);
  await chat.frames(600);
  assert.equal(chat.scroller().scrollTop, 0, 'the view stays where the reader left it');
});
