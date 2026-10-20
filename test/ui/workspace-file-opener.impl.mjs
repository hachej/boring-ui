import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync } from 'node:fs';
import { build } from 'esbuild';
import { Window } from 'happy-dom';
import { Harness, MemoryStorage, createRegistry } from '@earendil-works/pi-durable';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import { createFakeChatModel } from '@hachej/boring-testing/model';
import { createNativeChatController } from '@hachej/boring-ui-kit/native-chat';

test('AgentWorkspace preserves host file-opener precedence through the real native message', async t => {
  const window = new Window({ url: 'https://fictional.invalid/' });
  const names = ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node', 'Text', 'MutationObserver', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame', 'ResizeObserver', 'sessionStorage', 'matchMedia', 'IS_REACT_ACT_ENVIRONMENT'];
  const globals = new Map(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  for (const name of names) {
    const value = name === 'window' ? window : name === 'IS_REACT_ACT_ENVIRONMENT' ? true : window[name];
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value: typeof value === 'function' && /^[a-z]/.test(name) ? value.bind(window) : value });
  }
  const { createElement, act } = await import('react'); const { createRoot } = await import('react-dom/client');
  const out = new URL('../../.cache/workspace-file-opener/', import.meta.url); mkdirSync(out, { recursive: true });
  const output = new URL('workspace.mjs', out);
  await build({ entryPoints: [new URL('../../registry/pi-app/agent-workspace.tsx', import.meta.url).pathname], outfile: output.pathname, bundle: true, format: 'esm', platform: 'node', jsx: 'automatic', packages: 'external', loader: { '.css': 'empty' }, plugins: [{ name: 'file-tree-css', setup(builder) { builder.onResolve({ filter: /^@hachej\/boring-ui-kit\/file-tree\.css$/ }, () => ({ path: new URL(import.meta.resolve('@hachej/boring-ui-kit/file-tree.css')).pathname, external: false })); } }] });
  const { AgentWorkspace } = await import(output.href);
  const fake = createFakeChatModel();
  const harness = await Harness.open(new MemoryStorage(), { registry: createRegistry(), models: fake.models }, context);
  const conversation = await harness.createConversation({ ownership: { kind: 'ownerless' }, agent: { model: fake.model } }, context);
  await conversation.submit({ type: 'write', entry: { kind: 'fictional.note', model: [{ role: 'user', content: '@uploads/fictional-notes.md', timestamp: 0 }] } }, context);
  const controller = createNativeChatController({ identity: { runtimeId: 'fictional', scopeId: 'fictional', principalId: 'alice' }, conversation, context });
  await controller.connect();
  const element = document.createElement('div'); document.body.append(element); const root = createRoot(element);
  t.after(async () => {
    await act(async () => root.unmount()); await controller.dispose(); await harness.close(context); await window.happyDOM.close();
    for (const [name, descriptor] of globals) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name]; }
  });
  for (const explicit of [false, true]) await t.test(explicit ? 'explicit onOpenFile wins' : 'host mentions.open remains the fallback', async () => {
    const opened = [], selections = [];
    const mentions = { search: async () => [], open: path => opened.push(['mention', path]) };
    await act(async () => root.render(createElement(AgentWorkspace, { key: String(explicit), controller, conversationId: String(conversation.id), layout: 'embedded', storageKey: false,
      resources: { identity: { scopeId: 'fictional', principalId: 'alice', initiatorId: 'alice' }, endpoint: 'https://fictional.invalid/resources', fetch: async () => new Response(null, { status: 404 }) },
      onOpenedChange: value => selections.push(value), chat: { mentions, ...(explicit ? { onOpenFile: path => opened.push(['explicit', path]) } : {}) } })));
    const mention = element.querySelector('[data-testid=message-mention]'); assert.ok(mention);
    await act(async () => mention.click());
    assert.deepEqual(opened, [[explicit ? 'explicit' : 'mention', 'uploads/fictional-notes.md']]);
    assert.deepEqual(selections, [], 'the workspace must not bypass the host opener');
  });
});
