import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { Window } from 'happy-dom';

// The shell's `locale` prop (registry/app-shell): with no agent, the shell's own words render in that language; with an agent that sets no
// locale, the layer's words follow the shell's `locale`; an agent's own `chatProps.locale` still wins. Its own file, so its DOM and bundles
// share no module or global state with the other app-shell source tests (bundling agent-layer leaves state that breaks later clicks there).
const root = fileURLToPath(new URL('../../', import.meta.url));
const folder = 'registry/app-shell';

async function bundle(name) {
  const out = `${root}.cache/app-shell-locale-test`;
  mkdirSync(out, { recursive: true });
  const outfile = `${out}/${name.replace(/\.tsx?$/, '')}.mjs`;
  await build({ entryPoints: [`${root}${folder}/${name}`], outfile, bundle: true, format: 'esm', platform: 'node', jsx: 'automatic', packages: 'external', alias: { '@': `${root}examples/app-shell` }, logLevel: 'silent' });
  return import(pathToFileURL(outfile).href);
}

/** A happy-dom page for rendering; restores the globals afterwards. */
function dom(t, width = 390) {
  const window = new Window({ url: 'https://fictional.invalid/' });
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
  const names = ['window', 'document', 'navigator', 'history', 'location', 'HTMLElement', 'Element', 'Node', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame', 'matchMedia', 'getSelection', 'MutationObserver', 'ResizeObserver', 'Event', 'CustomEvent', 'KeyboardEvent', 'MouseEvent', 'PointerEvent', 'FocusEvent', 'DOMRect', 'IS_REACT_ACT_ENVIRONMENT'];
  const saved = new Map(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  for (const name of names) Object.defineProperty(globalThis, name, { configurable: true, writable: true, value: name === 'window' ? window : name === 'IS_REACT_ACT_ENVIRONMENT' ? true : /^(?:getComputedStyle|requestAnimationFrame|cancelAnimationFrame|matchMedia|getSelection)$/.test(name) ? window[name].bind(window) : window[name] });
  t.after(() => { for (const [name, descriptor] of saved) descriptor ? Object.defineProperty(globalThis, name, descriptor) : delete globalThis[name]; window.close(); });
  return window;
}

const Icon = () => null;
const nav = ['Jour', 'Semaine', 'Mois', 'Progrès', 'Profil'].map(label => ({ id: label, label, icon: Icon, render: () => null }));
// A layer's agent without a transcript: the trigger and the layer's title read the spec, nothing here opens the chat.
const agentWith = chatProps => ({ controller: { getSnapshot: () => ({ draft: { text: '' } }), subscribe: () => () => {} }, ...(chatProps ? { chatProps } : {}) });

async function render(t, props) {
  const window = dom(t);
  const { AppShell } = await bundle('app-shell.tsx');
  const { createElement: h, act } = await import('react');
  const { createRoot } = await import('react-dom/client');
  const container = window.document.createElement('div');
  window.document.body.append(container);
  const root = createRoot(container);
  await act(async () => root.render(h(AppShell, { layout: 'screen', title: 'Forme', nav, route: { id: 'Jour', onChange() {} }, ...props })));
  return { container, window, unmount: () => act(async () => root.unmount()) };
}

test('with no agent, the shell\'s own words render in the locale prop, and the account sheet is titled « Compte »', async t => {
  const account = { name: 'Camille Martin', menu: [], signOut() {} };
  const { container, window, unmount } = await render(t, { account, locale: 'fr' });
  assert.equal(container.querySelector('[role=tablist]')?.getAttribute('aria-label'), 'Navigation');
  assert.equal(container.querySelector('[data-testid=tab-plus]')?.textContent, 'Plus');
  assert.equal(container.querySelector('[data-testid=account-button]')?.getAttribute('aria-label'), 'Camille Martin');
  const { act } = await import('react');
  await act(async () => container.querySelector('[data-testid=account-button]').dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true })));
  // The drawer mounts after the click's state update and its portal: wait for it (a few frames at most).
  for (let tries = 0; tries < 40 && !window.document.querySelector('[data-testid=app-sheet]'); tries++) await act(async () => new Promise(done => setTimeout(done, 25)));
  const sheet = window.document.querySelector('[data-testid=app-sheet]');
  assert.ok(sheet, 'the account sheet opens');
  assert.equal(sheet.querySelector('[data-slot=drawer-title]')?.textContent, 'Compte', 'the title is the generic word, so the name appears once (in the person block)');
  assert.equal(sheet.querySelector('[data-testid=account-sign-out]')?.textContent, 'Se déconnecter');
  await unmount();
});

test('the layer\'s own words follow the shell locale when the agent sets none; the agent\'s own locale wins', async t => {
  const trigger = async (agentChatProps, locale) => {
    const { container, unmount } = await render(t, { agent: agentWith(agentChatProps), locale });
    const label = container.querySelector('[data-testid=agent-trigger]')?.getAttribute('aria-label');
    await unmount();
    return label;
  };
  assert.equal(await trigger(undefined, 'fr'), 'Ouvrir l\'assistant', 'no agent locale: the shell\'s French');
  assert.equal(await trigger({ locale: 'en' }, 'fr'), 'Open the assistant', 'the agent\'s own locale wins');
  assert.equal(await trigger(undefined, undefined), 'Open the assistant', 'neither set: English');
});
