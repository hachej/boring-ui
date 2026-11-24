// The floating composer's window through the public component in happy-dom: the artifact panel (a card opens the host's panel with its versions; the agent's `present` is acknowledged only by what the host actually mounted),
// the shared below-768 phone layout and its media listener, and denied browser storage.
// (The ambient window's own position, phone-layout and pill tests went with it: the composer's place, storage and phone sheet are driven in test/contracts/floating-composer-options.test.mjs and composer-launchers-browser.test.mjs.)
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync } from 'node:fs';
import { build } from 'esbuild';
import { Window } from 'happy-dom';

async function harness(t, view = { conversation: { id: 1 }, entries: [], docs: {} }, failure, closed = new Promise(() => {})) {
  const window = new Window({ url: 'https://fictional.invalid/', settings: { disableIframePageLoading: true } });
  const names = ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node', 'Text', 'DOMParser', 'MutationObserver', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame', 'IS_REACT_ACT_ENVIRONMENT', 'confirm', 'sessionStorage', 'localStorage', 'ResizeObserver', 'KeyboardEvent', 'addEventListener', 'removeEventListener', 'matchMedia', 'innerWidth', 'innerHeight'];
  const globals = new Map(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  for (const name of names) {
    const value = name === 'window' ? window : name === 'IS_REACT_ACT_ENVIRONMENT' ? true : window[name];
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value: typeof value === 'function' && /^[a-z]/.test(name) ? value.bind(window) : value });
  }
  window.HTMLElement.prototype.getBoundingClientRect = () => ({ width: 1200, height: 800, left: 0, right: 1200, top: 0, bottom: 800, x: 0, y: 0 });
  const { createElement, act } = await import('react');
  const { createRoot } = await import('react-dom/client');
  const out = new URL('../../.cache/floating-composer-window-test/', import.meta.url);
  mkdirSync(out, { recursive: true });
  const output = new URL('chat.mjs', out);
  await build({ entryPoints: [new URL('../fixtures/floating-chat.tsx', import.meta.url).pathname], outfile: output.pathname, bundle: true, format: 'esm', platform: 'node', jsx: 'automatic', packages: 'external', logLevel: 'silent' });
  const { FloatingChat, AgentContextProvider, readAgentContext, useAgentContext } = await import(output.href);
  const { createNativeChatController } = await import('@hachej/boring-ui-kit/native-chat');
  const element = window.document.createElement('div');
  window.document.body.append(element);
  const root = createRoot(element);
  const chat = createNativeChatController({ identity: { runtimeId: 'fictional', scopeId: 'fictional', principalId: 'alice' },
    conversation: { id: 1 }, context: { value: () => undefined, toString: () => 'fictional' }, history: false,
    source: { open: async () => { if (failure) throw failure; return ({ value: view, start() {}, closed, stop: async () => ({ kind: 'stopped' }) }); } } });
  t.after(async () => {
    await act(async () => root.unmount());
    chat.dispose();
    await window.happyDOM.close();
    for (const [name, descriptor] of globals) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name]; }
  });
  return { window, element, root, chat, act, createElement, FloatingChat, AgentContextProvider, readAgentContext, useAgentContext };
}

/** Renders the bar with the given storage props, moves it one step up with the grip's arrow key, and returns the storage contents. */
test('The floating composer pins the older revision when retried artifact calls reuse an ordinal', async t => {
  const descriptor = revision => ({ schema: 'boring.artifact', version: 1, id: 'plan', title: 'Plan', type: 'code', mediaType: 'text/plain', ordinal: 1,
    target: { resource: { providerId: 'fictional', path: 'plan.txt' }, view: { kind: 'published' } }, revision });
  const entry = (id, revision) => ({ id, model: [
    { role: 'assistant', content: [{ type: 'toolCall', id: 'retry', name: 'present', arguments: { path: 'plan.txt' } }], stopReason: 'toolUse' },
    { role: 'toolResult', toolCallId: 'retry', toolName: 'present', content: [{ type: 'text', text: JSON.stringify({ artifact: descriptor(revision) }) }] },
    { role: 'user', content: `Next ${id}`, timestamp: id },
  ] });
  const view = { conversation: { id: 1 }, entries: [entry(1, 'old'), entry(2, 'new')], docs: {} };
  const { element, root, chat, act, createElement: h, FloatingChat } = await harness(t, view);
  let panel;
  await act(async () => root.render(h(FloatingChat, { controller: chat, 
    artifactPanel: (artifact, api) => { panel = { artifact, api }; return h('p', null, artifact.revision); } })));
  const cards = element.querySelectorAll('[data-testid=artifact-card][data-state=ready]');
  assert.equal(cards.length, 2);
  await act(async () => cards[0].click());
  assert.equal(panel.artifact.revision, 'old');
  assert.equal(panel.api.follow, false, 'equal ordinals do not make an old revision follow');
  assert.deepEqual(panel.api.versions.map(item => item.revision), ['new', 'old'], 'conversation order breaks ordinal ties');
  await act(async () => panel.api.select('latest'));
  assert.equal(panel.artifact.revision, 'new');
  assert.equal(panel.api.follow, true);
});

test('A card opens the host\'s panel, which reports its real mount and its failures to the composer\'s api', async t => {
  const descriptor = { schema: 'boring.artifact', version: 1, id: 'plan', title: 'Plan', type: 'code', mediaType: 'text/plain',
    target: { resource: { providerId: 'fictional', path: 'plan.txt' }, view: { kind: 'published' } }, revision: 'observed' };
  const view = { conversation: { id: 1 }, entries: [{ id: 1, model: [
    { role: 'assistant', content: [{ type: 'toolCall', id: 'ready', name: 'present', arguments: { path: 'plan.txt' } }], stopReason: 'toolUse' },
    { role: 'toolResult', toolCallId: 'ready', toolName: 'present', content: [{ type: 'text', text: JSON.stringify({ artifact: descriptor }) }] },
  ] }], docs: {} };
  const { element, root, chat, act, createElement: h, FloatingChat } = await harness(t, view);
  let panel;
  await act(async () => root.render(h(FloatingChat, { controller: chat, artifactPanel: (artifact, api) => { panel = api; return h('p', null, artifact.revision); } })));
  await act(async () => element.querySelector('[data-testid=artifact-card][data-state=ready]').click());
  assert.ok(element.querySelector('[data-testid=composer-pane]'), 'the card opened the pane');
  assert.equal(typeof panel.onShown, 'function', 'the host can report a real mount');
  assert.equal(typeof panel.onFailed, 'function');
  await act(async () => { panel.onShown({ path: 'plan.txt', revision: 'observed' }); panel.onFailed({ path: 'plan.txt', revision: 'observed', reason: 'fictional load failed' }); });
});

test('the floating composer uses the shared below-768 phone layout and releases its media listener', async t => {
  const { window, element, root, chat, act, createElement, FloatingChat, AgentContextProvider, readAgentContext, useAgentContext } = await harness(t);
  window.happyDOM.setWindowSize({ width: 700, height: 800 });
  const original = globalThis.matchMedia;
  const listeners = new Set();
  globalThis.matchMedia = query => {
    const media = original(query);
    const add = media.addEventListener.bind(media), remove = media.removeEventListener.bind(media);
    media.addEventListener = (type, listener, ...rest) => { if (type === 'change') listeners.add(listener); add(type, listener, ...rest); };
    media.removeEventListener = (type, listener, ...rest) => { if (type === 'change') listeners.delete(listener); remove(type, listener, ...rest); };
    return media;
  };
  await act(async () => root.render(createElement(FloatingChat, { controller: chat })));
  const phone = () => !element.querySelector('[data-testid=composer-floating]');
  assert.equal(phone(), true, '700px uses the phone layout (no floating frame)');
  for (const [width, expected] of [[767, true], [767.5, true], [768, false], [1024, false], [700, true]]) {
    await act(async () => window.happyDOM.setWindowSize({ width, height: 800 }));
    assert.equal(phone(), expected, `${width}px phone state`);
  }
  assert.ok(listeners.size > 0, 'media changes are observed');
  await act(async () => root.render(null));
  assert.equal(listeners.size, 0, 'unmount releases every media listener');
});

test('the floating composer remains usable when the browser denies storage access', async t => {
  const { element, root, chat, act, createElement, FloatingChat, AgentContextProvider, readAgentContext, useAgentContext } = await harness(t);
  for (const name of ['sessionStorage', 'localStorage']) Object.defineProperty(globalThis, name, { configurable: true, get() { throw new Error('fixture storage denied'); } });
  await act(async () => root.render(createElement(FloatingChat, { controller: chat })));
  assert.ok(element.querySelector('[data-testid=composer-input]'), 'denied persistence does not disable chat');
});

test('an app that keeps its own agent-context provider around its screens still has them read beside the floating composer', async t => {
  const { element, root, chat, act, createElement: h, FloatingChat, AgentContextProvider, readAgentContext, useAgentContext } = await harness(t);
  const Screen = () => { useAgentContext({ name: 'Approvals', params: { queue: 'open' } }); return null; };
  await act(async () => root.render(h(AgentContextProvider, null, h(Screen))));
  // The composer comes up later (the chat connects, or the app floats it): its layer must not take the registry over.
  await act(async () => root.render(h(AgentContextProvider, null, h(Screen), h(FloatingChat, { controller: chat }))));
  assert.ok(element.querySelector('[data-testid=composer-input]'), 'the composer is up');
  assert.deepEqual(readAgentContext(), { name: 'Approvals', params: { queue: 'open' } }, 'the screen the app registered is the context a message carries');
});
