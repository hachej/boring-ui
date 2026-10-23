// D-257: PiChat's plug points (`renderText`, `cards`, `toolRenderers` and the components a feature config carries) are used when passed.
// Step 2 moved the composer features into their own items: without them the core chat shows plain text and no feature component (and
// never crashes); `withChatPlugins` of pi-chat-plugins brings them all back. Presentation fixture at the public PiChat entry; fictional data only.
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
await build({ entryPoints: [`${root}registry/pi-chat-plugins/chat-plugins.ts`], outfile: `${out}/plugins.mjs`, bundle: true, format: 'esm', platform: 'node', jsx: 'automatic', packages: 'external', logLevel: 'silent' });
const { withChatPlugins } = await import(pathToFileURL(`${out}/plugins.mjs`).href);

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

  const slash = { commands: [{ name: 'fictional-plan', description: 'Plan', run: () => {} }] };
  const mentions = { search: async () => [] };
  await t.test('core defaults: plain text, a waiting notice instead of the question card, no approval card, renderTool as catch-all, no feature component configured without its item', async () => {
    await render({ model, slash, mentions, voiceMessage: { transcribe: async () => '' }, renderTool: call => ({ content: createElement('div', { 'data-testid': 'catch-all', 'data-tool': call.name }), inline: true }) });
    assert.equal(get('message-text')?.textContent, 'Here is the **fictional** ledger.', 'the core text renderer is plain text');
    assert.equal(get('message-text').querySelector('strong'), null, 'no Markdown without pi-chat-markdown');
    assert.equal(get('question-card'), null, 'no question card without pi-chat-question');
    assert.equal(get('approval-card'), null, 'no approval card without pi-chat-approval');
    assert.deepEqual(all('answer-waiting').map(node => node.dataset.kind), ['question'], 'a waiting notice for the open question; the settled approval keeps only its step');
    assert.deepEqual(all('catch-all').map(node => node.dataset.tool), ['fictional_lookup', 'fictional_other']);
    assert.equal(get('composer-model'), null, 'no model pill without pi-chat-pickers');
    assert.equal(get('voice-message-record'), null, 'no record button without pi-chat-voice');
    assert.equal(get('composer-input').getAttribute('role'), null, 'no `/` or `@` menu without pi-chat-slash and pi-chat-mentions');
  });

  await t.test('withChatPlugins: Markdown, the cards, the model pill, the record button and the `/` and `@` menus come back', async () => {
    await render(withChatPlugins({ model, slash, mentions, voiceMessage: { transcribe: async () => '' } }));
    assert.ok(get('question-card'), 'pi-chat-question draws the question');
    assert.ok(get('approval-card'), 'pi-chat-approval draws the approval');
    assert.equal(get('answer-waiting'), null);
    assert.equal(get('message-text').querySelector('strong')?.textContent, 'fictional', 'pi-chat-markdown draws the reply');
    assert.ok(get('composer-model'), 'pi-chat-pickers draws the pill');
    assert.ok(get('voice-message-record'), 'pi-chat-voice draws the record button');
    assert.equal(get('composer-input').getAttribute('role'), 'combobox', 'pi-chat-slash and pi-chat-mentions open their menus');
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
