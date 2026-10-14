// The preview frame's script (bundled into registry/live-preview/preview-frame.js by scripts/build-preview-frame.mjs). It runs in an iframe
// with sandbox="allow-scripts": an opaque origin, so no cookies, storage or parent access. It accepts messages only from its parent window.
import * as React from 'react';
import { Component, createElement } from 'react';
import type { ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import * as jsxRuntime from 'react/jsx-runtime';
import { FRAME_TAG, acceptFromParent } from '../../registry/live-preview/frame-protocol';
import type { FrameMessage } from '../../registry/live-preview/frame-protocol';
import { compileComponent } from './compile';
import * as kit from './kit';

const modules = {
  react: React, 'react/jsx-runtime': jsxRuntime,
  '@/components/ui/button': { Button: kit.Button }, '@/components/ui/badge': { Badge: kit.Badge },
  '@/components/ui/card': { Card: kit.Card, CardHeader: kit.CardHeader, CardTitle: kit.CardTitle, CardDescription: kit.CardDescription, CardContent: kit.CardContent, CardFooter: kit.CardFooter },
};

// The parent's origin is learned from its first valid message; replies go only there (the very first `ready` carries nothing).
let parentOrigin = '*';
const post = (message: Omit<FrameMessage, 'boring'>) => window.parent.postMessage({ boring: FRAME_TAG, ...message }, parentOrigin);
const messageOf = (error: unknown) => error instanceof Error ? error.message : String(error);

class Boundary extends Component<{ readonly children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: unknown) { post({ type: 'error', message: messageOf(error) }); }
  render() { return this.state.failed ? null : this.props.children; }
}

/** Callbacks never run host code: reading an `on…` prop gives a function that only reports that it was called. */
function withIntents(props: unknown): Record<string, unknown> {
  const base = (typeof props === 'object' && props !== null ? props : {}) as Record<string, unknown>;
  const intent = (name: string) => (...args: unknown[]) => {
    let text: string;
    try { text = JSON.stringify(args.map(arg => arg instanceof Event ? arg.type : arg)); } catch { text = '[…]'; }
    post({ type: 'intent', name, args: text ?? '' });
  };
  return new Proxy(base, { get: (target, key) => typeof key === 'string' && /^on[A-Z]/.test(key) ? intent(key) : Reflect.get(target, key) });
}

const style = document.createElement('style');
document.head.append(style);
const root = createRoot(document.getElementById('root') as HTMLElement);
let version = 0;

window.addEventListener('message', event => {
  const message = acceptFromParent(event, window.parent);
  if (!message) return;
  parentOrigin = event.origin && event.origin !== 'null' ? event.origin : '*';
  style.textContent = message.css;
  document.documentElement.classList.toggle('dark', message.dark);
  try {
    const Preview = compileComponent(message.source, modules);
    root.render(createElement(Boundary, { key: ++version }, createElement(Preview as never, withIntents(message.props))));
  } catch (error) {
    root.render(null);
    post({ type: 'error', message: messageOf(error) });
  }
});
window.addEventListener('error', event => post({ type: 'error', message: event.message }));
window.addEventListener('unhandledrejection', event => post({ type: 'error', message: messageOf(event.reason) }));
new ResizeObserver(() => post({ type: 'size', height: Math.ceil(document.documentElement.scrollHeight) })).observe(document.body);
post({ type: 'ready' });
