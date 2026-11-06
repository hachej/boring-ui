// An idle page does not keep calling the server (D-1638): the real useConversationsClient, fake timers and a fake visibility state.
import assert from 'node:assert/strict';
import test from 'node:test';
import { Window } from 'happy-dom';

test('the conversations list is not polled every 4 s while idle, not at all while hidden, and refreshes on return', { timeout: 30000 }, async t => {
  const window = new Window({ url: 'https://fictional.invalid/' });
  const names = ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node', 'location', 'matchMedia', 'addEventListener', 'removeEventListener', 'IS_REACT_ACT_ENVIRONMENT'];
  const globals = new Map(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  for (const name of names) {
    const value = name === 'window' ? window : name === 'IS_REACT_ACT_ENVIRONMENT' ? true : window[name];
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value: typeof value === 'function' && /^[a-z]/.test(name) ? value.bind(window) : value });
  }
  let visibility = 'visible';
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility });
  const { createElement, act } = await import('react'); const { createRoot } = await import('react-dom/client');
  const { useConversationsClient } = await import('@hachej/boring-ui-kit/chat-react');
  t.mock.timers.enable({ apis: ['setInterval', 'setTimeout'] });
  let calls = 0;
  const fetch = async () => { calls += 1; return Response.json({ conversations: [] }); };
  const Host = ({ busy }) => { useConversationsClient({ endpoint: '/api/pm/conversations', fetch, activeId: undefined, onSelect: () => {}, busy }); return null; };
  const element = document.createElement('div'); document.body.append(element); const root = createRoot(element);
  t.after(async () => { await act(async () => root.unmount()); await window.happyDOM.close(); for (const [name, descriptor] of globals) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name]; } });
  const tick = ms => act(async () => { t.mock.timers.tick(ms); await Promise.resolve(); });
  const render = busy => act(async () => { root.render(createElement(Host, { busy })); });

  await render(false);
  assert.equal(calls, 1, 'one list on mount');
  await tick(120_000);
  assert.ok(calls <= 5, `idle and visible for 2 minutes: ${calls} calls, not one every 4 s`);
  const before = calls;
  visibility = 'hidden'; await act(async () => { document.dispatchEvent(new window.Event('visibilitychange')); });
  await tick(120_000);
  assert.equal(calls, before, 'no call while the tab is hidden');
  visibility = 'visible'; await act(async () => { document.dispatchEvent(new window.Event('visibilitychange')); });
  assert.equal(calls, before + 1, 'one refresh when the tab is visible again');
  const idle = calls;
  await render(true);
  await tick(8_000);
  assert.ok(calls - idle >= 2, 'while a turn runs the list still refreshes every 4 s');
});
