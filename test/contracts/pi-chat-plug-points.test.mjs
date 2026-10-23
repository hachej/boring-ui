// D-257 step 1: PiChat's plug points (`renderText`, `cards`, `toolRenderers` and the components a feature config carries) are used when
// passed, and today's built-in components are used otherwise. Presentation fixture at the public PiChat entry; fictional data only.
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { Window } from 'happy-dom';

const root = fileURLToPath(new URL('../../', import.meta.url));
// PLUG_SOURCE_ROOT points the test at another checkout (fail-first proof against the code before the plug points).
const source = process.env.PLUG_SOURCE_ROOT ?? root;
const out = `${root}.cache/pi-chat-plug-points-test`;
mkdirSync(out, { recursive: true });
await build({ entryPoints: [`${source}registry/pi-chat/pi-chat.tsx`], outfile: `${out}/chat.mjs`, bundle: true, format: 'esm', platform: 'node', jsx: 'automatic', packages: 'external', logLevel: 'silent' });
const { PiChat } = await import(pathToFileURL(`${out}/chat.mjs`).href);

const assistant = content => ({ role: 'assistant', content, api: 'fictional', provider: 'fictional', model: 'fictional', usage: {}, stopReason: 'stop', timestamp: 1 });
const result = (id, name, details) => ({ role: 'toolResult', toolCallId: id, toolName: name, content: [{ type: 'text', text: '{"fictional":true}' }], isError: false, timestamp: 2, ...(details ? { details } : {}) });
const view = () => ({
  entries: [
    { id: 1, kind: 'message', model: [{ role: 'user', content: 'Look up the fictional ledger', timestamp: 0 }] },
    { id: 2, kind: 'message', byTaskId: 1, model: [assistant([
      { type: 'text', text: 'Here is the **fictional** ledger.' },
      { type: 'toolCall', id: 'l', name: 'fictional_lookup', arguments: { id: 'ledger-1' } },
      { type: 'toolCall', id: 'o', name: 'fictional_other', arguments: {} },
      { type: 'toolCall', id: 'g', name: 'fictional_delete', arguments: { path: 'fictional/a.txt' } },
      { type: 'toolCall', id: 'q', name: 'ask_user', arguments: { question: 'Which fictional ledger?' } },
    ])] },
    { id: 3, kind: 'message', byTaskId: 1, model: [result('l', 'fictional_lookup'), result('o', 'fictional_other'), result('g', 'fictional_delete', { 'boring.approval': { summary: 'Delete fictional file?' } })] },
  ],
  docs: {},
});

test('PiChat uses plugged renderers, cards and feature components when passed, and the built-in ones otherwise', async t => {
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
  const render = async (props = {}) => act(async () => ui.render(createElement(PiChat, { controller, ...props })));
  const all = id => [...container.querySelectorAll(`[data-testid="${id}"]`)];
  const get = id => container.querySelector(`[data-testid="${id}"]`);
  const model = { options: [{ provider: 'fictional', modelId: 'fictional-1' }], change: async () => {} };

  await t.test('defaults: Markdown text, built-in question and approval cards, renderTool as catch-all, built-in model picker', async () => {
    await render({ model, renderTool: call => ({ content: createElement('div', { 'data-testid': 'catch-all', 'data-tool': call.name }), inline: true }) });
    assert.equal(get('message-text').querySelector('strong')?.textContent, 'fictional', 'the default text renderer is Markdown');
    assert.ok(get('question-card'), 'the built-in question card');
    assert.ok(get('approval-card'), 'the built-in approval card');
    assert.deepEqual(all('catch-all').map(node => node.dataset.tool), ['fictional_lookup', 'fictional_other']);
    assert.ok(get('composer-model'), 'the built-in model picker');
  });

  await t.test('plugged: renderText, cards.question, cards.approval, toolRenderers before renderTool, model.Picker', async () => {
    const texts = [];
    await render({
      model: { ...model, Picker: props => createElement('div', { 'data-testid': 'plugged-picker', 'data-current': props.currentModel?.modelId ?? '' }) },
      renderText: part => { texts.push(part.text); return createElement('p', { 'data-testid': 'plugged-text' }, part.text); },
      cards: {
        question: props => createElement('div', { 'data-testid': 'plugged-question', 'data-call': props.call.id }),
        approval: props => createElement('div', { 'data-testid': 'plugged-approval', 'data-summary': props.summary }),
      },
      toolRenderers: { fictional_lookup: call => ({ content: createElement('div', { 'data-testid': 'plugged-tool', 'data-arg': call.arguments.id }), inline: true }) },
      renderTool: call => ({ content: createElement('div', { 'data-testid': 'catch-all', 'data-tool': call.name }), inline: true }),
    });
    assert.equal(get('plugged-text')?.textContent, 'Here is the **fictional** ledger.', 'the plugged text renderer receives the raw part text');
    assert.ok(texts.length > 0);
    assert.equal(get('message-text'), null, 'Markdown is not used when renderText is passed');
    assert.equal(get('plugged-question')?.dataset.call, 'q');
    assert.equal(get('question-card'), null);
    assert.equal(get('plugged-approval')?.dataset.summary, 'Delete fictional file?');
    assert.equal(get('approval-card'), null);
    assert.equal(get('plugged-tool')?.dataset.arg, 'ledger-1', 'a toolRenderers entry renders its tool');
    assert.deepEqual(all('catch-all').map(node => node.dataset.tool), ['fictional_other'], 'renderTool stays the catch-all for the other tools');
    assert.equal(get('plugged-picker')?.dataset.current, '', 'the model config carries its own picker');
    assert.equal(get('composer-model'), null);
  });

  await t.test('a toolRenderers entry that returns undefined falls back to renderTool', async () => {
    await render({ toolRenderers: { fictional_lookup: () => undefined }, renderTool: call => ({ content: createElement('div', { 'data-testid': 'catch-all', 'data-tool': call.name }), inline: true }) });
    assert.deepEqual(all('catch-all').map(node => node.dataset.tool), ['fictional_lookup', 'fictional_other']);
  });
});
