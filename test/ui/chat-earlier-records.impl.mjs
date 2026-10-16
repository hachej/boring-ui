import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync } from 'node:fs';
import { build } from 'esbuild';
import { Window } from 'happy-dom';
import { Harness, MemoryStorage, createRegistry } from '@earendil-works/pi-durable';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import { createFakeChatModel } from '@hachej/boring-testing/model';
import { createNativeChatController } from '@hachej/boring-ui-kit/native-chat';

test('transcript history loads real persisted native records without restoring them to model context', { timeout: 30000 }, async t => {
  const window = new Window({ url: 'https://fictional.invalid/' });
  const names = ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node', 'Text', 'MutationObserver', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame', 'ResizeObserver', 'sessionStorage', 'addEventListener', 'removeEventListener', 'matchMedia', 'innerWidth', 'innerHeight', 'IS_REACT_ACT_ENVIRONMENT'];
  const globals = new Map(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  for (const name of names) {
    const value = name === 'window' ? window : name === 'IS_REACT_ACT_ENVIRONMENT' ? true : window[name];
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value: typeof value === 'function' && /^[a-z]/.test(name) ? value.bind(window) : value });
  }
  const { createElement, act } = await import('react'); const { createRoot } = await import('react-dom/client');
  const out = new URL('../../.cache/chat-earlier-records/', import.meta.url); mkdirSync(out, { recursive: true });
  const output = new URL('chats.mjs', out);
  await build({ stdin: { contents: `export { PiChat } from ${JSON.stringify(new URL('../../registry/pi-chat/pi-chat.tsx', import.meta.url).pathname)}; export { AgentWorkspace } from ${JSON.stringify(new URL('../../registry/pi-app/agent-workspace.tsx', import.meta.url).pathname)}; export { AmbientChat } from ${JSON.stringify(new URL('../../registry/pi-ambient/ambient.tsx', import.meta.url).pathname)};`, resolveDir: process.cwd(), sourcefile: 'earlier-records.tsx' }, outfile: output.pathname, bundle: true, format: 'esm', platform: 'node', jsx: 'automatic', packages: 'external', loader: { '.css': 'empty' }, plugins: [{ name: 'file-tree-css', setup(builder) { builder.onResolve({ filter: /^@hachej\/boring-ui-kit\/file-tree\.css$/ }, () => ({ path: new URL(import.meta.resolve('@hachej/boring-ui-kit/file-tree.css')).pathname, external: false })); } }] });
  const { PiChat, AgentWorkspace, AmbientChat } = await import(output.href);
  const fake = createFakeChatModel();
  const harness = await Harness.open(new MemoryStorage(), { registry: createRegistry(), models: fake.models }, context);
  const conversation = await harness.createConversation({ ownership: { kind: 'ownerless' }, agent: { model: fake.model } }, context);
  await conversation.submit({ type: 'write', entry: { kind: 'fictional.note', model: [{ role: 'user', content: 'Archived fictional notebook', timestamp: 0 }] } }, context);
  await conversation.reset('Fictional context boundary', context);
  const controller = createNativeChatController({ identity: { runtimeId: 'fictional', scopeId: 'fictional', principalId: 'alice' }, conversation, context });
  await controller.connect();
  const activeIds = controller.getSnapshot().view.entries.map(entry => entry.id);
  const element = document.createElement('div'); document.body.append(element); const root = createRoot(element);
  t.after(async () => {
    await act(async () => root.unmount()); await controller.dispose(); await harness.close(context); await window.happyDOM.close();
    for (const [name, descriptor] of globals) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name]; }
  });
  const conversations = { items: [{ id: String(conversation.id), title: 'Fictional chat' }], activeId: String(conversation.id), onSelect() {} };
  const cases = [
    ['no header', () => createElement(PiChat, { controller, header: false, showHistory: false })],
    ['standalone navigation', () => createElement(AgentWorkspace, { controller, conversationId: String(conversation.id), conversations, resources: { identity: { scopeId: 'fictional', principalId: 'alice', initiatorId: 'alice' }, endpoint: 'https://fictional.invalid/resources', fetch: async () => { throw new Error('Unexpected file request'); } } })],
    ['floating', () => createElement(AmbientChat, { controller, defaultState: 'expanded', notifications: false })],
    ['agent page', () => createElement(AmbientChat, { controller, embedded: true, defaultState: 'expanded', notifications: false })],
  ];
  for (const [label, render] of cases) await t.test(label, async () => {
    controller.clearHistory();
    await act(async () => root.render(render()));
    const load = element.querySelector('[data-testid=transcript-history-load]');
    assert.ok(load && !load.disabled, `${label}: persisted records have a transcript-top control`);
    assert.equal(element.querySelector('[data-testid=history-open]'), null, `${label}: no duplicate header History is needed`);
    await act(async () => load.click());
    for (let attempt = 0; attempt < 100 && !element.textContent.includes('Archived fictional notebook'); attempt++) await act(async () => new Promise(resolve => setTimeout(resolve, 5)));
    assert.match(element.querySelector('[data-testid=transcript-history]').textContent, /Archived fictional notebook/);
    assert.deepEqual(controller.getSnapshot().view.entries.map(entry => entry.id), activeIds, 'reading history never changes active model context');
    assert.equal(controller.getSnapshot().history.kind, 'ready');
    await act(async () => root.render(null));
    assert.equal(controller.getSnapshot().disposed, false, 'presentation borrows the native controller');
  });
});
