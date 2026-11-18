// McpSetup (registry/mcp-setup) rendered for real in happy-dom with the kit's Base UI popover: the header icon, the popover, the address and its copy,
// the steps per assistant, the words. Fictional app name and address only. Strings and booleans are compared, never elements.
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync } from 'node:fs';
import { build } from 'esbuild';
import { Window } from 'happy-dom';

const ADDRESS = 'https://carnet-fictif.invalid/mcp';

const mount = async (t, props = {}) => {
  const window = new Window({ url: 'https://carnet-fictif.invalid/' });
  const copied = [];
  Object.defineProperty(window.navigator, 'clipboard', { configurable: true, value: { writeText: async text => { copied.push(text); } } });
  const names = ['window', 'document', 'navigator', 'HTMLElement', 'HTMLButtonElement', 'Element', 'Node', 'Text', 'MutationObserver', 'ResizeObserver', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame', 'matchMedia', 'KeyboardEvent', 'PointerEvent', 'MouseEvent', 'FocusEvent', 'Event', 'IS_REACT_ACT_ENVIRONMENT'];
  const globals = new Map(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  for (const name of names) {
    const given = name === 'window' ? window : name === 'IS_REACT_ACT_ENVIRONMENT' ? true : window[name];
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value: typeof given === 'function' && /^[a-z]/.test(name) ? given.bind(window) : given });
  }
  const { createElement, act } = await import('react'); const { createRoot } = await import('react-dom/client');
  const out = new URL('../../.cache/mcp-setup-test/', import.meta.url); mkdirSync(out, { recursive: true });
  const output = new URL('mcp-setup.mjs', out);
  await build({ stdin: { contents: `export { McpSetup } from './mcp-setup/mcp-setup.tsx';`, resolveDir: new URL('../../registry/', import.meta.url).pathname, loader: 'tsx' }, outfile: output.pathname, bundle: true, format: 'esm', platform: 'node', jsx: 'automatic', packages: 'external' });
  const { McpSetup } = await import(output.href);
  const element = document.createElement('div'); document.body.append(element); const root = createRoot(element);
  t.after(async () => {
    await act(async () => root.unmount()); await window.happyDOM.close();
    for (const [name, descriptor] of globals) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name]; }
  });
  await act(async () => root.render(createElement(McpSetup, { address: ADDRESS, appName: 'Carnet', ...props })));
  const trigger = () => document.querySelector('[data-testid=mcp-setup-trigger]');
  const panel = () => document.querySelector('[data-testid=mcp-setup]');
  const button = text => [...panel().querySelectorAll('button')].find(b => b.textContent.trim() === text);
  const click = async target => { await act(async () => { target.click(); await new Promise(resolve => setTimeout(resolve, 0)); }); };
  return { trigger, panel, button, click, copied, act };
};

test('the icon is closed until clicked, then the popover shows the address exactly, the assistants and the sign-in sentence, in French', async t => {
  const ui = await mount(t);
  assert.equal(ui.trigger().getAttribute('aria-label'), 'Connecter un assistant');
  assert.equal(ui.panel(), null);
  await ui.click(ui.trigger());
  assert.equal(ui.panel().querySelector('[data-testid=mcp-setup-address]').textContent, ADDRESS);
  assert.match(ui.panel().textContent, /Connecter votre assistant à Carnet/);
  assert.equal(['Claude', 'ChatGPT', 'Claude Code', 'Autre'].every(name => ui.button(name)), true);
  assert.match(ui.panel().textContent, /Paramètres › Connecteurs/);
  assert.match(ui.panel().textContent, /vous connecter avec votre compte Carnet/);
  assert.doesNotMatch(ui.panel().textContent, /token|Bearer|cookie/i);
});

test('« Copier » copies the address and says « Copié »; Claude Code shows its command, which copies the same way', async t => {
  const ui = await mount(t);
  await ui.click(ui.trigger());
  await ui.click(ui.button('Copier'));
  assert.equal(JSON.stringify(ui.copied), JSON.stringify([ADDRESS]));
  assert.equal(Boolean(ui.button('Copié')), true);
  await ui.click(ui.button('Claude Code'));
  assert.equal(ui.button('Claude Code').getAttribute('aria-pressed'), 'true');
  const command = `claude mcp add --transport http carnet ${ADDRESS}`;
  assert.match(ui.panel().querySelector('[data-testid=mcp-setup-steps]').textContent, new RegExp(command.replace(/[.]/g, '\\.')));
  await ui.click(ui.panel().querySelector('[data-testid=mcp-setup-steps] button'));
  assert.equal(ui.copied.at(-1), command);
});

test('English, overridden labels, the app\'s own steps and no sign-in sentence', async t => {
  const ui = await mount(t, { locale: 'en', signIn: false, labels: { trigger: 'Use Carnet from your AI' }, clients: [{ id: 'mine', name: 'Mine', steps: ['Paste the address in your assistant.'] }] });
  assert.equal(ui.trigger().getAttribute('aria-label'), 'Use Carnet from your AI');
  await ui.click(ui.trigger());
  assert.equal(Boolean(ui.button('Copy')), true);
  assert.match(ui.panel().textContent, /Paste the address in your assistant\./);
  assert.equal(ui.panel().querySelector('[role=group]'), null);
  assert.doesNotMatch(ui.panel().textContent, /sign in/);
});
