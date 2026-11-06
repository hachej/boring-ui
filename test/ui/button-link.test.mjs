import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { Window } from 'happy-dom';

const root = fileURLToPath(new URL('../../', import.meta.url));

test('a link-styled Button is a link: role link, no Space activation, everything else as a Button', async t => {
  const window = new Window({ url: 'https://fictional.invalid/' });
  const names = ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node', 'Text', 'KeyboardEvent', 'MouseEvent', 'MutationObserver', 'getComputedStyle', 'IS_REACT_ACT_ENVIRONMENT'];
  const globals = new Map(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  for (const name of names) Object.defineProperty(globalThis, name, { configurable: true, writable: true, value: name === 'window' ? window : name === 'IS_REACT_ACT_ENVIRONMENT' ? true : name === 'getComputedStyle' ? window[name].bind(window) : window[name] });
  const { createElement: h, act } = await import('react');
  const { createRoot } = await import('react-dom/client');
  const out = `${root}.cache/button-link/`; mkdirSync(out, { recursive: true });
  await build({
    stdin: { contents: `export { Button } from '@/components/ui/button'; export { PaginationLink } from '${root}shadcn/ui/pagination'; export { HeaderActions } from '${root}registry/app-shell/header-actions';`, resolveDir: root, loader: 'tsx' },
    outfile: `${out}bundle.mjs`, bundle: true, format: 'esm', platform: 'node', jsx: 'automatic', packages: 'external',
    plugins: [{ name: 'real-button', setup(b) { b.onResolve({ filter: /^@\/components\/ui\/button$/ }, () => ({ path: `${root}shadcn/ui/button.tsx` })); } }],
  });
  const { Button, PaginationLink, HeaderActions } = await import(`file://${out}bundle.mjs`);
  const host = window.document.createElement('div'); window.document.body.append(host); const react = createRoot(host);
  t.after(async () => { await act(async () => react.unmount()); await window.happyDOM.close(); for (const [name, descriptor] of globals) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name]; } });
  const show = async node => { await act(async () => react.render(node)); return host.firstElementChild; };
  const key = async (el, type, k) => { const event = new window.KeyboardEvent(type, { key: k, bubbles: true, cancelable: true }); await act(async () => { el.dispatchEvent(event); }); return event; };

  const link = await show(h(Button, { nativeButton: false, render: h('a', { href: '/x' }) }, 'Go'));
  assert.ok(link.tagName === 'A' && link.getAttribute('role') === 'link', 'a render <a href> is a link');
  assert.ok(link.getAttribute('tabindex') === '0', 'a link stays focusable');
  assert.ok(link.className.includes('focus-visible:ring-3') && link.className.includes('focus-visible:ring-ring/50'), 'the focus ring remains');
  assert.ok(link.getAttribute('type') === null, 'no button type on a link');

  const bare = await show(h(Button, { render: h('a', { href: '/x' }) }, 'Go'));
  assert.ok(bare.getAttribute('role') === 'link' && bare.getAttribute('type') === null, 'render <a href> alone is a link, with no button type');
  let routed = 0;
  const Custom = ({ destination, ...rest }) => h('a', { ...rest, 'data-to': destination });
  const custom = await show(h(Button, { role: 'link', render: h(Custom, { destination: '/reports' }), onClick: () => { routed++; } }, 'Go'));
  await key(custom, 'keydown', ' '); await key(custom, 'keyup', ' ');
  assert.ok(custom.getAttribute('role') === 'link' && custom.getAttribute('type') === null && routed === 0, 'role link on a render element with another prop name is a link: no type, Space does not click');
  const explicit = await show(h(Button, { nativeButton: true, render: h('a', { href: '/x' }) }, 'Go'));
  assert.ok(!explicit.hasAttribute('role') && explicit.getAttribute('type') === 'button', 'an explicit nativeButton true stays as it was');
  assert.ok((await show(h(Button, { nativeButton: false, role: 'menuitem', render: h('a', { href: '/x' }) }, 'Go'))).getAttribute('role') === 'menuitem', 'an explicit role wins');
  assert.ok((await show(h(Button, { nativeButton: false, render: h('a', { href: '/x', role: 'tab' }) }, 'Go'))).getAttribute('role') === 'tab', 'a role on the render element wins');
  assert.ok((await show(h(Button, { nativeButton: false, render: h('a', {}) }, 'Go'))).getAttribute('role') === 'button', 'an <a> without href stays a button');
  const router = await show(h(Button, { nativeButton: false, render: h('a', { to: '/x' }) }, 'Go'));
  assert.ok(router.getAttribute('role') === 'link', 'a router link with `to` is a link');
  const plain = await show(h(Button, null, 'Go'));
  assert.ok(!plain.hasAttribute('role') && plain.getAttribute('type') === 'button', 'a plain Button has no role and type button');

  assert.ok((await show(h(PaginationLink, { href: '/p/2' }, '2'))).getAttribute('role') === 'link', 'PaginationLink is a link');
  const header = await show(h(HeaderActions, { actions: [{ id: 'docs', label: 'Docs', icon: () => null, href: '/docs', onSelect() {} }], compact: false, text: {}, prefix: 'h', run() {} }));
  assert.ok(host.querySelector('[data-testid=h-action-docs]').getAttribute('role') === 'link', 'the header-actions link is a link');
  const download = await show(h(Button, { nativeButton: false, render: h('a', { href: 'blob:fictional', download: 'a.txt' }), 'data-testid': 'blob-download' }, 'Download'));
  assert.ok(download.getAttribute('role') === 'link', 'a file-viewer style download anchor is a link');

  let clicks = 0, caller = 0;
  const live = await show(h(Button, { nativeButton: false, render: h('a', { href: '/x' }), onClick: () => { clicks++; }, onKeyDown: () => { caller++; } }, 'Go'));
  const down = await key(live, 'keydown', ' '); await key(live, 'keyup', ' ');
  assert.ok(!down.defaultPrevented, 'Space keydown on a link is not prevented');
  assert.ok(clicks === 0, 'Space does not click a link');
  assert.ok(caller === 1, 'the caller onKeyDown still runs');
  const enter = await key(live, 'keydown', 'Enter');
  assert.ok(!enter.defaultPrevented, 'Enter is left to the browser');

  clicks = 0;
  const span = await show(h(Button, { nativeButton: false, render: h('span'), onClick: () => { clicks++; } }, 'Go'));
  assert.ok(span.getAttribute('role') === 'button', 'a span stays a button');
  await key(span, 'keydown', ' '); await key(span, 'keyup', ' ');
  assert.ok(clicks === 1, 'Space still clicks a non-link control');
  clicks = 0;
  const other = await show(h(Button, { nativeButton: false, role: 'menuitem', render: h('a', { href: '/x' }), onClick: () => { clicks++; } }, 'Go'));
  await key(other, 'keydown', ' '); await key(other, 'keyup', ' ');
  assert.ok(clicks === 1, 'an explicit other role keeps Base UI behaviour');
});
