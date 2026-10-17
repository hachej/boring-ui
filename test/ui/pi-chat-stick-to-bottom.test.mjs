// The pi-chat transcript keeps its latest row in view while rows grow after they are inserted (streamed text, a late image),
// and leaves the view alone once the reader has scrolled up. happy-dom has no layout, so the scroller's height is modelled
// from the rows' `data-h` heights and a fake ResizeObserver reports each content height change after the render.
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync } from 'node:fs';
import { build } from 'esbuild';
import { Window } from 'happy-dom';

const ENTRY = `
import { createElement as h } from 'react';
import { useTranscript } from ${JSON.stringify(new URL('../../registry/pi-chat/session.tsx', import.meta.url).pathname)};
import { MessageScroller, MessageScrollerProvider, MessageScrollerViewport, MessageScrollerContent, MessageScrollerItem } from ${JSON.stringify(new URL('../../examples/app-shell/components/ui/message-scroller.tsx', import.meta.url).pathname)};
export function Host(props) { return h(MessageScrollerProvider, { autoScroll: true }, h(Transcript, props)); }
function Transcript({ rows, heights, expose, open = true }) {
  const { stick, visible } = useTranscript(rows, 60, 40);
  expose(stick);
  // Like AmbientChat, the scroller is mounted only while the panel is open.
  if (!open) return null;
  return h(MessageScroller, null, h(MessageScrollerViewport, { ref: stick.scrollRef, 'data-testid': 'transcript-scroll' },
    h(MessageScrollerContent, { 'data-testid': 'transcript' },
      visible(rows).map(row => h(MessageScrollerItem, { key: row.key, messageId: row.key, 'data-h': heights[row.key] }, row.key)))));
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
  // The scroller's layout: content height is the sum of the rows' heights, the viewport is a fixed height the test can change, scrollTop clamps.
  let scroller;
  const contentHeight = () => [...scroller.querySelectorAll('[data-h]')].reduce((sum, row) => sum + Number(row.dataset.h), 0);
  const maxTop = () => Math.max(0, contentHeight() - viewport);
  const setTop = value => { top = Math.max(0, Math.min(Number(value), maxTop())); };
  let top = 0;
  let viewport = 400; // the scroller's clientHeight, which the keyboard or a taller composer can shrink
  const layout = () => {
    scroller = element.querySelector('[data-testid="transcript-scroll"]');
    if (!scroller) return;
    scroller.getBoundingClientRect = () => ({ top: 0, bottom: viewport, height: viewport });
    scroller.firstElementChild.getBoundingClientRect = () => ({ top: -top, bottom: contentHeight() - top, height: contentHeight() });
    const children = [...scroller.querySelectorAll('[data-h]')];
    for (const [index, child] of children.entries()) child.getBoundingClientRect = () => {
      const y = children.slice(0, index).reduce((sum, item) => sum + Number(item.dataset.h), 0) - top;
      const height = Number(child.dataset.h);
      return { top: y, bottom: y + height, height };
    };
    scroller.scrollTo = ({ top: value }) => { scroller.scrollTop = value; };
    Object.defineProperty(scroller, 'clientHeight', { configurable: true, get: () => viewport });
    Object.defineProperty(scroller, 'scrollHeight', { configurable: true, get: contentHeight });
    // A write clamps and queues one scroll event, as a browser does; the position is not clamped on read, so a shrink
    // leaves it overscrolled until the library's own clamp writes it back.
    Object.defineProperty(scroller, 'scrollTop', { configurable: true,
      get: () => top,
      set: value => { setTop(value); setTimeout(() => scroller.dispatchEvent(new window.Event('scroll'))); } });
    for (const [target, entry] of observed) {
      const height = target === scroller ? viewport : target === scroller.firstElementChild ? contentHeight() : undefined;
      if (height !== undefined && height !== entry.height) { entry.height = height; entry.owner.callback([{ contentRect: { height } }]); }
    }
  };
  let lastRows = [];
  let open = true;
  const render = async (rows, { show = open } = {}) => { lastRows = rows; open = show; await act(async () => root.render(createElement(Host, { rows, heights, expose, open: show }))); layout(); };
  const frames = ms => act(() => new Promise(resolve => setTimeout(resolve, ms)));
  const distanceFromBottom = () => Math.round(maxTop() - top);
  t.after(async () => {
    await act(async () => root.unmount());
    await window.happyDOM.close();
    for (const [name, descriptor] of globals) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name]; }
  });
  return { render, frames, expose: () => stick, heights, distanceFromBottom,
    // A reader's scroll: one event, dispatched before the next animation frame as the browser does.
    scrollTo: value => { scroller.dispatchEvent(new window.WheelEvent('wheel', { deltaY: -100, bubbles: true })); setTop(value); scroller.dispatchEvent(new window.Event('scroll')); }, scroller: () => scroller, layout,
    setViewport: async value => { viewport = value; await render(lastRows); },
    setOpen: async show => { await render(lastRows, { show }); } };
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

test('the latest row stays in view when the viewport shrinks (keyboard or a taller composer)', async t => {
  const chat = await harness(t);
  const rows = [{ key: 'user' }, { key: 'reply' }];
  chat.heights.user = 60;
  chat.heights.reply = 600;
  await chat.render(rows);
  chat.expose().scrollToBottom('instant');
  await chat.frames(100);
  assert.ok(chat.distanceFromBottom() <= 2, 'the reader starts at the bottom');
  // The phone keyboard opens: the scroller loses 150px of height while its content stays the same.
  await chat.setViewport(250);
  await chat.frames(200);
  assert.ok(chat.distanceFromBottom() <= 2, `the latest row is ${chat.distanceFromBottom()}px below the viewport after the shrink`);
});

/** Renders a tall transcript, scrolls to its bottom and returns the harness. */
async function atBottom(chat, rows) {
  chat.heights.user = 60;
  chat.heights.reply = 600;
  await chat.render(rows);
  chat.expose().scrollToBottom('instant');
  await chat.frames(100);
  assert.ok(chat.distanceFromBottom() <= 2, 'the reader starts at the bottom');
}

test('the bottom lock follows a viewport shrink after the panel opens, and after it is reopened', async t => {
  const chat = await harness(t);
  const rows = [{ key: 'user' }, { key: 'reply' }];
  // The panel starts collapsed: no scroller yet. Expanding mounts it.
  await chat.setOpen(false);
  await chat.setOpen(true);
  await atBottom(chat, rows);
  await chat.setViewport(250);
  await chat.frames(200);
  assert.ok(chat.distanceFromBottom() <= 2, `after expanding, the latest row is ${chat.distanceFromBottom()}px below the viewport`);
  // Collapse, then reopen: the new scroller is the one that must be watched.
  await chat.setViewport(400);
  await chat.setOpen(false);
  await chat.setOpen(true);
  await atBottom(chat, rows);
  await chat.setViewport(250);
  await chat.frames(200);
  assert.ok(chat.distanceFromBottom() <= 2, `after reopening, the latest row is ${chat.distanceFromBottom()}px below the viewport`);
});

test('a scroll-up gesture just before the pending bottom frame is not snapped back', async t => {
  const chat = await harness(t);
  const rows = [{ key: 'user' }, { key: 'reply' }];
  await atBottom(chat, rows);
  // The reply grows, which schedules a bottom re-pin for the next frame...
  chat.heights.reply = 800;
  await chat.render(rows);
  // ...and the reader scrolls up before that frame runs.
  chat.scrollTo(100);
  await chat.frames(300);
  assert.ok(chat.scroller().scrollTop <= 150, `the reader was snapped back to ${chat.scroller().scrollTop}px`);
});

test('a library clamp followed by growth, before its queued scroll event, does not release the bottom lock', async t => {
  const chat = await harness(t);
  const rows = [{ key: 'user' }, { key: 'reply' }];
  await atBottom(chat, rows);
  // The reply shrinks: the library clamps the overscrolled position upward (its own write, with its programmatic marker).
  chat.heights.reply = 100;
  await chat.render(rows);
  // The reply grows back before the queued scroll event for that clamp arrives.
  chat.heights.reply = 600;
  await chat.render(rows);
  await chat.frames(300);
  assert.ok(chat.distanceFromBottom() <= 2, `the reader was left ${chat.distanceFromBottom()}px above the latest row`);
});
