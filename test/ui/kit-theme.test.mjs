// The kit follows the host's theme: with the shadcn tokens written as the CLI writes them (light on :root, dark on .dark), the feedback
// item and the ambient window resolve the dark values under a `.dark` ancestor, and the ambient `contrast` variant is such a subtree.
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync, readFileSync } from 'node:fs';
import { build } from 'esbuild';
import { Window } from 'happy-dom';

const root = new URL('../../', import.meta.url);
const theme = JSON.parse(readFileSync(new URL('registry.json', root), 'utf8')).items.find(item => item.name === 'theme').cssVars;
const block = vars => Object.entries(vars).map(([name, value]) => `--${name}: ${value};`).join(' ');
// The host stylesheet: the theme item as `shadcn add` merges it, and the inline binding Tailwind compiles `bg-background` to.
const HOST_CSS = `:root { ${block(theme.light)} } .dark { ${block(theme.dark)} } .bg-background { --resolved-background: var(--background); } .bg-card { --resolved-background: var(--card); }`;

async function harness(t) {
  const window = new Window({ url: 'https://fictional.invalid/', settings: { disableIframePageLoading: true } });
  const names = ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node', 'Text', 'DOMParser', 'MutationObserver', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame', 'IS_REACT_ACT_ENVIRONMENT', 'confirm', 'sessionStorage', 'localStorage', 'ResizeObserver', 'KeyboardEvent', 'addEventListener', 'removeEventListener', 'matchMedia', 'innerWidth', 'innerHeight'];
  const globals = new Map(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  for (const name of names) {
    const value = name === 'window' ? window : name === 'IS_REACT_ACT_ENVIRONMENT' ? true : window[name];
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value: typeof value === 'function' && /^[a-z]/.test(name) ? value.bind(window) : value });
  }
  window.HTMLElement.prototype.getBoundingClientRect = () => ({ width: 1200, height: 800, left: 0, right: 1200, top: 0, bottom: 800, x: 0, y: 0 });
  const style = window.document.createElement('style');
  style.textContent = `${HOST_CSS}\n${readFileSync(new URL('registry/feedback/feedback.css', root), 'utf8')}`;
  window.document.head.append(style);
  const { createElement, act } = await import('react');
  const { createRoot } = await import('react-dom/client');
  const roots = [];
  const mount = async (node, parent = window.document.body) => {
    const element = window.document.createElement('div');
    parent.append(element);
    const reactRoot = createRoot(element);
    roots.push(reactRoot);
    await act(async () => reactRoot.render(node));
    return element;
  };
  t.after(async () => {
    for (const reactRoot of roots) await act(async () => reactRoot.unmount());
    await window.happyDOM.close();
    for (const [name, descriptor] of globals) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name]; }
  });
  return { window, createElement, mount };
}

async function load(entry, name) {
  const out = new URL('.cache/kit-theme-test/', root);
  mkdirSync(out, { recursive: true });
  const output = new URL(`${name}.mjs`, out);
  await build({ entryPoints: [new URL(entry, root).pathname], outfile: output.pathname, bundle: true, format: 'esm', platform: 'node', jsx: 'automatic', packages: 'external', logLevel: 'silent' });
  return import(output.href);
}

const resolved = (window, element, property) => window.getComputedStyle(element).getPropertyValue(property).trim();

test('feedback surfaces resolve the host tokens: light on the page, dark under a .dark ancestor', async t => {
  const { window, createElement, mount } = await harness(t);
  const { FeedbackList } = await load('registry/feedback/feedback-list.tsx', 'feedback-list');
  const props = { items: [], protection: 'protected', onOpen: () => {} };
  const light = (await mount(createElement(FeedbackList, props))).querySelector('[data-boring="feedback"]');
  const darkHost = window.document.createElement('div');
  darkHost.className = 'dark';
  window.document.body.append(darkHost);
  const dark = (await mount(createElement(FeedbackList, props), darkHost)).querySelector('[data-boring="feedback"]');
  assert.ok(light && dark);
  for (const [property, token] of [['--boring-feedback-surface', 'popover'], ['--boring-feedback-text', 'popover-foreground'], ['--boring-feedback-border', 'border'],
    ['--boring-feedback-muted', 'muted-foreground'], ['--boring-feedback-reveal', 'ring'], ['--boring-feedback-label-background', 'foreground']]) {
    assert.equal(resolved(window, light, property), theme.light[token], `${property} is the light ${token}`);
    assert.equal(resolved(window, dark, property), theme.dark[token], `${property} is the dark ${token} under .dark`);
  }
});

test('the ambient contrast window is a .dark subtree of the host tokens; surface follows the page', async t => {
  const { window, createElement, mount } = await harness(t);
  const { AmbientChat } = await load('registry/pi-ambient/ambient.tsx', 'ambient');
  const { createNativeChatController } = await import('@hachej/boring-ui-kit/native-chat');
  const controller = () => createNativeChatController({ identity: { runtimeId: 'fictional', scopeId: 'fictional', principalId: 'alice' },
    conversation: { id: 1 }, context: { value: () => undefined, toString: () => 'fictional' }, history: false,
    source: { open: async () => ({ value: { conversation: { id: 1 }, entries: [], docs: {} }, start() {}, closed: new Promise(() => {}), stop: async () => ({ kind: 'stopped' }) }) } });
  const background = async variant => {
    const chat = controller();
    t.after(() => chat.dispose());
    const element = await mount(createElement(AmbientChat, { controller: chat, variant, storageKey: `test.kit-theme.${variant}` }));
    const ambient = element.querySelector('[data-boring="ambient-chat"]');
    assert.ok(ambient, `${variant} renders`);
    assert.equal(ambient.classList.contains('dark'), variant === 'contrast', `${variant} root ${variant === 'contrast' ? 'carries' : 'does not carry'} .dark`);
    // The floating window's surface is the host Card drawn behind it.
    const surface = ambient.querySelector('[data-slot=card], .bg-background');
    assert.ok(surface, `${variant} has a host surface`);
    return [surface.dataset.slot === 'card' ? 'card' : 'background', resolved(window, surface, '--resolved-background')];
  };
  const [darkRole, dark] = await background('contrast'), [lightRole, light] = await background('surface');
  assert.equal(dark, theme.dark[darkRole], 'contrast shows the host dark surface on a light page');
  assert.equal(light, theme.light[lightRole], 'surface shows the host light surface');
});
