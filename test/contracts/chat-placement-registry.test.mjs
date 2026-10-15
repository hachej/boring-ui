import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { Window } from 'happy-dom';

// Two presenters can show one controller (for example a drawer that hands over to a floating panel): each has its own registration, so
// unmounting one never clears the other's placement, and the latest surviving registration wins.
const root = fileURLToPath(new URL('../../', import.meta.url));

test('one presenter unmounting leaves the other presenter\'s placement in place', async t => {
  const out = `${root}.cache/chat-placement-test`;
  mkdirSync(out, { recursive: true });
  writeFileSync(`${out}/registry.tsx`, `
    import { createElement as h } from 'react';
    import { readChatPlacement, useChatPlacement } from '${root}registry/pi-chat/use-remote-chat.ts';
    export { readChatPlacement };
    export const Presenter = ({ controller, placement }) => { useChatPlacement(controller, placement); return null; };
    export const show = (controller, presenters) => presenters.map(([key, placement]) => h(Presenter, { key, controller, placement }));`);
  await build({ entryPoints: [`${out}/registry.tsx`], outfile: `${out}/registry.mjs`, bundle: true, format: 'esm', platform: 'node', jsx: 'automatic', packages: 'external', logLevel: 'silent' });
  const window = new Window({ url: 'https://fictional.invalid/' });
  const names = ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node', 'IS_REACT_ACT_ENVIRONMENT'];
  const saved = new Map(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  for (const name of names) Object.defineProperty(globalThis, name, { configurable: true, writable: true, value: name === 'window' ? window : name === 'IS_REACT_ACT_ENVIRONMENT' ? true : window[name] });
  t.after(() => { for (const [name, descriptor] of saved) descriptor ? Object.defineProperty(globalThis, name, descriptor) : delete globalThis[name]; window.close(); });
  const { readChatPlacement, show } = await import(`${pathToFileURL(`${out}/registry.mjs`).href}?${Date.now()}`);
  const { act } = await import('react');
  const { createRoot } = await import('react-dom/client');
  const container = window.document.createElement('div');
  window.document.body.append(container);
  const view = createRoot(container);
  const controller = {};
  const render = presenters => act(async () => view.render(show(controller, presenters)));
  try {
    await render([['drawer', 'docked']]);
    assert.equal(readChatPlacement(controller), 'docked');
    await render([['drawer', 'docked'], ['panel', 'floating']]);
    assert.equal(readChatPlacement(controller), 'floating', 'the latest registration wins');
    await render([['drawer', 'docked']]);
    assert.equal(readChatPlacement(controller), 'docked', 'the survivor reports after the other unmounts');
    await render([['drawer', 'floating']]);
    assert.equal(readChatPlacement(controller), 'floating', 'a changed placement replaces the registration');
    await render([]);
    assert.equal(readChatPlacement(controller), undefined, 'nothing is reported once every presenter is gone');
  } finally { await act(async () => view.unmount()); }
});
