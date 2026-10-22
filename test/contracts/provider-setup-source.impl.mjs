import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

// Runs in its own process (see provider-setup-source.test.mjs): the popover primitives read the DOM globals when first imported.
const root = fileURLToPath(new URL('../../', import.meta.url));
const out = `${root}.cache/provider-setup-test`;
mkdirSync(out, { recursive: true });
async function load(name, entry, folder = 'provider-setup') {
  await build({ entryPoints: [`${root}registry/${folder}/${entry}`], outfile: `${out}/${name}.mjs`, bundle: true, format: 'esm', platform: 'node', jsx: 'automatic',
    packages: 'external', logLevel: 'silent' });
  return import(pathToFileURL(`${out}/${name}.mjs`).href);
}
const { createElement } = await import('react');

test('provider setup lists any registered provider with its models, key state, sign-in and gateway note', async () => {
  const providers = [
    { id: 'alpha', name: 'Alpha', models: [{ id: 'a-1' }, { id: 'a-2', name: 'Alpha Two' }], auth: ['api_key'], configured: true },
    { id: 'beta', name: 'Beta subscription', models: [{ id: 'b-1' }], auth: ['oauth'], configured: false, needsGateway: true, loginLabel: 'Sign in with Beta' },
    { id: 'gamma', name: 'Gamma', models: [], auth: ['api_key', 'oauth'], configured: false },
  ];
  // The panel is the host's shadcn popover, portalled to the body: mount it in a DOM and read the document.
  const { Window } = await import('happy-dom');
  const window = new Window({ url: 'https://fictional.invalid/' });
  const globals = new Map();
  for (const name of ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node', 'Text', 'MutationObserver', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame', 'IS_REACT_ACT_ENVIRONMENT']) {
    globals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value: name === 'window' ? window : name === 'IS_REACT_ACT_ENVIRONMENT' ? true : typeof window[name] === 'function' && /^[a-z]/.test(name) ? window[name].bind(window) : window[name] });
  }
  const { act } = await import('react');
  const { createRoot } = await import('react-dom/client');
  // After the DOM globals: the popover primitives read them when first imported.
  const { ProviderSetup } = await load('provider-setup', 'provider-setup.tsx');
  try {
    const render = async (value, extra = {}) => {
      const container = document.createElement('div'); document.body.append(container);
      const rootNode = createRoot(container);
      await act(async () => rootNode.render(createElement(ProviderSetup, { providers, value, onSave: async () => {}, onLogin: () => {}, ...extra })));
      if (extra.defaultOpen !== false) await act(async () => { container.querySelector('[data-testid=provider-setup-trigger]').click(); });
      // The portalled panel mounts a frame or two after the click, longer on a loaded machine.
      for (let wait = 0; wait < 250 && extra.defaultOpen !== false && !document.querySelector('[data-testid=provider-setup-panel]'); wait++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
      const markup = document.body.innerHTML;
      await act(async () => rootNode.unmount());
      container.remove();
      return markup;
    };
    const alpha = await render({ provider: 'alpha', modelId: 'a-2' });
    for (const name of ['Alpha', 'Beta subscription', 'Gamma']) assert.ok(alpha.includes(name), name);
    assert.match(alpha, /Alpha Two/);
    assert.match(alpha, /data-testid="key-saved"/);
    assert.match(alpha, /type="password"/);
    assert.match(alpha, /role="dialog"[^>]*aria-label="Model access"|aria-label="Model access"[^>]*role="dialog"/);
    assert.doesNotMatch(alpha, /provider-login/);
    assert.doesNotMatch(alpha, /gateway-note/);
    const beta = await render({ provider: 'beta', modelId: 'b-1' }, { loginState: { state: 'pending', userCode: 'ABCD-1234', verificationUri: 'https://login.example.invalid/device' } });
    assert.match(beta, /Sign in with Beta/);
    assert.match(beta, /ABCD-1234/);
    assert.match(beta, /https:\/\/login\.example\.invalid\/device/);
    assert.match(beta, /<a [^>]*href="https:\/\/login\.example\.invalid\/device"/, 'an https address is a link');
    for (const verificationUri of ['javascript:alert(1)', 'data:text/html,x', 'ftp://login.example.invalid/device', 'not a url']) {
      const unsafe = await render({ provider: 'beta', modelId: 'b-1' }, { loginState: { state: 'pending', userCode: 'ABCD-1234', verificationUri } });
      assert.match(unsafe, /data-testid="login-pending"/);
      assert.doesNotMatch(unsafe, /<a [^>]*href=/, `${verificationUri} is plain text, not a link`);
    }
    assert.match(beta, /data-testid="gateway-note"/);
    assert.doesNotMatch(beta, /type="password"/);
    assert.doesNotMatch(await render({ provider: 'beta', modelId: 'b-1' }, { onLogin: undefined }), /provider-login/);
    assert.doesNotMatch(await render({ provider: 'alpha', modelId: 'a-1' }, { showGateway: false }), /gateway-input/);
    assert.doesNotMatch(await render({ provider: 'alpha', modelId: 'a-1' }, { defaultOpen: false }), /provider-setup-panel/, 'closed by default');
  } finally {
    await window.happyDOM.close();
    for (const [name, descriptor] of globals) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name];
    }
  }
});

