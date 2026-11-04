// The switch that turns developer mode on for one browser, no code change (D-1470): the real PiChat over a native controller and a real
// reply from a fake model. An app that sets `presentation="natural"` and no `mode` must still show the model line once the switch is on.
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync } from 'node:fs';
import { build } from 'esbuild';
import { Window } from 'happy-dom';
import { Harness, MemoryStorage, createRegistry } from '@earendil-works/pi-durable';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import { createFakeChatModel } from '@hachej/boring-testing/model';
import { createNativeChatController } from '@hachej/boring-ui-kit/native-chat';

test('?chatMode=developer shows which model answered, stays on in this browser, and ?chatMode=expert turns it off', { timeout: 30000 }, async t => {
  const window = new Window({ url: 'https://fictional.invalid/' });
  const names = ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node', 'Text', 'MutationObserver', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame', 'ResizeObserver', 'sessionStorage', 'localStorage', 'addEventListener', 'removeEventListener', 'matchMedia', 'innerWidth', 'innerHeight', 'IS_REACT_ACT_ENVIRONMENT'];
  const globals = new Map(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  for (const name of names) {
    const value = name === 'window' ? window : name === 'IS_REACT_ACT_ENVIRONMENT' ? true : window[name];
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value: typeof value === 'function' && /^[a-z]/.test(name) ? value.bind(window) : value });
  }
  const { createElement, act } = await import('react'); const { createRoot } = await import('react-dom/client');
  const out = new URL('../../.cache/pi-chat-developer-switch/', import.meta.url); mkdirSync(out, { recursive: true });
  const output = new URL('chat.mjs', out);
  await build({ entryPoints: [new URL('../../registry/pi-chat/pi-chat.tsx', import.meta.url).pathname], outfile: output.pathname, bundle: true, format: 'esm', platform: 'node', jsx: 'automatic', packages: 'external', loader: { '.css': 'empty' }, plugins: [{ name: 'file-tree-css', setup(builder) { builder.onResolve({ filter: /^@hachej\/boring-ui-kit\/file-tree\.css$/ }, () => ({ path: new URL(import.meta.resolve('@hachej/boring-ui-kit/file-tree.css')).pathname, external: false })); } }] });
  const { PiChat } = await import(output.href);
  const fake = createFakeChatModel();
  const harness = await Harness.open(new MemoryStorage(), { registry: createRegistry(), models: fake.models }, context);
  const conversation = await harness.createConversation({ ownership: { kind: 'ownerless' }, agent: { model: fake.model } }, context);
  const controller = createNativeChatController({ identity: { runtimeId: 'fictional', scopeId: 'fictional', principalId: 'alice' }, conversation, context });
  await controller.connect();
  const element = document.createElement('div'); document.body.append(element); const root = createRoot(element);
  t.after(async () => {
    await act(async () => root.unmount()); await controller.dispose(); await harness.close(context); await window.happyDOM.close();
    for (const [name, descriptor] of globals) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name]; }
  });

  controller.setText('Quel temps demain à Port-Imaginaire ?');
  await controller.send();
  (await fake.nextCall()).respond('Du soleil sur le port.');
  await act(async () => root.render(createElement(PiChat, { controller, header: false, presentation: 'natural' })));
  const until = async condition => { for (let attempt = 0; attempt < 200 && !condition(); attempt++) await act(async () => new Promise(resolve => setTimeout(resolve, 5))); assert.ok(condition()); };
  await until(() => element.textContent.includes('Du soleil sur le port.') && controller.getSnapshot().view?.isStreaming !== true);

  const visit = async search => {
    await act(async () => root.render(null));
    window.happyDOM.setURL(`https://fictional.invalid/${search}`);
    await act(async () => root.render(createElement(PiChat, { controller, header: false, presentation: 'natural' })));
  };
  const line = () => element.querySelector('[data-testid=answered-by]');

  assert.equal(line(), null, 'a person sees no model line');
  await visit('?chatMode=developer');
  await until(() => line() !== null);
  assert.match(line().textContent, /fictional-chat-provider\//, 'the reply names its model');
  await visit('');
  assert.ok(line(), 'the address loses the switch on the next page: it stays on in this browser');
  await visit('?chatMode=expert');
  assert.equal(line(), null, 'turned off');
  await visit('');
  assert.equal(line(), null, 'and it stays off');
});
