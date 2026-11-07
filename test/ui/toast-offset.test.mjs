// Toasts clear the docked composer on a phone (D-1801): the real PiChat and the real kit Toaster (shadcn/ui/sonner.tsx) rendered in
// happy-dom. PiChat sets --toast-offset-bottom on the document root while its composer is docked on a phone (width under 768) and removes
// it when it unmounts; the Toaster reads it as `var(--toast-offset-bottom, <sonner's own offset>)`. `sonner` and `next-themes` are not
// repo dependencies, so they are replaced by a stand-in whose offset handling is sonner 2.0.8's own `assignOffset` (same CSS variables:
// --offset-bottom on desktop, --mobile-offset-bottom at 600px and below); the kit code under test is real. Needs no browser.
// Fictional text only.
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync } from 'node:fs';
import { build } from 'esbuild';
import { Window } from 'happy-dom';

const SONNER = `
import { createElement } from 'react';
const VIEWPORT_OFFSET = '24px', MOBILE_VIEWPORT_OFFSET = '16px';
// Copied from sonner 2.0.8: how the offset props become the toaster's CSS variables.
function assignOffset(defaultOffset, mobileOffset) {
  const styles = {};
  [defaultOffset, mobileOffset].forEach((offset, index) => {
    const prefix = index === 1 ? '--mobile-offset' : '--offset', defaultValue = index === 1 ? MOBILE_VIEWPORT_OFFSET : VIEWPORT_OFFSET;
    const assignAll = value => ['top', 'right', 'bottom', 'left'].forEach(key => { styles[prefix + '-' + key] = typeof value === 'number' ? value + 'px' : value; });
    if (typeof offset === 'number' || typeof offset === 'string') assignAll(offset);
    else if (typeof offset === 'object') ['top', 'right', 'bottom', 'left'].forEach(key => { styles[prefix + '-' + key] = offset[key] === undefined ? defaultValue : typeof offset[key] === 'number' ? offset[key] + 'px' : offset[key]; });
    else assignAll(defaultValue);
  });
  return styles;
}
export function Toaster({ offset, mobileOffset, style }) {
  return createElement('ol', { 'data-sonner-toaster': '', 'data-y-position': 'bottom', style: { ...style, ...assignOffset(offset, mobileOffset) } });
}
`;
const THEMES = 'export const useTheme = () => ({ theme: "light" });';

/** A length from the toaster's CSS variable, resolving var(--x, fallback) against the document root's inline style. */
function px(value, root) {
  const resolved = value.replace(/var\((--[a-z-]+),\s*([^()]*)\)/g, (_, name, fallback) => root.style.getPropertyValue(name) || fallback);
  const nested = resolved.replace(/var\((--[a-z-]+),\s*([^()]*)\)/g, (_, name, fallback) => root.style.getPropertyValue(name) || fallback);
  const sum = /^calc\(\s*([\d.]+)px\s*\+\s*([\d.]+)rem\s*\)$/.exec(nested);
  if (sum) return Number(sum[1]) + Number(sum[2]) * 16;
  const plain = /^([\d.]+)px$/.exec(nested.trim());
  assert.ok(plain, `a resolvable length, got ${value} -> ${nested}`);
  return Number(plain[1]);
}

const snapshot = { identity: {}, conversationId: 'fictional', connection: { kind: 'connected' }, view: { entries: [], docs: {} }, draft: { text: '', attachments: [], version: 0 }, outbox: [], history: { kind: 'disabled' }, send: { kind: 'idle' }, stop: 'idle', disposed: false };

test('toasts clear the docked composer on a phone, are unchanged on a desktop, and the token goes with the chat', { timeout: 60000 }, async t => {
  const window = new Window({ url: 'https://fictional.invalid/', width: 1280, height: 800 });
  const names = ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node', 'Text', 'MutationObserver', 'ResizeObserver', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame', 'sessionStorage', 'localStorage', 'addEventListener', 'removeEventListener', 'matchMedia', 'innerWidth', 'innerHeight', 'IS_REACT_ACT_ENVIRONMENT'];
  const globals = new Map(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  for (const name of names) {
    const given = name === 'window' ? window : name === 'IS_REACT_ACT_ENVIRONMENT' ? true : window[name];
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value: typeof given === 'function' && /^[a-z]/.test(name) ? given.bind(window) : given });
  }
  // The composer dock sits 144px above the bottom edge of an 844px window (its height plus the safe area under it).
  const DOCK_TOP = 700;
  window.HTMLElement.prototype.getBoundingClientRect = function rect() { const top = this.dataset?.testid === 'composer-dock' ? DOCK_TOP : 0; return { x: 0, y: top, top, left: 0, right: 0, bottom: top, width: 0, height: 0 }; };
  const { createElement, act } = await import('react'); const { createRoot } = await import('react-dom/client');
  const out = new URL('../../.cache/toast-offset/', import.meta.url); mkdirSync(out, { recursive: true });
  const output = new URL('chat.mjs', out);
  const stand = { name: 'stand-in', setup(builder) {
    builder.onResolve({ filter: /^(sonner|next-themes)$/ }, args => ({ path: args.path, namespace: 'stand-in' }));
    builder.onLoad({ filter: /.*/, namespace: 'stand-in' }, args => ({ contents: args.path === 'sonner' ? SONNER : THEMES, loader: 'js', resolveDir: new URL('../../', import.meta.url).pathname }));
  } };
  await build({ stdin: { contents: `export { PiChat } from './pi-chat/pi-chat.tsx'; export { Toaster } from '../shadcn/ui/sonner.tsx';`, resolveDir: new URL('../../registry/', import.meta.url).pathname, loader: 'tsx' }, outfile: output.pathname, bundle: true, format: 'esm', platform: 'node', jsx: 'automatic', packages: 'external', loader: { '.css': 'empty' }, plugins: [stand, { name: 'file-tree-css', setup(builder) { builder.onResolve({ filter: /^@hachej\/boring-ui-kit\/file-tree\.css$/ }, () => ({ path: new URL(import.meta.resolve('@hachej/boring-ui-kit/file-tree.css')).pathname, external: false })); } }] });
  const { PiChat, Toaster } = await import(output.href);
  const element = document.createElement('div'); document.body.append(element); const root = createRoot(element);
  t.after(async () => {
    await act(async () => root.unmount()); await window.happyDOM.close();
    for (const [name, descriptor] of globals) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name]; }
  });
  const controller = new Proxy({ getSnapshot: () => snapshot, subscribe: () => () => {} }, { get: (target, key) => key in target ? target[key] : async () => {} });
  const chat = (key, extra = {}) => createElement(PiChat, { key, controller, header: false, mode: 'developer', onFiles: () => {}, mentions: undefined, ...extra });
  const page = (...chats) => createElement('div', null, createElement(Toaster), ...chats);
  const html = document.documentElement;
  const show = async (width, ...chats) => { window.happyDOM.setViewport({ width, height: 844 }); await act(async () => root.render(page(...chats))); };
  /** Where the bottom toast sits, in px from the window's bottom edge, as the toaster's own CSS variables say (sonner reads the mobile pair at 600px and below). */
  const toastBottom = () => { const toaster = element.querySelector('[data-sonner-toaster]'); return px(toaster.style.getPropertyValue(window.innerWidth <= 600 ? '--mobile-offset-bottom' : '--offset-bottom'), html); };
  const token = () => html.style.getPropertyValue('--toast-offset-bottom');

  await show(390, chat('a'));
  assert.ok(element.querySelector('[data-testid=composer-dock]'), 'the composer dock is drawn');
  assert.ok(toastBottom() >= 844 - DOCK_TOP, `at 390 with a docked composer the toast bottom (${toastBottom()}px) clears the 144px composer`);

  await show(390);
  assert.equal(token(), '', 'on unmount the token is gone');
  assert.equal(toastBottom(), 16, 'with no chat the phone toast keeps sonner\'s own 16px');

  await show(390, chat('a'), chat('b'));
  await show(390, chat('a'));
  assert.notEqual(token(), '', 'closing one of two chats keeps the room the other needs (BORING-PI-6)');
  await show(390, chat('a', { placement: 'floating' }));
  assert.equal(token(), '', 'a floating chat is not docked: no token');

  await show(1280, chat('c'));
  assert.equal(token(), '', 'at 1280 the chat sets no token');
  assert.equal(toastBottom(), 24, 'at 1280 the toast keeps sonner\'s own 24px');
});
