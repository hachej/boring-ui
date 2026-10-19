import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync } from 'node:fs';
import { build } from 'esbuild';
import { Window } from 'happy-dom';
import { createSharedChat, createFakeChannelSource } from '@hachej/boring-ui-kit/shared-chat';
import { sharedChatSeed } from '../../examples/shared-chat/seed.mjs';

test('PiChat renders and operates the host shared conversation', { timeout: 60000 }, async t => {
  const window = new Window({ url: 'https://fictional.invalid/' });
  const names = ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node', 'Text', 'DOMParser', 'MutationObserver', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame', 'ResizeObserver', 'sessionStorage', 'localStorage', 'matchMedia', 'IS_REACT_ACT_ENVIRONMENT'];
  const globals = new Map(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  for (const name of names) {
    const value = name === 'window' ? window : name === 'IS_REACT_ACT_ENVIRONMENT' ? true : window[name];
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value: typeof value === 'function' && /^[a-z]/.test(name) ? value.bind(window) : value });
  }
  const { createElement, act } = await import('react'); const { createRoot } = await import('react-dom/client');
  mkdirSync(new URL('../../.cache/shared-chat-test/', import.meta.url), { recursive: true });
  const output = new URL('../../.cache/shared-chat-test/chat.mjs', import.meta.url);
  await build({ entryPoints: [new URL('../../registry/pi-chat/pi-chat.tsx', import.meta.url).pathname], outfile: output.pathname, bundle: true, format: 'esm', platform: 'node', jsx: 'automatic', packages: 'external', tsconfig: new URL('../../tsconfig.json', import.meta.url).pathname });
  const { PiChat } = await import(output.href);
  const source = createFakeChannelSource(sharedChatSeed);
  let controller = createSharedChat(source, { conversationId: 'main' });
  const controllers = [controller];
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  const q = selector => document.querySelector(selector);
  const settle = async ready => { for (let n = 0; n < 200 && !ready(); n++) await act(async () => new Promise(resolve => setTimeout(resolve, 10))); assert.ok(ready(), 'expected UI appeared'); };
  const render = () => act(async () => root.render(createElement(PiChat, { controller, conversations: { items: sharedChatSeed.conversations, activeId: controller.getSnapshot().conversationId, onSelect(id) { controller = createSharedChat(source, { conversationId: id }); controllers.push(controller); void render(); } } })));
  t.after(async () => { await act(async () => { root.unmount(); for (const controller of controllers) await controller.dispose(); }); await window.happyDOM.close(); for (const [name, descriptor] of globals) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name]; } });
  await render();
  await settle(() => q('[data-shared-message="one"]'));

  await t.test('author grouping, avatars, agent and admin badges; own bubble stays unchanged', async () => {
    assert.equal(q('[data-shared-message="one"] [data-testid=message-author]')?.textContent, 'Leo');
    assert.ok(q('[data-shared-message="one"] [data-testid=member-avatar]'));
    assert.equal(q('[data-shared-message="two"] [data-testid=message-author]'), null);
    assert.equal(q('[data-shared-message="four"] [data-testid=author-badge]')?.textContent, 'Admin');
    assert.equal(q('[data-shared-message="five"] [data-testid=author-badge]')?.textContent, 'App');
    assert.ok(q('[data-shared-message="three"] [data-testid=user-text]'));
    assert.equal(q('[data-shared-message="three"] [data-testid=message-author]'), null);
  });
  await t.test('request action and replacement through the timeline', async () => {
    await act(async () => q('[data-shared-message="six"] button').click());
    assert.deepEqual(source.actions, [{ conversationId: 'main', requestId: 'review-plan', actionId: 'review' }]);
    await act(async () => source.emit({ type: 'message', message: { ...sharedChatSeed.messages.find(message => message.id === 'six'), card: { requestId: 'review-plan', title: 'Review complete', line: 'Accepted by the host.' } } }));
    assert.match(q('[data-shared-message="six"]').textContent, /Review complete/);
    assert.equal(document.querySelectorAll('[data-shared-message="six"]').length, 1);
  });
  await t.test('delta keeps the existing assistant streaming row identity', async () => {
    await act(async () => source.emit({ type: 'message', message: { id: 'stream', conversationId: 'main', author: 'pm', at: new Date().toISOString(), text: 'Checking', streaming: true } }));
    const row = q('[data-shared-message="stream"] [data-role=assistant]');
    assert.equal(row?.dataset.streaming, 'true');
    await act(async () => source.emit({ type: 'delta', messageId: 'stream', conversationId: 'main', text: ' the plan.' }));
    assert.equal(q('[data-shared-message="stream"] [data-role=assistant]'), row);
    assert.match(row.textContent, /Checking the plan\./);
  });
  await t.test('member presence and live connection status', async () => {
    await act(async () => q('[data-testid=shared-members]').click());
    await settle(() => q('[data-testid=member-list]'));
    assert.match(q('[data-testid=member-list]').textContent, /Julien \(admin\)/);
    assert.equal(q('[data-member-id=leo] [data-testid=presence]')?.dataset.presence, 'here');
    await act(async () => source.emit({ type: 'presence', members: [{ id: 'leo', presence: 'away' }] }));
    assert.equal(q('[data-member-id=leo] [data-testid=presence]')?.dataset.presence, 'away');
    await act(async () => source.setStatus('reconnecting'));
    assert.equal(q('[data-testid=shared-status]')?.dataset.status, 'reconnecting');
    await act(async () => source.setStatus('offline'));
    assert.equal(q('[data-testid=shared-status]')?.dataset.status, 'offline');
    await act(async () => { source.setStatus('live'); q('[data-testid=shared-members]').click(); });
  });
  await t.test('existing composer mention picker sends member ids', async () => {
    const textarea = q('textarea');
    await act(async () => { controller.setText('@Le'); textarea.focus(); textarea.setSelectionRange(3, 3); textarea.dispatchEvent(new window.Event('select', { bubbles: true })); });
    await settle(() => q('[data-testid=mention-item]'));
    assert.match(q('[data-testid=mention-item]').textContent, /Leo/);
    await act(async () => textarea.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })));
    assert.match(controller.getSnapshot().draft.text, /@leo/);
    await act(async () => q('[data-testid=composer-submit]').click());
    await settle(() => source.sends.length > 0);
    assert.deepEqual(source.sends.at(-1).mentions, ['leo']);
  });
  await t.test('outbox retries exact clientId after reconnect and deduplicates the echo', async () => {
    await act(async () => { source.setStatus('offline'); controller.setText('Retained request'); });
    let sending;
    await act(async () => { sending = controller.send(); await Promise.resolve(); });
    const first = source.sends.at(-1);
    assert.equal(first.text, 'Retained request');
    // An event the page misses is recovered from history after the reconnect.
    source.emit({ type: 'message', message: { id: 'gap', conversationId: 'main', author: 'leo', at: new Date().toISOString(), text: 'Written while disconnected.' } });
    await act(async () => { source.setStatus('live'); await sending; });
    assert.equal(source.sends.at(-1).clientId, first.clientId);
    assert.equal(controller.getSnapshot().shared.messages.filter(message => message.clientId === first.clientId).length, 1);
    assert.match(q('[data-shared-message=gap]').textContent, /Written while disconnected/);
  });
  await t.test('History lists every supplied conversation and selects a direct conversation', async () => {
    await act(async () => q('[data-testid=history-open]').click());
    await settle(() => q('[data-testid=conversation-row]'));
    assert.equal(document.querySelectorAll('[data-testid=conversation-row]').length, 3);
    const row = [...document.querySelectorAll('[data-testid=conversation-row]')].find(row => row.textContent.includes('Mira and Leo'));
    await act(async () => row.click());
    await settle(() => q('[data-shared-message=direct-one]'));
    assert.equal(q('[data-shared-message=one]'), null);
  });
});
