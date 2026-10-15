import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { Window } from 'happy-dom';

// Placement (docs/architecture/PAGE-TOOLS.md, PLACE-1..3): the component that shows the chat reports `docked` or `floating`, and
// `useRemoteChat` sends `{ placement, screen }` with each submit. Here a real `Dock` floats and docks a chat (the dock-app's switch).
const root = fileURLToPath(new URL('../../', import.meta.url));

test('floating and docking a chat changes the placement sent with the next submit; the controller stays', async t => {
  const out = `${root}.cache/chat-placement-test`;
  mkdirSync(out, { recursive: true });
  writeFileSync(`${out}/entry.tsx`, `
    import { createElement as h } from 'react';
    import { Dock, DockLayout, DockMain } from '${root}registry/dock/dock.tsx';
    import { useChatPlacement, useRemoteChat } from '${root}registry/pi-chat/use-remote-chat.ts';
    export const mount = ({ fetch, onReady, screen }) => {
      // A host's chat: what PiChat (docked) and AmbientChat (floating) each do on mount, without their whole UI.
      const Reporter = ({ controller, floating }) => { useChatPlacement(controller, floating ? 'floating' : 'docked'); return null; };
      const Chat = ({ api }) => {
        const chat = useRemoteChat({ conversationId: 'c1', endpoint: id => new URL('https://fixture.invalid/chat?c=' + id), fetch,
          identity: { runtimeId: 'r', scopeId: 's', principalId: 'p' }, requestContext: () => screen });
        if (chat.status !== 'ready') return null;
        onReady(chat.controller, api);
        return h(Reporter, { controller: chat.controller, floating: api.floating });
      };
      return h(DockLayout, { storageKey: 'placement-test', persist: 'session' },
        h(Dock, { id: 'chat', side: 'left', floatable: true, dragBelow: 260, defaultWidth: 420 }, api => h(Chat, { api })),
        h(DockMain, null, 'main'));
    };`);
  await build({ entryPoints: [`${out}/entry.tsx`], outfile: `${out}/entry.mjs`, bundle: true, format: 'esm', platform: 'node', jsx: 'automatic', packages: 'external', logLevel: 'silent' });
  const window = new Window({ url: 'https://fictional.invalid/', width: 1200, height: 800 });
  const names = ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node', 'IS_REACT_ACT_ENVIRONMENT', 'sessionStorage', 'localStorage'];
  const saved = new Map(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  for (const name of names) Object.defineProperty(globalThis, name, { configurable: true, writable: true, value: name === 'window' ? window : name === 'IS_REACT_ACT_ENVIRONMENT' ? true : window[name] });
  t.after(() => { for (const [name, descriptor] of saved) descriptor ? Object.defineProperty(globalThis, name, descriptor) : delete globalThis[name]; window.close(); });
  const { mount } = await import(`${pathToFileURL(`${out}/entry.mjs`).href}?${Date.now()}`);
  const { act } = await import('react');
  const { createRoot } = await import('react-dom/client');

  const submits = [];
  const view = { conversation: { id: 'c1' }, entries: [], docs: {} };
  const fetch = async request => {
    const op = new URL(request.url).searchParams.get('op');
    if (op === 'watch') return new Response(JSON.stringify({ kind: 'view', view }) + '\n', { headers: { 'content-type': 'application/x-ndjson' } });
    if (op === 'submit') { submits.push(await request.json()); return Response.json({ submissionId: submits.length }); }
    return new Response('{}', { status: 404 });
  };
  let controller, dock;
  const screen = { name: 'Invoice', params: { id: 'INV-1' } };
  const container = window.document.createElement('div');
  window.document.body.append(container);
  const root_ = createRoot(container);
  await act(async () => root_.render(mount({ fetch, screen, onReady: (c, api) => { controller = c; dock = api; } })));
  for (let i = 0; i < 50 && !controller; i++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
  assert.ok(controller, 'the chat connected');
  const first = controller;
  const send = async text => { await act(async () => { await controller.send('followUp', { text }); }); };

  try {
    await send('one');
    await act(async () => dock.float());
    await send('two');
    await act(async () => dock.dock());
    await send('three');
  } finally { await act(async () => root_.unmount()); } // closes the chat's stream
  assert.equal(controller, first, 'floating and docking keep the controller');
  assert.deepEqual(submits.map(body => body.context), [
    { ...screen, placement: 'docked' }, { ...screen, placement: 'floating' }, { ...screen, placement: 'docked' }]);
  // A host written before placement existed reads `name` and `params` at the top level of what the transport hands it.
  const oldHost = body => `${body.context.name} ${JSON.stringify(body.context.params)}`;
  assert.deepEqual(submits.map(oldHost), Array(3).fill('Invoice {"id":"INV-1"}'));
});
