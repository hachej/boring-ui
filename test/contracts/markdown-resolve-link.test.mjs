// A host's `resolveLink(href, { source, text, title })` decides every link in rendered Markdown: through the public PiChat (a reply, source
// 'chat') and through the Markdown component the pane draws a note with (source 'viewer'). Fictional data only. Comparisons are strings and
// booleans: a failing assert.equal on a happy-dom element looks like a runner shutdown.
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { Window } from 'happy-dom';

const root = fileURLToPath(new URL('../../', import.meta.url));
const source = process.env.RESOLVE_LINK_SOURCE_ROOT ?? root;
const out = `${root}.cache/markdown-resolve-link-test`;
mkdirSync(out, { recursive: true });
for (const [name, entry] of [['chat', 'registry/pi-chat/pi-chat.tsx'], ['plugins', 'registry/pi-chat-plugins/chat-plugins.ts'], ['markdown', 'registry/pi-chat-markdown/markdown.tsx']]) {
  await build({ entryPoints: [`${source}${entry}`], outfile: `${out}/${name}.mjs`, bundle: true, format: 'esm', platform: 'node', jsx: 'automatic', packages: 'external', logLevel: 'silent' });
}
const { PiChat } = await import(pathToFileURL(`${out}/chat.mjs`).href);
const { withChatPlugins } = await import(pathToFileURL(`${out}/plugins.mjs`).href);
const { Markdown } = await import(pathToFileURL(`${out}/markdown.mjs`).href);

const REPLY = 'See [the ledger](doc:123), [a file](docs/a.md), [site](https://fictional.invalid/x "Tip"), [gone](gone:1) and [bad](https://fictional.invalid/y).';
const assistant = content => ({ role: 'assistant', content, api: 'fictional', provider: 'fictional', model: 'fictional', usage: {}, stopReason: 'stop', timestamp: 1 });
const view = () => ({ entries: [
  { id: 1, kind: 'message', model: [{ role: 'user', content: 'Where is it', timestamp: 0 }] },
  { id: 2, kind: 'message', byTaskId: 1, model: [assistant([{ type: 'text', text: REPLY }])] },
], docs: {} });

test('resolveLink: the host decides each link of a chat reply and of a viewer note, and a refused address stays text', async t => {
  const window = new Window({ url: 'https://fictional.invalid/' });
  const names = ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node', 'Text', 'MutationObserver', 'ResizeObserver', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame', 'IS_REACT_ACT_ENVIRONMENT'];
  const globals = new Map(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  for (const name of names) {
    const value = name === 'window' ? window : name === 'IS_REACT_ACT_ENVIRONMENT' ? true : window[name];
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value: typeof value === 'function' && /^[a-z]/.test(name) ? value.bind(window) : value });
  }
  const { act, createElement } = await import('react');
  const { createRoot } = await import('react-dom/client');
  const container = document.createElement('div'); document.body.append(container);
  const ui = createRoot(container);
  t.after(async () => {
    await act(async () => ui.unmount()); await window.happyDOM.close();
    for (const [name, descriptor] of globals) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name]; }
  });
  const snapshot = { identity: {}, conversationId: 'fictional', connection: { kind: 'connected' }, view: view(), draft: { text: '', attachments: [], version: 0 }, outbox: [], history: { kind: 'disabled' }, send: { kind: 'idle' }, stop: 'idle', disposed: false };
  const controller = new Proxy({ getSnapshot: () => snapshot, subscribe: () => () => {} }, { get: (target, key) => key in target ? target[key] : async () => {} });
  const chat = async props => act(async () => ui.render(createElement(PiChat, { controller, ...withChatPlugins(props) })));
  const links = () => [...container.querySelectorAll('a')].map(a => ({ text: a.textContent, href: a.getAttribute('href'), target: a.getAttribute('target'), rel: a.getAttribute('rel') }));
  const text = () => container.querySelector('[data-testid="message-text"]')?.textContent ?? '';

  await t.test('without resolveLink: only plain http(s) links, as before', async () => {
    await chat({});
    assert.equal(JSON.stringify(links().map(link => link.text)), JSON.stringify(['site', 'bad']));
    assert.equal(links()[0].target, '_blank');
    assert.equal(links()[0].rel, 'noopener noreferrer');
  });

  await t.test('chat: an address, an address with onClick, null, undefined and a refused scheme', async () => {
    const calls = []; let clicked = '';
    await chat({ resolveLink: (href, context) => {
      calls.push(`${context.source}|${href}|${context.text}|${context.title ?? ''}`);
      if (href === 'doc:123') return 'https://app.fictional.invalid/docs/123';
      if (href === 'docs/a.md') return { href: 'https://app.fictional.invalid/files/a.md', target: '_self', onClick: event => { event.preventDefault(); clicked = 'a.md'; } };
      if (href === 'gone:1') return null;
      if (href.endsWith('/y')) return 'javascript:alert(1)';
      return undefined;
    } });
    const found = links();
    assert.equal(JSON.stringify(found.map(link => link.text)), JSON.stringify(['the ledger', 'a file', 'site']), 'null and the refused scheme render as text');
    assert.equal(found[0].href, 'https://app.fictional.invalid/docs/123');
    assert.equal(found[0].target, '_blank');
    assert.equal(found[0].rel, 'noopener noreferrer');
    assert.equal(found[1].target, null, '_self opens in place');
    assert.equal(found[2].href, 'https://fictional.invalid/x', 'undefined keeps the default');
    assert.equal(text().includes('gone'), true, 'the words of a null link stay');
    assert.equal(text().includes('bad'), true, 'the words of a refused link stay');
    assert.equal(calls.includes('chat|doc:123|the ledger|'), true);
    assert.equal(calls.includes('chat|https://fictional.invalid/x|site|Tip'), true);
    await act(async () => { container.querySelectorAll('a')[1].dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true })); });
    assert.equal(clicked, 'a.md');
  });

  await t.test('a resolver that refuses every unsafe scheme and one that throws never widen or break the reply', async () => {
    for (const bad of ['javascript:alert(1)', 'data:text/html,x', 'vbscript:x', '/relative', 'https://user:pw@fictional.invalid/']) {
      await chat({ resolveLink: () => bad });
      assert.equal(links().length, 0, `${bad} is not a link`);
    }
    await chat({ resolveLink: () => { throw new Error('fictional'); } });
    assert.equal(JSON.stringify(links().map(link => link.text)), JSON.stringify(['site', 'bad']), 'a throwing resolver falls back to the default');
  });

  await t.test('onClick without href: a real button styled like the link, no address; neither href nor onClick is words only', async () => {
    const heard = [];
    await chat({ resolveLink: (href, context) => {
      if (href === 'doc:123') return { onClick: (event, given) => { heard.push(`${event.type}|${given.source}|${given.text}|${href}`); } };
      if (href === 'docs/a.md') return { target: '_self' };
      if (href === 'gone:1') return { href: undefined };
      return undefined;
    } });
    const buttons = [...container.querySelectorAll('button')].filter(button => button.textContent === 'the ledger');
    assert.equal(buttons.length, 1, 'one button for the action');
    assert.equal(buttons[0].getAttribute('type'), 'button');
    assert.equal(buttons[0].hasAttribute('href'), false, 'no address');
    assert.equal(buttons[0].className.includes('underline'), true, 'styled like the link');
    assert.equal(JSON.stringify(links().map(link => link.text)), JSON.stringify(['site', 'bad']), 'the action, the target-only and the empty answers are not anchors');
    assert.equal(text().includes('a file'), true, 'neither href nor onClick keeps the words');
    await act(async () => { buttons[0].dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true })); });
    assert.equal(JSON.stringify(heard), JSON.stringify(['click|chat|the ledger|doc:123']), 'onClick gets the event and the context');
  });

  await t.test('onClick without href: a refused href stays words, and a throwing onClick neither unmounts the reply nor is swallowed', async () => {
    await chat({ resolveLink: href => href === 'doc:123' ? { href: 'javascript:alert(1)', onClick: () => {} } : href === 'docs/a.md' ? { onClick: () => { throw new Error('fictional click'); } } : undefined });
    const actions = () => [...container.querySelectorAll('button')].filter(button => button.className.includes('underline')).map(button => button.textContent);
    assert.equal(JSON.stringify(actions()), JSON.stringify(['a file']), 'only the address-less action is a button; the refused href is words');
    const seen = [];
    const listen = event => { seen.push(String(event.error?.message ?? event.message)); event.preventDefault(); };
    window.addEventListener('error', listen);
    try { await act(async () => { [...container.querySelectorAll('button')].find(button => button.textContent === 'a file').dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true })); }); } catch (error) { seen.push(String(error.message)); }
    window.removeEventListener('error', listen);
    assert.equal(seen.some(message => message.includes('fictional click')), true, 'the error reaches the host, not a silent catch');
    assert.equal(JSON.stringify(actions()), JSON.stringify(['a file']), 'the reply still renders');
  });

  await t.test('viewer: the note reports source viewer', async () => {
    const seen = [];
    await act(async () => ui.render(createElement(Markdown, { text: '[the ledger](doc:123)', linkSource: 'viewer', resolveLink: (href, context) => { seen.push(`${context.source}|${href}`); return 'https://app.fictional.invalid/docs/123'; } })));
    assert.equal(JSON.stringify(seen.slice(0, 1)), JSON.stringify(['viewer|doc:123']));
    assert.equal(links()[0]?.href, 'https://app.fictional.invalid/docs/123');
  });
});
